import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv } from 'node:crypto';
import { MobileVault } from '../mobile/vault.mjs';

// Stand-in for the Android plugin. The wrapped-key format is deliberately opaque to the vault.
function fakeNative({ failWrite = false, failUnwrap = false } = {}) {
  const native = { envelope: null, writes: 0, failWrite, failUnwrap,
    async vaultRead() { return { envelope: native.envelope }; },
    async vaultWrite({ envelope }) { if (native.failWrite) throw new Error('disk full'); native.writes++; native.envelope = envelope; },
    async keyWrap({ key }) { return { wrapped: 'test-wrap:' + [...key].reverse().join('') }; },
    async keyUnwrap({ wrapped }) {
      if (native.failUnwrap || !wrapped.startsWith('test-wrap:')) throw new Error('keystore unavailable');
      return { key: [...wrapped.slice(10)].reverse().join('') };
    },
  };
  return native;
}

test('a new vault creates a wrapped key and round-trips the workspace', async () => {
  const native = fakeNative();
  const first = new MobileVault(native);
  assert.equal(await first.read(), null);
  await first.write({ threads: ['Unsent 中文'], apiKey: 'fixture-key' });
  const again = new MobileVault(native);
  assert.deepEqual(await again.read(), { threads: ['Unsent 中文'], apiKey: 'fixture-key' });
});

test('the envelope matches the desktop vault format and AES-256-GCM parameters', async () => {
  const native = fakeNative();
  const vault = new MobileVault(native);
  await vault.read();
  await vault.write({ hello: 'world' });
  const envelope = JSON.parse(native.envelope);
  assert.deepEqual(Object.keys(envelope), ['format', 'version', 'wrappedKey', 'iv', 'tag', 'body']);
  assert.equal(envelope.format, 'tinfoil-workbench-vault');
  assert.equal(envelope.version, 1);
  assert.doesNotMatch(native.envelope, /world/);
  // Decrypt exactly as desktop/vault.mjs does, with the unwrapped data key.
  const key = Buffer.from((await native.keyUnwrap({ wrapped: envelope.wrappedKey })).key, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from('tinfoil-workbench:vault:v1', 'utf8'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.body, 'base64')), decipher.final()]);
  assert.deepEqual(JSON.parse(plaintext.toString('utf8')), { hello: 'world' });
});

test('tampering, unknown formats and keystore failures fail closed without writing', async () => {
  const native = fakeNative();
  const vault = new MobileVault(native);
  await vault.read(); await vault.write({ a: 1 });
  const good = native.envelope, writes = native.writes;
  const envelope = JSON.parse(good);
  const flipped = Buffer.from(envelope.body, 'base64'); flipped[0] ^= 1;
  native.envelope = JSON.stringify({ ...envelope, body: flipped.toString('base64') });
  await assert.rejects(new MobileVault(native).read());
  native.envelope = JSON.stringify({ ...envelope, format: 'something-else' });
  await assert.rejects(new MobileVault(native).read(), /Unsupported/);
  native.envelope = JSON.stringify({ ...envelope, iv: envelope.iv + '=' });
  await assert.rejects(new MobileVault(native).read(), /Invalid/);
  native.envelope = good; native.failUnwrap = true;
  await assert.rejects(new MobileVault(native).read(), /keystore/);
  assert.equal(native.writes, writes);
  assert.equal(native.envelope, good);
});

test('writes are serialized, snapshot their value and recover after a failed write', async () => {
  const native = fakeNative();
  const vault = new MobileVault(native);
  await assert.rejects(vault.write({}), /not been opened/);
  await vault.read();
  const value = { n: 1 };
  const first = vault.write(value); value.n = 2;
  await first;
  assert.deepEqual(await new MobileVault(native).read(), { n: 1 });
  const second = vault.write({ n: 3 }), third = vault.write({ n: 4 });
  await Promise.all([second, third]);
  assert.deepEqual(await new MobileVault(native).read(), { n: 4 });
  native.failWrite = true;
  await assert.rejects(vault.write({ n: 5 }), /disk full/);
  native.failWrite = false;
  await vault.write({ n: 6 });
  assert.deepEqual(await new MobileVault(native).read(), { n: 6 });
});
