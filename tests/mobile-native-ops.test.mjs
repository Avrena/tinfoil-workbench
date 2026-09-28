import test from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE_OPERATIONS, nativeRequest } from '../mobile/native-ops.mjs';

test('the Android bridge exposes a fixed, narrow operation list', () => {
  assert.deepEqual([...NATIVE_OPERATIONS].sort(), ['confirm', 'copyText', 'keyUnwrap', 'keyWrap', 'openDocuments', 'openExternal', 'saveDocument', 'vaultRead', 'vaultWrite']);
  for (const op of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'readFile', 'fetch', 'exec', 'moveTaskToBack', 'addListener'])
    assert.throws(() => nativeRequest(op, {}), /Unsupported/);
});

test('requests are reduced to their validated fields', () => {
  assert.deepEqual(nativeRequest('openDocuments', { multiple: true, maxCount: 9, maxBytes: 800000, path: '/data' }), { multiple: true, maxCount: 9, maxBytes: 800000 });
  assert.deepEqual(nativeRequest('confirm', { title: 'T', message: 'M', confirm: 'OK', cancel: 'No', extra: 1 }), { title: 'T', message: 'M', confirm: 'OK', cancel: 'No', danger: false });
  assert.deepEqual(nativeRequest('vaultRead', { path: '../other' }), {});
});

test('sizes, types and links are bounded', () => {
  assert.throws(() => nativeRequest('openDocuments', { maxCount: 0, maxBytes: 1 }), /file count/);
  assert.throws(() => nativeRequest('openDocuments', { maxCount: 1, maxBytes: 25 * 1024 * 1024 }), /file size/);
  assert.throws(() => nativeRequest('keyWrap', { key: 'x'.repeat(65) }), /data key/);
  assert.throws(() => nativeRequest('keyWrap', { key: 'not base64!' }), /data key/);
  assert.throws(() => nativeRequest('saveDocument', { name: '', mime: 'text/plain', data: '' }), /file name/);
  assert.throws(() => nativeRequest('confirm', { title: 'T', message: 5, confirm: 'OK', cancel: 'No' }), /dialog message/);
  for (const url of ['javascript:alert(1)', 'file:///data/data', 'intent://x#Intent;end', 'https://user:pw@example.com/', 'content://x'])
    assert.throws(() => nativeRequest('openExternal', { url }));
  assert.deepEqual(nativeRequest('openExternal', { url: 'https://example.com/' }), { url: 'https://example.com/' });
});
