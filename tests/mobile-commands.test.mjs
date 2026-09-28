import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkbenchService } from '../desktop/service.mjs';
import { createCommandHandler, CHAT_UNAVAILABLE, PYTHON_UNAVAILABLE, PYTHON_SETTING, PDF_UNAVAILABLE, WINDOW_UNAVAILABLE } from '../mobile/commands.mjs';

const b64 = value => Buffer.from(value).toString('base64');
const chunk = (delta, finish_reason) => ({ choices: [{ delta, finish_reason }] });
const proposal = (name, args) => chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, 'tool_calls');
const done = async s => { while (s.tasks.size) await Promise.all([...s.tasks]); };

// Scripted stand-in for the Android plugin: queued dialog answers and picker results, recorded calls.
function fakeNative() {
  const n = { answers: [], picks: [], confirms: [], saved: [], opened: [], copied: [], pickRequests: [],
    async confirm(options) { n.confirms.push(options); return { confirmed: n.answers.shift() ?? false }; },
    async openDocuments(options) { n.pickRequests.push(options); return { files: n.picks.shift() ?? [] }; },
    async saveDocument(file) { n.saved.push(file); return { saved: true }; },
    async openExternal({ url }) { n.opened.push(url); },
    async copyText({ text }) { n.copied.push(text); },
  };
  return n;
}
async function setup(t, generator = null) {
  let stored = null, providerCalls = 0;
  const vault = { read: async () => structuredClone(stored), write: async v => { stored = structuredClone(v); }, flush: async () => {} };
  const client = { ready: async () => {}, getVerificationDocument: async () => ({ securityVerified: true, steps: {} }),
    chat: { completions: { create: async body => { providerCalls++; return generator(providerCalls, body); } } } };
  const s = new WorkbenchService(vault, async () => { if (!generator) throw new Error('No provider expected'); return client; });
  await s.initialize();
  t.after(() => s.shutdown());
  const native = fakeNative();
  const command = createCommandHandler({ service: s, native, uuid: () => 'uuid-fixture' });
  return { s, native, command, get providerCalls() { return providerCalls; } };
}

test('every result is an Android snapshot without credentials', async t => {
  const { s, command } = await setup(t);
  const { snapshot } = await command({ type: 'credentials.set', key: 'test-only-not-real' });
  assert.equal(snapshot.platform, 'android');
  assert.equal(snapshot.hasKey, true);
  assert.ok(!('apiKey' in snapshot.workspace));
  assert.equal(s.workspace.apiKey, 'test-only-not-real');
});

test('desktop-only features fail with explicit Android messages', async t => {
  const { command, native } = await setup(t);
  for (const type of ['account.login', 'account.cancel', 'account.refresh', 'account.manage', 'account.signout'])
    await assert.rejects(command({ type }), { message: CHAT_UNAVAILABLE });
  await assert.rejects(command({ type: 'connection.mode', mode: 'chat-account' }), { message: CHAT_UNAVAILABLE });
  assert.equal((await command({ type: 'connection.mode', mode: 'api-key' })).snapshot.connectionMode, 'api-key');
  for (const type of ['window', 'window.close-ack', 'window.close-response'])
    await assert.rejects(command({ type, action: 'close', requestId: 'x', allow: true }), { message: WINDOW_UNAVAILABLE });
  await assert.rejects(command({ type: 'python.pick' }), { message: PYTHON_UNAVAILABLE });
  await assert.rejects(command({ type: 'code.run', id: 'x', replyId: 'y', index: 0 }), { message: PYTHON_UNAVAILABLE });
  assert.equal(native.confirms.length, 0);
});

test('model-requested Python cannot be enabled or used on Android', async t => {
  const { s, command, providerCalls } = await setup(t);
  const thread = s.workspace.threads[0];
  await assert.rejects(command({ type: 'thread.settings', id: thread.id, settings: { ...thread.settings, toolsMode: 'ask' } }), { message: PYTHON_SETTING });
  assert.equal(thread.settings.toolsMode, 'off');
  await command({ type: 'thread.settings', id: thread.id, settings: { ...thread.settings, systemPrompt: 'Optional' } });
  assert.equal(s.workspace.threads[0].settings.systemPrompt, 'Optional');
  s.workspace.threads[0].settings.toolsMode = 'ask'; // e.g. an imported desktop conversation
  await assert.rejects(command({ type: 'send', id: thread.id, text: 'Hello', attachments: [] }), { message: PYTHON_SETTING });
  assert.equal(providerCalls, 0);
});

