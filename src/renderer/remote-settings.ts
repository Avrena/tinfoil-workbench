import type { RemoteDraft, RemoteGeneration } from '../core/remote.js';
import { emptyRemoteDraft } from '../core/remote.js';
import { capabilityFor, type ModelCapability } from '../core/capabilities.js';
import { escapeHtml as e } from '../core/markdown.js';
import { generationFields } from './conversation-ui.js';
import { icon } from './icons.js';

type Numeric = 'maxTokens' | 'maxSeconds' | 'maxRounds' | 'maxCalls';
type Thinking = RemoteGeneration['thinkingMode'];
/** The Advanced values a remote task draft holds, apart from its instructions. */
export type RemoteTuning = Pick<RemoteDraft, 'temperature' | 'reasoningEffort' | 'thinkingMode' | Numeric>;
const NUMERIC: readonly { key: Numeric; label: string; max: number; error: string }[] = [
  { key: 'maxTokens', label: 'Output limit per round', max: 16384, error: 'Output limit must be a whole number from 1 to 16,384 tokens.' },
  { key: 'maxSeconds', label: 'Time (seconds)', max: 3600, error: 'Time must be a whole number from 1 to 3,600 seconds.' },
  { key: 'maxRounds', label: 'Model rounds', max: 30, error: 'Model rounds must be a whole number from 1 to 30.' },
  { key: 'maxCalls', label: 'Tool calls', max: 60, error: 'Tool calls must be a whole number from 1 to 60.' },
];
const THINKING: readonly [Thinking, string, string, string][] = [['default', 'spark', 'Default', 'Provider default'], ['enabled', 'check', 'On', 'Thinking on'], ['disabled', 'minus', 'Off', 'Thinking off']];
const DEFAULTS = emptyRemoteDraft();

