import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { savedAccount } from '../desktop/account-store.mjs';
import { serverAccountStore } from './chat-store.mjs';

try {
  if (process.getuid() !== 0) throw new Error();
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; if (input.length > 300000) throw new Error(); }
  const record = savedAccount(JSON.parse(input));
  if (!record) throw new Error();
  const path = '/etc/tinfoil-workbench/session-key';
  let key;
  try { key = await readFile(path); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    key = randomBytes(32); await writeFile(path, key, { mode: 0o600, flag: 'wx' });
  }
  await serverAccountStore(key).write(record);
  console.log('Chat session installed.');
} catch { console.error('Chat session installation failed.'); process.exitCode = 1; }
