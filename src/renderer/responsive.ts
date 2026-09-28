/** Compact navigation is ephemeral: rotating a phone never overwrites desktop preferences. */
export class ResponsiveLayout {
  private media=matchMedia('(max-width: 1000px)'); private coarse=matchMedia('(pointer: coarse)');
  navigation=false; advanced=false; private activePane:HTMLElement|null=null; private returnFocus:HTMLElement|null=null;
  private raf=0;
  constructor(private shell:HTMLElement,private changed:()=>void,private closeArtifacts:()=>void){
    this.media.addEventListener('change',()=>{this.navigation=false;this.advanced=false;this.changed();this.sync();});
    this.coarse.addEventListener('change',()=>this.changed());
    new MutationObserver(()=>this.sync()).observe(shell,{attributes:true,attributeFilter:['class']});
    const resize=()=>{if(!this.raf)this.raf=requestAnimationFrame(()=>{this.raf=0;this.viewport();});};
    window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);window.visualViewport?.addEventListener('scroll',resize);this.viewport();
    document.addEventListener('keydown',event=>{
      if(!this.activePane || document.querySelector('dialog[open]'))return;
      if(event.key==='Escape'){event.preventDefault();this.close();return;}
      if(event.key!=='Tab')return;
      const targets=[...this.activePane.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,a[href],[tabindex="0"]')].filter(el=>el.getClientRects().length&&!el.closest('[hidden],.hidden'));
      const first=targets[0],last=targets.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    });
  }
  get compact():boolean{return this.media.matches;}
  get touch():boolean{return this.coarse.matches;}
  apply(sidebar:boolean,inspector:boolean,focus:boolean):void {
    this.shell.classList.toggle('compact-layout',this.compact);
    this.shell.classList.toggle('no-sidebar',focus||!(this.compact?this.navigation:sidebar));
    this.shell.classList.toggle('no-inspector',focus||!(this.compact?this.advanced:inspector));
    if(focus){this.navigation=false;this.advanced=false;}this.sync();
  }
  showNavigation():void {this.closeArtifacts();this.advanced=false;this.navigation=!this.navigation;this.changed();}
  showAdvanced():void {this.closeArtifacts();this.navigation=false;this.advanced=!this.advanced;this.changed();}
  close():void {this.navigation=false;this.advanced=false;this.closeArtifacts();this.changed();this.sync();}
  private viewport():void {
    const v=window.visualViewport;
    // Do not cancel or counteract pinch zoom. Keyboard resize is handled only at normal scale.
    if(v&&Math.abs(v.scale-1)>.05)return;
    document.documentElement.style.setProperty('--app-height',`${v?.height??window.innerHeight}px`);
    document.documentElement.style.setProperty('--app-top',`${v?.offsetTop??0}px`);
  }
  private sync():void {
    const artifact=this.shell.classList.contains('with-artifacts');
    const pane=this.compact?(artifact?this.shell.querySelector<HTMLElement>('#artifact-panel'):!this.shell.classList.contains('no-sidebar')?this.shell.querySelector<HTMLElement>('.sidebar'):!this.shell.classList.contains('no-inspector')?this.shell.querySelector<HTMLElement>('#inspector'):null):null;
    const backdrop=this.shell.querySelector<HTMLElement>('#drawer-backdrop');if(backdrop)backdrop.hidden=!pane;
    for(const el of this.shell.querySelectorAll<HTMLElement>('.main,.titlebar,.statusbar'))el.inert=!!pane;
    for(const el of this.shell.querySelectorAll<HTMLElement>('.sidebar,#inspector,#artifact-panel')){
      el.inert=!!pane&&pane!==el;
      if(el===pane){el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');}
      else{el.removeAttribute('role');el.removeAttribute('aria-modal');}
    }
    if(pane===this.activePane)return;
    const previous=this.activePane;this.activePane=pane;
    if(pane){
      if(!previous)this.returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
      queueMicrotask(()=>{if(this.activePane===pane&&!document.querySelector('dialog[open]'))pane.querySelector<HTMLElement>('button:not(:disabled),input,select')?.focus();});
    }else if(previous){const target=this.returnFocus;queueMicrotask(()=>{if(target?.isConnected&&target.getClientRects().length)target.focus({preventScroll:true});});this.returnFocus=null;}
  }
}
