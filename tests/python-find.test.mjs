import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { versionResource, describePython, findPythons } from '../desktop/python-find.mjs';

/** A stand-in python.exe: only its VS_FIXEDFILEINFO matters (CPython's build field is micro*1000 + level*10 + serial). */
function exe(major, minor, build) {
  const b = Buffer.alloc(64);
  Buffer.from([0xbd, 0x04, 0xef, 0xfe]).copy(b, 8); b.writeUInt32LE(0x10000, 12);
  b.writeUInt32LE((major * 65536 + minor) >>> 0, 16); b.writeUInt32LE((build * 65536 + 1013) >>> 0, 20);
  return b;
}
async function place(path, bytes = Buffer.from('MZ')) { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, bytes); return path; }
async function temp(t) { const root = await mkdtemp(join(tmpdir(), 'tw-python-find-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }

test('version resource decodes CPython release levels and ignores other programs', () => {
  assert.equal(versionResource(exe(3, 10, 11150)), '3.10.11');
  assert.equal(versionResource(exe(3, 13, 122)), '3.13.0rc2');
  assert.equal(versionResource(exe(3, 14, 101)), '3.14.0a1');
  assert.equal(versionResource(exe(3, 12, 4)), '3.12');
  assert.equal(versionResource(exe(7, 3, 17000)), null);
  assert.equal(versionResource(Buffer.from('no resource here')), null);
});

test('interpreters on PATH come first; registered and usual ones follow newest first, without Store shortcuts or leftovers', async t => {
  const root = await temp(t), local = join(root, 'local');
  const first = await place(join(root, 'tools', 'py311', 'python.exe'), exe(3, 11, 4150));
  const second = await place(join(root, 'tools', 'py312', 'python.exe'));
  await place(join(root, 'tools', 'py312', 'python312.dll'));
  const shortcut = await place(join(local, 'Microsoft', 'WindowsApps', 'python.exe'));
  const registered = await place(join(root, 'Python313', 'python.exe'), exe(3, 13, 1150));
  const store = await place(join(local, 'Microsoft', 'WindowsApps', 'PythonSoftwareFoundation.Python.3.12_qbz5n2kfra8p0', 'python.exe'));
  const usual = await place(join(local, 'Programs', 'Python', 'Python39', 'python.exe'));
  await place(join(local, 'Programs', 'Python', 'Python39', 'python39.dll'));
  const env = { PATH: [join(root, 'tools', 'py311'), join(local, 'Microsoft', 'WindowsApps'), join(root, 'missing'), join(root, 'tools', 'py312')].join(';'), LOCALAPPDATA: local };
  const registry = async () => [
    { company: 'PythonCore', tag: '3.11', version: '3.11.4', installPath: join(root, 'tools', 'py311') }, // also on PATH: listed once
    { company: 'PythonCore', tag: '3.13', version: '3.13.1', installPath: join(root, 'Python313'), executable: registered },
    { company: 'PythonCore', tag: '3.10', version: '3.10.2', installPath: join(root, 'uninstalled'), executable: join(root, 'uninstalled', 'python.exe') },
    { company: 'PythonCore', tag: '3.12', version: '3.12.8', installPath: 'C:\\Program Files\\WindowsApps\\PythonSoftwareFoundation.Python.3.12_3.12.2288.0_x64__qbz5n2kfra8p0' },
    { company: 'PythonCore', tag: '3.11', version: '3.11.1', installPath: 'C:\\Program Files\\WindowsApps\\PythonSoftwareFoundation.Python.3.11_3.11.2288.0_x64__qbz5n2kfra8p0' },
    { company: 'PyLauncher', tag: 'x', installPath: join(root, 'Python313') },
  ];
  const found = await findPythons({ platform: 'win32', env, registry });
  assert.deepEqual(found, [
    { path: first, version: '3.11.4', onPath: true },
    { path: second, version: '3.12', onPath: true },
    { path: registered, version: '3.13.1' },
    { path: store, version: '3.12.8' },
    { path: usual, version: '3.9' },
  ]);
  assert.ok(!found.some(p => p.path === shortcut));
});

test('describing an interpreter needs its file; a missing Store shortcut is not one', async t => {
  const root = await temp(t);
  assert.equal(await describePython(join(root, 'python.exe'), 'win32'), null);
  assert.equal(await describePython(root, 'win32'), null);
  assert.equal(await describePython(join(root, 'Microsoft', 'WindowsApps', 'PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0', 'python.exe'), 'win32'), null);
  const path = await place(join(root, 'python.exe'), exe(3, 12, 3150));
  assert.deepEqual(await describePython(path, 'win32'), { path, version: '3.12.3' });
});

test('outside Windows, python3 on PATH is found with the version in its name', { skip: process.platform === 'win32' }, async t => {
  const root = await temp(t), bin = join(root, 'bin');
  await place(join(bin, 'python3.12')); await symlink(join(bin, 'python3.12'), join(bin, 'python3'));
  assert.deepEqual(await findPythons({ platform: 'linux', env: { PATH: bin } }), [{ path: join(bin, 'python3'), version: '3.12', onPath: true }]);
});
