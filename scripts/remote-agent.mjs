#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

// Operator CLI only: never imported into the renderer or exposed as generic IPC.
// SSH config/key handling remains native OpenSSH, outside conversations and models.
const [host, operation, id, ...extra] = process.argv.slice(2);
if (!host || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(host)) {
  console.error('Usage: node scripts/remote-agent.mjs SSH_ALIAS create|list|jobs|cleanup|status|result|stop|archive|delete|submit|auth-status|disconnect-chat [ID] [options]');
  process.exit(2);
}
let request;
switch (operation) {
  case 'create': case 'list': case 'jobs': case 'cleanup': case 'auth-status': case 'disconnect-chat':
    request = { op: operation }; break;
  case 'status': case 'result': case 'stop': case 'archive': request = { op: operation, id }; break;
  case 'set-model': request = { op: 'set-model', model: id }; break;
  case 'delete': case 'delete-job':
    if (extra[0] !== '--confirm-delete') throw new Error('Deleting workspace files requires --confirm-delete. Archive first if you need them.');
    request = { op: operation, id, confirm: id }; break;
  case 'submit': {
    const [model, promptFile, policy] = extra;
    if (!model || !promptFile || policy !== '--workspace-auto') throw new Error('submit WORKSPACE_ID MODEL PROMPT_FILE --workspace-auto');
    request = { op: 'submit', workspace: id, model, prompt: await readFile(promptFile, 'utf8'), policy: 'workspace-auto' }; break;
  }
  default: throw new Error('Unknown operation.');
}
const child = spawn('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
  '-o', 'ConnectTimeout=10', host, '/usr/local/bin/tinfoil-workbench'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
child.stdin.on('error', () => {});
child.stdin.end(JSON.stringify(request));
child.on('error', () => { console.error('SSH could not start.'); process.exitCode = 1; });
child.on('close', code => { process.exitCode = code ?? 1; });
