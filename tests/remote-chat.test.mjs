import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serverProtector, serverAccountStore } from '../remote/chat-store.mjs';
import { subscriptionClient, browserCookie } from '../remote/chat-session.mjs';

test('remote session encryption authenticates ciphertext and excludes plaintext cookies', async () => {
  const key = randomBytes(32), protector = serverProtector(key), ciphertext = protector.encryptString('private-cookie');
  assert.equal(protector.decryptString(ciphertext), 'private-cookie');
  assert.throws(() => serverProtector(randomBytes(32)).decryptString(ciphertext));
  ciphertext[30] ^= 1; assert.throws(() => protector.decryptString(ciphertext));
  const directory = await mkdtemp(join(tmpdir(), 'remote-chat-test-'));
  try {
    const store = serverAccountStore(key, join(directory, 'session.bin'));
    const record = { version: 1, binding: { user: 'user_test', session: 'sess_test' },
      cookies: [{ name: '__client', value: 'synthetic-private-cookie', url: 'https://clerk.tinfoil.sh/',
        path: '/', secure: true, httpOnly: true, sameSite: 'lax', expirationDate: 2000000000 }] };
    await store.write(record);
    assert.doesNotMatch(await readFile(store.path, 'utf8'), /synthetic-private-cookie|user_test/);
    assert.equal((await store.read()).binding.session, 'sess_test');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('every remote round renews through Chat account and attests a changed credential', async () => {
  let index = 0, verified = 0, calls = 0;
  const modes = [];
  const account = { getCredential: async () => ({ key: ++index < 3 ? 'first' : 'second' }), persist: async () => {} };
  const client = subscriptionClient(account, async (key, cache, mode) => {
    modes.push(mode);
    return { ready: async () => { verified++; }, getVerificationDocument: async () => ({ securityVerified: true }),
      chat: { completions: { create: async () => { calls++; return key; } } } };
  });
  await client.ready();
  assert.equal(await client.chat.completions.create({}), 'first');
  assert.equal(await client.chat.completions.create({}), 'second');
  assert.equal(verified, 2); assert.equal(calls, 2);
  assert.deepEqual(modes, ['chat-account', 'chat-account']);
});

test('subscription rejection is not retried or replaced by API-key inference', async () => {
  let calls = 0, rejected = false;
  const account = { getCredential: async () => ({ key: 'test' }), reject: () => { rejected = true; } };
  const client = subscriptionClient(account, async () => ({
    ready: async () => {}, getVerificationDocument: async () => ({ securityVerified: true }),
    chat: { completions: { create: async () => { calls++; throw Object.assign(new Error('Denied'), { status: 401 }); } } },
  }));
  await assert.rejects(client.chat.completions.create({}));
  assert.equal(calls, 1); assert.equal(rejected, true);
});

test('unverified renewed Chat client never generates', async () => {
  const account = { getCredential: async () => ({ key: 'test' }) };
  const client = subscriptionClient(account, async () => ({
    ready: async () => {}, getVerificationDocument: async () => ({ securityVerified: false }),
    chat: { completions: { create: () => assert.fail() } },
  }));
  await assert.rejects(client.chat.completions.create({}), /attestation/);
});

test('cookie conversion preserves domain scope and excludes browser-internal fields', () => {
  assert.deepEqual(browserCookie({ name: 'n', value: 'v', domain: '.tinfoil.sh', path: '/',
    url: 'https://tinfoil.sh/', expirationDate: 123, secure: true, httpOnly: true, sameSite: 'no_restriction' }),
  { name: 'n', value: 'v', domain: '.tinfoil.sh', path: '/', expires: 123, secure: true, httpOnly: true, sameSite: 'None' });
});
