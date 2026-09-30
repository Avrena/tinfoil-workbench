/** Live check of the workspace agent with real models (docs/WORKSPACE-AGENT.md). Manual: it needs a Tinfoil Chat
 * account and a person to sign in. Run `npx electron tests/agent-live.mjs [--log <file>] [--models kimi,glm,deepseek]`.
 *
 * The real app runs from source with a temporary profile; the tester signs in in the Account view. For each model, two
 * tasks run in fresh copies of a small Node project with one failing test, in new local conversations at temperature 0:
 *   1. "What does this project do, and how are its tests run?" (reading only);
 *   2. "One of the tests fails. Find out why, make it pass, and run the tests again."
 * The harness stands in for the tester's approvals. Changes are approved: the file tools already confine them to the
 * project. A command is approved only when it names no path outside the project and is not a deletion, network,
 * install, git history or system command; anything else is declined, which the model is told. Every decision is logged
 * with the command. Nothing outside the temporary project is run on purpose, but an approved command runs with the
 * tester's permissions, as in the app.
 *
 * Output is JSON lines: per run the calls by tool, the approvals and declines, the reply's status, token usage and
 * time, the answer's opening, and for the second task whether the project's tests pass afterwards (checked by running
 * them here). Tokens, messages of other conversations and account details are never logged. Runs stop once 900,000
 * input tokens are spent, and a single reply is stopped above 300,000. The account is signed out at the end; delete the
 * temporary profile afterwards. */
import { app, dialog, BrowserWindow } from 'electron';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, appendFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { AccountSession } from '../desktop/account-session.mjs';
import { WorkbenchService } from '../desktop/service.mjs';
import { agentArguments, outsidePaths } from '../dist/core/agent.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const option = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const profile = mkdtempSync(join(tmpdir(), 'tinfoil-agent-live-'));
app.setPath('userData', profile);
const logFile = option('--log'), wanted = (option('--models') ?? 'kimi,glm,deepseek').split(',');
const secrets = new Set();
let service = null, stage = 'start';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function log(step, data = {}) {
  const line = JSON.stringify({ at: new Date().toISOString(), step, ...data });
  for (const s of secrets) if (s && line.includes(s)) throw new Error('A log line contained a secret and was not written.');
  console.log(line); if (logFile) appendFileSync(logFile, line + '\n');
}
const wrap = (proto, name, around) => { const original = proto[name]; proto[name] = function (...args) { return around.call(this, original, args); }; };
wrap(AccountSession.prototype, 'accept', function (original, [raw, expected]) { if (typeof raw?.bearer === 'string' && raw.bearer) secrets.add(raw.bearer); return original.call(this, raw, expected); });
wrap(WorkbenchService.prototype, 'initialize', function (original, args) { service = this; return original.apply(this, args); });
// The only native dialog the harness answers is its own final sign-out.
dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });

const main = () => BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.getURL().startsWith('app://workbench'));
const js = code => main().webContents.executeJavaScript(code, true);
const command = c => js(`window.tinfoil.command(${JSON.stringify(c)})`);
async function until(label, ready, ms, every = 500) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await ready()) return; await sleep(every); }
  throw new Error('Timed out waiting for ' + label + '.');
}
const git = (...args) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); } catch { return null; } };

const FILES = {
  'package.json': JSON.stringify({ name: 'cart-totals', version: '1.0.0', private: true, type: 'module', description: 'Totals for a small shopping cart.', scripts: { test: 'node --test' } }, null, 2) + '\n',
  'README.md': '# cart-totals\n\nComputes the total and the average price of a shopping cart.\n\nRun the tests with `npm test`.\n',
  'AGENTS.md': 'Keep the functions in src/ small and pure. Run `npm test` after a change.\n',
  'src/sum.js': 'export function sum(values) {\n  return values.reduce((total, value) => total + value);\n}\n',
  'src/average.js': "import { sum } from './sum.js';\n\nexport function average(values) {\n  return values.length ? sum(values) / values.length : 0;\n}\n",
  'src/cart.js': "import { sum } from './sum.js';\n\nexport function cartTotal(items) {\n  return sum(items.map(item => item.price * item.quantity));\n}\n",
  'test/cart.test.js': "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { sum } from '../src/sum.js';\nimport { cartTotal } from '../src/cart.js';\n\ntest('sum adds numbers', () => assert.equal(sum([1, 2, 3]), 6));\ntest('a cart with two items', () => assert.equal(cartTotal([{ price: 2, quantity: 3 }, { price: 5, quantity: 1 }]), 11));\ntest('an empty cart costs nothing', () => assert.equal(cartTotal([]), 0));\n",
};
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'workbench-agent-project-'));
  for (const [path, text] of Object.entries(FILES)) { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); }
  return dir;
}
function hashes(dir) {
  const out = {};
  const visit = d => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules') visit(p); } else out[relative(dir, p).replaceAll('\\', '/')] = createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 12); } };
  visit(dir); return out;
}
const testsPass = dir => spawnSync(process.platform === 'win32' ? 'node.exe' : 'node', ['--test'], { cwd: dir, encoding: 'utf8', timeout: 60_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } }).status === 0;

// The tester's stand-in: a change is approved; a command only when it names nothing outside the project and is not a
// deletion, network, install, git history or system command.
const DENY = /\b(remove-item|rm|rmdir|rd|del|erase|format-volume|set-executionpolicy|invoke-webrequest|invoke-restmethod|iwr|irm|curl|wget|start-process|shutdown|restart-computer|reg|set-itemproperty|new-service|schtasks|winget|choco|pip|npx)\b|\bgit\s+(push|pull|fetch|reset|clean|checkout|commit|remote|rebase|merge)\b|\bnpm\s+(install|i|ci|publish|update|add|uninstall)\b/i;
function decide(tool) {
  if (tool.name !== 'run_command') return { approve: true };
  const args = agentArguments('run_command', tool.arguments), outside = outsidePaths(args.command, tool.agent.folder, args.workdir);
  if (outside.length) return { approve: false, why: 'names ' + outside.join(', ') };
  if (DENY.test(args.command)) return { approve: false, why: 'denied command' };
  return { approve: true };
}

