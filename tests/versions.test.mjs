import test from 'node:test';
import assert from 'node:assert/strict';
import { newWorkspace, beginTurn, retryTurn, addMessage, buildHistory, forkThread, recoverInterrupted, exportMarkdown } from '../dist/core/workspace.js';
import { versionPosition, versionStep, showVersion, addVersion, storedTurns } from '../dist/core/versions.js';
import { validateWorkspace, LIMITS } from '../dist/core/validation.js';
import { cloudPatch, threadFromCloud } from '../dist/core/cloud.js';
import { WorkbenchService, ROLE_MESSAGES_CLOUD } from '../desktop/service.mjs';

function answer(thread, content = 'Answer to ' + thread.turns.at(-1).prompt) {
  const r = thread.turns.at(-1).replies[0]; Object.assign(r, { content, status: 'complete', finishReason: 'stop' }); return r;
}
/** A conversation of three answered turns. */
function fixture() {
  const w = newWorkspace(), t = w.threads[0]; t.settings.model = 'model-a';
  for (const prompt of ['One', 'Two', 'Three']) { beginTurn(t, prompt, []); answer(t); }
  return { w, t };
}
const prompts = t => t.turns.map(turn => turn.prompt);

test('Retry of an earlier turn sets it aside with the turns after it and asks from the turns before it only', () => {
  const { w, t } = fixture(), [one, two, three] = t.turns, draft = t.draft = 'Unsent';
  const jobs = retryTurn(t, two.id);
  assert.deepEqual(prompts(t), ['One', 'Two']);
  assert.deepEqual(jobs[0].messages.map(m => m.content), ['One', 'Answer to One', 'Two']);
  const head = t.turns[1];
  assert.notEqual(head.id, two.id); assert.equal(head.version, 2); assert.equal(head.replies[0].status, 'queued'); assert.equal(t.draft, draft);
  assert.deepEqual(head.versions, [{ turns: [two, three] }]); assert.equal(t.turns[0], one);
  assert.deepEqual(versionPosition(head), { message: { index: 0, count: 1 }, reply: { index: 1, count: 2 } });
  answer(t); assert.doesNotThrow(() => validateWorkspace(w));
});

test('showing another version brings back its later turns and sets the shown one aside, both ways', () => {
  const { t } = fixture(), two = t.turns[1], three = t.turns[2];
  retryTurn(t, two.id); answer(t, 'Second answer'); beginTurn(t, 'Four', []); answer(t);
  const retried = t.turns[1], four = t.turns[2];
  showVersion(t, retried.id, 1);
  assert.deepEqual(prompts(t), ['One', 'Two', 'Three']); assert.equal(t.turns[1].id, two.id); assert.equal(t.turns[2], three);
  assert.deepEqual(versionPosition(t.turns[1]).reply, { index: 0, count: 2 });
  showVersion(t, two.id, 2);
  assert.deepEqual(prompts(t), ['One', 'Two', 'Four']); assert.equal(t.turns[2], four); assert.equal(t.turns[1].replies[0].content, 'Second answer');
  assert.equal(t.turns[1].versions.length, 1); assert.equal(t.turns[1].versions[0].turns[0].versions, undefined);
  assert.throws(() => showVersion(t, t.turns[1].id, 9), /no longer exists/);
});

test('an edited message is another message: its arrows sit on the message, and Retry versions on the reply', () => {
  const { t } = fixture(), two = t.turns[1];
  beginTurn(t, 'Two, reworded', [], '', two.id); answer(t);
  retryTurn(t, t.turns[1].id); answer(t);
  const shown = t.turns[1];
  assert.deepEqual(versionPosition(shown), { message: { index: 1, count: 2 }, reply: { index: 1, count: 2 } });
  // A step to the other message lands on its latest version; within a message, steps follow creation order.
  assert.equal(versionStep(shown, 'message', -1), 1); assert.equal(versionStep(shown, 'message', 1), null);
  assert.equal(versionStep(shown, 'reply', -1), 2); assert.equal(versionStep(shown, 'reply', 1), null);
  showVersion(t, shown.id, 1);
  assert.equal(t.turns[1].prompt, 'Two'); assert.deepEqual(versionPosition(t.turns[1]).message, { index: 0, count: 2 });
  assert.equal(versionStep(t.turns[1], 'message', 1), 3);
});

test('versions deeper in a set-aside path keep their own versions', () => {
  const { w, t } = fixture();
  retryTurn(t, t.turns[2].id); answer(t, 'Third, again');
  const first = t.turns[0].id; retryTurn(t, first); answer(t);
  showVersion(t, t.turns[0].id, 1);
  assert.deepEqual(prompts(t), ['One', 'Two', 'Three']); assert.equal(t.turns[2].replies[0].content, 'Third, again'); assert.equal(t.turns[2].versions.length, 1);
  assert.equal(storedTurns(t), 5); assert.doesNotThrow(() => validateWorkspace(w));
});

