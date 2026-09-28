/** Live acceptance of Tinfoil Chat account access on Windows. Manual: it needs a real Chat subscription
 * and a person to sign in. Run `npx electron tests/account-live.mjs [--dry] [--log <file>] [--shot <file>]`.
 *
 * The real app runs from source with a temporary profile. The tester completes sign-in in the Tinfoil
 * window; everything after that is driven through the real renderer: verify, one send, a wait past the
 * first key's expiry, a two-model send, a refresh interrupted by sign-out, and a refused send afterwards.
 * `--dry` stops at the sign-in window and cancels it.
 *
 * The production objects are observed, not changed, except for two test controls: sign-out's native
 * confirmation is answered, and one token response is held for two seconds so that sign-out lands while
 * it is in flight. Output is JSON lines of statuses, UTC times, counts and booleans. Keys and bearers are
 * only compared in memory with snapshots, renderer content, vault writes and the profile directory;
 * a log line that contained one would be refused. No credential is printed, stored or passed on. */
import { app, BrowserWindow, dialog } from 'electron';
import { mkdtempSync, appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir, release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { CHAT_TOKEN_URL, allowedAccountNavigation } from '../dist/core/account.js';
import { AccountSession } from '../desktop/account-session.mjs';
import { AccountWindow } from '../desktop/account-window.mjs';
import { WorkbenchService } from '../desktop/service.mjs';
import { EncryptedVault } from '../desktop/vault.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const profile = mkdtempSync(join(tmpdir(), 'tinfoil-account-live-'));
app.setPath('userData', profile);
const option = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const dry = process.argv.includes('--dry'), logFile = option('--log'), shotFile = option('--shot');
const secrets = new Set(), leaks = new Set();
const stats = { exchanges: [], starts: 0, holding: false, held: [], pageHosts: [], frameRedirectHosts: new Set(), refusedHosts: [], logins: 0, loginsDone: 0, identityChecks: 0, identityMatched: null, clients: [], snapshots: 0, vaultWrites: 0, dateHeader: null };
let service = null, holdNext = 0;
const leaked = text => { for (const s of secrets) if (text.includes(s)) return true; return false; };
const iso = ms => typeof ms === 'number' ? new Date(ms).toISOString() : null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function log(step, data = {}) {
  const line = JSON.stringify({ at: new Date().toISOString(), step, ...data });
  if (leaked(line)) throw new Error('A log line contained a credential and was not written.');
  console.log(line); if (logFile) appendFileSync(logFile, line + '\n');
}

// Observation of the production classes. Instances are created by desktop/main.mjs after this module runs.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) !== CHAT_TOKEN_URL) return realFetch(url, init);
  stats.starts++; const hold = holdNext; holdNext = 0;
  try {
    const response = await realFetch(url, init);
    stats.dateHeader = response.headers.has('date');
    if (hold) {
      stats.holding = true; await sleep(hold); stats.holding = false;
      stats.held.push({ status: response.status, deliveredAfterSignOut: service?.options.account?.snapshot().status === 'signed-out' });
    }
    return response;
  } catch (error) { if (hold) stats.held.push({ aborted: true }); throw error; }
};
const wrap = (proto, name, around) => { const original = proto[name]; proto[name] = function (...args) { return around.call(this, original, args); }; };
wrap(AccountSession.prototype, 'accept', function (original, [raw, expected]) { if (typeof raw?.bearer === 'string' && raw.bearer) secrets.add(raw.bearer); return original.call(this, raw, expected); });
wrap(AccountSession.prototype, 'request', async function (original, args) {
  const started = Date.now();
  try { const r = await original.apply(this, args); if (typeof r.body?.key === 'string' && r.body.key) secrets.add(r.body.key); stats.exchanges.push({ at: iso(started), status: r.status, ms: Date.now() - started }); return r; }
  catch (error) { stats.exchanges.push({ at: iso(started), status: 'not completed', ms: Date.now() - started }); throw error; }
});
wrap(AccountSession.prototype, 'login', async function (original, args) { try { return await original.apply(this, args); } finally { stats.loginsDone++; } });
wrap(AccountWindow.prototype, 'login', function (original, args) { stats.logins++; return original.apply(this, args); });
wrap(AccountWindow.prototype, 'identity', async function (original, [expected]) {
  const value = await original.call(this, expected); stats.identityChecks++;
  stats.identityMatched = value?.sessionUserId === expected.user && value?.sessionId === expected.session; return value;
});
// Sign-in navigation, by host name only (OAuth URLs carry codes and state).
const hostOf = url => { try { return new URL(url).hostname; } catch { return ''; } };
wrap(AccountWindow.prototype, 'secure', function (original, [win]) {
  original.call(this, win);
  const wc = win.webContents;
  wc.on('did-navigate', (_event, url) => { const host = hostOf(url); if (stats.pageHosts.at(-1) !== host) { stats.pageHosts.push(host); log('sign-in-page', { host }); } });
  wc.on('did-redirect-navigation', (event, url, _inPlace, isMainFrame) => { const target = url ?? event.url; if ((event.isMainFrame ?? isMainFrame) === false && !allowedAccountNavigation(target)) stats.frameRedirectHosts.add(hostOf(target)); });
  wc.on('did-fail-load', (_event, code, _description, url, isMainFrame) => { if (isMainFrame && code !== -3) log('sign-in-load-failed', { host: hostOf(url), code }); });
});
wrap(AccountSession.prototype, 'blocked', function (original, [host]) { stats.refusedHosts.push(host); log('sign-in-refused-host', { host }); return original.call(this, host); });
wrap(WorkbenchService.prototype, 'initialize', function (original, args) {
  service = this; const factory = this.providerFactory;
  this.providerFactory = async (key, cache, mode) => { secrets.add(key); stats.clients.push({ at: iso(Date.now()), mode }); return factory(key, cache, mode); };
  return original.apply(this, args);
});
wrap(WorkbenchService.prototype, 'snapshot', function (original, args) { const s = original.apply(this, args); stats.snapshots++; if (leaked(JSON.stringify(s))) leaks.add('snapshot'); return s; });
wrap(EncryptedVault.prototype, 'write', function (original, [workspace]) { stats.vaultWrites++; if (leaked(JSON.stringify(workspace))) leaks.add('vault'); return original.call(this, workspace); });

