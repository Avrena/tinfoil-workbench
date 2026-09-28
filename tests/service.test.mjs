import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkbenchService } from '../desktop/service.mjs';
import { newWorkspace } from '../dist/core/workspace.js';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function vault(){let value=null;return {fail:false,read:async()=>value,write:async function(v){if(this.fail)throw Error('disk');value=structuredClone(v);},flush:async()=>{}};}
async function setup(t,{verified=true,generator}={}){
  const store=vault(), calls=[];let factories=0;
  const client={ready:async()=>{},getVerificationDocument:async()=>({securityVerified:verified,steps:{verifyCode:{status:'success'}}}),models:{list:async()=>({data:[{id:'a'},{id:'b'}]})},chat:{completions:{create:async(body,{signal})=>{calls.push(structuredClone(body));return (generator??(async function*(){yield {choices:[{delta:{content:'Hello',reasoning_content:'Thinking'}}]};yield {choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:7,completion_tokens:3}};}))(body,signal);}}}};
  const s=new WorkbenchService(store,async()=>{factories++;return client;});await s.initialize();await s.execute({type:'credentials.set',key:'test-only-not-real'});
  s.workspace.threads[0].settings.model='a';t.after(()=>s.shutdown());return {s,store,calls,client,get factories(){return factories;}};
}
async function finished(s){while(s.tasks.size)await Promise.all([...s.tasks]);}
function send(s){return s.execute({type:'send',id:s.workspace.activeId,text:'Hello',attachments:[]});}
test('snapshot redacts credentials and has increasing revisions',async t=>{
  const {s}=await setup(t);const a=s.snapshot(),b=s.snapshot();assert.ok(b.sequence>a.sequence);assert.ok(!('apiKey'in a.workspace));assert.ok(!('cacheSecret'in a.workspace));assert.equal(a.hasKey,true);
});
test('a verified stream completes with separated reasoning and usage',async t=>{
  const {s,calls}=await setup(t);await send(s);await finished(s);const r=s.workspace.threads[0].turns[0].replies[0];
  assert.equal(r.status,'complete');assert.equal(r.content,'Hello');assert.equal(r.reasoning,'Thinking');assert.deepEqual(r.usage,{input:7,output:3});assert.equal(calls.length,1);assert.ok(!('temperature'in calls[0]));
});
test('failed attestation sends no inference request and has no fallback',async t=>{
  const {s,calls}=await setup(t,{verified:false});await send(s);await finished(s);assert.equal(calls.length,0);assert.equal(s.verification.state,'failed');assert.equal(s.workspace.threads[0].turns[0].replies[0].status,'error');
});
test('an abruptly ended stream preserves partial text as interrupted',async t=>{
  const {s}=await setup(t,{generator:async function*(){yield {choices:[{delta:{content:'partial'}}]};}});await send(s);await finished(s);const r=s.workspace.threads[0].turns[0].replies[0];assert.equal(r.status,'interrupted');assert.equal(r.content,'partial');
});
test('comparison shares verification but not response buffers',async t=>{
  const f=await setup(t,{generator:async function*(body){yield {choices:[{delta:{content:body.model},finish_reason:'stop'}]};}});const {s,calls}=f;
  Object.assign(s.workspace.threads[0].settings,{compare:true,compareModel:'b'});await send(s);await finished(s);assert.equal(calls.length,2);assert.equal(f.factories,1);
  const turn=s.workspace.threads[0].turns[0];assert.deepEqual(turn.replies.map(r=>r.content),['a','b']);assert.equal(turn.selectedReplyId,null);
});
test('stop preserves partial output and duplicate sends are rejected',async t=>{
  const {s}=await setup(t,{generator:async function*(_body,signal){yield {choices:[{delta:{content:'partial'}}]};while(!signal.aborted)await wait(5);throw Error('Abort');}});
  await send(s);await wait(15);await assert.rejects(send(s),/already running/);await s.execute({type:'stop',id:s.workspace.activeId});await finished(s);
  const r=s.workspace.threads[0].turns[0].replies[0];assert.equal(r.status,'stopped');assert.equal(r.content,'partial');assert.equal(s.busyThreadId,null);
});
test('tool-call termination is not silently accepted or executed',async t=>{
  const {s}=await setup(t,{generator:async function*(){yield {choices:[{delta:{},finish_reason:'tool_calls'}]};}});await send(s);await finished(s);const r=s.workspace.threads[0].turns[0].replies[0];assert.equal(r.status,'error');assert.match(r.error,/no valid tool call/);
});
test('initial disk failure prevents any API call',async t=>{
  const {s,store,calls}=await setup(t);store.fail=true;await assert.rejects(send(s),/save failed/);assert.equal(calls.length,0);assert.equal(s.storageFailed,true);assert.equal(s.busyThreadId,null);
});
test('output-limit endings are complete but visibly annotated',async t=>{
  const {s}=await setup(t,{generator:async function*(){yield {choices:[{delta:{content:'truncated'},finish_reason:'length'}]};}});await send(s);await finished(s);const r=s.workspace.threads[0].turns[0].replies[0];assert.equal(r.status,'complete');assert.match(r.error,/incomplete/);
});
test('provider error messages are redacted and never automatically retried',async t=>{
  const {s,calls}=await setup(t,{generator:async function*(){throw Object.assign(Error('private API token'),{status:429});}});await send(s);await finished(s);const r=s.workspace.threads[0].turns[0].replies[0];assert.equal(calls.length,1);assert.ok(!r.error.includes('private API token'));assert.match(r.error,/not retried/);
});
test('clearing credentials resets verification without deleting history',async t=>{
  const {s}=await setup(t);await send(s);await finished(s);await s.execute({type:'credentials.clear'});assert.equal(s.workspace.apiKey,'');assert.equal(s.verification.state,'idle');assert.equal(s.workspace.threads[0].turns.length,1);
});
test('unsupported IPC commands cannot become shell or filesystem operations',async t=>{
  const {s}=await setup(t);for(const type of ['shell.exec','file.read','net.fetch','__proto__'])await assert.rejects(s.execute({type}),/Unsupported/);
});

test('oversized responses preserve a bounded, reloadable partial record',async t=>{
  const {s}=await setup(t,{generator:async function*(){yield {choices:[{delta:{content:'x'.repeat(2000100)}}]};}});
  await send(s);await finished(s);const r=s.workspace.threads[0].turns[0].replies[0];
  assert.equal(r.content.length,2000000);assert.equal(r.status,'stopped');assert.match(r.error,/size limit/);
  const {validateWorkspace}=await import('../dist/core/validation.js');assert.doesNotThrow(()=>validateWorkspace(s.workspace));
});
