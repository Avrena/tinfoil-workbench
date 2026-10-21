import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { createAgentTools } from '../desktop/agent-tools.mjs';
import { agentArguments } from '../dist/core/agent.js';

// Runs only INSIDE the disposable, non-root tool container. No host credentials,
// Docker socket, or controller state is mounted here.
export async function runCommand(args, folder = '/workspace') {
  const base = await realpath(folder), cwd = await realpath(resolve(base, args.workdir));
  const rel = relative(base, cwd);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Working directory leaves the workspace.');
  const started = Date.now();
  const child = spawn('/bin/bash', ['--noprofile', '--norc', '-c', args.command], {
    cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', HOME: '/workspace/.home',
      LANG: 'C.UTF-8', TMPDIR: '/tmp', PIP_DISABLE_PIP_VERSION_CHECK: '1' },
  });
  let timedOut = false, dropped = false;
  const streams = [child.stdout, child.stderr].map(stream => {
    const decoder = new StringDecoder('utf8'); let head = '', tail = '';
    stream.on('data', chunk => {
      let value = decoder.write(chunk);
      const take = Math.max(0, 59000 - head.length);
      head += value.slice(0, take); tail += value.slice(take);
      if (tail.length > 40000) { dropped = true; tail = tail.slice(-40000); }
    });
    return () => head + (dropped ? '\n… output shortened …\n' : '') + tail + decoder.end();
  });
  const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
  const timer = setTimeout(() => { timedOut = true; kill(); }, args.timeout_seconds * 1000);
  let exitCode;
  try { exitCode = await new Promise((yes, no) => { child.on('error', no); child.on('close', yes); }); }
  finally { clearTimeout(timer); kill(); }
  return { stdout: streams[0](), stderr: streams[1](), exitCode,
    elapsedMs: Date.now() - started, timedOut, stopped: false, truncated: dropped };
}

export async function executeTool(name, raw, folder = '/workspace') {
  const args = agentArguments(name, raw), tools = createAgentTools();
  const params = { ...args, folder };
  if (name === 'run_command') return runCommand(args, folder);
  if (name === 'list_files') return tools.list(params);
  if (name === 'read_file') return tools.read(params);
  if (name === 'search_files') return tools.search(params);
  if (name === 'update_plan') return { text: JSON.stringify(args.steps) };
  const change = name === 'edit_file' ? await tools.prepareEdit(params) : await tools.prepareWrite(params);
  return { text: await tools.apply(change), diff: change.diff };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk; if (input.length > 400000) throw new Error('Tool request too large.');
    }
    const request = JSON.parse(input);
    const result = await executeTool(request.name, request.arguments);
    process.stdout.write(JSON.stringify({ ok: true, result }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: String(error.message).slice(0, 2000) }));
    process.exitCode = 1;
  }
}
