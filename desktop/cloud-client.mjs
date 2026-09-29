import { hkdfSync, randomUUID } from 'node:crypto';

/** Tinfoil's cloud sync service (docs/CLOUD.md). The enclave at SYNC_URL seals and unseals chats with the user's chat
 * key; it is reached only through the SDK's attested client, verified against SYNC_REPO, so the key never leaves an
 * attested channel. New chat IDs are made locally, as Tinfoil Chat makes them. */
export const SYNC_URL = 'https://sync.tinfoil.sh', SYNC_REPO = 'tinfoilsh/confidential-sync';
export const CLOUD_TIMING = Object.freeze({ ready: 45_000, request: 60_000, maxBytes: 48 * 1024 * 1024 });

/** Tinfoil's key ID: HKDF-SHA256 of the chat key with an empty salt and the info "tinfoil-key-id-v1", 16 bytes, hex. */
export function cloudKeyId(bytes) { return Buffer.from(hkdfSync('sha256', Buffer.from(bytes), Buffer.alloc(0), 'tinfoil-key-id-v1', 16)).toString('hex'); }

/** A chat ID in Tinfoil Chat's format: the reverse timestamp (9999999999999 minus the creation time in ms, 13 digits,
 * so newer chats sort first), an underscore and a random UUID. Tinfoil Chat makes its IDs this way, without a request. */
export function cloudChatId(createdAt = Date.now()) { return String(9999999999999 - Math.trunc(createdAt)).padStart(13, '0') + '_' + randomUUID(); }

/** The SDK's attested client for the sync enclave, verified against SYNC_REPO. The SDK is loaded only when cloud sync
 * is used; loading it here resolves it from the same package as this module, which the packaged-app check relies on. */
export async function syncEnclave(userCacheSecret) {
  const { SecureClient } = await import('tinfoil');
  return new SecureClient({ enclaveURL: SYNC_URL, configRepo: SYNC_REPO, userCacheSecret });
}

export class CloudError extends Error {
  constructor(message, status = null, code = null) { super(message); this.name = 'CloudError'; this.status = status; this.code = code; }
}
const bounded = (promise, ms, message) => { let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new CloudError(message, null, 'TIMEOUT')), ms); })]).finally(() => clearTimeout(timer)); };
/** Reads a JSON body up to a size limit; an empty or non-JSON body gives null. */
async function body(response, max) {
  if (Number(response.headers?.get?.('content-length')) > max) { await response.body?.cancel?.().catch(() => {}); throw new CloudError('A cloud response exceeded its size limit.', response.status, 'TOO_LARGE'); }
  const text = await response.text();
  if (text.length > max) throw new CloudError('A cloud response exceeded its size limit.', response.status, 'TOO_LARGE');
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}
const reason = (data, status) => {
  const code = typeof data?.code === 'string' && /^[A-Z0-9_]{1,60}$/.test(data.code) ? data.code : `HTTP_${status}`;
  return { code, message: code === 'HTTP_401' ? 'Tinfoil did not accept the account session for cloud sync. Sign in again.' : `Tinfoil cloud sync refused the request (${code}).` };
};

export class CloudClient {
  /** `secureClient()` builds the SDK's SecureClient for the enclave; `token(force)` returns the Clerk session token. */
  constructor({ secureClient, token, timing = CLOUD_TIMING }) { this.secureClient = secureClient; this.token = token; this.timing = timing; this.verified = null; }
  enclave() {
    if (!this.verified) this.verified = (async () => { const client = await this.secureClient(); await bounded(client.ready(), this.timing.ready, 'The Tinfoil sync enclave could not be verified in time.'); return client; })();
    return this.verified.catch(error => { this.verified = null; throw error; });
  }
  /** One POST to the enclave, with the session token; a 401 is retried once with a fresh token. */
  async call(path, payload) {
    const client = await this.enclave();
    const send = async force => bounded(client.fetch(SYNC_URL + path, { method: 'POST', body: JSON.stringify(payload),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Sync-Protocol': '2', Authorization: `Bearer ${await this.token(force)}` } }),
      this.timing.request, 'Tinfoil cloud sync did not answer in time.');
    let response = await send(false);
    if (response.status === 401) { await response.body?.cancel?.().catch(() => {}); response = await send(true); }
    const data = await body(response, this.timing.maxBytes);
    if (!response.ok) { const r = reason(data, response.status); throw new CloudError(r.message, response.status, r.code); }
    return data ?? {};
  }
  async keyCurrent() { const r = await this.call('/v1/key/current', {}); return { keyId: typeof r.key_id === 'string' ? r.key_id : null, hasData: r.has_data === true }; }
  async listStatus(scope, { cursor, limit = 100, direction = 'desc', projectId } = {}) {
    const r = await this.call('/v1/sync/list-status', { scope, cursor, limit, direction, ...(projectId ? { project_id: projectId } : {}) });
    return { updates: Array.isArray(r.updates) ? r.updates : [], deletes: Array.isArray(r.deletes) ? r.deletes : [], next: typeof r.next_cursor === 'string' && r.next_cursor ? r.next_cursor : null };
  }
  async pull(scope, ids, key) {
    if (!ids.length) return [];
    const r = await this.call('/v1/sync/pull', { scope, ids, keys: [{ key: key.b64, key_id: key.id }] });
    return Array.isArray(r.items) ? r.items : [];
  }
  /** `ifMatch` is the version the change was made against; '0' creates only. */
  async push(scope, id, key, plaintext, ifMatch, metadata = {}) {
    const r = await this.call('/v1/sync/push', { scope, id, key: key.b64, plaintext: Buffer.from(JSON.stringify(plaintext), 'utf8').toString('base64'), if_match: ifMatch, idempotency_key: randomUUID(), metadata });
    if (typeof r.etag !== 'string' || !/^\d{1,20}$/.test(r.etag)) throw new CloudError('Tinfoil cloud sync returned an invalid version.', null, 'BAD_RESPONSE');
    return r.etag;
  }
  async remove(scope, id, key, ifMatch) { await this.call('/v1/sync/delete', { scope, id, if_match: ifMatch, idempotency_key: randomUUID(), key: key.b64 }); }
  /** A new chat ID for a conversation created at `createdAt`. */
  newChatId(createdAt) { return cloudChatId(createdAt); }
}
