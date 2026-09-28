import { signedOutAccount } from '/core/account.js';
import { editReply,editPrompt } from '/core/editing.js';
import { createProject,renameProject,removeProject,moveThread,newProjectThread } from '/core/projects.js';
import { saveInstructionPreset,deleteInstructionPreset } from '/core/instructions.js';
import { chartSpec,chartSVG,tableSpec,tableHTML,diagramSpec,diagramSVG } from '/core/visual-tools.js';
import { viewPreferences } from '/core/preferences.js';
// Development preview only. This file is outside dist/desktop and is NOT packaged in the Windows application.
import {newWorkspace,findThread,addThread,beginTurn,chooseReply,forkThread} from '/core/workspace.js';
import {settings,attachments,InputError} from '/core/validation.js';
let previewAccount=signedOutAccount(),previewMode='api-key';
const workspace=newWorkspace(),listeners=new Set();let sequence=0,busy=null,stopped=false;
Object.assign(workspace.threads[0].settings,{model:'demo/writer',compareModel:'demo/analyst'});
const snapshot=()=>({sequence:++sequence,account:structuredClone(previewAccount),connectionMode:previewMode,workspace:structuredClone({version:workspace.version,activeId:workspace.activeId,threads:workspace.threads,projects:workspace.projects,instructionPresets:workspace.instructionPresets,view:workspace.view}),pythonConfigured:false,hasKey:false,models:['demo/writer','demo/analyst','deepseek-v4-pro','kimi-k3'],verification:{state:'idle',checkedAt:null,steps:[]},busyThreadId:busy,storage:'preview',notice:'OFFLINE PREVIEW · Synthetic responses · No API connection or local persistence'});
const emit=()=>{const s=snapshot();for(const fn of listeners)fn(s);};
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
async function simulate(thread,jobs){
  if (/tool activity demo/i.test(thread.turns.at(-1).prompt)) return activityShowcase(thread,jobs);
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
window.tinfoil=Object.freeze({
  snapshot:async()=>snapshot(),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
  command:async c=>{
    let extra;
    switch(c.type){
      case 'account.login':case 'account.cancel':case 'account.refresh':case 'account.manage':case 'account.signout':case 'thread.authorize-account':throw new InputError('Offline preview cannot sign in, accept account credentials, or modify a real profile. Use the desktop app.');
      case 'connection.mode':if(!['chat-account','api-key'].includes(c.mode))throw new InputError('Invalid mode.');previewMode=c.mode;break;
      case 'view.set':workspace.view=viewPreferences(c.view);break;
      case 'tool.cancel':case 'tool.approve':throw new InputError('Offline preview does not execute Python, contact MCP servers or run sub-agents. Use the desktop app.');
      case 'artifact.pdf':case 'artifact.open':case 'python.pick':case 'code.run':case 'artifact.save':throw new InputError('Offline preview does not execute Python or create files. Use the desktop app.');
      case 'open.url':throw new InputError('Offline preview does not open external links.');
      case 'thread.new':newProjectThread(workspace,c.projectId);break;
      case 'project.create':createProject(workspace,c.name);break;
      case 'project.rename':renameProject(workspace,c.id,c.name);break;
      case 'project.delete':removeProject(workspace,c.id);break;
      case 'thread.move':moveThread(workspace,c.id,c.projectId);break;
      case 'instructions.save':saveInstructionPreset(workspace,c.id??undefined,c.name,c.text);break;
      case 'instructions.delete':deleteInstructionPreset(workspace,c.id);break;
      case 'prompt.edit':if(c.id===busy)throw new InputError('Stop the response first.');editPrompt(workspace,c.id,c.turnId,c.content,c.expectedContent);break;
      case 'reply.edit':if(c.id===busy)throw new InputError('Stop the response first.');editReply(workspace,c.id,c);break;
      case 'thread.select':findThread(workspace,c.id);workspace.activeId=c.id;break;
      case 'thread.draft':{const t=findThread(workspace,c.id);t.draft=c.text;if(c.attachments!==undefined)t.draftAttachments=attachments(c.attachments);break;}
      case 'thread.settings':if(c.id===busy)throw new InputError('Stop the response first.');{const t=findThread(workspace,c.id),next=settings(c.settings);if(next.model!==t.settings.model){next.reasoningEffort='default';next.thinkingMode='default';}if(next.compareModel!==t.settings.compareModel){next.compareReasoningEffort='default';next.compareThinkingMode='default';}t.settings=next;}break;
      case 'thread.pin':{const t=findThread(workspace,c.id);t.pinned=!t.pinned;break;}
      case 'thread.rename':findThread(workspace,c.id).title=c.title;break;
      case 'thread.delete':if(c.id===busy)throw new InputError('Stop the response first.');workspace.threads=workspace.threads.filter(t=>t.id!==c.id);if(!workspace.threads.length)addThread(workspace);workspace.activeId=workspace.threads[0].id;break;
      case 'thread.fork':forkThread(workspace,c.id,c.turnId,c.before,c.replyId);break;
      case 'reply.select':chooseReply(findThread(workspace,c.id),c.turnId,c.replyId);break;
      case 'send':if(busy)throw new InputError('A response is already running.');{const t=findThread(workspace,c.id),jobs=beginTurn(t,c.text,attachments(c.attachments));busy=t.id;stopped=false;void simulate(t,jobs);break;}
      case 'stop':stopped=true;break;
      case 'attachments.pick':extra=[{name:'outline.md',content:'A fictional scene outline. Preview-only attachment.'}];break;
      case 'clipboard':await navigator.clipboard.writeText(c.text);break;
      case 'credentials.set':case 'credentials.clear':case 'connect':throw new InputError('Preview mode cannot accept API keys or contact Tinfoil. Use the desktop app.');
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
