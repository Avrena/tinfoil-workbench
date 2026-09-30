import { InputError } from '../dist/core/validation.js';
import { CHAT_TOKEN_URL } from '../dist/core/account.js';

/** Host-worker side of Tinfoil Chat sign-in on Android (docs/ANDROID-ACCOUNT.md). Native code posts a
 * message port at page start and mobile/bridge.mjs hands it to this worker unread, so the Workbench page
 * never holds it afterwards. Only fixed operations exist: showing and hiding Tinfoil's page, the session,
 * identity and profile scripts, sign-out, the Chat key exchange, and for staying signed in, reading and
 * restoring the page's cookies and loading, saving and forgetting the sealed saved sign-in. AccountSession runs
 * here unchanged. */
export const ACCOUNT_OPERATIONS = Object.freeze(['show', 'hide', 'session', 'identity', 'manage', 'clear', 'exchange', 'cookies', 'restore', 'load', 'save', 'forget']);
/** The sign-in hosts whose cookies a saved sign-in keeps; WorkbenchAccount.java reads and restores only these. */
export const COOKIE_URLS = Object.freeze(['https://chat.tinfoil.sh/', 'https://clerk.tinfoil.sh/', 'https://accounts.tinfoil.sh/']);
const COOKIE = /^[\x21-\x7e][\x20-\x7e]{0,8191}$/, MAX_SAVED = 256 * 1024;
const ids = binding => typeof binding?.user === 'string' && /^user_[A-Za-z0-9_-]{1,190}$/.test(binding.user)
  && typeof binding?.session === 'string' && /^sess_[A-Za-z0-9]{1,190}$/.test(binding.session);

/** A cookie as WebView reports it with its attributes (CookieManagerCompat.getCookieInfo). Only persistent ones are
 * kept, as a browser keeps them across a restart. */
export function savedCookie(c) {
  if (!c || typeof c !== 'object' || !COOKIE_URLS.includes(c.url) || typeof c.cookie !== 'string' || !COOKIE.test(c.cookie)) return null;
  const [pair, ...attributes] = c.cookie.split(';').map(part => part.trim());
  if (pair.indexOf('=') < 1 || !attributes.some(a => /^(expires|max-age)=/i.test(a))) return null;
  return { url: c.url, cookie: c.cookie };
}

/** Validates a saved sign-in before any of it is used; anything unexpected discards the whole record. */
export function savedSignIn(value) {
  if (!value || typeof value !== 'object' || value.version !== 1 || !ids(value.binding) || !Array.isArray(value.cookies) || value.cookies.length > 100) return null;
  const cookies = [];
  for (const c of value.cookies) { const kept = savedCookie(c); if (!kept) return null; cookies.push(kept); }
  return cookies.length ? { version: 1, binding: { user: value.binding.user, session: value.binding.session }, profile: value.profile ?? null, cookies,
    savedAt: Number.isFinite(value.savedAt) ? value.savedAt : 0 } : null;
}

/** AccountSession's store on Android. Native code seals the record with a key that Android Keystore holds and never
 * releases, and keeps it in the app's no-backup storage; this worker only validates what it saves and what it reads. */
export function nativeAccountStore(channel) {
  return {
    async read() {
      const data = await channel.call('load');
      if (data === null || data === undefined) return null;
      let record = null;
      try { record = typeof data === 'string' ? savedSignIn(JSON.parse(data)) : null; } catch { record = null; }
      if (!record) { await channel.call('forget').catch(() => {}); return null; }
      return record;
    },
    async write(record) {
      const value = savedSignIn({ ...record, version: 1 });
      if (!value) throw new Error('Nothing to save.');
      const data = JSON.stringify(value);
      if (data.length > MAX_SAVED) throw new Error('The saved sign-in exceeds its size limit.');
      await channel.call('save', { data });
    },
    clear() { return channel.call('forget'); },
  };
}
const NOT_RESPONDING = 'Tinfoil sign-in did not respond. Reopen it and try again.';