export const effortName = (level: string): string => level === 'default' ? 'Provider default' : level[0]!.toUpperCase() + level.slice(1);
export const thinkingName = (mode: string): string => mode === 'enabled' ? 'On' : mode === 'disabled' ? 'Off' : 'Provider default';
export const minutes = (seconds: number): string => seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`;
export const limitsSummary = (s: Pick<RemoteDraft, 'maxSeconds' | 'maxRounds' | 'maxCalls'>): string => `${minutes(s.maxSeconds)} · ${s.maxRounds} rounds · ${s.maxCalls} tool calls`;
/** Whether a draft asks for anything but the provider's defaults. Hosts without per-job settings accept only defaults. */
export function customGeneration(g: RemoteGeneration): boolean {
  return !!g.systemPrompt.trim() || g.temperature !== null || g.reasoningEffort !== 'default' || g.thinkingMode !== 'default';
}

export interface TuningSource { capabilities?: () => ModelCapability[]; loadModels?: () => Promise<void>; showAdvanced?: () => void; pending?: () => void }

/** Remote values adapt the shared Advanced panel. Edits stay pending until Apply, as in Chat. */
export class RemoteAdvanced {
  readonly panel: HTMLElement;
  private state: RemoteTuning = { ...DEFAULTS };
  private applied: RemoteTuning = { ...DEFAULTS }; private owner = ''; dirty = false;
  private cap: ModelCapability = capabilityFor('');
  private modelId = '';
  private supported: boolean | undefined;
  constructor(container: HTMLElement, private trigger: HTMLButtonElement, private source: TuningSource, private changed: () => void) {
    this.panel = document.createElement('div'); this.panel.id = 'remote-advanced-panel'; this.panel.className = 'inspector-body remote-advanced-body'; this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Remote task settings');
    const number = (n: typeof NUMERIC[number]) => `<div class="remote-number"><label for="remote-${n.key}">${n.label}</label><input id="remote-${n.key}" type="number" inputmode="numeric" min="1" max="${n.max}" step="1" required aria-describedby="remote-settings-error"></div>`;
    this.panel.innerHTML = `<form id="remote-config-form" novalidate>`
      + `<p id="remote-jobsettings-note" class="remote-settings-warning" role="status" hidden>This host’s remote worker doesn’t accept generation settings or system instructions yet. Jobs there use the provider defaults; update the worker to change them. Limits still apply.</p>`
      + `<section aria-labelledby="remote-generation-heading"><h3 class="eyebrow" id="remote-generation-heading">Generation</h3>`
      + generationFields('remote-temperature','remote-maxTokens',16384,'any','Output limit per round')
      + `<div id="remote-effort-row" class="remote-effort-row"><label for="remote-effort">Thinking effort</label><select id="remote-effort"></select></div>`
      + `<div id="remote-thinking-row" class="choice-row"><span class="choice-label" id="remote-thinking-label">Thinking mode</span><div class="segmented" role="radiogroup" aria-labelledby="remote-thinking-label">`
      + THINKING.map(([value, glyph, short, title]) => `<button type="button" role="radio" aria-checked="false" tabindex="-1" data-remote-thinking="${value}" title="${title}">${icon(glyph)}<span>${short}</span></button>`).join('')
      + `</div></div><p id="remote-capability-note" class="small muted remote-capability-note"></p></section>`
      + `<section id="remote-limits" class="remote-limits-section" aria-labelledby="remote-limits-heading"><h3 class="eyebrow" id="remote-limits-heading">Execution limits</h3><div class="remote-limits">${NUMERIC.slice(1).map(number).join('')}</div>`
      + `<p class="small muted">Each job stops at the first limit it reaches: up to 3,600 seconds, 30 model rounds and 60 tool calls.</p></section>`
      + `<p id="remote-settings-error" class="remote-settings-error" role="alert" hidden></p>`
      + `<p class="small muted remote-advanced-foot">For new tasks on this host. The host checks each value when a job starts.</p>`
      + `<button type="submit" class="primary apply" id="remote-apply-settings">Apply settings</button><div class="remote-advanced-actions"><button type="button" id="remote-discard-settings" hidden>Discard changes</button><button type="button" id="remote-advanced-reset" hidden>Reset generation to defaults</button></div></form>`;
    // Settings use their own form. Applying never submits a job.
    container.append(this.panel);
    this.panel.querySelector('form')!.addEventListener('submit',event=>{event.preventDefault();this.apply();});
    this.panel.addEventListener('input', () => this.read());
    this.panel.addEventListener('change', () => this.read());
    this.panel.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.target as Element).matches('input')) { event.preventDefault(); return; }
      const b = (event.target as Element).closest<HTMLButtonElement>('[data-remote-thinking]');
      if (!b || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const all = [...this.panel.querySelectorAll<HTMLButtonElement>('[data-remote-thinking]')], at = all.indexOf(b);
      const next = all[event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : (at + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + all.length) % all.length]!;
      next.focus(); this.setThinking(next.dataset.remoteThinking as Thinking);
    });
    this.panel.addEventListener('click', event => {
      const target = event.target as Element;
      // Both buttons hide once they have acted, so focus goes to the first setting rather than to the page.
      if (target.closest('#remote-discard-settings')) { this.discard(); this.field('temperature').focus(); return; }
      const b = target.closest<HTMLButtonElement>('[data-remote-thinking]');
      if (b) { this.setThinking(b.dataset.remoteThinking as Thinking); return; }
      if (target.closest('#remote-advanced-reset')) {
        Object.assign(this.state, { temperature: null, reasoningEffort: 'default', thinkingMode: 'default', maxTokens: DEFAULTS.maxTokens });
        this.fill(); this.pending(); this.field('temperature').focus();
      }
    });
  }
  private field(key: string): HTMLInputElement { return this.panel.querySelector<HTMLInputElement>('#remote-' + key)!; }
  /** The values the draft keeps: the last valid ones. */
  get values(): RemoteTuning { return { ...this.applied }; }
  apply(): boolean {
    if(this.invalid()){this.mark();this.open(this.invalid()!.field);return false;}
    this.applied={...this.state};this.pending();this.changed();return true;
  }
  discard(): void {this.state={...this.applied};this.fill();this.pending();}
  setEffort(level:string): void {if(this.dirty||!['default',...this.cap.effort].includes(level))return;this.state.reasoningEffort=this.applied.reasoningEffort=level;this.fill();this.changed();}
  private pending(): void {
    this.dirty=!!this.invalid()||JSON.stringify(this.state)!==JSON.stringify(this.applied);
    this.panel.querySelector('#remote-apply-settings')!.textContent=this.dirty?'Apply changes':'Apply settings';
    // Discard is offered only with something to discard, Reset only while generation differs from the defaults.
    (this.panel.querySelector('#remote-discard-settings') as HTMLButtonElement).hidden=!this.dirty;this.renderReset();
    this.renderTrigger();this.source.pending?.();
  }
  open(focus?: string): void {
    if (this.trigger.disabled) return;
    this.source.showAdvanced?.();
    (focus ? this.field(focus) : this.panel.querySelector<HTMLElement>('[aria-invalid=true]') ?? this.field('temperature')).focus();
    if (this.source.loadModels) void this.source.loadModels().catch(() => {}).finally(() => this.setModel(this.modelId, false));
  }
  /** Takes a stored draft: its values and their fields, with nothing marked. */
  hydrate(draft: RemoteDraft, owner = ''): void {
    if(this.owner===owner&&this.dirty)return;this.owner=owner;
    this.state = { temperature: draft.temperature, reasoningEffort: draft.reasoningEffort, thinkingMode: draft.thinkingMode, maxTokens: draft.maxTokens, maxSeconds: draft.maxSeconds, maxRounds: draft.maxRounds, maxCalls: draft.maxCalls };
    this.applied={...this.state};this.dirty=false;this.fill();
  }
  /** The model the host will use: its capability decides the effort levels and the thinking switch. A model change
   * resets those two (the host does the same); temperature and limits stay. */
  setModel(id: string, reset: boolean): void {
    this.modelId = id; this.cap = capabilityFor(id, this.source.capabilities?.() ?? []);
    let changed = false;
    if (reset && (this.state.reasoningEffort !== 'default' || this.state.thinkingMode !== 'default')) { this.state.reasoningEffort = 'default'; this.state.thinkingMode = 'default'; changed = true; }
    // A known model without the stored level or switch: the host would refuse it, so it goes back to the default.
    // An unknown one (the list not loaded yet) keeps it until it is known.
    if (this.cap.known && this.state.reasoningEffort !== 'default' && !this.cap.effort.includes(this.state.reasoningEffort)) { this.state.reasoningEffort = 'default'; changed = true; }
    if (this.cap.known && this.state.thinkingMode !== 'default' && !this.cap.toggle) { this.state.thinkingMode = 'default'; changed = true; }
    this.renderCapability();
    if (changed) {this.applied.reasoningEffort=this.state.reasoningEffort;this.applied.thinkingMode=this.state.thinkingMode;this.changed();}
  }
  /** Whether the host's worker takes per-job settings: true, false, or unknown before it answers. */
  setSupported(supported: boolean | undefined): void { this.supported = supported; this.panel.querySelector<HTMLElement>('#remote-jobsettings-note')!.hidden = supported !== false; }
  /** The first field holding text that is not a valid value, with its message, or null. */
  invalid(): { field: string; message: string } | null {
    const temperature = this.field('temperature');
    if (!temperature.validity.valid) return { field: 'temperature', message: 'Temperature must be from 0 to 2, or blank for the provider default.' };
    for (const n of NUMERIC) if (!this.field(n.key).validity.valid) return { field: n.key, message: n.error };
    return null;
  }
  /** Reads every field; valid values replace the draft's, others are marked and leave it as it was. */
  private read(): void {
    const temperature = this.field('temperature');
    if (temperature.validity.valid) this.state.temperature = temperature.value === '' ? null : Number(temperature.value);
    for (const n of NUMERIC) { const f = this.field(n.key); if (f.validity.valid && f.value !== '') this.state[n.key] = Number(f.value); }
    this.state.reasoningEffort = this.panel.querySelector<HTMLSelectElement>('#remote-effort')!.value || 'default';
    this.mark(); this.pending();
  }
  private setThinking(mode: Thinking): void {
    if (this.state.thinkingMode === mode) return;
    this.state.thinkingMode = mode; this.renderThinking(); this.pending();
  }
  private mark(): void {
    const problem = this.invalid(), note = this.panel.querySelector<HTMLElement>('#remote-settings-error')!;
    for (const key of ['temperature', ...NUMERIC.map(n => n.key)]) { const f = this.field(key); f.setAttribute('aria-invalid', String(!f.validity.valid)); }
    note.hidden = !problem; note.textContent = problem?.message ?? '';
  }
  private renderReset(): void {
    const s = this.state, custom = s.temperature !== null || s.reasoningEffort !== 'default' || s.thinkingMode !== 'default' || s.maxTokens !== DEFAULTS.maxTokens;
    (this.panel.querySelector('#remote-advanced-reset') as HTMLButtonElement).hidden = !custom;
  }
  private fill(): void {
    this.field('temperature').value = this.state.temperature === null ? '' : String(this.state.temperature);
    for (const n of NUMERIC) this.field(n.key).value = String(this.state[n.key]);
    this.renderCapability(); this.mark(); this.renderReset();
  }
  private renderCapability(): void {
    const cap = this.cap, select = this.panel.querySelector<HTMLSelectElement>('#remote-effort')!, stored = this.state.reasoningEffort;
    // A stored level the model is not known to have yet is shown as it is, never replaced by a guess.
    const levels = ['default', ...cap.effort, ...(stored !== 'default' && !cap.effort.includes(stored) ? [stored] : [])];
    const html = levels.map(level => `<option value="${e(level)}">${e(effortName(level))}${cap.effort.includes(level) || level === 'default' ? '' : ' (not confirmed for this model)'}</option>`).join('');
    if (select.dataset.levels !== html) { select.innerHTML = html; select.dataset.levels = html; }
    select.value = stored;
    this.panel.querySelector<HTMLElement>('#remote-effort-row')!.hidden = levels.length < 2;
    this.panel.querySelector<HTMLElement>('#remote-thinking-row')!.hidden = !cap.toggle && this.state.thinkingMode === 'default';
    this.renderThinking();
    const name = cap.display?.name || cap.label || this.modelId;
    this.panel.querySelector<HTMLElement>('#remote-capability-note')!.textContent = !this.modelId ? 'Effort and thinking controls appear once the host reports its default model.'
      : cap.effort.length ? `${name}: effort ${cap.effort.join(', ')}${cap.toggle ? ', and thinking on or off' : ''}. ${cap.source === 'catalog' ? 'From Tinfoil’s model list.' : 'From Workbench’s built-in profile until the model list loads.'}`
      : cap.toggle ? `${name} offers thinking on or off, not adjustable effort.`
      : cap.known ? `${name} has no adjustable thinking controls.` : `Thinking controls for ${name} are unknown, so the provider default is used.`;
    this.renderTrigger();
  }
  private renderThinking(): void {
    for (const b of this.panel.querySelectorAll<HTMLButtonElement>('[data-remote-thinking]')) {
      const on = b.dataset.remoteThinking === this.state.thinkingMode;
      b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1;
      // Without a switch for this model only Default is offered; a stored choice stays visible until it is known.
      b.disabled = !this.cap.toggle && b.dataset.remoteThinking !== 'default' && !on;
    }
    this.renderTrigger();
  }
  /** The gear shows a dot while anything differs from the defaults, and says what in its label. */
  renderTrigger(): void {
    const s = this.state, parts: string[] = [];
    if (s.temperature !== null) parts.push(`temperature ${s.temperature}`);
    if (s.reasoningEffort !== 'default') parts.push(`${effortName(s.reasoningEffort).toLowerCase()} effort`);
    if (s.thinkingMode !== 'default') parts.push(`thinking ${thinkingName(s.thinkingMode).toLowerCase()}`);
    if (s.maxTokens !== DEFAULTS.maxTokens) parts.push(`${s.maxTokens.toLocaleString()} output tokens`);
    if (s.maxSeconds !== DEFAULTS.maxSeconds || s.maxRounds !== DEFAULTS.maxRounds || s.maxCalls !== DEFAULTS.maxCalls) parts.push(limitsSummary(s));
    const invalid = !!this.invalid(), label = `Advanced settings: ${invalid ? 'a value needs fixing' : parts.length ? parts.join(', ') : 'defaults'}${this.supported === false && parts.some(p => !/output|rounds/.test(p)) ? ' (not supported on this host)' : ''}`;
    this.trigger.classList.toggle('is-set', parts.length > 0); this.trigger.classList.toggle('is-invalid', invalid);
    this.trigger.setAttribute('aria-label', label); this.trigger.title = label;
  }
}
