import { escapeHtml as e } from '../core/markdown.js';
import { modelMatches, pickerModel, type PickerModel } from '../core/model-list.js';
import { customModelRow, makerMark, modelRow } from './model-view.js';
import { openModal } from './modal.js';
import { updateMarkup } from './dom.js';
import { icon } from './icons.js';

/** An exact model ID that may be typed: the characters model IDs use, at most 200 of them (as core/remote.ts allows). */
const EXACT_ID = /^[\w./:@+-]{1,200}$/;

export type CatalogState = 'idle' | 'loading' | 'ready' | 'failed';
/** Public catalog data supplied by the page: display names and makers only, never a claim about the host's access. */
export interface ModelSource { models?: () => PickerModel[]; loadModels?: () => Promise<void>; modelCatalogState?: () => CatalogState }

// The chat page acts on any [data-quick-model] click and would change the open conversation's model, so the shared
// row markup is re-tagged for this picker.
const retag = (html: string): string => html.replace(/ data-quick-model="/g, ' data-remote-model="');
/** Remote jobs need tool calling. Models the catalog marks without it are left out, unless none are marked at all. */
const toolModels = (list: PickerModel[]): PickerModel[] => { const tools = list.filter(m => m.tools); return tools.length ? tools : list; };

/** The model a remote job uses: "default" (the host's configured model) or an exact model ID, chosen in a dialog
 * like Chat's picker but kept apart from any conversation's model. */
export class RemoteModelPicker {
  readonly dialog: HTMLDialogElement;
  private defaultId: string | null = null;
  constructor(container: HTMLElement, private trigger: HTMLButtonElement, private field: HTMLInputElement, private source: ModelSource, private chose: () => void) {
    this.dialog = document.createElement('dialog'); this.dialog.id = 'remote-model-dialog'; this.dialog.className = 'remote-model-dialog';
    this.dialog.setAttribute('aria-labelledby', 'remote-model-title');
    this.dialog.innerHTML = `<div class="modal-head"><h2 id="remote-model-title">Model for remote jobs</h2><button type="button" class="icon-button" data-remote-model-close aria-label="Close model picker">${icon('close')}</button></div>`
      + `<form id="remote-model-form" class="modal-body"><label for="remote-model-search" class="sr-only">Search models</label><input id="remote-model-search" type="search" placeholder="Search models or enter a model ID" autocomplete="off" spellcheck="false" enterkeyhint="go">`
      + `<p id="remote-model-error" class="model-status remote-model-error" role="alert" hidden></p><div id="remote-model-options" class="model-options" role="group" aria-label="Models"></div><p class="small muted remote-model-hint">Names come from Tinfoil’s public model list. The host checks access to the model when a job starts.</p></form>`;
    // Outside the task form: a submit or input inside the dialog must never reach the job form.
    container.append(this.dialog);
    trigger.addEventListener('click', () => this.open());
    const search = this.search;
    search.addEventListener('input', () => { this.error(''); this.renderOptions(); });
    this.dialog.querySelector('form')!.addEventListener('submit', event => {
      event.preventDefault(); event.stopPropagation();
      const typed = search.value.trim(), listed = this.list().some(m => m.id === typed);
      // A listed ID as typed, else the first row (the best match or the typed ID), else the typed text, which choose() checks.
      this.choose(listed ? typed : this.options.querySelector<HTMLElement>('[data-remote-model]')?.dataset.remoteModel ?? typed);
    });
    this.dialog.addEventListener('click', event => {
      const target = event.target as Element;
      if (target === this.dialog) { this.dialog.close(); return; } // A click on the backdrop.
      if (target.closest('[data-remote-model-close]')) { this.dialog.close(); return; }
      const row = target.closest<HTMLElement>('[data-remote-model]');
      if (row?.dataset.remoteModel) this.choose(row.dataset.remoteModel);
    });
    this.dialog.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const rows = [...this.options.querySelectorAll<HTMLElement>('[data-remote-model]')], at = rows.indexOf(document.activeElement as HTMLElement);
      if (!rows.length || (at < 0 && document.activeElement !== search)) return;
      event.preventDefault();
      const next = event.key === 'ArrowDown' ? Math.min(at + 1, rows.length - 1) : at - 1;
      (next < 0 ? search : rows[next]!).focus();
    });
    this.dialog.addEventListener('close', () => { if (this.trigger.isConnected && !this.trigger.closest('[hidden]')) this.trigger.focus(); });
  }
  private get search(): HTMLInputElement { return this.dialog.querySelector<HTMLInputElement>('#remote-model-search')!; }
  private get options(): HTMLElement { return this.dialog.querySelector<HTMLElement>('#remote-model-options')!; }
  private list(): PickerModel[] { return toolModels(this.source.models?.() ?? []); }
  /** The catalog entry for an exact ID, or an unlisted entry that shows the ID itself. */
  model(id: string): PickerModel { return this.source.models?.().find(m => m.id === id) ?? pickerModel(id); }
  /** Draws the trigger: maker mark, the model's name, a Host default tag when it applies, and a chevron. */
  render(defaultId: string | null): void {
    this.defaultId = defaultId;
    const value = this.field.value.trim() || 'default', isDefault = value === 'default', id = isDefault ? defaultId : value, model = id ? this.model(id) : null;
    const name = model?.name ?? 'Host default';
    updateMarkup(this.trigger, `${makerMark(model, 'maker-badge')}<span class="model-label">${e(name)}</span>${isDefault && model ? '<span class="remote-model-tag">Host default</span>' : ''}<span class="model-chevron" aria-hidden="true">${icon('down')}</span>`);
    this.trigger.setAttribute('aria-label', `Model: ${name}${isDefault ? ', the host default' : ''}. Choose model`);
    this.trigger.title = id && model?.name !== id ? `${name} (${id})` : name;
    if (this.dialog.open) this.renderOptions();
  }
  open(): void {
    if (this.trigger.disabled) return;
    this.search.value = ''; this.error(''); this.renderOptions(); openModal(this.dialog);
    if (!matchMedia('(pointer: coarse)').matches) this.search.focus();
    const state = this.source.modelCatalogState?.();
    // Also while loading: the page's catalog request coalesces, and this redraws the rows when it settles.
    if (this.source.loadModels && state !== 'ready')
      void this.source.loadModels().catch(() => {}).finally(() => { this.renderOptions(); this.render(this.defaultId); });
  }
  /** Accepts the host default, a listed model or a well-formed exact ID; anything else stays in the dialog with a note,
   * and the current choice and the draft are left as they were. */
  private choose(id: string): void {
    if (!id) return;
    if (id !== 'default' && !this.list().some(m => m.id === id) && !EXACT_ID.test(id)) {
      this.error(id.length > 200 ? 'Model IDs are at most 200 characters.' : 'Model IDs use only letters, digits and . / : @ + - _ characters.');
      return;
    }
    this.error(''); this.field.value = id; this.dialog.close(); this.render(this.defaultId); this.chose();
  }
  private error(message: string): void { const note = this.dialog.querySelector<HTMLElement>('#remote-model-error')!; note.hidden = !message; note.textContent = message; if (message) this.search.focus(); }
  private renderOptions(): void {
    const query = this.search.value, typed = query.trim(), list = this.list(), current = this.field.value.trim() || 'default';
    const shown = list.filter(m => modelMatches(m, query)), state = this.source.modelCatalogState?.() ?? (this.source.models ? 'ready' : 'idle');
    const fallback = this.defaultId ? this.model(this.defaultId) : null;
    const showDefault = !typed || /default|host/i.test(typed) || (!!fallback && modelMatches(fallback, query));
    const defaultRow = showDefault ? `<button type="button" class="model-option remote-default-option" data-remote-model="default" aria-label="${e(`Host default${fallback ? `, ${fallback.name}` : ''}${current === 'default' ? ', current model' : ''}`)}"${current === 'default' ? ' aria-current="true"' : ''}>`
      + `${makerMark(fallback, 'maker-badge')}<span class="option-text"><span class="option-title"><span class="option-name">Host default</span></span><span class="option-detail">${e(fallback ? `${fallback.name} · set on this host` : 'The model configured on this host')}</span></span><span class="option-check">${current === 'default' ? icon('check') : ''}</span></button>` : '';
    const status = !list.length ? (state === 'failed' ? 'Tinfoil’s model list could not be loaded. Use the host default or enter a model ID.' : state === 'loading' ? 'Loading Tinfoil’s models…' : 'No models are listed. Use the host default or enter a model ID.')
      : !shown.length && typed && !showDefault ? `No listed model matches “${e(typed)}”.` : '';
    const custom = typed && typed.toLowerCase() !== 'default' && !list.some(m => m.id === typed) && EXACT_ID.test(typed) && (!shown.length || /[-/.:@\d]/.test(typed));
    updateMarkup(this.options, (status ? `<p class="model-status" role="status">${status}</p>` : '') + defaultRow
      + retag(shown.map(m => modelRow(m, current)).join('') + (custom ? customModelRow(typed) : '')));
  }
}
