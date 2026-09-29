import test from 'node:test';
import assert from 'node:assert/strict';
import { threadFromCloud, cloudPatch, cloudWidgets, CLOUD_FORMAT } from '../dist/core/cloud.js';
import { validateThread } from '../dist/core/validation.js';
import { buildHistory } from '../dist/core/workspace.js';

const NOW = Date.parse('2026-09-29T12:00:00Z');
const link = { id: '8200000000000_chat', etag: '4', project: null };
const call = (id, name, args) => ({ type: 'tool_call', id: 'b' + id, toolCallId: 'call_' + id, name, arguments: typeof args === 'string' ? args : JSON.stringify(args) });
const text = (id, content) => ({ type: 'content', id: 'c' + id, content });
const decode = artifact => Buffer.from(artifact.data, 'base64').toString('utf8');
// An answer as Tinfoil Chat stores it: its text and widget calls in order in `timeline`, `content` the text joined.
const answer = timeline => ({ role: 'assistant', modelDisplayName: 'Kimi K3', content: timeline.filter(b => b.type === 'content').map(b => b.content).join(''), timeline,
  toolCalls: timeline.filter(b => b.type === 'tool_call').map(b => ({ id: b.toolCallId, name: b.name, arguments: b.arguments })) });
const chatWith = message => ({ title: 'Widgets', createdAt: '2026-09-20T10:00:00.000Z', updatedAt: '2026-09-21T10:00:00.000Z', model: 'kimi-k3', clock: 3, writer: 'web.x', clockVersion: 3,
  messages: [{ role: 'user', content: 'How has revenue grown?', timestamp: '2026-09-20T10:00:00.000Z' }, message] });

test('Tinfoil Chat widgets become visuals where Tinfoil Chat shows them, drawn by Workbench from their arguments', () => {
  const message = answer([
    { type: 'thinking', id: 't', content: 'Plan the charts.', isThinking: false },
    text(1, 'Revenue grew fast.\n\n'),
    call(1, 'render_chart', { type: 'bar', title: 'Revenue', data: [{ year: '2023', revenue: 1 }, { year: '2024', revenue: '4.5' }, { year: '2025', revenue: 9 }] }),
    text(2, 'The milestones:\n\n'),
    call(2, 'render_timeline', { events: [{ date: '2021', title: 'Founded' }, { date: '2023', title: 'First model', description: 'Released in March.' }] }),
    // Tinfoil Chat's widgets accept a nested list sent as JSON text.
    call(3, 'render_stat_cards', { stats: JSON.stringify([{ label: 'Run rate', value: '$9B', trend: 'up' }, { label: 'Staff', value: 1000 }]) }),
    call(4, 'render_map', { query: 'San Francisco' }),
    text(3, 'That is the picture.'),
  ]);
  const thread = threadFromCloud(chatWith(message), link, null, NOW), reply = thread.turns[0].replies[0];
  assert.equal(reply.content, message.content, 'the text is the answer\'s own');
  assert.deepEqual(reply.tools.map(t => [t.name, t.status, t.contentOffset, t.origin]), [
    ['render_chart', 'complete', 'Revenue grew fast.\n\n'.length, 'model'],
    ['render_timeline', 'complete', message.content.indexOf('That is'), 'model'],
    ['render_stat_cards', 'complete', message.content.indexOf('That is'), 'model'],
    ['render_map', 'complete', message.content.indexOf('That is'), 'model'],
  ]);
  const [chart, timeline, stats, map] = reply.tools.map(t => t.artifacts[0]);
  assert.deepEqual([chart.kind, chart.mime, chart.title, chart.name], ['chart', 'image/svg+xml', 'Revenue', 'Revenue.svg']);
  const spec = JSON.parse(chart.source);
  assert.deepEqual([spec.type, spec.labels, spec.series], ['bar', ['2023', '2024', '2025'], [{ name: 'revenue', values: [1, 4.5, 9] }]]);
  assert.match(decode(chart), /^<svg/);
  assert.deepEqual([timeline.kind, timeline.mime, timeline.title, JSON.parse(timeline.source).events.length], ['timeline', 'text/html', 'Timeline', 2]);
  assert.deepEqual([stats.kind, stats.title, JSON.parse(stats.source).stats.map(s => s.value)], ['stats', 'Key figures', ['$9B', 1000]]);
  assert.equal(map, undefined, 'a map is not drawn');
  assert.match(reply.tools[3].stdout, /showed a map here, which Workbench does not display/);
  assert.equal(validateThread(structuredClone(thread)).turns[0].replies[0].tools.length, 4, 'the result is a valid conversation');
  assert.deepEqual([thread.cloud.format, CLOUD_FORMAT], [2, 2]);
  // The model sees the answer's text, never the widget calls, when the conversation continues.
  const history = buildHistory(thread);
  assert.deepEqual(history.map(m => [m.role, m.content]), [['user', 'How has revenue grown?'], ['assistant', message.content]]);
  // Writing the chat back keeps the widget calls and every other field of the answer.
  assert.deepEqual(cloudPatch(chatWith(message), thread, { v: 4, w: 'wb.x', version: 5 }, NOW).messages, chatWith(message).messages);
});

