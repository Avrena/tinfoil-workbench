import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteController } from '../desktop/remote-controller.mjs';
import { emptyRemoteDraft, remoteAlias, remoteOverview, remoteDetail, remoteDraft, remoteGeneration } from '../dist/core/remote.js';
import { stoppedOutcome } from '../remote/worker.mjs';
import { createSSHTransport } from '../desktop/remote-ssh.mjs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const workspace='b'.repeat(32),job='c'.repeat(32);
const summary={id:job,workspace,status:'stopped',prompt:'A task',model:'test',createdAt:1};
const overview={protocol:1,auth:{enrolled:true,defaultModel:'test'},workspaces:[],jobs:[],jobsTruncated:false,checkedAt:1};
async function setup(transport=async()=>overview,confirm=async()=>true){
  let saved;
  const store={read:async()=>saved,write:async v=>{saved=structuredClone(v);},flush:async()=>{}};
  const controller=new RemoteController({store,confirm,transport,enroll:async()=>{}});await controller.initialize();
  await controller.execute({type:'host.add',name:'Test host',alias:'test-host'});
  return {controller,host:controller.local.hosts[0]?.id,store};
}
test('remote authority is fixed to confirmed SSH profiles and validated IDs',async()=>{
  for(const alias of ['-oProxyCommand=bad','host;touch','host name','$(bad)','user@host'])assert.throws(()=>remoteAlias(alias));
  const {controller,host}=await setup(()=>assert.fail('No remote command should execute.'));
  await assert.rejects(controller.execute({type:'job.stop',host,id:'../../../secret'}));
  await assert.rejects(controller.execute({type:'configure-chat',host,session:{}}));
  const declined=await setup(()=>assert.fail(),async()=>false);assert.equal(declined.controller.local.hosts.length,0);
});

test('legacy remote drafts migrate settings without taking instructions from Chat',()=>{
  const {systemPrompt,systemPromptName,temperature,reasoningEffort,thinkingMode,...legacy}=emptyRemoteDraft();
  assert.deepEqual(remoteDraft(legacy),emptyRemoteDraft());
  assert.equal(remoteGeneration({systemPrompt:' ',systemPromptName:'Old name'}).systemPromptName,'');
  for(const invalid of [{temperature:NaN},{temperature:Infinity},{temperature:'0.5'},{temperature:-1},{temperature:2.1},
    {reasoningEffort:'automatic'},{thinkingMode:true},{systemPrompt:'😀'.repeat(20001)},{systemPromptName:'two\nlines'}])assert.throws(()=>remoteGeneration(invalid));
  const detail=remoteDetail({...summary,settings:{...emptyRemoteDraft(),session:'secret',systemPrompt:'Keep exact instructions',systemPromptName:'Test preset'}});
  assert.equal(detail.settings.systemPrompt,'Keep exact instructions');assert.equal(detail.settings.session,undefined);
  assert.equal(detail.settings.workspace,undefined);assert.equal(remoteDetail(summary).settings,undefined);
});

test('remote titles persist locally without changing tasks or contacting the host',async()=>{
  let calls=0;
  const {controller,host,store}=await setup(async()=>{calls++;return {...overview,jobs:[summary]};});
  await controller.execute({type:'refresh',host});const before=structuredClone(controller.local.hosts[0].draft);
  await controller.execute({type:'job.rename',host,id:job,title:'Readable task title'});
  assert.equal(calls,1);assert.deepEqual(controller.local.hosts[0].draft,before);assert.equal(summary.prompt,'A task');
  const restored=new RemoteController({store,confirm:async()=>assert.fail(),transport:async()=>assert.fail()});await restored.initialize();
  assert.equal(restored.local.hosts[0].jobTitles[job],'Readable task title');
  for(const title of ['', 'two\nlines', 'x'.repeat(201)])await assert.rejects(controller.execute({type:'job.rename',host,id:job,title}));
  await assert.rejects(controller.execute({type:'job.rename',host,id:'d'.repeat(32),title:'Unknown job'}));
  assert.equal(calls,1);
});

test('failed remote title saves preserve the prior label and the mutation lock',async()=>{
  const {controller,host,store}=await setup(async()=>({...overview,jobs:[summary]}));
  await controller.execute({type:'refresh',host});await controller.execute({type:'job.rename',host,id:job,title:'Original label'});
  const write=store.write;store.write=async()=>{throw Error('Synthetic disk failure');};
  await assert.rejects(controller.execute({type:'job.rename',host,id:job,title:'Unsaved label'}),/Synthetic disk failure/);
  assert.equal(controller.local.hosts[0].jobTitles[job],'Original label');assert.equal(controller.busy,false);
  store.write=write;await controller.execute({type:'job.rename',host,id:job,title:'Saved label'});
  assert.equal(controller.local.hosts[0].jobTitles[job],'Saved label');
});

