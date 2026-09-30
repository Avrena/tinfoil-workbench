import type { Reply, ToolRun } from '../core/types.js';
import { activityGroups, batchSummary } from '../core/activity.js';
import { escapeHtml as e } from '../core/markdown.js';
import type { ViewPreferences } from '../core/preferences.js';
import { RichTextRenderer } from './rich-text.js';
import { updateMarkup } from './dom.js';
import { AGENT_SHELLS, AGENT_TOOL_NAMES, diffCounts, outsidePaths } from '../core/agent.js';

const AGENT_LABELS:Record<string,string>={list_files:'List files',search_files:'Search files',read_file:'Read file',edit_file:'Edit file',write_file:'Write file',run_command:'Command',update_plan:'Plan'};
const agentTool=(tool:ToolRun):boolean=>AGENT_TOOL_NAMES.has(tool.name)&&tool.origin==='model';
function parsed(tool:ToolRun):Record<string,unknown> {
  try{const value:unknown=JSON.parse(tool.arguments);return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}catch{return {};}
}
const str=(value:unknown):string=>typeof value==='string'?value:'';
/** What an agent call is about, for its header: the path, the pattern, or the command's first line. */
function agentSubject(tool:ToolRun):string {
  const a=parsed(tool);
  if(tool.name==='run_command'){const line=str(a.command).trim().split('\n')[0]??'';return line.length>80?line.slice(0,80)+'…':line;}
  if(tool.name==='search_files')return str(a.pattern);
  return tool.name==='update_plan'?'':str(a.path)||'.';
}
/** A diff as coloured lines: added, removed, context and hunk headers (the two file header lines are left out). */
function diffMarkup(diff:string):string {
  const rows=diff.split('\n').slice(2);if(rows.at(-1)==='')rows.pop();
  const {added,removed}=diffCounts(diff);
  return `<p class="agent-where">${added} ${added===1?'line':'lines'} added, ${removed} removed</p><pre class="agent-diff" aria-label="Change">${rows.map(row=>`<span class="${row.startsWith('@@')?'hunk':row.startsWith('+')?'add':row.startsWith('-')?'del':'ctx'}">${e(row)||' '}</span>`).join('')}</pre>`;
}
function planMarkup(a:Record<string,unknown>):string {
  const steps=Array.isArray(a.steps)?a.steps as Array<Record<string,unknown>>:[];
  return `<ol class="agent-plan">${steps.map(step=>{const status=str(step?.status);return `<li data-status="${e(status)}"><span class="plan-mark" aria-hidden="true">${status==='completed'?'✓':status==='in_progress'?'›':'·'}</span><span>${e(str(step?.text))}</span><span class="sr-only"> (${e(status.replace('_',' '))})</span></li>`;}).join('')}</ol>`;
}
/** The body of a workspace agent call: the command and where it runs, the change as a diff, or the plan; then output. */
function agentBody(tool:ToolRun,view:ViewPreferences):string {
  const a=parsed(tool),shell=tool.agent?.shell?AGENT_SHELLS[tool.agent.shell]:'';
  let head='';
  if(tool.name==='run_command'){
    const workdir=str(a.workdir),outside=tool.agent?.folder?outsidePaths(str(a.command),tool.agent.folder,workdir&&workdir!=='.'?workdir.replaceAll('\\','/'):'.'):[];
    head=`<pre class="agent-command"><code>${e(str(a.command))}</code></pre><p class="agent-where">${e([workdir&&workdir!=='.'?`In ${workdir}`:'In the folder',tool.agent?.folder??'',shell,typeof a.timeout_seconds==='number'?`stops after ${a.timeout_seconds} s`:''].filter(Boolean).join(' · '))}</p>`+
      (outside.length?`<p class="agent-outside">Outside the folder: this command names ${outside.map(path=>`<code>${e(path)}</code>`).join(', ')}.</p>`:'');
  } else if(tool.agent?.diff) head=diffMarkup(tool.agent.diff);
  else if(tool.name==='update_plan') head=planMarkup(a);
  else if(tool.name==='read_file'&&typeof a.start_line==='number') head=`<p class="agent-where">From line ${a.start_line}</p>`;
  const output=tool.name==='update_plan'||!tool.stdout?'':`<pre class="tool-stdout" aria-label="${tool.name==='run_command'?'Standard output':'Result'}">${e(tool.stdout)}</pre>`;
  return head+output+(tool.stderr?`<pre class="tool-stderr" aria-label="${tool.name==='run_command'?'Standard error':'Error'}">${e(tool.stderr)}</pre>`:'')+
    (tool.truncated?'<p class="tool-metadata">Output shortened.</p>':'')+
    (view.metadata||tool.name==='run_command'?`<div class="tool-metadata">${[view.metadata?(tool.elapsedMs/1000).toFixed(1)+'s':'',tool.exitCode!==null?'exit '+tool.exitCode:''].filter(Boolean).join(' · ')}</div>`:'');
}
const provenance=(tool:ToolRun):string=>agentTool(tool)?`Workspace agent${tool.agent?.shell?' · '+AGENT_SHELLS[tool.agent.shell]:''}`:tool.origin==='provider'?'Tinfoil-managed MCP':tool.origin==='text'?'Written as text by the model; drawn by Workbench':tool.name==='delegate_task'?'Client sub-agent':tool.name==='python'?'Local Python':'Client tool';
const label=(tool:ToolRun):string=>tool.name==='delegate_task'?'Delegated analysis':agentTool(tool)?AGENT_LABELS[tool.name]??tool.name:tool.name;
function entry(tool:ToolRun,nested=false):string {
  const pending=tool.status==='awaiting_approval',delegated=tool.name==='delegate_task',running=tool.status==='running',agent=agentTool(tool),subject=agent?agentSubject(tool):'';
  const warning=agent?(tool.name==='run_command'?'This command runs on your computer with your Windows account’s permissions, not in a sandbox. Read it before you run it.':'This change is written to the file shown when you approve it.'):delegated?'One extra model request using the task below. The same model is used, with no tools or access to the rest of this conversation. Additional inference usage applies.':'This Python runs on your computer, not in a sandbox. It can access files and the network.';
  const approve=agent?(tool.name==='run_command'?'Review & run once…':tool.name==='write_file'?'Review & write…':'Review & apply…'):delegated?'Run one delegated request':'Review & run once…';
  const body=`<div class="activity-detail-body" data-key="detail-${e(tool.id)}" data-activity-body="${e(tool.id)}" data-rich-host></div>`;
  const heading=(meta:string)=>`<i class="activity-state ${tool.status}" aria-hidden="true"></i><strong>${e(label(tool))}</strong>${subject?`<code class="agent-subject" title="${e(subject)}">${e(subject)}</code>`:''}${meta?`<span>${meta}</span>`:''}`;
  const meta=`${e(tool.status.replaceAll('_',' '))} · ${provenance(tool)}${tool.origin==='manual'?' · manual':''}`;
  // In the opened activity row a call is one line that opens its own details. An agent call names only what is unusual
  // about it (the row already says it is the workspace agent's); its shell and folder are in the details.
  if(nested&&!pending&&!(running&&delegated)){
    const brief=agent?[tool.status==='complete'?'':e(tool.status.replaceAll('_',' ')),tool.name==='run_command'&&tool.exitCode?`exit ${tool.exitCode}`:''].filter(Boolean).join(' · '):meta;
    return `<section data-key="tool-${e(tool.id)}" class="tool-run compact" data-tool-id="${e(tool.id)}" data-state="${tool.status}"><details class="activity-item-details" data-disclosure="item-${e(tool.id)}"><summary class="tool-run-header">${heading(brief)}</summary>${body}</details></section>`;
  }
  return `<section data-key="tool-${e(tool.id)}" class="tool-run ${pending?'approval-required':''}" data-tool-id="${e(tool.id)}" data-state="${tool.status}">
    <div class="tool-run-header">${heading(meta)}</div>
    ${pending?`<p class="approval-warning">${warning}</p>`:''}
    ${!pending&&(nested||(running&&(delegated||tool.provider||agent)))?`<details class="activity-item-details" data-disclosure="item-${e(tool.id)}"><summary>${delegated?'Task & live response':tool.provider?'Provider details':agent?'Details':'Arguments & result'}</summary>${body}</details>`:body}
    ${pending?`<div class="approval-actions"><button class="primary" data-action="approve-tool" data-tool="${e(tool.id)}">${approve}</button><button data-action="deny-tool" data-tool="${e(tool.id)}">Decline</button></div>`:''}
    ${running&&delegated?`<button class="delegate-stop" data-action="cancel-delegate" data-tool="${e(tool.id)}">Stop sub-agent</button>`:''}
  </section>`;
}
/** What one call is about, for the activity row: an agent call's path or command, else its query, title, task or code. */
function tickSubject(tool:ToolRun):string {
  if(agentTool(tool))return agentSubject(tool);
  const a=parsed(tool),line=(str(a.query)||str(a.title)||str(a.task)||str(a.code)).trim().split('\n')[0]??'';
  return line.length>80?line.slice(0,80)+'…':line;
}
const plural=(n:number,one:string,many:string):string=>n===1?one:many.replace('#',String(n));
// The finished row's account of the calls, by kind. Agent file calls count distinct paths; the others count calls.
const DONE:Record<string,(n:number)=>string>={
  read_file:n=>plural(n,'read a file','read # files'),list_files:n=>plural(n,'listed a folder','listed # folders'),
  search_files:n=>plural(n,'searched the files','searched the files # times'),change:n=>plural(n,'changed a file','changed # files'),
  run_command:n=>plural(n,'ran a command','ran # commands'),update_plan:()=>'updated the plan',
  python:n=>plural(n,'ran Python','ran Python # times'),delegate_task:n=>plural(n,'delegated a task','delegated # tasks'),
  web_search:n=>plural(n,'searched the web','searched the web # times'),code_execution:n=>plural(n,'ran code on Tinfoil','ran code on Tinfoil # times'),
  render_chart:n=>plural(n,'drew a chart','drew # charts'),render_table:n=>plural(n,'made a table','made # tables'),
  render_diagram:n=>plural(n,'drew a diagram','drew # diagrams'),render_timeline:n=>plural(n,'made a timeline','made # timelines'),
  render_stat_cards:()=>'showed headline figures',create_artifact:n=>plural(n,'created an artifact','created # artifacts'),
  update_artifact:n=>plural(n,'updated an artifact','updated # artifacts'),read_artifact:n=>plural(n,'read an artifact','read # artifacts'),
};
/** One line for a reply's finished calls, such as "Read 6 files, ran 3 commands, changed a file · 1 declined". */
export function activityTally(tools:ToolRun[]):string {
  const kinds=new Map<string,Set<string>>(),count=(state:ToolRun['status'])=>tools.filter(t=>t.status===state).length;
  for(const tool of tools.filter(t=>t.status==='complete')){
    const agent=agentTool(tool),kind=tool.provider?tool.provider.family:agent&&(tool.name==='edit_file'||tool.name==='write_file')?'change':tool.name;
    const one=agent&&['read_file','list_files','change'].includes(kind)?str(parsed(tool).path)||'.':tool.id;
    if(!kinds.has(kind))kinds.set(kind,new Set());kinds.get(kind)!.add(one);
  }
  const done=[...kinds].map(([kind,seen])=>DONE[kind]?.(seen.size)??(seen.size===1?`used ${kind}`:`used ${kind} ${seen.size} times`)).join(', ');
  const rest=[count('error')?`${count('error')} failed`:'',count('denied')?`${count('denied')} declined`:'',count('cancelled')?`${count('cancelled')} cancelled`:'',count('queued')+count('running')?'unfinished':''].filter(Boolean).join(' · ');
  const line=[done,rest].filter(Boolean).join(' · ');
  return line.charAt(0).toUpperCase()+line.slice(1);
}
const LIVE:ReadonlySet<Reply['status']>=new Set(['streaming','queued','awaiting_approval','executing']);
const ROLL_MS=280;
interface Tick { key:string; state:string; text:string }
// The row's slot per reply: the tick shown now and the one it replaced, which rolls out while the new one rolls in.
const slots=new Map<string,{now:Tick,before:Tick|null}>(),live=new Set<string>(),settled=new Map<string,number>();
/** Whether a reply's row still rolls: while the reply runs, and briefly after, so its last call rolls into the summary.
 * A reply opened later is drawn still, so a transcript does not animate every row as it appears. */
