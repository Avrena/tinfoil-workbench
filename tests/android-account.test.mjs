import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { AccountSession } from '../desktop/account-session.mjs';
import { sessionScript, identityScript } from '../desktop/account-window.mjs';
import { CHAT_ORIGIN, CHAT_TOKEN_URL } from '../dist/core/account.js';
import { InputError } from '../dist/core/validation.js';
import { createAccountChannel, NativeAccountWindow, nativeFetcher, nativeAccountStore, savedSignIn, savedCookie, ACCOUNT_OPERATIONS, COOKIE_URLS } from '../mobile/account.mjs';
import { createCommandHandler, withPlatform, CHAT_UNAVAILABLE } from '../mobile/commands.mjs';
import { WorkbenchService } from '../desktop/service.mjs';

const tick = () => new Promise(r => setImmediate(r));
const until = async (ready, label) => { for (let i = 0; i < 5000 && !ready(); i++) await tick(); assert.ok(ready(), 'timed out waiting for ' + label); };

// The native end of the private channel, scripted per operation.
function nativeEnd(handlers = {}) {
  const channel = new MessageChannel(), requests = [];
  channel.port2.onmessage = async ({ data }) => {
    const request = JSON.parse(data); requests.push(request);
    const handler = handlers[request.op];
    if (!handler) return;
    try { channel.port2.postMessage(JSON.stringify({ id: request.id, ok: true, value: await handler(request.args) })); }
    catch (error) { channel.port2.postMessage(JSON.stringify({ id: request.id, ok: false, error: error.message })); }
  };
  return { port: channel.port1, requests, emit: event => channel.port2.postMessage(JSON.stringify(event)), close: () => { channel.port1.close(); channel.port2.close(); } };
}

test('the account channel offers only fixed operations and matches replies to requests', async t => {
  const native = nativeEnd({ hide: () => true, identity: args => ({ sessionUserId: args.user, sessionId: args.session }), clear: () => { throw new Error('x'.repeat(400)); } });
  t.after(native.close);
  const channel = createAccountChannel(native.port, { timeout: 2000 });
  assert.deepEqual([...ACCOUNT_OPERATIONS], ['show', 'hide', 'session', 'identity', 'manage', 'clear', 'exchange', 'cookies', 'restore', 'load', 'save', 'forget']);
  await assert.rejects(channel.call('evaluate', { script: 'document.cookie' }), TypeError);
  await assert.rejects(channel.call('fetch', { url: 'https://attacker.invalid' }), TypeError);
  assert.equal(native.requests.length, 0);
  const [a, b] = await Promise.all([channel.call('hide'), channel.call('identity', { user: 'user_a', session: 'sess_a' })]);
  assert.equal(a, true); assert.deepEqual(b, { sessionUserId: 'user_a', sessionId: 'sess_a' });
  const error = await channel.call('clear').catch(e => e);
  assert.ok(error instanceof InputError); assert.equal(error.message.length, 300);
});

test('an unanswered operation times out, and its late reply is ignored', async t => {
  const native = nativeEnd();
  t.after(native.close);
  const channel = createAccountChannel(native.port, { timeout: 30 });
  await assert.rejects(channel.call('show'), { message: 'Tinfoil sign-in did not respond. Reopen it and try again.' });
  native.emit({ id: 1, ok: true, value: 'late' });
  native.emit('not json'); native.emit(null);
  await tick();
});

test('sign-in shows the page and is accepted only when two session reads a second apart agree', async t => {
  const reads = [null, { signedOut: true }, value('sess_a'), value('sess_b'), value('sess_b')];
  const native = nativeEnd({ show: () => true, hide: () => true, session: () => reads.shift() ?? value('sess_b') });
  t.after(native.close);
  const page = new NativeAccountWindow(createAccountChannel(native.port, { timeout: 2000 }), () => {}, () => {}, { interval: 1 });
  const result = await page.login();
  assert.equal(result.sessionId, 'sess_b');
  assert.deepEqual(native.requests.map(r => r.op), ['show', 'session', 'session', 'session', 'session', 'session', 'hide']);
  assert.deepEqual(native.requests[1].args, { force: false, user: null, session: null });
});

