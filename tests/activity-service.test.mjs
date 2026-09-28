import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkbenchService } from '../desktop/service.mjs';
import { validateWorkspace } from '../dist/core/validation.js';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const finish=async s=>{while(s.tasks.size)await Promise.all([...s.tasks]);};
const chunk=(delta,finish_reason)=>({choices:[{delta,finish_reason}]});
const tool=(name,args,id='call_one',index=0)=>({index,id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const marker=event=>`\n<tinfoil-event>${JSON.stringify(event)}</tinfoil-event>\n`;
const reply=s=>s.workspace.threads[0].turns[0].replies[0];
async function setup(t,generator,opts={}){
 const requests=[],requestOptions=[],executions=[],states=[];
 const client={ready:async()=>{},getVerificationDocument:async()=>({securityVerified:true,steps:{}}),chat:{completions:{create:async(body,options)=>{requests.push(structuredClone(body));requestOptions.push(options);return generator(requests.length,body,options);}}}};
 const vault={read:async()=>null,write:async w=>{validateWorkspace(w);},flush:async()=>{}};
 const s=new WorkbenchService(vault,async()=>client,snap=>states.push(snap),async input=>{executions.push(input);return {status:'complete',stdout:'ok',stderr:'',exitCode:0,elapsedMs:1,artifacts:[],truncated:false};},opts);
 await s.initialize();s.workspace.apiKey='test-key';Object.assign(s.workspace.threads[0].settings,{model:'fixture-model',visualTools:false,delegateMode:'ask'});t.after(()=>s.shutdown());return{s,requests,requestOptions,executions,states};
}
const send=s=>s.execute({type:'send',id:s.workspace.activeId,text:'Original user message not shared automatically.',attachments:[]});
async function pending(s){for(let n=0;n<300;n++){if(s.approvals.size)return [...s.approvals.values()][0];await pause(3);}throw Error('No pending approval');}
const approve=(s,p,value=true)=>s.execute({type:'tool.approve',id:p.threadId,toolId:p.tool.id,approve:value});

test('delegation waits for explicit approval, uses same verified client/model and returns matched tool result',async t=>{
 const {s,requests}=await setup(t,async function*(n,body){
  if(n===1)yield chunk({tool_calls:[tool('delegate_task',{task:'Review only this sample.'})]},'tool_calls');
  else if(n===2){yield chunk({reasoning_content:'Child reasoning.'});yield chunk({content:'Child finding.'},'stop');yield {choices:[],usage:{prompt_tokens:12,completion_tokens:5}};}
  else yield chunk({content:'Parent summary.'},'stop');
 });
 s.workspace.threads[0].settings.systemPrompt='Private parent-only instructions.';
 await send(s);const p=await pending(s);await pause(10);assert.equal(requests.length,1);assert.equal(p.tool.delegate.model,'fixture-model');
 await approve(s,p);await finish(s);
 assert.equal(requests.length,3);assert.equal(requests[1].model,'fixture-model');assert.equal(requests[1].max_tokens,4096);assert.ok(!('tools'in requests[1]));assert.ok(!('web_search_options'in requests[1]));assert.equal(requests[1].messages.length,2);assert.equal(requests[1].messages[1].content,'Review only this sample.');
 assert.ok(!JSON.stringify(requests[1]).includes('Private parent-only'));assert.ok(!JSON.stringify(requests[1]).includes('Original user message'));assert.ok(!JSON.stringify(requests[1]).includes('test-key'));
 const child=reply(s).tools[0];assert.equal(child.delegate.content,'Child finding.');assert.equal(child.delegate.reasoning,'Child reasoning.');assert.deepEqual(child.delegate.usage,{input:12,output:5});
 const result=requests[2].messages.find(m=>m.role==='tool');assert.equal(result.tool_call_id,'call_one');assert.equal(JSON.parse(result.content).stdout,'Child finding.');assert.ok(!result.content.includes('Child reasoning.'));assert.equal(reply(s).content,'Parent summary.');assert.equal(reply(s).status,'complete');
});
test('denied delegation creates no child request and is not retried automatically',async t=>{
 const {s,requests}=await setup(t,async function*(n){yield n===1?chunk({tool_calls:[tool('delegate_task',{task:'Review'})]},'tool_calls'):chunk({content:'No delegation.'},'stop');});await send(s);await approve(s,await pending(s),false);await finish(s);assert.equal(requests.length,2);assert.equal(reply(s).tools[0].status,'denied');
});
test('disabled delegation is not advertised and cannot execute an unsolicited call',async t=>{
 const {s,requests}=await setup(t,async function*(){yield chunk({tool_calls:[tool('delegate_task',{task:'Review'})]},'tool_calls');});s.workspace.threads[0].settings.delegateMode='off';await send(s);await finish(s);assert.equal(requests.length,1);assert.ok(!requests[0].tools);assert.equal(s.approvals.size,0);
});
test('malformed delegation never reaches an approval or a child request',async t=>{
 const {s,requests}=await setup(t,async function*(n){yield n===1?chunk({tool_calls:[tool('delegate_task',{task:'Review',model:'other'})]},'tool_calls'):chunk({content:'Declined.'},'stop');});await send(s);await finish(s);assert.equal(s.approvals.size,0);assert.equal(requests.length,2);assert.equal(reply(s).tools[0].status,'error');
});
test('parent cancellation while delegate awaits approval makes no extra request',async t=>{
 const {s,requests}=await setup(t,async function*(){yield chunk({tool_calls:[tool('delegate_task',{task:'Review'})]},'tool_calls');});await send(s);await pending(s);await s.execute({type:'stop',id:s.workspace.activeId});await finish(s);assert.equal(requests.length,1);assert.equal(reply(s).tools[0].status,'cancelled');assert.equal(s.approvals.size,0);
});
test('individual delegate cancellation retains partial output and lets parent summarize cancellation',async t=>{
 let started=false;const {s,requests}=await setup(t,async function*(n,body,{signal}){
  if(n===1)yield chunk({tool_calls:[tool('delegate_task',{task:'Review'})]},'tool_calls');
  else if(n===2){started=true;yield chunk({content:'Partial child.'});await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));}
  else yield chunk({content:'Delegation stopped.'},'stop');
 });await send(s);const p=await pending(s);await approve(s,p);while(!started)await pause(2);await assert.rejects(s.execute({type:'tool.cancel',id:'different',toolId:p.tool.id}));await s.execute({type:'tool.cancel',id:s.workspace.activeId,toolId:p.tool.id});await finish(s);
 assert.equal(requests.length,3);assert.equal(p.tool.status,'cancelled');assert.equal(p.tool.delegate.content,'Partial child.');assert.equal(reply(s).status,'complete');assert.equal(s.delegateControllers.size,0);
});
test('child tool calls are rejected without recursion or native execution',async t=>{
 const {s,requests,executions}=await setup(t,async function*(n){yield n===1?chunk({tool_calls:[tool('delegate_task',{task:'Review'})]},'tool_calls'):n===2?chunk({tool_calls:[tool('python',{code:'print(1)'})]},'tool_calls'):chunk({content:'Child has no tools.'},'stop');});await send(s);await approve(s,await pending(s));await finish(s);assert.equal(reply(s).tools[0].status,'error');assert.equal(requests.length,3);assert.equal(executions.length,0);
});
test('child interrupted and output-limit responses never masquerade as completed',async t=>{
 for(const terminal of [null,'length']){const {s}=await setup(t,async function*(n){yield n===1?chunk({tool_calls:[tool('delegate_task',{task:'Review'})]},'tool_calls'):n===2?chunk({content:'Partial'},terminal):chunk({content:'Reported partial.'},'stop');});await send(s);await approve(s,await pending(s));await finish(s);assert.equal(reply(s).tools[0].status,'error');assert.equal(reply(s).tools[0].delegate.content,'Partial');}
});
test('delegation hard budget allows two requests and records the third as blocked without approval',async t=>{
 const {s,requests}=await setup(t,async function*(n){
  if(n===1)yield chunk({tool_calls:[0,1,2].map(i=>tool('delegate_task',{task:'Task '+i},'call_'+i,i))},'tool_calls');
  else yield chunk({content:'Result '+n},'stop');
 });await send(s);await approve(s,await pending(s));await approve(s,await pending(s));await finish(s);assert.equal(requests.length,4);assert.deepEqual(reply(s).tools.map(t=>t.status),['complete','complete','error']);assert.equal(s.delegationCount,2);assert.equal(new Set(reply(s).tools.map(t=>t.batchId)).size,1);
});
test('queued batch is visible in full before execution and every protected action keeps its approval',async t=>{
 const {s,executions,requests,states}=await setup(t,async function*(n){yield n===1?chunk({tool_calls:[tool('python',{code:'print(1)'},'call_1',0),tool('python',{code:'print(2)'},'call_2',1)]},'tool_calls'):chunk({content:'Done'},'stop');});s.workspace.pythonPath='/fixture/python';s.workspace.threads[0].settings.toolsMode='ask';await send(s);const first=await pending(s);assert.equal(reply(s).tools.length,2);assert.equal(reply(s).tools[1].status,'queued');assert.equal(executions.length,0);
 await approve(s,first,false);const second=await pending(s);assert.notEqual(second.tool.id,first.tool.id);assert.equal(executions.length,0);await approve(s,second);await finish(s);assert.equal(executions.length,1);assert.deepEqual(requests[1].messages.filter(m=>m.role==='tool').map(m=>m.tool_call_id),['call_1','call_2']);assert.ok(states.some(x=>x.workspace.threads[0].turns[0]?.replies[0].tools?.every(t=>t.status==='queued')));
});
test('stopping a batch cancels remaining queued actions without silently executing them',async t=>{
 const {s,executions}=await setup(t,async function*(){yield chunk({tool_calls:[tool('python',{code:'print(1)'},'c1',0),tool('python',{code:'print(2)'},'c2',1)]},'tool_calls');});s.workspace.pythonPath='/fixture/python';s.workspace.threads[0].settings.toolsMode='ask';await send(s);await pending(s);await s.execute({type:'stop',id:s.workspace.activeId});await finish(s);assert.equal(executions.length,0);assert.deepEqual(reply(s).tools.map(t=>t.status),['cancelled','cancelled']);
});
test('provider MCP events are passive display data, stripped from answer and never executed locally',async t=>{
 const remote={type:'tinfoil.tool_call',item_id:'remote',status:'in_progress',tool:{name:'python',arguments:{code:'print(1)',accessToken:'do-not-save'}}};
 const {s,executions,requestOptions}=await setup(t,async function*(){const raw='Before'+marker(remote)+marker({...remote,status:'completed',tool:{name:'python',output:'1'}})+'After';for(let i=0;i<raw.length;i+=5)yield chunk({content:raw.slice(i,i+5)});yield chunk({},'stop');});await send(s);await finish(s);
 assert.equal(reply(s).content,'BeforeAfter');assert.equal(executions.length,0);assert.equal(reply(s).toolMessages.length,0);assert.equal(reply(s).tools.length,1);assert.equal(reply(s).tools[0].origin,'provider');assert.equal(reply(s).tools[0].status,'complete');assert.ok(!JSON.stringify(s.workspace).includes('do-not-save'));assert.equal(requestOptions[0].headers['X-Tinfoil-Events'],'web_search,code_execution');
});
test('search opt-in is separate from observing events and defaults off',async t=>{
 for(const enabled of [false,true]){const {s,requests}=await setup(t,async function*(){yield chunk({content:'Done'},'stop');});s.workspace.threads[0].settings.webSearch=enabled;await send(s);await finish(s);assert.equal('web_search_options'in requests[0],enabled);}
});
test('missing MCP terminal events and late in-progress repeats have honest states',async t=>{
 const e={type:'tinfoil.web_search_call',item_id:'remote',status:'in_progress',action:{type:'search',query:'x'}};
 const {s}=await setup(t,async function*(){yield chunk({content:marker({...e,status:'completed'})+marker(e)+marker({...e,item_id:'unfinished'})});yield chunk({},'stop');});await send(s);await finish(s);assert.deepEqual(reply(s).tools.map(t=>t.status),['complete','error']);assert.match(reply(s).tools[1].stderr,/without a terminal/);
});

