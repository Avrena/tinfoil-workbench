import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CloudSync } from '../desktop/cloud-sync.mjs';
import { editReply } from '../dist/core/editing.js';
import { showVersion } from '../dist/core/versions.js';
import { CloudClient, CloudError, cloudKeyId, cloudChatId, SYNC_URL } from '../desktop/cloud-client.mjs';
import { parseCloudKey } from '../dist/core/cloud.js';
import { newWorkspace, addThread } from '../dist/core/workspace.js';
import { validateWorkspace } from '../dist/core/validation.js';
import { publicError } from '../dist/core/security.js';

const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const encode = bytes => 'key_' + [...bytes].map(b => CHARS[Math.floor(b / 36)] + CHARS[b % 36]).join('');
const KEY = encode(Uint8Array.from({ length: 32 }, (_, i) => (i * 53 + 7) % 256)), KEY_ID = cloudKeyId(parseCloudKey(KEY).bytes);
const b64 = v => Buffer.from(JSON.stringify(v), 'utf8').toString('base64');
const chat = (title, turns = 1, extra = {}) => ({ title, createdAt: '2026-09-20T10:00:00.000Z', updatedAt: '2026-09-21T10:00:00.000Z', model: 'kimi-k3', unknownTop: 1, ...extra,
  messages: Array.from({ length: turns }, (_, i) => [{ role: 'user', content: `${title} question ${i}`, keep: i }, { role: 'assistant', content: `${title} answer ${i}`, thoughts: 'why', timeline: [1] }]).flat() });

/** An in-memory stand-in for the sync enclave with its version rules: a push must name the current version ('0'
 * creates only), versions only grow, and listings are newest first. */
function enclave({ keyId = KEY_ID } = {}) {
  const rows = { chat: new Map(), project: new Map(), project_document: new Map() }, calls = [];
  let clock = 0, nextId = 0;
  const at = () => new Date(Date.parse('2026-09-22T00:00:00Z') + ++clock * 1000).toISOString();
  const api = {
    rows, calls,
    seed(scope, id, plain, project = null) { rows[scope].set(id, { etag: 1, plain: structuredClone(plain), project, updated_at: at() }); },
    edit(scope, id, change) { const r = rows[scope].get(id); change(r.plain); r.etag++; r.updated_at = at(); },
    async keyCurrent() { calls.push(['key']); return { keyId, hasData: true }; },
    async listStatus(scope, { cursor, limit }) {
      calls.push(['list', scope]);
      const all = [...rows[scope]].sort((a, b) => b[1].updated_at.localeCompare(a[1].updated_at)), start = Number(cursor ?? 0);
      const updates = all.slice(start, start + limit).map(([id, r]) => ({ id, etag: String(r.etag), key_id: keyId, project_id: r.project, updated_at: r.updated_at }));
      return { updates, deletes: [], next: start + limit < all.length ? String(start + limit) : null };
    },
    async pull(scope, ids, key) {
      calls.push(['pull', scope, ids.length]); assert.equal(key.id, keyId); assert.ok(ids.length <= 100);
      return ids.map(id => { const r = rows[scope].get(id); return r ? { id, ok: true, plaintext: b64(r.plain), etag: String(r.etag), project_id: r.project } : { id, ok: false, code: 'NOT_FOUND' }; });
    },
    async push(scope, id, key, plain, ifMatch, metadata) {
      calls.push(['push', scope, id, ifMatch, metadata]);
      const r = rows[scope].get(id);
      if (ifMatch === '0' ? r : String(r?.etag) !== ifMatch) throw new CloudError('Tinfoil cloud sync refused the request (SYNC_CONFLICT).', 409, 'SYNC_CONFLICT');
      const project = 'projectId' in metadata ? metadata.projectId : r?.project ?? null;
      rows[scope].set(id, { etag: (r?.etag ?? 0) + 1, plain: structuredClone(plain), project, updated_at: at() });
      return String(rows[scope].get(id).etag);
    },
    async remove(scope, id, key, ifMatch) { calls.push(['delete', scope, id, ifMatch]); const r = rows[scope].get(id); if (String(r?.etag) !== ifMatch) throw new CloudError('conflict', 409, 'SYNC_CONFLICT'); rows[scope].delete(id); },
    async newChatId() { calls.push(['id']); return `8199999999999_${++nextId}`; },
  };
  return api;
}
function setup({ user = 'user_test', ws = newWorkspace(), server = enclave() } = {}) {
  const notices = [], account = { user, async sessionToken() { return { bearer: 'clerk-test-only', user: account.user }; } };
  const host = { workspace: () => ws, save: async () => { validateWorkspace(structuredClone(ws)); }, emit: () => {}, notice: m => notices.push(m),
    ensureActive: () => { if (!ws.threads.length) addThread(ws); if (!ws.threads.some(t => t.id === ws.activeId)) ws.activeId = ws.threads[0].id; } };
  const sync = new CloudSync({ client: server, host, account, now: () => Date.parse('2026-09-29T12:00:00Z') });
  return { sync, ws, server, notices, account };
}
const byCloud = (ws, id) => ws.threads.find(t => t.cloud?.id === id);

