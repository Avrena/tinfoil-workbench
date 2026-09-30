import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { AGENT_LIMITS, diffCounts, globMatcher, lines, searchPattern, unifiedDiff } from '../dist/core/agent.js';
import { InputError } from '../dist/core/validation.js';

/** The Windows side of the workspace agent (docs/WORKSPACE-AGENT.md). The service passes the model's checked
 * arguments (core/agent.ts); every path is resolved here again, links and junctions included, and must stay inside the
 * conversation's folder. Reads, lists and searches run at once; edits are prepared, shown for approval and applied only
 * if the file has not changed since; commands run after approval, with the user's permissions. This is not a sandbox.
 * The Android worker never imports this module. */

const SKIP = new Set(['.git', 'node_modules']);
const LIMIT = AGENT_LIMITS;
const inside = (root, path) => { const r = relative(root, path); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const display = (base, path) => relative(base, path).replaceAll('\\', '/') || '.';

/** Text of a file, or an InputError for binary content. A UTF-8 byte order mark is removed and remembered. */
function decode(buffer, path) {
  if (buffer.subarray(0, 8000).includes(0)) throw new InputError(`${path} is not a text file.`);
  const bom = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
  return { text: new TextDecoder('utf-8').decode(bom ? buffer.subarray(3) : buffer), bom };
}

async function root(folder) {
  let real;
  try { real = await realpath(folder); } catch { throw new InputError('The workspace folder no longer exists. Choose it again.'); }
  if (!(await stat(real)).isDirectory()) throw new InputError('The workspace folder is not a folder. Choose it again.');
  return real;
}
/** Resolves a relative path in the folder. An existing path is followed through links and junctions and must stay
 * inside; for one that does not exist yet, its nearest existing parent must. `real` is null when the path is missing. */
async function place(folder, path) {
  const base = await root(folder), target = resolve(base, path === '.' ? '' : path);
  if (!inside(base, target)) throw new InputError('That path is outside the workspace folder.');
  for (let probe = target;;) {
    try {
      const real = await realpath(probe);
      if (!inside(base, real)) throw new InputError('That path leads outside the workspace folder through a link or junction.');
      return { base, target, real: probe === target ? real : null };
    } catch (error) {
      if (error instanceof InputError) throw error;
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
      const parent = dirname(probe);
      if (parent === probe) throw new InputError('Path not found.');
      probe = parent;
    }
  }
}
async function textFile(real, path) {
  const info = await stat(real);
  if (info.isDirectory()) throw new InputError(`${path} is a folder.`);
  if (info.size > LIMIT.readBytes) throw new InputError(`${path} is larger than 2 MiB.`);
  const buffer = await readFile(real);
  return { buffer, ...decode(buffer, path) };
}

/** Keeps the start and the end of a stream of output, decoding UTF-8 across chunk boundaries. */
function collector(head = 59_000, tail = 40_000) {
  const decoder = new StringDecoder('utf8');
  let start = '', end = '', dropped = 0;
  const add = chunk => {
    let text = decoder.write(chunk);
    if (start.length < head) { const take = text.slice(0, head - start.length); start += take; text = text.slice(take.length); }
    if (!text) return;
    end += text;
    if (end.length > tail) { dropped += end.length - tail; end = end.slice(-tail); }
  };
  return { add, get dropped() { return dropped; },
    text: () => { end += decoder.end(); return dropped ? `${start}\n… [${dropped.toLocaleString('en-US')} characters not kept] …\n${end}` : start + end; } };
}

/** Git for Windows' bash launcher (`<Git>\bin\bash.exe`, which sets up Git's PATH), or null. */
export async function findGitBash(env = process.env) {
  const bases = [env.ProgramFiles, env.ProgramW6432, env['ProgramFiles(x86)'], env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs')].filter(Boolean);
  const candidates = bases.map(base => join(base, 'Git', 'bin', 'bash.exe'));
  for (const dir of String(env.Path ?? env.PATH ?? '').split(';')) if (/[\\/]git[\\/]cmd[\\/]?$/i.test(dir)) candidates.push(join(dir, '..', 'bin', 'bash.exe'));
  for (const candidate of candidates) { try { if ((await stat(candidate)).isFile()) return candidate; } catch { /* not installed here */ } }
  return null;
}
/** Why a folder cannot be the agent's, or null. Reading needs no approval, so a folder that holds the user's keys,
 * browser data or app data (Workbench's own included), or the system, is refused: a drive root, the user's home folder
 * or anything above it, AppData, Windows and Program Files. */
export function unsafeFolder(folder, env = process.env) {
  const norm = value => resolve(value).replace(/[\\/]+$/, '').toLowerCase();
  const path = norm(folder), within = base => base && (path === norm(base) || path.startsWith(norm(base) + '\\'));
  if (/^[a-z]:$/.test(path)) return 'a whole drive';
  const home = env.USERPROFILE && norm(env.USERPROFILE);
  if (home && (home === path || home.startsWith(path + '\\'))) return 'your home folder, or a folder that contains it';
  if (within(env.APPDATA) || within(env.LOCALAPPDATA) || (home && within(join(home, 'AppData')))) return 'an application data folder';
  if (within(env.SystemRoot) || within(env.ProgramFiles) || within(env['ProgramFiles(x86)']) || within(env.ProgramData)) return 'a system or program folder';
  return null;
}
/** The user's environment without Electron's own variables (ELECTRON_RUN_AS_NODE would turn Electron-based tools into Node). */
export function childEnvironment(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key, value]) => value !== undefined && !/^ELECTRON_/i.test(key) && key !== 'WORKBENCH_COMMAND'));
}
/** PowerShell started with -EncodedCommand writes its error, warning and information streams to stderr as CLIXML
 * (`#< CLIXML` then `<Objs>…<S S="Error">text_x000D__x000A_</S>…`). This turns them back into plain lines. */
