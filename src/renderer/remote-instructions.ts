import type { InstructionPreset } from '../core/types.js';
import { STARTER_INSTRUCTIONS, activeInstructions, instructionExcerpt } from '../core/instructions.js';
import { escapeHtml as e } from '../core/markdown.js';
import { openModal } from './modal.js';
import { icon } from './icons.js';

export interface InstructionSource { instructionPresets?: () => readonly InstructionPreset[] }
export interface RemoteInstructionsValue { text: string; name: string }
const NAME_MAX = 80;

/** System instructions for remote tasks: a copy kept in the host's task draft. Choosing a saved or starter entry copies
 * its name and text; editing the text makes it unnamed custom instructions. Nothing here reads a chat's instructions or
 * changes the saved library, and later library edits never reach the copy. The editor writes into the draft as it is
 * typed in, so closing the dialog never loses text. */
export class RemoteInstructions {
  readonly dialog: HTMLDialogElement;
  private value: RemoteInstructionsValue = { text: '', name: '' };
  private locked = false;
  constructor(container: HTMLElement, private chip: HTMLButtonElement, private source: InstructionSource, private changed: () => void) {
    this.dialog = document.createElement('dialog'); this.dialog.id = 'remote-instructions-dialog'; this.dialog.className = 'remote-dialog remote-instructions-dialog';
    this.dialog.setAttribute('aria-labelledby', 'remote-instructions-title');
    this.dialog.innerHTML = `<div class="modal-head"><h2 id="remote-instructions-title">System instructions · remote tasks</h2><button type="button" class="icon-button" data-remote-close aria-label="Close system instructions">${icon('close')}</button></div><div class="modal-body">`
      + `<div id="remote-instructions-list-view"><p class="instructions-intro">Added to the remote agent’s built-in workspace instructions for each new task on this host; they don’t replace them. None adds nothing. Chat conversations keep their own instructions.</p>`
      + `<div id="remote-instructions-list" class="instruction-options" role="group" aria-label="Instructions for remote tasks"></div>`
      + `<div class="modal-actions"><button type="button" id="remote-instructions-write">${icon('write')}<span>Write instructions</span></button><button type="button" class="primary" data-remote-close>Done</button></div></div>`
      + `<div id="remote-instructions-editor" class="instructions-form" hidden><label for="remote-systemPrompt">System instructions <span class="field-optional">Optional</span></label>`
      + `<textarea id="remote-systemPrompt" maxlength="40000" rows="10" placeholder="How should the remote agent approach tasks on this host?" aria-describedby="remote-instructions-count remote-instructions-storage"></textarea>`
      + `<p class="instructions-count" id="remote-instructions-count" role="status"></p><p class="instructions-note" id="remote-instructions-storage">Saved with this host’s task draft on this PC as you type. Each job keeps the text it started with.</p>`
      + `<div class="modal-actions"><button type="button" id="remote-instructions-back">${icon('left')}<span>All instructions</span></button><button type="button" class="primary" id="remote-instructions-done">Done</button></div></div></div>`;
    container.append(this.dialog);
    chip.addEventListener('click', () => this.open());
    this.dialog.addEventListener('click', event => {
      const target = event.target as Element;
      if (target === this.dialog || target.closest('[data-remote-close],#remote-instructions-done')) { this.dialog.close(); return; }
      if (target.closest('#remote-instructions-back')) { this.showList(); return; }
      if (target.closest('#remote-instructions-write')) { this.showEditor(); return; }
      const edit = target.closest<HTMLElement>('[data-remote-instructions-edit]');
      if (edit) { const entry = this.entry(edit.dataset.remoteInstructionsEdit!); if (entry) { this.set(entry.text, entry.name); } this.showEditor(); return; }
      const row = target.closest<HTMLElement>('[data-remote-instructions]');
      if (row && !row.matches(':disabled')) {
        const entry = this.entry(row.dataset.remoteInstructions!);
        if (entry) { this.set(entry.text, entry.name); this.dialog.close(); }
      }
    });
    this.editor.addEventListener('input', () => { this.set(this.editor.value, ''); this.renderCount(); });
    this.dialog.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const rows = [...this.dialog.querySelectorAll<HTMLElement>('#remote-instructions-list .instruction-option:not(:disabled)')], at = rows.indexOf(document.activeElement as HTMLElement);
      if (at < 0) return;
      event.preventDefault(); rows[Math.max(0, Math.min(rows.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))]!.focus();
    });
    this.dialog.addEventListener('close', () => { this.showList(false); if (this.chip.isConnected && !this.chip.closest('[hidden]')) this.chip.focus(); });
  }
  private get editor(): HTMLTextAreaElement { return this.dialog.querySelector<HTMLTextAreaElement>('#remote-systemPrompt')!; }
  get current(): RemoteInstructionsValue { return { ...this.value }; }
  private presets(): readonly InstructionPreset[] { return this.source.instructionPresets?.() ?? []; }
  /** What a list key stands for, read at the moment it is chosen, so a library change while the dialog is open is respected. */
  private entry(key: string): RemoteInstructionsValue | null {
    if (key === 'none') return { text: '', name: '' };
    if (key === 'current') return this.current;
    const split = key.indexOf(':'), kind = key.slice(0, split), id = key.slice(split + 1);
    const preset = kind === 'saved' ? this.presets().find(p => p.id === id) : kind === 'starter' ? STARTER_INSTRUCTIONS.find(p => p.id === id) : undefined;
    return preset ? { text: preset.text, name: preset.name.slice(0, NAME_MAX) } : null;
  }
  /** Takes a stored draft's instructions. */
  hydrate(text: string, name: string): void { this.value = { text, name: text.trim() ? name : '' }; if (this.editor.value !== text) this.editor.value = text; this.render(); }
  /** Called on every redraw of the page; the list is drawn again only when the lock changes, so focus in it survives polls. */
  setLocked(locked: boolean): void {
    if (locked === this.locked) return;
    this.locked = locked; this.chip.disabled = locked; this.editor.readOnly = locked; if (this.dialog.open) this.renderList();
  }
  private set(text: string, name: string): void {
    const next = { text, name: text.trim() ? name : '' };
    if (next.text === this.value.text && next.name === this.value.name) return;
    this.value = next; if (this.editor.value !== text) this.editor.value = text;
    this.render(); this.changed();
  }
  open(): void {
    if (this.chip.disabled) return;
    this.showList(false); openModal(this.dialog);
    (this.dialog.querySelector<HTMLElement>('#remote-instructions-list [aria-current=true]') ?? this.dialog.querySelector<HTMLElement>('#remote-instructions-list button'))?.focus();
  }
  private showList(focus = true): void {
    this.dialog.querySelector<HTMLElement>('#remote-instructions-editor')!.hidden = true;
    this.dialog.querySelector<HTMLElement>('#remote-instructions-list-view')!.hidden = false;
    this.renderList();
    if (focus) (this.dialog.querySelector<HTMLElement>('#remote-instructions-list [aria-current=true]') ?? this.dialog.querySelector<HTMLElement>('#remote-instructions-write'))?.focus();
  }
  private showEditor(): void {
    this.dialog.querySelector<HTMLElement>('#remote-instructions-list-view')!.hidden = true;
    this.dialog.querySelector<HTMLElement>('#remote-instructions-editor')!.hidden = false;
    if (this.editor.value !== this.value.text) this.editor.value = this.value.text;
    this.renderCount(); this.editor.focus();
  }
  private renderCount(): void {
    const n = this.editor.value.length, name = this.value.name;
    this.dialog.querySelector<HTMLElement>('#remote-instructions-count')!.textContent = `${n.toLocaleString()} / 40,000 characters${name ? ` · from “${name}”; editing makes it custom` : n ? '' : ' · empty means none'}`;
  }
  private renderList(): void {
    const saved = this.presets(), active = activeInstructions({ systemPrompt: this.value.text, systemPromptName: this.value.name }, saved);
    const current = (kind: 'saved' | 'starter', p: InstructionPreset) => active.kind === kind && active.preset.id === p.id;
    const row = (key: string, title: string, detail: string, on: boolean, edit?: { label: string; glyph: string }) =>
      `<div class="instruction-row" data-key="${e(key)}"><button type="button" class="instruction-option" data-remote-instructions="${e(key)}" aria-current="${on}"${this.locked && !on ? ' disabled' : ''}><span class="instruction-copy"><strong>${e(title)}</strong><small>${e(detail)}</small></span>${on ? `<span class="instruction-check" aria-hidden="true">${icon('check')}</span>` : ''}</button>`
      + (edit ? `<button type="button" class="icon-button instruction-edit" data-remote-instructions-edit="${e(key)}" title="${e(edit.label)}" aria-label="${e(edit.label)}"${this.locked ? ' disabled' : ''}>${icon(edit.glyph)}</button>` : '') + '</div>';
    const custom = active.kind === 'custom' ? `<h3 class="instruction-heading">For remote tasks</h3>${row('current', active.name || 'Custom instructions', instructionExcerpt(active.text), true, { label: 'Edit these instructions', glyph: 'write' })}` : '';
    const own = saved.length ? saved.map(p => row('saved:' + p.id, p.name, instructionExcerpt(p.text), current('saved', p), { label: `Customize a copy of “${p.name}”`, glyph: 'copy' })).join('')
      : '<p class="instruction-empty">Instructions you save in Chat appear here too.</p>';
    const starters = STARTER_INSTRUCTIONS.map(p => row('starter:' + p.id, p.name, instructionExcerpt(p.text), current('starter', p), { label: `Customize a copy of “${p.name}”`, glyph: 'copy' })).join('');
    const list = this.dialog.querySelector<HTMLElement>('#remote-instructions-list')!;
    list.innerHTML = row('none', 'None', 'Only the remote agent’s built-in workspace instructions.', active.kind === 'none') + custom + `<h3 class="instruction-heading">Saved</h3>${own}<h3 class="instruction-heading">Starters</h3>${starters}`;
    this.dialog.querySelector<HTMLElement>('#remote-instructions-write span')!.textContent = active.kind === 'none' ? 'Write instructions' : 'Edit the text';
  }
  /** The composer chip: the name, Custom, or nothing for None, as Chat's chip shows it. */
  render(): void {
    const set = !!this.value.text.trim(), name = set ? this.value.name || 'Custom' : '';
    this.chip.querySelector<HTMLElement>('#remote-instructions-name')!.textContent = name;
    const label = set ? `System instructions for remote tasks: ${this.value.name || 'custom instructions'}. Change instructions` : 'System instructions for remote tasks: none. Choose instructions';
    this.chip.classList.toggle('is-set', set); this.chip.title = label; this.chip.setAttribute('aria-label', label);
    if (this.dialog.open && !this.dialog.querySelector<HTMLElement>('#remote-instructions-list-view')!.hidden) this.renderList();
  }
}
