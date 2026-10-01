import type { Command, TagColor, TagDef, TagIcon, TagStyle, Tagging, TaggingStatus, Thread } from '../core/types.js';
import { PRESET_TAGS, TAG_COLORS, TAG_COLOR_NAMES, TAG_ICONS, TAG_ICON_NAMES, TAG_LIMITS, TAG_STYLES, TAG_STYLE_NAMES, tagLetter, taggable, threadTags, untagged } from '../core/tags.js';
import type { PickerModel } from '../core/model-list.js';
import { escapeHtml as e } from '../core/markdown.js';
import { icon } from './icons.js';

/** A tag's icon, or the first letter of its name when it has none. */
const tagGlyph = (tag: Pick<TagDef, 'name' | 'icon'>): string => tag.icon ? icon(tag.icon) : e(tagLetter(tag.name));
/** A tag as a chip in its colour and style (style.css draws them by `data-color` and `data-style`; the dot shows only
 * in the dot style). Its glyph takes the name's place where names do not fit, as in the title bar and the sidebar on a
 * phone (spacing.css), and in a `glyph` chip; the name stays for screen readers. */
export function tagChip(tag: Pick<TagDef, 'name' | 'color' | 'style' | 'icon'>, glyph = false): string {
  return `<span class="tag-chip${glyph ? ' glyph' : ''}" data-color="${tag.color}" data-style="${tag.style}"><span class="tag-dot" aria-hidden="true"></span>`
    + `<span class="tag-glyph" aria-hidden="true">${tagGlyph(tag)}</span><span class="tag-name">${e(tag.name)}</span></span>`;
}
/** A conversation's tags in the list's order: the first `max` as chips, then how many more there are. */
export function tagChips(thread: Thread, tagging: Tagging, max = 2): string {
  const tags = threadTags(thread, tagging), more = tags.length - max;
  return tags.slice(0, max).map(tag => tagChip(tag)).join('')
    + (more > 0 ? `<span class="tag-more" title="${e(tags.slice(max).map(t => t.name).join(', '))}">+${more}</span>` : '');
}
/** A new tag in the first colour and style that no tag in the list has (filled first), so that it looks like no other. */
export function newTag(tagging: Tagging, name: string): TagDef {
  let look: Pick<TagDef, 'color' | 'style'> = { color: TAG_COLORS[tagging.tags.length % TAG_COLORS.length]!, style: 'fill' };
  found: for (const style of TAG_STYLES) for (const color of TAG_COLORS) if (!tagging.tags.some(t => t.color === color && t.style === style)) { look = { color, style }; break found; }
  return { id: `tag-${crypto.randomUUID()}`, name, ...look, hint: '' };
}
const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString()} ${n === 1 ? one : many}`;
/** What the classifier is doing, for Settings → Tags. */
function statusText(status: TaggingStatus | undefined, threads: Thread[], tagging: Tagging): string {
  if (!status) return '';
  const parts: string[] = [];
  if (status.running || status.queued) parts.push(`Tagging ${Math.min(status.done + status.failed + 1, status.total).toLocaleString()} of ${status.total.toLocaleString()}…`);
  else if (status.total) parts.push(`Tagged ${status.done.toLocaleString()} of ${count(status.total, 'conversation')}${status.failed ? `; ${status.failed.toLocaleString()} failed` : ''}.`);
  if (status.error) parts.push(status.error);
  if (status.usage.input || status.usage.output) parts.push(`Tagging used ${(status.usage.input + status.usage.output).toLocaleString()} tokens since Workbench started.`);
  else if (tagging.enabled && !status.total) { const n = threads.filter(untagged).length; if (n) parts.push(`${count(n, 'conversation')} without tags.`); }
  return parts.join(' ');
}

interface TagSettingsHost {
  /** Stores a changed list or setting (`tagging.set`); false when it was refused, and the page shows why. */
  save(tagging: Tagging): Promise<boolean>;
  command(command: Command): Promise<boolean>;
}
/** Settings → Tags: whether a model tags and titles new conversations, which model, and the list itself. The switches
 * and the model are fixed controls whose values follow the workspace; the list is drawn again only when it changes, and
 * keeps the focused field. Names and hints are stored when a field is left or Enter is pressed. */
export class TagSettings {
  private tagging: Tagging | null = null;
  private threads: Thread[] = [];
  private listSignature = '';
  private colorOpen: string | null = null;
  private removing: string | null = null;
  private focusNext: { id: string; field: 'name' | 'hint' | 'color' } | null = null;
  constructor(private readonly root: HTMLElement, private readonly host: TagSettingsHost) {
    root.innerHTML = `<label class="toggle-row"><span>Tag and title new conversations</span><input type="checkbox" id="tagging-on"></label>
