import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { accountCookieDomain } from '../dist/core/account.js';

const FORMAT = 'tinfoil-workbench-account', MAX = 256 * 1024;
const SAME_SITE = ['unspecified', 'no_restriction', 'lax', 'strict'];
const ids = binding => typeof binding?.user === 'string' && /^user_[A-Za-z0-9_-]{1,190}$/.test(binding.user)
  && typeof binding?.session === 'string' && /^sess_[A-Za-z0-9]{1,190}$/.test(binding.session);
const token = (v, max) => typeof v === 'string' && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);

/** Only persistent cookies of Tinfoil's own hosts are kept, as a browser keeps them across a restart. */
export function storableCookie(c) {
  if (!c || !token(c.name, 256) || !c.name || !token(c.value, 8192) || !token(c.domain, 253) || !accountCookieDomain(c.domain)) return null;
  if (!Number.isFinite(c.expirationDate) || c.expirationDate <= 0) return null;
  const host = c.domain.replace(/^\./, ''), path = token(c.path, 1024) && c.path.startsWith('/') ? c.path : '/';
  return { url: `https://${host}${path}`, name: c.name, value: c.value, ...(c.hostOnly ? {} : { domain: c.domain }), path,
    secure: c.secure === true, httpOnly: c.httpOnly === true, sameSite: SAME_SITE.includes(c.sameSite) ? c.sameSite : 'unspecified', expirationDate: c.expirationDate };
}

/** A cookie as saved: it must rebuild to exactly the same details. */
function storedCookie(c) {
  if (!c || typeof c.url !== 'string') return null;
  let host;
  try { const u = new URL(c.url); if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash) return null; host = u.hostname; } catch { return null; }
  const cookie = storableCookie({ name: c.name, value: c.value, domain: c.domain ?? host, hostOnly: c.domain === undefined, path: c.path,
    secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, expirationDate: c.expirationDate });
  return cookie && cookie.url === c.url ? cookie : null;
}

/** Validates a saved record before any of it is used; anything unexpected discards the whole record. */
export function savedAccount(value) {
  if (!value || typeof value !== 'object' || value.version !== 1 || !ids(value.binding) || !Array.isArray(value.cookies) || value.cookies.length > 100) return null;
  const cookies = [];
  for (const c of value.cookies) { const stored = storedCookie(c); if (!stored) return null; cookies.push(stored); }
  return cookies.length ? { version: 1, binding: { user: value.binding.user, session: value.binding.session }, profile: value.profile ?? null, cookies,
    savedAt: Number.isFinite(value.savedAt) ? value.savedAt : 0 } : null;
}

/** Tinfoil's website session, kept between launches only while the user stays signed in. The file is sealed by
 * Electron safeStorage (DPAPI on Windows, bound to the Windows account); plaintext is never written. */
export class AccountStore {
  constructor(path, protector) { this.path = path; this.protector = protector; this.queue = Promise.resolve(); }
  async read() {
    let serialized;
    try {
      if ((await stat(this.path)).size > MAX * 2) throw new Error('too large');
      serialized = await readFile(this.path, 'utf8');
    } catch (error) { if (error.code === 'ENOENT') return null; await this.clear(); return null; }
    try {
      if (!this.protector.isEncryptionAvailable()) return null;
      const envelope = JSON.parse(serialized);
      if (envelope?.format !== FORMAT || envelope.version !== 1 || typeof envelope.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.data)) throw new Error('format');
      const record = savedAccount(JSON.parse(this.protector.decryptString(Buffer.from(envelope.data, 'base64'))));
      if (!record) throw new Error('record');
      return record;
    } catch { await this.clear(); return null; }
  }
  write(record) {
    const value = savedAccount({ ...record, version: 1 });
    if (!value) return Promise.reject(new Error('Nothing to save.'));
    if (!this.protector.isEncryptionAvailable()) return Promise.reject(new Error('OS-backed encryption is unavailable.'));
    const envelope = JSON.stringify({ format: FORMAT, version: 1, data: this.protector.encryptString(JSON.stringify(value)).toString('base64') });
    if (envelope.length > MAX * 2) return Promise.reject(new Error('The saved sign-in exceeds its size limit.'));
    return this.enqueue(async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.${randomBytes(8).toString('hex')}.tmp`;
      let handle;
      try {
        handle = await open(temporary, 'wx', 0o600);
        await handle.writeFile(envelope, 'utf8'); await handle.sync(); await handle.close(); handle = null;
        await rename(temporary, this.path);
      } catch (error) {
        if (handle) await handle.close().catch(() => {});
        await rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
    });
  }
  clear() { return this.enqueue(() => rm(this.path, { force: true })); }
  enqueue(job) { const next = this.queue.then(job); this.queue = next.catch(() => {}); return next; }
}
