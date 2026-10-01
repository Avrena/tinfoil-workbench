/** Live check that Tinfoil Chat on the web keeps a field it does not know in a cloud chat's plaintext when it edits the
 * chat, which synced tags rely on. Manual: it needs a real account with cloud sync set up, and a person to sign in, add
 * the chat key and rename one chat on the web. Run `npx electron tests/cloud-field-live.mjs [--log <file>]`.
 *
 * The real app runs from source with a temporary profile; the tester signs in and adds the chat key in the Account
 * view, and the harness never receives the key. A test chat is made from a written first exchange (no model is asked)
 * and moved to Tinfoil cloud with an extra top-level field, `workbenchProbe`. The tester renames it in Tinfoil Chat on
 * the web; once the new title is in the cloud, the row is read again and the field compared. The test chat is then
 * deleted and the account signed out. Output is JSON lines of booleans and field names; no titles, messages or keys. */
import { app, BrowserWindow } from 'electron';
import { mkdtempSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { AccountSession } from '../desktop/account-session.mjs';
import { WorkbenchService } from '../desktop/service.mjs';
import { parseCloudKey } from '../dist/core/cloud.js';
import { beginTurn } from '../dist/core/workspace.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const option = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const profile = mkdtempSync(join(tmpdir(), 'tinfoil-field-live-'));
app.setPath('userData', profile);
const logFile = option('--log'), secrets = new Set();
let service = null, stage = 'start';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function log(step, data = {}) {
  const line = JSON.stringify({ at: new Date().toISOString(), step, ...data });
  for (const s of secrets) if (s && line.includes(s)) throw new Error('A log line contained a secret and was not written.');
  console.log(line); if (logFile) appendFileSync(logFile, line + '\n');
}
const wrap = (proto, name, around) => { const original = proto[name]; proto[name] = function (...args) { return around.call(this, original, args); }; };
wrap(AccountSession.prototype, 'accept', function (original, [raw, expected]) { if (typeof raw?.bearer === 'string' && raw.bearer) secrets.add(raw.bearer); return original.call(this, raw, expected); });
wrap(WorkbenchService.prototype, 'initialize', function (original, args) { service = this; return original.apply(this, args); });

const PROBE = { version: 1, tags: [{ name: 'Probe', color: 'blue', style: 'outline', icon: 'code' }], tagged: { at: 1, model: 'probe-model' } };
const main = () => BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.getURL().startsWith('app://workbench'));
const js = code => main().webContents.executeJavaScript(code, true);
const command = c => js(`window.tinfoil.command(${JSON.stringify(c)})`);
async function until(label, ready, ms, every = 500) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await ready()) return; await sleep(every); }
  throw new Error('Timed out waiting for ' + label + '.');
}
async function answerConfirmation(title) {
  const find = () => BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.getURL().startsWith('app://approval'));
  await until('the confirmation window', () => !!find(), 15_000, 200);
  await sleep(1000); // Approve arms after a moment.
  const win = find(), shown = await win.webContents.executeJavaScript(`document.getElementById('title').textContent`, true);
  if (!shown.includes(title)) throw new Error('An unexpected confirmation was open.');
  await win.webContents.executeJavaScript(`document.getElementById('approve').click()`, true);
}
const account = () => service.options.account, cloud = () => service.cloud;
const git = (...args) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); } catch { return null; } };
const decode = item => JSON.parse(Buffer.from(item.plaintext, 'base64').toString('utf8'));
async function pullRow(id) { const [item] = await cloud().client.pull('chat', [id], cloud().key()); return item; }