const TASKS = [
  { id: 'explain', text: 'What does this project do, and how are its tests run? Do not change anything.' },
  { id: 'fix', text: 'One of the tests fails. Find out why, make it pass, and run the tests again.' },
];
const MODELS = { kimi: /^kimi-k3$/, glm: /^glm-5[.-]3$/, deepseek: /^deepseek-v4-pro$/ };
let spentInput = 0, spentOutput = 0;

async function runTask(model, task) {
  const dir = project(), before = hashes(dir);
  await command({ type: 'thread.new', projectId: null });
  const id = service.workspace.activeId, t = () => service.workspace.threads.find(x => x.id === id);
  await command({ type: 'thread.rename', id, title: `Agent live · ${model} · ${task.id}` });
  await command({ type: 'thread.settings', id, settings: { ...t().settings, model, temperature: 0, compare: false, visualTools: false, webSearch: false, toolsMode: 'off', delegateMode: 'off', agentMode: 'ask', agentShell: 'powershell' } });
  await service.setAgentFolder(id, dir);
  const decisions = [], started = Date.now();
  await command({ type: 'send', id, text: task.text, attachments: [] });
  let stopped = false;
  while (service.busyThreadId === id) {
    for (const pending of [...service.approvals.values()]) {
      if (pending.threadId !== id) continue;
      const verdict = decide(pending.tool);
      decisions.push({ tool: pending.tool.name, approve: verdict.approve, ...(verdict.why ? { why: verdict.why } : {}),
        ...(pending.tool.name === 'run_command' ? { command: agentArguments('run_command', pending.tool.arguments).command.slice(0, 200) } : { path: JSON.parse(pending.tool.arguments).path }) });
      await service.execute({ type: 'tool.approve', id, toolId: pending.tool.id, approve: verdict.approve });
    }
    const usage = t().turns.at(-1)?.replies[0]?.usage;
    if (!stopped && usage && usage.input > 300_000) { stopped = true; await command({ type: 'stop', id }); log('stopped-over-budget', { model, task: task.id, input: usage.input }); }
    if (Date.now() - started > 20 * 60_000 && !stopped) { stopped = true; await command({ type: 'stop', id }); log('stopped-over-time', { model, task: task.id }); }
    await sleep(250);
  }
  const reply = t().turns.at(-1).replies[0], tools = reply.tools ?? [], after = hashes(dir);
  const calls = {}; for (const tool of tools) calls[tool.name] = (calls[tool.name] ?? 0) + 1;
  const changed = Object.keys({ ...before, ...after }).filter(k => before[k] !== after[k]);
  const usage = reply.usage ?? { input: 0, output: 0 }; spentInput += usage.input; spentOutput += usage.output;
  log('run', { model, task: task.id, status: reply.status, error: reply.error, rounds: (reply.toolMessages ?? []).filter(m => m.role === 'assistant').length,
    calls, failedCalls: tools.filter(x => x.status === 'error').map(x => ({ tool: x.name, error: x.stderr.slice(0, 160) })), decisions,
    changedFiles: changed, testsPassAfter: task.id === 'fix' ? testsPass(dir) : undefined,
    textFormCalls: /\b(run_command|read_file|edit_file|list_files|write_file)\s*[({]/.test(reply.content), seconds: Math.round((Date.now() - started) / 1000),
    usage, spent: { input: spentInput, output: spentOutput }, answer: reply.content.slice(-700) });
  rmSync(dir, { recursive: true, force: true });
}

async function run() {
  await until('the service', () => !!service, 60_000);
  await until('the window', () => !!main() && !main().webContents.isLoading(), 60_000);
  log('start', { commit: git('rev-parse', 'HEAD'), uncommittedChanges: !!git('status', '--porcelain'), electron: process.versions.electron, agentTools: !!service.agentTools, models: wanted });
  await js(`document.getElementById('account-footer').click()`);
  log('waiting-for-tester', { steps: ['Sign in to Tinfoil Chat in the Account view'] });
  stage = 'sign-in'; await until('sign-in', () => service.options.account.snapshot().status === 'signed-in', 30 * 60_000, 1000);
  log('signed-in', { entitlement: service.options.account.snapshot().entitlement });
  await js(`document.querySelector('#account-dialog')?.close()`).catch(() => {});
  stage = 'models'; await until('the model list', () => service.models.length > 0, 180_000, 1000);
  const chosen = wanted.map(name => [name, service.models.find(m => MODELS[name]?.test(m))]);
  log('models', { chosen: Object.fromEntries(chosen), available: service.models.length });
  for (const [name, model] of chosen) {
    if (!model) { log('skipped', { model: name, reason: 'not in the model list' }); continue; }
    for (const task of TASKS) {
      if (spentInput > 900_000) { log('skipped', { model, task: task.id, reason: 'the input budget is spent' }); continue; }
      stage = `${model} ${task.id}`; await runTask(model, task);
    }
  }
  stage = 'finish';
  await command({ type: 'account.signout' }); await until('sign-out', () => service.options.account.snapshot().status === 'signed-out', 30_000);
  log('finished', { spent: { input: spentInput, output: spentOutput }, profile });
}
app.whenReady().then(() => run()).catch(error => log('failed', { stage, message: String(error?.message ?? error).slice(0, 300), status: error?.status ?? null, code: error?.code ?? null })).finally(() => setTimeout(() => app.quit(), 1500));
