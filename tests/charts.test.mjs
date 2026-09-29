import test from 'node:test';
import assert from 'node:assert/strict';
import { chartSpec, chartSVG, chartLayout, formatValue, formatShare, visualPalette, VISUAL_TOOLS } from '../dist/core/visual-tools.js';

const pie = { title: 'Traffic', type: 'pie', labels: ['Search', 'Direct', 'Social'], series: [{ name: 'Visits', values: [50, 30, 20] }] };
const stacked = { title: 'Energy', type: 'bar', stacked: true, labels: ['2024', '2025'], series: [{ name: 'Solar', values: [2, 3] }, { name: 'Wind', values: [1, null] }] };

test('pie charts take one series of two to six non-negative parts', () => {
  assert.equal(chartSpec(pie).type, 'pie');
  const reject = (patch, pattern) => assert.throws(() => chartSpec({ ...pie, ...patch }), pattern);
  reject({ labels: ['a'], series: [{ name: 'x', values: [1] }] }, /two to six parts/);
  reject({ labels: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], series: [{ name: 'x', values: [1, 1, 1, 1, 1, 1, 1] }] }, /Use a bar chart/);
  reject({ series: [{ name: 'a', values: [1, 2, 3] }, { name: 'b', values: [1, 2, 3] }] }, /one series/);
  reject({ series: [{ name: 'x', values: [1, null, 2] }] }, /none missing/);
  reject({ series: [{ name: 'x', values: [1, -2, 2] }] }, /zero or more/);
  reject({ series: [{ name: 'x', values: [0, 0, 0] }] }, /at least one above zero/);
  reject({ x_values: [1, 2, 3] }, /no x_values/);
});

test('stacking is for bar and area charts with values of zero or more', () => {
  assert.equal(chartSpec(stacked).stacked, true);
  assert.throws(() => chartSpec({ ...stacked, type: 'line' }), /Only bar and area/);
  assert.throws(() => chartSpec({ ...stacked, series: [{ name: 'a', values: [-1, 2] }] }), /zero or more/);
  assert.throws(() => chartSpec({ ...stacked, stacked: 'yes' }), /true or false/);
  // Earlier artifacts, without the new fields, parse to exactly what they were.
  const old = { title: 'Old', type: 'line', labels: ['a', 'b'], series: [{ name: 's', values: [1, 2] }] };
  assert.deepEqual(Object.keys(chartSpec(old)).sort(), ['description', 'labels', 'series', 'title', 'type', 'x_label', 'y_label']);
});

test('values carry their prefix and suffix on axes, in tooltips and in exports', () => {
  assert.equal(formatValue({ value_prefix: '$' }, -1234.5), '−$1,234.5');
  assert.equal(formatValue({ value_suffix: '%' }, 12.3456789, 5), '12.346%');
  assert.equal(formatShare(1 / 3), '33.3%');
  const svg = chartSVG(chartSpec({ ...stacked, value_suffix: ' GW' }));
  assert.match(svg, />3 GW</, 'the top tick is the largest stacked total');
  assert.throws(() => chartSpec({ ...stacked, value_prefix: 'x'.repeat(9) }), /Value prefix/);
});