async function run() {
  await until('the service', () => !!service, 60_000);
  await until('the window', () => !!main() && !main().webContents.isLoading(), 60_000);
  log('start', { commit: git('rev-parse', 'HEAD'), uncommittedChanges: !!git('status', '--porcelain'), electron: process.versions.electron });
  await js(`document.getElementById('account-footer').click()`);
  log('waiting-for-tester', { steps: ['Sign in to Tinfoil Chat in the Account view', 'Paste your chat key under Tinfoil cloud chats and choose Connect, or choose Open key file'] });
  stage = 'sign-in'; await until('sign-in', () => account().snapshot().status === 'signed-in', 30 * 60_000, 1000);
  log('signed-in', {});
  stage = 'chat key'; await until('the chat key', () => !!service.workspace.cloud, 30 * 60_000, 1000);
  const parsed = parseCloudKey(service.workspace.cloud.key); secrets.add(service.workspace.cloud.key); secrets.add(Buffer.from(parsed.bytes).toString('base64'));
  log('key-added', {});
  // Each change of the sync status is logged, so a failed sync shows its message instead of a silent wait.
  stage = 'first sync'; let seen = '';
  await until('the first sync', () => {
    const s = cloud().status, now = `${s.state}|${s.message ?? ''}`;
    if (now !== seen) { seen = now; log('cloud-status', { state: s.state, message: s.message ?? null }); }
    return s.state === 'ready' && s.lastSyncAt;
  }, 10 * 60_000);
  log('synced', { chats: cloud().snapshot().chats, older: cloud().snapshot().older ?? null });

  // A test chat from a written exchange, moved to the cloud with the extra field.
  stage = 'test chat'; await command({ type: 'thread.new', projectId: null });
  const id = service.workspace.activeId, stamp = new Date().toISOString().slice(0, 16), title = `Workbench field probe ${stamp}`;
  const t = () => service.workspace.threads.find(x => x.id === id);
  t().settings.model = 'deepseek-v4-1-flash';
  beginTurn(t(), 'This chat checks that a field Workbench adds survives an edit on the web. Rename it, then leave it.', []);
  Object.assign(t().turns[0].replies[0], { status: 'complete', content: 'Understood.', model: 'deepseek-v4-1-flash' });
  t().title = title; await service.save();
  const client = cloud().client, push = client.push.bind(client);
  client.push = (scope, chatId, key, body, ifMatch, metadata) => push(scope, chatId, key, scope === 'chat' && body?.title === title ? { ...body, workbenchProbe: PROBE } : body, ifMatch, metadata);
  stage = 'upload'; await command({ type: 'thread.cloud.upload', id });
  client.push = push;
  const cloudId = t().cloud.id;
  let row = await pullRow(cloudId), plain = decode(row);
  const before = Object.keys(plain).sort();
  log('uploaded', { version: row.etag, probeStored: isDeepStrictEqual(plain.workbenchProbe, PROBE), fields: before });

  // The tester renames it on the web; the harness reads the row until its title changes (up to 30 minutes).
  log('waiting-for-tester', { steps: [`In Tinfoil Chat on the web, find the chat “${title}”, rename it to anything else, and leave it`] });
  stage = 'web rename'; let renamed = null;
  await until('the rename on the web', async () => { const r = await pullRow(cloudId); if (r?.ok && decode(r).title !== title) { renamed = r; return true; } return false; }, 30 * 60_000, 5000);
  plain = decode(renamed);
  const after = Object.keys(plain).sort();
  log('renamed-on-web', { version: renamed.etag, versionAdvanced: Number(renamed.etag) > Number(row.etag), probeKept: isDeepStrictEqual(plain.workbenchProbe, PROBE),
    probePresent: 'workbenchProbe' in plain, fieldsAdded: after.filter(k => !before.includes(k)), fieldsRemoved: before.filter(k => !after.includes(k)), writerChanged: plain.writer !== service.workspace.cloud.writer,
    messages: Array.isArray(plain.messages) ? plain.messages.length : null });

  // Workbench takes the web's version (the field stays in the row), then deletes the test chat.
  stage = 'sync'; await command({ type: 'cloud.sync' }).catch(() => cloud().sync());
  await until('the new version here', () => t()?.cloud?.etag === String(renamed.etag), 120_000, 1000);
  stage = 'delete'; const deleting = command({ type: 'thread.delete', id }); await answerConfirmation('Delete'); await deleting;
  row = await pullRow(cloudId);
  log('deleted', { goneFromCloud: !row?.ok, goneLocally: !service.workspace.threads.some(x => x.id === id) });
  stage = 'finish';
  const signout = command({ type: 'account.signout' }); await answerConfirmation('Sign out of Tinfoil Chat?'); await signout;
  await until('sign-out', () => account().snapshot().status === 'signed-out', 30_000);
  log('finished', { profile });
}
app.whenReady().then(() => run()).catch(error => log('failed', { stage, message: String(error?.message ?? error).slice(0, 300), status: error?.status ?? null, code: error?.code ?? null })).finally(() => setTimeout(() => app.quit(), 1500));