export function readableStderr(text) {
  if (!text.includes('#< CLIXML')) return text;
  const entity = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
  return text.replace(/#< CLIXML\r?\n?/g, '').replace(/<Objs\b[^>]*>([\s\S]*?)(<\/Objs>|$)/g, (_, body) =>
    [...body.matchAll(/<S S="(\w+)">([\s\S]*?)<\/S>/g)].map(([, stream, value]) =>
      (stream === 'Error' ? '' : stream.toUpperCase() + ': ') + value.replace(/&(lt|gt|amp|quot|apos);/g, (m, name) => entity[name])
        .replace(/_x([0-9A-Fa-f]{4})_/g, (m, hex) => String.fromCharCode(parseInt(hex, 16)))).join(''));
}
// Output in UTF-8 whatever the system code page, no progress records, and the exit code of the last native program. It
// shares the command's first line, so line numbers in PowerShell's errors match the command.
const POWERSHELL_PRELUDE = "$ProgressPreference = 'SilentlyContinue'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding; $global:LASTEXITCODE = 0; ";

export function createAgentTools({ systemRoot = process.env.SystemRoot || 'C:\\Windows' } = {}) {
  const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const tools = {
    gitBash: null,
    async detect() { tools.gitBash = await findGitBash(); return tools; },

    async list({ folder, path, depth }) {
      const { base, real } = await place(folder, path);
      if (!real) throw new InputError(`${path} does not exist.`);
      if (!(await stat(real)).isDirectory()) throw new InputError(`${path} is a file; use read_file.`);
      const out = []; let more = 0;
      const walk = async (dir, level) => {
        const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
        for (const entry of entries) {
          if (out.length >= LIMIT.listEntries) { more++; continue; }
          const full = join(dir, entry.name), shown = display(base, full);
          if (entry.isSymbolicLink()) out.push(`${shown} (link, not followed)`);
          else if (entry.isDirectory()) {
            if (SKIP.has(entry.name)) { out.push(`${shown}/ (not listed)`); continue; }
            out.push(`${shown}/`);
            if (level < depth) await walk(full, level + 1);
          } else out.push(shown);
        }
      };
      await walk(real, 1);
      return { text: (out.length ? out.join('\n') : '(empty folder)') + (more ? `\n… ${more} more entries not listed` : '') };
    },

    async search({ folder, pattern, path, glob, signal }) {
      const { base, real } = await place(folder, path);
      if (!real) throw new InputError(`${path} does not exist.`);
      const regex = searchPattern(pattern), match = globMatcher(glob), found = [];
      let files = 0, stop = '';
      const scan = async file => {
        const shown = display(base, file);
        if (!match(shown)) return;
        if (++files > LIMIT.searchFiles) { stop = `Stopped after ${LIMIT.searchFiles.toLocaleString('en-US')} files; narrow the path or glob.`; return; }
        const info = await stat(file);
        if (info.size > LIMIT.readBytes) return;
        let text;
        try { text = decode(await readFile(file), shown).text; } catch { return; }
        for (const [index, line] of lines(text).entries()) {
          if (!regex.test(line.slice(0, LIMIT.lineChars))) continue;
          const trimmed = line.trim();
          found.push(`${shown}:${index + 1}: ${trimmed.length > LIMIT.searchLine ? trimmed.slice(0, LIMIT.searchLine) + ' …' : trimmed}`);
          if (found.length >= LIMIT.searchMatches) { stop = `Stopped at ${LIMIT.searchMatches} matches; narrow the pattern, path or glob.`; return; }
        }
      };
      const walk = async dir => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          if (stop || signal?.aborted) return;
          if (entry.isSymbolicLink() || SKIP.has(entry.name)) continue;
          const full = join(dir, entry.name);
          if (entry.isDirectory()) await walk(full); else if (entry.isFile()) await scan(full);
        }
      };
      if ((await stat(real)).isDirectory()) await walk(real); else await scan(real);
      if (signal?.aborted) throw new InputError('Search cancelled.');
      return { text: (found.length ? found.join('\n') : `No matches for ${pattern}${glob ? ` in files matching ${glob}` : ''}.`) + (stop ? `\n${stop}` : '') };
    },

    async read({ folder, path, start_line: startLine, max_lines: maxLines }) {
      const { real } = await place(folder, path);
      if (!real) throw new InputError(`${path} does not exist.`);
      const all = lines((await textFile(real, path)).text), from = startLine - 1;
      if (all.length && from >= all.length) throw new InputError(`${path} has ${all.length} lines.`);
      const part = all.slice(from, from + maxLines);
      let out = all.length ? `${path} · lines ${from + 1}–${from + part.length} of ${all.length}\n` : `${path} is empty.\n`;
      for (const [index, line] of part.entries()) {
        const row = `${from + index + 1}\t${line.length > LIMIT.lineChars ? line.slice(0, LIMIT.lineChars) + ' …' : line}\n`;
        if (out.length + row.length > LIMIT.readChars) { out += `… stopped at ${LIMIT.readChars.toLocaleString('en-US')} characters; read from line ${from + index + 1} for more\n`; break; }
        out += row;
      }
      return { text: out };
    },

    /** A change to show for approval. Nothing is written until apply(), which refuses if the file changed meanwhile. */
    async prepareEdit({ folder, path, old_text: oldText, new_text: newText }) {
      const { real } = await place(folder, path);
      if (!real) throw new InputError(`${path} does not exist. Use write_file to create it.`);
      const { buffer, text, bom } = await textFile(real, path);
      // Models write LF; a file with CRLF line ends keeps them.
      const crlf = text.includes('\r\n'), fit = value => crlf ? value.replace(/\r?\n/g, '\r\n') : value;
      let find = oldText, at = text.indexOf(find);
      if (at < 0 && crlf) { find = fit(oldText); at = text.indexOf(find); }
      if (at < 0) throw new InputError(`old_text was not found in ${path}. Read the file again and copy the text exactly, indentation included.`);
      let count = 0;
      for (let next = at; next >= 0 && count < 100; next = text.indexOf(find, next + 1)) count++;
      if (count > 1) throw new InputError(`old_text occurs ${count} times in ${path}; include more surrounding lines so that it occurs once.`);
      const replacement = find === oldText ? newText : fit(newText);
      return proposal(path, real, buffer, text, text.slice(0, at) + replacement + text.slice(at + find.length), bom);
    },
    async prepareWrite({ folder, path, content }) {
      const { real, target } = await place(folder, path);
      if (!real) return proposal(path, target, null, null, content, false);
      const { buffer, text, bom } = await textFile(real, path);
      return proposal(path, real, buffer, text, content, bom);
    },
    async apply(change) {
      if (change.hash) {
        let current;
        try { current = await readFile(change.real); } catch { throw new InputError(`${change.path} was moved or deleted after this change was proposed; nothing was written.`); }
        if (sha256(current) !== change.hash) throw new InputError(`${change.path} changed after this change was proposed; nothing was written. Read it again.`);
      } else {
        try { await lstat(change.real); throw new InputError(`${change.path} was created by something else after this change was proposed; nothing was written.`); }
        catch (error) { if (error instanceof InputError) throw error; if (error?.code !== 'ENOENT') throw error; }
        await mkdir(dirname(change.real), { recursive: true });
      }
      // Written beside the file and renamed over it, so a failure never leaves half a file.
      const temp = join(dirname(change.real), `.${basename(change.real)}.${randomUUID()}.tmp`);
      try { await writeFile(temp, (change.bom ? '\uFEFF' : '') + change.content, { flag: 'wx' }); await rename(temp, change.real); }
      catch (error) { await rm(temp, { force: true }).catch(() => {}); throw error; }
      return change.summary;
    },

    /** Runs one approved command. stdin is closed; a timeout or Stop ends the process tree (best effort: a process that
     * detached itself from the tree can survive). */
    async run({ folder, shell, workdir, command, timeout_seconds: timeout, signal, onOutput }) {
      const { real } = await place(folder, workdir);
      if (!real || !(await stat(real)).isDirectory()) throw new InputError(`workdir ${workdir} is not a folder inside the workspace.`);
      const env = childEnvironment();
      let file, args;
      if (shell === 'bash') {
        if (!tools.gitBash) throw new InputError('Git Bash was not found. Install Git for Windows, or choose PowerShell in Advanced.');
        // The command travels in a variable, so no quoting on the command line can change it.
        file = tools.gitBash; args = ['-c', 'eval "$WORKBENCH_COMMAND"']; env.WORKBENCH_COMMAND = command;
      } else {
        const script = `${POWERSHELL_PRELUDE}${command}\nif ($LASTEXITCODE) { exit $LASTEXITCODE }\n`;
        file = powershell; args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
      }
      if (signal?.aborted) throw new InputError('Command cancelled.');
      const started = Date.now(), out = collector(), err = collector();
      let timedOut = false, stopped = false;
      const child = spawn(file, args, { cwd: real, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const kill = () => {
        if (!child.pid || child.exitCode !== null) return;
        spawn(join(systemRoot, 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' }).on('error', () => child.kill());
      };
      const timer = setTimeout(() => { timedOut = true; kill(); }, timeout * 1000);
      const abort = () => { stopped = true; kill(); };
      signal?.addEventListener('abort', abort, { once: true });
      let latest = 0;
      const report = () => { const now = Date.now(); if (onOutput && now - latest > 250) { latest = now; onOutput({ stdout: out.text(), stderr: readableStderr(err.text()) }); } };
      child.stdout.on('data', chunk => { out.add(chunk); report(); });
      child.stderr.on('data', chunk => { err.add(chunk); report(); });
      let code;
      try { code = await new Promise((done, fail) => { child.once('error', fail); child.once('close', done); }); }
      catch (error) { throw new InputError(error?.code === 'ENOENT' ? `${shell === 'bash' ? 'Git Bash' : 'PowerShell'} was not found at ${file}.` : `The command could not start (${error?.code ?? 'error'}).`); }
      finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
      const note = timedOut ? `\nStopped after ${timeout} seconds (the timeout).` : stopped ? '\nStopped by the user.' : '';
      return { stdout: out.text(), stderr: readableStderr(err.text()) + note, exitCode: timedOut || stopped ? null : code, timedOut, stopped,
        truncated: out.dropped > 0 || err.dropped > 0, elapsedMs: Date.now() - started };
    },
  };
  return tools;
}

function proposal(path, real, buffer, before, after, bom) {
  let diff = unifiedDiff(path, before, after);
  const { added, removed } = diffCounts(diff);
  if (diff.length > 299_000) diff = diff.slice(0, 299_000) + '\n… the rest of the diff is not shown';
  const verb = before === null ? 'Created' : 'Changed';
  return { path, real, hash: buffer ? sha256(buffer) : null, content: after, bom, diff,
    summary: `${verb} ${path}: ${added} ${added === 1 ? 'line' : 'lines'} added, ${removed} removed.` };
}