function rolling(reply:Reply):boolean {
  if(LIVE.has(reply.status)){live.add(reply.id);settled.delete(reply.id);return true;}
  if(live.delete(reply.id))settled.set(reply.id,Date.now());
  const at=settled.get(reply.id);if(at!==undefined&&Date.now()-at<4*ROLL_MS)return true;
  settled.delete(reply.id);slots.delete(reply.id);return false;
}
const tickMarkup=(t:Tick,kind:''|'out'|'settled'=''):string=>`<span class="tick${kind?' tick-'+kind:''}" data-key="${e(t.key)}"${kind==='out'?' aria-hidden="true"':''}><i class="activity-state ${e(t.state)}" aria-hidden="true"></i><span class="tick-text">${t.text}</span></span>`;
/** The slot's markup: the current tick, and the one it replaced rolling out. The reconciler keeps both by key, so each
 * animation starts once, when a tick first appears or first turns into the outgoing one. */
function slot(reply:Reply,now:Tick):string {
  const seen=slots.get(reply.id);
  if(!seen||seen.now.key!==now.key)slots.set(reply.id,{now,before:seen?.now??null});else seen.now=now;
  const {before}=slots.get(reply.id)!;
  return (before?tickMarkup(before,'out'):'')+tickMarkup(now);
}
/** A reply's tool calls as one row. While the reply runs, its current call rolls into the row's slot over the last one;
 * once it finishes, the row says what was done. Opening it lists every call in order, a batch (several calls in one
 * completion round, run one after another here; NOT concurrent execution or the billed Batch API) under one heading.
 * An approval and a running sub-agent with its Stop button stay in full view below the row. */