test('new remote settings require host support and remain bound to native review',async()=>{
  let request,question,release;
  const {controller,host}=await setup(async(_alias,r)=>{if(r.op==='overview')return {...overview,features:{jobSettings:true}};request=r;return{id:job};});
  const draft={...emptyRemoteDraft(),workspace,prompt:'Reviewed task',systemPrompt:'Line one\nLine two',systemPromptName:'My instructions',temperature:0.25,reasoningEffort:'high',thinkingMode:'enabled'};
  await controller.execute({type:'draft.set',host,draft});
  controller.confirm=q=>{question=q;return new Promise(resolve=>{release=resolve;});};
  const starting=controller.execute({type:'submit',host});await new Promise(resolve=>setImmediate(resolve));
  assert.match(question.text,/Line one\nLine two/);assert.match(question.message,/Temperature: 0.25.*Reasoning effort: high.*Thinking: enabled/);
  await controller.execute({type:'draft.set',host,draft:{...draft,systemPrompt:'Later instructions',temperature:1}});
  release(true);await starting;
  assert.equal(request.systemPrompt,draft.systemPrompt);assert.equal(request.temperature,0.25);assert.equal(request.reasoningEffort,'high');
  assert.equal(controller.local.hosts[0].draft.systemPrompt,'Later instructions');
  const old=await setup();await old.controller.execute({type:'draft.set',host:old.host,draft});
  old.controller.confirm=()=>assert.fail('Unsupported settings must be rejected before review.');
  await assert.rejects(old.controller.execute({type:'submit',host:old.host}),/Update the remote worker/);
});

test('a model and explicit reasoning choice in one draft save stay exact for native review',async()=>{
  const {controller,host}=await setup();
  const draft={...emptyRemoteDraft(),reasoningEffort:'high',thinkingMode:'enabled',systemPrompt:'Exact text',temperature:0.2};
  await controller.execute({type:'draft.set',host,draft});
  await controller.execute({type:'draft.set',host,draft:{...draft,model:'other-model'}});
  const next=controller.local.hosts[0].draft;
  assert.equal(next.reasoningEffort,'high');assert.equal(next.thinkingMode,'enabled');
  assert.equal(next.systemPrompt,'Exact text');assert.equal(next.temperature,0.2);
});
test('native start confirmation binds the reviewed task; a later draft is retained',async()=>{
  let release,request;
  const {controller,host,store}=await setup(async(_alias,r)=>{if(r.op==='overview')return overview;request=r;return{id:job};});
  controller.confirm=()=>new Promise(resolve=>{release=resolve;});
  const draft={...emptyRemoteDraft(),workspace,prompt:'Reviewed task'};
  await controller.execute({type:'draft.set',host,draft});
  const starting=controller.execute({type:'submit',host});
  await new Promise(resolve=>setImmediate(resolve));
  await controller.execute({type:'draft.set',host,draft:{...draft,prompt:'Next task'}});
  release(true);await starting;
  assert.equal(request.prompt,'Reviewed task');assert.equal(request.policy,'workspace-auto');assert.match(request.requestId,/^[a-f0-9]{32}$/);
  assert.equal((await store.read()).hosts[0].draft.prompt,'Next task');
});
test('a lost submission response blocks duplicate starts until an overview reconciles it',async()=>{
  let submissions=0;
  const {controller,host}=await setup(async(_alias,r)=>{if(r.op==='submit'){submissions++;throw Error('Disconnected');}return overview;});
  await controller.execute({type:'draft.set',host,draft:{...emptyRemoteDraft(),workspace,prompt:'Keep this task'}});
  await assert.rejects(controller.execute({type:'submit',host}));
  assert.ok(controller.local.hosts[0].pendingJob);
  await assert.rejects(controller.execute({type:'submit',host}),/Refresh/);assert.equal(submissions,1);
  await controller.execute({type:'refresh',host});assert.equal(controller.local.hosts[0].pendingJob,undefined);
  assert.equal(controller.local.hosts[0].draft.prompt,'Keep this task');
});