function value(sessionId, userId = 'user_test') {
  return { sessionUserId: userId, sessionId, bearer: 'identity-secret', profile: { id: userId, name: 'Example User', email: 'example@example.invalid', emailVerified: true, subscriptionStatus: 'active', subscriptionExpiresAt: null } };
}

test('closing Tinfoil\'s page cancels sign-in, a crashed page invalidates it, and a refused host is reported', async t => {
  const native = nativeEnd({ show: () => true, session: () => ({ signedOut: true }) });
  t.after(native.close);
  const invalid = [], blocked = [];
  const page = new NativeAccountWindow(createAccountChannel(native.port, { timeout: 2000 }), m => invalid.push(m), h => blocked.push(h), { interval: 5 });
  const cancelled = assert.rejects(page.login(), { message: 'Sign-in was cancelled.' });
  await until(() => native.requests.some(r => r.op === 'session'), 'a session read');
  native.emit({ event: 'blocked', host: 'accounts.google.com' });
  native.emit({ event: 'closed' });
  await cancelled;
  assert.deepEqual(blocked, ['accounts.google.com']);
  const gone = assert.rejects(page.login(), { message: 'Sign-in was cancelled.' });
  await until(() => native.requests.filter(r => r.op === 'show').length === 2, 'a second show');
  native.emit({ event: 'gone' });
  await gone;
  assert.deepEqual(invalid, ['The Tinfoil sign-in page stopped. Sign in again.']);
});

test('session reads keep the desktop rules: a changed or ended session invalidates, a page that is not ready does not', async t => {
  const answers = [];
  const native = nativeEnd({ session: () => answers.shift(), identity: () => answers.shift() });
  t.after(native.close);
  const invalid = [];
  const page = new NativeAccountWindow(createAccountChannel(native.port, { timeout: 2000 }), m => invalid.push(m));
  const expected = { user: 'user_test', session: 'sess_test' };
  answers.push(null);
  await assert.rejects(page.readSession(false, expected), { message: 'The Tinfoil sign-in page is not ready. Try again in a moment.' });
  assert.equal(invalid.length, 0);
  answers.push({ changed: 'session' });
  await assert.rejects(page.readSession(true, expected), { message: 'The website session changed. Reconnect it in Account.' });
  assert.deepEqual(native.requests.at(-1).args, { force: true, user: 'user_test', session: 'sess_test' });
  answers.push({ signedOut: true });
  await assert.rejects(page.identity(expected), { message: 'Your Tinfoil sign-in expired. Sign in again.' });
  answers.push({ ...value('sess_test'), bearer: '' });
  await assert.rejects(page.readSession(false, expected), { message: 'Your Tinfoil sign-in expired. Sign in again.' });
  assert.equal(invalid.length, 3);
});

test('clearing cancels a waiting sign-in and completes even when native cleanup fails', async t => {
  const native = nativeEnd({ show: () => true, session: () => ({ signedOut: true }), clear: () => { throw new Error('gone'); } });
  t.after(native.close);
  const page = new NativeAccountWindow(createAccountChannel(native.port, { timeout: 1000 }), () => {}, () => {}, { interval: 5 });
  const waiting = assert.rejects(page.login(), { message: 'Sign-in was cancelled.' });
  await until(() => native.requests.some(r => r.op === 'session'), 'a session read');
  await page.clear();
  await waiting;
  assert.ok(native.requests.some(r => r.op === 'clear'));
});

