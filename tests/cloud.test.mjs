import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCloudKey, groupMessages, threadFromCloud, cloudPatch, newCloudChat, projectFromCloud, projectContext, cloudTitle } from '../dist/core/cloud.js';
import { validateThread, validateWorkspace, cloudChatLink } from '../dist/core/validation.js';
import { newWorkspace, newThread } from '../dist/core/workspace.js';

const NOW = Date.parse('2026-09-29T12:00:00Z');
// Tinfoil's own encoding of a 32-byte key: two base-36 characters per byte.
const encode = bytes => 'key_' + [...bytes].map(b => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(b / 36)] + 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
const KEY = encode(Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) % 256));
const clock = { v: 7, w: 'workbench-test.nonce', version: 4 };
const remoteChat = () => ({
  title: 'Trip plan', createdAt: '2026-09-20T10:00:00.000Z', updatedAt: '2026-09-21T10:00:00.000Z', model: 'kimi-k3', projectId: null, clock: 3, writer: 'web.x', clockVersion: 3,
  futureField: { kept: true },
  messages: [
    { role: 'user', content: 'Where should we go?', timestamp: '2026-09-20T10:00:00.000Z', turnId: 't1', attachments: [
      { id: 'a1', type: 'document', fileName: 'notes.txt', textContent: 'Prefer the coast.' }, { id: 'a2', type: 'image', fileName: 'map.png', thumbnailBase64: 'AAAA' }] },
    { role: 'assistant', content: 'Try Lisbon.', thoughts: 'Coastal and mild.', modelDisplayName: 'Kimi K3', timeline: [{ type: 'content', id: 'b1' }], annotations: [{ url: 'https://example.invalid' }], timestamp: '2026-09-20T10:00:05.000Z' },
    { role: 'user', content: 'And in winter?', timestamp: '2026-09-21T09:59:00.000Z' },
    { role: 'assistant', content: 'Madeira.', modelDisplayName: 'Kimi K3', timestamp: '2026-09-21T10:00:00.000Z' },
  ],
});
const link = { id: '8200000000000_chat', etag: '4', project: null };

test('the chat key is read in both forms Tinfoil shows it, and malformed keys are refused', () => {
  const parsed = parseCloudKey(KEY);
  assert.equal(parsed.key, KEY); assert.equal(parsed.bytes.length, 32); assert.equal(parsed.bytes[1], (37 + 11) % 256);
  assert.equal(encode(parsed.bytes), KEY, 'the bytes encode back to the same key');
  const pem = `-----BEGIN TINFOIL CHAT ENCRYPTION KEY-----\n${KEY.slice(4)}\n-----END TINFOIL CHAT ENCRYPTION KEY-----\n`;
  assert.deepEqual(parseCloudKey(pem).bytes, parsed.bytes);
  assert.deepEqual(parseCloudKey(`  ${KEY}\n`).bytes, parsed.bytes);
  for (const bad of [KEY.slice(0, -2), KEY + 'aa', KEY.toUpperCase(), 'key_' + 'zz'.repeat(32), 'key_' + 'a!'.repeat(32), '', null, 'x'.repeat(5000)]) assert.equal(parseCloudKey(bad), null, String(bad).slice(0, 20));
});

test('messages group into turns deterministically, with odd shapes kept', () => {
  assert.deepEqual(groupMessages(remoteChat().messages), [{ user: 0, assistant: 1 }, { user: 2, assistant: 3 }]);
  assert.deepEqual(groupMessages([{ role: 'assistant' }, { role: 'user' }, { role: 'user' }, { role: 'system' }, { role: 'assistant' }, { role: 'assistant' }]),
    [{ user: null, assistant: 0 }, { user: 1, assistant: null }, { user: 2, assistant: 4 }, { user: null, assistant: 5 }]);
});