const main = () => BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.getURL().startsWith('app://workbench'));
const account = () => service.options.account;
const accountWindow = () => { const w = account().adapter.window; return w && !w.isDestroyed() ? w : null; };
const js = code => main().webContents.executeJavaScript(code, true);
const click = selector => js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled)return false;el.click();return true;})()`);
async function until(label, ready, ms, every = 500) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await ready()) return; await sleep(every); }
  throw new Error('Timed out waiting for ' + label + '.');
}
const thread = () => service.workspace.threads.find(t => t.id === service.workspace.activeId);
async function settings(patch) {
  const t = thread(), next = { ...t.settings, ...patch };
  await js(`window.tinfoil.command({type:'thread.settings',id:${JSON.stringify(t.id)},settings:${JSON.stringify(next)}})`);
}
async function send(text) {
  const before = thread().turns.length;
  await js(`(()=>{const p=document.getElementById('prompt');p.value=${JSON.stringify(text)};p.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('send').click();})()`);
  await until('the new turn', () => thread().turns.length > before, 20_000);
  await until('the replies', () => !service.busyThreadId, 240_000);
  return thread().turns.at(-1).replies.map(r => ({ model: r.model, status: r.status, error: r.error?.slice(0, 200) ?? null, characters: r.content.length, usage: r.usage }));
}
async function openAccount() {
  if (!await js(`!!document.querySelector('#account-dialog[open]')`)) await click('#account-footer');
  await until('the account dialog', () => js(`!!document.querySelector('#account-dialog[open]')`), 10_000);
}
function scanProfile() {
  const jwt = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
  let files = 0, bytes = 0, jwtLike = 0, tracked = 0;
  const visit = dir => { for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { visit(path); continue; }
    let data; try { data = readFileSync(path); } catch { continue; }
    files++; bytes += data.length; const text = data.toString('latin1');
    jwtLike += (text.match(jwt) ?? []).length; for (const s of secrets) if (text.includes(s)) tracked++;
  } };
  visit(profile); return { files, bytes, jwtLike, trackedCredentials: tracked };
}
const git = (...args) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); } catch { return null; } };

async function run() {
  await until('the service', () => !!service, 60_000);
  await until('the window', () => !!main() && !main().webContents.isLoading(), 60_000);
  await sleep(1500);
  log('start', { commit: git('rev-parse', 'HEAD'), uncommittedChanges: !!git('status', '--porcelain'), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, windows: release(), packaged: app.isPackaged, profile: 'temporary', profileDir: profile });

  // 1. Sign in through the real Account dialog; the tester completes the provider's own sign-in.
  for (let attempt = 1; ; attempt++) {
    await openAccount();
    await until('the sign-in button', () => js(`!!document.querySelector('[data-action="account-login"]:not([disabled])')`), 20_000);
    const done = stats.loginsDone; await click('[data-action="account-login"]');
    await until('the sign-in window', () => !!accountWindow(), 30_000);
    log('sign-in-window', { attempt, origin: new URL(accountWindow().webContents.getURL() || 'about:blank').origin });
    if (dry) {
      await sleep(8000);
      if (shotFile) { const w = accountWindow(); if (w) writeFileSync(shotFile, (await w.webContents.capturePage()).toPNG()); }
      await openAccount(); await click('[data-action="account-cancel"]');
      await until('cancelled sign-in', () => account().snapshot().status === 'signed-out' && !accountWindow(), 20_000);
      log('dry-run-cancelled', { status: account().snapshot().status, accountWindowDestroyed: !accountWindow(), exchanges: stats.exchanges.length, interactiveLogins: stats.logins });
      return;
    }
    await until('sign-in to finish', () => stats.loginsDone > done, 11 * 60_000, 1000);
    const s = account().snapshot();
    if (s.status === 'signed-in') break;
    log('sign-in-not-completed', { attempt, status: s.status, message: s.message, pageHosts: stats.pageHosts, frameRedirectHostsOutsideList: [...stats.frameRedirectHosts], refusedHosts: stats.refusedHosts });
    if (attempt >= 3 || s.status === 'expired') throw new Error('Sign-in did not complete.');
  }
  let s = account().snapshot();
  log('signed-in', { interactiveLogins: stats.logins, accountWindowVisible: accountWindow()?.isVisible() ?? null,
    navigation: { pageHosts: stats.pageHosts, frameRedirectHostsOutsideList: [...stats.frameRedirectHosts], refusedHosts: stats.refusedHosts },
    identity: { profileMatchesBinding: account().binding?.user === s.profile.id, clerkSessionBound: /^sess_/.test(account().binding?.session ?? ''), postExchangeChecks: stats.identityChecks, postExchangeMatched: stats.identityMatched },
    exchanges: stats.exchanges, serverDateHeader: stats.dateHeader, entitlement: s.entitlement, subscriptionStatus: s.profile.subscriptionStatus, emailVerified: s.profile.emailVerified,
    usageReported: !!s.usage, tokenExpiresAt: iso(s.tokenExpiresAt), secondsUntilRenewal: Math.round((account().keyDeadline - Date.now()) / 1000) - 60, message: s.message });
  if (s.entitlement !== 'active') throw new Error('Chat access is not active for this account.');

  // 2. Verify the enclave and load models through the Account dialog.
  await openAccount();
  await until('the verify button', () => js(`!!document.querySelector('[data-action="account-connect"]:not([disabled])')`), 20_000);
  let t0 = Date.now(); await click('[data-action="account-connect"]');
  // Verification finishes before the model list loads; wait for the list, a notice or a failure.
  await until('verification and the model list', () => service.verification.state === 'failed' || (service.verification.state === 'verified' && !service.connection && (service.models.length > 0 || !!service.notice)), 120_000);
  log('verified', { state: service.verification.state, steps: service.verification.steps, models: service.models.length, seconds: (Date.now() - t0) / 1000, notice: service.notice });
  if (service.verification.state !== 'verified' || !service.models.length) throw new Error('Verification did not complete.');
  await click('#account-dialog [data-action="dismiss"]');
  const pick = preferred => preferred.find(m => service.models.includes(m)) ?? service.models.find(m => !preferred.includes(m) && !/embed|whisper|tts|guard|nomic|audio|voxtral|image|realtime/i.test(m));
  const primary = pick(['deepseek-v4-1-flash', 'gpt-oss-120b']), second = pick(['gpt-oss-120b', 'llama3-3-70b', 'glm-4-7']);

  // 3. One ordinary send with blank custom instructions.
  await settings({ model: primary, maxTokens: 256, visualTools: false, webSearch: false, compare: false });
  log('settings', { models: [primary, second], customInstructions: !!thread().settings.systemPrompt.trim() });
  const keyAtFirstSend = account().key, clientsBefore = stats.clients.length;
  t0 = Date.now(); const first = await send('Reply with one short sentence confirming you received this test message.');
  log('first-send', { replies: first, seconds: (Date.now() - t0) / 1000, exchangesSoFar: stats.exchanges.length, newClients: stats.clients.length - clientsBefore, keyReused: account().key === keyAtFirstSend });

  // 4. Wait past the first key's expiry with no activity, then send to two models at once.
  const firstExpiry = account().state.tokenExpiresAt, firstKey = account().key, reuseUntil = account().keyDeadline - 60_000;
  const resumeAt = Math.max(firstExpiry, account().keyDeadline) + 20_000;
  log('waiting-for-expiry', { tokenExpiresAt: iso(firstExpiry), renewalDueAt: iso(reuseUntil), sendAt: iso(resumeAt) });
  let lastNote = Date.now();
  while (Date.now() < resumeAt) { await sleep(Math.min(15_000, resumeAt - Date.now())); if (Date.now() - lastNote >= 300_000) { lastNote = Date.now(); log('waiting', { secondsLeft: Math.round((resumeAt - Date.now()) / 1000) }); } }
  await settings({ compare: true, compareModel: second, maxTokens: 256 });
  const exchangesBefore = stats.exchanges.length, loginsBefore = stats.logins, clientsBeforeRenewal = stats.clients.length;
  t0 = Date.now(); const renewed = await send('Name one prime number between 10 and 20. Answer with the number only.');
  s = account().snapshot();
  log('renewed', { firstExpiry: iso(firstExpiry), sentAfterExpiry: t0 > firstExpiry, newExpiry: iso(s.tokenExpiresAt), keyChanged: !!account().key && account().key !== firstKey,
    exchangesDuringSend: stats.exchanges.slice(exchangesBefore), newVerifiedClients: stats.clients.length - clientsBeforeRenewal, interactiveLoginsDuringSend: stats.logins - loginsBefore,
    accountWindowVisible: accountWindow()?.isVisible() ?? null, verification: service.verification.state, replies: renewed, seconds: (Date.now() - t0) / 1000 });

  // 5. Credentials must not reach renderer content or storage, snapshots or vault writes.
  const rendererText = await js(`document.documentElement.outerHTML+JSON.stringify(Object.entries(localStorage))+JSON.stringify(Object.entries(sessionStorage))`);
  log('exposure', { credentialsTracked: secrets.size, inRendererContent: leaked(rendererText), inSnapshots: leaks.has('snapshot'), inVaultWrites: leaks.has('vault'), snapshotsChecked: stats.snapshots, vaultWrites: stats.vaultWrites });

  // 6. Sign out while a refresh exchange is in flight; its late response must be discarded.
  await openAccount();
  const startsBefore = stats.starts, exchangesBeforeSignOut = stats.exchanges.length; holdNext = 2000;
  const refresh = js(`window.tinfoil.command({type:'account.refresh'}).then(()=>'resolved',e=>'rejected: '+e.message)`);
  await until('the refresh exchange to be held', () => stats.starts > startsBefore && stats.holding, 15_000, 20);
  const original = dialog.showMessageBox;
  dialog.showMessageBox = async (window, options) => {
    if (options?.message !== 'Sign out of Tinfoil Chat?') return original.call(dialog, window, options);
    dialog.showMessageBox = original; return { response: 1, checkboxChecked: false };
  };
  const signOut = js(`window.tinfoil.command({type:'account.signout'}).then(()=>'resolved',e=>'rejected: '+e.message)`);
  await until('sign-out', () => account().snapshot().status === 'signed-out', 20_000, 50);
  const refreshResult = await refresh, signOutResult = await signOut; await sleep(3000);
  log('signed-out-during-refresh', { heldResponse: stats.held.at(-1) ?? null, exchangeOutcome: stats.exchanges.slice(exchangesBeforeSignOut), refreshResult: refreshResult.slice(0, 160), signOutResult,
    status: account().snapshot().status, keyCleared: account().key === null, bindingCleared: account().binding === null, serviceClientCleared: service.client === null && service.clientCredential === null,
    accountWindowDestroyed: !accountWindow(), otherWindows: BrowserWindow.getAllWindows().filter(w => w !== main()).length });

  // 7. After sign-out a send is refused before any turn or exchange, with no API-key fallback.
  const turns = thread().turns.length, exchangesAfter = stats.exchanges.length;
  const refused = await js(`window.tinfoil.command({type:'send',id:${JSON.stringify(thread().id)},text:'This must not be sent.',attachments:[]}).then(()=>'sent',e=>'refused: '+e.message)`);
  log('send-after-sign-out', { result: refused.slice(0, 200), turnsUnchanged: thread().turns.length === turns, exchangesUnchanged: stats.exchanges.length === exchangesAfter, connectionMode: service.workspace.connectionMode, apiKeySaved: !!service.workspace.apiKey });
  await service.vault.flush();
  log('profile-scan', scanProfile());
}

app.whenReady().then(() => setTimeout(async () => {
  let code = 0;
  try { await run(); }
  catch (error) { code = 1; try { log('failed', { error: String(error?.message ?? error).slice(0, 300) }); } catch { console.log('{"step":"failed"}'); } }
  finally {
    try { log('done', { exchanges: stats.exchanges.length, verifiedClients: stats.clients.length, leaks: [...leaks] }); } catch {}
    try { await service?.shutdown(); await service?.options.account?.shutdown(); } catch {}
    app.exit(code);
  }
}, 0));