test('the exchange runs natively for the fixed URL only, and returns the Date and Retry-After headers', async t => {
  const native = nativeEnd({ exchange: args => ({ status: 429, date: 'Mon, 28 Sep 2026 12:00:00 GMT', retryAfter: '120', contentLength: '20', body: JSON.stringify({ code: 'x', bearer: args.bearer }) }) });
  t.after(native.close);
  const fetcher = nativeFetcher(createAccountChannel(native.port, { timeout: 2000 }));
  await assert.rejects(fetcher('https://attacker.invalid/', { headers: { Authorization: 'Bearer x' } }), TypeError);
  await assert.rejects(fetcher(CHAT_TOKEN_URL, { method: 'POST', headers: { Authorization: 'Bearer x' } }), TypeError);
  await assert.rejects(fetcher(CHAT_TOKEN_URL, { headers: {} }), TypeError);
  const response = await fetcher(CHAT_TOKEN_URL, { method: 'GET', headers: { Authorization: 'Bearer identity-secret', Accept: 'application/json' }, redirect: 'error', cache: 'no-store' });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('date'), 'Mon, 28 Sep 2026 12:00:00 GMT');
  assert.equal(response.headers.get('retry-after'), '120');
  assert.equal(response.headers.get('content-length'), '20');
  assert.equal((await response.json()).bearer, 'identity-secret');
  assert.deepEqual(native.requests.at(-1), { id: native.requests.at(-1).id, op: 'exchange', args: { bearer: 'identity-secret' } });
  assert.equal(native.requests.filter(r => r.op === 'exchange').length, 1);
});

test('an aborted exchange rejects at once, and a null-body status has no body', async t => {
  let release;
  const native = nativeEnd({ exchange: () => new Promise(r => { release = r; }) });
  t.after(native.close);
  const fetcher = nativeFetcher(createAccountChannel(native.port, { timeout: 2000 }));
  const before = new AbortController(); before.abort();
  await assert.rejects(fetcher(CHAT_TOKEN_URL, { headers: { Authorization: 'Bearer x' }, signal: before.signal }), { name: 'AbortError' });
  const during = new AbortController();
  const pending = fetcher(CHAT_TOKEN_URL, { headers: { Authorization: 'Bearer x' }, signal: during.signal });
  await until(() => release, 'the exchange');
  during.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  release({ status: 200, body: '{}' });
  const empty = nativeEnd({ exchange: () => ({ status: 204, body: 'ignored' }) });
  t.after(empty.close);
  assert.equal(await (await nativeFetcher(createAccountChannel(empty.port, { timeout: 2000 }))(CHAT_TOKEN_URL, { headers: { Authorization: 'Bearer x' } })).text(), '');
});

test('AccountSession signs in and renews over the channel, measuring key lifetimes on the server clock', async t => {
  let exchanges = 0;
  const serverNow = Date.parse('2026-09-28T12:00:00Z');
  const native = nativeEnd({
    show: () => true, hide: () => true, clear: () => true,
    session: args => value('sess_test'), identity: args => ({ sessionUserId: 'user_test', sessionId: 'sess_test' }),
    // The server clock is an hour behind this device; the key lives 15 minutes from the server's Date.
    exchange: () => ({ status: 200, date: new Date(serverNow).toUTCString(), body: JSON.stringify({ key: 'key-' + (++exchanges), expires_at: new Date(serverNow + 15 * 60_000).toISOString() }) }),
  });
  t.after(native.close);
  let clock = serverNow + 3_600_000;
  const channel = createAccountChannel(native.port, { timeout: 2000 });
  const session = new AccountSession(new NativeAccountWindow(channel, () => {}, () => {}, { interval: 1 }), () => {}, { fetcher: nativeFetcher(channel), now: () => clock });
  await session.login();
  assert.equal(session.snapshot().status, 'signed-in'); assert.equal(session.snapshot().entitlement, 'active');
  assert.equal((await session.getCredential()).key, 'key-1');
  clock += 13 * 60_000;
  assert.equal((await session.getCredential()).key, 'key-1');
  clock += 60_000;
  assert.equal((await session.getCredential()).key, 'key-2');
  assert.ok(native.requests.filter(r => r.op === 'identity').length >= 2, 'the identity is read again after each exchange');
  await session.signOut();
  assert.equal(session.snapshot().status, 'signed-out');
  assert.ok(native.requests.some(r => r.op === 'clear'));
});

// ---- Staying signed in --------------------------------------------------------------------------

const CLIENT = { url: 'https://clerk.tinfoil.sh/', cookie: '__client=client-secret; domain=clerk.tinfoil.sh; path=/; expires=Wed, 30 Sep 2027 12:00:00 GMT; secure; httponly; samesite=lax' };
const UAT = { url: 'https://chat.tinfoil.sh/', cookie: '__client_uat=1790000000; domain=.tinfoil.sh; path=/; max-age=31536000; secure; samesite=lax' };
const record = (patch = {}) => ({ version: 1, binding: { user: 'user_test', session: 'sess_test' }, profile: { id: 'user_test', name: 'Example User' }, cookies: [CLIENT, UAT], savedAt: 1, ...patch });

