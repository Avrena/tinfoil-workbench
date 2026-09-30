import type { Reply } from '../core/types.js';

export interface InlineEdit {
  threadId: string; turnId: string; replyId: string;
  /** The reply's text when editing began; a snapshot that changes it is refused when saving (core/editing.ts). */
  content: string; reasoning: string;
  draftContent: string; draftReasoning: string; focus: 'content' | 'reasoning';
}
/** Edits an answer and its thinking text where they are shown: the thinking inside its Reasoning box, the answer in place
 * of its text, and Save and Cancel in place of the reply's actions. Saving makes a new version of the turn
 * (core/editing.ts), so the answer as it was stays one arrow away. The fields keep their text across redraws and
 * conversation switches; snapshots never write into them. Thinking that is not shown (Reading & visibility hides it)
 * is kept as it is. */
export class InlineReplyEditor {
  session: InlineEdit | null = null;
  private saving = false; private reasoningWasOpen = false;
  constructor(private save: (edit: InlineEdit) => Promise<boolean>, private closed: (edit: InlineEdit) => void) {}
  open(threadId: string, turnId: string, reply: Reply, focus: 'content' | 'reasoning'): void {
    this.session = { threadId, turnId, replyId: reply.id, content: reply.content, reasoning: reply.reasoning,
      draftContent: reply.content, draftReasoning: reply.reasoning, focus };
  }
  editing(threadId: string, replyId: string): boolean { return this.session?.threadId === threadId && this.session.replyId === replyId; }
  mounted(node: HTMLElement): boolean { return !!node.querySelector('[data-inline-part]'); }
  get isSaving(): boolean { return this.saving; }
  get dirty(): boolean { const s = this.session; return !!s && (s.draftContent !== s.content || s.draftReasoning !== s.reasoning); }
  /** Puts the fields into a drawn reply. The parts it hides come back when the editor closes. */
  mount(node: HTMLElement): void {
    const s = this.session; if (!s || this.mounted(node)) return;
    const hide = (el: Element | null): void => { if (el instanceof HTMLElement) { el.hidden = true; el.dataset.inlineHidden = ''; } };
    const reasoning = node.querySelector<HTMLDetailsElement>('details.reasoning');
    if (reasoning) {
      this.reasoningWasOpen = reasoning.open; reasoning.open = true;
      reasoning.querySelectorAll('.reasoning-content,.reasoning-actions').forEach(hide);
      reasoning.insertAdjacentHTML('beforeend', `<div class="inline-field" data-inline-part><textarea id="inline-reasoning" class="inline-editor-text inline-thinking" aria-label="Thinking text" aria-describedby="inline-thinking-note" spellcheck="true" maxlength="2000000"></textarea><p class="inline-field-note" id="inline-thinking-note">A local note: edited thinking is not sent to the model.</p></div>`);
    }
    const answer = node.querySelector('.reply-content'); hide(answer);
    answer?.insertAdjacentHTML('afterend', `<textarea id="inline-content" class="inline-editor-text inline-answer" data-inline-part aria-label="Answer" spellcheck="true" maxlength="2000000"></textarea>`);
    const footer = node.querySelector('.reply-footer'); hide(footer);
    footer?.insertAdjacentHTML('beforebegin', `<div class="inline-editor" data-inline-part>
      <div class="inline-editor-discard" hidden><span>Discard your changes?</span><button type="button" data-action="inline-keep">Keep editing</button><button type="button" class="danger" data-action="inline-discard">Discard</button></div>
      <span class="inline-editor-note">Saving keeps the answer as it was, and the messages after it, as the version before.</span><span class="inline-editor-status sr-only" role="status" aria-live="polite"></span>
      <button type="button" data-action="inline-cancel">Cancel</button><button type="button" class="primary" data-action="inline-save">Save as new version</button></div>`);
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
    const focus = node.querySelector<HTMLTextAreaElement>(s.focus === 'reasoning' && reasoning ? '#inline-reasoning' : '#inline-content');
    focus?.focus({ preventScroll: true }); focus?.scrollIntoView({ block: 'nearest' });
  }
  private node(): HTMLElement | null { return this.session ? document.getElementById('reply-' + this.session.replyId) : null; }
  private refresh(node = this.node()): void {
    if (!node) return;
    const status = node.querySelector('.inline-editor-status'); if (status) status.textContent = this.saving ? 'Saving…' : this.dirty ? 'Unsaved changes' : 'No changes';
    const save = node.querySelector<HTMLButtonElement>('[data-action=inline-save]'); if (save) save.disabled = this.saving || !this.dirty;
    node.querySelectorAll<HTMLTextAreaElement>('#inline-content,#inline-reasoning').forEach(t => { t.readOnly = this.saving; });
  }
  /** Escape, Cancel and Android Back: closes at once without changes, otherwise asks first. */
  requestClose(): void {
    if (this.saving) return;
    const discard = this.node()?.querySelector<HTMLElement>('.inline-editor-discard');
    if (this.dirty && discard) { discard.hidden = false; discard.querySelector<HTMLButtonElement>('[data-action=inline-keep]')?.focus(); }
    else this.close();
  }
  keep(): void { const node = this.node(); if (!node) return; node.querySelector<HTMLElement>('.inline-editor-discard')!.hidden = true; node.querySelector<HTMLTextAreaElement>('#inline-content')?.focus(); }
  close(): void {
    const s = this.session; if (this.saving || !s) return;
    const node = this.node();
    if (node) {
      node.querySelectorAll('[data-inline-part]').forEach(part => part.remove());
      node.querySelectorAll<HTMLElement>('[data-inline-hidden]').forEach(el => { el.hidden = false; delete el.dataset.inlineHidden; });
      const reasoning = node.querySelector<HTMLDetailsElement>('details.reasoning'); if (reasoning) reasoning.open = this.reasoningWasOpen;
    }
    this.session = null; this.closed(s);
  }
  async commit(): Promise<void> {
    if (!this.session || this.saving || !this.dirty) return;
    this.saving = true; this.refresh();
    try { if (await this.save(this.session)) { this.saving = false; this.close(); } }
    finally { this.saving = false; this.refresh(); }
  }
}
/** Grows a field with its text, so it never scrolls inside itself; the conversation scrolls instead. */
function fit(field: HTMLTextAreaElement): void {
  field.style.height = 'auto';
  field.style.height = `${field.scrollHeight + 2}px`;
}
