import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountSession, TIMING } from '../desktop/account-session.mjs';
import { AccountWindow } from '../desktop/account-window.mjs';
import { AccountStore, storableCookie, savedAccount } from '../desktop/account-store.mjs';
import { accountCookieDomain } from '../dist/core/account.js';
import { validateWorkspace } from '../dist/core/validation.js';
import { newWorkspace } from '../dist/core/workspace.js';
import { WorkbenchService } from '../desktop/service.mjs';

const T0 = Date.parse('2026-09-29T12:00:00Z'), YEAR = T0 / 1000 + 365 * 86400;
const raw = (id = 'user_test', sid = 'sess_test') => ({ sessionUserId: id, sessionId: sid, bearer: 'clerk-test-only',
  profile: { id, name: 'Example User', email: 'example@example.invalid', emailVerified: true, subscriptionStatus: 'active', subscriptionExpiresAt: null } });
const tokenResponse = () => new Response(JSON.stringify({ key: 'inference-test-only', expires_at: '2026-09-29T13:00:00Z' }), { status: 200, headers: { 'content-type': 'application/json' } });
const cookie = (name, domain, extra = {}) => ({ name, value: name + '-value', domain, path: '/', secure: true, httpOnly: true, sameSite: 'lax', expirationDate: YEAR, hostOnly: !domain.startsWith('.'), ...extra });
// A reversible stand-in for Electron safeStorage; the real one is DPAPI.
const protector = (available = true) => ({ isEncryptionAvailable: () => available,
  encryptString: s => Buffer.from([...Buffer.from(s, 'utf8')].map(b => b ^ 0x5a)), decryptString: b => Buffer.from([...b].map(x => x ^ 0x5a)).toString('utf8') });