export function createAccountChannel(port, { timeout = 20_000 } = {}) {
  const pending = new Map(), listeners = new Set();
  let next = 0;
  port.onmessage = ({ data }) => {
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (!message || typeof message !== 'object') return;
    if (typeof message.event === 'string') { for (const listener of listeners) listener(message); return; }
    const call = pending.get(message.id);
    if (!call) return; // a reply after its timeout
    pending.delete(message.id); clearTimeout(call.timer);
    if (message.ok === true) call.resolve(message.value ?? null);
    else call.reject(new InputError(typeof message.error === 'string' && message.error ? message.error.slice(0, 300) : NOT_RESPONDING));
  };
  return {
    call(op, args = {}) {
      if (!ACCOUNT_OPERATIONS.includes(op)) return Promise.reject(new TypeError('Unsupported account operation.'));
      const id = ++next;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new InputError(NOT_RESPONDING)); }, timeout);
        pending.set(id, { resolve, reject, timer });
        port.postMessage(JSON.stringify({ id, op, args }));
      });
    },
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

/** The AccountSession adapter: the same interface and rules as desktop/account-window.mjs, with Tinfoil's
 * page in native code. `expected` is the {user, session} pair bound at sign-in. */
export class NativeAccountWindow {
  constructor(channel, onInvalid = () => {}, onBlocked = () => {}, { interval = 1000, deadline = 600_000, onCookies = () => {} } = {}) {
    Object.assign(this, { channel, onInvalid, onBlocked, interval, deadline, onCookies, epoch: 0, rejectLogin: null });
    channel.onEvent(event => {
      if (event.event === 'blocked') onBlocked(typeof event.host === 'string' ? event.host : '');
      else if (event.event === 'closed') this.cancelLogin();
      else if (event.event === 'gone') { this.cancelLogin(); this.onInvalid('The Tinfoil sign-in page stopped. Sign in again.'); }
    });
  }
  cancelLogin() { const reject = this.rejectLogin; this.rejectLogin = null; reject?.(new InputError('Sign-in was cancelled.')); }
  async login() {
    const epoch = ++this.epoch;
    let timer;
    const cancel = new Promise((_, reject) => { this.rejectLogin = reject; });
    const task = (async () => {
      await this.channel.call('show');
      let seen = null;
      const deadline = Date.now() + this.deadline;
      while (epoch === this.epoch && Date.now() < deadline) {
        const value = await this.channel.call('session', { force: false, user: null, session: null });
        // Two reads a second apart must agree, so the page has settled after sign-in before any token is used.
        if (value?.bearer && value?.profile) {
          if (seen?.sessionUserId === value.sessionUserId && seen?.sessionId === value.sessionId) {
            this.rejectLogin = null;
            await this.channel.call('hide');
            return value;
          }
          seen = value;
        } else seen = null;
        await new Promise(resolve => { timer = setTimeout(resolve, this.interval); });
      }
      throw new InputError('Sign-in timed out or was cancelled. Reopen Account to try again.');
    })();
    task.catch(() => {}); // after a cancellation the race has settled; the loop's own end is expected
    try { return await Promise.race([task, cancel]); }
    catch (error) { this.epoch++; throw error; }
    finally { clearTimeout(timer); this.rejectLogin = null; }
  }
  checked(value) {
    if (value?.changed) {
      const what = value.changed === 'user' ? 'account' : 'session';
      this.onInvalid(`The website ${what} changed. Sign out here and reconnect before sending.`);
      throw new InputError(`The website ${what} changed. Reconnect it in Account.`);
    }
    if (value?.signedOut) { this.onInvalid('Your Tinfoil sign-in expired. Sign in again.'); throw new InputError('Your Tinfoil sign-in expired. Sign in again.'); }
    // Not ready is not a sign-out: nothing is invalidated, and the request is refused for now.
    if (!value || typeof value !== 'object') throw new InputError('The Tinfoil sign-in page is not ready. Try again in a moment.');
    return value;
  }
  async readSession(force = false, expected = null) {
    const value = this.checked(await this.channel.call('session', { force: force === true, user: expected?.user ?? null, session: expected?.session ?? null }));
    if (!value.bearer) { this.onInvalid('Your Tinfoil sign-in expired. Sign in again.'); throw new InputError('Your Tinfoil sign-in expired. Sign in again.'); }
    // WebView reports no cookie changes. Clerk may have rotated its client cookie while issuing this token, so a
    // saved sign-in is refreshed after each read, as desktop does on its cookie events.
    this.onCookies();
    return value;
  }
  /** The persistent cookies of Tinfoil's hosts in the page's profile, for a saved sign-in. */
  async cookies() {
    const value = await this.channel.call('cookies');
    return Array.isArray(value) ? value.slice(0, 100).map(savedCookie).filter(Boolean) : [];
  }
  /** Opens Tinfoil's page hidden, in a fresh profile holding a saved sign-in's cookies, and reads the session bound to
   * it. Returns that read, {signedOut} or {changed}, or null if the page never became ready (for example offline), so
   * the saved sign-in is kept and tried again. */
  async restore(saved, { timeout = 30_000 } = {}) {
    const epoch = ++this.epoch;
    let timer;
    try { await this.channel.call('restore', { cookies: saved.cookies }); } catch { return null; }
    try {
      for (const deadline = Date.now() + timeout; epoch === this.epoch && Date.now() < deadline;) {
        const value = await this.channel.call('session', { force: false, user: saved.binding.user, session: saved.binding.session }).catch(() => null);
        if (value) return value;
        await new Promise(resolve => { timer = setTimeout(resolve, this.interval); });
      }
      return null;
    } finally { clearTimeout(timer); }
  }
  async identity(expected) { return this.checked(await this.channel.call('identity', { user: expected.user, session: expected.session })); }
  async manage(expected) {
    await this.readSession(false, expected);
    await this.channel.call('manage', { user: expected.user, session: expected.session });
  }
  /** Closes the page. `end` also ends its Clerk session; a saved sign-in that is set aside keeps it, as on desktop. */
  async clear({ end = true } = {}) {
    this.epoch++; this.cancelLogin();
    try { await this.channel.call('clear', { end: end !== false }); } catch { /* local cleanup is unconditional */ }
  }
}

