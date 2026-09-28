import test from 'node:test';import assert from 'node:assert/strict';
import { WorkbenchService } from '../desktop/service.mjs';
import { normalizeCapability } from '../dist/core/capabilities.js';
const chunk=(delta,finish_reason)=>({choices:[{delta,finish_reason}]});
const proposal=(name,args,id='call_visual')=>chunk({tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]},'tool_calls');
const done=async s=>{while(s.tasks.size)await Promise.all([...s.tasks]);};
async function setup(t,generator,options={}){const requests=[],runs=[];const vault={read:async()=>null,write:async()=>{},flush:async()=>{}};const client={ready:async()=>{},getVerificationDocument:async()=>({securityVerified:true,steps:{}}),chat:{completions:{create:async body=>{requests.push(structuredClone(body));return generator(requests.length,body);}}}};const s=new WorkbenchService(vault,async()=>client,()=>{},async args=>{runs.push(args);throw Error('Unexpected Python execution');},options);await s.initialize();s.workspace.apiKey='secret';s.workspace.threads[0].settings.model='fixture';t.after(()=>s.shutdown());return{s,requests,runs};}
const send=s=>s.execute({type:'send',id:s.workspace.activeId,text:'Make a visualization',attachments:[]});
const reply=s=>s.workspace.threads[0].turns[0].replies[0];
const spec={title:'Chart',type:'line',labels:['a','b'],series:[{name:'x',values:[1,2]}]};
test('visual tools complete an actual model tool loop without Python or approval',async t=>{const {s,requests,runs}=await setup(t,async function*(n){yield n===1?proposal('render_chart',spec):chunk({content:'Chart ready'},'stop');});await send(s);await done(s);assert.equal(s.approvals.size,0);assert.equal(runs.length,0);assert.equal(reply(s).tools[0].artifacts.length,1);assert.equal(requests[1].messages[2].tool_call_id,'call_visual');assert.equal(JSON.parse(requests[1].messages[2].content).artifacts[0].artifact_id,reply(s).tools[0].artifacts[0].id);assert.equal(reply(s).status,'complete');});
test('Python is not exposed or executed through visualization-only mode',async t=>{const {s,requests,runs}=await setup(t,async function*(n){yield n===1?proposal('python',{code:'print(1)'}):chunk({content:'No execution'},'stop');});await send(s);await done(s);assert.ok(!requests[0].tools.some(t=>t.function.name==='python'));assert.equal(s.approvals.size,0);assert.equal(runs.length,0);assert.equal(reply(s).tools[0].status,'error');});
test('unsupported model tool capability disables all tool schemas',async t=>{const {s,requests}=await setup(t,async function*(){yield chunk({content:'Text'},'stop');});s.capabilities=[normalizeCapability({id:'fixture',toolCalling:false,chatConfig:{}})];await send(s);await done(s);assert.equal(requests[0].tools,undefined);});
test('disable visual tools is enforced at the service boundary',async t=>{const {s,requests}=await setup(t,async function*(){yield proposal('render_chart',spec);});s.workspace.threads[0].settings.visualTools=false;await send(s);await done(s);assert.equal(requests[0].tools,undefined);assert.equal(reply(s).status,'interrupted');});
test('model can read and revise its returned artifact ID on following tool rounds',async t=>{const {s,requests}=await setup(t,async function*(n,body){if(n===1)yield proposal('create_artifact',{kind:'text',title:'Draft',source:'one'},'c1');else if(n===2){const id=JSON.parse(body.messages.at(-1).content).artifacts[0].artifact_id;yield proposal('update_artifact',{artifact_id:id,source:'two'},'c2');}else if(n===3){const id=JSON.parse(body.messages.at(-1).content).artifacts[0].artifact_id;yield proposal('read_artifact',{artifact_id:id},'c3');}else yield chunk({content:'Revised'},'stop');});await send(s);await done(s);assert.equal(reply(s).tools[1].artifacts[0].version,2);const toolOutput=JSON.parse(requests[3].messages.at(-1).content);assert.equal(JSON.parse(toolOutput.stdout).source,'two');});
test('artifact scope excludes manual runs, other conversations and unselected comparison replies',async t=>{const {s}=await setup(t,async function*(){yield chunk({content:'x'},'stop');});await send(s);await done(s);const r=reply(s);r.tools=[{origin:'manual',artifacts:[{id:'manual'}]},{origin:'model',artifacts:[{id:'selected'}]}];s.workspace.threads[0].turns[0].replies.push({...r,id:'unselected',tools:[{origin:'model',artifacts:[{id:'other'}]}]});assert.deepEqual(s.visibleArtifacts(s.workspace.activeId,r).map(a=>a.id),['selected']);});
test('reasoning settings are not leaked from DeepSeek comparison into Kimi K3',async t=>{const {s,requests}=await setup(t,async function*(n,body){yield chunk({content:body.model},'stop');});Object.assign(s.workspace.threads[0].settings,{model:'deepseek-v4-pro',compare:true,compareModel:'kimi-k3',reasoningEffort:'max',compareReasoningEffort:'max'});await send(s);await done(s);assert.equal(requests.find(r=>r.model==='deepseek-v4-pro').reasoning_effort,'max');assert.ok(!('reasoning_effort' in requests.find(r=>r.model==='kimi-k3')));});
test('switching models resets reasoning overrides, not just the displayed control',async t=>{const {s}=await setup(t,async function*(){yield chunk({content:'x'},'stop');});const thread=s.workspace.threads[0];Object.assign(thread.settings,{model:'deepseek-v4-pro',reasoningEffort:'max'});await s.execute({type:'thread.settings',id:thread.id,settings:{...thread.settings,model:'kimi-k3'}});assert.equal(thread.settings.reasoningEffort,'default');});
test('a model-provided arbitrary tool name never reaches a native executor',async t=>{const {s,runs}=await setup(t,async function*(n){yield n===1?proposal('terminal',{command:'whoami'}):chunk({content:'No tool'},'stop');});await send(s);await done(s);assert.equal(runs.length,0);assert.equal(reply(s).tools[0].status,'error');});

