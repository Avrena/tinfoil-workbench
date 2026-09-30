import { spawn } from 'node:child_process';
import { readFile, readdir, stat, realpath } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';

/** Finds installed Python without running it, so Settings → Execution can offer it and the first Python run can
 * use it. It looks where Python is installed on Windows: interpreters registered under Software\Python (PEP 514:
 * python.org, the Microsoft Store and Anaconda register there, and the `py` launcher lists the same entries), the
 * folders on PATH, and the usual install folders. Each version comes from the file: its version resource, else the
 * pythonXY.dll beside it. Nothing is run except PowerShell, to read the registry.
 *
 * Skipped: the Microsoft Store's `python.exe` shortcuts on PATH, which open the Store when Store Python is not
 * installed (an installed Store Python is found through its registration), and registrations left behind by an
 * uninstall, whose files are gone. Interpreters on PATH come first, in PATH order: that is the Python a terminal
 * runs, with the packages installed for it. The rest follow, newest first. */

const STORE_ALIAS = /[\\/]microsoft[\\/]windowsapps[\\/]/i;
const SIGNATURE = Buffer.from([0xbd, 0x04, 0xef, 0xfe]); // VS_FIXEDFILEINFO
const LIMIT = 12;

/** CPython's version resource is major.minor.(micro * 1000 + level * 10 + serial): 3.10.11150 is 3.10.11 final. */
export function versionResource(bytes) {
  for (let i = bytes.indexOf(SIGNATURE); i >= 0 && i + 16 <= bytes.length; i = bytes.indexOf(SIGNATURE, i + 4)) {
    if (bytes.readUInt32LE(i + 4) !== 0x10000) continue;
    const high = bytes.readUInt32LE(i + 8), build = bytes.readUInt32LE(i + 12) >>> 16;
    const major = high >>> 16, minor = high & 0xffff;
    if (major !== 2 && major !== 3) return null;
    const level = { 10: 'a', 11: 'b', 12: 'rc', 15: '' }[Math.floor(build % 1000 / 10)];
    return level === undefined ? `${major}.${minor}` : `${major}.${minor}.${Math.floor(build / 1000)}${level && level + build % 10}`;
  }
  return null;
}

const envValue = (env, name) => { const key = Object.keys(env).find(k => k.toUpperCase() === name.toUpperCase()); return key ? env[key] : undefined; };

/** A Store alias is a reparse point that Node cannot stat; its folder lists it. */
async function storeAlias(path) {
  try { return (await readdir(dirname(path))).some(name => name.toLowerCase() === basename(path).toLowerCase()); } catch { return false; }
}
const storeVersion = path => path.match(/Python\.(\d+\.\d+)_/i)?.[1] ?? null;

async function dllVersion(folder) {
  let names = []; try { names = await readdir(folder); } catch {}
  const found = names.map(n => n.match(/^python(\d)(\d+)\.dll$/i)).filter(Boolean).map(m => [+m[1], +m[2]]).sort((a, b) => b[0] - a[0] || b[1] - a[1])[0];
  return found ? `${found[0]}.${found[1]}` : null;
}

/** The interpreter at `path` and its version (null when unknown), or null when there is no such file. */
export async function describePython(path, platform = process.platform) {
  if (typeof path !== 'string' || !path) return null;
  if (platform === 'win32' && STORE_ALIAS.test(path)) return await storeAlias(path) ? { path, version: storeVersion(path) } : null;
  let info; try { info = await stat(path); } catch { return null; }
  if (!info.isFile()) return null;
  let version = null;
  if (platform === 'win32') {
    try { if (info.size <= 16 * 1024 * 1024) version = versionResource(await readFile(path)); } catch {}
    version ??= await dllVersion(dirname(path));
  } else {
    try { version = basename(await realpath(path)).match(/^python(\d+\.\d+)/)?.[1] ?? null; } catch {}
  }
  return { path, version };
}

const REGISTRY_SCRIPT = `$ErrorActionPreference = 'SilentlyContinue'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$found = foreach ($root in 'HKCU:\\Software\\Python', 'HKLM:\\Software\\Python', 'HKLM:\\Software\\WOW6432Node\\Python') {
  foreach ($company in @(Get-ChildItem -LiteralPath $root)) { foreach ($tag in @(Get-ChildItem -LiteralPath $company.PSPath)) {
    $install = Get-Item -LiteralPath (Join-Path $tag.PSPath 'InstallPath')
    if ($install) { [pscustomobject]@{ company = $company.PSChildName; tag = $tag.PSChildName; version = $tag.GetValue('Version'); sysVersion = $tag.GetValue('SysVersion'); installPath = $install.GetValue(''); executable = $install.GetValue('ExecutablePath') } }
  } }
}
ConvertTo-Json -Compress -InputObject @($found)`;

