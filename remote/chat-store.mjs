import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AccountStore } from '../desktop/account-store.mjs';

export function serverProtector(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Invalid session encryption key.');
  const aad = Buffer.from('tinfoil-workbench:remote-chat:v1');
  return {
    isEncryptionAvailable: () => true,
    encryptString(text) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(aad);
      const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decryptString(bytes) {
      if (bytes.length < 28) throw new Error('Invalid encrypted session.');
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      cipher.setAAD(aad); cipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
    },
  };
}
export const serverAccountStore = (key, path = '/var/lib/tinfoil-workbench/auth/session.bin') =>
  new AccountStore(path, serverProtector(key));
