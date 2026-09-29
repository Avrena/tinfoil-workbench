import type { Artifact } from '../core/types.js';
import { artifactSource, STRUCTURED_KINDS } from '../core/visual-tools.js';
import { mountArtifact } from './artifact-surface.js';
export interface ArtifactEntry { artifact:Artifact; toolId?:string; threadId:string; local?:boolean }
interface PanelActions { save:(entry:ArtifactEntry)=>void; pdf:(entry:ArtifactEntry)=>void; copy:(source:string)=>void; openLocal:()=>void }
/** Maintains its own DOM so a streamed token cannot reset a chart, PDF page,
 * scroll position, active iframe, or the user's selected historical revision. */
export class ArtifactPanel {
  private element:HTMLElement; private entries:ArtifactEntry[]=[]; private current:ArtifactEntry|null=null;
  private seen=new Set<string>(); private threadId=''; private turnId=''; private suppressed=false;
  private tab:'preview'|'source'|'data'='preview'; private interactive=false; 
  private cleanup:(()=>void)|null=null; private expanded=false;
  constructor(private shell:HTMLElement,private actions:PanelActions){
    this.element=document.createElement('aside');this.element.id='artifact-panel';this.element.className='artifact-panel hidden';this.element.setAttribute('aria-label','Artifact workspace');
    this.element.innerHTML=`<header class="artifact-panel-header"><strong>Artifacts</strong><span class="spacer"></span><button data-panel="local" title="Open a local file without sharing it with the model">Open file</button><button data-panel="expand" aria-label="Expand artifact workspace">Expand</button><button data-panel="close" aria-label="Close artifact workspace">×</button></header><div class="artifact-picker-row"><select id="artifact-picker" aria-label="Choose artifact"></select><select id="artifact-version" aria-label="Artifact revision"></select></div><div class="artifact-panel-tools"><div class="artifact-tabs" role="tablist" aria-label="Artifact views"><button data-panel="preview" role="tab">Preview</button><button data-panel="source" role="tab">Source</button><button data-panel="data" role="tab">Data</button></div><span class="spacer"></span><button data-panel="copy" title="Copy original source">Copy</button><button data-panel="pdf" title="Export an unencrypted PDF">PDF</button><button data-panel="save" title="Save original artifact">Save</button></div><div class="artifact-interaction"><button data-panel="interact">Enable interaction</button><span>Isolated inline JavaScript · no network or device access</span></div><div id="artifact-stage" class="artifact-stage"></div><div id="artifact-panel-caption" class="artifact-panel-caption"></div>`;
    shell.append(this.element);
    this.element.addEventListener('click',event=>{const target=(event.target as Element).closest<HTMLElement>('[data-panel]');if(target)void this.action(target.dataset.panel!);});
    this.get<HTMLSelectElement>('artifact-picker').addEventListener('change',()=>{const root=this.get<HTMLSelectElement>('artifact-picker').value;const selected=this.entries.filter(e=>(e.artifact.rootId??e.artifact.id)===root).at(-1);if(selected)this.open(selected);});
    this.get<HTMLSelectElement>('artifact-version').addEventListener('change',()=>{const selected=this.entries.find(e=>e.artifact.id===this.get<HTMLSelectElement>('artifact-version').value);if(selected)this.open(selected);});
  }
  private get<T extends HTMLElement=HTMLElement>(id:string):T{return this.element.querySelector<T>('#'+id)!;}
  isOpen():boolean{return !this.element.classList.contains('hidden');}
  close(suppress=true):void{this.suppressed=suppress;this.element.classList.add('hidden');this.shell.classList.remove('with-artifacts','artifact-expanded');this.cleanup?.();this.cleanup=null;this.get('artifact-stage').replaceChildren();}
  toggle():void{if(this.isOpen())this.close();else if(this.current)this.open(this.current);else{this.pickers();this.reveal();this.get('artifact-stage').innerHTML='<div class="artifact-empty"><h3>A little more room.</h3><p>Charts, diagrams and documents appear here when the model creates them. Open a local HTML or PDF to inspect it without sending it to the model.</p></div>';}}
  private reveal():void{this.shell.classList.add('with-artifacts');this.shell.classList.toggle('artifact-expanded',this.expanded);this.element.classList.remove('hidden');this.element.classList.toggle('is-empty',!this.current);}
  sync(threadId:string,turnId:string,entries:ArtifactEntry[],autoReveal:boolean):void{
    if(this.threadId!==threadId){this.close(false);this.current=null;this.threadId=threadId;this.turnId=turnId;this.entries=entries;this.seen=new Set(entries.map(e=>e.artifact.id));this.pickers();return;}
    if(this.turnId!==turnId){this.turnId=turnId;this.suppressed=false;}
    const incoming=entries.filter(e=>!this.seen.has(e.artifact.id));
    this.entries=[...entries,...this.entries.filter(e=>e.local)];entries.forEach(e=>this.seen.add(e.artifact.id));
    if(incoming.length&&!this.isOpen()&&autoReveal&&!this.suppressed)this.open(incoming[0]!);
    else if(this.isOpen()&&incoming.length)this.pickers();
  }
  open(entry:ArtifactEntry):void{
    if(this.isOpen()&&this.current?.artifact.id===entry.artifact.id&&this.current.threadId===entry.threadId){this.reveal();return;}
    if(!this.entries.some(e=>e.artifact.id===entry.artifact.id))this.entries.push(entry);
    this.current=entry;this.tab='preview';this.interactive=false;this.suppressed=false;this.reveal();this.pickers();this.render();
  }
  openSource(language:string,source:string,title:string,threadId:string):void{
    const mime=language==='html'?'text/html':language==='svg'?'image/svg+xml':['md','markdown'].includes(language)?'text/markdown':language==='json'?'application/json':'text/plain';
    this.open({threadId,local:true,artifact:{id:crypto.randomUUID(),name:title,mime,data:'',source,title}});
  }
  private pickers():void{
    const roots=new Map<string,ArtifactEntry>();this.entries.forEach(entry=>roots.set(entry.artifact.rootId??entry.artifact.id,entry));
    const picker=this.get<HTMLSelectElement>('artifact-picker');picker.replaceChildren();
    for(const [id,entry] of roots){const o=document.createElement('option');o.value=id;o.textContent=(entry.local?'Local · ':'')+(entry.artifact.title??entry.artifact.name);picker.append(o);}
    const a=this.current?.artifact,root=a?.rootId??a?.id;if(root)picker.value=root;
    const versions=this.entries.filter(e=>(e.artifact.rootId??e.artifact.id)===root),version=this.get<HTMLSelectElement>('artifact-version');version.replaceChildren();
    versions.forEach(entry=>{const o=document.createElement('option');o.value=entry.artifact.id;o.textContent='v'+(entry.artifact.version??1);version.append(o);});
    if(a)version.value=a.id;version.classList.toggle('hidden',versions.length<2);
  }
  private action(action:string):void{
    if(action==='close'){this.close();return;}
    if(action==='local'){this.actions.openLocal();return;}
    if(action==='expand'){this.expanded=!this.expanded;this.shell.classList.toggle('artifact-expanded',this.expanded);this.element.querySelector('[data-panel="expand"]')!.textContent=this.expanded?'Split view':'Expand';return;}
    if(!this.current)return;
    if(['preview','source','data'].includes(action)&&action!==this.tab){this.tab=action as typeof this.tab;this.render();}
    if(action==='interact'){this.interactive=!this.interactive;this.render();}
    if(action==='copy'){const source=artifactSource(this.current.artifact);if(source!==null)this.actions.copy(source);}
    if(action==='save')this.actions.save(this.current);
    if(action==='pdf')this.actions.pdf(this.current);
  }
  private render():void{
    this.cleanup?.();this.cleanup=null;
    const entry=this.current;if(!entry)return;const a=entry.artifact,source=artifactSource(a);
    const stage=this.get('artifact-stage');stage.replaceChildren();
    this.element.querySelectorAll<HTMLElement>('[role="tab"]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.panel===this.tab)));
    this.element.querySelector('[data-panel="data"]')!.classList.toggle('hidden',!(STRUCTURED_KINDS as readonly string[]).includes(a.kind??''));
    for(const action of ['save','pdf'])(this.element.querySelector(`[data-panel="${action}"]`) as HTMLButtonElement).disabled=!!entry.local;
    (this.element.querySelector('[data-panel="copy"]') as HTMLButtonElement).disabled=source===null;
    const canInteract=a.mime==='text/html'&&!(STRUCTURED_KINDS as readonly string[]).includes(a.kind??'')&&this.tab==='preview';
    this.element.querySelector('.artifact-interaction')!.classList.toggle('hidden',!canInteract);
    this.element.querySelector('[data-panel="interact"]')!.textContent=this.interactive?'Stop interaction':'Enable interaction';
    this.get('artifact-panel-caption').textContent=(entry.local?'Local preview · not shared with the model. ':`Revision ${a.version??1} · `)+(a.description??'');
    if(this.tab==='source'){const pre=document.createElement('pre');pre.className='raw-source';pre.textContent=source??'This binary artifact has no stored textual source.';stage.append(pre);return;}
    this.cleanup=mountArtifact(stage,a,{tab:this.tab,interactive:this.interactive});
  }
}