test('a saved sign-in keeps only persistent cookies of Tinfoil\'s sign-in hosts, and anything unexpected discards all of it', () => {
  assert.deepEqual([...COOKIE_URLS], ['https://chat.tinfoil.sh/', 'https://clerk.tinfoil.sh/', 'https://accounts.tinfoil.sh/']);
  assert.deepEqual(savedCookie(CLIENT), CLIENT);
  for (const bad of [{ ...CLIENT, url: 'https://attacker.invalid/' }, { ...CLIENT, url: 'http://clerk.tinfoil.sh/' }, { ...CLIENT, cookie: '__session=jwt; path=/; secure' },
    { ...CLIENT, cookie: 'a=b; expires=x\nSet-Cookie: c=d' }, { ...CLIENT, cookie: '=value; max-age=1' }, { ...CLIENT, cookie: 'x'.repeat(8193) + '=1; max-age=1' }])
    assert.equal(savedCookie(bad), null, JSON.stringify(bad).slice(0, 80));
  assert.deepEqual(savedSignIn(record()), record());
  assert.equal(savedSignIn(record({ cookies: [CLIENT, { ...UAT, url: 'https://tinfoil.sh.attacker.invalid/' }] })), null);
  assert.equal(savedSignIn(record({ binding: { user: 'user_test', session: 'not-a-session' } })), null);
  assert.equal(savedSignIn(record({ cookies: [] })), null);
  assert.equal(savedSignIn(record({ version: 2 })), null);
});

test('the store writes a validated record through the channel, and a record that fails validation is forgotten when read', async t => {
  let sealed = null;
  const native = nativeEnd({ save: args => { sealed = args.data; return true; }, load: () => sealed, forget: () => { sealed = null; return true; } });
  t.after(native.close);
  const store = nativeAccountStore(createAccountChannel(native.port, { timeout: 2000 }));
  assert.equal(await store.read(), null);
  await store.write({ ...record(), extra: 'dropped' });
  assert.deepEqual(JSON.parse(sealed), record());
  assert.deepEqual(await store.read(), record());
  await assert.rejects(store.write(record({ cookies: [] })), /Nothing to save/);
  sealed = JSON.stringify(record({ binding: { user: 'user_test', session: 'x' } }));
  assert.equal(await store.read(), null); assert.equal(sealed, null, 'an invalid record is deleted');
  sealed = '{not json'; assert.equal(await store.read(), null); assert.equal(sealed, null);
  await store.write(record()); await store.clear(); assert.equal(sealed, null);
});

test('cookies are read from the page, and a restore opens it hidden with the saved cookies and reads the bound session', async t => {
  const reads = [];
  const native = nativeEnd({ cookies: () => [CLIENT, UAT, { url: 'https://attacker.invalid/', cookie: 'x=1; max-age=1' }, { ...CLIENT, cookie: '__session=jwt; path=/' }],
    restore: () => true, session: args => { reads.push(args); return reads.length < 3 ? null : value('sess_test'); }, clear: () => true });
  t.after(native.close);
  const page = new NativeAccountWindow(createAccountChannel(native.port, { timeout: 2000 }), () => {}, () => {}, { interval: 1 });
  assert.deepEqual(await page.cookies(), [CLIENT, UAT]);
  assert.deepEqual(await page.restore(record()), value('sess_test'));
  assert.deepEqual(native.requests.find(r => r.op === 'restore').args, { cookies: [CLIENT, UAT] });
  assert.ok(!native.requests.some(r => r.op === 'show'), 'Tinfoil\'s page is never shown for a restore');
  assert.deepEqual(reads.at(-1), { force: false, user: 'user_test', session: 'sess_test' });
  await page.clear({ end: false });
  assert.deepEqual(native.requests.at(-1), { id: native.requests.at(-1).id, op: 'clear', args: { end: false } });
});

