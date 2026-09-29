/** Live acceptance of Tinfoil cloud sync on Windows. Manual: it needs a real account with cloud sync set up and a
 * person to sign in and add the chat key. Run `npx electron tests/cloud-live.mjs [--log <file>] [--read-only]`.
 *
 * The real app runs from source with a temporary profile. The tester signs in and adds the chat key in the Account
 * view; the harness never receives the key. Then, through the real service and renderer:
 *   1. the first sync: counts of chats, projects and documents;
 *   2. read-only fidelity on real chats: up to ten recent chats are opened, and writing each back unchanged must
 *      leave its messages byte for byte as they are (computed locally; nothing is written);
 *   3. unless --read-only: a new test chat, with one short message, is moved to Tinfoil cloud, renamed, continued with
 *      a second short message and deleted, each step checked by pulling the row again. No existing chat is written.
 * Output is JSON lines of statuses, counts and booleans; no titles, messages, keys or tokens. A log line that
 * contained a tracked secret would be refused. The account is signed out at the end. */
import { app, BrowserWindow, dialog } from 'electron';
import { mkdtempSync, appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { AccountSession } from '../desktop/account-session.mjs';
import { WorkbenchService } from '../desktop/service.mjs';
import { cloudPatch, parseCloudKey } from '../dist/core/cloud.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const profile = mkdtempSync(join(tmpdir(), 'tinfoil-cloud-live-'));
app.setPath('userData', profile);
const option = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const readOnly = process.argv.includes('--read-only'), logFile = option('--log');
const secrets = new Set();
let service = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function log(step, data = {}) {
  const line = JSON.stringify({ at: new Date().toISOString(), step, ...data });
  for (const s of secrets) if (s && line.includes(s)) throw new Error('A log line contained a secret and was not written.');
  console.log(line); if (logFile) appendFileSync(logFile, line + '\n');
}
const wrap = (proto, name, around) => { const original = proto[name]; proto[name] = function (...args) { return around.call(this, original, args); }; };
wrap(AccountSession.prototype, 'accept', function (original, [raw, expected]) { if (typeof raw?.bearer === 'string' && raw.bearer) secrets.add(raw.bearer); return original.call(this, raw, expected); });
wrap(WorkbenchService.prototype, 'initialize', function (original, args) { service = this; return original.apply(this, args); });
// Sign-out asks natively; the harness confirms its own final sign-out and, once, the test chat's deletion.
const confirmations = [];
dialog.showMessageBox = async (_window, options) => { confirmations.push(options.message); return { response: 1, checkboxChecked: false }; };

const main = () => BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.getURL().startsWith('app://workbench'));
const js = code => main().webContents.executeJavaScript(code, true);
const command = c => js(`window.tinfoil.command(${JSON.stringify(c)})`);
async function until(label, ready, ms, every = 500) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await ready()) return; await sleep(every); }
  throw new Error('Timed out waiting for ' + label + '.');
}
const account = () => service.options.account, cloud = () => service.cloud;
const git = (...args) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); } catch { return null; } };
const decode = item => JSON.parse(Buffer.from(item.plaintext, 'base64').toString('utf8'));
async function pullRow(id) { const [item] = await cloud().client.pull('chat', [id], cloud().key()); return item; }

