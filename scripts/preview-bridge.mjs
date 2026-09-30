import { signedOutAccount } from '/core/account.js';
import { editReply } from '/core/editing.js';
import { showVersion } from '/core/versions.js';
import { createProject,renameProject,removeProject,moveThread,newProjectThread } from '/core/projects.js';
import { saveInstructionPreset,deleteInstructionPreset } from '/core/instructions.js';
import { chartSpec,chartSVG,tableSpec,tableHTML,diagramSpec,diagramSVG } from '/core/visual-tools.js';
import { viewPreferences } from '/core/preferences.js';
// Development preview only. This file is outside dist/desktop and is NOT packaged in the Windows application.
import {newWorkspace,findThread,addThread,beginTurn,retryTurn,addMessage,chooseReply,forkThread} from '/core/workspace.js';
import {settings,attachments,InputError} from '/core/validation.js';
import {agentFolderName} from '/core/agent.js';
// The workspace agent's root for new folders: synthetic, like every preview path; set by the Choose… button in Advanced.
let previewAgentRoot=null;
// Synthetic interpreters for Advanced → Model-requested Python; nothing is searched or run.
const previewPythons=[{path:'C:\\Preview\\Python313\\python.exe',version:'3.13.2',onPath:true},{path:'C:\\Preview\\Python311\\python.exe',version:'3.11.9'}];
let previewPython={current:null,found:null,searching:false};
let previewAccount=signedOutAccount(),previewMode='api-key',previewRemember=true;
// Cloud sync is shown with synthetic state only; the preview never connects to Tinfoil cloud.
let previewCloud={state:'off',keyId:null,user:null,lastSyncAt:null,message:null,chats:0,projects:0,older:0},previewLoading=[];
const workspace=newWorkspace(),listeners=new Set();let sequence=0,busy=null,stopped=false;
Object.assign(workspace.threads[0].settings,{model:'demo/writer',compareModel:'demo/analyst'});
/** The chat background picture set in this page (`background.set`). */
let previewBackground=null;
const snapshot=()=>({sequence:++sequence,background:previewBackground?.id??null,account:structuredClone(previewAccount),connectionMode:previewMode,rememberAccount:previewRemember,cloud:structuredClone(previewCloud),cloudLoading:[...previewLoading],workspace:structuredClone({version:workspace.version,activeId:workspace.activeId,threads:workspace.threads,projects:workspace.projects,instructionPresets:workspace.instructionPresets,view:workspace.view}),pythonConfigured:!!previewPython.current,python:structuredClone(previewPython),agent:{available:true,gitBash:true,root:previewAgentRoot},hasKey:false,models:['demo/writer','demo/analyst','deepseek-v4-pro','kimi-k3'],capabilities:structuredClone(previewCatalog),modelCatalog:'ready',verification:{state:'idle',checkedAt:null,steps:[]},busyThreadId:busy,storage:'preview',notice:'OFFLINE PREVIEW · Synthetic responses · No API connection or local persistence'});
const emit=()=>{const s=snapshot();for(const fn of listeners)fn(s);};
// Synthetic picker metadata. Display-only (`known: false`), so the bundled reasoning profiles still apply.
function previewModel(id,display){return {id,label:display.name,known:false,source:'unknown',reasoning:false,effort:[],toggle:false,defaultEnabled:true,enable:{},disable:{},toolCalling:null,
  display:{short:'',maker:'',type:'chat',contextWindow:null,multimodal:false,reasoning:false,tools:false,experimental:false,description:'Synthetic offline preview entry.',...display}};}
const previewCatalog=[previewModel('deepseek-v4-pro',{name:'DeepSeek V4 Pro',maker:'deepseek',contextWindow:1048576,reasoning:true,tools:true,
    description:'Synthetic preview entry with a longer description, as Tinfoil’s catalog gives for its models. The picker shows two lines and the rest in the row’s tooltip.'}),
  previewModel('kimi-k3',{name:'Kimi K3',maker:'moonshot',contextWindow:262144,multimodal:true,reasoning:true,tools:true,description:'Synthetic preview entry for a multimodal reasoning model.'}),
  previewModel('demo/writer',{name:'Demo Writer',contextWindow:131072}),previewModel('demo/analyst',{name:'Demo Analyst',contextWindow:131072,experimental:true})];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function encodeArtifact(value){const bytes=new TextEncoder().encode(value);let str='';for(const b of bytes)str+=String.fromCharCode(b);return btoa(str);}