test('a restore that cannot reach Tinfoil returns nothing, so the saved sign-in is kept and tried again', async t => {
  const native = nativeEnd({ restore: () => true, session: () => null });
  t.after(native.close);
  const page = new NativeAccountWindow(createAccountChannel(native.port, { timeout: 2000 }), () => {}, () => {}, { interval: 1 });
  assert.equal(await page.restore(record(), { timeout: 30 }), null);
  const refused = nativeEnd({ restore: () => { throw new Error('The saved sign-in was refused.'); } });
  t.after(refused.close);
  assert.equal(await new NativeAccountWindow(createAccountChannel(refused.port, { timeout: 2000 }), () => {}, () => {}).restore(record()), null);
});

test('staying signed in: a sign-in is saved, a relaunch restores it without Tinfoil\'s page, and one bound elsewhere is discarded', async t => {
  let sealed = null, session = 'sess_test';
  const serverNow = Date.parse('2026-09-30T12:00:00Z');
  const handlers = {
    show: () => true, hide: () => true, clear: () => true, restore: () => true, cookies: () => [CLIENT, UAT],
    session: () => value(session), identity: () => ({ sessionUserId: 'user_test', sessionId: session }),
    exchange: () => ({ status: 200, date: new Date(serverNow).toUTCString(), body: JSON.stringify({ key: 'key', expires_at: new Date(serverNow + 15 * 60_000).toISOString() }) }),
    save: args => { sealed = args.data; return true; }, load: () => sealed, forget: () => { sealed = null; return true; },
  };
  const launch = () => {
    const native = nativeEnd(handlers); t.after(native.close);
    const channel = createAccountChannel(native.port, { timeout: 2000 });
    let account;
    const page = new NativeAccountWindow(channel, () => {}, () => {}, { interval: 1, onCookies: () => account?.cookiesChanged() });
    account = new AccountSession(page, () => {}, { fetcher: nativeFetcher(channel), store: nativeAccountStore(channel), now: () => serverNow });
    return { native, account };
  };
  const first = launch();
  await first.account.setRemember(true); await first.account.login();
  assert.deepEqual(JSON.parse(sealed).cookies, [CLIENT, UAT]); assert.deepEqual(JSON.parse(sealed).binding, { user: 'user_test', session: 'sess_test' });
  const second = launch();
  await second.account.setRemember(true);
  assert.equal(await second.account.restore(), true);
  assert.equal(second.account.snapshot().status, 'signed-in');
  assert.ok(!second.native.requests.some(r => r.op === 'show'), 'no sign-in page after a relaunch');
  assert.equal((await second.account.getCredential()).key, 'key');
  session = 'sess_other';
  const third = launch();
  await third.account.setRemember(true);
  assert.equal(await third.account.restore(), false);
  assert.equal(third.account.snapshot().status, 'signed-out'); assert.equal(sealed, null, 'a sign-in bound to another session is deleted');
  assert.deepEqual(third.native.requests.find(r => r.op === 'clear').args, { end: false });
});

test('turning staying signed in off deletes the saved sign-in, and signing out ends the session and deletes it', async t => {
  let sealed = null;
  const serverNow = Date.parse('2026-09-30T12:00:00Z');
  const native = nativeEnd({ show: () => true, hide: () => true, clear: () => true, cookies: () => [CLIENT], session: () => value('sess_test'),
    identity: () => ({ sessionUserId: 'user_test', sessionId: 'sess_test' }), save: args => { sealed = args.data; return true; }, load: () => sealed, forget: () => { sealed = null; return true; },
    exchange: () => ({ status: 200, date: new Date(serverNow).toUTCString(), body: JSON.stringify({ key: 'key', expires_at: new Date(serverNow + 15 * 60_000).toISOString() }) }) });
  t.after(native.close);
  const channel = createAccountChannel(native.port, { timeout: 2000 });
  const account = new AccountSession(new NativeAccountWindow(channel, () => {}, () => {}, { interval: 1 }), () => {}, { fetcher: nativeFetcher(channel), store: nativeAccountStore(channel), now: () => serverNow });
  await account.setRemember(true); await account.login(); assert.ok(sealed);
  await account.setRemember(false); assert.equal(sealed, null);
  await account.setRemember(true); assert.ok(sealed, 'turning it on again saves the current sign-in');
  await account.signOut(); assert.equal(sealed, null);
  assert.deepEqual(native.requests.filter(r => r.op === 'clear').at(-1).args, { end: true });
});

