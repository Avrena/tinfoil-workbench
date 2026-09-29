import type { InlineGroup } from '../core/reply-layout.js';
import type { ArtifactEntry } from './artifact-panel.js';
import { mountArtifact, type ArtifactTab } from './artifact-surface.js';
import { STRUCTURED_KINDS } from '../core/visual-tools.js';
const expandIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/></svg>';
/** An inline figure, not a nested card. Three bounded view islands are retained
 * for the selected revision. Streaming never remounts a running HTML preview. */
class InlineFigure {
  private selectedId: string;
  private tab: ArtifactTab = 'preview';
  private interactive = false;
  private folded = false;
  private ready = false;
  private surfaces = new Map<ArtifactTab, { node: HTMLElement; cleanup: () => void }>();
  private stage: HTMLElement;
  private title: HTMLElement;
  private version: HTMLSelectElement;
  private caption: HTMLElement;
  constructor(readonly element: HTMLElement, private group: InlineGroup, private threadId: string, private expand: (entry: ArtifactEntry) => void) {
    this.selectedId=group.versions.at(-1)!.artifact.id;
    element.innerHTML=`<header class="inline-artifact-header"><strong></strong><select class="inline-version" aria-label="Artifact revision"></select><div class="inline-artifact-toolbar"><div class="inline-tabs" role="tablist" aria-label="Visualization views"><button type="button" role="tab" data-inline-tab="preview">Preview</button><button type="button" role="tab" data-inline-tab="data">Data</button><button type="button" role="tab" data-inline-tab="source">Source</button></div><button type="button" class="inline-interact hidden">Enable interaction</button><button type="button" class="inline-fold" aria-expanded="true">Collapse</button></div><button type="button" class="inline-expand" aria-label="Expand visualization" title="Open in artifact workspace">${expandIcon}</button></header><div class="inline-artifact-stage"></div><figcaption class="inline-artifact-caption"></figcaption>`;
    this.stage=element.querySelector('.inline-artifact-stage')!;
    this.title=element.querySelector('strong')!;this.version=element.querySelector('select')!;this.caption=element.querySelector('figcaption')!;
    element.querySelector<HTMLButtonElement>('.inline-expand')!.onclick=()=>{this.expand({...this.selected(),threadId:this.threadId});};
    this.version.onchange=()=>{this.disposeViews();this.selectedId=this.version.value;this.interactive=false;this.header();this.activate();};
    element.querySelector('.inline-tabs')!.addEventListener('keydown',event=>{
      const key=(event as KeyboardEvent).key;if(!['ArrowLeft','ArrowRight','Home','End'].includes(key))return;
      event.preventDefault();const tabs=[...element.querySelectorAll<HTMLButtonElement>('[data-inline-tab]:not(.hidden)')];
      const index=tabs.indexOf(document.activeElement as HTMLButtonElement), next=key==='Home'?0:key==='End'?tabs.length-1:(index+(key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
      tabs[next]?.focus();tabs[next]?.click();
    });
    element.querySelectorAll<HTMLButtonElement>('[data-inline-tab]').forEach(b=>b.onclick=()=>{
      this.tab=b.dataset.inlineTab as ArtifactTab;
      // An opaque script cannot be safely suspended from outside. Leaving its
      // view is an explicit stop; static chart/table state stays cached.
      if(this.tab!=='preview')this.stopInteraction();
      this.activate();
    });
    element.querySelector<HTMLButtonElement>('.inline-interact')!.onclick=()=>{this.interactive=!this.interactive;this.disposeView('preview');this.activate();};
    element.querySelector<HTMLButtonElement>('.inline-fold')!.onclick=()=>{
      this.folded=!this.folded;this.element.classList.toggle('is-folded',this.folded);
      if(this.folded)this.stopInteraction();this.activate();
    };
    element.addEventListener('focusin',()=>this.activate());
    this.header();this.paint();
  }
  private selected(){return this.group.versions.find(v=>v.artifact.id===this.selectedId)??this.group.versions.at(-1)!;}
  activate():void {this.ready=true;this.paint();}
  update(group:InlineGroup):void {
    const oldIds=this.group.versions.map(v=>v.artifact.id).join(',');this.group=group;
    if(oldIds!==group.versions.map(v=>v.artifact.id).join(','))this.header();
  }
  private header():void {
    const a=this.selected().artifact;this.title.textContent=a.title??a.name;
    this.version.replaceChildren();for(const v of this.group.versions){const option=document.createElement('option');option.value=v.artifact.id;option.textContent='v'+(v.artifact.version??1);this.version.append(option);}
    this.version.value=a.id;this.version.hidden=this.group.versions.length<2;
    this.caption.textContent=a.description??'';this.caption.hidden=!a.description;
    this.element.setAttribute('aria-label',a.title??a.name);
    this.element.dataset.kind=a.kind??a.mime;
  }
  private disposeView(tab:ArtifactTab):void {const view=this.surfaces.get(tab);if(view){view.cleanup();view.node.remove();this.surfaces.delete(tab);}}
  private disposeViews():void {for(const tab of this.surfaces.keys())this.disposeView(tab);}
  private stopInteraction():void {if(this.interactive){this.interactive=false;this.disposeView('preview');}}
  private paint():void {
    const a=this.selected().artifact;
    this.element.querySelectorAll<HTMLButtonElement>('[data-inline-tab]').forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.inlineTab===this.tab));b.tabIndex=b.dataset.inlineTab===this.tab?0:-1;b.classList.toggle('hidden',b.dataset.inlineTab==='data'&&!(STRUCTURED_KINDS as readonly string[]).includes(a.kind??''));});
    const interact=this.element.querySelector<HTMLButtonElement>('.inline-interact')!;
    interact.classList.toggle('hidden',a.kind!=='html'||this.tab!=='preview'||this.folded);interact.textContent=this.interactive?'Stop interaction':'Enable interaction';
    interact.title='Run isolated inline JavaScript for this preview only. Leaving the preview stops it. No network or desktop bridge.';
    const fold=this.element.querySelector<HTMLButtonElement>('.inline-fold')!;fold.textContent=this.folded?'Show visualization':'Collapse';fold.setAttribute('aria-expanded',String(!this.folded));
    this.stage.hidden=this.folded;if(this.folded)return;
    this.stage.setAttribute('role','tabpanel');this.stage.setAttribute('aria-label',this.tab+' of '+(a.title??a.name));
    this.stage.classList.toggle('deferred-surface',!this.ready);
    this.stage.setAttribute('aria-busy',String(!this.ready));
    if(!this.ready)return;
    let surface=this.surfaces.get(this.tab);
    if(!surface){
      const node=document.createElement('div');node.className='artifact-view';this.stage.append(node);
      surface={node,cleanup:mountArtifact(node,a,{tab:this.tab,interactive:this.interactive,compact:true})};this.surfaces.set(this.tab,surface);
    }
    for(const [tab,view] of this.surfaces)view.node.hidden=tab!==this.tab;
  }
  destroy():void {this.disposeViews();this.element.replaceChildren();}
}
export class InlineArtifacts {
  private figures=new Map<HTMLElement,InlineFigure>();
  private observer:IntersectionObserver|null;
  private pending=new Set<HTMLElement>();
  constructor(private expand:(entry:ArtifactEntry)=>void){
    this.observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>{
      for(const entry of entries)if(entry.isIntersecting){
        const host=entry.target as HTMLElement;
        if(document.querySelector('dialog[open]')){this.pending.add(host);continue;}
        this.pending.delete(host);this.figures.get(host)?.activate();this.observer?.unobserve(host);
      }
    },{root:document.getElementById('transcript'),rootMargin:'400px 0px'});
    document.addEventListener('close',()=>{if(document.querySelector('dialog[open]'))return;for(const host of this.pending){this.observer?.unobserve(host);if(host.isConnected)this.observer?.observe(host);}this.pending.clear();},true);
  }
  sync(replyElement:HTMLElement,groups:InlineGroup[],threadId:string):void {
    const byRoot=new Map(groups.map(group=>[group.rootId,group]));
    for(const host of replyElement.querySelectorAll<HTMLElement>('[data-artifact-host]')) {
      const group=byRoot.get(host.dataset.artifactHost!);if(!group)continue;
      const existing=this.figures.get(host);
      if(existing)existing.update(group);
      else {const figure=new InlineFigure(host,group,threadId,this.expand);this.figures.set(host,figure);if(this.observer)this.observer.observe(host);else figure.activate();}
    }
  }
  prune():void {for(const [host,figure] of this.figures)if(!host.isConnected){this.observer?.unobserve(host);this.pending.delete(host);figure.destroy();this.figures.delete(host);}}
  destroy():void {this.pending.clear();this.observer?.disconnect();for(const figure of this.figures.values())figure.destroy();this.figures.clear();}
}