test('two lanes of the same model preserve independent effort settings',async t=>{const {s,requests}=await setup(t,async function*(n,body){yield chunk({content:body.model},'stop');});Object.assign(s.workspace.threads[0].settings,{model:'deepseek-v4-pro',compare:true,compareModel:'deepseek-v4-pro',reasoningEffort:'high',compareReasoningEffort:'max'});await send(s);await done(s);assert.deepEqual(requests.map(r=>r.reasoning_effort).sort(),['high','max']);});

test('tool rounds retain narrated text and stable inline insertion offsets',async t=>{
 const {s,requests}=await setup(t,async function*(n){
  if(n===1){yield chunk({content:'Here is the chart.'});yield proposal('render_chart',spec);}
  else yield chunk({content:'The value increased.'},'stop');
 });await send(s);await done(s);const r=reply(s);
 assert.equal(r.content,'Here is the chart.\n\nThe value increased.');assert.equal(r.tools[0].contentOffset,'Here is the chart.'.length);
 assert.equal(requests[1].messages[1].content,'Here is the chart.');assert.equal(r.content.slice(r.finalContentOffset),'The value increased.');
});
test('subsequent conversation history does not duplicate preserved narration',async t=>{
 const {s,requests}=await setup(t,async function*(n){if(n===1){yield chunk({content:'Before tool.'});yield proposal('render_chart',spec);}else yield chunk({content:'After tool.'},'stop');});
 await send(s);await done(s);await s.execute({type:'send',id:s.workspace.activeId,text:'Continue',attachments:[]});await done(s);
 const history=requests[2].messages.filter(m=>m.role==='assistant').map(m=>m.content);assert.deepEqual(history,['Before tool.','After tool.']);
});
test('stream phase uses received reasoning or content, not model-name guessing',async t=>{
 const {s}=await setup(t,async function*(){yield chunk({reasoning_content:'Reasoning actually received.'});yield chunk({content:'Answer'},'stop');});
 const phases=[];s.onChange=snap=>{const r=snap.workspace.threads[0].turns[0]?.replies[0];if(r)phases.push(r.phase);};await send(s);await done(s);
 assert.equal(reply(s).phase,'answering');assert.ok(phases.includes('waiting'));assert.equal(reply(s).reasoning,'Reasoning actually received.');
});
