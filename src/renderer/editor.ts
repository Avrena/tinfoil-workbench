import { openModal } from './modal.js';
import { escapeHtml as escape, markdown } from '../core/markdown.js';
import { editSpan } from '../core/editing.js';
export interface EditorSession {
  kind:'draft'|'prompt'|'reply'; title:string; content:string; reasoning?:string;
  originalContent?:string; originalReasoning?:string; field?:'content'|'reasoning';
  attachmentNames?:string[]; save:(content:string,reasoning:string)=>Promise<boolean>;
}
/** One retained editing surface. Snapshots never write into an open editor. */
export class MessageEditor {
  readonly dialog:HTMLDialogElement;
  private session:EditorSession|null=null; private field:'content'|'reasoning'='content';
  private mode:'write'|'preview'|'changes'='write'; private timer:ReturnType<typeof setTimeout>|undefined;
  private saving=false;
  constructor(private opened:()=>void,private closed:()=>void){
    this.dialog=document.createElement('dialog');this.dialog.id='edit-dialog';this.dialog.className='message-editor';
    this.dialog.setAttribute('aria-labelledby','editor-title');this.dialog.setAttribute('aria-describedby','editor-note');
    this.dialog.innerHTML=`<header class="modal-head"><div><p class="editor-eyebrow">WORKING COPY</p><h2 id="editor-title"></h2></div><button type="button" data-editor="close" class="icon-button" aria-label="Close editor">×</button></header>
    <div class="editor-fields" role="tablist" aria-label="Message fields"><button role="tab" id="editor-answer-tab" data-editor-field="content" aria-controls="editor-content">Answer</button><button role="tab" id="editor-thinking-tab" data-editor-field="reasoning" aria-controls="editor-reasoning">Thinking</button></div>
    <div class="editor-toolbar"><div class="editor-modes" role="tablist" aria-label="Editor views"><button role="tab" data-editor-mode="write">Write</button><button role="tab" data-editor-mode="preview">Preview</button><button role="tab" data-editor-mode="changes">Changes</button></div><span class="spacer"></span><div class="editor-format"><button data-editor="bold" aria-label="Insert bold text"><b>B</b></button><button data-editor="code" aria-label="Insert code block">&lt;/&gt;</button><button data-editor="math" aria-label="Insert LaTeX equation">∑</button></div></div>
    <p class="editor-note" id="editor-note"></p><div class="editor-attachments hidden" id="editor-attachments"></div>
    <div class="editor-body"><textarea id="editor-content" aria-label="Edit message text" spellcheck="true"></textarea><textarea id="editor-reasoning" aria-label="Edit thinking text" spellcheck="true" hidden></textarea><div id="editor-preview" class="editor-markdown" hidden></div><div id="editor-changes" hidden></div></div>
    <div class="editor-discard" hidden><span>Discard unsaved changes?</span><button data-editor="keep">Keep editing</button><button class="danger" data-editor="discard">Discard changes</button></div>
    <footer class="editor-footer"><div><span id="editor-status" role="status" aria-live="polite"></span><button data-editor="reset" class="editor-reset" title="Restore this field to its original text">Restore original</button></div><div class="editor-footer-actions"><button data-editor="close">Cancel</button><button class="primary" data-editor="save" id="editor-save">Save</button></div></footer>`;
    document.body.append(this.dialog);
    this.dialog.addEventListener('input',()=>{clearTimeout(this.timer);this.timer=setTimeout(()=>this.refresh(),140);});
    this.dialog.addEventListener('cancel',event=>{event.preventDefault();this.requestClose();});
    this.dialog.addEventListener('close',()=>{clearTimeout(this.timer);this.session=null;this.closed();});
    this.dialog.addEventListener('keydown',event=>{
      if(event.isComposing)return;
      if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();void this.save();}
      if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
        const button=(event.target as Element).closest<HTMLButtonElement>('[role=tab]');
        if(button){const tabs=[...button.parentElement!.querySelectorAll<HTMLButtonElement>('button:not([hidden])')];const next=tabs[(tabs.indexOf(button)+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length];event.preventDefault();next?.click();next?.focus();}
      }
    });
    this.dialog.addEventListener('click',event=>{
      const target=(event.target as Element).closest<HTMLElement>('button');if(!target)return;
      if(target.dataset.editorField){this.field=target.dataset.editorField as typeof this.field;this.refresh();return;}
      if(target.dataset.editorMode){this.mode=target.dataset.editorMode as typeof this.mode;this.refresh();return;}
      switch(target.dataset.editor){
        case 'close':this.requestClose();break;
        case 'keep':this.get('editor-discard',true).hidden=true;this.input().focus();break;
        case 'discard':if(!this.saving)this.dialog.close();break;
        case 'save':void this.save();break;
        case 'reset':if(this.session){this.input().value=this.field==='content'?(this.session.originalContent??this.session.content):(this.session.originalReasoning??this.session.reasoning??'');this.refresh();}break;
        case 'bold':this.insert('**','**','text');break;
        case 'code':this.insert('\n```text\n','\n```\n','code');break;
        case 'math':this.insert('$$\n','\n$$','x = 1');break;
      }
    });
  }
  private get<T extends HTMLElement=HTMLElement>(id:string,cls=false):T{return this.dialog.querySelector<T>((cls?'.':'#')+id)!;}
  private input():HTMLTextAreaElement{return this.get('editor-'+this.field);}
  private dirty():boolean {return !!this.session&&(this.get<HTMLTextAreaElement>('editor-content').value!==this.session.content || this.get<HTMLTextAreaElement>('editor-reasoning').value!==(this.session.reasoning??''));}
  open(session:EditorSession):void {
    if(this.dialog.open)return;this.session=session;this.field=session.field??'content';this.mode='write';this.saving=false;
    this.get('editor-title').textContent=session.title;
    this.get<HTMLTextAreaElement>('editor-content').value=session.content;this.get<HTMLTextAreaElement>('editor-content').maxLength=session.kind==='reply'?2000000:160000;
    this.get<HTMLTextAreaElement>('editor-reasoning').value=session.reasoning??'';this.get<HTMLTextAreaElement>('editor-reasoning').maxLength=2000000;
    this.get<HTMLButtonElement>('editor-thinking-tab').hidden=session.kind!=='reply'||!session.reasoning&&!session.originalReasoning;
    this.get('editor-fields',true).classList.toggle('hidden',session.kind!=='reply');
    this.get('editor-save').textContent=session.kind==='draft'?'Save draft':session.kind==='prompt'?'Create branch draft':'Save new branch';
    const files=session.attachmentNames??[];this.get('editor-attachments').hidden=!files.length;this.get('editor-attachments').classList.toggle('hidden',!files.length);this.get('editor-attachments').textContent=files.length?'Attachments retained: '+files.join(' · '):'';
    this.get('editor-discard',true).hidden=true;this.refresh();this.opened();openModal(this.dialog);this.input().focus();
  }
  get hasUnsavedChanges():boolean { return this.dialog.open && this.dirty(); }
  get isSaving():boolean { return this.saving; }
  requestClose():void {if(this.saving)return;if(this.dirty()){this.get('editor-discard',true).hidden=false;this.dialog.querySelector<HTMLButtonElement>('[data-editor=keep]')!.focus();}else this.dialog.close();}
  private insert(before:string,after:string,fallback:string):void {
    const input=this.input();this.mode='write';this.refresh();input.focus();const start=input.selectionStart,end=input.selectionEnd;
    // Native editing commands retain the textarea's browser undo history.
    const inserted=before+(input.value.slice(start,end)||fallback)+after;
    if(!document.execCommand('insertText',false,inserted))input.setRangeText(inserted,start,end,'end');
    this.refresh();
  }
  private refresh():void {
    const s=this.session;if(!s)return;
    this.dialog.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=this.saving);
    this.dialog.querySelectorAll<HTMLTextAreaElement>('textarea').forEach(t=>t.readOnly=this.saving);
    this.dialog.querySelectorAll<HTMLElement>('[data-editor-field]').forEach(b=>{const selected=b.dataset.editorField===this.field;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;});
    this.dialog.querySelectorAll<HTMLElement>('[data-editor-mode]').forEach(b=>{const selected=b.dataset.editorMode===this.mode;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;});
    this.get<HTMLTextAreaElement>('editor-content').hidden=this.mode!=='write'||this.field!=='content';
    this.get<HTMLTextAreaElement>('editor-reasoning').hidden=this.mode!=='write'||this.field!=='reasoning';
    this.get('editor-preview').hidden=this.mode!=='preview';this.get('editor-changes').hidden=this.mode!=='changes';
    this.get('editor-format',true).classList.toggle('hidden',this.mode!=='write');
    this.get('editor-note').textContent=this.field==='reasoning'?'Your edited thinking is a local annotation. It is not new model output and does not change the provider’s reasoning history.':s.kind==='reply'?'Saves a new continuation branch. The original reply and later turns stay in the original thread.':s.kind==='prompt'?'Creates a branch with this draft and its attachments. No message is sent until you press Send.':'Saved to this thread’s composer. Nothing is sent to the model.';
    const value=this.input().value;this.get('editor-status').textContent=(this.dirty()?'Unsaved changes':'No changes')+' · '+value.length.toLocaleString()+' characters';
    this.get<HTMLButtonElement>('editor-save').disabled=this.saving||!this.dirty()||s.kind==='prompt'&&!value.trim();
    if(this.mode==='preview')this.get('editor-preview').innerHTML=markdown(value.slice(0,200000),{math:true,codeTools:false})+(value.length>200000?'<p>Preview limited to the first 200,000 characters. Full text is retained.</p>':'');
    if(this.mode==='changes'){
      const before=this.field==='content'?s.content:s.reasoning??'',span=editSpan(before,value);
      this.get('editor-changes').innerHTML=before===value?'<p>No changes to this field.</p>':`<p class="muted small">Changed region · compared with the text when this editor opened</p><div class="diff-removed"><strong>Removed</strong><pre>${escape(before.slice(span.start,span.oldEnd).slice(0,60000))||'∅'}</pre></div><div class="diff-added"><strong>Added</strong><pre>${escape(value.slice(span.start,span.newEnd).slice(0,60000))||'∅'}</pre></div>${Math.max(span.oldEnd-span.start,span.newEnd-span.start)>60000?'<p>Diff display truncated. Full text is retained.</p>':''}`;
    }
  }
  private async save():Promise<void> {
    if(!this.session||this.saving||!this.dirty())return;this.saving=true;this.refresh();
    try{if(await this.session.save(this.get<HTMLTextAreaElement>('editor-content').value,this.get<HTMLTextAreaElement>('editor-reasoning').value)){this.dialog.close();return;}}
    finally{this.saving=false;this.refresh();}
  }
}