const temp = t => { const dir = mkdtempSync(join(tmpdir(), 'workbench-account-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return join(dir, 'account-session.bin'); };
const record = (cookies = [storableCookie(cookie('__client', 'clerk.tinfoil.sh'))]) => ({ version: 1, binding: { user: 'user_test', session: 'sess_test' }, profile: raw().profile, cookies, savedAt: T0 });

test('only persistent cookies of tinfoil.sh and its subdomains are kept', () => {
  for (const d of ['tinfoil.sh', '.tinfoil.sh', 'clerk.tinfoil.sh', 'CHAT.tinfoil.sh']) assert.equal(accountCookieDomain(d), true, d);
  for (const d of ['tinfoil.sh.evil.test', 'eviltinfoil.sh', 'accounts.google.com', 'tinfoil.sh/', '']) assert.equal(accountCookieDomain(d), false, d);
  assert.deepEqual(storableCookie(cookie('__client', 'clerk.tinfoil.sh')), { url: 'https://clerk.tinfoil.sh/', name: '__client', value: '__client-value', path: '/', secure: true, httpOnly: true, sameSite: 'lax', expirationDate: YEAR });
  assert.equal(storableCookie(cookie('__client_uat', '.tinfoil.sh')).domain, '.tinfoil.sh');
  assert.equal(storableCookie(cookie('session_only', 'chat.tinfoil.sh', { expirationDate: undefined })), null);
  assert.equal(storableCookie(cookie('SID', '.google.com')), null);
  assert.equal(storableCookie(cookie('bad\nname', 'chat.tinfoil.sh')), null);
});

test('the saved sign-in is sealed by the OS protector, and a tampered or foreign file is discarded', async t => {
  const path = temp(t), store = new AccountStore(path, protector());
  assert.equal(await store.read(), null);
  await store.write(record());
  const file = readFileSync(path, 'utf8');
  assert.ok(!file.includes('__client-value') && !file.includes('user_test'), 'nothing is stored in plaintext');
  assert.deepEqual((await store.read()).binding, { user: 'user_test', session: 'sess_test' });
  // A record with any cookie outside Tinfoil's hosts is refused whole.
  assert.equal(savedAccount({ ...record(), cookies: [...record().cookies, { url: 'https://evil.test/', name: 'a', value: 'b', path: '/', secure: true, httpOnly: false, sameSite: 'lax', expirationDate: YEAR }] }), null);
  await assert.rejects(store.write({ ...record(), cookies: [] }), /Nothing to save/);
  writeFileSync(path, JSON.stringify({ format: 'tinfoil-workbench-account', version: 1, data: 'AAAA' }));
  assert.equal(await store.read(), null); assert.equal(existsSync(path), false, 'an unreadable file is deleted');
  await assert.rejects(new AccountStore(path, protector(false)).write(record()), /encryption is unavailable/);
  await store.write(record()); await store.clear(); assert.equal(existsSync(path), false);
});

function fakeElectron(pageValue = () => raw()) {
  const windows = [], partitions = []; let current;
  class Window extends EventEmitter {
    constructor(opts) { super(); this.opts = opts; this.dead = false; this.webContents = new EventEmitter(); this.webContents.getURL = () => this.url ?? '';
      this.webContents.isLoading = () => false; this.webContents.executeJavaScript = async source => { this.scripts.push(source); return pageValue(source); }; this.webContents.setWindowOpenHandler = () => {}; this.scripts = []; windows.push(this); }
    isDestroyed() { return this.dead; } async loadURL(url) { this.url = url; this.loadedWith = [...current.jar]; } show() { this.shown = true; } hide() {} focus() {} destroy() { this.dead = true; this.emit('closed'); }
  }
  const session = { fromPartition: (name, opts) => { partitions.push([name, opts]); const ses = new EventEmitter(); ses.jar = [];
    ses.setPermissionRequestHandler = () => {}; ses.setPermissionCheckHandler = () => {}; ses.webRequest = { onBeforeRequest: () => {} };
    ses.cookies = Object.assign(new EventEmitter(), { set: async c => { ses.jar.push(c); }, get: async () => ses.exported ?? [] });
    ses.closeAllConnections = async () => {}; ses.clearStorageData = async () => { ses.cleared = true; }; ses.clearCache = async () => {}; current = ses; return ses; } };
  return { BrowserWindow: Window, session, windows, partitions, get ses() { return current; } };
}

test('a restored sign-in loads its cookies into a new memory-only partition before the page, in a hidden window', async () => {
  let changes = 0; const e = fakeElectron(), w = new AccountWindow(e, () => {}, () => {}, () => { changes++; }), saved = savedAccount(record());
  assert.deepEqual(await w.restore(saved, { timeout: 200, interval: 5 }), raw());
  assert.equal(e.partitions[0][0].startsWith('persist:'), false);
  assert.equal(e.windows[0].opts.show, false); assert.equal(e.windows[0].shown, undefined);
  assert.deepEqual(e.windows[0].loadedWith, saved.cookies, 'cookies are set before the page loads');
  assert.match(e.windows[0].scripts[0], /"sess_test"/, 'the read is bound to the saved user and session');
  e.ses.exported = [cookie('__client', 'clerk.tinfoil.sh'), cookie('tracker', '.ads.example'), cookie('temp', 'chat.tinfoil.sh', { expirationDate: undefined })];
  assert.deepEqual((await w.cookies()).map(c => c.name), ['__client']);
  e.ses.cookies.emit('changed', {}, cookie('__client', 'clerk.tinfoil.sh'), 'explicit', false); e.ses.cookies.emit('changed', {}, cookie('ad', '.ads.example'), 'explicit', false);
  assert.equal(changes, 1, 'only a change to a Tinfoil cookie is reported');
  await w.clear({ end: false });
  assert.ok(!e.windows[0].scripts.some(s => s.includes('session.end')), 'quitting keeps the Clerk session');
  assert.equal(e.ses.cleared, true);
});

test('a page that never becomes ready restores nothing, so the saved sign-in can be retried', async () => {
  const e = fakeElectron(() => null), w = new AccountWindow(e);
  assert.equal(await w.restore(savedAccount(record()), { timeout: 30, interval: 5 }), null);
  await w.clear(); assert.ok(e.windows[0].scripts.some(s => s.includes('session.end')), 'signing out still ends the session');
});

function fixture({ saved = record(), restored = () => raw(), fetcher = async () => tokenResponse() } = {}) {
  let stored = saved ? savedAccount(saved) : null, clock = T0; const writes = [], clears = [], restores = [];
  const store = { read: async () => stored, write: async r => { writes.push(r); stored = savedAccount(r); }, clear: async () => { stored = null; clears.push(clock); } };
  const adapter = { login: async () => raw(), readSession: async () => raw(), identity: async () => ({ sessionUserId: 'user_test', sessionId: 'sess_test' }), manage: async () => {},
    restore: async s => { restores.push(s); return restored(); }, cookies: async () => [storableCookie(cookie('__client', 'clerk.tinfoil.sh'))], clear: async (options = {}) => { clears.push(options.end === false ? 'page-kept' : 'page-ended'); } };
  const account = new AccountSession(adapter, () => {}, { store, now: () => clock, fetcher, timing: { ...TIMING, persistDelay: 5 } });
  return { account, store, writes, clears, restores, get stored() { return stored; }, tick: ms => { clock += ms; } };
}

test('signing in saves the website session; quitting keeps it and the Clerk session', async () => {
  const f = fixture({ saved: null });
  await f.account.login();
  assert.equal(f.account.snapshot().status, 'signed-in'); assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0].binding, { user: 'user_test', session: 'sess_test' }); assert.equal(f.writes[0].cookies[0].name, '__client');
  await f.account.shutdown();
  assert.deepEqual(f.clears, ['page-kept']); assert.ok(f.stored, 'the saved sign-in survives quitting');
  assert.equal(f.writes.length, 2, 'the latest cookies are saved at quit');
});

test('rotated cookies are saved shortly after they change, once per burst', async () => {
  const f = fixture({ saved: null }); await f.account.login(); const before = f.writes.length;
  for (let i = 0; i < 5; i++) f.account.cookiesChanged();
  await new Promise(r => setTimeout(r, 40)); assert.equal(f.writes.length, before + 1);
  f.account.cookiesChanged(); await f.account.signOut(); await new Promise(r => setTimeout(r, 40));
  assert.equal(f.writes.length, before + 1, 'a save pending at sign-out is dropped'); assert.equal(f.stored, null);
});

test('a saved sign-in is restored at launch without a sign-in window, then checked for Chat access', async () => {
  const f = fixture(), states = [];
  f.account.onChange = s => states.push(s.status);
  assert.equal(await f.account.restore(), true);
  assert.equal(states[0], 'restoring'); assert.equal(f.account.snapshot().status, 'signed-in');
  assert.deepEqual(f.account.binding, { user: 'user_test', session: 'sess_test' });
  assert.equal(f.account.snapshot().entitlement, 'active'); assert.ok(f.writes.length >= 1);
  assert.equal((await f.account.getCredential()).key, 'inference-test-only');
});

test('a saved sign-in that ended or now belongs to another session is deleted, without ending any session', async () => {
  for (const restored of [() => ({ signedOut: true }), () => ({ changed: 'session' }), () => raw('user_test', 'sess_other'), () => raw('user_other', 'sess_test')]) {
    const f = fixture({ restored });
    assert.equal(await f.account.restore(), false);
    const s = f.account.snapshot();
    assert.equal(s.status, 'signed-out'); assert.match(s.message, /saved Tinfoil sign-in has ended/);
    assert.equal(f.stored, null); assert.ok(f.clears.includes('page-kept') && !f.clears.includes('page-ended'));
  }
});

test('offline at launch keeps the saved sign-in and retries it when Chat access is next needed', async () => {
  let online = false; const f = fixture({ restored: () => online ? raw() : null });
  assert.equal(await f.account.restore(), false);
  assert.equal(f.account.snapshot().status, 'expired'); assert.match(f.account.snapshot().message, /could not reach Tinfoil/); assert.ok(f.stored);
  online = true;
  assert.equal((await f.account.getCredential()).key, 'inference-test-only');
  assert.equal(f.account.snapshot().status, 'signed-in'); assert.equal(f.restores.length, 2);
  // Quitting while a restore is still pending keeps the saved sign-in too.
  const g = fixture({ restored: () => null }); await g.account.restore(); await g.account.shutdown(); assert.ok(g.stored); assert.deepEqual(g.clears, ['page-kept']);
});

test('turning staying signed in off deletes the saved session, and quitting then signs out', async () => {
  const f = fixture({ saved: null });
  await f.account.login(); await f.account.setRemember(false);
  assert.equal(f.stored, null);
  await f.account.shutdown(); assert.ok(f.clears.includes('page-ended'), 'quitting ends the session when not staying signed in');
  const g = fixture({ saved: null }); await g.account.setRemember(false); await g.account.login();
  assert.equal(g.writes.length, 0, 'nothing is saved while it is off'); assert.equal(await g.account.restore(), false);
  await g.account.setRemember(true); assert.equal(g.writes.length, 1, 'turning it on saves the current session');
});

test('signing out or an invalidated session deletes the saved sign-in', async () => {
  const f = fixture({ saved: null }); await f.account.login(); assert.ok(f.stored);
  await f.account.signOut(); assert.equal(f.stored, null); assert.ok(f.clears.includes('page-ended'));
  const g = fixture({ saved: null }); await g.account.login(); g.account.invalidate('Tinfoil rejected this session. Sign in again.');
  await new Promise(r => setImmediate(r)); assert.equal(g.stored, null);
  // A page that cannot end the session still deletes the saved one.
  const h = fixture({ saved: null }); await h.account.login(); h.account.adapter.clear = async () => { throw new Error('page gone'); };
  await assert.rejects(h.account.signOut(), /page gone/); assert.equal(h.stored, null);
});

test('without a store (Android) nothing is saved and quitting signs out as before', async () => {
  let cleared = 0;
  const account = new AccountSession({ login: async () => raw(), readSession: async () => raw(), identity: async () => ({ sessionUserId: 'user_test', sessionId: 'sess_test' }), clear: async () => { cleared++; } },
    () => {}, { now: () => T0, fetcher: async () => tokenResponse() });
  await account.login(); assert.equal(await account.restore(), false); assert.equal(await account.persist(true), false);
  await account.shutdown(); assert.equal(cleared, 1); assert.equal(account.snapshot().status, 'signed-out');
});

test('the preference is stored only when off, and the snapshot reports it', async () => {
  const w = newWorkspace();
  assert.equal('rememberAccount' in validateWorkspace(structuredClone(w)), false);
  assert.equal(validateWorkspace({ ...structuredClone(w), rememberAccount: false }).rememberAccount, false);
  assert.throws(() => validateWorkspace({ ...structuredClone(w), rememberAccount: true }), /sign-in preference/);
  let value = null; const vault = { read: async () => value, write: async v => { value = structuredClone(v); }, flush: async () => {} };
  const s = new WorkbenchService(vault, async () => ({}), () => {}); await s.initialize();
  assert.equal(s.snapshot().rememberAccount, true);
  assert.equal((await s.execute({ type: 'account.remember', enabled: false })).rememberAccount, false); assert.equal(value.rememberAccount, false);
  assert.equal((await s.execute({ type: 'account.remember', enabled: true })).rememberAccount, true); assert.equal('rememberAccount' in value, false);
  await s.shutdown();
});
