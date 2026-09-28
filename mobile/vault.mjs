/** Android counterpart of desktop/vault.mjs. The envelope format, AES-256-GCM parameters and
 * associated data are identical; the random data key is wrapped by a non-exportable Android
 * Keystore key instead of DPAPI, and the native side writes the file atomically. */
const AAD = new TextEncoder().encode('tinfoil-workbench:vault:v1');
const MAX = 64 * 1024 * 1024;
const FORMAT = 'tinfoil-workbench-vault';

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function decode(value, max) {
  if (typeof value !== 'string' || value.length > max * 2 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Invalid encrypted vault.');
  const binary = atob(value);
  if (binary.length > max) throw new Error('Invalid encrypted vault.');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (toBase64(bytes) !== value) throw new Error('Invalid encrypted vault.');
  return bytes;
}

export class MobileVault {
  /** native: { vaultRead, vaultWrite, keyWrap, keyUnwrap } backed by the Android plugin. */
  constructor(native, crypto = globalThis.crypto) {
    this.native = native; this.crypto = crypto;
    this.queue = Promise.resolve(); this.key = null; this.wrappedKey = null;
  }
  async importKey(raw) {
    return this.crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }
  async read() {
    const { envelope } = await this.native.vaultRead();
    if (envelope === null || envelope === undefined) {
      const raw = this.crypto.getRandomValues(new Uint8Array(32));
      try {
        const { wrapped } = await this.native.keyWrap({ key: toBase64(raw) });
        if (typeof wrapped !== 'string' || !wrapped) throw new Error('The Android Keystore did not return a wrapped key.');
        this.key = await this.importKey(raw); this.wrappedKey = wrapped;
      } finally { raw.fill(0); }
      return null;
    }
    if (typeof envelope !== 'string' || envelope.length > MAX * 1.5) throw new Error('Encrypted workspace exceeds its size limit.');
    const parsed = JSON.parse(envelope);
    if (parsed.format !== FORMAT || parsed.version !== 1 || typeof parsed.wrappedKey !== 'string') throw new Error('Unsupported encrypted workspace.');
    const { key } = await this.native.keyUnwrap({ wrapped: parsed.wrappedKey });
    const raw = decode(key, 32);
    if (raw.length !== 32) throw new Error('Invalid data key.');
    const iv = decode(parsed.iv, 12), tag = decode(parsed.tag, 16), body = decode(parsed.body, MAX);
    if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted workspace.');
    let cryptoKey;
    try { cryptoKey = await this.importKey(raw); } finally { raw.fill(0); }
    const sealed = new Uint8Array(body.length + 16); sealed.set(body); sealed.set(tag, body.length);
    const plaintext = new Uint8Array(await this.crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: AAD, tagLength: 128 }, cryptoKey, sealed));
    let value;
    try { value = JSON.parse(new TextDecoder().decode(plaintext)); }
    finally { plaintext.fill(0); }
    this.key = cryptoKey; this.wrappedKey = parsed.wrappedKey;
    return value;
  }
  write(value) {
    if (!this.key || !this.wrappedKey) return Promise.reject(new Error('Vault has not been opened.'));
    // Snapshot before enqueuing. An older delayed save must never overwrite newer state.
    const plaintext = new TextEncoder().encode(JSON.stringify(value));
    if (plaintext.byteLength > MAX) return Promise.reject(new Error('Workspace exceeds its size limit.'));
    const job = this.queue.then(async () => {
      const iv = this.crypto.getRandomValues(new Uint8Array(12));
      const sealed = new Uint8Array(await this.crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD, tagLength: 128 }, this.key, plaintext));
      const body = sealed.subarray(0, sealed.length - 16), tag = sealed.subarray(sealed.length - 16);
      const envelope = JSON.stringify({ format: FORMAT, version: 1, wrappedKey: this.wrappedKey, iv: toBase64(iv), tag: toBase64(tag), body: toBase64(body) });
      await this.native.vaultWrite({ envelope });
    });
    job.finally(() => plaintext.fill(0)).catch(() => {});
    // Allow explicit recovery writes after a failed write while still returning the rejection to the caller.
    this.queue = job.catch(() => {});
    return job;
  }
  async flush() { await this.queue; }
}