test('the saved sign-in is sealed natively with a Keystore key in no-backup storage, and a reload keeps its Clerk session', () => {
  assert.match(java, /SAVED_KEY = "tinfoil-workbench-account-v1"/);
  assert.match(java, /getNoBackupFilesDir\(\), SAVED_FILE/);
  assert.match(java, /KeyGenerator\.getInstance\(KeyProperties\.KEY_ALGORITHM_AES, "AndroidKeyStore"\)/);
  assert.match(java, /Cipher\.getInstance\("AES\/GCM\/NoPadding"\)/);
  assert.match(java, /setRandomizedEncryptionRequired\(true\)/);
  assert.match(java, /COOKIE_URLS = List\.of\("https:\/\/chat\.tinfoil\.sh\/", "https:\/\/clerk\.tinfoil\.sh\/", "https:\/\/accounts\.tinfoil\.sh\/"\)/);
  assert.match(java, /if \(savedFile\(\)\.isFile\(\)\) drop\(\);\s+else clear\(null\);/);
  // Each saved sign-in is restored into a fresh profile; earlier profiles are still deleted at every launch.
  assert.match(java, /static void deleteStoredSessions\(\)/);
});

test('Android turns staying signed in on and off through the account session', async t => {
  const account = { ...fakeAccount(), remembered: [], setRemember: async enabled => { account.remembered.push(enabled); } };
  const { s, command } = await commandSetup(t, account);
  await command({ type: 'account.remember', enabled: false });
  assert.equal(s.workspace.rememberAccount, false); assert.deepEqual(account.remembered, [false]);
  await command({ type: 'account.remember', enabled: true });
  assert.equal(s.workspace.rememberAccount, undefined); assert.deepEqual(account.remembered, [false, true]);
});

// ---- The fixed page scripts in WorkbenchAccount.java --------------------------------------------

const java = readFileSync(new URL('../android/app/src/main/java/org/avrena/tinfoil/workbench/WorkbenchAccount.java', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
/** A Java text block, with its incidental indentation removed as javac does. */
function block(name) {
  const match = java.match(new RegExp(`static final String ${name} = """\\n([\\s\\S]*?)""";`));
  assert.ok(match, name);
  const lines = match[1].split('\n');
  const indent = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^ */)[0].length));
  return lines.map(l => l.slice(indent).replace(/\s+$/, '')).join('\n');
}
const fill = (script, values) => Object.entries(values).reduce((s, [k, v]) => s.split(`%${k}%`).join(v), script);
const quote = v => v === null ? 'null' : JSON.stringify(v);
async function runAsync(name, ctx, values) {
  const slot = '__workbenchAccount_test';
  assert.equal(vm.runInNewContext(fill(block(name), { SLOT: JSON.stringify(slot), ...values }), ctx), true);
  const collect = () => vm.runInNewContext(fill(block('COLLECT_SCRIPT'), { SLOT: JSON.stringify(slot) }), ctx);
  for (let i = 0; i < 50; i++) { const v = collect(); if (v !== null) { assert.equal(collect(), null, 'the result is taken once'); return JSON.parse(v); } await tick(); }
  assert.fail('no result');
}
const clerkUser = (id = 'user_test') => ({ id, firstName: 'Example', lastName: 'User', primaryEmailAddress: { emailAddress: 'example@example.invalid', verification: { status: 'verified' } }, publicMetadata: { chat_subscription_status: 'active' } });