export function activityMarkup(reply:Reply):string {
  const tools=reply.tools??[];if(!tools.length)return '';
  // The workspace agent's latest plan stays in view above its calls.
  const plan=[...tools].reverse().find(t=>t.name==='update_plan'&&agentTool(t)&&t.status==='complete');
  const planned=plan?`<section class="agent-plan-current" data-key="plan" aria-label="Plan"><div class="agent-plan-title">Plan</div>${planMarkup(parsed(plan))}</section>`:'';
  const attention=(t:ToolRun)=>t.status==='awaiting_approval'||(t.name==='delegate_task'&&t.status==='running');
  const outside=tools.filter(attention).map(t=>entry(t)).join('');
  if(tools.every(attention))return planned+outside;
  const timeline=activityGroups(tools).map(g=>{
    const shown=g.tools.filter(t=>!attention(t));if(!shown.length)return '';
    if(!g.batch)return entry(shown[0]!,agentTool(shown[0]!));
    return `<div class="batch-activity" data-key="batch-${e(g.id)}" role="group" aria-label="Tool batch"><div class="batch-heading"><strong>Batch · ${g.tools.length} actions</strong><span>${e(['one after another',batchSummary(g.tools)].filter(Boolean).join(' · '))}</span></div>${shown.map(t=>entry(t,true)).join('')}</div>`;
  }).join('');
  const running=LIVE.has(reply.status);
  const current=running?tools.find(t=>t.status==='running')??tools.find(t=>t.status==='awaiting_approval')??tools.find(t=>t.status==='queued')??tools.at(-1)!:null;
  const subject=current?tickSubject(current):'';
  const now:Tick=current?{key:`tick-${current.id}`,state:current.status,text:`${e(label(current))}${subject?` <code>${e(subject)}</code>`:''}`}:
    {key:'tick-summary',state:tools.some(t=>t.status==='error')?'error':tools.every(t=>t.status==='complete')?'complete':'denied',text:e(activityTally(tools))};
  const ticker=rolling(reply)?slot(reply,now):tickMarkup(now,'settled');
  const count=`${tools.length} ${tools.length===1?'tool run':'tool runs'}${tools.some(t=>t.provider)?' · MCP':''}${tools.some(t=>t.delegate)?' · sub-agent':''}`;
  return planned+`<details class="tool-activity activity-strip${running?' live':''}" data-key="tool-history" data-disclosure="tools-${e(reply.id)}"><summary><span class="activity-ticker">${ticker}</span><span class="activity-count">${count}</span></summary><div class="activity-timeline">${timeline}</div></details>`+outside;
}
function visible(host:HTMLElement):boolean {
  for(let element:HTMLElement|null=host.parentElement;element;element=element.parentElement)if(element instanceof HTMLDetailsElement&&!element.open)return false;
  return true;
}
/** One retained entry per mounted detail island. Closed activity never parses JSON or renders child Markdown. */
export class ActivityDetailsRenderer {
  private previous=new WeakMap<HTMLElement,unknown[]>();
  constructor(private rich:RichTextRenderer){}
  sync(root:HTMLElement,reply:Reply,view:ViewPreferences):void {
    for(const host of root.querySelectorAll<HTMLElement>('[data-activity-body]')){
      if(!visible(host))continue;
      const tool=reply.tools?.find(t=>t.id===host.dataset.activityBody);if(!tool)continue;
      const child=tool.delegate;
      if(agentTool(tool)){
        const agentSig=[tool.arguments,tool.stdout,tool.stderr,tool.status,tool.truncated,tool.exitCode,tool.agent?.diff,tool.agent?.shell,view.metadata,view.metadata?tool.elapsedMs:0],before=this.previous.get(host);
        if(!before||before.length!==agentSig.length||!before.every((v,i)=>v===agentSig[i])){updateMarkup(host,agentBody(tool,view));this.previous.set(host,agentSig);}
        continue;
      }
      const sig=[tool.arguments,tool.stdout,tool.stderr,tool.status,tool.truncated,child?.task,child?.model,child?.usage?.input,child?.usage?.output,child?.phase,!!child?.reasoning,view.metadata,view.reasoning,view.metadata?tool.elapsedMs:0,...(tool.provider?.sources??[]).flatMap(s=>[s.url,s.title]),...tool.artifacts.map(a=>a.id)];
      const old=this.previous.get(host);
      if(!old||old.length!==sig.length||!old.every((v,i)=>v===sig[i])){
        let args=tool.arguments;
        try {const data=JSON.parse(args);args=typeof data.code==='string'?data.code:typeof data.task==='string'?data.task:JSON.stringify(data,null,2);}catch{ /* Keep malformed input as inert text. */ }
        const source=`<details class="tool-source" data-disclosure="source-${e(tool.id)}" ${tool.status==='awaiting_approval'?'open':''}><summary>${child?'Task sent':tool.name==='python'?'Code':'Arguments'}</summary><pre><code>${e(args)}</code></pre></details>`;
        const sources=tool.provider?.sources??[];
        updateMarkup(host,source+(tool.provider?'<p class="activity-origin">Provider-reported activity. This client did not execute it locally.</p>':'')+
          (child?`<div class="delegate-output"><div class="delegate-identity"><span>${e(child.model)}</span><small>${tool.status==='running'?e(child.phase):e(tool.status)} · task-only context</small></div><div class="delegate-answer" data-key="child-answer" data-child-answer data-rich-host></div>${child.reasoning&&view.reasoning!=='hidden'?`<details class="delegate-thinking" data-disclosure="delegate-think-${e(tool.id)}"><summary>Child reasoning · provided by the model</summary><div data-key="child-reasoning" data-child-reasoning data-rich-host></div></details>`:''}${child.usage?`<p class="delegate-usage">Delegate only: ${child.usage.input.toLocaleString()} in · ${child.usage.output.toLocaleString()} out</p>`:''}</div>`:tool.stdout?`<pre class="tool-stdout" aria-label="Standard output">${e(tool.stdout)}</pre>`:'')+
          (tool.stderr?`<pre class="tool-stderr" aria-label="Standard error">${e(tool.stderr)}</pre>`:'')+
          (sources.length?`<div class="activity-sources" aria-label="Provider sources">${sources.map(s=>`<button type="button" data-url="${e(s.url)}" title="${e(s.url)}">${e(s.title||s.url)}</button>`).join('')}</div>`:'')+
          (tool.artifacts.length?`<div class="artifact-list">${tool.artifacts.map(a=>`<button data-action="artifact-view" data-tool="${e(tool.id)}" data-artifact="${e(a.id)}">${e(a.name)}</button><button data-action="artifact-save" data-tool="${e(tool.id)}" data-artifact="${e(a.id)}" title="Save ${e(a.name)}">Save</button>`).join('')}</div>`:'')+
          (tool.truncated?'<p class="tool-metadata">Output truncated.</p>':'')+
          (view.metadata?`<div class="tool-metadata">${tool.provider?'Provider timing not supplied':(tool.elapsedMs/1000).toFixed(1)+'s'}${tool.exitCode!==null?' · exit '+tool.exitCode:''}</div>`:'')+
          (tool.origin==='manual'?'<p class="muted small">Manual result — not sent to the model.</p>':''));
        this.previous.set(host,sig);
      }
      if(tool.status==='awaiting_approval'){const source=host.querySelector<HTMLDetailsElement>('.tool-source');if(source)source.open=true;}
      if(child){
        const answer=host.querySelector<HTMLElement>('[data-child-answer]');
        if(answer)this.rich.render(answer,child.content,{markdown:view.markdown,math:view.math,codeTools:false});
        const reasoning=host.querySelector<HTMLElement>('[data-child-reasoning]');
        if(reasoning&&visible(reasoning))this.rich.render(reasoning,child.reasoning||'No reasoning text has been returned.',{markdown:view.markdown,math:view.math,codeTools:false});
      }
    }
  }
}