test('stored versions are validated: set-aside turns hold none, numbers are distinct, and the totals are bounded', () => {
  const { w, t } = fixture(); retryTurn(t, t.turns[1].id); answer(t);
  const broken = structuredClone(w); broken.threads[0].turns[1].versions[0].turns[0].versions = [{ turns: [structuredClone(t.turns[0])] }];
  assert.throws(() => validateWorkspace(broken), /cannot hold versions/);
  const twin = structuredClone(w); twin.threads[0].turns[1].version = 1;
  assert.throws(() => validateWorkspace(twin), /Duplicate conversation versions/);
  const empty = structuredClone(w); empty.threads[0].turns[1].versions[0].turns = [];
  assert.throws(() => validateWorkspace(empty), /Empty conversation version/);
  const many = structuredClone(w); many.threads[0].turns[1].versions = Array.from({ length: LIMITS.versions }, (_, i) => ({ turns: [{ ...structuredClone(t.turns[0]), version: i + 3 }] }));
  assert.throws(() => validateWorkspace(many));
});

test('a point keeps at most the version limit', () => {
  const { t } = fixture(), at = t.turns.length - 1;
  for (let i = 1; i < LIMITS.versions; i++) addVersion(t, at, { ...structuredClone(t.turns[at]), id: 'v' + i, versions: undefined });
  assert.throws(() => addVersion(t, at, { ...structuredClone(t.turns[at]), id: 'over', versions: undefined }), /versions, the most/);
  assert.equal(t.turns[at].versions.length, LIMITS.versions - 1);
});

test('a branch starts from the path shown, without the versions set aside', () => {
  const { w, t } = fixture(); retryTurn(t, t.turns[1].id); answer(t);
  const branch = forkThread(w, t.id, t.turns[1].id, false);
  assert.equal(branch.turns[1].versions, undefined); assert.equal(branch.turns[1].version, undefined); assert.equal(t.turns[1].versions.length, 1);
});

test('replies still streaming in a set-aside version are marked interrupted at launch', () => {
  const { w, t } = fixture(); t.turns[2].replies[0].status = 'streaming';
  retryTurn(t, t.turns[1].id);
  assert.equal(recoverInterrupted(w), true);
  assert.equal(t.turns[1].versions[0].turns[1].replies[0].status, 'interrupted');
});

