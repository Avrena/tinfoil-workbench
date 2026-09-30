import { presetColors, presetsFor, themePreset, type ThemeChoice, type ThemePreferences, type ThemeVariant } from '../core/themes.js';
import { escapeHtml as e } from '../core/markdown.js';
import { icon } from './icons.js';

/** Settings → Appearance: a card for each variant the mode can show (both for System), each with its preset, its
 * accent, background and foreground, and its contrast, as the Codex app lays them out. The preset list and the colour
 * picker are drawn here rather than native, and every change applies at once through `change`. */
type ColorKey = 'accent' | 'surface' | 'ink';
const COLOR_LABELS: Record<ColorKey, string> = { accent: 'Accent', surface: 'Background', ink: 'Foreground' };
const VARIANT_LABELS: Record<ThemeVariant, string> = { dark: 'Dark theme', light: 'Light theme' };

export class AppearanceSettings {
  private theme!: ThemePreferences;
  private systemDark = true;
  private open: { kind: 'preset' | 'color'; variant: ThemeVariant; key?: ColorKey; anchor: HTMLElement } | null = null;
  private hsv = { h: 0, s: 0, v: 0 };
  private edited = false;
  constructor(private readonly host: HTMLElement, private readonly popover: HTMLElement, private readonly change: (theme: ThemePreferences) => void) {
    host.addEventListener('click', event => this.click(event));
    // The contrast applies while the slider moves; the card is drawn again (its "edited" mark) once it is let go.
    for (const type of ['input', 'change'] as const) host.addEventListener(type, event => {
      const range = (event.target as HTMLElement).closest<HTMLInputElement>('input[data-contrast]');
      if (!range) return;
      range.nextElementSibling!.textContent = range.value;
      this.update(range.dataset.contrast as ThemeVariant, { contrast: Number(range.value) }, type === 'change');
    });
    popover.addEventListener('click', event => this.pick(event));
    popover.addEventListener('keydown', event => this.key(event));
    popover.addEventListener('input', event => this.edit(event));
    popover.addEventListener('pointerdown', event => this.drag(event));
    // A click elsewhere in the dialog closes the popover, as menus do.
    host.ownerDocument.addEventListener('pointerdown', event => {
      const target = event.target as Node;
      if (this.open && !this.popover.contains(target) && !this.open.anchor.contains(target)) this.close(false);
    }, true);
  }
  render(theme: ThemePreferences, systemDark: boolean): void {
    this.theme = theme; this.systemDark = systemDark;
    const variants: ThemeVariant[] = theme.mode === 'system' ? [systemDark ? 'dark' : 'light', systemDark ? 'light' : 'dark'] : [theme.mode];
    this.host.innerHTML = variants.map(variant => this.card(variant, theme[variant], variants.length > 1)).join('');
    this.paintSwatches();
    if (this.open && !variants.includes(this.open.variant)) this.close(false);
    else if (this.open) this.open.anchor = this.host.querySelector<HTMLElement>(this.open.kind === 'preset'
      ? `[data-theme-preset="${this.open.variant}"]` : `[data-theme-color="${this.open.variant}"][data-key="${this.open.key}"]`) ?? this.open.anchor;
  }
  private card(variant: ThemeVariant, choice: ThemeChoice, titled: boolean): string {
    const preset = themePreset(choice.preset), edited = !presetColors(choice, variant);
    return `<div class="theme-card" data-variant="${variant}">
      ${titled ? `<div class="theme-card-title">${VARIANT_LABELS[variant]}</div>` : ''}
      <div class="theme-row"><span class="theme-row-label">Preset</span><button type="button" class="theme-preset" data-theme-preset="${variant}" aria-haspopup="listbox" aria-expanded="false">${sample(choice)}<span>${e(preset?.label ?? choice.preset)}${edited ? ' · edited' : ''}</span>${icon('down')}</button>${edited ? `<button type="button" class="theme-reset" data-theme-reset="${variant}" title="Use the preset's colours again">Reset</button>` : ''}</div>
      <div class="theme-colors">${(['accent', 'surface', 'ink'] as const).map(key => `<button type="button" class="theme-color" data-theme-color="${variant}" data-key="${key}" aria-haspopup="dialog" aria-label="${COLOR_LABELS[key]}: ${choice[key]}"><span class="theme-swatch" data-swatch="${choice[key]}"></span><span class="theme-color-label">${COLOR_LABELS[key]}</span><code>${choice[key]}</code></button>`).join('')}</div>
      <label class="theme-contrast"><span class="theme-row-label">Contrast</span><input type="range" min="0" max="100" step="1" value="${choice.contrast}" data-contrast="${variant}" aria-label="${VARIANT_LABELS[variant]} contrast"><output>${choice.contrast}</output></label>
    </div>`;
  }
  /** Swatches are painted after rendering: the page's CSP allows no inline style attributes. */
  paintSwatches(root: ParentNode = this.host): void {
    for (const swatch of root.querySelectorAll<HTMLElement>('[data-swatch]')) swatch.style.background = swatch.dataset.swatch!;
    for (const sample of root.querySelectorAll<HTMLElement>('[data-sample]')) {
      const [surface, ink, accent] = sample.dataset.sample!.split(',');
      sample.style.background = surface!; sample.style.color = ink!; sample.style.setProperty('--sample-accent', accent!);
    }
  }
  private update(variant: ThemeVariant, patch: Partial<ThemeChoice>, redraw = true): void {
    this.theme = { ...this.theme, [variant]: { ...this.theme[variant], ...patch } };
    this.change(this.theme);
    if (redraw) this.render(this.theme, this.systemDark);
  }
  private click(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const preset = target.closest<HTMLElement>('[data-theme-preset]'), color = target.closest<HTMLElement>('[data-theme-color]'), reset = target.closest<HTMLElement>('[data-theme-reset]');
    if (reset) {
      const variant = reset.dataset.themeReset as ThemeVariant, base = themePreset(this.theme[variant].preset)?.[variant];
      if (base) this.update(variant, base);
      return;
    }
    if (preset) { this.toggle({ kind: 'preset', variant: preset.dataset.themePreset as ThemeVariant, anchor: preset }); return; }
    if (color) this.toggle({ kind: 'color', variant: color.dataset.themeColor as ThemeVariant, key: color.dataset.key as ColorKey, anchor: color });
  }
  private toggle(next: NonNullable<AppearanceSettings['open']>): void {
    if (this.open && this.open.anchor === next.anchor) { this.close(true); return; }
    this.open = next;
    next.anchor.setAttribute('aria-expanded', 'true');
    if (next.kind === 'preset') this.presetList(next.variant); else this.colorPicker(next.variant, next.key!);
    this.popover.hidden = false; this.place();
    (this.popover.querySelector<HTMLElement>('[aria-selected="true"], input[data-hex]') ?? this.popover.querySelector<HTMLElement>('button'))?.focus();
  }
  close(focus: boolean): void {
    if (!this.open) return;
    const { anchor, variant, key, kind } = this.open; this.open = null;
    anchor.setAttribute('aria-expanded', 'false');
    this.popover.hidden = true; this.popover.replaceChildren();
    // A picked colour redraws the card (its preset's "edited" mark and Reset), then focus returns to its button.
    if (this.edited) { this.edited = false; this.render(this.theme, this.systemDark); }
    const target = kind === 'color' ? this.host.querySelector<HTMLElement>(`[data-theme-color="${variant}"][data-key="${key}"]`) : this.host.querySelector<HTMLElement>(`[data-theme-preset="${variant}"]`);
    if (focus) (target ?? (anchor.isConnected ? anchor : null))?.focus();
  }
  /** Below the button, inside the dialog; above it when there is no room below. */
  private place(): void {
    if (!this.open) return;
    const frame = this.popover.offsetParent as HTMLElement | null, box = this.open.anchor.getBoundingClientRect(), base = frame?.getBoundingClientRect() ?? { left: 0, top: 0, height: innerHeight, width: innerWidth };
    const height = this.popover.offsetHeight, below = box.bottom - base.top + 6, room = (frame?.clientHeight ?? innerHeight) + (frame?.scrollTop ?? 0);
    this.popover.style.left = `${Math.max(8, Math.min(box.left - base.left, (frame?.clientWidth ?? innerWidth) - this.popover.offsetWidth - 8))}px`;
    this.popover.style.top = `${below + height > room && box.top - base.top - height - 6 > 0 ? box.top - base.top - height - 6 + (frame?.scrollTop ?? 0) : below + (frame?.scrollTop ?? 0)}px`;
  }
  private presetList(variant: ThemeVariant): void {
    const current = this.theme[variant].preset;
    this.popover.className = 'theme-popover preset-list';
    this.popover.setAttribute('role', 'listbox'); this.popover.setAttribute('aria-label', `${VARIANT_LABELS[variant]} presets`);
    this.popover.innerHTML = presetsFor(variant).map(p => `<button type="button" role="option" data-preset="${p.id}" aria-selected="${p.id === current}" tabindex="${p.id === current ? 0 : -1}">${sample(p[variant]!)}<span>${e(p.label)}</span>${p.id === current ? icon('check') : ''}</button>`).join('');
    this.paintSwatches(this.popover);
  }
  private colorPicker(variant: ThemeVariant, key: ColorKey): void {
    const value = this.theme[variant][key];
    this.hsv = toHsv(value);
    this.popover.className = 'theme-popover color-picker';
    this.popover.setAttribute('role', 'dialog'); this.popover.setAttribute('aria-label', `${VARIANT_LABELS[variant]} ${COLOR_LABELS[key].toLowerCase()}`);
    this.popover.innerHTML = `<div class="picker-area" data-area tabindex="0" role="slider" aria-label="Saturation and brightness" aria-valuetext=""><span class="picker-thumb"></span></div>
      <input type="range" class="picker-hue" data-hue min="0" max="359" step="1" aria-label="Hue">
      <div class="picker-row"><span class="theme-swatch" data-picked></span><input data-hex value="${value}" maxlength="7" spellcheck="false" autocomplete="off" aria-label="Hex colour"><button type="button" data-done>Done</button></div>`;
    this.showColor();
  }
  /** Draws the picker for the current hue, saturation and brightness, and reports the colour. */
  private showColor(report = false): void {
    const hex = fromHsv(this.hsv), area = this.popover.querySelector<HTMLElement>('[data-area]');
    if (!area) return;
    area.style.setProperty('--hue', String(this.hsv.h));
    area.style.setProperty('--sx', `${this.hsv.s * 100}%`); area.style.setProperty('--sy', `${(1 - this.hsv.v) * 100}%`);
    area.setAttribute('aria-valuetext', hex);
    this.popover.querySelector<HTMLInputElement>('[data-hue]')!.value = String(Math.round(this.hsv.h));
    this.popover.querySelector<HTMLElement>('[data-picked]')!.style.background = hex;
    const input = this.popover.querySelector<HTMLInputElement>('[data-hex]')!;
    if (document.activeElement !== input) input.value = hex;
    if (report && this.open?.kind === 'color') {
      this.update(this.open.variant, { [this.open.key!]: hex }, false);
      const button = this.open.anchor, swatch = button.querySelector<HTMLElement>('[data-swatch]');
      if (swatch) { swatch.dataset.swatch = hex; swatch.style.background = hex; }
      button.querySelector('code')!.textContent = hex; button.setAttribute('aria-label', `${COLOR_LABELS[this.open.key!]}: ${hex}`);
      this.edited = true;
    }
  }
  private pick(event: MouseEvent): void {
    const target = event.target as HTMLElement, option = target.closest<HTMLElement>('[data-preset]');
    if (option && this.open?.kind === 'preset') {
      const variant = this.open.variant, base = themePreset(option.dataset.preset!)?.[variant];
      if (base) this.update(variant, { preset: option.dataset.preset!, ...base });
      this.close(true); return;
    }
    if (target.closest('[data-done]')) this.close(true);
  }
  private key(event: KeyboardEvent): void {
    // Escape closes the popover, not the Settings dialog around it.
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(true); return; }
    if (this.open?.kind === 'preset' && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const all = [...this.popover.querySelectorAll<HTMLElement>('[data-preset]')], at = all.indexOf(document.activeElement as HTMLElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : Math.max(0, Math.min(all.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)));
      all.forEach((b, i) => b.tabIndex = i === next ? 0 : -1); all[next]?.focus();
      return;
    }
    const area = (event.target as HTMLElement).closest('[data-area]');
    if (area && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      const step = event.shiftKey ? .1 : .02;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') this.hsv.s = clamp(this.hsv.s + (event.key === 'ArrowRight' ? step : -step));
      else this.hsv.v = clamp(this.hsv.v + (event.key === 'ArrowUp' ? step : -step));
      this.showColor(true);
    }
    if ((event.target as HTMLElement).matches('[data-hex]') && event.key === 'Enter') { event.preventDefault(); this.close(true); }
  }
  private edit(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target.matches('[data-hue]')) { this.hsv.h = Number(target.value); this.showColor(true); return; }
    if (target.matches('[data-hex]')) {
      const value = target.value.trim().toLowerCase(), hex = /^#?[0-9a-f]{6}$/.test(value) ? (value.startsWith('#') ? value : '#' + value) : null;
      target.setAttribute('aria-invalid', String(!hex));
      if (hex) { this.hsv = toHsv(hex); this.showColor(true); }
    }
  }
  /** Saturation and brightness follow the pointer while it is held on the area. */
  private drag(event: PointerEvent): void {
    const area = (event.target as HTMLElement).closest<HTMLElement>('[data-area]');
    if (!area) return;
    event.preventDefault(); area.focus(); area.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent): void => {
      const box = area.getBoundingClientRect();
      this.hsv.s = clamp((e.clientX - box.left) / box.width); this.hsv.v = clamp(1 - (e.clientY - box.top) / box.height);
      this.showColor(true);
    };
    move(event);
    const end = (): void => { area.removeEventListener('pointermove', move); area.removeEventListener('pointerup', end); area.removeEventListener('pointercancel', end); };
    area.addEventListener('pointermove', move); area.addEventListener('pointerup', end); area.addEventListener('pointercancel', end);
  }
}
/** A preset's look in small: its background with its text and a dot of its accent. */
function sample(c: Pick<ThemeChoice, 'surface' | 'ink' | 'accent'>): string {
  return `<span class="theme-sample" data-sample="${c.surface},${c.ink},${c.accent}" aria-hidden="true">Aa<i></i></span>`;
}
const clamp = (n: number): number => Math.max(0, Math.min(1, n));
function toHsv(hex: string): { h: number; s: number; v: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = !d ? 0 : max === r ? 60 * (((g - b) / d + 6) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { h, s: max ? d / max : 0, v: max };
}
function fromHsv({ h, s, v }: { h: number; s: number; v: number }): string {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, k = Math.floor(h / 60) % 6;
  const rgb = ([[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]] as const)[k]!;
  return '#' + rgb.map(n => Math.round((n + m) * 255).toString(16).padStart(2, '0')).join('');
}