test('widgets follow the text when their place is unknown, and bad or hostile arguments are shown as errors, never run', () => {
  const content = 'Answer text.';
  // The timeline's text does not match the answer's: the widget goes after the text.
  const moved = cloudWidgets({ content, timeline: [text(1, 'Other '), call(1, 'render_timeline', { events: [{ date: '1969', title: 'Apollo 11' }] }), text(2, 'text.')] }, content);
  assert.equal(moved[0].contentOffset, content.length);
  // Only the toolCalls list: after the text as well.
  const listed = cloudWidgets({ content, toolCalls: [{ id: 'x', name: 'render_stat_cards', arguments: JSON.stringify({ stats: [{ label: 'A', value: 1 }] }) }] }, content);
  assert.deepEqual(listed.map(t => [t.contentOffset, t.status, t.artifacts.length]), [[content.length, 'complete', 1]]);
  const runs = cloudWidgets({ content, timeline: [text(1, content),
    call(1, 'render_chart', { type: 'bar', data: [{ name: 'a' }, { name: 'b' }] }),
    call(2, 'render_timeline', '{not json'),
    call(3, 'render_timeline', { title: '<img src=x onerror=alert(1)>', events: [{ date: '<script>alert(1)</script>', title: 'x' }] }),
    call(4, 'render_chart', { type: 'pie', data: Array.from({ length: 8 }, (_, i) => ({ part: 'P' + i, share: i + 1 })) }),
    call(5, 'render_something_new', {}),
  ] }, content);
  assert.deepEqual(runs.map(t => t.status), ['error', 'error', 'complete', 'complete', 'complete']);
  assert.match(runs[0].stderr, /^This chart from Tinfoil Chat could not be drawn: /);
  assert.match(runs[1].stderr, /^This timeline from Tinfoil Chat could not be drawn: /);
  const html = decode(runs[2].artifacts[0]);
  assert.ok(!/<img|<script/i.test(html) && html.includes('&lt;img'), 'model text is escaped');
  assert.equal(JSON.parse(runs[3].artifacts[0].source).type, 'bar', 'a pie of more than six parts is drawn as bars');
  assert.match(runs[4].stdout, /showed a widget here/);
  assert.deepEqual(cloudWidgets({ content, timeline: [1, null, 'x', { type: 'tool_call' }] }, content), [], 'malformed blocks are ignored');
  assert.deepEqual(cloudWidgets(null, ''), []);
  assert.equal(cloudWidgets({ content: '', toolCalls: Array.from({ length: 40 }, (_, i) => ({ id: 'c' + i, name: 'render_map', arguments: '{}' })) }, '').length, 32, 'at most 32 widgets per answer');
});
