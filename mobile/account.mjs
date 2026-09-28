import { InputError } from '../dist/core/validation.js';
import { CHAT_TOKEN_URL } from '../dist/core/account.js';

/** Host-worker side of Tinfoil Chat sign-in on Android (docs/ANDROID-ACCOUNT.md). Native code posts a
 * message port at page start and mobile/bridge.mjs hands it to this worker unread, so the Workbench page
 * never holds it afterwards. Only fixed operations exist: showing and hiding Tinfoil's page, the session,
 * identity and profile scripts, sign-out, and the Chat key exchange. AccountSession runs here unchanged. */
export const ACCOUNT_OPERATIONS = Object.freeze(['show', 'hide', 'session', 'identity', 'manage', 'clear', 'exchange']);
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
  constructor(channel, onInvalid = () => {}, onBlocked = () => {}, { interval = 1000, deadline = 600_000 } = {}) {
    Object.assign(this, { channel, onInvalid, onBlocked, interval, deadline, epoch: 0, rejectLogin: null });
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
    return value;
  }
  async identity(expected) { return this.checked(await this.channel.call('identity', { user: expected.user, session: expected.session })); }
  async manage(expected) {
    await this.readSession(false, expected);
    await this.channel.call('manage', { user: expected.user, session: expected.session });
  }
  async clear() {
    this.epoch++; this.cancelLogin();
    try { await this.channel.call('clear'); } catch { /* local cleanup is unconditional */ }
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