test('an overview started before submission cannot clear its uncertain outcome',async()=>{
  let releaseOld,rejectStart,reads=0,pendingID;
  const {controller,host}=await setup(async(_alias,r)=>{
    if(r.op==='overview'){if(++reads===1)return new Promise(resolve=>{releaseOld=resolve;});return reads>2?{...overview,jobs:[{...summary,id:pendingID}]}:overview;}
    pendingID=r.requestId;return new Promise((_resolve,reject)=>{rejectStart=reject;});
  });
  await controller.execute({type:'draft.set',host,draft:{...emptyRemoteDraft(),workspace,prompt:'Uncertain task'}});
  const old=controller.execute({type:'refresh',host});const start=controller.execute({type:'submit',host});
  await new Promise(resolve=>setImmediate(resolve));releaseOld(overview);await old;
  assert.equal(controller.local.hosts[0].pendingJob,pendingID);
  rejectStart(Error('Lost response'));await assert.rejects(start);
  const latest=await controller.execute({type:'refresh',host});assert.equal(latest.selectedJob,pendingID);
  assert.equal(controller.local.hosts[0].draft.prompt,'');assert.equal(controller.local.hosts[0].pendingJob,undefined);
});
test('Stop can reach the fixed controller while another remote action is busy',async()=>{
  let called;
  const {controller,host}=await setup(async(_alias,r)=>{called=r;return summary;});controller.busy=true;
  const result=await controller.execute({type:'job.stop',host,id:job});assert.equal(called.op,'stop');assert.equal(result.detail.status,'stopped');
});
test('remote display data rejects injected IDs and drops unexpected credential fields',()=>{
  assert.throws(()=>remoteOverview({...overview,jobs:[{...summary,id:'" onclick="bad'}]}));
  assert.throws(()=>remoteOverview({...overview,workspaces:[{id:workspace,name:'Test',createdAt:1,lastUsed:1,quotaBytes:2,activeJobs:['bad']}]}));
  const detail=remoteDetail({...summary,session:'secret',messages:[{content:'private'}],content:'<script>untrusted text</script>'});
  assert.equal(detail.session,undefined);assert.equal(detail.messages,undefined);assert.match(detail.content,/<script>/);
});
test('operator stop, elapsed-time limit and shutdown have distinct persisted outcomes',()=>{
  for(const [reason,status,code] of [['operator','stopped','operator'],['time-limit','limited','time'],['shutdown','interrupted','shutdown']]){
    const ctrl=new AbortController();ctrl.abort(reason);const state=stoppedOutcome(ctrl.signal);assert.equal(state.status,status);assert.equal(state.reason,code);
  }
});

test('remote transcript retains only bounded display fields and valid tool references',()=>{
  const tools=[{id:'call-1',name:'run_command',arguments:'{}',status:'complete'}];
  const transcript=[{id:'assistant-0',role:'assistant',content:'**Checking**',reasoning:'Plan',secret:'never'},
    {id:'tool-0',role:'tool',tool:0},{id:'assistant-1',role:'assistant',content:'Partial',partial:true}];
  const detail=remoteDetail({...summary,tools,transcript});
  assert.equal(detail.transcript[0].secret,undefined);
  assert.equal(detail.transcript[1].tool,0);assert.equal(detail.transcript[2].partial,true);
  assert.equal(remoteDetail(summary).transcript,undefined);
  for(const invalid of [
    [{id:'system',role:'system',content:'private'}],
    [{id:'tool-0',role:'tool',tool:1}],
    [{id:'tool-0',role:'tool',tool:0.5}],
    [transcript[0],transcript[0]],
    [{...transcript[0],id:'bad" onclick="x'}],
    [{...transcript[0],content:'x'.repeat(100001)}],
    [{...transcript[0],content:'x'.repeat(100000),reasoning:'y'.repeat(60000)},transcript[2]],
  ])assert.throws(()=>remoteDetail({...summary,tools,transcript:invalid}));
});

test('SSH controller reuses one connection and never replays a request after disconnect',async()=>{
  let launches=0,writes=0,child;
  const transport=createSSHTransport(async()=>({stopped:true}),(_exe,args)=>{
    launches++;assert.equal(args.at(-1),'/usr/local/bin/tinfoil-workbench --serve');
    child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>child.emit('close',0);
    child.stdin.on('data',bytes=>{writes++;const r=JSON.parse(bytes.toString());queueMicrotask(()=>r.op==='lose'?child.emit('close',1):child.stdout.write(JSON.stringify({ok:true,result:{op:r.op}})+'\n'));});
    return child;
  });
  try {
    const results=await Promise.all([transport('test-host',{op:'overview'}),transport('test-host',{op:'inspect'})]);
    assert.deepEqual(results,[{op:'overview'},{op:'inspect'}]);assert.equal(launches,1);
    assert.deepEqual(await transport('test-host',{op:'stop'}),{stopped:true});assert.equal(launches,1);
    await assert.rejects(transport('test-host',{op:'lose'}),/disconnected/);assert.equal(writes,3);
    await transport('test-host',{op:'overview'});assert.equal(launches,2);assert.equal(writes,4);
  }finally{transport.close();}
});