test('invalid child output aborts its network stream and is recorded as an error, not a user cancellation',async t=>{
 const {s,requestOptions}=await setup(t,async function*(n){yield n===1?chunk({tool_calls:[tool('delegate_task',{task:'Review'})]},'tool_calls'):n===2?chunk({tool_calls:[tool('delegate_task',{task:'Recursive'})]},'tool_calls'):chunk({content:'Reported error.'},'stop');});
 await send(s);await approve(s,await pending(s));await finish(s);assert.equal(requestOptions[1].signal.aborted,true);assert.equal(reply(s).tools[0].status,'error');assert.equal(s.delegateControllers.size,0);
});
test('stalled delegate is cancelled by its own timeout and main conversation can continue',async t=>{
 const {s}=await setup(t,async function*(n,body,{signal}){if(n===1)yield chunk({tool_calls:[tool('delegate_task',{task:'Review'})]},'tool_calls');else if(n===2)await new Promise(resolve=>signal.aborted?resolve():signal.addEventListener('abort',resolve,{once:true}));else yield chunk({content:'Child timed out.'},'stop');},{delegateTimeoutMs:20,delegateIdleMs:20});
 await send(s);await approve(s,await pending(s));await finish(s);assert.equal(reply(s).tools[0].status,'cancelled');assert.equal(reply(s).status,'complete');assert.equal(s.delegateControllers.size,0);
});
test('two delegate requests are a shared hard limit across concurrent comparison lanes',async t=>{
 let children=0;const {s}=await setup(t,async function*(n,body){
  if(body.messages[0]?.content?.startsWith('Complete the self-contained delegated task')){children++;await pause(8);yield chunk({content:'Child result'},'stop');}
  else if(body.messages.some(m=>m.role==='tool'))yield chunk({content:'Parent complete'},'stop');
  else yield chunk({tool_calls:[tool('delegate_task',{task:'Task A'},body.model+'_a',0),tool('delegate_task',{task:'Task B'},body.model+'_b',1)]},'tool_calls');
 });Object.assign(s.workspace.threads[0].settings,{compare:true,compareModel:'second-model'});await send(s);
 for(let n=0;n<500&&s.tasks.size;n++){for(const p of [...s.approvals.values()])await approve(s,p);await pause(2);}
 await finish(s);assert.equal(children,2);assert.equal(s.delegationCount,2);const tools=s.workspace.threads[0].turns[0].replies.flatMap(r=>r.tools);assert.equal(tools.filter(x=>x.status==='complete').length,2);assert.equal(tools.filter(x=>x.status==='error').length,2);assert.equal(s.approvals.size,0);
});