<p class="muted small" id="tagging-about">After a conversation’s first answer, a model files it under the tag that fits best (up to three when it is mainly about more than one) and gives it a short title, unless you renamed it. It reads the first message, the names of its files and the start of the answer: one short request each. Tags stay on this device, also for Tinfoil cloud chats.</p>
<div class="tagging-options" id="tagging-options" hidden><label for="tagging-model">Model</label><select id="tagging-model"></select>
<label class="toggle-row"><span>Also write titles</span><input type="checkbox" id="tagging-titles"></label>
<div class="tagging-run"><button type="button" data-tag-action="all" id="tagging-all">Tag untagged conversations</button><button type="button" data-tag-action="stop" id="tagging-stop" hidden>Stop</button></div></div>
<p class="muted small tagging-status" id="tagging-status" role="status"></p>
<div class="tag-list" id="tag-list" role="list" aria-label="Tags"></div>
<div class="tag-list-actions"><button type="button" data-tag-action="add" id="tag-add">${icon('plus')}Add tag</button><button type="button" data-tag-action="presets" id="tag-presets">Restore presets</button></div>`;
    root.addEventListener('change', event => void this.changed(event.target as HTMLElement));
    root.addEventListener('click', event => void this.clicked(event.target as HTMLElement));
  }
  render(tagging: Tagging, threads: Thread[], status: TaggingStatus | undefined, models: PickerModel[]): void {
    this.tagging = tagging; this.threads = threads;
    const $ = <T extends HTMLElement>(id: string): T => this.root.querySelector<T>(`#${id}`)!;
    $<HTMLInputElement>('tagging-on').checked = tagging.enabled; $<HTMLInputElement>('tagging-titles').checked = tagging.titles;
    $('tagging-options').hidden = !tagging.enabled;
    // The conversation's own model first, then the chat models Workbench knows; a chosen model it no longer lists stays.
    const select = $<HTMLSelectElement>('tagging-model'), options = [['', 'The conversation’s model'], ...models.map(m => [m.id, m.name])];
    if (tagging.model && !models.some(m => m.id === tagging.model)) options.push([tagging.model, tagging.model]);
    const markup = options.map(([id, name]) => `<option value="${e(id!)}">${e(name!)}</option>`).join('');
    if (select.dataset.markup !== markup) { select.innerHTML = markup; select.dataset.markup = markup; }
    select.value = tagging.model;
    const busy = !!status && (!!status.running || status.queued > 0);
    $<HTMLButtonElement>('tagging-all').disabled = busy || !threads.some(untagged); $('tagging-stop').hidden = !busy;
    $('tagging-status').textContent = statusText(status, threads, tagging);
    $<HTMLButtonElement>('tag-presets').disabled = PRESET_TAGS.every(p => tagging.tags.some(t => t.id === p.id)) || tagging.tags.length >= TAG_LIMITS.tags;
    $<HTMLButtonElement>('tag-add').disabled = tagging.tags.length >= TAG_LIMITS.tags;
    $<HTMLButtonElement>('tag-add').title = tagging.tags.length >= TAG_LIMITS.tags ? `At most ${TAG_LIMITS.tags} tags` : '';
    this.renderList();
  }
  private renderList(): void {
    const tagging = this.tagging!, list = this.root.querySelector<HTMLElement>('#tag-list')!;
    const signature = JSON.stringify([tagging.tags, this.colorOpen, this.removing]);
    if (signature === this.listSignature) return;
    // A field being typed in keeps its place: the same field is focused again after drawing.
    const active = list.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const focus = this.focusNext ?? (active?.dataset.tagField ? { id: active.closest<HTMLElement>('[data-tag]')!.dataset.tag!, field: active.dataset.tagField as 'name' | 'hint' | 'color' } : null);
    this.listSignature = signature; this.focusNext = null;
    list.innerHTML = tagging.tags.map(tag => this.row(tag)).join('') || '<p class="muted small">No tags. Add one, or restore the presets.</p>';
    if (focus) list.querySelector<HTMLElement>(`[data-tag="${CSS.escape(focus.id)}"] [data-tag-field="${focus.field}"]`)?.focus();
  }
  private row(tag: TagDef): string {
    const id = e(tag.id), open = this.colorOpen === tag.id;
    const used = this.threads.filter(t => t.tags?.includes(tag.id)).length;
    return `<div class="tag-row" role="listitem" data-tag="${id}" data-color="${tag.color}">
<button type="button" class="tag-look" data-tag-field="color" aria-expanded="${open}" aria-label="Look of ${e(tag.name)}: ${TAG_COLOR_NAMES[tag.color]}, ${TAG_STYLE_NAMES[tag.style].toLowerCase()}, ${tag.icon ? `${TAG_ICON_NAMES[tag.icon].toLowerCase()} icon` : 'first letter'}" title="Colour, style and icon">${tagChip(tag, true)}</button>
<input class="tag-name-input" data-tag-field="name" value="${e(tag.name)}" maxlength="${TAG_LIMITS.name}" aria-label="Tag name" autocomplete="off" spellcheck="false">
<input class="tag-hint-input" data-tag-field="hint" value="${e(tag.hint)}" maxlength="${TAG_LIMITS.hint}" aria-label="What belongs under ${e(tag.name)}" placeholder="What belongs here (for the model)" autocomplete="off">
<button type="button" class="icon-button" data-tag-action="remove" aria-label="Remove ${e(tag.name)}" title="Remove">${icon('trash')}</button>
${open ? `<div class="tag-looks"><div class="tag-swatches" role="radiogroup" aria-label="Colour of ${e(tag.name)}">${TAG_COLORS.map(color => `<button type="button" role="radio" class="tag-swatch" data-color="${color}" data-pick-color="${color}" aria-checked="${color === tag.color}" aria-label="${TAG_COLOR_NAMES[color]}" title="${TAG_COLOR_NAMES[color]}"><span class="tag-dot"></span></button>`).join('')}</div>
<div class="tag-styles" role="radiogroup" aria-label="Style of ${e(tag.name)}">${TAG_STYLES.map(style => `<button type="button" role="radio" class="tag-style" data-pick-style="${style}" aria-checked="${style === tag.style}" aria-label="${TAG_STYLE_NAMES[style]}" title="${TAG_STYLE_NAMES[style]}">${tagChip({ ...tag, style })}</button>`).join('')}</div>
<div class="tag-icons" role="radiogroup" aria-label="Icon of ${e(tag.name)}, shown on a phone"><button type="button" role="radio" class="tag-icon" data-pick-icon="" aria-checked="${!tag.icon}" aria-label="First letter" title="First letter"><span class="tag-icon-letter">${e(tagLetter(tag.name))}</span></button>${TAG_ICONS.map(name => `<button type="button" role="radio" class="tag-icon" data-pick-icon="${name}" aria-checked="${tag.icon === name}" aria-label="${TAG_ICON_NAMES[name]}" title="${TAG_ICON_NAMES[name]}">${icon(name)}</button>`).join('')}</div></div>` : ''}
${this.removing === tag.id ? `<div class="tag-remove-confirm" role="alert"><span>${used ? `${count(used, 'conversation')} lose${used === 1 ? 's' : ''} this tag.` : 'Remove this tag?'}</span><button type="button" data-tag-action="remove-cancel">Keep</button><button type="button" class="danger" data-tag-action="remove-confirm">Remove</button></div>` : ''}
</div>`;
  }
  private refocus(id: string, selector: string): void { this.root.querySelector<HTMLElement>(`[data-tag="${CSS.escape(id)}"] ${selector}`)?.focus(); }
  private replace(id: string, change: Partial<TagDef>): TagDef[] { return this.tagging!.tags.map(t => t.id === id ? { ...t, ...change } : t); }
  private async store(next: Partial<Tagging>): Promise<void> {
    if (!await this.host.save({ ...this.tagging!, ...next })) { this.listSignature = ''; this.renderList(); }
  }
  private async changed(target: HTMLElement): Promise<void> {
    if (!this.tagging) return;
    if (target.id === 'tagging-on') return this.store({ enabled: (target as HTMLInputElement).checked });
    if (target.id === 'tagging-titles') return this.store({ titles: (target as HTMLInputElement).checked });
    if (target.id === 'tagging-model') return this.store({ model: (target as HTMLSelectElement).value });
    const field = target.dataset.tagField, id = target.closest<HTMLElement>('[data-tag]')?.dataset.tag;
    if (!id || (field !== 'name' && field !== 'hint')) return;
    const value = (target as HTMLInputElement).value.trim();
    if (value === this.tagging.tags.find(t => t.id === id)?.[field]) return;
    return this.store({ tags: this.replace(id, { [field]: value }) });
  }
  private async clicked(target: HTMLElement): Promise<void> {
    const tagging = this.tagging; if (!tagging) return;
    const id = target.closest<HTMLElement>('[data-tag]')?.dataset.tag ?? null;
    // Picking a colour, a style or an icon keeps the picker open, so all three can be chosen in turn.
    const swatch = target.closest<HTMLElement>('[data-pick-color]'), look = target.closest<HTMLElement>('[data-pick-style]'), glyph = target.closest<HTMLElement>('[data-pick-icon]');
    if (glyph && id) {
      const name = glyph.dataset.pickIcon as TagIcon | '';
      return this.store({ tags: this.replace(id, { icon: name || undefined }) }).then(() => this.refocus(id, `[data-pick-icon="${name}"]`));
    }
    if (swatch && id) return this.store({ tags: this.replace(id, { color: swatch.dataset.pickColor as TagColor }) }).then(() => this.refocus(id, `[data-pick-color="${swatch.dataset.pickColor}"]`));
    if (look && id) return this.store({ tags: this.replace(id, { style: look.dataset.pickStyle as TagStyle }) }).then(() => this.refocus(id, `[data-pick-style="${look.dataset.pickStyle}"]`));
    if (target.closest('[data-tag-field="color"]') && id) { this.colorOpen = this.colorOpen === id ? null : id; this.focusNext = { id, field: 'color' }; return this.renderList(); }
    const action = target.closest<HTMLElement>('[data-tag-action]')?.dataset.tagAction;
    switch (action) {
      case 'add': {
        if (tagging.tags.length >= TAG_LIMITS.tags) return;
        const names = new Set(tagging.tags.map(t => t.name.toLocaleLowerCase()));
        let name = 'New tag'; for (let n = 2; names.has(name.toLocaleLowerCase()); n++) name = `New tag ${n}`;
        const tag = newTag(tagging, name);
        this.focusNext = { id: tag.id, field: 'name' };
        await this.store({ tags: [...tagging.tags, tag] });
        this.root.querySelector<HTMLInputElement>(`[data-tag="${CSS.escape(tag.id)}"] .tag-name-input`)?.select();
        return;
      }
      case 'presets': return this.store({ tags: [...tagging.tags, ...PRESET_TAGS.filter(p => !tagging.tags.some(t => t.id === p.id || t.name.toLocaleLowerCase() === p.name.toLocaleLowerCase())).map(p => ({ ...p }))].slice(0, TAG_LIMITS.tags) });
      case 'remove': if (!id) return; this.removing = id; this.renderList(); this.root.querySelector<HTMLElement>(`[data-tag="${CSS.escape(id)}"] [data-tag-action="remove-cancel"]`)?.focus(); return;
      case 'remove-cancel': this.removing = null; if (id) this.focusNext = { id, field: 'name' }; return this.renderList();
      case 'remove-confirm': this.removing = null; return this.store({ tags: tagging.tags.filter(t => t.id !== id) });
      case 'all': return void this.host.command({ type: 'tagging.all' });
      case 'stop': return void this.host.command({ type: 'tagging.stop' });
    }
  }
}