async function run() {
  await until('the service', () => !!service, 60_000);
  await until('the window', () => !!main() && !main().webContents.isLoading(), 60_000);
  log('start', { commit: git('rev-parse', 'HEAD'), uncommittedChanges: !!git('status', '--porcelain'), electron: process.versions.electron, readOnly });

  // 1. The tester signs in and adds the chat key in the real Account view.
  await js(`document.getElementById('account-footer').click()`);
  log('waiting-for-tester', { steps: ['Sign in to Tinfoil Chat in the Account view', 'Paste your chat key under Tinfoil cloud chats and choose Connect, or choose Open key file'] });
  await until('sign-in', () => account().snapshot().status === 'signed-in', 30 * 60_000, 1000);
  log('signed-in', { entitlement: account().snapshot().entitlement });
  await until('the chat key', () => !!service.workspace.cloud, 30 * 60_000, 1000);
  const parsed = parseCloudKey(service.workspace.cloud.key); secrets.add(service.workspace.cloud.key); secrets.add(Buffer.from(parsed.bytes).toString('base64'));
  await until('the first sync', () => cloud().status.state === 'ready' && cloud().status.lastSyncAt, 10 * 60_000);
  const snap = cloud().snapshot();
  log('synced', { chats: snap.chats, projects: snap.projects, older: snap.older, documents: service.workspace.projects.reduce((n, p) => n + (p.cloud?.documents.length ?? 0), 0),
    projectsWithInstructions: service.workspace.projects.filter(p => p.cloud?.instructions).length, snapshotHasKey: JSON.stringify(service.snapshot()).includes(service.workspace.cloud.key) });

  // 2. Read-only fidelity on the most recent real chats.
  const recent = service.workspace.threads.filter(t => t.cloud).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10);
  const fidelity = [];
  for (const t of recent) {
    await command({ type: 'thread.select', id: t.id });
    await until('the chat to load', () => service.workspace.threads.find(x => x.id === t.id)?.cloud?.loaded, 60_000);
    const loaded = service.workspace.threads.find(x => x.id === t.id), item = await pullRow(loaded.cloud.id), plain = decode(item);
    const patched = cloudPatch(plain, loaded, { v: 1, w: 'check', version: 1 }, Date.now());
    fidelity.push({ turns: loaded.turns.length, messages: Array.isArray(plain.messages) ? plain.messages.length : null, sameVersion: String(item.etag) === loaded.cloud.etag,
      unchangedWriteBackKeepsMessages: isDeepStrictEqual(patched.messages, plain.messages), keepsOtherFields: Object.keys(plain).every(k => k in patched) });
  }
  log('fidelity', { chats: fidelity.length, allKeepMessages: fidelity.every(f => f.unchangedWriteBackKeepsMessages), allKeepFields: fidelity.every(f => f.keepsOtherFields), details: fidelity });
  if (readOnly) return finish();

  // 3. A test chat's whole life: create locally, send, move to the cloud, rename, continue, delete.
  await command({ type: 'thread.new', projectId: null });
  const id = service.workspace.activeId, stamp = new Date().toISOString().slice(0, 16);
  await command({ type: 'thread.rename', id, title: `Workbench cloud sync test ${stamp}` });
  if (!service.models.length) await command({ type: 'connect' });
  const model = ['deepseek-v4-1-flash', 'gpt-oss-120b'].find(m => service.models.includes(m)) ?? service.models[0];
  const t = () => service.workspace.threads.find(x => x.id === id);
  await command({ type: 'thread.settings', id, settings: { ...t().settings, model, maxTokens: 64, compare: false, visualTools: false, webSearch: false } });
  const send = async text => { await command({ type: 'send', id, text, attachments: [] }); await until('the reply', () => !service.busyThreadId, 180_000); return t().turns.at(-1).replies[0].status; };
  const first = await send('Reply with the single word OK.');
  await command({ type: 'thread.cloud.upload', id });
  let row = await pullRow(t().cloud.id), plain = decode(row);
  log('uploaded', { replyStatus: first, linked: !!t().cloud, version: row.etag, messages: plain.messages.length, titleMatches: plain.title === t().title, writer: plain.writer === service.workspace.cloud.writer });
  await command({ type: 'thread.rename', id, title: `Workbench cloud sync test ${stamp} (renamed)` });
  await until('the rename to be written', () => !t().cloud.dirty && !cloud().writes.size, 60_000);
  row = await pullRow(t().cloud.id); plain = decode(row);
  log('renamed', { version: row.etag, titleMatches: plain.title === t().title, titleState: plain.titleState, messages: plain.messages.length });
  const second = await send('Reply with the single word DONE.');
  await until('the turn to be written', () => !t().cloud.dirty && !cloud().writes.size, 60_000);
  row = await pullRow(t().cloud.id); plain = decode(row);
  log('continued', { replyStatus: second, version: row.etag, messages: plain.messages.length, roles: plain.messages.map(m => m.role).join(','), linkedVersionMatches: row.etag === t().cloud.etag });
  const cloudId = t().cloud.id;
  await command({ type: 'thread.delete', id });
  row = await pullRow(cloudId);
  log('deleted', { goneFromCloud: !row?.ok, code: row?.code ?? null, goneLocally: !service.workspace.threads.some(x => x.id === id) });
  return finish();
}
async function finish() {
  const workspaceHasKey = JSON.stringify(service.snapshot()).includes(service.workspace.cloud.key);
  let plaintextKeyFiles = 0;
  const visit = dir => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) { visit(path); continue; } try { const text = readFileSync(path).toString('latin1'); for (const s of secrets) if (s && text.includes(s)) { plaintextKeyFiles++; break; } } catch {} } };
  visit(profile);
  await command({ type: 'account.signout' }); await until('sign-out', () => account().snapshot().status === 'signed-out', 30_000);
  log('finished', { snapshotHasKey: workspaceHasKey, profileFilesWithASecretInPlaintext: plaintextKeyFiles, confirmations: confirmations.length, signedOut: true });
}
app.whenReady().then(() => run()).catch(error => log('failed', { message: String(error?.message ?? error).slice(0, 300) })).finally(() => setTimeout(() => app.quit(), 1500));