test('the Android session script matches the desktop script and returns its result through the page', async () => {
  for (const [force, expected] of [[false, null], [true, { user: 'user_test', session: 'sess_test' }]]) {
    const android = fill(block('SESSION_SCRIPT'), { FORCE: String(force), USER: quote(expected?.user ?? null), SESSION: quote(expected?.session ?? null) });
    const inner = android.slice(android.indexOf('(async()=>{'), android.indexOf('})().then(') + 4);
    assert.equal(inner, sessionScript(force, expected), 'the async body is the desktop session script');
  }
  let reloads = 0; const calls = [];
  const user = { ...clerkUser(), reload: async () => { reloads++; } };
  const ctx = { location: { origin: CHAT_ORIGIN }, window: { Clerk: { loaded: true, user, session: { id: 'sess_test', status: 'active', user, getToken: async o => { calls.push(o); return 'identity-secret'; } } } } };
  const ok = await runAsync('SESSION_SCRIPT', ctx, { FORCE: 'true', USER: quote('user_test'), SESSION: quote('sess_test') });
  assert.equal(ok.value.bearer, 'identity-secret'); assert.equal(ok.value.sessionId, 'sess_test'); assert.equal(ok.value.profile.name, 'Example User');
  assert.equal(reloads, 1); assert.equal(calls[0].skipCache, true);
  assert.deepEqual((await runAsync('SESSION_SCRIPT', ctx, { FORCE: 'false', USER: quote('user_other'), SESSION: 'null' })).value, { changed: 'user' });
  assert.deepEqual((await runAsync('SESSION_SCRIPT', ctx, { FORCE: 'false', USER: 'null', SESSION: quote('sess_other') })).value, { changed: 'session' });
  ctx.window.Clerk.session.getToken = async () => { throw new Error('offline'); };
  assert.deepEqual(await runAsync('SESSION_SCRIPT', ctx, { FORCE: 'false', USER: 'null', SESSION: 'null' }), { failed: true });
  ctx.location.origin = 'https://attacker.invalid';
  assert.deepEqual((await runAsync('SESSION_SCRIPT', ctx, { FORCE: 'false', USER: 'null', SESSION: 'null' })).value, null);
  ctx.location.origin = CHAT_ORIGIN; ctx.window.Clerk = { loaded: true, user: null, session: null };
  assert.deepEqual((await runAsync('SESSION_SCRIPT', ctx, { FORCE: 'false', USER: 'null', SESSION: 'null' })).value, { signedOut: true });
});

test('the Android identity, profile and sign-out scripts match desktop and act only on the bound session', async () => {
  const expected = { user: 'user_test', session: 'sess_test' };
  const identity = fill(block('IDENTITY_SCRIPT'), { USER: quote(expected.user), SESSION: quote(expected.session) });
  assert.equal(identity, identityScript(expected));
  let opened = 0, ended = 0;
  const user = clerkUser();
  const ctx = { location: { origin: CHAT_ORIGIN }, window: { Clerk: { loaded: true, user, session: { id: 'sess_test', user, end: async () => { ended++; } }, openUserProfile: () => { opened++; } } } };
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInNewContext(identity, ctx))), { sessionUserId: 'user_test', sessionId: 'sess_test' });
  assert.equal(vm.runInNewContext(fill(block('MANAGE_SCRIPT'), { USER: quote('user_other'), SESSION: quote('sess_test') }), ctx), false);
  assert.equal(vm.runInNewContext(fill(block('MANAGE_SCRIPT'), { USER: quote('user_test'), SESSION: quote('sess_test') }), ctx), true);
  assert.equal(opened, 1);
  assert.deepEqual(await runAsync('SIGN_OUT_SCRIPT', ctx, {}), { value: true });
  assert.equal(ended, 1);
  ctx.location.origin = 'https://attacker.invalid';
  assert.equal(vm.runInNewContext(identity, ctx), null);
  await runAsync('SIGN_OUT_SCRIPT', ctx, {});
  assert.equal(ended, 1, 'another origin is not signed out');
});

