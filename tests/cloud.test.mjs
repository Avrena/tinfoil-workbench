import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCloudKey, groupMessages, threadFromCloud, cloudPatch, cloudPictures, newCloudChat, projectFromCloud, projectContext, cloudTitle, CLOUD_FORMAT } from '../dist/core/cloud.js';
import { validateThread, validateWorkspace, cloudChatLink } from '../dist/core/validation.js';
import { newWorkspace, newThread } from '../dist/core/workspace.js';
import { pictureSize, pictureType } from '../dist/core/attachments.js';

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
  assert.deepEqual(t.turns[0].attachments, [{ name: 'notes.txt', content: 'Prefer the coast.' }], 'documents become reference files; a picture without a usable thumbnail is left out');
  assert.equal(t.turns[2].replies[0].status, 'interrupted');
  assert.deepEqual(t.cloud, { ...link, turns: 3, loaded: true, dirty: false, syncedAt: NOW, format: CLOUD_FORMAT });
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

// A JPEG header (300 × 200), as a thumbnail; a picture's own key is base64 of 32 bytes.
const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/wAARCADIASwDASIAAhEBAxEB/9k=';
const PICTURE = '0123456789abcdef0123456789abcdef0123', PICTURE_KEY = Buffer.alloc(32, 7).toString('base64');
const webPicture = (extra = {}) => ({ id: PICTURE, type: 'image', fileName: 'beach\x07.bmp', mimeType: 'image/bmp', thumbnailBase64: JPEG, description: 'beach.bmp', encryptionKey: PICTURE_KEY, ...extra });

test('pictures are recognised by their bytes, and a thumbnail\'s shape is read from its header', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  assert.deepEqual([pictureType(png), pictureSize(png)], ['image/png', { width: 1, height: 1 }]);
  const jpeg = Buffer.from(JPEG, 'base64');
  assert.deepEqual([pictureType(jpeg), pictureSize(jpeg)], ['image/jpeg', { width: 300, height: 200 }]);
  assert.equal(pictureType(Buffer.from('GIF89a')), 'image/gif');
  assert.equal(pictureType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  for (const bad of [Buffer.from('BM'), Buffer.from('<svg'), Buffer.alloc(0), jpeg.subarray(0, 24)]) assert.equal(pictureSize(bad), null);
});

test('a web chat\'s pictures show by their thumbnails; where they are kept, with their keys, stays out of the turns', () => {
  const plain = remoteChat();
  plain.messages[0].attachments.push(webPicture(), webPicture({ id: 'x/y' }), webPicture({ id: PICTURE.replace('0', 'f'), thumbnailBase64: 'AAAA' }),
    webPicture({ id: PICTURE.replace('1', 'e'), thumbnailBase64: 'A'.repeat(100_000) }), webPicture({ id: PICTURE.replace('2', 'd'), encryptionKey: 'short' }));
  const t = threadFromCloud(plain, link, null, NOW), pictures = t.turns[0].attachments.filter(a => a.kind === 'image');
  assert.deepEqual(pictures[0], { name: 'beach.bmp', content: '', kind: 'image', image: { id: 'img-c' + PICTURE, mime: 'image/png', width: 300, height: 200, thumb: 'data:image/jpeg;base64,' + JPEG } });
  assert.deepEqual(pictures.map(p => p.image.id), ['img-c' + PICTURE, 'img-c' + PICTURE.replace('2', 'd')], 'bad IDs and thumbnails are left out');
  assert.equal(t.turns[0].prompt, 'Where should we go?', 'the prompt stays the message text');
  assert.doesNotThrow(() => validateThread(t));
  assert.ok(!JSON.stringify(t).includes(PICTURE_KEY));
  // Every picture with a valid ID and key can be fetched; references no turn uses are forgotten when the workspace is saved.
  assert.deepEqual(Object.keys(cloudPictures(plain, link.id)), [PICTURE, PICTURE.replace('0', 'f'), PICTURE.replace('1', 'e')].map(id => 'img-c' + id));
  assert.deepEqual(cloudPictures(plain, link.id)['img-c' + PICTURE], { chat: link.id, id: PICTURE, key: PICTURE_KEY });
  assert.deepEqual(cloudPatch(plain, t, clock, NOW).messages, plain.messages, 'written back unchanged');
});

test('a new turn\'s pictures are written as Tinfoil Chat keeps them, and folders never', () => {
  const remote = remoteChat(), t = threadFromCloud(remote, link, null, NOW), id = 'img-c' + PICTURE;
  const thumb = 'data:image/png;base64,iVBORw0KGgo=';
  t.turns.push({ id: 'n1', prompt: 'What about here?', createdAt: NOW, selectedReplyId: 'r1', replies: [{ id: 'r1', model: 'kimi-k3', content: 'Lovely.', reasoning: '', status: 'complete', finishReason: 'stop', error: null, usage: null, elapsedMs: 1 }],
    attachments: [{ name: 'here.png', content: '', kind: 'image', image: { id, mime: 'image/png', width: 10, height: 10, thumb } }, { name: 'site', content: '', kind: 'folder', path: 'D:\\site' }, { name: 'a.txt', content: 'text' }] });
  assert.throws(() => cloudPatch(remote, t, clock, NOW), /here\.png is not in Tinfoil cloud yet/);
  const m = cloudPatch(remote, t, clock, NOW, { [id]: { chat: link.id, id: PICTURE, key: PICTURE_KEY } }).messages[4];
  assert.deepEqual(m.attachments[0], { id: PICTURE, type: 'image', fileName: 'here.png', mimeType: 'image/png', thumbnailBase64: 'iVBORw0KGgo=', description: 'here.png', encryptionKey: PICTURE_KEY });
  assert.deepEqual(m.attachments.slice(1).map(a => [a.type, a.fileName]), [['document', 'a.txt']], 'the folder is not written');
  assert.ok(!JSON.stringify(m).includes('D:\\\\site'));
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
  const picture = { chat: '8200000000000_chat', id: PICTURE, key: PICTURE_KEY };
  w.cloudImages = { ['img-c' + PICTURE]: picture };
  assert.deepEqual(validateWorkspace(structuredClone(w)).cloudImages, w.cloudImages);
  for (const bad of [{ ['img-c' + PICTURE]: { ...picture, key: 'short' } }, { ['img-c' + PICTURE]: { ...picture, id: 'x/y' } }, { ['img-c' + PICTURE]: { ...picture, chat: 'a/b' } }, { __proto__x: picture }])
    assert.throws(() => validateWorkspace({ ...structuredClone(w), cloudImages: bad }));
});
