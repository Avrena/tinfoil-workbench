import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectPackage } from '../scripts/check-package.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// electron-builder packs dependencies and optional dependencies, not packages that npm installed only to satisfy a
// peer dependency. zod was one (a peer of the SDK's @ai-sdk dependencies), so the packaged app could not load the SDK.
test('no runtime package is installed only as a peer dependency', () => {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const peerOnly = Object.entries(lock.packages).filter(([, entry]) => entry.peer && !entry.dev).map(([path]) => path);
  assert.deepEqual(peerOnly, []);
});

test('the package check finds a required peer that is missing from app.asar, and ignores optional peers', async t => {
  const asar = createRequire(join(root, 'package.json'))('@electron/asar');
  const dir = mkdtempSync(join(tmpdir(), 'workbench-package-check-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const write = (path, value) => { mkdirSync(dirname(join(dir, 'app', path)), { recursive: true }); writeFileSync(join(dir, 'app', path), JSON.stringify(value)); };
  write('package.json', { name: 'app', version: '1.0.0', dependencies: { sdk: '1.0.0' } });
  write('node_modules/sdk/package.json', { name: 'sdk', version: '1.0.0', dependencies: { helper: '1.0.0' }, peerDependencies: { ai: '*' }, peerDependenciesMeta: { ai: { optional: true } } });
  write('node_modules/sdk/node_modules/helper/package.json', { name: 'helper', version: '1.0.0', peerDependencies: { zod: '*' } });
  await asar.createPackage(join(dir, 'app'), join(dir, 'broken.asar'));
  assert.deepEqual(inspectPackage(join(dir, 'broken.asar'), root), { ok: false, packages: 2, missing: ['zod (peer dependency of helper@1.0.0)'] });
  write('node_modules/zod/package.json', { name: 'zod', version: '4.6.5' });
  await asar.createPackage(join(dir, 'app'), join(dir, 'fixed.asar'));
  assert.deepEqual(inspectPackage(join(dir, 'fixed.asar'), root), { ok: true, packages: 3, missing: [] });
});