test('Tinfoil\'s page may load only Tinfoil\'s sign-in hosts, and credentials never return through a plugin result', () => {
  const hosts = java.match(/PAGE_HOSTS = Set\.of\(([^)]*)\)/)[1].split(',').map(s => s.trim().replace(/"/g, ''));
  assert.deepEqual(hosts.sort(), ['accounts.tinfoil.sh', 'chat.tinfoil.sh', 'clerk.tinfoil.sh']);
  assert.ok(!/google|apple|github|microsoft/i.test(hosts.join()));
  assert.match(java, /TOKEN_URL = "https:\/\/api\.tinfoil\.sh\/api\/chat\/token"/);
  assert.match(java, /setInstanceFollowRedirects\(false\)/);
  assert.ok(!/addJavascriptInterface|addWebMessageListener|addDocumentStartJavaScript/.test(java), 'Tinfoil\'s page has no bridge');
  const bridge = readFileSync(new URL('../mobile/bridge.mjs', import.meta.url), 'utf8');
  assert.match(bridge, /event\.source !== null/); assert.match(bridge, /stopImmediatePropagation/);
  assert.match(bridge, /worker\.postMessage\(\{ kind: 'account', port \}, port \? \[port\] : \[\]\)/);
  // Requested after the app-event listeners: a Back press right after launch must not wait behind this call.
  assert.ok(bridge.indexOf('Workbench.accountChannel()') > bridge.indexOf("Workbench.addListener('backButton'"));
});

// ---- Commands -----------------------------------------------------------------------------------

async function commandSetup(t, account) {
  let stored = null;
  const vault = { read: async () => structuredClone(stored), write: async v => { stored = structuredClone(v); }, flush: async () => {} };
  const s = new WorkbenchService(vault, async () => { throw new Error('No provider expected'); }, () => {}, null, { account });
  await s.initialize(); t.after(() => s.shutdown());
  const native = { answers: [], confirms: [], async confirm(o) { native.confirms.push(o); return { confirmed: native.answers.shift() ?? false }; } };
  return { s, native, command: createCommandHandler({ service: s, native, account, uuid: () => 'uuid' }) };
}
function fakeAccount() {
  const calls = [];
  let state = { status: 'signed-out', profile: null, entitlement: 'unknown', usage: null, checkedAt: null, tokenExpiresAt: null, message: null };
  return { calls, snapshot: () => structuredClone(state), set: v => { state = { ...state, ...v }; },
    login: async () => { calls.push('login'); state = { ...state, status: 'signed-in', profile: { id: 'user_test', name: 'Example User' } }; },
    signOut: async () => { calls.push('signOut'); state = { ...state, status: 'signed-out', profile: null }; },
    refresh: async () => { calls.push('refresh'); }, manage: async () => { calls.push('manage'); },
    invalidate: m => { calls.push('invalidate:' + m); }, getCredential: async () => ({ key: 'key', owner: 'user_test' }), resume: () => {} };
}

test('with Tinfoil sign-in available, Android runs the desktop account commands and keeps the native confirmations', async t => {
  const account = fakeAccount();
  const { s, native, command } = await commandSetup(t, account);
  const { snapshot } = await command({ type: 'account.login' });
  assert.equal(snapshot.chatAvailable, true); assert.equal(snapshot.platform, 'android');
  await until(() => account.calls.includes('login'), 'sign-in');
  assert.equal(s.workspace.connectionMode, 'chat-account');
  await assert.rejects(command({ type: 'account.login' }), { message: 'Sign out before connecting another account.' });
  await command({ type: 'account.refresh' }); await command({ type: 'account.manage' });
  await command({ type: 'account.signout' });
  assert.equal(native.confirms.at(-1).title, 'Sign out of Tinfoil Chat?');
  assert.ok(!account.calls.includes('signOut'), 'declining keeps the account signed in');
  native.answers.push(true);
  await command({ type: 'account.signout' });
  assert.deepEqual(account.calls, ['login', 'refresh', 'manage', 'signOut']);
  await command({ type: 'connection.mode', mode: 'api-key' });
  await command({ type: 'connection.mode', mode: 'chat-account' });
  assert.equal(s.workspace.connectionMode, 'chat-account');
});

test('without it, Android refuses the account commands and Chat mode, and says why', async t => {
  const { command } = await commandSetup(t, null);
  for (const type of ['account.login', 'account.cancel', 'account.refresh', 'account.manage', 'account.signout', 'account.remember'])
    await assert.rejects(command({ type }), { message: CHAT_UNAVAILABLE });
  await assert.rejects(command({ type: 'connection.mode', mode: 'chat-account' }), { message: CHAT_UNAVAILABLE });
  assert.equal(withPlatform({ a: 1 }).chatAvailable, false);
  assert.match(CHAT_UNAVAILABLE, /newer Android System WebView/);
});
