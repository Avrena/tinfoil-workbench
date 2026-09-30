import type { Reply } from '../core/types.js';

export interface InlineEdit {
  threadId: string; turnId: string; replyId: string;
  /** The reply's text when editing began; a snapshot that changes it is refused when saving (core/editing.ts). */
  content: string; reasoning: string; thinking: boolean;
  draftContent: string; draftReasoning: string; focus: 'content' | 'reasoning';
}
/** Edits an answer and its thinking text where the reply is shown. Saving makes a new version of the turn (core/editing.ts),
 * so the answer as it was stays one arrow away. The fields keep their text across redraws and conversation switches;
 * snapshots never write into them. */
export class InlineReplyEditor {
  session: InlineEdit | null = null;
  private saving = false;
  constructor(private save: (edit: InlineEdit) => Promise<boolean>, private closed: (edit: InlineEdit) => void) {}
  open(threadId: string, turnId: string, reply: Reply, focus: 'content' | 'reasoning'): void {
    this.session = { threadId, turnId, replyId: reply.id, content: reply.content, reasoning: reply.reasoning,
      thinking: !!reply.reasoning || !!reply.edit?.originalReasoning, draftContent: reply.content, draftReasoning: reply.reasoning, focus };
  }
  editing(threadId: string, replyId: string): boolean { return this.session?.threadId === threadId && this.session.replyId === replyId; }
  get isSaving(): boolean { return this.saving; }
  get dirty(): boolean { const s = this.session; return !!s && (s.draftContent !== s.content || s.draftReasoning !== s.reasoning); }
  /** Draws the fields in the reply's place, unless they are there already. */
  mount(node: HTMLElement): void {
    const s = this.session; if (!s || node.querySelector('[data-inline-editor]')) return;
    node.innerHTML = `<div class="inline-editor" data-inline-editor>
      <p class="inline-editor-note">Saving keeps this answer as it was, and the messages after it, as the version before.</p>
      ${s.thinking ? `<label class="inline-editor-label" for="inline-reasoning">Thinking <small>A local note: it is not sent to the model</small></label>
      <textarea id="inline-reasoning" class="inline-editor-text" spellcheck="true" maxlength="2000000"></textarea>` : ''}
      <label class="inline-editor-label" for="inline-content">Answer</label>
      <textarea id="inline-content" class="inline-editor-text" spellcheck="true" maxlength="2000000"></textarea>
      <div class="inline-editor-discard" hidden><span>Discard your changes?</span><button type="button" data-action="inline-keep">Keep editing</button><button type="button" class="danger" data-action="inline-discard">Discard</button></div>
      <div class="inline-editor-actions"><span class="inline-editor-status" role="status" aria-live="polite"></span><button type="button" data-action="inline-cancel">Cancel</button><button type="button" class="primary" data-action="inline-save">Save as new version</button></div>
    </div>`;
    const fields: [string, 'draftContent' | 'draftReasoning'][] = [['inline-content', 'draftContent'], ['inline-reasoning', 'draftReasoning']];
    for (const [id, key] of fields) {
      const field = node.querySelector<HTMLTextAreaElement>('#' + id); if (!field) continue;
      field.value = s[key]; fit(field);
      field.addEventListener('input', () => { if (this.session) this.session[key] = field.value; fit(field); this.refresh(node); });
      field.addEventListener('keydown', event => {
        if (event.isComposing) return;
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void this.commit(); }
        else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.requestClose(); }
      });
    }
    this.refresh(node);
    const focus = node.querySelector<HTMLTextAreaElement>(s.focus === 'reasoning' && s.thinking ? '#inline-reasoning' : '#inline-content');
    focus?.focus({ preventScroll: true }); focus?.scrollIntoView({ block: 'nearest' });
  }
  private node(): HTMLElement | null { return document.querySelector<HTMLElement>('[data-inline-editor]'); }
  private refresh(node = this.node()): void {
    if (!node) return;
    const status = node.querySelector('.inline-editor-status'); if (status) status.textContent = this.saving ? 'Saving…' : this.dirty ? 'Unsaved changes' : 'No changes';
    const save = node.querySelector<HTMLButtonElement>('[data-action=inline-save]'); if (save) save.disabled = this.saving || !this.dirty;
    node.querySelectorAll<HTMLTextAreaElement>('textarea').forEach(t => { t.readOnly = this.saving; });
  }
  /** Escape, Cancel and Android Back: closes at once without changes, otherwise asks first. */
  requestClose(): void {
    if (this.saving) return;
    const discard = this.node()?.querySelector<HTMLElement>('.inline-editor-discard');
    if (this.dirty && discard) { discard.hidden = false; discard.querySelector<HTMLButtonElement>('[data-action=inline-keep]')?.focus(); }
    else this.close();
  }
  keep(): void { const node = this.node(); if (!node) return; node.querySelector<HTMLElement>('.inline-editor-discard')!.hidden = true; node.querySelector<HTMLTextAreaElement>('#inline-content')?.focus(); }
  close(): void { const s = this.session; if (this.saving || !s) return; this.session = null; this.closed(s); }
  async commit(): Promise<void> {
    if (!this.session || this.saving || !this.dirty) return;
    this.saving = true; this.refresh();
    try { if (await this.save(this.session)) { this.saving = false; this.close(); } }
    finally { this.saving = false; this.refresh(); }
  }
}
/** Grows a field with its text, up to most of the window; longer text scrolls inside it. */
function fit(field: HTMLTextAreaElement): void {
  field.style.height = 'auto';
  field.style.height = `${Math.min(Math.max(field.scrollHeight + 2, 72), Math.round(innerHeight * 0.7))}px`;
}