test('stacked bars sit on each other with gaps, and only the top of each stack is rounded', () => {
  const spec = chartSpec(stacked), L = chartLayout(spec);
  assert.deepEqual(L.tops, [[2, 3], [3, 3]]); assert.deepEqual(L.bases, [[0, 0], [2, 3]]);
  assert.equal(L.high, 3);
  const svg = chartSVG(spec);
  const bars = [...svg.matchAll(/<path d="([^"]+)" fill="(#[0-9a-f]{6})" class="chart-mark"/g)];
  assert.equal(bars.length, 3, 'the missing Wind value draws nothing');
  assert.deepEqual(bars.map(b => b[2]), [visualPalette[0], visualPalette[0], visualPalette[1]]);
  // 2024: Solar ends where Wind begins, less the 2px gap; Wind carries the rounded end, Solar's top is square.
  const solar2024 = bars[0][1], wind2024 = bars[2][1];
  assert.doesNotMatch(solar2024, /Q/); assert.match(wind2024, /Q/);
  assert.equal(Number(wind2024.match(/^M[\d.]+ ([\d.]+)/)[1]), Number((L.y(2) - 2).toFixed(2)));
  // 2025: Solar is the top of its stack (Wind has no value there), so it is rounded.
  assert.match(bars[1][1], /Q/);
  // Hiding a series restacks the rest; colors follow the series, not its position.
  const hidden = chartSVG(spec, [0]);
  assert.ok(!hidden.includes(visualPalette[0]) && hidden.includes(visualPalette[1]));
});

test('a pie is drawn as a donut with gaps, direct labels for the larger parts and its total', () => {
  const spec = chartSpec({ ...pie, labels: ['Search', 'Direct', 'Social', 'Mail'], series: [{ name: 'Visits', values: [60, 25, 13, 2] }] });
  const L = chartLayout(spec), slices = L.pie.slices;
  assert.ok(Math.abs(slices.at(-1).end - (Math.PI * 1.5)) < 1e-9, 'the slices close the circle');
  assert.deepEqual(slices.map(s => Math.round(s.share * 100)), [60, 25, 13, 2]);
  const svg = chartSVG(spec);
  assert.equal((svg.match(/class="chart-mark" data-key="slice-/g) || []).length, 4);
  assert.match(svg, /stroke="#1e1e1e" stroke-width="2"/);
  assert.match(svg, /Search <tspan fill="#a6a6a6">60%<\/tspan>/);
  assert.doesNotMatch(svg, /Mail <tspan/, 'a 2% slice is left to the legend, tooltip and table');
  assert.match(svg, />100<\/text><text[^>]*>Total</);
  assert.doesNotMatch(chartSVG(chartSpec({ ...pie, value_suffix: '%' })), />Total</, 'no total of percentages');
  // A single non-zero part is a full ring, not a zero-length arc.
  assert.match(chartSVG(chartSpec({ ...pie, series: [{ name: 'x', values: [5, 0, 0] }] })), /fill-rule="evenodd"/);
  const print = chartSVG(spec, [], { print: true });
  assert.match(print, /stroke="#ffffff"/); assert.match(print, /fill="#2a78d6"/); assert.doesNotMatch(print, /#1e1e1e/);
});

test('the inline chart leaves tooltips to its hover layer; exports keep native ones', () => {
  const spec = chartSpec({ title: 'T', type: 'line', labels: ['a', 'b'], series: [{ name: 's', values: [1, 2] }] });
  assert.match(chartSVG(spec), /<circle[^>]*><title>s · a: 1<\/title>/);
  const inline = chartSVG(spec, [], { hover: true });
  assert.equal((inline.match(/<title>/g) || []).length, 1, 'only the chart title remains');
  assert.equal(chartSVG(spec, [], { hover: true }).replace(/<title>[^<]*<\/title>/g, ''), chartSVG(spec).replace(/<title>[^<]*<\/title>/g, ''));
});

test('the model-facing chart schema lists the new types and fields', () => {
  const chart = VISUAL_TOOLS.find(t => t.function.name === 'render_chart').function;
  assert.deepEqual(chart.parameters.properties.type.enum, ['line', 'bar', 'area', 'scatter', 'pie']);
  for (const field of ['stacked', 'value_prefix', 'value_suffix']) assert.ok(chart.parameters.properties[field]?.description, field);
  assert.match(chart.description, /pie for one series of two to six parts/);
  assert.equal(chart.parameters.additionalProperties, false);
});

test('the chart palette is the validated one, in a fixed order', () => {
  assert.deepEqual(visualPalette, ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']);
});

test('axis ticks are round steps that fit the data tightly', async () => {
  const { niceTicks } = await import('../dist/core/visual-tools.js');
  assert.deepEqual(niceTicks(0, 4.5), { low: 0, high: 5, ticks: [0, 1, 2, 3, 4, 5] });
  assert.deepEqual(niceTicks(0, 94).ticks, [0, 25, 50, 75, 100]);
  assert.deepEqual(niceTicks(-3, 4).ticks, [-4, -2, 0, 2, 4]);
  assert.deepEqual(niceTicks(0, 0.07).ticks, [0, 0.02, 0.04, 0.06, 0.08], 'no floating-point residue');
  assert.deepEqual(niceTicks(5, 5).ticks, [4, 4.5, 5, 5.5, 6]);
  for (const [a, b] of [[0, 1], [0, 3], [0, 79], [-120, 0], [0, 1e9]]) {
    const t = niceTicks(a, b); assert.ok(t.low <= a && t.high >= b && t.ticks.length >= 4 && t.ticks.length <= 7, `${a}..${b}`);
    const step = t.ticks[1] - t.ticks[0], mantissa = Number((step / 10 ** Math.floor(Math.log10(step))).toPrecision(6));
    assert.ok([1, 2, 2.5, 5].includes(mantissa), `${a}..${b} step ${step}`);
  }
});

test('series that never share a label get whole centred bars; series that do are grouped', () => {
  // The case seen in use: reported values in one series and a projection in another.
  const split = { title: 'Revenue', type: 'bar', labels: ['2023', '2024', '2025', '2026'], series: [{ name: 'Reported', values: [0.1, 1, 4.5, null] }, { name: 'Projection', values: [null, null, null, 15] }] };
  // The horizontal middle of each bar path: its x coordinates come from M, H and both points of each Q.
  const middle = d => { const xs = []; for (const [, c, a] of d.matchAll(/([MHQV])([^MHQVZ]*)/g)) { const n = a.trim().split(/[ ,]+/).map(Number); if (c === 'M' || c === 'H') xs.push(n[0]); if (c === 'Q') xs.push(n[0], n[2]); } return (Math.min(...xs) + Math.max(...xs)) / 2; };
  const bars = spec => [...chartSVG(chartSpec(spec)).matchAll(/<path d="([^"]+)" fill="[^"]+" class="chart-mark"/g)].map(m => middle(m[1]));
  const L = chartLayout(chartSpec(split)), centres = [0, 1, 2, 3].map(i => L.x(i));
  const split_ = bars(split);
  assert.equal(split_.length, 4);
  split_.forEach((mid, i) => assert.ok(Math.abs(mid - centres[i] + 1) < 0.02, `bar ${i} is centred on its label`));
  const shared = { ...split, series: [{ name: 'Reported', values: [0.1, 1, 4.5, 9] }, { name: 'Projection', values: [null, null, 5, 15] }] };
  const grouped = bars(shared);
  assert.equal(grouped.length, 6);
  assert.ok(grouped[2] < centres[2] && grouped[4] > centres[2], 'bars that share a label sit side by side');
  // Hiding a series re-evaluates the rule, so the remaining series fills its bands.
  assert.equal((chartSVG(chartSpec(shared), [1]).match(/class="chart-mark"/g) || []).length, 4);
});
