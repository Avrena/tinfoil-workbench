import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { AccountSession } from '../desktop/account-session.mjs';
import { sessionScript, identityScript } from '../desktop/account-window.mjs';
import { storableCookie } from '../desktop/account-store.mjs';
import { CHAT_ORIGIN, allowedAccountNavigation } from '../dist/core/account.js';
import { InputError } from '../dist/core/validation.js';
import { createProvider } from '../desktop/provider.mjs';
import { serverAccountStore } from './chat-store.mjs';

export function browserCookie(cookie) {
  const sameSite = { lax: 'Lax', strict: 'Strict', no_restriction: 'None' }[cookie.sameSite];
  return { name: cookie.name, value: cookie.value,
    ...(cookie.domain ? { domain: cookie.domain, path: cookie.path } : { url: cookie.url }),
    expires: cookie.expirationDate, secure: cookie.secure, httpOnly: cookie.httpOnly,
    ...(sameSite ? { sameSite } : {}) };
}

/** Only fixed Workbench account scripts, never a model-controlled browser tool. */
export class RemoteAccountWindow {
  async open(cookies = []) {
    const { chromium } = await import('playwright-core');
    this.browser = await chromium.launch({ headless: true, chromiumSandbox: true,
      env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp', LANG: 'C.UTF-8' } });
    this.context = await this.browser.newContext({ acceptDownloads: false, serviceWorkers: 'block' });
    await this.context.route('**/*', route => {
      const req = route.request();
      let allowed = false;
      try {
        const url = new URL(req.url());
        allowed = ['https:', 'wss:', 'data:', 'blob:', 'about:'].includes(url.protocol);
        if (req.isNavigationRequest() && req.frame().parentFrame() === null) allowed &&= allowedAccountNavigation(url.href);
      } catch {}
      return allowed ? route.continue() : route.abort();
    });
    await this.context.addCookies(cookies.map(browserCookie));
    this.page = await this.context.newPage();
    this.context.on('page', page => { if (page !== this.page) void page.close(); });
    this.page.on('dialog', dialog => void dialog.dismiss());
    await this.page.goto(CHAT_ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  async script(source) {
    if (!this.page || this.page.isClosed() || new URL(this.page.url()).origin !== CHAT_ORIGIN) return null;
    let timer;
    try { return await Promise.race([this.page.evaluate(source),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new InputError('Tinfoil session read timed out.')), 15000); })]); }
    finally { clearTimeout(timer); }
  }
  checked(value) {
    if (!value || value.signedOut || value.changed) throw new InputError('Reconnect the remote Tinfoil Chat session.');
    return value;
  }
  async restore(saved) {
    await this.open(saved.cookies);
    for (let n = 0; n < 30; n++) {
      const first = await this.script(sessionScript(false, saved.binding));
      if (first) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const second = await this.script(sessionScript(false, saved.binding));
        if (second?.signedOut || second?.changed) return second;
        if (first.sessionUserId === second?.sessionUserId && first.sessionId === second?.sessionId) return second;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return null;
  }
  async readSession(force, expected) { return this.checked(await this.script(sessionScript(force, expected))); }
  async identity(expected) { return this.checked(await this.script(identityScript(expected))); }
  async cookies() {
    if (!this.context) return [];
    return (await this.context.cookies()).map(c => storableCookie({
      ...c, hostOnly: !c.domain.startsWith('.'), expirationDate: c.expires,
      sameSite: { None: 'no_restriction', Lax: 'lax', Strict: 'strict' }[c.sameSite],
    })).filter(Boolean);
  }
  async clear({ end = true } = {}) {
    if (end) try { await this.script('(async()=>{if(window.Clerk?.session)await window.Clerk.session.end();})()'); } catch {}
    await this.browser?.close(); this.browser = this.context = this.page = null;
  }
}

/** Reuse Workbench's Chat identity binding, expiry, quota and renewal logic.
 * Every generation round obtains a current subscription credential. No API fallback. */
export function subscriptionClient(account, factory = createProvider) {
  let client = null, credential = null;
  const cacheSecret = randomBytes(32).toString('base64');
  async function current() {
    let next;
    try { next = await account.getCredential(); }
    catch (error) {
      const state = account.snapshot?.();
      error.reason = state?.entitlement === 'rate-limited' ? 'quota' : state?.entitlement === 'subscription-required' ? 'subscription' : 'auth';
      throw error;
    }
    await account.persist?.();
    if (!client || next.key !== credential?.key) {
      const candidate = await factory(next.key, cacheSecret, 'chat-account');
      await candidate.ready();
      const document = await candidate.getVerificationDocument();
      if (document.securityVerified !== true) throw Object.assign(new InputError('Provider attestation was not verified.'), { reason: 'attestation' });
      client = candidate; credential = next;
    }
    return client;
  }
  return {
    ready: () => current(),
    getVerificationDocument: () => client?.getVerificationDocument() ?? { securityVerified: false },
    models: { list: async () => (await current()).models.list() },
    chat: { completions: { create: async (...args) => {
      const active = await current();
      try { return await active.chat.completions.create(...args); }
      catch (error) {
        if (error?.status === 401 || error?.status === 403) {
          account.reject(credential?.key, 'Tinfoil rejected the Chat credential. Reconnect; no generation was retried.');
          client = null; credential = null;
          throw Object.assign(new InputError('Tinfoil rejected the remote Chat credential. Reconnect remote Chat; no generation was retried.'), { reason: 'auth' });
        }
        if (error?.status === 429) throw Object.assign(new InputError('Tinfoil Chat usage limit reached. No generation was retried.'), { reason: 'quota' });
        if (error?.status === 402) throw Object.assign(new InputError('Tinfoil requires an active Chat subscription. No API fallback was used.'), { reason: 'subscription' });
        throw error;
      }
    } } },
  };
}

export async function openSubscription() {
  const key = await readFile(process.env.CREDENTIALS_DIRECTORY + '/session-key');
  const adapter = new RemoteAccountWindow(), store = serverAccountStore(key);
  const account = new AccountSession(adapter, () => {}, { store });
  try {
    if (!await account.restore() || account.snapshot().entitlement !== 'active')
      throw Object.assign(new InputError(account.snapshot().message || 'Remote Chat sign-in is unavailable or subscription access is not active. Reconnect.'), { reason: account.snapshot().entitlement === 'rate-limited' ? 'quota' : 'auth' });
    const persist = setInterval(() => { void account.persist(); }, 5000);
    persist.unref();
    return { client: subscriptionClient(account), close: async () => { clearInterval(persist); await account.shutdown(); } };
  } catch (error) {
    account.cancelRestore(); account.cancelPersist(); await adapter.clear({ end: false }).catch(() => {});
    throw error;
  }
}