const NULL_BODY = new Set([101, 103, 204, 205, 304]);
/** AccountSession's fetcher. The fixed exchange runs natively, where the Date and Retry-After headers are
 * readable, and returns a Response so the session's own limits, timeout and parsing apply unchanged. */
export function nativeFetcher(channel) {
  return async (url, init = {}) => {
    if (url !== CHAT_TOKEN_URL || (init.method ?? 'GET') !== 'GET') throw new TypeError('Only the Chat token exchange is available.');
    const authorization = init.headers?.Authorization;
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) throw new TypeError('The exchange needs an identity token.');
    const { signal } = init;
    if (signal?.aborted) throw new DOMException('The exchange was aborted.', 'AbortError');
    const exchange = channel.call('exchange', { bearer: authorization.slice(7) });
    const value = await (signal ? Promise.race([exchange, new Promise((_, reject) => signal.addEventListener('abort',
      () => reject(new DOMException('The exchange was aborted.', 'AbortError')), { once: true }))]) : exchange);
    if (!value || typeof value !== 'object' || !Number.isInteger(value.status) || value.status < 200 || value.status > 599) throw new TypeError('Invalid exchange response.');
    const headers = new Headers();
    for (const [name, key] of [['date', 'date'], ['retry-after', 'retryAfter'], ['content-length', 'contentLength']])
      if (typeof value[key] === 'string') headers.set(name, value[key]);
    return new Response(NULL_BODY.has(value.status) ? null : typeof value.body === 'string' ? value.body : '', { status: value.status, headers });
  };
}