test('deleting a conversation requires native confirmation', async t => {
  const { s, command, native } = await setup(t);
  await command({ type: 'thread.new' });
  const target = s.workspace.threads[0];
  await command({ type: 'thread.delete', id: target.id });
  assert.ok(s.workspace.threads.some(th => th.id === target.id));
  assert.match(native.confirms[0].title, /Delete/);
  native.answers.push(true);
  await command({ type: 'thread.delete', id: target.id });
  assert.ok(!s.workspace.threads.some(th => th.id === target.id));
});

test('external links are validated, confirmed natively, then opened', async t => {
  const { command, native } = await setup(t);
  await assert.rejects(command({ type: 'open.url', url: 'javascript:alert(1)' }), /Only absolute HTTP/);
  await assert.rejects(command({ type: 'open.url', url: 'https://user:pass@example.com/' }), /Only absolute HTTP/);
  assert.equal(native.confirms.length, 0);
  await command({ type: 'open.url', url: 'https://example.com/a' });
  assert.deepEqual(native.opened, []);
  native.answers.push(true);
  await command({ type: 'open.url', url: 'https://example.com/a' });
  assert.deepEqual(native.opened, ['https://example.com/a']);
  await command({ type: 'open.docs' });
  assert.equal(native.opened.at(-1), 'https://docs.tinfoil.sh/get-api-key');
});

test('attachments pass the desktop extension, UTF-8, NUL and count checks', async t => {
  const { command, native } = await setup(t);
  assert.deepEqual((await command({ type: 'attachments.pick' })).attachments, []);
  assert.equal(native.pickRequests[0].maxCount, 9);
  native.picks.push([{ name: 'notes.md', data: b64('# Unsent 中文') }]);
  assert.deepEqual((await command({ type: 'attachments.pick' })).attachments, [{ name: 'notes.md', content: '# Unsent 中文' }]);
  native.picks.push([{ name: 'tool.exe', data: b64('MZ') }]);
  await assert.rejects(command({ type: 'attachments.pick' }), /Only supported text/);
  native.picks.push([{ name: 'bad.txt', data: Buffer.from([0xff, 0xfe, 0x00]).toString('base64') }]);
  await assert.rejects(command({ type: 'attachments.pick' }), /UTF-8/);
  native.picks.push([{ name: 'nul.txt', data: b64('a\0b') }]);
  await assert.rejects(command({ type: 'attachments.pick' }), /Binary/);
  native.picks.push(Array.from({ length: 9 }, (_, i) => ({ name: `f${i}.txt`, data: b64('x') })));
  await assert.rejects(command({ type: 'attachments.pick' }), /at most eight/);
});

test('local previews are type-checked like the desktop picker', async t => {
  const { command, native } = await setup(t);
  native.picks.push([{ name: 'doc.pdf', data: b64('%PDF-1.7 fixture') }]);
  const { artifact } = await command({ type: 'artifact.open', id: 'unused' });
  assert.deepEqual(artifact, { id: 'uuid-fixture', name: 'doc.pdf', mime: 'application/pdf', data: b64('%PDF-1.7 fixture') });
  native.picks.push([{ name: 'fake.pdf', data: b64('not a pdf') }]);
  await assert.rejects(command({ type: 'artifact.open', id: 'unused' }), /PDF/);
  native.picks.push([{ name: 'image.png', data: b64('GIF89a') }]);
  await assert.rejects(command({ type: 'artifact.open', id: 'unused' }), /PNG/);
  native.picks.push([{ name: 'archive.zip', data: b64('PK') }]);
  await assert.rejects(command({ type: 'artifact.open', id: 'unused' }), /Unsupported/);
  assert.equal(native.pickRequests[0].maxBytes, 2 * 1024 * 1024);
});

