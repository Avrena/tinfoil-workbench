import { formatShare, formatValue, visualPalette, type ChartLayout, type ChartSpec } from '../core/visual-tools.js';

type Target = { i: number; series?: number };
export interface ChartHover { attach(): void; dispose(): void }

/** The hover layer of an inline chart. Line and area charts get a crosshair that snaps to the nearest label and one
 * tooltip listing every visible series there; bar charts highlight the whole category band; scatter charts read the
 * nearest point and pie charts the slice under the pointer. The arrow keys move the same readout when the chart has
 * focus. It only enhances: every value stays in the Data tab. Labels are model data and are inserted as text. */
export function chartHover(canvas: HTMLElement, spec: ChartSpec, layout: () => ChartLayout): ChartHover {
  const guide = document.createElement('div'); guide.className = 'chart-crosshair'; guide.hidden = true; guide.setAttribute('aria-hidden', 'true');
  const tip = document.createElement('div'); tip.className = 'chart-tooltip'; tip.hidden = true; tip.setAttribute('role', 'status'); tip.setAttribute('aria-live', 'polite');
  canvas.tabIndex = 0; canvas.setAttribute('aria-label', `${spec.title}. Use the arrow keys to read the values.`);
  let current: Target | null = null;
  const color = (index: number) => visualPalette[index % visualPalette.length]!;
  const svgBox = () => canvas.querySelector('svg')?.getBoundingClientRect();

  /** What the keyboard steps through, in reading order. */
  const targets = (): Target[] => {
    const L = layout();
    if (L.pie) return L.pie.slices.filter(s => s.value > 0).map(s => ({ i: s.index }));
    if (spec.type === 'scatter') return L.visible.flatMap(s => s.values.flatMap((v, i) => v === null ? [] : [{ i, series: s.index }]))
      .sort((a, b) => L.x(a.i) - L.x(b.i) || a.series! - b.series!);
    return spec.labels.map((_, i) => ({ i }));
  };
  const hit = (clientX: number, clientY: number): Target | null => {
    const L = layout(), rect = svgBox(); if (!rect?.width) return null;
    const vx = (clientX - rect.left) * L.w / rect.width, vy = (clientY - rect.top) * L.h / rect.height;
    if (L.pie) {
      const { cx, cy, r, r0, slices } = L.pie, d = Math.hypot(vx - cx, vy - cy); if (d < r0 - 4 || d > r + 6) return null;
      let a = Math.atan2(vy - cy, vx - cx); if (a < -Math.PI / 2) a += Math.PI * 2;
      const s = slices.find(s => s.value > 0 && a >= s.start && a < s.end); return s ? { i: s.index } : null;
    }
    if (vx < L.left - 12 || vx > L.w - L.right + 12 || vy < L.top - 12 || vy > L.h - L.bottom + 12) return null;
    if (spec.type === 'scatter') {
      // The nearest point, not a pinpoint: anything within 36 units of it counts.
      let best: Target | null = null, distance = 36;
      for (const s of L.visible) s.values.forEach((v, i) => { if (v === null) return; const d = Math.hypot(L.x(i) - vx, L.y(v) - vy); if (d <= distance) { distance = d; best = { i, series: s.index }; } });
      return best;
    }
    if (spec.type === 'bar') { const i = Math.floor((vx - L.left) / L.band); return i >= 0 && i < spec.labels.length ? { i } : null; }
    let best = 0; spec.labels.forEach((_, i) => { if (Math.abs(L.x(i) - vx) < Math.abs(L.x(best) - vx)) best = i; }); return { i: best };
  };
  const row = (key: string, value: string, name: string, line: boolean) => {
    const r = document.createElement('div'); r.className = 'tip-row';
    const k = document.createElement('i'); k.className = line ? 'tip-key line' : 'tip-key'; k.style.backgroundColor = key;
    const b = document.createElement('strong'); b.textContent = value;
    const n = document.createElement('span'); n.textContent = name;
    r.append(k, b, n); return r;
  };
  const show = (target: Target | null) => {
    const L = layout(), rect = svgBox();
    // A point of a series that was just hidden is no longer there to read.
    const series = target?.series;
    if (series !== undefined && !L.visible.some(s => s.index === series)) target = null;
    current = target;
    if (!target || !rect?.width) { guide.hidden = tip.hidden = true; return; }
    const box = canvas.getBoundingClientRect(), sx = rect.width / L.w, sy = rect.height / L.h, ox = rect.left - box.left, oy = rect.top - box.top;
    const head = document.createElement('div'); head.className = 'tip-head';
    tip.replaceChildren(head);
    let ax: number, ay: number, cartesian = false;
    if (L.pie) {
      const s = L.pie.slices[target.i]!, mid = (s.start + s.end) / 2;
      head.textContent = spec.labels[target.i]!;
      tip.append(row(color(target.i), formatValue(spec, s.value), `${formatShare(s.share)} of ${formatValue(spec, L.pie.total)}`, false));
      ax = L.pie.cx + Math.cos(mid) * L.pie.r * .8; ay = L.pie.cy + Math.sin(mid) * L.pie.r * .8;
    } else if (spec.type === 'scatter') {
      const s = spec.series[target.series!]!, v = s.values[target.i]!;
      head.textContent = spec.x_values ? `${spec.labels[target.i]} · ${spec.x_label || 'x'} ${spec.x_values[target.i]}` : spec.labels[target.i]!;
      tip.append(row(color(target.series!), formatValue(spec, v), s.name, false));
      ax = L.x(target.i); ay = L.y(v);
    } else {
      cartesian = true;
      head.textContent = spec.x_values ? `${spec.labels[target.i]} · ${spec.x_label || 'x'} ${spec.x_values[target.i]}` : spec.labels[target.i]!;
      let total = 0, count = 0;
      for (const s of L.visible) { const v = s.values[target.i]; if (v === null || v === undefined) continue; total += v; count++; tip.append(row(color(s.index), formatValue(spec, v), s.name, spec.type === 'line')); }
      if (spec.stacked && count > 1) tip.append(row('transparent', formatValue(spec, total), 'Total', false));
      if (!count) { const none = document.createElement('div'); none.className = 'tip-row muted'; none.textContent = 'No value'; tip.append(none); }
      ax = L.x(target.i); ay = L.top;
      const width = spec.type === 'bar' ? L.band * sx : 1;
      guide.classList.toggle('band', spec.type === 'bar');
      Object.assign(guide.style, { left: `${ox + ax * sx - width / 2}px`, width: `${width}px`, top: `${oy + L.top * sy}px`, height: `${(L.h - L.bottom - L.top) * sy}px` });
    }
    guide.hidden = !cartesian; tip.hidden = false;
    // Beside the point, flipped to the other side near the edge, and always inside the canvas.
    const px = ox + ax * sx, py = oy + ay * sy, tw = tip.offsetWidth, th = tip.offsetHeight, cw = canvas.clientWidth, ch = canvas.clientHeight;
    let left = px + 14; if (left + tw > cw - 4) left = px - 14 - tw;
    tip.style.left = `${Math.max(4, Math.min(left, cw - tw - 4))}px`;
    tip.style.top = `${Math.max(4, Math.min(cartesian ? py : py - th / 2, ch - th - 4))}px`;
  };
  const same = (a: Target, b: Target) => a.i === b.i && a.series === b.series;
  const onMove = (e: PointerEvent) => show(hit(e.clientX, e.clientY));
  const onLeave = () => { if (document.activeElement !== canvas) show(null); };
  const onKey = (e: KeyboardEvent) => {
    const list = targets(); if (!list.length) return;
    const at = current ? list.findIndex(t => same(t, current!)) : -1;
    const next = ({ ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at < 0 ? list.length - 1 : at - 1, ArrowUp: at < 0 ? list.length - 1 : at - 1, Home: 0, End: list.length - 1 } as Record<string, number>)[e.key];
    if (e.key === 'Escape') { if (current) { e.preventDefault(); show(null); } return; }
    if (next === undefined) return;
    e.preventDefault(); show(list[Math.max(0, Math.min(list.length - 1, next))]!);
  };
  const onBlur = () => show(null);
  canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('keydown', onKey); canvas.addEventListener('blur', onBlur);
  return {
    /** After each repaint: the renderer's reconciler removes nodes that are not in the SVG markup. */
    attach() { canvas.append(guide, tip); if (current) show(current); },
    dispose() {
      canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('keydown', onKey); canvas.removeEventListener('blur', onBlur); guide.remove(); tip.remove();
    },
  };
}