/** The tags dialog of a conversation: every tag as a switch, and the classifier's suggestion when tagging is on. */
export function tagOptionsMarkup(thread: Thread, tagging: Tagging): string {
  if (!tagging.tags.length) return '<p class="muted small">There are no tags yet. Add them in Settings → Tags.</p>';
  const mine = new Set(thread.tags ?? []);
  return tagging.tags.map(tag => `<button type="button" class="tag-option" data-tag-toggle="${e(tag.id)}" aria-pressed="${mine.has(tag.id)}"${tag.hint ? ` title="${e(tag.hint)}"` : ''}>${icon('check')}${tagChip(tag)}</button>`).join('');
}
/** Who chose a conversation's tags, or what the classifier is doing with it. */
export function tagNote(thread: Thread, tagging: Tagging, status: TaggingStatus | undefined, modelName: (id: string) => string): string {
  if (status?.running === thread.id) return 'Suggesting tags…';
  if (status?.error && status.errorThread === thread.id) return status.error;
  if (thread.tagged?.model) return thread.tags?.length ? `Suggested by ${modelName(thread.tagged.model)}.` : `${modelName(thread.tagged.model)} found no tag that fits.`;
  if (thread.tagged) return 'Chosen by you.';
  if (!tagging.enabled) return 'Turn on tagging in Settings → Tags to have a model suggest tags.';
  return taggable(thread) ? 'Not tagged yet.' : 'Tags are suggested once the first message has an answer.';
}
