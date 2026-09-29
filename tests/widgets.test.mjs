import test from 'node:test';
import assert from 'node:assert/strict';
import { timelineSpec, timelineMarkup, timelineHTML, statsSpec, statsMarkup, statsHTML, statValue, VISUAL_TOOLS, RENDER_KINDS, STRUCTURED_KINDS } from '../dist/core/visual-tools.js';
import { executeVisual } from '../desktop/visual-runtime.mjs';

const timeline = { title: 'Launch history', events: [{ date: '2023', title: 'Beta' }, { date: 'Mar 2025', title: 'General release', description: 'Worldwide.' }, { date: 'Q3 2026', title: 'Version 2', tentative: true }] };
const stats = { title: 'Quarter', stats: [{ label: 'Revenue', value: '$4.2B', delta: '+12% vs Q2', trend: 'up', good: true, sparkline: [3.1, 3.4, 3.8, 4.2] }, { label: 'Churn', value: 2.1, trend: 'down' }, { label: 'Users', value: 1284000 }] };

test('the timeline and stat cards use Tinfoil Chat\'s tool names and argument shapes', () => {
  const tool = name => VISUAL_TOOLS.find(t => t.function.name === name)?.function;
  const t = tool('render_timeline'), s = tool('render_stat_cards');
  assert.deepEqual(t.parameters.required, ['title', 'events']);
  assert.deepEqual(t.parameters.properties.events.items.required, ['date', 'title']);
  assert.deepEqual(Object.keys(t.parameters.properties.events.items.properties), ['date', 'title', 'description', 'tentative']);
  assert.deepEqual(s.parameters.properties.stats.items.required, ['label', 'value']);
  assert.deepEqual(s.parameters.properties.stats.items.properties.trend.enum, ['up', 'down', 'flat']);
  for (const f of [t, s]) { assert.equal(f.parameters.additionalProperties, false); assert.equal(f.parameters.properties.events?.items.additionalProperties ?? f.parameters.properties.stats.items.additionalProperties, false); }
  assert.deepEqual(RENDER_KINDS, { render_chart: 'chart', render_table: 'table', render_diagram: 'diagram', render_timeline: 'timeline', render_stat_cards: 'stats' });
  assert.deepEqual([...STRUCTURED_KINDS].sort(), Object.values(RENDER_KINDS).sort());
});

test('timelines keep their order and fields, and reject what they cannot show', () => {
  const spec = timelineSpec(timeline);
  assert.deepEqual(spec.events.map(e => e.date), ['2023', 'Mar 2025', 'Q3 2026']);
  assert.deepEqual(spec.events[0], { date: '2023', title: 'Beta', description: '' });
  assert.equal(spec.events[2].tentative, true);
  assert.equal('tentative' in timelineSpec({ ...timeline, events: [{ date: 'x', title: 'y', tentative: false }] }).events[0], false);
  const reject = (patch, pattern) => assert.throws(() => timelineSpec({ ...timeline, ...patch }), pattern);
  reject({ events: [] }, /at least one event/);
  reject({ events: Array(41).fill({ date: 'x', title: 'y' }) }, /size limit/);
  reject({ events: [{ date: '', title: 'y' }] }, /Event date/);
  reject({ events: [{ date: 'x', title: 'y', tentative: 'yes' }] }, /true or false/);
  reject({ title: '' }, /Timeline title/);
});

test('stat cards validate values, changes and sparklines', () => {
  const spec = statsSpec(stats);
  assert.deepEqual(spec.stats[1], { label: 'Churn', value: 2.1, trend: 'down' });
  assert.equal('delta' in statsSpec({ title: 'x', stats: [{ label: 'a', value: 1, delta: '' }] }).stats[0], false);
  const reject = (card, pattern) => assert.throws(() => statsSpec({ title: 'x', stats: [card] }), pattern);
  reject({ label: 'a', value: Infinity }, /finite/);
  reject({ label: 'a', value: 'x'.repeat(41) }, /Stat value/);
  reject({ label: 'a', value: 1, trend: 'sideways' }, /up, down or flat/);
  reject({ label: 'a', value: 1, good: 1 }, /true or false/);
  reject({ label: 'a', value: 1, sparkline: [1] }, /at least two/);
  reject({ label: 'a', value: 1, sparkline: Array(25).fill(1) }, /size limit/);
  assert.throws(() => statsSpec({ title: 'x', stats: Array(9).fill({ label: 'a', value: 1 }) }), /size limit/);
  assert.throws(() => statsSpec({ title: 'x', stats: [] }), /at least one figure/);
});