test('a cloud chat maps onto a conversation: prompts, answers, reasoning, documents and a missing answer', () => {
  const plain = remoteChat(); plain.messages.push({ role: 'user', content: 'Still there?' });
  const t = threadFromCloud(plain, link, 'local_project', NOW);
  assert.equal(t.title, 'Trip plan'); assert.equal(t.projectId, 'local_project'); assert.equal(t.createdAt, Date.parse('2026-09-20T10:00:00Z'));
  assert.deepEqual(t.turns.map(x => x.prompt), ['Where should we go?', 'And in winter?', 'Still there?']);
  const first = t.turns[0].replies[0];
  assert.deepEqual([first.content, first.reasoning, first.model, first.status], ['Try Lisbon.', 'Coastal and mild.', 'Kimi K3', 'complete']);
  assert.deepEqual(t.turns[0].attachments, [{ name: 'notes.txt', content: 'Prefer the coast.' }], 'documents become reference files; images are not sent');
  assert.equal(t.turns[2].replies[0].status, 'interrupted');
  assert.deepEqual(t.cloud, { ...link, turns: 3, loaded: true, dirty: false, syncedAt: NOW, format: 2 });
  assert.doesNotThrow(() => validateThread(t));
  // A listed chat that is not loaded keeps no turns; loading it later keeps the local identity and settings.
  const stub = threadFromCloud(plain, link, null, NOW, undefined, false);
  assert.deepEqual([stub.turns.length, stub.cloud.loaded, stub.cloud.turns], [0, false, 0]);
  stub.settings.model = 'chosen-locally';
  const loaded = threadFromCloud(plain, link, null, NOW, stub);
  assert.equal(loaded.id, stub.id); assert.equal(loaded.settings.model, 'chosen-locally'); assert.equal(loaded.turns.length, 3);
  assert.equal(cloudTitle(' \x07 '), 'Untitled chat'); assert.equal(cloudTitle('a'.repeat(500)).length, 120);
});

test('writing back an unchanged chat keeps every message and field byte for byte', () => {
  const remote = remoteChat(), t = threadFromCloud(remote, link, null, NOW);
  const patched = cloudPatch(remote, t, clock, NOW);
  assert.deepEqual(patched.messages, remote.messages);
  assert.deepEqual(patched.futureField, { kept: true });
  assert.deepEqual([patched.clock, patched.writer, patched.clockVersion, patched.updatedAt], [7, 'workbench-test.nonce', 4, '2026-09-29T12:00:00.000Z']);
  assert.equal('titleState' in patched, false);
});

test('new turns are appended, edits replace only their text, and a rename is marked manual', () => {
  const remote = remoteChat(), t = threadFromCloud(remote, link, null, NOW);
  t.title = 'Winter trip';
  t.turns[0].prompt = 'Where should we go this year?';
  const answer = t.turns[1].replies[0]; answer.content = 'Madeira or the Canaries.'; answer.reasoning = 'Both are warm.';
  t.turns.push({ id: 'n1', prompt: 'Flights?', attachments: [{ name: 'dates.txt', content: 'Dec 20-30' }], createdAt: NOW - 1000, selectedReplyId: 'r1',
    replies: [{ id: 'r1', model: 'kimi-k3', content: 'Book early.', reasoning: '', status: 'complete', finishReason: 'stop', error: null, usage: null, elapsedMs: 5 }] });
  t.turns.push({ id: 'n2', prompt: 'Hotels?', attachments: [], createdAt: NOW, selectedReplyId: 'r2',
    replies: [{ id: 'r2', model: 'kimi-k3', content: 'partial', reasoning: '', status: 'interrupted', finishReason: null, error: null, usage: null, elapsedMs: 5 }] });
  const out = cloudPatch(remote, t, clock, NOW), m = out.messages;
  assert.equal(out.title, 'Winter trip'); assert.equal(out.titleState, 'manual');
  assert.equal(m[0].content, 'Where should we go this year?'); assert.equal(m[0].turnId, 't1'); assert.deepEqual(m[0].attachments, remote.messages[0].attachments);
  assert.deepEqual(m[1], remote.messages[1], 'an unchanged answer is kept with its timeline');
  assert.deepEqual([m[3].content, m[3].thoughts, m[3].modelDisplayName], ['Madeira or the Canaries.', 'Both are warm.', 'Kimi K3']);
  assert.equal('timeline' in m[3], false);
  assert.deepEqual(m[4], { role: 'user', content: 'Flights?', timestamp: new Date(NOW - 1000).toISOString(), attachments: [{ id: m[4].attachments[0].id, type: 'document', fileName: 'dates.txt', textContent: 'Dec 20-30' }] });
  assert.deepEqual(m[5], { role: 'assistant', content: 'Book early.', modelDisplayName: 'kimi-k3', timestamp: new Date(NOW).toISOString() });
  assert.deepEqual(m[6], { role: 'user', content: 'Hotels?', timestamp: new Date(NOW).toISOString() }, 'an unfinished reply is not written');
  assert.equal(m.length, 7);
});