function previewTool(kind,source,data,title,offset,mime='image/svg+xml'){
  const id=crypto.randomUUID();return{id:crypto.randomUUID(),callId:crypto.randomUUID(),name:kind==='html'?'create_artifact':'render_'+kind,arguments:'{}',origin:'model',contentOffset:offset,status:'complete',stdout:'Synthetic preview only. No provider request was made.',stderr:'',exitCode:0,elapsedMs:0,truncated:false,artifacts:[{id,rootId:id,version:1,name:title+(kind==='html'?'.html':'.svg'),mime,data:encodeArtifact(data),source,kind,title,description:'Synthetic preview data · not a measured benchmark.'}]};
}
async function showcase(thread,jobs){
  await Promise.all(jobs.map(async(job)=>{
    const reply=thread.turns.find(t=>t.id===job.turnId).replies.find(r=>r.id===job.replyId);
    reply.status='streaming';reply.phase='thinking';reply.reasoning='';
    const reasoning='Synthetic reasoning demonstration. Compare the two supplied series on the same scale, then place the chart beside the explanation it supports. Keep the raw values accessible and avoid treating these samples as a benchmark.';
    for(let n=0;n<reasoning.length&&!stopped;n+=22){reply.reasoning=reasoning.slice(0,n+22);emit();await pause(80);}
    async function write(text){reply.phase='answering';for(let n=0;n<text.length&&!stopped;n+=18){reply.content+=text.slice(n,n+18);emit();await pause(45);}}
    await write('The revised configuration is faster in each of these six sample runs. Here is the comparison on a shared scale.\n\n');
    if(!stopped){
      const spec=chartSpec({title:'Response time',description:'Synthetic preview data · lower is faster.',type:'area',labels:['Run 1','Run 2','Run 3','Run 4','Run 5','Run 6'],y_label:'Milliseconds',series:[{name:'Baseline',values:[48,62,56,79,70,94]},{name:'Revised',values:[36,43,39,51,48,61]}]});
      reply.status='executing';emit();await pause(280);
      reply.tools=[previewTool('chart',JSON.stringify(spec),chartSVG(spec),'Response time',reply.content.length)];reply.status='streaming';emit();await pause(150);
      await write('The largest gap is in run 6: **94 ms versus 61 ms**. Select **Data** to inspect the values, or use the expand control to keep the chart open alongside the conversation.\n\n');
    }
    if(!stopped){
      const html='<style>body{font-family:system-ui;background:transparent;color:#d4d4d4;margin:0;padding:8px 0}h1{font-size:18px;font-weight:500}p,label{color:#a6a6a6;font-size:13px}input{width:100%;accent-color:#75b9ff}output{display:block;font-size:38px;color:#75b9ff;margin:16px 0;font-variant-numeric:tabular-nums}</style><h1>Explore the difference</h1><p>Adjust an illustrative response-time reduction.</p><label>Reduction <input id="buffer" type="range" min="0" max="60" value="35"></label><output id="result">61 ms</output><p>Self-contained HTML · illustrative values</p><script>const input=document.getElementById("buffer");input.addEventListener("input",()=>{document.getElementById("result").textContent=Math.round(94*(1-Number(input.value)/100))+" ms";});</script>';
      reply.tools.push(previewTool('html',html,html,'Interactive comparison',reply.content.length,'text/html'));emit();
      await write('The calculator is static until you enable interaction. This is a **synthetic preview response**, not a model completion.');
    }
    reply.status=stopped?'stopped':'complete';reply.phase='answering';reply.finishReason=stopped?null:'stop';reply.error=stopped?'Stopped. Partial output was preserved.':null;
  }));busy=null;emit();
}
async function activityShowcase(thread,jobs){
  await Promise.all(jobs.map(async job=>{
    const reply=thread.turns.find(t=>t.id===job.turnId).replies.find(r=>r.id===job.replyId);
    const make=(name,origin='model')=>({id:crypto.randomUUID(),callId:crypto.randomUUID(),name,arguments:'{}',origin,status:'queued',stdout:'',stderr:'',exitCode:null,elapsedMs:0,artifacts:[],truncated:false});
    reply.status='streaming';reply.phase='thinking';reply.reasoning='Synthetic demonstration: show the provenance of each action, keep the complete batch visible while queued, then retain only a compact summary.';
    reply.content='This is a **synthetic activity demonstration**. No server, MCP connection, or sub-agent has been contacted.\n\n';
    const search=make('Web search','provider');search.status='running';search.arguments=JSON.stringify({type:'search',query:'Tinfoil tool events'});search.provider={itemId:'preview-search',round:0,family:'web_search',sources:[]};reply.tools.push(search);emit();await pause(900);
    if(!stopped){search.status='complete';search.provider.sources=[{url:'https://github.com/tinfoilsh/confidential-model-router',title:'Tinfoil model router · example source'}];}
    const spec=chartSpec({title:'Batch progress',description:'Illustrative values, not measured performance.',type:'bar',labels:['Completed','Remaining'],series:[{name:'Actions',values:[3,0]}]});
    const batch=crypto.randomUUID(),a=previewTool('chart',JSON.stringify(spec),chartSVG(spec),'Batch progress',reply.content.length),b=make('render_table'),c=make('read_artifact');
    b.arguments=JSON.stringify({title:'Task summary',columns:['Action','Status'],rows:[['Chart','Complete'],['Table','Complete']]});c.arguments=JSON.stringify({artifact_id:a.artifacts[0].id});
    const runs=[a,b,c];runs.forEach((t,i)=>{t.batchId=batch;t.batchIndex=i;t.batchSize=3;t.status='queued';});
    const artifacts=a.artifacts;a.artifacts=[];
    if(!stopped){reply.tools.push(...runs);reply.status='executing';emit();}
    for(const t of runs){if(stopped)break;t.status='running';emit();await pause(850);t.status='complete';t.stdout='Synthetic completed result.';t.exitCode=0;if(t===a)t.artifacts=artifacts;emit();}
    if(!stopped){
      const child=make('delegate_task');child.status='running';child.arguments=JSON.stringify({task:'Review the sample data and state one limitation.'});
      child.delegate={model:job.model,task:'Review the sample data and state one limitation.',content:'',reasoning:'This is an illustrative reasoning fixture, not model-generated analysis.',phase:'thinking',usage:null};reply.tools.push(child);emit();await pause(900);
      const answer='The values illustrate **UI state**, not inference performance. A real comparison needs repeated measurements on the same workload.';
      child.delegate.phase='answering';for(let n=0;n<answer.length&&!stopped;n+=18){child.delegate.content+=answer.slice(n,n+18);emit();await pause(90);}
      child.status=stopped?'cancelled':'complete';child.stdout=child.delegate.content;child.delegate.usage={input:46,output:31};child.elapsedMs=1900;
      if(!stopped)reply.content+='The batch contains three separate tool results. Open its summary to inspect each action. Provider MCP calls and client sub-agents have distinct provenance labels; delegation is never enabled automatically.';
    }
    for(const t of reply.tools)if(['queued','running'].includes(t.status))t.status='cancelled';
    reply.status=stopped?'stopped':'complete';reply.phase='answering';reply.finishReason=stopped?null:'stop';reply.error=stopped?'Stopped synthetic demonstration.':null;
  }));busy=null;emit();
}
/** Synthetic workspace agent calls in each state, for the renderer: nothing is read, changed or run. */
async function agentShowcase(thread,jobs){
  await Promise.all(jobs.map(async job=>{
    const reply=thread.turns.find(t=>t.id===job.turnId).replies.find(r=>r.id===job.replyId),folder=thread.agentFolder??'C:\\Preview\\example-project';
    const call=(name,args,patch={})=>({id:crypto.randomUUID(),callId:crypto.randomUUID(),name,arguments:JSON.stringify(args),origin:'model',status:'complete',stdout:'',stderr:'',exitCode:null,elapsedMs:40,artifacts:[],truncated:false,agent:{folder},...patch});
    reply.content='This is a **synthetic workspace agent demonstration**. Nothing was read, changed or run.\n\n';reply.reasoning='Synthetic reasoning: find the failing test before changing anything.';reply.status='streaming';emit();await pause(200);
    const diff='--- a/src/sum.js\n+++ b/src/sum.js\n@@ -1,3 +1,3 @@\n export function sum(values) {\n-  return values.reduce((a, b) => a + b);\n+  return values.reduce((a, b) => a + b, 0);\n }\n';
    // One call at a time, so the activity row can be seen rolling from each call to the next.
    for (const tool of [
      call('update_plan',{steps:[{text:'Find the failing test',status:'completed'},{text:'Fix the sum of an empty list',status:'in_progress'},{text:'Run the tests',status:'pending'}]},{stdout:'[x] Find the failing test\n[>] Fix the sum of an empty list\n[ ] Run the tests'}),
      call('list_files',{path:'.',depth:2},{stdout:'src/\nsrc/sum.js\ntest/\ntest/sum.test.js\npackage.json'}),
      call('read_file',{path:'src/sum.js'},{stdout:'src/sum.js · lines 1–3 of 3\n1\texport function sum(values) {\n2\t  return values.reduce((a, b) => a + b);\n3\t}\n'}),
      call('run_command',{command:'[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\nnpm test',timeout_seconds:120},{agent:{folder,shell:'powershell'},stdout:'✖ sum of an empty list is 0\n  TypeError: Reduce of empty array with no initial value',exitCode:1,elapsedMs:1800})]) {
      reply.tools.push({...tool,status:'running'});reply.status='executing';emit();await pause(tool.name==='run_command'?900:450);
      Object.assign(reply.tools.at(-1),{status:'complete'});reply.status='streaming';emit();await pause(250);
    }
    reply.tools.push(
      call('edit_file',{path:'src/sum.js',old_text:'a + b);',new_text:'a + b, 0);'},{status:'awaiting_approval',agent:{folder,diff}}),
      call('run_command',{command:"Get-Content -LiteralPath 'C:\\Users\\Preview\\Downloads\\notes.md'",workdir:'.',timeout_seconds:120},{status:'awaiting_approval',agent:{folder,shell:'powershell'}}));
    reply.toolMessages.push({role:'assistant',content:'',tool_calls:[]},{role:'assistant',content:'',tool_calls:[]});
    reply.status='awaiting_approval';emit();
  }));busy=null;emit();
}
async function simulate(thread,jobs){
  if (/tool activity demo/i.test(thread.turns.at(-1).prompt)) return activityShowcase(thread,jobs);
  if (/workspace agent demo/i.test(thread.turns.at(-1).prompt)) return agentShowcase(thread,jobs);
  if (/inline visualization demo/i.test(thread.turns.at(-1).prompt)) return showcase(thread,jobs);
  const answers=[
    'The estimate is **about 3 minutes per repair**. The average alone is not enough to set a safe deadline; travel and failed attempts still need room.\n\nFor three equally weighted observations, the mean is:\n\n$$\\bar{x}=\\frac{1}{n}\\sum_{i=1}^{n}x_i=\\frac{142+180+218}{3}=180\\;\\text{s}$$\n\n| Measure | Result |\n| :--- | ---: |\n| Mean repair time | 180 s |\n| Sample standard deviation | 38 s |\n| Suggested initial buffer | 20% |\n\nThe following code makes the calculation reproducible:\n\n```python\nfrom statistics import mean, stdev\n\nrepairs = [142, 180, 218]\nprint(f"Mean: {mean(repairs):.0f} s")\nprint(f"Standard deviation: {stdev(repairs):.0f} s")\n```\n\nUse $t = 1.2 \\times 180 = 216$ seconds as an **illustrative starting point**, then check it against observed completion rates.\n\nThis is a synthetic preview response, not a model completion.',
    'A deadline should account for the tail, not just the mean. With only three observations, treat the result as a starting estimate rather than a measured service guarantee.\n\n$$T = T_{\\text{travel}} + \\sum_{i=1}^{n} T_i + T_{\\text{buffer}}$$\n\n```json\n{\n  "observations": [142, 180, 218],\n  "mean_seconds": 180,\n  "buffer_fraction": 0.2\n}\n```\n\nThis is a synthetic preview response, not a model completion.'
  ];
  await Promise.all(jobs.map(async(job,i)=>{
    const r=thread.turns.find(t=>t.id===job.turnId).replies.find(r=>r.id===job.replyId),content=answers[i%answers.length];
    r.status='streaming';r.phase='thinking';r.reasoning='Synthetic reasoning demonstration. Separate the arithmetic from the scheduling assumption. Compute the sample mean and standard deviation, then label the proposed buffer as an illustration rather than an observed result.';
    emit();await pause(360);r.phase='answering';
    for(let n=0;n<content.length&&!stopped;n+=55){r.content=content.slice(0,n+55);r.elapsedMs=(n+55)*3;emit();await pause(32);}

    if(!stopped&&i===0){
      const spec=chartSpec({title:'Repair duration',description:'Synthetic demonstration data · three observations, not a server measurement.',type:'bar',labels:['Round 1','Round 2','Round 3'],y_label:'Seconds',series:[{name:'Observed sample',values:[142,180,218]},{name:'Mean + 20% buffer',values:[216,216,216]}]});
      const table=tableSpec({title:'Sample observations',description:'Synthetic preview data',columns:['Round','Repair seconds','Budget seconds'],rows:[[1,142,216],[2,180,216],[3,218,216]]});
      const diagram=diagramSpec({title:'Response workflow',description:'Illustrative flow, not evidence of provider behavior.',nodes:[{id:'request',label:'Model request',column:0,row:0},{id:'tool',label:'Visualization tool',column:1,row:1},{id:'artifact',label:'Versioned artifact',column:2,row:2}],edges:[{from:'request',to:'tool',label:'Structured arguments'},{from:'tool',to:'artifact',label:'Artifact ID returned'}]});
      const html='<style>body{font-family:system-ui;background:transparent;color:#d4d4d4;margin:0;padding:8px 0}h1{font-size:21px}input{width:100%;accent-color:#75b9ff}output{display:block;font-size:42px;color:#75b9ff;margin:18px 0}</style><h1>Repair budget calculator</h1><p>Adjust a hypothetical buffer around the 180-second sample mean.</p><label>Buffer <input id="buffer" type="range" min="0" max="60" value="20"></label><output id="result">216 seconds</output><p>Browser-only illustration. No network requests or native Python execution.</p><script>const input=document.getElementById("buffer");input.addEventListener("input",()=>{document.getElementById("result").textContent=Math.round(180*(1+Number(input.value)/100))+" seconds";});</script>';
      const encode=value=>{const bytes=new TextEncoder().encode(value);let str='';for(const b of bytes)str+=String.fromCharCode(b);return btoa(str);};
      const samples=[['chart','image/svg+xml','svg',JSON.stringify(spec),chartSVG(spec),'Repair duration'],['table','text/html','html',JSON.stringify(table),tableHTML(table),'Sample observations'],['diagram','image/svg+xml','svg',JSON.stringify(diagram),diagramSVG(diagram),'Response workflow'],['html','text/html','html',html,html,'Buffer calculator']];
      r.tools=samples.map(([kind,mime,ext,source,data,title],j)=>{const id=crypto.randomUUID();return{id:crypto.randomUUID(),callId:'preview_'+j,name:kind==='html'?'create_artifact':'render_'+kind,arguments:JSON.stringify({kind,title,source}),origin:'model',status:'complete',stdout:'Synthetic artifact fixture. No model request was made.',stderr:'',exitCode:0,elapsedMs:0,truncated:false,artifacts:[{id,rootId:id,version:1,name:title+'.'+ext,mime,data:encode(data),source,kind,title,description:'Synthetic preview fixture; generated locally from fixed sample data.'}]};});
    }
    r.status=stopped?'stopped':'complete';r.finishReason=stopped?null:'stop';r.error=stopped?'Stopped. Partial output was preserved.':null;r.usage={input:84,output:Math.ceil(r.content.length/4)};
  }));busy=null;emit();
}
/** Pictures stored by `image.add`, kept only for this page's life. */
const previewImages=new Map();
window.tinfoil=Object.freeze({
  snapshot:async()=>snapshot(),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
  // Synthetic folders: an extensionless, typeless file stands for a dropped folder (the app asks its host).
  folderFor:async file=>!file.type&&!/\.[A-Za-z0-9]+$/.test(file.name)?{path:'D:\\Preview\\'+file.name,name:file.name}:null,
  command:async c=>{
    let extra;
    switch(c.type){
      case 'account.login':case 'account.cancel':case 'account.refresh':case 'account.manage':case 'account.signout':case 'thread.authorize-account':throw new InputError('Offline preview cannot sign in, accept account credentials, or modify a real profile. Use the desktop app.');
      case 'connection.mode':if(!['chat-account','api-key'].includes(c.mode))throw new InputError('Invalid mode.');previewMode=c.mode;break;
      case 'account.remember':previewRemember=c.enabled===true;break;
      case 'cloud.connect':case 'cloud.key.file':case 'cloud.sync':case 'cloud.disconnect':case 'thread.cloud.upload':throw new InputError('Offline preview cannot connect to Tinfoil cloud.');
      case 'view.set':workspace.view=viewPreferences(c.view);break;
      case 'tool.cancel':case 'tool.approve':throw new InputError('Offline preview does not execute Python, run commands, change files, contact MCP servers or run sub-agents. Use the desktop app.');
      // No folder picker here: a synthetic path stands in, and nothing is read from it.
      case 'agent.folder':if(c.id===busy)throw new InputError('Stop the response first.');findThread(workspace,c.id).agentFolder='C:\\Preview\\example-project';break;
      case 'agent.folder.clear':delete findThread(workspace,c.id).agentFolder;break;
      case 'agent.approval':{const t=findThread(workspace,c.id);if(c.level==='ask')delete t.settings.agentApproval;else t.settings.agentApproval=c.level;break;}
      case 'agent.root':previewAgentRoot='C:\\Preview\\Tinfoil';break;
      case 'python.find':previewPython.found=structuredClone(previewPythons);if(!previewPython.current)previewPython.current=structuredClone(previewPythons[0]);break;
      case 'python.use':{const found=previewPython.found?.find(p=>p.path===c.path);if(!found)throw new InputError('Choose one of the Python interpreters Workbench found, or choose python.exe yourself.');previewPython.current=structuredClone(found);break;}
      case 'artifact.pdf':case 'artifact.open':case 'python.pick':case 'code.run':case 'artifact.save':throw new InputError('Offline preview does not execute Python or create files. Use the desktop app.');
      case 'open.url':throw new InputError('Offline preview does not open external links.');
      case 'thread.new':{const t=newProjectThread(workspace,c.projectId);if(c.cloud===true&&previewCloud.state!=='off'&&t.projectId==null)t.cloudPending=true;break;}
      case 'project.create':createProject(workspace,c.name);break;
      case 'project.rename':renameProject(workspace,c.id,c.name);break;
      case 'project.delete':removeProject(workspace,c.id);break;
      case 'thread.move':moveThread(workspace,c.id,c.projectId);break;
      case 'instructions.save':saveInstructionPreset(workspace,c.id??undefined,c.name,c.text);break;
      case 'instructions.delete':deleteInstructionPreset(workspace,c.id);break;
      case 'turn.version':if(c.id===busy)throw new InputError('Stop the response first.');showVersion(findThread(workspace,c.id),c.turnId,c.version);break;
      case 'turn.add':if(c.id===busy)throw new InputError('Stop the response first.');if(findThread(workspace,c.id).cloudPending)throw new InputError('Tinfoil cloud chats have no place for messages added in another role. Keep this conversation on this device to add them.');addMessage(findThread(workspace,c.id),c.role,c.text,c.replace);break;
      case 'reply.edit':if(c.id===busy)throw new InputError('Stop the response first.');editReply(workspace,c.id,c);break;
      case 'thread.select':findThread(workspace,c.id);workspace.activeId=c.id;break;
      case 'thread.draft':{const t=findThread(workspace,c.id);t.draft=c.text;if(c.attachments!==undefined)t.draftAttachments=attachments(c.attachments);break;}
      case 'thread.settings':if(c.id===busy)throw new InputError('Stop the response first.');{const t=findThread(workspace,c.id),next=settings(c.settings);if(next.model!==t.settings.model){next.reasoningEffort='default';next.thinkingMode='default';}if(next.compareModel!==t.settings.compareModel){next.compareReasoningEffort='default';next.compareThinkingMode='default';}t.settings=next;}break;
      case 'thread.pin':{const t=findThread(workspace,c.id);t.pinned=!t.pinned;break;}
      case 'thread.rename':findThread(workspace,c.id).title=c.title;break;
      case 'thread.delete':if(c.id===busy)throw new InputError('Stop the response first.');workspace.threads=workspace.threads.filter(t=>t.id!==c.id);if(!workspace.threads.length)addThread(workspace);workspace.activeId=workspace.threads[0].id;break;
      case 'thread.fork':forkThread(workspace,c.id,c.turnId,c.before,c.replyId);break;
      case 'reply.select':chooseReply(findThread(workspace,c.id),c.turnId,c.replyId);break;
      case 'send':case 'turn.retry':if(busy)throw new InputError('A response is already running.');{const t=findThread(workspace,c.id);
        // As in the app, a conversation without a folder gets a new one under the root; nothing is created here.
        if(t.settings.agentMode==='ask'&&!t.agentFolder){if(!previewAgentRoot)throw new InputError('Choose where the workspace agent keeps new work (Advanced → Workspace agent), or choose a project folder there.');t.agentFolder=previewAgentRoot+'\\'+agentFolderName(t.turns.length?t.title:c.text??'',new Date(),t.id);}
        const jobs=c.type==='send'?beginTurn(t,c.text,attachments(c.attachments),'',c.replace):retryTurn(t,c.turnId);busy=t.id;stopped=false;void simulate(t,jobs);break;}
      case 'stop':stopped=true;break;
      case 'attachments.pick':extra=[{name:'outline.md',content:'A fictional scene outline. Preview-only attachment.'}];break;
      case 'image.add':previewImages.set(c.id,{mime:c.mime,data:c.data});break;
      // A drawn landscape stands in for a picked picture; the stored one lives only in this page.
      case 'background.pick':{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=400;const g=canvas.getContext('2d');const sky=g.createLinearGradient(0,0,0,400);sky.addColorStop(0,'#3a6ea5');sky.addColorStop(1,'#f0b27a');g.fillStyle=sky;g.fillRect(0,0,640,400);g.fillStyle='#2e4a3a';g.beginPath();g.moveTo(0,400);g.lineTo(180,220);g.lineTo(330,330);g.lineTo(470,180);g.lineTo(640,400);g.fill();return {snapshot:snapshot(),files:[{name:'preview-landscape.png',mime:'image/png',data:canvas.toDataURL('image/png').split(',')[1]}]};}
      case 'background.set':previewBackground={id:crypto.randomUUID(),url:`data:${c.mime};base64,${c.data}`};break;
      case 'background.clear':previewBackground=null;break;
      case 'background.get':return {snapshot:snapshot(),picture:previewBackground?.url??null};
      case 'clipboard':await navigator.clipboard.writeText(c.text);break;
      case 'credentials.set':case 'credentials.clear':case 'connect':throw new InputError('Preview mode cannot accept API keys or contact Tinfoil. Use the desktop app.');
      case 'models.catalog':break;
      case 'export':case 'import':throw new InputError('Native import and export are available in the desktop app, not this browser preview.');
      case 'window':break;
      case 'open.docs':throw new InputError('Preview mode does not open external links.');
      default:throw new InputError('Unsupported preview action.');
    }
    emit();return {snapshot:snapshot(),attachments:extra};
  }
});

window.addEventListener('workbench-preview-account',()=>{
  previewAccount=previewAccount.profile?signedOutAccount():{status:'signed-in',profile:{id:'user_sample',name:'Sample Account',email:'sample@example.invalid',emailVerified:true,subscriptionStatus:'active',subscriptionExpiresAt:null},entitlement:'active',usage:{maxRequests:null,remaining:null,resetsAt:Date.now()+1800000,inputTokens:{max:100000,used:24000,remaining:76000},outputTokens:{max:20000,used:6000,remaining:14000}},checkedAt:Date.now(),tokenExpiresAt:Date.now()+300000,message:'Illustrative profile and usage values. This is not your account.'};
  previewMode='chat-account';emit();
});