test('a key is kept only if it is the account\'s current chat key; nothing is written to the cloud', async () => {
  const { sync, ws, server } = setup();
  await assert.rejects(sync.connect('not a key'), /not a Tinfoil chat key/);
  const other = encode(Uint8Array.from({ length: 32 }, () => 9));
  await assert.rejects(sync.connect(other), /not your account's current chat key/);
  assert.equal(ws.cloud, undefined);
  await sync.connect(`-----BEGIN TINFOIL CHAT ENCRYPTION KEY-----\n${KEY.slice(4)}\n-----END TINFOIL CHAT ENCRYPTION KEY-----`);
  assert.deepEqual([ws.cloud.key, ws.cloud.keyId, ws.cloud.user, ws.cloud.clock], [KEY, KEY_ID, 'user_test', 0]); assert.match(ws.cloud.writer, /^workbench\./);
  assert.ok(!server.calls.some(c => c[0] === 'push' || c[0] === 'delete'));
  const empty = setup({ server: enclave({ keyId: null }) });
  await assert.rejects(empty.sync.connect(KEY), /no cloud chat key yet/);
});

test('syncing lists cloud chats by title, maps projects and documents, and loads a chat when it is opened', async () => {
  const server = enclave();
  server.seed('project', 'p1', { name: 'Research', description: 'Papers', systemInstructions: 'Cite.', color: 'blue', memory: [] });
  server.seed('project_document', 'p1/d1', { filename: 'notes.txt', contentType: 'text/plain', content: 'Abstract.' });
  server.seed('project_document', 'other/d9', { filename: 'x', content: 'not ours' });
  server.seed('chat', 'c1', chat('Trip', 2)); server.seed('chat', 'c2', chat('Paper', 1), 'p1');
  const { sync, ws } = setup({ server });
  await sync.connect(KEY);
  const project = ws.projects.find(p => p.cloud?.id === 'p1');
  assert.equal(project.name, 'Research'); assert.deepEqual(project.cloud.documents.map(d => [d.name, d.content]), [['notes.txt', 'Abstract.']]);
  const trip = byCloud(ws, 'c1'), paper = byCloud(ws, 'c2');
  assert.deepEqual([trip.title, trip.turns.length, trip.cloud.loaded, paper.projectId], ['Trip', 0, false, project.id]);
  assert.equal(sync.snapshot().chats, 2); assert.equal(sync.snapshot().state, 'ready');
  await sync.load(trip.id);
  assert.deepEqual(trip.turns.map(t => t.prompt), ['Trip question 0', 'Trip question 1']);
  assert.deepEqual([trip.cloud.loaded, trip.cloud.turns], [true, 2]);
  // A second sync with nothing changed pulls nothing.
  const pulls = server.calls.filter(c => c[0] === 'pull').length; await sync.sync();
  assert.equal(server.calls.filter(c => c[0] === 'pull').length, pulls);
});

test('chats loaded before widgets were read are read again once, unless they hold changes still to be written', async () => {
  const widget = { type: 'tool_call', id: 'b1', toolCallId: 'call_1', name: 'render_timeline', arguments: JSON.stringify({ events: [{ date: '1969', title: 'Apollo 11' }] }) };
  const withWidget = title => { const c = chat(title, 1); c.messages[1].timeline = [{ type: 'content', id: 'c1', content: c.messages[1].content }, widget]; return c; };
  const server = enclave(); server.seed('chat', 'c1', withWidget('Apollo')); server.seed('chat', 'c2', withWidget('Gemini'));
  const { sync, ws } = setup({ server });
  await sync.connect(KEY);
  const apollo = byCloud(ws, 'c1'), gemini = byCloud(ws, 'c2');
  await sync.load(apollo.id); await sync.load(gemini.id);
  assert.equal(apollo.turns[0].replies[0].tools[0].artifacts[0].kind, 'timeline');
  // As 0.17.2 left them: loaded, without a format and without widgets. The second has an edit not yet written.
  for (const t of [apollo, gemini]) { delete t.cloud.format; delete t.turns[0].replies[0].tools; }
  gemini.cloud.dirty = true;
  const pulls = () => server.calls.filter(c => c[0] === 'pull').length, before = pulls();
  await sync.sync();
  assert.equal(pulls() - before, 1);
  assert.deepEqual(server.calls.filter(c => c[0] === 'pull').at(-1), ['pull', 'chat', 1], 'only the clean chat is pulled');
  assert.deepEqual([apollo.cloud.format, apollo.turns[0].replies[0].tools?.length], [2, 1]);
  assert.deepEqual([gemini.cloud.format, gemini.turns[0].replies[0].tools, gemini.cloud.dirty], [undefined, undefined, true]);
  await sync.sync();
  assert.equal(pulls() - before, 1, 'and only once');
});

test('continuing or renaming a cloud chat writes it back against the version it was pulled at, keeping unknown fields', async () => {
  const server = enclave(); server.seed('chat', 'c1', chat('Trip', 1)); server.seed('chat', 'c2', chat('Other', 1));
  const { sync, ws } = setup({ server });
  await sync.connect(KEY);
  const trip = byCloud(ws, 'c1'); await sync.load(trip.id);
  trip.turns.push({ id: 'n1', prompt: 'More?', attachments: [], createdAt: Date.parse('2026-09-29T11:00:00Z'), selectedReplyId: 'r1',
    replies: [{ id: 'r1', model: 'kimi-k3', content: 'Yes.', reasoning: '', status: 'complete', finishReason: 'stop', error: null, usage: null, elapsedMs: 3 }] });
  await sync.changed(trip.id);
  const stored = server.rows.chat.get('c1');
  assert.equal(stored.etag, 2); assert.equal(stored.plain.unknownTop, 1);
  assert.deepEqual(stored.plain.messages.slice(0, 2), chat('Trip', 1).messages, 'existing messages are unchanged');
  assert.deepEqual(stored.plain.messages.slice(2).map(m => [m.role, m.content]), [['user', 'More?'], ['assistant', 'Yes.']]);
  assert.deepEqual([stored.plain.clock, stored.plain.clockVersion, stored.plain.writer], [1, 2, ws.cloud.writer]);
  assert.deepEqual([trip.cloud.etag, trip.cloud.turns, trip.cloud.dirty], ['2', 2, false]);
  assert.deepEqual(server.calls.filter(c => c[0] === 'push').at(-1).slice(1, 4), ['chat', 'c1', '1']);
  // A chat that was never opened can be renamed without loading it.
  const other = byCloud(ws, 'c2'); other.title = 'Renamed'; await sync.changed(other.id);
  assert.equal(server.rows.chat.get('c2').plain.title, 'Renamed'); assert.equal(server.rows.chat.get('c2').plain.titleState, 'manual');
  assert.deepEqual(server.rows.chat.get('c2').plain.messages, chat('Other', 1).messages);
});

test('another version of a turn in a cloud chat replaces the messages after it there, and showing the first writes that back', async () => {
  const server = enclave(); server.seed('chat', 'c1', chat('Trip', 3));
  const { sync, ws } = setup({ server });
  await sync.connect(KEY);
  const trip = byCloud(ws, 'c1'); await sync.load(trip.id);
  const turn = trip.turns[1], reply = turn.replies[0];
  editReply(ws, trip.id, { turnId: turn.id, replyId: reply.id, content: 'Edited answer', reasoning: reply.reasoning, expectedContent: reply.content, expectedReasoning: reply.reasoning });
  await sync.changed(trip.id);
  const messages = () => server.rows.chat.get('c1').plain.messages;
  assert.deepEqual(messages().map(m => m.content), ['Trip question 0', 'Trip answer 0', 'Trip question 1', 'Edited answer']);
  assert.deepEqual(messages().slice(0, 2), chat('Trip', 3).messages.slice(0, 2), 'messages before the change are kept as they were');
  assert.deepEqual([trip.cloud.turns, trip.cloud.rewritten, trip.cloud.dirty], [2, undefined, false]);
  showVersion(trip, trip.turns[1].id, 1); await sync.changed(trip.id);
  assert.deepEqual(messages().map(m => m.content), chat('Trip', 3).messages.map(m => m.content));
  assert.deepEqual([trip.cloud.turns, trip.cloud.rewritten], [3, undefined]);
});
test('a chat that changed in Tinfoil first keeps the cloud version in place and Workbench\'s as a copy', async () => {
  const server = enclave(); server.seed('chat', 'c1', chat('Trip', 1));
  const { sync, ws, notices } = setup({ server });
  await sync.connect(KEY); const trip = byCloud(ws, 'c1'); await sync.load(trip.id);
  server.edit('chat', 'c1', plain => { plain.messages.push({ role: 'user', content: 'from the phone' }); });
  trip.turns[0].prompt = 'edited here';
  await sync.changed(trip.id);
  assert.equal(server.rows.chat.get('c1').etag, 2, 'nothing was pushed over the newer version');
  assert.deepEqual(trip.turns.map(t => t.prompt), ['Trip question 0', 'from the phone']);
  const copy = ws.threads.find(t => t.title === 'Trip (Workbench copy)');
  assert.ok(copy && !copy.cloud); assert.equal(copy.turns[0].prompt, 'edited here'); assert.match(notices[0], /Workbench copy/);
});

test('a push that loses a race is resolved the same way, and a rewrap is not a conflict', async () => {
  const server = enclave(); server.seed('chat', 'c1', chat('Trip', 1));
  const { sync, ws } = setup({ server });
  await sync.connect(KEY); const trip = byCloud(ws, 'c1'); await sync.load(trip.id);
  const push = server.push; server.push = async (...args) => { server.edit('chat', 'c1', p => { p.title = 'Changed elsewhere'; }); server.push = push; return push(...args); };
  trip.title = 'Mine'; await sync.changed(trip.id);
  assert.equal(trip.title, 'Changed elsewhere'); assert.ok(ws.threads.some(t => t.title === 'Mine (Workbench copy)'));
  // The enclave re-sealed an old row during the pull: a new version whose previous version is ours.
  const pull = server.pull; server.pull = async (...args) => { const items = await pull(...args); server.rows.chat.get('c1').etag++; return items.map(i => ({ ...i, etag: String(Number(i.etag) + 1), previous_etag: i.etag })); };
  trip.title = 'Once more'; await sync.changed(trip.id);
  assert.equal(server.rows.chat.get('c1').plain.title, 'Once more'); assert.equal(ws.threads.filter(t => /Workbench copy/.test(t.title)).length, 1);
});

test('chats deleted in Tinfoil leave this device, unless they hold unsynced changes', async () => {
  const server = enclave(); server.seed('chat', 'c1', chat('Gone', 1)); server.seed('chat', 'c2', chat('Kept', 1));
  const { sync, ws } = setup({ server });
  await sync.connect(KEY);
  byCloud(ws, 'c2').cloud.dirty = true;
  server.rows.chat.delete('c1'); server.rows.chat.delete('c2');
  await sync.sync();
  assert.equal(byCloud(ws, 'c1'), undefined);
  const kept = ws.threads.find(t => t.title === 'Kept (Workbench copy)'); assert.ok(kept && !kept.cloud);
});

test('a local conversation moves to Tinfoil cloud as a new chat, and deleting it deletes it there', async () => {
  const server = enclave(); server.seed('project', 'p1', { name: 'Research' });
  const { sync, ws } = setup({ server });
  await sync.connect(KEY);
  const t = ws.threads[0]; t.title = 'Local'; t.projectId = ws.projects[0].id; t.settings.model = 'gemma4-31b';
  await assert.rejects(sync.upload(t.id), /Send a message/);
  t.turns.push({ id: 'n1', prompt: 'Hi', attachments: [], createdAt: 1, selectedReplyId: 'r1', replies: [{ id: 'r1', model: 'gemma4-31b', content: 'Hello.', reasoning: '', status: 'complete', finishReason: 'stop', error: null, usage: null, elapsedMs: 1 }] });
  await sync.upload(t.id);
  const [, scope, id, ifMatch, metadata] = server.calls.find(c => c[0] === 'push');
  assert.deepEqual([scope, ifMatch, metadata], ['chat', '0', { messageCount: 2, projectId: 'p1' }]);
  assert.deepEqual([t.cloud.id, t.cloud.etag, t.cloud.project, t.cloud.turns], [id, '1', 'p1', 1]);
  assert.equal(server.rows.chat.get(id).plain.projectId, 'p1');
  await sync.remove(t.id);
  assert.equal(server.rows.chat.has(id), false); assert.ok(!ws.threads.some(x => x.id === t.id)); assert.ok(ws.threads.some(x => x.id === ws.activeId));
});

test('another account\'s session, or a changed account key, stops sync before any chat is read', async () => {
  const server = enclave(); server.seed('chat', 'c1', chat('Private', 1));
  const { sync, account } = setup({ server });
  await sync.connect(KEY);
  account.user = 'user_other';
  await assert.rejects(sync.sync(), /belong to another Tinfoil account/);
  assert.equal(sync.snapshot().state, 'error');
  account.user = 'user_test'; const rotated = setup({ server: enclave({ keyId: 'f'.repeat(32) }) });
  rotated.ws.cloud = { key: KEY, keyId: KEY_ID, user: 'user_test', writer: 'workbench.x', clock: 0 };
  await assert.rejects(rotated.sync.sync(), /chat key has changed/);
  assert.ok(!rotated.server.calls.some(c => c[0] === 'pull'));
});

test('only the most recent cloud chats are listed, and a truncated listing never deletes older ones', async () => {
  const server = enclave();
  for (let i = 0; i < 305; i++) server.seed('chat', `c${i}`, chat(`Chat ${i}`, 1));
  const { sync, ws } = setup({ server });
  await sync.connect(KEY);
  assert.equal(ws.threads.filter(t => t.cloud).length, 300); assert.equal(sync.snapshot().older, 1);
  assert.equal(byCloud(ws, 'c304').title, 'Chat 304'); assert.equal(byCloud(ws, 'c0'), undefined);
  server.edit('chat', 'c5', p => { p.title = 'bumped'; }); await sync.sync();
  assert.equal(byCloud(ws, 'c5').title, 'bumped'); assert.equal(ws.threads.filter(t => t.cloud).length, 300);
});

test('disconnecting removes cloud chats and projects from this device and keeps unsynced ones', async () => {
  const server = enclave(); server.seed('project', 'p1', { name: 'P' }); server.seed('chat', 'c1', chat('A', 1), 'p1'); server.seed('chat', 'c2', chat('B', 1));
  const { sync, ws } = setup({ server });
  await sync.connect(KEY); byCloud(ws, 'c2').cloud.dirty = true;
  await sync.disconnect();
  assert.equal(ws.cloud, undefined); assert.equal(ws.projects.length, 0);
  assert.deepEqual(ws.threads.filter(t => /not synced/.test(t.title)).map(t => [t.title, !!t.cloud]), [['B (not synced)', false]]);
  assert.ok(!ws.threads.some(t => t.cloud)); assert.equal(sync.snapshot().state, 'off');
});

test('the client speaks the enclave protocol over the attested channel only', async () => {
  const requests = [], tokens = [];
  let reply = (url, init) => new Response(JSON.stringify({ key_id: KEY_ID.toUpperCase(), has_data: true }), { status: 200 });
  const secure = { ready: async () => {}, fetch: async (url, init) => { requests.push([url, init]); return reply(url, init); } };
  const client = new CloudClient({ secureClient: () => secure, token: async force => { tokens.push(force); return 'clerk-test-only'; } });
  assert.deepEqual(await client.keyCurrent(), { keyId: KEY_ID.toUpperCase(), hasData: true });
  const [url, init] = requests[0];
  assert.equal(url, SYNC_URL + '/v1/key/current'); assert.equal(init.method, 'POST');
  assert.deepEqual([init.headers['X-Sync-Protocol'], init.headers.Authorization], ['2', 'Bearer clerk-test-only']);
  // A 401 is retried once with a fresh session token.
  let first = true; reply = () => { if (first) { first = false; return new Response('{}', { status: 401 }); } return new Response(JSON.stringify({ ok: true, etag: '5', key_id: KEY_ID }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  const key = { b64: Buffer.from(parseCloudKey(KEY).bytes).toString('base64'), id: KEY_ID };
  assert.equal(await client.push('chat', 'c1', key, { title: 'ü' }, '4', { messageCount: 0 }), '5');
  assert.deepEqual(tokens.slice(-2), [false, true]);
  const sent = JSON.parse(requests.at(-1)[1].body);
  assert.deepEqual([sent.scope, sent.id, sent.key, sent.if_match], ['chat', 'c1', key.b64, '4']);
  assert.deepEqual(JSON.parse(Buffer.from(sent.plaintext, 'base64').toString('utf8')), { title: 'ü' }); assert.match(sent.idempotency_key, /^[0-9a-f-]{36}$/);
  reply = () => new Response(JSON.stringify({ error: 'stale', code: 'SYNC_CONFLICT' }), { status: 409 });
  await assert.rejects(client.push('chat', 'c1', key, {}, '4'), e => e instanceof CloudError && e.status === 409 && e.code === 'SYNC_CONFLICT' && !e.message.includes(key.b64));
  // A refusal is reported as the sync service's, with its code, not as a model provider's rejection.
  reply = () => new Response(JSON.stringify({ error: 'bad', code: 'BAD_REQUEST' }), { status: 400 });
  const refused = await client.push('chat', 'c1', key, {}, '4').catch(e => e);
  assert.equal(publicError(refused), 'Tinfoil cloud sync refused the request (BAD_REQUEST).');
  assert.equal(publicError(new CloudError('Tinfoil cloud sync did not answer in time.', null, 'TIMEOUT')), 'Tinfoil cloud sync did not answer in time.');
  reply = () => new Response(JSON.stringify({ ok: true, etag: 'W/"x"' }), { status: 200 });
  await assert.rejects(client.push('chat', 'c1', key, {}, '4'), /invalid version/);
  reply = () => new Response('x'.repeat(100), { status: 200 });
  const small = new CloudClient({ secureClient: () => secure, token: async () => 't', timing: { ready: 1000, request: 1000, maxBytes: 10 } });
  await assert.rejects(small.keyCurrent(), /size limit/);
});

test('new chat IDs follow Tinfoil Chat\'s reverse-timestamp format and need no request', () => {
  const created = Date.UTC(2026, 8, 29, 1, 7, 26, 147), id = cloudChatId(created);
  assert.match(id, /^\d{13}_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(9999999999999 - Number(id.slice(0, 13)), created);
  assert.notEqual(cloudChatId(created), id);
  // Newer chats sort first, as in Tinfoil Chat's listing.
  assert.ok(cloudChatId(created + 1) < id);
  const client = new CloudClient({ secureClient: () => { throw new Error('no enclave for an ID'); }, token: async () => { throw new Error('no token for an ID'); } });
  assert.equal(9999999999999 - Number(client.newChatId(created).slice(0, 13)), created);
});

test('the key ID matches the WebCrypto derivation Tinfoil uses', async () => {
  const bytes = parseCloudKey(KEY).bytes;
  const base = await webcrypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveBits']);
  const bits = await webcrypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: new TextEncoder().encode('tinfoil-key-id-v1') }, base, 128);
  assert.equal(cloudKeyId(bytes), Buffer.from(bits).toString('hex'));
  assert.match(KEY_ID, /^[0-9a-f]{32}$/);
});

test('a cloud project adds its context after the conversation\'s own instructions, and ordinary chats get none', async () => {
  const { buildHistory, newThread: fresh } = await import('../dist/core/workspace.js');
  const t = fresh();
  assert.deepEqual(buildHistory(t), []);
  assert.deepEqual(buildHistory(t, 0, 'CTX'), [{ role: 'system', content: '<project_context>\nCTX\n</project_context>' }]);
  t.settings.systemPrompt = 'Be brief.';
  assert.deepEqual(buildHistory(t, 0, 'CTX'), [{ role: 'system', content: 'Be brief.\n\n<project_context>\nCTX\n</project_context>' }]);
  assert.deepEqual(buildHistory(t, 0), [{ role: 'system', content: 'Be brief.' }]);
});

test('the service opens, writes back, moves and exports cloud chats through its commands', async () => {
  const { WorkbenchService } = await import('../desktop/service.mjs');
  const { exportThread } = await import('../dist/core/workspace.js');
  const server = enclave(); server.seed('project', 'p1', { name: 'Research' }); server.seed('chat', 'c1', chat('Trip', 1));
  let stored = null; const vault = { read: async () => stored, write: async v => { stored = structuredClone(v); }, flush: async () => {} };
  const account = { snapshot: () => ({ status: 'signed-in', profile: { id: 'user_test' } }), sessionToken: async () => ({ bearer: 'clerk-test-only', user: 'user_test' }) };
  const s = new WorkbenchService(vault, async () => ({}), () => {}, null, { account, cloud: host => new CloudSync({ client: server, account, host }) }); await s.initialize();
  const snap = await s.execute({ type: 'cloud.connect', key: KEY });
  assert.equal(snap.cloud.state, 'ready'); assert.equal(snap.cloud.chats, 1); assert.equal(JSON.stringify(snap).includes(KEY), false, 'no snapshot carries the key');
  assert.equal(stored.cloud.key, KEY, 'the key is kept in the encrypted workspace');
  const trip = s.workspace.threads.find(t => t.cloud);
  await s.execute({ type: 'connection.mode', mode: 'chat-account' });
  await assert.rejects(s.send(trip.id, 'hello', []), /still loading from Tinfoil cloud/);
  await s.execute({ type: 'thread.select', id: trip.id });
  await until(() => s.workspace.threads.find(t => t.id === trip.id).cloud.loaded);
  await s.execute({ type: 'thread.rename', id: trip.id, title: 'Renamed in Workbench' });
  await until(() => server.rows.chat.get('c1').plain.title === 'Renamed in Workbench');
  const local = s.workspace.projects.find(p => !p.cloud) ?? (await s.execute({ type: 'project.create', name: 'Local' }), s.workspace.projects.find(p => !p.cloud));
  await assert.rejects(s.execute({ type: 'thread.move', id: trip.id, projectId: local.id }), /only move to a cloud project/);
  const research = s.workspace.projects.find(p => p.cloud);
  await s.execute({ type: 'thread.move', id: trip.id, projectId: research.id });
  await until(() => server.rows.chat.get('c1').project === 'p1');
  assert.equal(server.rows.chat.get('c1').plain.projectId, 'p1');
  await assert.rejects(s.execute({ type: 'project.rename', id: research.id, name: 'x' }), /in Tinfoil Chat/);
  assert.equal('cloud' in JSON.parse(exportThread(s.workspace.threads.find(t => t.id === trip.id))).conversation, false);
  await s.shutdown();
});
const until = async (ready, ms = 2000) => { const end = Date.now() + ms; while (Date.now() < end) { if (ready()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('timed out'); };

test('the Android worker bundle leaves cloud sync out', () => {
  // The worker bundles the shared service with a crypto shim that has only randomUUID, so the sync engine and the
  // client (hkdfSync, the SDK's sync enclave) must stay out of its static imports. Walks them from the entry, through
  // the built dist/ modules as the bundler does.
  const root = dirname(dirname(fileURLToPath(import.meta.url))), seen = new Set();
  const walk = file => {
    if (seen.has(file)) return; seen.add(file);
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/gm)) walk(resolve(dirname(file), spec));
  };
  walk(join(root, 'mobile', 'host-worker.mjs'));
  const reached = [...seen].map(f => f.slice(root.length + 1).replaceAll('\\', '/'));
  assert.ok(reached.includes('desktop/service.mjs'), 'the walk reaches the shared service');
  assert.deepEqual(reached.filter(f => /desktop\/cloud-(sync|client)\.mjs$/.test(f)), []);
});
test('a thread started from the Cloud list becomes a cloud chat after its first reply, and only then', async () => {
  const { WorkbenchService } = await import('../desktop/service.mjs');
  const server = enclave();
  let stored = null; const vault = { read: async () => stored, write: async v => { stored = structuredClone(v); }, flush: async () => {} };
  const account = { snapshot: () => ({ status: 'signed-in', profile: { id: 'user_test' } }), sessionToken: async () => ({ bearer: 'clerk-test-only', user: 'user_test' }) };
  const client = { ready: async () => {}, getVerificationDocument: async () => ({ securityVerified: true, steps: { verifyCode: { status: 'success' } } }), models: { list: async () => ({ data: [{ id: 'a' }] }) },
    chat: { completions: { create: async () => (async function* () { yield { choices: [{ delta: { content: 'Hello' } }] }; yield { choices: [{ delta: {}, finish_reason: 'stop' }] }; })() } } };
  const s = new WorkbenchService(vault, async () => client, () => {}, null, { account, cloud: host => new CloudSync({ client: server, account, host }) }); await s.initialize();
  const active = () => s.workspace.threads.find(t => t.id === s.workspace.activeId);
  await s.execute({ type: 'thread.new', cloud: true });
  assert.equal(active().cloudPending, undefined, 'without a chat key the Cloud list is not offered');
  await s.execute({ type: 'cloud.connect', key: KEY });
  await s.execute({ type: 'thread.new', cloud: true });
  const fresh = active(); assert.equal(fresh.cloudPending, true); assert.equal(fresh.cloud, undefined);
  assert.equal(validateWorkspace(structuredClone(s.workspace)).threads.find(t => t.id === fresh.id).cloudPending, true, 'the mark is saved');
  await s.execute({ type: 'credentials.set', key: 'test-only-not-real' }); fresh.settings.model = 'a';
  await s.execute({ type: 'send', id: fresh.id, text: 'Hi', attachments: [] });
  await until(() => !!s.workspace.threads.find(t => t.id === fresh.id).cloud);
  const uploaded = s.workspace.threads.find(t => t.id === fresh.id);
  assert.equal(uploaded.cloudPending, undefined); assert.equal(server.rows.chat.get(uploaded.cloud.id).plain.messages.length, 2);
  await s.execute({ type: 'thread.new', cloud: true }); const moved = active();
  await s.execute({ type: 'project.create', name: 'Local' }); const local = s.workspace.projects.find(p => !p.cloud);
  await s.execute({ type: 'thread.move', id: moved.id, projectId: local.id });
  assert.equal(s.workspace.threads.find(t => t.id === moved.id).cloudPending, undefined, 'a local project never uploads');
  await s.shutdown();
});