test('export requires confirmation and round-trips through import', async t => {
  const { s, command, native } = await setup(t);
  const id = s.workspace.activeId;
  await command({ type: 'thread.rename', id, title: 'Exported thread' });
  await command({ type: 'export', id, format: 'json' });
  assert.equal(native.saved.length, 0);
  native.answers.push(true);
  await command({ type: 'export', id, format: 'json' });
  assert.equal(native.saved[0].name, 'conversation.json');
  assert.equal(native.saved[0].mime, 'application/json');
  assert.doesNotMatch(Buffer.from(native.saved[0].data, 'base64').toString(), /apiKey/);
  const before = s.workspace.threads.length;
  native.picks.push([{ name: 'conversation.json', data: native.saved[0].data }]);
  await command({ type: 'import' });
  assert.equal(s.workspace.threads.length, before + 1);
  native.picks.push([{ name: 'broken.json', data: b64('{not json') }]);
  await assert.rejects(command({ type: 'import' }), /not valid JSON/);
  native.answers.push(true);
  await command({ type: 'export', id, format: 'markdown' });
  assert.equal(native.saved[1].mime, 'text/markdown');
  assert.match(Buffer.from(native.saved[1].data, 'base64').toString(), /Exported thread/);
});

test('generated files: HTML needs a warning, PDFs save as-is, other PDF export is unavailable', async t => {
  const { s, command, native } = await setup(t, async function* (n) {
    yield n === 1 ? proposal('create_artifact', { kind: 'html', title: 'Page', source: '<p>Hi</p>' }) : chunk({ content: 'Done' }, 'stop');
  });
  s.workspace.apiKey = 'fixture-key';
  s.workspace.threads[0].settings.model = 'fixture';
  await command({ type: 'send', id: s.workspace.activeId, text: 'Make a page', attachments: [] });
  await done(s);
  const thread = s.workspace.threads[0], tool = thread.turns[0].replies[0].tools[0], artifact = tool.artifacts[0];
  const ref = { id: thread.id, toolId: tool.id, artifactId: artifact.id };
  await command({ type: 'artifact.save', ...ref });
  assert.equal(native.saved.length, 0);
  assert.match(native.confirms.at(-1).title, /markup/);
  native.answers.push(true);
  await command({ type: 'artifact.save', ...ref });
  assert.deepEqual(native.saved[0], { name: artifact.name, mime: 'text/html', data: artifact.data });
  await assert.rejects(command({ type: 'artifact.pdf', ...ref }), { message: PDF_UNAVAILABLE });
  artifact.mime = 'application/pdf'; artifact.name = 'Page.pdf';
  await command({ type: 'artifact.pdf', ...ref });
  assert.deepEqual(native.saved[1], { name: 'Page.pdf', mime: 'application/pdf', data: artifact.data });
  await assert.rejects(command({ type: 'artifact.save', ...ref, artifactId: 'missing' }), /no longer exists/);
});

test('delegated requests use a native confirmation and recheck the pending request', async t => {
  const { s, command, native } = await setup(t);
  const threadId = s.workspace.activeId, answers = [];
  const pending = tool => s.approvals.set(tool.id, { threadId, tool, resolve: value => answers.push(value) });
  pending({ id: 'delegate-1', name: 'delegate_task', delegate: { model: 'fixture', task: 'Summarize' } });
  native.answers.push(true);
  await command({ type: 'tool.approve', id: threadId, toolId: 'delegate-1', approve: true });
  assert.match(native.confirms[0].message, /Summarize/);
  pending({ id: 'delegate-2', name: 'delegate_task', delegate: { model: 'fixture', task: 'Second' } });
  native.answers.push(false);
  await command({ type: 'tool.approve', id: threadId, toolId: 'delegate-2', approve: true });
  assert.deepEqual(answers, [true, false]);
  pending({ id: 'python-1', name: 'python', arguments: '{"code":"print(1)"}' });
  await assert.rejects(command({ type: 'tool.approve', id: threadId, toolId: 'python-1', approve: true }), { message: PYTHON_UNAVAILABLE });
  await command({ type: 'tool.approve', id: threadId, toolId: 'python-1', approve: false });
  assert.deepEqual(answers, [true, false, false]);
  await assert.rejects(command({ type: 'tool.approve', id: threadId, toolId: 'python-1', approve: false }), /no longer awaiting/);
});

test('clipboard failures report an Android message', async t => {
  const { command, native } = await setup(t);
  await command({ type: 'clipboard', text: 'copied' });
  assert.deepEqual(native.copied, ['copied']);
  native.copyText = async () => { throw new Error('denied'); };
  await assert.rejects(command({ type: 'clipboard', text: 'x' }), /Android could not update the clipboard/);
});