/** The PEP 514 registrations, read by PowerShell (which keeps non-ASCII paths intact); [] when that fails. */
export function readRegistry({ env = process.env, timeoutMs = 15000 } = {}) {
  const powershell = join(envValue(env, 'SystemRoot') || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise(resolve => {
    let out = '', child;
    try {
      child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(REGISTRY_SCRIPT, 'utf16le').toString('base64')],
        { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { resolve([]); return; }
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', b => { if (out.length < 1_000_000) out += b; });
    child.once('error', () => { clearTimeout(timer); resolve([]); });
    child.once('close', () => {
      clearTimeout(timer);
      try { const value = JSON.parse(out.trim() || '[]'); resolve(Array.isArray(value) ? value : []); } catch { resolve([]); }
    });
  });
}

const text = v => typeof v === 'string' && v ? v : null;
const numeric = v => (v ?? '').split(/[^0-9]+/).filter(Boolean).map(Number);
function newer(a, b) {
  const x = numeric(a.version), y = numeric(b.version);
  if (!x.length || !y.length) return y.length - x.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((y[i] ?? 0) !== (x[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  return 0;
}

async function registered(entries, env) {
  const found = [];
  for (const e of entries) {
    if (!e || e.company === 'PyLauncher') continue;
    const home = text(e.installPath), listed = [e.version, e.sysVersion, e.tag].map(text).find(v => /^\d+\.\d+/.test(v ?? '')) ?? null;
    // Store Python is registered with its package folder, which only the Store may open; it runs through its alias.
    const store = home?.match(/[\\/]WindowsApps[\\/]([^\\/_]+)_[^\\/]*_([a-z0-9]{13})[\\/]?$/i);
    if (store) {
      const local = envValue(env, 'LOCALAPPDATA'); if (!local) continue;
      const alias = join(local, 'Microsoft', 'WindowsApps', `${store[1]}_${store[2]}`, 'python.exe');
      if (await storeAlias(alias)) found.push({ path: alias, version: listed ?? storeVersion(alias) });
      continue;
    }
    const exe = text(e.executable) ?? (home ? join(home, 'python.exe') : null);
    const info = exe ? await describePython(exe, 'win32') : null;
    if (info) found.push({ path: info.path, version: info.version ?? listed });
  }
  return found;
}

async function subfolders(folder, pattern) {
  try { return (await readdir(folder, { withFileTypes: true })).filter(d => d.isDirectory() && pattern.test(d.name)).map(d => join(folder, d.name)); } catch { return []; }
}

/** The usual places when Python is not registered or not on PATH. */
async function usualFolders(env) {
  const local = envValue(env, 'LOCALAPPDATA'), folders = [];
  if (local) folders.push(...await subfolders(join(local, 'Programs', 'Python'), /^python/i), ...await subfolders(join(local, 'Python'), /^pythoncore-/i));
  for (const name of ['ProgramFiles', 'ProgramFiles(x86)']) { const root = envValue(env, name); if (root) folders.push(...await subfolders(root, /^python\d/i)); }
  for (const name of ['USERPROFILE', 'LOCALAPPDATA', 'ProgramData']) {
    const root = envValue(env, name);
    if (root) for (const conda of ['anaconda3', 'miniconda3', 'miniforge3']) folders.push(join(root, conda));
  }
  return folders.map(f => join(f, 'python.exe'));
}

/** Installed interpreters, those on PATH first, at most twelve: [{ path, version, onPath? }]. */
export async function findPythons({ platform = process.platform, env = process.env, registry = platform === 'win32' ? () => readRegistry({ env }) : async () => [] } = {}) {
  const windows = platform === 'win32', seen = new Set(), onPath = [], other = [];
  const add = async (list, item, extra = {}) => {
    let key = item.path; try { key = await realpath(item.path); } catch {}
    key = windows ? key.toLowerCase() : key;
    if (seen.has(key)) return; seen.add(key); list.push({ ...item, ...extra });
  };
  const names = windows ? ['python.exe'] : ['python3', 'python'];
  for (const raw of (envValue(env, 'PATH') ?? '').split(windows ? ';' : ':')) {
    const folder = raw.trim().replace(/^"(.*)"$/, '$1');
    if (!folder || (windows && STORE_ALIAS.test(folder + '\\'))) continue;
    for (const name of names) { const info = await describePython(join(folder, name), platform); if (info) await add(onPath, info, { onPath: true }); }
  }
  if (windows) {
    for (const item of await registered(await registry(), env)) await add(other, item);
    for (const exe of await usualFolders(env)) { const info = await describePython(exe, platform); if (info) await add(other, info); }
  }
  return [...onPath, ...other.sort(newer)].slice(0, LIMIT);
}
