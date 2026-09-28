import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
const AAD = Buffer.from('tinfoil-workbench:vault:v1', 'utf8');
const MAX = 64 * 1024 * 1024;
const decode = (value, max) => {
  if (typeof value !== 'string' || value.length > max * 2 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Invalid encrypted vault.');
  const buffer = Buffer.from(value, 'base64');
  if (buffer.length > max || buffer.toString('base64') !== value) throw new Error('Invalid encrypted vault.');
  return buffer;
};
/** A single AES-GCM file; the random data key is wrapped by Electron safeStorage (DPAPI on Windows). */
export class EncryptedVault {
  constructor(directory, protector) {
    this.directory = directory;
    this.path = join(directory, 'workspace.vault');
    this.protector = protector;
    this.queue = Promise.resolve();
    this.key = null;
    this.wrappedKey = null;
  }
  async read() {
    if (!this.protector.isEncryptionAvailable()) throw new Error('OS-backed encryption is unavailable. Plaintext storage is not permitted.');
    let serialized;
    try {
      if ((await stat(this.path)).size > MAX * 1.5) throw new Error('Encrypted workspace exceeds its size limit.');
      serialized = await readFile(this.path, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.key = randomBytes(32);
      this.wrappedKey = this.protector.encryptString(this.key.toString('base64')).toString('base64');
      return null;
    }
    const envelope = JSON.parse(serialized);
    if (envelope.format !== 'tinfoil-workbench-vault' || envelope.version !== 1) throw new Error('Unsupported encrypted workspace.');
    const key = decode(this.protector.decryptString(decode(envelope.wrappedKey, 64 * 1024)), 32);
    if (key.length !== 32) throw new Error('Invalid data key.');
    const iv = decode(envelope.iv, 12), tag = decode(envelope.tag, 16);
    if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted workspace.');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(AAD); decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(decode(envelope.body, MAX)), decipher.final()]);
    let parsed;
    try { parsed = JSON.parse(plaintext.toString('utf8')); }
    finally { plaintext.fill(0); }
    this.key = key; this.wrappedKey = envelope.wrappedKey;
    return parsed;
  }
  write(value) {
    if (!this.key || !this.wrappedKey) return Promise.reject(new Error('Vault has not been opened.'));
    // Snapshot before enqueuing. An older delayed save must never overwrite newer state.
    const plaintext = JSON.stringify(value);
    if (Buffer.byteLength(plaintext) > MAX) return Promise.reject(new Error('Workspace exceeds its size limit.'));
    const job = this.queue.then(async () => {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.key, iv);
      cipher.setAAD(AAD);
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const envelope = JSON.stringify({ format: 'tinfoil-workbench-vault', version: 1,
        wrappedKey: this.wrappedKey, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), body: body.toString('base64') });
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = this.path + '.' + randomBytes(8).toString('hex') + '.tmp';
      let handle;
      try {
        handle = await open(temporary, 'wx', 0o600);
        await handle.writeFile(envelope, 'utf8'); await handle.sync();
        await handle.close(); handle = null;
        await rename(temporary, this.path);
      } catch (error) {
        if (handle) await handle.close().catch(() => {});
        await rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
    });
    // Allow explicit recovery writes after a failed IO operation while still returning the rejection to the caller.
    this.queue = job.catch(() => {});
    return job;
  }
  async flush() { await this.queue; }
}
