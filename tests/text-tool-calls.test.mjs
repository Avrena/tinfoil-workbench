import test from 'node:test';
import assert from 'node:assert/strict';
import { findTextToolCalls } from '../dist/core/tools.js';
import { buildHistory } from '../dist/core/workspace.js';
import { WorkbenchService } from '../desktop/service.mjs';

const DRAWING = new Set(['render_chart', 'render_table']);
const CHART = { title: 'Populations', type: 'bar', labels: ['Tokyo', 'Yokohama'], series: [{ name: 'Millions', values: [9.73, 3.78] }] };

test('text-form calls are found with nested and quoted braces, parentheses and a fence of their own', () => {
  const quoted = { title: 'Braces } and { in "text"', type: 'bar', labels: ['a'], series: [{ name: 's', values: [1] }] };
  const text = `Intro.\n\nrender_chart${JSON.stringify(quoted)}\n\nMiddle.\n\nrender_table({"title":"T","columns":["a"],"rows":[["x"]]})\n\n\`\`\`json\nrender_chart${JSON.stringify(CHART)}\n\`\`\`\nEnd.`;
  const found = findTextToolCalls(text, DRAWING);
  assert.deepEqual(found.map(f => f.name), ['render_chart', 'render_table', 'render_chart']);
  assert.deepEqual(JSON.parse(found[0].arguments), quoted);
  assert.equal(text.slice(found[1].start, found[1].end), 'render_table({"title":"T","columns":["a"],"rows":[["x"]]})');
  assert.ok(text.slice(found[2].start, found[2].end).startsWith('```json\n') && text.slice(found[2].start, found[2].end).endsWith('```'));
});

test('anything but a named tool with one JSON object stays text', () => {
  for (const text of ['render_chart{"title":', 'render_chart{not json}', 'render_chart(["a"])', 'python{"code":"print(1)"}', 'myrender_chart{"a":1}', 'render_chart({"a":1}']) assert.deepEqual(findTextToolCalls(text, DRAWING), [], text);
  assert.equal(findTextToolCalls('render_chart{"a":1} render_chart{"b":2} render_chart{"c":3}', DRAWING, 2).length, 2);
});

function vault() { let value = null; return { read: async () => value, write: async v => { value = structuredClone(v); }, flush: async () => {} }; }
async function setup(t, content, { visual = true, python = false } = {}) {
  const calls = [];
  const client = { ready: async () => {}, getVerificationDocument: async () => ({ securityVerified: true, steps: { verifyCode: { status: 'success' } } }),
    models: { list: async () => ({ data: [{ id: 'a' }] }) },
    chat: { completions: { create: async body => { calls.push(structuredClone(body)); return (async function* () {
      yield { choices: [{ delta: { content } }] }; yield { choices: [{ delta: {}, finish_reason: 'stop' }] }; })(); } } } };
  const never = async () => { throw new Error('Python must not run for text written by a model.'); };
  const s = new WorkbenchService(vault(), async () => client, () => {}, python ? never : null); await s.initialize(); await s.execute({ type: 'credentials.set', key: 'test-only-not-real' });
  Object.assign(s.workspace.threads[0].settings, { model: 'a', visualTools: visual, toolsMode: python ? 'ask' : 'off' });
  if (python) s.workspace.pythonPath = 'python-never-started.exe'; // offering Python needs an interpreter; nothing runs here
  t.after(() => s.shutdown());
  await s.execute({ type: 'send', id: s.workspace.activeId, text: 'Show the populations.', attachments: [] });
  while (s.tasks.size) await Promise.all([...s.tasks]);
  return { s, calls, thread: s.workspace.threads[0], reply: s.workspace.threads[0].turns[0].replies[0] };
}

test('a chart call written as text is drawn in its place and recorded as a real call', async t => {
  const { calls, thread, reply } = await setup(t, `Here is a chart:\n\nrender_chart${JSON.stringify(CHART)}\n\nTokyo is far larger.`);
  assert.equal(calls.length, 1, 'no further request');
  assert.equal(reply.status, 'complete');
  assert.equal(reply.content, 'Here is a chart:\n\nTokyo is far larger.');
  assert.equal(reply.tools.length, 1);
  const [tool] = reply.tools;
  assert.equal(tool.origin, 'text'); assert.equal(tool.name, 'render_chart'); assert.equal(tool.status, 'complete'); assert.equal(tool.contentOffset, 'Here is a chart:'.length);
  assert.equal(tool.artifacts.length, 1);
  const [assistant, result] = reply.toolMessages;
  assert.equal(assistant.content, 'Here is a chart:'); assert.equal(assistant.tool_calls[0].function.name, 'render_chart'); assert.equal(result.role, 'tool'); assert.equal(result.tool_call_id, assistant.tool_calls[0].id);
  const history = buildHistory(thread);
  assert.deepEqual(history.slice(-3).map(m => m.role), ['assistant', 'tool', 'assistant']);
  assert.equal(history.at(-1).content, 'Tokyo is far larger.');
});

test('an invalid chart, visual tools turned off, or a Python call written as text all stay text', async t => {
  const invalid = `Chart:\n\nrender_chart{"title":"No data"}\n\nDone.`;
  let { reply } = await setup(t, invalid);
  assert.equal(reply.content, invalid); assert.equal(reply.tools.length, 0); assert.equal(reply.toolMessages.length, 0);
  const valid = `Chart:\n\nrender_chart${JSON.stringify(CHART)}`;
  ({ reply } = await setup(t, valid, { visual: false }));
  assert.equal(reply.content, valid); assert.equal(reply.tools.length, 0);
  const python = 'Run this:\n\npython{"code":"print(1)"}';
  ({ reply } = await setup(t, python, { python: true }));
  assert.equal(reply.content, python); assert.equal(reply.tools.length, 0);
});