test('remote messages that Workbench did not import, or cannot place in a turn, are never dropped', () => {
  const remote = remoteChat(); remote.messages.splice(2, 0, { role: 'system', content: 'kept in place' });
  const t = threadFromCloud(remote, link, null, NOW);
  assert.deepEqual(cloudPatch(remote, t, clock, NOW).messages, remote.messages);
  // A conversation that knows fewer turns than the cloud (for example past the turn limit) keeps the rest.
  t.turns.pop(); t.cloud.turns = 1;
  assert.deepEqual(cloudPatch(remote, t, clock, NOW).messages, remote.messages);
  // A listed chat that was never loaded can still be renamed.
  const stub = threadFromCloud(remote, link, null, NOW, undefined, false); stub.title = 'Renamed';
  const renamed = cloudPatch(remote, stub, clock, NOW);
  assert.deepEqual(renamed.messages, remote.messages); assert.equal(renamed.title, 'Renamed');
});

test('a new cloud chat carries the conversation and its project', () => {
  const t = newThread(); t.title = 'Fresh'; t.settings.model = 'gemma4-31b';
  t.turns.push({ id: 'n1', prompt: 'Hi', attachments: [], createdAt: NOW, selectedReplyId: 'r1', replies: [{ id: 'r1', model: 'gemma4-31b', content: 'Hello.', reasoning: 'greet', status: 'complete', finishReason: 'stop', error: null, usage: null, elapsedMs: 1 }] });
  const chat = newCloudChat(t, '8200000000000_proj', clock, NOW);
  assert.equal(chat.title, 'Fresh'); assert.equal(chat.model, 'gemma4-31b'); assert.equal(chat.projectId, '8200000000000_proj');
  assert.deepEqual(chat.messages.map(x => [x.role, x.content, x.thoughts]), [['user', 'Hi', undefined], ['assistant', 'Hello.', 'greet']]);
  assert.equal(chat.clockVersion, 4);
});

test('a cloud project maps onto a project, and its context follows Tinfoil\'s layout', () => {
  const p = projectFromCloud({ name: 'Research\x00 notes', description: 'Papers on X.', systemInstructions: 'Cite sources.', color: 'blue', memory: [{ fact: 'x' }] }, 'proj1', '2', NOW);
  assert.equal(p.name, 'Research notes'); assert.deepEqual([p.cloud.instructions, p.cloud.color, p.cloud.etag], ['Cite sources.', 'blue', '2']);
  p.cloud.documents = [{ id: 'd1', etag: '1', name: 'paper.txt', type: 'text/plain', content: 'Abstract.' }, { id: 'd2', etag: '1', name: 'scan.pdf', type: 'application/pdf', content: '' }];
  assert.equal(projectContext(p), '## Project: Research notes\n\nPapers on X.\n\n### Instructions\nCite sources.\n\n### Documents\n--- paper.txt ---\nAbstract.\n\n');
  assert.equal(projectContext({ id: 'local', name: 'Local', createdAt: 1 }), '', 'a local project adds nothing');
  const w = newWorkspace(); w.projects.push(p);
  assert.doesNotThrow(() => validateWorkspace(structuredClone(w)));
});

test('cloud links and settings are validated when the workspace is opened', () => {
  const good = { id: '8200000000000_chat', etag: '4', project: null, turns: 2, loaded: true, dirty: false, syncedAt: NOW };
  assert.deepEqual(cloudChatLink(good), good);
  assert.deepEqual(cloudChatLink({ ...good, format: 2 }), { ...good, format: 2 });
  for (const bad of [{ ...good, id: 'x/y' }, { ...good, etag: 'W/"4"' }, { ...good, turns: 1.5 }, { ...good, loaded: 'yes' }, { ...good, format: 0 }, { ...good, format: '2' }]) assert.throws(() => cloudChatLink(bad));
  const w = newWorkspace();
  w.cloud = { key: KEY, keyId: '0123456789abcdef0123456789abcdef', user: 'user_test', writer: 'workbench.test', clock: 3 };
  assert.deepEqual(validateWorkspace(structuredClone(w)).cloud, w.cloud);
  for (const cloud of [{ ...w.cloud, key: 'key_short' }, { ...w.cloud, keyId: 'ABC' }, { ...w.cloud, user: 'someone' }]) assert.throws(() => validateWorkspace({ ...structuredClone(w), cloud }), /cloud sync settings/);
});
