import { escapeHtml as e } from '../core/markdown.js';
import { effortGauge, turnEffortGauge } from './icons.js';
import { updateMarkup } from './dom.js';

export interface EffortState { levels: string[]; value: string; disabled: boolean }
const name = (level: string) => level === 'default' ? 'Default' : level[0]!.toUpperCase() + level.slice(1);
/** One capability-driven control for both execution modes. Commits only on explicit selection/release. */
export class EffortControl {
  private drag: number | null = null;
  private signature = '';
  constructor(private prefix: string, private read: () => EffortState, private commit: (level: string) => void | Promise<unknown>) {
    this.$('quick-effort').addEventListener('click', () => this.toggle());
    const slider = this.$('effort-slider');
    slider.addEventListener('pointerdown', event => {
      if (event.button !== 0 || this.read().disabled) return;
      event.preventDefault(); slider.focus({ preventScroll:true }); slider.setPointerCapture(event.pointerId); this.drag = event.pointerId; slider.classList.add('dragging'); this.point(event);
    });
    slider.addEventListener('pointermove', event => { if (this.drag === event.pointerId) this.point(event); });
    for (const type of ['pointerup','pointercancel','lostpointercapture'] as const) slider.addEventListener(type, event => {
      if (this.drag !== event.pointerId) return; this.drag = null; slider.classList.remove('dragging');
      if (type === 'pointerup') this.choose(Number(slider.getAttribute('aria-valuenow'))); else { this.signature = ''; this.render(); }
    });
    slider.addEventListener('keydown', event => {
      const now = Number(slider.getAttribute('aria-valuenow')), last = this.levels().length - 1;
      const next = ({ ArrowLeft:now-1,ArrowDown:now-1,PageDown:now-1,ArrowRight:now+1,ArrowUp:now+1,PageUp:now+1,Home:0,End:last } as Record<string,number>)[event.key];
      if (next === undefined) return; event.preventDefault(); if (!this.read().disabled) this.choose(Math.max(0,Math.min(last,next)));
    });
    this.$('effort-stops').addEventListener('click', event => { const stop = (event.target as Element).closest<HTMLElement>('[data-effort-stop]'); if (stop && !this.read().disabled) this.choose(Number(stop.dataset.effortStop)); });
    document.addEventListener('pointerdown', event => { if (!this.$('quick-effort-wrap').contains(event.target as Node)) this.close(); },true);
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !this.$('effort-panel').hidden && !this.$('effort-panel').dataset.closing) { event.preventDefault(); event.stopPropagation(); this.close(true); } },true);
    addEventListener('resize', () => this.place()); window.visualViewport?.addEventListener('resize', () => this.place());
  }
  private $(id: string): HTMLElement { return document.getElementById(this.prefix + id)!; }
  private levels(): string[] { return ['default', ...this.read().levels]; }
  render(): void {
    const state = this.read(), levels = this.levels(), signature = JSON.stringify([levels,state.value]);
    if (signature !== this.signature && this.drag === null) {
      const index = Math.max(0,levels.indexOf(state.value)), last = levels.length-1;
      this.$('effort-slider').setAttribute('aria-valuemax',String(last));
      updateMarkup(this.$('effort-ticks'),levels.map(()=>'<span class="effort-tick"></span>').join(''));
      updateMarkup(this.$('effort-stops'),levels.map((level,i)=>`<button type="button" data-effort-stop="${i}" aria-pressed="${i===index}">${e(name(level))}</button>`).join(''));
      for (const list of [this.$('effort-ticks'),this.$('effort-stops')]) [...list.children].forEach((item,i)=>(item as HTMLElement).style.setProperty('--tick',String(last?i/last:0)));
      this.set(index); this.signature = signature;
    }
    this.$('quick-effort-wrap').classList.toggle('hidden',!state.levels.length);
    (this.$('quick-effort') as HTMLButtonElement).disabled = state.disabled; this.$('effort-slider').setAttribute('aria-disabled',String(state.disabled));
    if (!state.levels.length || state.disabled) this.close();
  }
  private set(index: number, at?: number): void {
    const levels = this.levels(), last = levels.length-1, label = name(levels[index] ?? 'default'), slider = this.$('effort-slider'), gauge = this.$('effort-gauge');
    slider.style.setProperty('--at',String(at ?? (last ? index/last : 0))); slider.setAttribute('aria-valuenow',String(index)); slider.setAttribute('aria-valuetext',label);
    if (gauge.querySelector('svg')?.dataset.levels !== String(Math.max(1,last))) updateMarkup(gauge,effortGauge(last));
    turnEffortGauge(gauge.querySelector('svg')!,index); this.$('effort-value').textContent = label;
    const title = index ? `Thinking effort: ${label}` : 'Thinking effort: Default (the provider setting)'; this.$('quick-effort').title = title; this.$('quick-effort').setAttribute('aria-label',title);
    for (const stop of this.$('effort-stops').querySelectorAll<HTMLElement>('[data-effort-stop]')) stop.setAttribute('aria-pressed',String(Number(stop.dataset.effortStop)===index));
  }
  private point(event: PointerEvent): void { const r = this.$('effort-slider').querySelector('.effort-track')!.getBoundingClientRect(), at = r.width ? Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)) : 0; this.set(Math.round(at*(this.levels().length-1)),at); }
  private choose(index: number): void {
    this.set(index);
    // Keep the chosen position while native storage responds; a failed save restores the applied value.
    void Promise.resolve(this.commit(this.levels()[index] ?? 'default')).finally(()=>{this.signature='';this.render();});
  }
  place(): void {
    const panel = this.$('effort-panel'); if (panel.hidden) return;
    const composer = this.$('quick-effort').closest<HTMLElement>('.composer')!, box = composer.getBoundingClientRect(), gauge = this.$('quick-effort').getBoundingClientRect(), full = matchMedia('(max-width: 600px)').matches;
    composer.classList.toggle('effort-attached',full); panel.style.width = full ? `${box.width}px` : '';
    const width = panel.offsetWidth, inset = full ? 0 : 12;
    panel.style.left = `${full ? box.left : Math.max(box.left+inset,Math.min(box.right-inset-width,gauge.left+gauge.width/2-width/2))}px`; panel.style.top = `${box.top+1-panel.offsetHeight}px`;
  }
  toggle(): void { const panel = this.$('effort-panel'); if (!panel.hidden && !panel.dataset.closing) { this.close(); return; } delete panel.dataset.closing; panel.hidden = false; this.$('quick-effort').setAttribute('aria-expanded','true'); this.$('quick-effort').closest('.composer-region')!.classList.add('effort-open'); this.place(); this.$('effort-slider').focus({ preventScroll:true }); }
  close(refocus = false): void {
    const panel = this.$('effort-panel'); if (panel.hidden || panel.dataset.closing) return;
    this.$('quick-effort').setAttribute('aria-expanded','false'); this.$('quick-effort').closest('.composer-region')!.classList.remove('effort-open'); if (refocus) this.$('quick-effort').focus();
    const done = () => { if (!panel.dataset.closing) return; delete panel.dataset.closing; panel.hidden = true; this.$('quick-effort').closest('.composer')!.classList.remove('effort-attached'); };
    panel.dataset.closing = 'true'; if (matchMedia('(prefers-reduced-motion: reduce)').matches) done(); else { panel.addEventListener('animationend',done,{once:true}); setTimeout(done,300); }
  }
}