test('messages added in another role are sent as that role, need completed replies before them, and take no files', () => {
  const { w, t } = fixture();
  addMessage(t, 'system', 'Answer in French from now on.'); addMessage(t, 'assistant', 'D’accord.');
  const history = beginTurn(t, 'Bonjour', [])[0].messages;
  assert.deepEqual(history.slice(-3), [{ role: 'system', content: 'Answer in French from now on.' }, { role: 'assistant', content: 'D’accord.' }, { role: 'user', content: 'Bonjour' }]);
  assert.throws(() => addMessage(t, 'assistant', 'Too early'), /complete/);
  assert.throws(() => addMessage(t, 'user', 'Not a role'), /Invalid message role/);
  answer(t); assert.doesNotThrow(() => validateWorkspace(w));
  const withReply = structuredClone(w); withReply.threads[0].turns[3].replies = structuredClone(t.turns[0].replies);
  assert.throws(() => validateWorkspace(withReply), /no reply/);
  const withFile = structuredClone(w); withFile.threads[0].turns[3].attachments = [{ name: 'a.txt', content: 'x' }];
  assert.throws(() => validateWorkspace(withFile), /no files/);
  assert.match(exportMarkdown(t), /## System \(added by you\)\n\nAnswer in French from now on\./);
});

test('an added message can be edited into a new version, and a first one names the conversation', () => {
  const w = newWorkspace(), t = w.threads[0];
  const added = addMessage(t, 'system', 'You are terse.');
  assert.equal(t.title, 'You are terse.');
  addMessage(t, 'system', 'You are verbose.', added.id);
  assert.equal(t.turns.length, 1); assert.equal(t.turns[0].prompt, 'You are verbose.'); assert.equal(versionPosition(t.turns[0]).message.count, 2);
  assert.throws(() => retryTurn(t, t.turns[0].id), /no reply to retry/);
});

test('cloud write-back replaces the messages after a changed point with the path shown', () => {
  const { t } = fixture();
  const remote = { title: 'Chat', messages: t.turns.flatMap(turn => [{ role: 'user', content: turn.prompt, extra: 1 }, { role: 'assistant', content: turn.replies[0].content }]) };
  t.cloud = { id: 'c', etag: '1', project: null, turns: 3, loaded: true, dirty: false, syncedAt: 0 };
  retryTurn(t, t.turns[1].id); answer(t, 'Fresh answer');
  assert.equal(t.cloud.turns, 1); assert.equal(t.cloud.rewritten, true);
  const out = cloudPatch(remote, t, { v: 2, w: 'w', version: 2 }, 0).messages;
  assert.deepEqual(out.map(m => m.content), ['One', 'Answer to One', 'Two', 'Fresh answer']);
  assert.equal(out[0], remote.messages[0]);
  // Without a changed path, messages past the known turns are kept, as for a chat longer than the turn limit.
  delete t.cloud.rewritten; t.cloud.turns = 2;
  assert.equal(cloudPatch(remote, t, { v: 3, w: 'w', version: 3 }, 0).messages.length, 6);
});

test('a cloud chat read again keeps its versions for the turns that are unchanged', () => {
  const { t } = fixture(); retryTurn(t, t.turns[0].id); answer(t, 'Answer to One'); beginTurn(t, 'Two', []); answer(t);
  const kept = t.turns[0].versions;
  const plain = { title: 'Chat', messages: [{ role: 'user', content: 'One' }, { role: 'assistant', content: 'Answer to One' }, { role: 'user', content: 'Two' }, { role: 'assistant', content: 'Changed on the web' }] };
  const again = threadFromCloud(plain, { id: 'c', etag: '2', project: null }, null, 0, t);
  assert.equal(again.turns[0].versions, kept); assert.equal(again.turns[0].version, 2); assert.equal(again.turns[1].versions, undefined);
  const edited = threadFromCloud({ ...plain, messages: [{ role: 'user', content: 'One, edited' }, { role: 'assistant', content: 'x' }] }, { id: 'c', etag: '3', project: null }, null, 0, t);
  assert.equal(edited.turns[0].versions, undefined);
});

function vault() { let value = null; return { read: async () => value, write: async v => { value = structuredClone(v); }, flush: async () => {} }; }
async function service(t) {
  const calls = [];
  const client = { ready: async () => {}, getVerificationDocument: async () => ({ securityVerified: true, steps: { verifyCode: { status: 'success' } } }), models: { list: async () => ({ data: [{ id: 'a' }] }) },
    chat: { completions: { create: async body => { calls.push(structuredClone(body)); return (async function* () { yield { choices: [{ delta: { content: 'Reply ' + calls.length } }] }; yield { choices: [{ delta: {}, finish_reason: 'stop' }] }; })(); } } } };
  const s = new WorkbenchService(vault(), async () => client); await s.initialize(); await s.execute({ type: 'credentials.set', key: 'test-only-not-real' });
  s.workspace.threads[0].settings.model = 'a'; t.after(() => s.shutdown());
  const finished = async () => { while (s.tasks.size) await Promise.all([...s.tasks]); };
  return { s, calls, finished, thread: () => s.workspace.threads[0] };
}

test('the service retries, edits and switches versions in the same conversation', async t => {
  const { s, calls, finished, thread } = await service(t), id = thread().id;
  await s.execute({ type: 'send', id, text: 'Hello', attachments: [] }); await finished();
  await s.execute({ type: 'turn.retry', id, turnId: thread().turns[0].id }); await finished();
  assert.equal(s.workspace.threads.length, 1); assert.equal(thread().turns[0].replies[0].content, 'Reply 2'); assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].messages.at(-1), { role: 'user', content: 'Hello' });
  await s.execute({ type: 'send', id, text: 'Hello again', attachments: [], replace: thread().turns[0].id }); await finished();
  assert.equal(thread().turns[0].prompt, 'Hello again'); assert.equal(thread().turns[0].version, 3);
  await s.execute({ type: 'turn.version', id, turnId: thread().turns[0].id, version: 1 });
  assert.equal(thread().turns[0].replies[0].content, 'Reply 1'); assert.equal(calls.length, 3);
  await assert.rejects(s.execute({ type: 'turn.version', id, turnId: thread().turns[0].id, version: 0 }), /Invalid version/);
});

test('the service keeps messages in other roles out of Tinfoil cloud chats', async t => {
  const { s, thread } = await service(t), id = thread().id;
  await s.execute({ type: 'turn.add', id, role: 'assistant', text: 'Written by me' });
  assert.equal(thread().turns[0].role, 'assistant');
  thread().cloudPending = true;
  await assert.rejects(s.execute({ type: 'turn.add', id, role: 'system', text: 'No' }), new RegExp(ROLE_MESSAGES_CLOUD.slice(0, 40)));
  delete thread().cloudPending;
  s.workspace.projects.push({ id: 'p', name: 'Cloud project', createdAt: 0, cloud: { id: 'x', etag: '1', description: '', instructions: '', color: '', documents: [], syncedAt: 0 } });
  await assert.rejects(s.execute({ type: 'thread.move', id, projectId: 'p' }), new RegExp(ROLE_MESSAGES_CLOUD.slice(0, 40)));
  assert.equal(thread().projectId ?? null, null);
});
