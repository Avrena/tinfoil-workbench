import type { Reply, ToolRun } from '../core/types.js';
import { activityGroups, batchSummary, toolActive } from '../core/activity.js';
import { escapeHtml as e } from '../core/markdown.js';
import type { ViewPreferences } from '../core/preferences.js';
import { RichTextRenderer } from './rich-text.js';
import { updateMarkup } from './dom.js';

const provenance=(tool:ToolRun):string=>tool.origin==='provider'?'Tinfoil-managed MCP':tool.origin==='text'?'Written as text by the model; drawn by Workbench':tool.name==='delegate_task'?'Client sub-agent':tool.name==='python'?'Local Python':'Client tool';
const label=(tool:ToolRun):string=>tool.name==='delegate_task'?'Delegated analysis':tool.name;
function entry(tool:ToolRun,nested=false):string {
  const pending=tool.status==='awaiting_approval',delegated=tool.name==='delegate_task',running=tool.status==='running';
  const body=`<div class="activity-detail-body" data-key="detail-${e(tool.id)}" data-activity-body="${e(tool.id)}" data-rich-host></div>`;
  return `<section data-key="tool-${e(tool.id)}" class="tool-run ${pending?'approval-required':''}" data-tool-id="${e(tool.id)}" data-state="${tool.status}">
    <div class="tool-run-header"><i class="activity-state ${tool.status}" aria-hidden="true"></i><strong>${e(label(tool))}</strong><span>${e(tool.status.replaceAll('_',' '))} · ${provenance(tool)}${tool.origin==='manual'?' · manual':''}</span></div>
    ${pending?`<p class="approval-warning">${delegated?'One extra model request using the task below. The same model is used, with no tools or access to the rest of this conversation. Additional inference usage applies.':'This Python runs on your computer, not in a sandbox. It can access files and the network.'}</p>`:''}
    ${!pending&&(nested||(running&&(delegated||tool.provider)))?`<details class="activity-item-details" data-disclosure="item-${e(tool.id)}"><summary>${delegated?'Task & live response':tool.provider?'Provider details':'Arguments & result'}</summary>${body}</details>`:body}
    ${pending?`<div class="approval-actions"><button class="primary" data-action="approve-tool" data-tool="${e(tool.id)}">${delegated?'Run one delegated request':'Review & run once…'}</button><button data-action="deny-tool" data-tool="${e(tool.id)}">Decline</button></div>`:''}
    ${running&&delegated?`<button class="delegate-stop" data-action="cancel-delegate" data-tool="${e(tool.id)}">Stop sub-agent</button>`:''}
  </section>`;
}
/** A batch means several calls in one completion round, NOT concurrent execution or the billed Batch API. */
export function activityMarkup(reply:Reply):string {
  const tools=reply.tools??[];if(!tools.length)return '';
  const groups=activityGroups(tools), finishedSingles=groups.filter(g=>!g.batch&&!toolActive(g.tools[0]!));
  const markup=groups.filter(g=>g.batch||toolActive(g.tools[0]!)).map(g=>{
    if(!g.batch)return entry(g.tools[0]!);
    const active=g.tools.some(toolActive);
    const header=`<strong>Batch · ${g.tools.length} actions</strong><span>${e(batchSummary(g.tools))}</span>`;
    if(active)return `<section class="batch-activity batch-active" data-key="batch-${e(g.id)}" aria-label="Tool batch"><div class="batch-heading">${header}</div><p class="batch-execution">Sequential execution · each protected action keeps its own approval</p>${g.tools.map(t=>entry(t,true)).join('')}</section>`;
    return `<details class="tool-activity batch-activity" data-key="batch-${e(g.id)}" data-disclosure="batch-${e(g.id)}"><summary>${header}</summary><p class="batch-execution">Sequential execution · ${g.tools.length} matched tool results</p>${g.tools.map(t=>entry(t,true)).join('')}</details>`;
  }).join('');
  const singles=finishedSingles.flatMap(g=>g.tools);
  const suffix=singles.some(t=>t.status==='error')?'Error recorded':singles.every(t=>t.status==='complete')?'Completed':'Activity';
  return markup+(singles.length?`<details class="tool-activity" data-key="tool-history" data-disclosure="tools-${e(reply.id)}"><summary>${singles.length} ${singles.length===1?'tool run':'tool runs'}<span>${suffix}${singles.some(t=>t.provider)?' · MCP':''}${singles.some(t=>t.delegate)?' · sub-agent':''}</span></summary>${singles.map(t=>entry(t)).join('')}</details>`:'');
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
