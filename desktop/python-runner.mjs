import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readdir, open, lstat, realpath, rm } from 'node:fs/promises';
import { join, isAbsolute, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { InputError } from '../dist/core/validation.js';
const TYPES = { '.pdf': 'application/pdf', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.csv': 'text/csv', '.json': 'application/json', '.md': 'text/markdown', '.txt': 'text/plain' };

/** Native Python is NOT an OS sandbox. This entry point must only receive an
 * exact, user-approved code string and an interpreter chosen in a native dialog.
 * -I, a fresh cwd and a minimal environment are hygiene, not access controls.
 */
export async function runPython({ code, interpreter, signal, timeoutMs = 30000, onOutput = () => {} }) {
  if (!interpreter || !isAbsolute(interpreter)) throw new InputError('Choose an installed Python interpreter in Settings → Execution first.');
  if (typeof code !== 'string' || !code.trim() || code.length > 64000 || code.includes('\0')) throw new InputError('Invalid Python code.');
  if (signal?.aborted) throw new InputError('Python execution cancelled.');
  const root = await mkdtemp(join(tmpdir(), 'tinfoil-python-'));
  const output = join(root, 'artifacts'), script = join(root, 'input.py');
  await mkdir(output); await writeFile(script, code, { mode: 0o600 });
  // Compare resolved paths: TEMP can be an 8.3 short path (C:\Users\RUNNER~1\...) whose files
  // realpath() reports under the long name, which would otherwise fail the containment check.
  const outputReal = await realpath(output);
  const started = Date.now();
  let stdout = '', stderr = '', truncated = false, timedOut = false, child;
  const env = { PYTHONIOENCODING: 'utf-8', WORKBENCH_OUTPUT_DIR: output };
  for (const key of ['SystemRoot','WINDIR','TEMP','TMP','LANG','LC_ALL']) if (process.env[key]) env[key] = process.env[key];
  const terminate = () => {
    if (!child?.pid) return;
    if (process.platform === 'win32') {
      const killer = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
      killer.on('error', () => child.kill()); killer.unref();
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
  };
  let timer;
  try {
    const exitCode = await new Promise((resolve, reject) => {
      child = spawn(interpreter, ['-I', '-X', 'utf8', '-u', script], { cwd: root, env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore','pipe','pipe'] });
      const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
      const append = (kind, part) => {
        const remaining = Math.max(0, 100000 - stdout.length - stderr.length);
        const bounded = part.slice(0, remaining);
        if (kind === 'stdout') stdout += bounded; else stderr += bounded;
        onOutput({ stdout, stderr, truncated });
        if (part.length > remaining) { truncated = true; terminate(); }
      };
      child.stdout.on('data', b => append('stdout', decoders.stdout.write(b)));
      child.stderr.on('data', b => append('stderr', decoders.stderr.write(b)));
      child.once('error', () => reject(new InputError('Python could not start. Check the selected interpreter.')));
      child.once('close', code => { append('stdout', decoders.stdout.end()); append('stderr', decoders.stderr.end()); resolve(code); });
      signal?.addEventListener('abort', terminate, { once: true });
      if (signal?.aborted) terminate();
      timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
    });
    const artifacts = []; let bytes = 0;
    // Only explicitly produced, supported, bounded regular files are collected.
    for (const entry of await readdir(output, { withFileTypes: true })) {
      if (artifacts.length >= 8 || !entry.isFile() || entry.name.length > 200 || /[\\/\x00-\x1f]/.test(entry.name)) continue;
      const mime = TYPES[extname(entry.name).toLowerCase()]; if (!mime) continue;
      const path = join(output, entry.name), info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size + bytes > 2 * 1024 * 1024 || !(await realpath(path)).startsWith(outputReal + sep)) continue;
      const handle = await open(path, 'r'); let data;
      try {
        const maximum = 2 * 1024 * 1024 - bytes;
        const buffer = Buffer.alloc(maximum + 1); let offset = 0;
        while (offset < buffer.length) { const { bytesRead } = await handle.read(buffer, offset, buffer.length-offset, null); if (!bytesRead) break; offset += bytesRead; }
        if (offset > maximum) continue;
        data = buffer.subarray(0, offset);
      } finally { await handle.close(); }
      if (mime === 'image/png' && !data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) continue;
      if (mime === 'application/pdf' && data.subarray(0,5).toString() !== '%PDF-') continue;
      artifacts.push({ id: randomUUID(), name: entry.name, mime, data: data.toString('base64') }); bytes += data.length;
    }
    const note = timedOut ? '\nExecution stopped at the time limit.' : signal?.aborted ? '\nExecution cancelled.' : truncated ? '\nOutput limit reached; execution stopped.' : '';
    return { stdout, stderr: (stderr + note).slice(0, 100000), exitCode, artifacts, truncated, elapsedMs: Date.now() - started,
      status: signal?.aborted ? 'cancelled' : timedOut || truncated || exitCode !== 0 ? 'error' : 'complete' };
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', terminate);
    // This does not promise termination of malicious escaped / detached descendants.
    await rm(root, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}