test('stat values: text as given, numbers grouped and compact from 10,000', () => {
  assert.equal(statValue('$4.2B'), '$4.2B');
  assert.equal(statValue(1284), '1,284');
  assert.equal(statValue(2.456), '2.46');
  assert.equal(statValue(12900), '12.9K');
  assert.equal(statValue(1284000), '1.3M');
  assert.equal(statValue(-4200000), '−4.2M');
});

test('widget markup is inert: model text is escaped and nothing runs or loads', () => {
  const hostile = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const t = timelineMarkup(timelineSpec({ title: 'x', events: [{ date: hostile, title: hostile, description: hostile }] }));
  const s = statsMarkup(statsSpec({ title: 'x', stats: [{ label: hostile, value: hostile.slice(0, 40), delta: hostile.slice(0, 60) }] }));
  for (const html of [t, s, timelineHTML(timelineSpec({ ...timeline, title: hostile })), statsHTML(statsSpec({ ...stats, description: hostile }))]) {
    // Only the renderer's own tags and attributes appear; the hostile text survives as text.
    for (const [, tag, attributes] of html.matchAll(/<([a-z0-9]+)([^>]*)>/gi)) {
      assert.ok(['style', 'section', 'h1', 'p', 'ol', 'ul', 'li', 'span', 'strong', 'svg', 'polyline', 'circle'].includes(tag), tag);
      for (const [, name] of attributes.matchAll(/\s([a-z-]+)=/gi)) assert.ok(['class', 'aria-hidden', 'focusable', 'viewBox', 'width', 'height', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-linejoin', 'stroke-linecap', 'cx', 'cy', 'r'].includes(name), name);
    }
    assert.ok(html.includes('&lt;script&gt;') && !/https?:|url\(/i.test(html));
  }
});

test('a change is told by arrow, words and text, with colour only where the model said good or bad', () => {
  const html = statsMarkup(statsSpec(stats));
  assert.match(html, /<span class="stat-arrow good" aria-hidden="true">↑<\/span><span class="sr-only">Up, good: <\/span>\+12% vs Q2/);
  assert.match(html, /<span class="stat-arrow" aria-hidden="true">↓<\/span><span class="sr-only">Down: <\/span>/, 'no colour without a judgement');
  assert.equal((html.match(/class="stat-spark"/g) || []).length, 1);
  assert.match(html, /<strong class="stat-value">1\.3M<\/strong>/);
  const tl = timelineMarkup(timelineSpec(timeline));
  assert.match(tl, /^<ol class="wb-timeline">/);
  assert.match(tl, /<li class="tentative"><span class="when">Q3 2026<span class="tentative-tag">Tentative<\/span><\/span>/, 'a tentative event says so in words');
});

test('the runtime creates timeline and stat card artifacts, and revises them', async () => {
  const created = await executeVisual('render_timeline', JSON.stringify({ ...timeline, title: 'Launches, 2023–2026' }));
  const a = created.artifacts[0];
  assert.equal(a.kind, 'timeline'); assert.equal(a.mime, 'text/html'); assert.equal(a.name, 'Launches 2023-2026.html');
  assert.deepEqual(JSON.parse(a.source), timelineSpec({ ...timeline, title: 'Launches, 2023–2026', description: '' }));
  assert.match(Buffer.from(a.data, 'base64').toString(), /<ol class="wb-timeline">/);
  assert.equal(created.output.kind, 'timeline');
  const revised = (await executeVisual('update_artifact', JSON.stringify({ artifact_id: a.id, source: JSON.stringify({ events: [{ date: '2027', title: 'Version 3' }] }) }), { artifacts: [a] })).artifacts[0];
  assert.equal(revised.kind, 'timeline'); assert.equal(revised.version, 2); assert.equal(revised.title, 'Launches, 2023–2026');
  const card = (await executeVisual('render_stat_cards', JSON.stringify(stats))).artifacts[0];
  assert.equal(card.kind, 'stats'); assert.equal(card.mime, 'text/html'); assert.equal(card.name, 'Quarter.html');
  await assert.rejects(executeVisual('render_stat_cards', JSON.stringify({ title: 'x', stats: [{ label: 'a' }] })), /Stat value/);
  await assert.rejects(executeVisual('render_clock', '{}'), /Unregistered/);
});
