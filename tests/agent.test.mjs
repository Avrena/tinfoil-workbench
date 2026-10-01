import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { AGENT_LIMITS, AGENT_TOOLS, agentArguments, agentFolderName, agentGuide, askAnyway, commandRisk, compactAgentHistory, diffCounts, globMatcher, madeFolder, outsidePaths, searchPattern, shortenOutput, unifiedDiff, workspacePath } from '../dist/core/agent.js';
import { agentEnvironment, toolGuide, withToolGuide } from '../dist/core/prompt.js';
import { changeApproval, commandApproval, confirmation, pythonApproval } from '../dist/core/approval.js';
import { validateWorkspace } from '../dist/core/validation.js';
import { exportMarkdown, forkThread, newThread } from '../dist/core/workspace.js';
import { createAgentTools, readableStderr, unsafeFolder } from '../desktop/agent-tools.mjs';
import { WorkbenchService, AGENT_CLOUD, AGENT_UNAVAILABLE } from '../desktop/service.mjs';

const windows = { skip: process.platform !== 'win32' && 'the workspace agent runs on Windows' };
const scratch = (t, prefix = 'workbench-agent-') => { const dir = mkdtempSync(join(tmpdir(), prefix)); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };

// ---- What the model is offered, and the checks on what it asks for (core/agent.ts) ----------------------------------

test('what the approval window shows is built from the call: the command, where and how it runs, and the paths outside', () => {
  const command = commandApproval("Get-Content -LiteralPath 'C:\\Users\\Ada\\notes.md'", 'D:\\Work\\demo', 'src/app', 'powershell', 90);
  assert.equal(command.text, "Get-Content -LiteralPath 'C:\\Users\\Ada\\notes.md'"); assert.equal(command.kind, 'command');
  assert.deepEqual(command.facts, ['Runs in D:\\Work\\demo\\src\\app', 'Windows PowerShell 5.1 · stopped after 90 seconds']);
  assert.deepEqual(command.outside, ['C:\\Users\\Ada\\notes.md']); assert.deepEqual([command.decline, command.approve], ['Do not run', 'Run this command once']);
  const change = changeApproval('write_file', 'a.txt', 'D:\\Work\\demo', '--- a/a.txt\n+++ b/a.txt\n@@ -0,0 +1 @@\n+hello\n');
  assert.deepEqual(change.diff, ['@@ -0,0 +1 @@', '+hello']); assert.deepEqual([change.title, change.approve], ['Write a.txt?', 'Write this file']);
  assert.deepEqual(change.facts, ['1 line added, 0 removed', 'In D:\\Work\\demo']); assert.deepEqual(change.outside, []);
  const long = changeApproval('edit_file', 'b.txt', 'D:\\W', '--- a/b.txt\n+++ b/b.txt\n' + Array.from({ length: 2100 }, (_, i) => '+' + i).join('\n') + '\n');
  assert.equal(long.diff.length, 2001); assert.match(long.diff.at(-1), /^… 100 more lines, shown in the conversation$/);
  const python = pythonApproval('print(1)', 'C:\\Python\\python.exe');
  assert.equal(python.text, 'print(1)'); assert.deepEqual(python.facts, ['Interpreter: C:\\Python\\python.exe']); assert.match(python.warning, /^Not a sandbox/);
});

test('paths from the model stay relative to the folder by their words alone', () => {
  assert.equal(workspacePath(undefined), '.'); assert.equal(workspacePath('./src\\app.ts'), 'src/app.ts'); assert.equal(workspacePath('src//x/./y'), 'src/x/y'); assert.equal(workspacePath(' name '), 'name');
  for (const bad of ['..', 'src/../../x', 'C:\\Windows', 'c:x', '/etc/passwd', '\\\\server\\share', 'file.txt:stream', 'CON', 'src/nul.txt', 'com1', 'name.', 'a*b', 'a?b', 'x'.repeat(1025), 'a\u0000b'])
    assert.throws(() => workspacePath(bad), /Path/, bad);
});

test('agent arguments are checked per tool, with defaults and limits', () => {
  assert.deepEqual(agentArguments('read_file', '{"path":"a.txt"}'), { name: 'read_file', path: 'a.txt', start_line: 1, max_lines: 400 });
  assert.deepEqual(agentArguments('list_files', '{}'), { name: 'list_files', path: '.', depth: 2 });
  assert.deepEqual(agentArguments('run_command', '{"command":"git status"}'), { name: 'run_command', command: 'git status', workdir: '.', timeout_seconds: 120 });
  assert.equal(agentArguments('update_plan', '{"steps":[{"text":" Read  the code ","status":"in_progress"}]}').steps[0].text, 'Read the code');
  for (const [name, args, message] of [['read_file', '{"path":"a","extra":1}', /does not take extra/], ['read_file', '{"path":"a","max_lines":1001}', /max_lines/],
    ['run_command', '{"command":"  "}', /command/], ['run_command', `{"command":"${'x'.repeat(8001)}"}`, /command/], ['run_command', '{"command":"ls","timeout_seconds":601}', /timeout_seconds/],
    ['run_command', '{"command":"ls","workdir":"../up"}', /workdir cannot go above/], ['edit_file', '{"path":"a","old_text":"x","new_text":"x"}', /same/], ['edit_file', '{"path":".","old_text":"x","new_text":"y"}', /file path/],
    ['search_files', '{"pattern":"/(/"}', /regular expression/], ['search_files', '{"pattern":"x","glob":"../*"}', /glob/], ['update_plan', '{"steps":[]}', /steps/],
    ['update_plan', '{"steps":[{"text":"x","status":"done"}]}', /status/], ['delete_files', '{}', /not a workspace agent tool/], ['read_file', 'not json', /invalid read_file/]])
    assert.throws(() => agentArguments(name, args), message, `${name} ${args.slice(0, 40)}`);
  assert.deepEqual(AGENT_TOOLS.map(t => t.function.name), ['list_files', 'search_files', 'read_file', 'edit_file', 'write_file', 'run_command', 'update_plan']);
});

test('search patterns are plain text or /regex/, and globs match names or paths', () => {
  assert.ok(searchPattern('todo').test('A TODO item')); assert.ok(!searchPattern('Todo').test('a todo item')); assert.ok(searchPattern('a.b').test('a.b')); assert.ok(!searchPattern('a.b').test('axb'));
  assert.ok(searchPattern('/^export\\s+const/').test('export  const x')); assert.throws(() => searchPattern('/x/g'), /flags/);
  assert.ok(globMatcher('*.ts')('src/deep/app.ts')); assert.ok(!globMatcher('*.ts')('src/app.tsx')); assert.ok(globMatcher('src/**/*.py')('src/a/b/c.py')); assert.ok(!globMatcher('src/*.py')('src/a/c.py'));
});

test('the approval points out paths outside the folder that a command names', () => {
  const folder = 'D:\\Projects\\demo';
  assert.deepEqual(outsidePaths("Get-Content -LiteralPath 'C:\\Users\\Ada\\Downloads\\接收条件.md' -Encoding UTF8", folder), ['C:\\Users\\Ada\\Downloads\\接收条件.md']);
  assert.deepEqual(outsidePaths('type D:\\Projects\\demo\\src\\a.txt; git -C "D:\\Projects\\demo" status', folder), []);
  assert.deepEqual(outsidePaths('git -C "D:\\Projects\\demo two\\x" status', folder), ['D:\\Projects\\demo two\\x'], 'a sibling folder with a longer name is outside');
  assert.deepEqual(outsidePaths('cat /c/Users/ada/.ssh/id_rsa | head', folder), ['C:\\Users\\ada\\.ssh\\id_rsa']);
  assert.deepEqual(outsidePaths('ls /d/Projects/demo/src && grep -r x /usr/bin', folder), []);
  assert.deepEqual(outsidePaths('Copy-Item x \\\\server\\share\\y', folder), ['\\\\server\\share\\y']);
  assert.deepEqual(outsidePaths('Get-ChildItem $env:USERPROFILE\\.aws', folder), ['your home or app data folder']);
  assert.deepEqual(outsidePaths('cat ~/.gitconfig', folder), ['your home or app data folder']);
  assert.deepEqual(outsidePaths('Remove-Item -Recurse ..\\..\\other', folder, 'src'), ['.. above the workspace folder']);
  assert.deepEqual(outsidePaths('cd ..; npm test', folder, 'src'), [], 'one level up from src is still the folder');
  assert.deepEqual(outsidePaths('curl https://example.com/a/b -o out.txt', folder), []);
});

test('long output keeps its start and its end, where errors usually are', () => {
  const text = 'a'.repeat(10000) + 'b'.repeat(5000) + 'END';
  const short = shortenOutput(text); assert.ok(short.startsWith('a'.repeat(4000))); assert.ok(short.endsWith('END')); assert.match(short, /\[3,003 characters left out\]/);
  assert.equal(shortenOutput('short'), 'short');
});

test('diffs show the changed lines with context, and a new file as all added', () => {
  const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n', after = before.replace('line 10\n', 'line ten\n');
  const diff = unifiedDiff('src/a.txt', before, after);
  assert.equal(diff, '--- a/src/a.txt\n+++ b/src/a.txt\n@@ -7,7 +7,7 @@\n line 7\n line 8\n line 9\n-line 10\n+line ten\n line 11\n line 12\n line 13\n');
  assert.deepEqual(diffCounts(diff), { added: 1, removed: 1 });
  assert.equal(unifiedDiff('new.md', null, '# Title\n'), '--- /dev/null\n+++ b/new.md\n@@ -0,0 +1,1 @@\n+# Title\n');
  assert.equal(unifiedDiff('same.txt', 'x\n', 'x\n'), '--- a/same.txt\n+++ b/same.txt\n');
});

test('the agent guide depends only on the shell, sits in the tool guide, and the environment follows it escaped', () => {
  assert.equal(agentGuide('powershell'), agentGuide('powershell')); assert.notEqual(agentGuide('powershell'), agentGuide('bash'));
  assert.match(agentGuide('powershell'), /-LiteralPath/); assert.match(agentGuide('bash'), /Git Bash/);
  assert.match(agentGuide('powershell'), /run npm\.cmd/); assert.doesNotMatch(agentGuide('bash'), /npm\.cmd/);
  assert.match(toolGuide({ visual: false, python: false, agent: 'powershell' }), /<workbench_tools>[\s\S]*<workspace_agent>[\s\S]*<\/workspace_agent>\n<\/workbench_tools>/);
  assert.doesNotMatch(toolGuide({ visual: true, python: false }), /workspace_agent/);
  const environment = agentEnvironment('C:\\Projects\\a<b>', 'bash');
  assert.match(environment, /folder: C:\\Projects\\a&lt;b&gt;\nfolder origin: a folder the user chose for this conversation\nshell: Git Bash\napprovals: the user approves every command and every file change first;/);
  assert.match(agentGuide('powershell'), /When a message does not need them \(a greeting/);
  const [system] = withToolGuide([{ role: 'system', content: 'Mine' }], `${toolGuide({ visual: false, python: false, agent: 'bash' })}\n\n${environment}`);
  assert.ok(system.content.indexOf('</workbench_tools>') < system.content.lastIndexOf('<environment>\nfolder') &&system.content.endsWith('</environment>\n\nMine'));
});

test('older agent results are sent as excerpts, and other tools are left alone', () => {
  const call = (id, name) => ({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: '{}' } }] });
  const messages = [{ role: 'user', content: 'go' }];
  for (let i = 0; i < 12; i++) messages.push(call('c' + i, i === 0 ? 'python' : 'read_file'), { role: 'tool', tool_call_id: 'c' + i, content: 'x'.repeat(3000) });
  const sent = compactAgentHistory(messages), tools = sent.filter(m => m.role === 'tool');
  assert.equal(tools[0].content.length, 3000, 'Python results are not shortened');
  assert.match(tools[1].content, /"shortened":true/); assert.equal(JSON.parse(tools[1].content).excerpt.length, 1000);
  assert.equal(tools.slice(2).every(m => m.content.length === 3000), true, 'the last ten agent results stay whole');
  assert.equal(messages[4].content.length, 3000, 'the conversation keeps them whole');
});

test('a new conversation starts without the agent, and a branch keeps it with its folder', () => {
  const source = newThread(); Object.assign(source.settings, { agentMode: 'ask', agentShell: 'bash' }); source.agentFolder = 'D:\\Projects\\demo';
  assert.equal(newThread(source.settings).settings.agentMode, 'off'); assert.equal(newThread(source.settings).settings.agentShell, 'bash');
  source.turns = [{ id: 'turn-1', prompt: 'Hello', attachments: [], createdAt: 1, selectedReplyId: 'reply-1', replies: [{ id: 'reply-1', model: 'm', lane: 'primary', content: 'Hi', reasoning: '', status: 'complete', createdAt: 1 }] }];
  const workspace = { threads: [source], projects: [], activeId: source.id };
  const branch = forkThread(workspace, source.id, 'turn-1', false);
  assert.equal(branch.settings.agentMode, 'ask'); assert.equal(branch.agentFolder, 'D:\\Projects\\demo');
});

test('folders that hold keys, app data or the system cannot be the agent folder', windows, () => {
  const env = { USERPROFILE: 'C:\\Users\\Ada', APPDATA: 'C:\\Users\\Ada\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\Ada\\AppData\\Local', SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', ProgramData: 'C:\\ProgramData' };
  for (const [folder, reason] of [['C:\\', /drive/], ['D:\\', /drive/], ['C:\\Users\\Ada', /home/], ['C:\\Users', /home/], ['C:\\Users\\Ada\\AppData\\Roaming\\Tinfoil Workbench', /application data/],
    ['C:\\Users\\Ada\\AppData', /application data/], ['C:\\Windows\\System32', /system/], ['C:\\Program Files\\Git', /system/]])
    assert.match(unsafeFolder(folder, env) ?? '', reason, folder);
  for (const folder of ['C:\\Users\\Ada\\Projects\\demo', 'D:\\Projects\\demo', 'C:\\Users\\Ada\\Documents']) assert.equal(unsafeFolder(folder, env), null, folder);
});

test('a new folder is named after the date, the start of the message and the conversation', () => {
  const day = new Date(2026, 8, 30, 12);
  assert.equal(agentFolderName('Fix the failing cart test', day, '3F2A9c1e-0000'), '2026-09-30 Fix the failing cart test 3f2a');
  assert.equal(agentFolderName('读取 C:\\Users\\a.md: why?  <now>', day, 'ab-cd'), '2026-09-30 读取 C Users a.md why now abcd');
  assert.equal(agentFolderName('Done...', day, 'x1'), '2026-09-30 Done x1');
  assert.equal(agentFolderName(' \n ', day, 'x1'), '2026-09-30 Conversation x1');
  assert.equal(agentFolderName('一'.repeat(60), day, 'x1'), `2026-09-30 ${'一'.repeat(40)} x1`);
});

test('PowerShell errors written as CLIXML become plain lines', () => {
  const clixml = '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><S S="Error">Get-Item : Cannot find path &apos;x&apos;._x000D__x000A_</S><S S="Warning">careful_x000D__x000A_</S></Objs>';
  assert.equal(readableStderr(clixml), "Get-Item : Cannot find path 'x'.\r\nWARNING: careful\r\n");
  assert.equal(readableStderr('plain error\n'), 'plain error\n');
});

// ---- Files and commands on Windows (desktop/agent-tools.mjs) ---------------------------------------------------------

test('reads, lists and searches stay inside the folder, links and junctions included', windows, async t => {
  const dir = scratch(t), outside = scratch(t, 'workbench-outside-');
  writeFileSync(join(dir, 'a.txt'), 'alpha\r\nbeta\r\n中文 gamma\r\n'); mkdirSync(join(dir, 'src')); writeFileSync(join(dir, 'src', 'x.ts'), 'export const beta = 1;\n');
  mkdirSync(join(dir, 'node_modules')); writeFileSync(join(dir, 'node_modules', 'dep.js'), 'beta'); writeFileSync(join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 98, 101, 116, 97]));
  writeFileSync(join(outside, 'secret.txt'), 'beta secret'); symlinkSync(outside, join(dir, 'escape'), 'junction');
  const tools = createAgentTools();
  assert.equal((await tools.list({ folder: dir, path: '.', depth: 2 })).text, 'node_modules/ (not listed)\nsrc/\nsrc/x.ts\na.txt\nbin.dat\nescape (link, not followed)');
  assert.equal((await tools.read({ folder: dir, path: 'a.txt', start_line: 2, max_lines: 5 })).text, 'a.txt · lines 2–3 of 3\n2\tbeta\n3\t中文 gamma\n');
  assert.equal((await tools.search({ folder: dir, pattern: 'beta', path: '.', glob: '' })).text, 'a.txt:2: beta\nsrc/x.ts:1: export const beta = 1;');
  assert.equal((await tools.search({ folder: dir, pattern: 'beta', path: '.', glob: '*.ts' })).text, 'src/x.ts:1: export const beta = 1;');
  await assert.rejects(tools.read({ folder: dir, path: 'escape/secret.txt', start_line: 1, max_lines: 5 }), /outside the workspace folder through a link or junction/);
  await assert.rejects(tools.list({ folder: dir, path: 'escape', depth: 1 }), /link or junction/);
  await assert.rejects(tools.read({ folder: dir, path: 'bin.dat', start_line: 1, max_lines: 5 }), /not a text file/);
  await assert.rejects(tools.read({ folder: dir, path: 'missing.txt', start_line: 1, max_lines: 5 }), /does not exist/);
  await assert.rejects(tools.read({ folder: join(dir, 'gone'), path: 'a.txt', start_line: 1, max_lines: 5 }), /no longer exists/);
});

test('an edit is shown before it is written, keeps CRLF line ends, and is refused once the file has changed', windows, async t => {
  const dir = scratch(t), file = join(dir, 'a.txt');
  writeFileSync(file, '\uFEFFone\r\ntwo\r\nthree\r\n');
  const tools = createAgentTools();
  const change = await tools.prepareEdit({ folder: dir, path: 'a.txt', old_text: 'two\nthree', new_text: 'TWO\nthree' });
  assert.equal(change.diff, '--- a/a.txt\n+++ b/a.txt\n@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n');
  assert.equal(readFileSync(file, 'utf8'), '\uFEFFone\r\ntwo\r\nthree\r\n', 'nothing is written before apply');
  assert.equal(await tools.apply(change), 'Changed a.txt: 1 line added, 1 removed.');
  assert.equal(readFileSync(file, 'utf8'), '\uFEFFone\r\nTWO\r\nthree\r\n');
  await assert.rejects(tools.apply(change), /changed after this change was proposed/);
  await assert.rejects(tools.prepareEdit({ folder: dir, path: 'a.txt', old_text: 'missing', new_text: 'x' }), /not found/);
  writeFileSync(join(dir, 'b.txt'), 'x = 1\nx = 1\n');
  await assert.rejects(tools.prepareEdit({ folder: dir, path: 'b.txt', old_text: 'x = 1', new_text: 'x = 2' }), /occurs 2 times/);
  const created = await tools.prepareWrite({ folder: dir, path: 'new/deep/c.md', content: '# C\n' });
  assert.match(created.diff, /^--- \/dev\/null/);
  assert.equal(await tools.apply(created), 'Created new/deep/c.md: 1 line added, 0 removed.');
  assert.equal(readFileSync(join(dir, 'new', 'deep', 'c.md'), 'utf8'), '# C\n');
  await assert.rejects(tools.apply(created), /created by something else/);
});

test('PowerShell commands run in the folder with UTF-8 output, their exit code and readable errors', windows, async t => {
  const dir = scratch(t); mkdirSync(join(dir, 'sub'));
  const tools = createAgentTools();
  const ran = await tools.run({ folder: dir, shell: 'powershell', workdir: 'sub', command: "Write-Output '中文 ✓'\n(Get-Location).Path\ncmd /c exit 7", timeout_seconds: 60 });
  assert.equal(ran.exitCode, 7); assert.match(ran.stdout, /^中文 ✓\r?\n.*sub\r?\n$/); assert.equal(ran.stderr, '');
  const failed = await tools.run({ folder: dir, shell: 'powershell', workdir: '.', command: 'Get-Item -LiteralPath nope.txt', timeout_seconds: 60 });
  assert.doesNotMatch(failed.stderr, /CLIXML/); assert.match(failed.stderr, /nope\.txt/); assert.match(failed.stderr, /:\s*1\b/, 'line numbers match the command');
  // Windows PowerShell 5.1 would read a UTF-8 file without a byte order mark in the system code page, and `>` would
  // write UTF-16; here both are UTF-8.
  writeFileSync(join(dir, '接收条件.md'), '# 接收条件\n第一条：测试。\n');
  const read = await tools.run({ folder: dir, shell: 'powershell', workdir: '.', command: "Get-Content -LiteralPath '接收条件.md'\n'写入 ✓' > out.txt", timeout_seconds: 60 });
  assert.equal(read.stdout, '# 接收条件\r\n第一条：测试。\r\n'); assert.equal(readFileSync(join(dir, 'out.txt'), 'utf8').replace(/^﻿/, ''), '写入 ✓\r\n');
  const env = await tools.run({ folder: dir, shell: 'powershell', workdir: '.', command: "(Get-ChildItem env: | Where-Object Name -like 'ELECTRON*').Count", timeout_seconds: 60 });
  assert.equal(env.stdout.trim(), '0');
  await assert.rejects(tools.run({ folder: dir, shell: 'powershell', workdir: '../x', command: 'ls', timeout_seconds: 5 }), /outside|not a folder/);
});

test('a timeout or Stop ends the command and its child processes', windows, async t => {
  const dir = scratch(t), tools = createAgentTools();
  const slow = await tools.run({ folder: dir, shell: 'powershell', workdir: '.', command: 'Start-Sleep -Seconds 30', timeout_seconds: 2 });
  assert.equal(slow.timedOut, true); assert.equal(slow.exitCode, null); assert.match(slow.stderr, /Stopped after 2 seconds/); assert.ok(slow.elapsedMs < 15000, String(slow.elapsedMs));
  const controller = new AbortController(); setTimeout(() => controller.abort(), 1500);
  const stopped = await tools.run({ folder: dir, shell: 'powershell', workdir: '.', command: "cmd /c 'ping -n 30 127.0.0.1 >nul'", timeout_seconds: 60, signal: controller.signal });
  assert.equal(stopped.stopped, true); assert.match(stopped.stderr, /Stopped by the user/); assert.ok(stopped.elapsedMs < 15000, String(stopped.elapsedMs));
});

test('Git Bash commands run with Git tools on the path, the command passed without quoting', windows, async t => {
  const tools = await createAgentTools().detect();
  if (!tools.gitBash) return t.skip('Git for Windows is not installed');
  const dir = scratch(t);
  const ran = await tools.run({ folder: dir, shell: 'bash', workdir: '.', command: `echo "it's \\"quoted\\" 中文"; command -v git >/dev/null && echo git-ok; exit 3`, timeout_seconds: 60 });
  assert.equal(ran.exitCode, 3); assert.equal(ran.stdout, 'it\'s "quoted" 中文\ngit-ok\n');
});

// ---- The service: offering, approving, limits (desktop/service.mjs) --------------------------------------------------

const wait = ms => new Promise(r => setTimeout(r, ms));
const done = async s => { while (s.tasks.size) await Promise.all([...s.tasks]); };
const nextApproval = async s => { for (let i = 0; i < 1000; i++) { if (s.approvals.size) return [...s.approvals.values()][0]; await wait(2); } throw Error('No approval requested'); };
const chunk = (delta, finish_reason) => ({ choices: [{ delta, finish_reason }] });
const call = (name, args, id = 'call_' + name) => chunk({ tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, 'tool_calls');
const answer = text => chunk({ content: text }, 'stop');
async function agentSetup(t, { script, run, mode = 'ask', folder = true, tools: withTools = true, python = null } = {}) {
  const dir = scratch(t, 'workbench-agent-service-');
  writeFileSync(join(dir, 'app.js'), 'const answer = 41;\nconsole.log(answer);\n');
  const requests = [], runs = []; let stored = null;
  const vault = { read: async () => null, write: async w => { stored = structuredClone(w); }, flush: async () => {} };
  const client = { ready: async () => {}, getVerificationDocument: async () => ({ securityVerified: true, steps: {} }),
    chat: { completions: { create: async body => { requests.push(structuredClone(body)); const step = script(requests.length, body); return (async function* () { yield step; })(); } } } };
  let agentTools = null;
  if (withTools) {
    agentTools = createAgentTools(); agentTools.gitBash = null;
    agentTools.run = async input => { runs.push(input); return run ? run(input) : { stdout: 'ok\n', stderr: '', exitCode: 0, timedOut: false, stopped: false, truncated: false, elapsedMs: 5 }; };
  }
  const s = new WorkbenchService(vault, async () => client, () => {}, python, { agentTools });
  await s.initialize(); s.workspace.apiKey = 'fixture-key';
  const thread = s.workspace.threads[0];
  Object.assign(thread.settings, { model: 'fixture', agentMode: mode, visualTools: false });
  if (folder) thread.agentFolder = dir;
  return { s, dir, requests, runs, thread, get stored() { return stored; } };
}
const send = s => s.execute({ type: 'send', id: s.workspace.activeId, text: 'Fix the answer.', attachments: [] });
const approve = (s, pending, allow) => s.execute({ type: 'tool.approve', id: pending.threadId, toolId: pending.tool.id, approve: allow });
const toolMessages = body => body.messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content));

test('the agent is offered only with its folder, in a local conversation of the Windows app', windows, async t => {
  const { s, requests, dir } = await agentSetup(t, { script: () => answer('Done.') });
  await send(s); await done(s);
  assert.deepEqual(requests[0].tools.map(tool => tool.function.name), ['list_files', 'search_files', 'read_file', 'edit_file', 'write_file', 'run_command', 'update_plan']);
  const system = requests[0].messages[0].content;
  assert.match(system, /<workspace_agent>/); assert.ok(system.includes(`<environment>\nfolder: ${dir}\nfolder origin: a folder the user chose for this conversation\nshell: Windows PowerShell 5.1`));
  assert.deepEqual(s.snapshot().agent, { available: true, gitBash: false, root: null });

  const off = await agentSetup(t, { mode: 'off', script: () => answer('Done.') });
  await send(off.s); await done(off.s); assert.ok(!('tools' in off.requests[0]));
  const noFolder = await agentSetup(t, { folder: false, script: () => answer('Done.') });
  await assert.rejects(send(noFolder.s), /Choose where the workspace agent keeps new work/); assert.equal(noFolder.requests.length, 0);
  const cloud = await agentSetup(t, { script: () => answer('Done.') }); cloud.thread.cloudPending = true;
  await assert.rejects(send(cloud.s), new RegExp(AGENT_CLOUD.slice(0, 40)));
  const bash = await agentSetup(t, { script: () => answer('Done.') }); bash.thread.settings.agentShell = 'bash';
  await assert.rejects(send(bash.s), /Git Bash was not found/);
  const android = await agentSetup(t, { tools: false, mode: 'off', script: () => answer('Done.') });
  await assert.rejects(android.s.execute({ type: 'thread.settings', id: android.thread.id, settings: { ...android.thread.settings, agentMode: 'ask' } }), new RegExp(AGENT_UNAVAILABLE));
  assert.deepEqual(android.s.snapshot().agent, { available: false, gitBash: false, root: null });
  await assert.rejects(android.s.setAgentFolder(android.thread.id, 'D:\\Projects'), new RegExp(AGENT_UNAVAILABLE));
});

test('read tools reach a folder attached to a message by its full path, without approval, and nowhere else', windows, async t => {
  const site = scratch(t, 'workbench-attached-'), outside = scratch(t, 'workbench-outside-');
  writeFileSync(join(site, 'notes.txt'), 'attached words\n'); writeFileSync(join(outside, 'secret.txt'), 'secret words\n');
  const { s, requests } = await agentSetup(t, { script: n => [
    call('read_file', { path: join(site, 'notes.txt') }, 'call_in'), call('read_file', { path: join(outside, 'secret.txt') }, 'call_out'),
    call('list_files', { path: join(site, '..') }, 'call_up'), call('read_file', { path: join(site, '..', 'x.txt') }, 'call_dots'), answer('Read it.')][n - 1] });
  await s.execute({ type: 'send', id: s.workspace.activeId, text: 'Read my notes.', attachments: [{ name: 'site', content: '', kind: 'folder', path: site }] });
  await done(s);
  assert.ok(requests[0].messages[0].content.includes(`\nattached folders: ${site} (the user attached them to messages;`));
  const [inside, other, up, dots] = s.workspace.threads[0].turns[0].replies[0].tools;
  assert.equal(inside.status, 'complete'); assert.match(inside.stdout, /attached words/); assert.equal(inside.agent.folder, site);
  for (const refused of [other, up, dots]) { assert.equal(refused.status, 'error'); assert.doesNotMatch(refused.stdout ?? '', /secret words/); }
  assert.equal(s.approvals.size, 0);
});

test('reads run without approval; an edit waits for it, and a declined one leaves the file alone', windows, async t => {
  const { s, dir, requests } = await agentSetup(t, { script: n => [
    call('read_file', { path: 'app.js' }), call('edit_file', { path: 'app.js', old_text: 'answer = 41', new_text: 'answer = 42' }, 'call_edit1'),
    call('edit_file', { path: 'app.js', old_text: 'answer = 41', new_text: 'answer = 42' }, 'call_edit2'), answer('Changed it.')][n - 1] });
  await send(s);
  const first = await nextApproval(s);
  assert.equal(first.tool.name, 'edit_file'); assert.match(first.tool.agent.diff, /-const answer = 41;\n\+const answer = 42;/);
  assert.equal(readFileSync(join(dir, 'app.js'), 'utf8'), 'const answer = 41;\nconsole.log(answer);\n', 'nothing written while waiting');
  await approve(s, first, false);
  const second = await nextApproval(s);
  assert.equal(readFileSync(join(dir, 'app.js'), 'utf8').includes('41'), true, 'a declined change is not written');
  await approve(s, second, true); await done(s);
  assert.equal(readFileSync(join(dir, 'app.js'), 'utf8'), 'const answer = 42;\nconsole.log(answer);\n');
  const [read, declined, applied] = toolMessages(requests[3]);
  assert.match(read.result, /^app\.js · lines 1–2 of 2\n1\tconst answer = 41;/); assert.equal(read.status, 'complete');
  assert.equal(declined.status, 'denied'); assert.match(declined.error, /declined this change/);
  assert.deepEqual(applied, { status: 'complete', result: 'Changed app.js: 1 line added, 1 removed.' });
  const reply = s.workspace.threads[0].turns[0].replies[0];
  assert.equal(reply.status, 'complete'); assert.equal(reply.tools[0].agent.folder, dir);
  assert.doesNotThrow(() => validateWorkspace(structuredClone(s.workspace)), 'agent calls are stored in a valid workspace');
  const markdown = exportMarkdown(s.workspace.threads[0]);
  assert.ok(markdown.includes(`Workspace agent · folder ${dir}`)); assert.match(markdown, /```diff\n--- a\/app\.js[\s\S]*\+const answer = 42;/);
});

test('an edit to a file that changed while waiting is refused, and the change on disk is kept', windows, async t => {
  const { s, dir, requests } = await agentSetup(t, { script: n => n === 1 ? call('edit_file', { path: 'app.js', old_text: '41', new_text: '42' }) : answer('Stopped.') });
  await send(s); const pending = await nextApproval(s);
  writeFileSync(join(dir, 'app.js'), 'const answer = 41; // edited by the user\n');
  await approve(s, pending, true); await done(s);
  assert.equal(readFileSync(join(dir, 'app.js'), 'utf8'), 'const answer = 41; // edited by the user\n');
  assert.equal(toolMessages(requests[1])[0].status, 'error'); assert.match(toolMessages(requests[1])[0].error, /changed after this change was proposed/);
});

test('commands run only after approval, in the folder and shell, and the model gets their output shortened', windows, async t => {
  const long = 'start\n' + 'x'.repeat(20000) + '\nFAILED: 1 test';
  const { s, runs, requests, dir } = await agentSetup(t, { run: () => ({ stdout: long, stderr: 'warning', exitCode: 1, timedOut: false, stopped: false, truncated: false, elapsedMs: 9 }),
    script: n => [call('run_command', { command: 'npm test', workdir: '.', timeout_seconds: 30 }), call('run_command', { command: 'rm -rf .' }, 'call_rm'), answer('One test fails.')][n - 1] });
  await send(s);
  const pending = await nextApproval(s); await wait(20);
  assert.equal(runs.length, 0, 'nothing runs before approval');
  await approve(s, pending, true);
  await approve(s, await nextApproval(s), false); await done(s);
  assert.equal(runs.length, 1); assert.equal(runs[0].folder, dir); assert.equal(runs[0].shell, 'powershell'); assert.equal(runs[0].command, 'npm test'); assert.equal(runs[0].timeout_seconds, 30);
  const [ran, declined] = toolMessages(requests[2]);
  assert.equal(ran.exit_code, 1); assert.ok(ran.stdout.startsWith('start\n')); assert.ok(ran.stdout.endsWith('FAILED: 1 test')); assert.ok(ran.stdout.length < 12200); assert.equal(ran.stderr, 'warning');
  assert.equal(declined.status, 'denied'); assert.match(declined.error ?? declined.stderr, /declined this command/);
  assert.equal(s.workspace.threads[0].turns[0].replies[0].tools[0].stdout, long, 'the conversation keeps the whole output');
});

test('a path outside the folder is refused without an approval, and the model is told why', windows, async t => {
  const { s, requests } = await agentSetup(t, { script: n => n === 1 ? call('read_file', { path: '../../Windows/win.ini' }) : answer('Cannot.') });
  await send(s); await done(s);
  assert.equal(s.approvals.size, 0); const [result] = toolMessages(requests[1]);
  assert.equal(result.status, 'error'); assert.match(result.error, /cannot go above the workspace folder/);
});

test('at the automatic level a command still asks when its words say it deletes, touches git history, changes the system, uses the network or installs', () => {
  const folder = 'D:\\Projects\\demo';
  for (const [command, reason] of [['Remove-Item -Recurse build', /deletes/], ['rm -rf dist', /deletes/], ['git push origin main', /git history/], ['git reset --hard HEAD~1', /git history/],
    ['git -C sub clean -fdx', /git history/], ['Set-ExecutionPolicy Bypass', /system settings/], ['Start-Process pwsh -Verb RunAs', /administrator/],
    ['Invoke-WebRequest https://example.com -OutFile x.zip', /network/], ['curl -O https://example.com/x', /network/], ['npm.cmd install left-pad', /installs/],
    ['npx create-thing', /installs/], ['python -m pip install requests', /installs/], ['winget install Git.Git', /installs/]])
    assert.match(commandRisk(command) ?? '', reason, command);
  for (const command of ['npm.cmd test', 'node --test', 'Get-ChildItem -Recurse | Format-Table Name', 'git status', 'git diff', 'git log --oneline -5',
    'Rename-Item -LiteralPath a.txt -NewName b.txt', 'Get-Content README.md -Encoding UTF8'])
    assert.equal(commandRisk(command), null, command);
  assert.equal(askAnyway("Rename-Item -LiteralPath 'C:\\Users\\Ada\\Downloads\\Miku' -NewName 'TDA Maid'", folder), 'it names a path outside the folder (C:\\Users\\Ada\\Downloads\\Miku)');
  assert.equal(askAnyway('Rename-Item -LiteralPath src\\a.js -NewName b.js', folder), null);
});

test('approval levels: changes, then commands too, run without asking; risky commands still ask; only the host raises the level', windows, async t => {
  const { s, dir, runs, thread } = await agentSetup(t, { script: n => [
    call('edit_file', { path: 'app.js', old_text: 'answer = 41', new_text: 'answer = 42' }, 'call_e'),
    call('run_command', { command: 'npm.cmd test' }, 'call_c1'), call('run_command', { command: 'Remove-Item -Recurse build' }, 'call_c2'), answer('Done.')][n - 1] });
  await s.execute({ type: 'thread.settings', id: thread.id, settings: { ...thread.settings, agentApproval: 'auto' } });
  assert.equal(thread.settings.agentApproval, undefined, 'the page cannot raise the level');
  await s.setAgentApproval(thread.id, 'auto');
  await send(s);
  const pending = await nextApproval(s);
  assert.equal(pending.tool.name, 'run_command'); assert.equal(pending.tool.agent.asked, 'it deletes files or folders');
  assert.equal(readFileSync(join(dir, 'app.js'), 'utf8'), 'const answer = 42;\nconsole.log(answer);\n', 'the change was written without asking');
  assert.deepEqual(runs.map(r => r.command), ['npm.cmd test'], 'the safe command ran without asking');
  await approve(s, pending, false); await done(s);
  const tools = s.workspace.threads[0].turns[0].replies[0].tools;
  assert.deepEqual(tools.map(x => [x.name, x.status, !!x.agent.auto]), [['edit_file', 'complete', true], ['run_command', 'complete', true], ['run_command', 'denied', false]]);
  assert.doesNotThrow(() => validateWorkspace(structuredClone(s.workspace)));
  assert.match(exportMarkdown(s.workspace.threads[0]), /approved automatically/);
  await s.execute({ type: 'thread.settings', id: thread.id, settings: { ...thread.settings, agentApproval: 'changes' } });
  assert.equal(thread.settings.agentApproval, 'changes', 'the page can lower it');
  await s.execute({ type: 'thread.settings', id: thread.id, settings: { ...thread.settings, agentMode: 'off' } });
  assert.equal(thread.settings.agentApproval, undefined, 'turning the agent off asks again');
  assert.equal(newThread({ ...thread.settings, agentApproval: 'auto' }).settings.agentApproval, 'ask', 'a new conversation or branch asks');

  const changes = await agentSetup(t, { script: n => [call('edit_file', { path: 'app.js', old_text: 'answer = 41', new_text: 'answer = 43' }, 'call_e'), call('run_command', { command: 'npm.cmd test' }, 'call_c'), answer('Done.')][n - 1] });
  await changes.s.setAgentApproval(changes.thread.id, 'changes'); await send(changes.s);
  const asked = await nextApproval(changes.s);
  assert.equal(asked.tool.name, 'run_command'); assert.equal(asked.tool.agent.asked, undefined);
  assert.equal(readFileSync(join(changes.dir, 'app.js'), 'utf8').includes('43'), true, 'at "changes" the edit needs no approval');
  await approve(changes.s, asked, true); await done(changes.s); assert.equal(changes.runs.length, 1);
});

test('model-requested Python follows the agent: it runs without asking at "auto" and asks at every other level', windows, async t => {
  const ran = [], python = async input => { ran.push(input.code); return { status: 'complete', stdout: '2\n', stderr: '', exitCode: 0, elapsedMs: 2, artifacts: [], truncated: false }; };
  const script = n => [call('python', { code: 'print(1+1)' }, 'call_py'), answer('Two.')][n - 1];
  const ready = async level => { const setup = await agentSetup(t, { script, python }); setup.thread.settings.toolsMode = 'ask'; setup.s.workspace.pythonPath = 'C:\\Python\\python.exe'; await setup.s.setAgentApproval(setup.thread.id, level); return setup; };
  const auto = await ready('auto'); await send(auto.s); await done(auto.s);
  const tool = auto.s.workspace.threads[0].turns[0].replies[0].tools[0];
  assert.deepEqual([tool.status, tool.autoApproved, ran.length, auto.s.approvals.size], ['complete', true, 1, 0]);
  assert.match(exportMarkdown(auto.s.workspace.threads[0]), /### Tool: python \(complete; model; approved automatically\)/);
  assert.equal(validateWorkspace(structuredClone(auto.s.workspace)).threads[0].turns[0].replies[0].tools[0].autoApproved, true);
  const changes = await ready('changes'); await send(changes.s);
  const pending = await nextApproval(changes.s); assert.equal(pending.tool.name, 'python');
  await approve(changes.s, pending, false); await done(changes.s); assert.equal(ran.length, 1, 'at "changes" Python asks');
});

test('an agent reply may take 30 rounds, then stops and says so', windows, async t => {
  const { s, requests } = await agentSetup(t, { script: n => call('list_files', { path: '.' }, 'call_' + n) });
  await send(s); await done(s);
  const reply = s.workspace.threads[0].turns[0].replies[0];
  assert.equal(requests.length, AGENT_LIMITS.rounds); assert.equal(reply.tools.length, AGENT_LIMITS.rounds - 1);
  assert.equal(reply.status, 'error'); assert.match(reply.error, /limit for one message \(30 rounds or 60 tool calls\)/);
  // Later requests carry the older results as excerpts.
  const last = requests.at(-1).messages.filter(m => m.role === 'tool');
  assert.equal(last.filter(m => JSON.parse(m.content).shortened).length, 0, 'short results are sent whole');
  assert.doesNotThrow(() => validateWorkspace(structuredClone(s.workspace)), '29 calls and their history fit a stored reply');
});

test('one agent step may hold 16 calls, run one after another; a 17th fails the step before anything runs', windows, async t => {
  const reads = n => chunk({ tool_calls: Array.from({ length: n }, (_, i) => ({ index: i, id: 'call_read' + i, type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'app.js' }) } })) }, 'tool_calls');
  const { s, requests } = await agentSetup(t, { script: n => n === 1 ? reads(AGENT_LIMITS.callsPerStep) : answer('Read it.') });
  await send(s); await done(s);
  const reply = s.workspace.threads[0].turns[0].replies[0];
  assert.equal(AGENT_LIMITS.callsPerStep, 16); assert.equal(reply.status, 'complete'); assert.equal(reply.tools.length, 16);
  assert.ok(reply.tools.every(tool => tool.status === 'complete' && tool.batchSize === 16)); assert.equal(toolMessages(requests[1]).length, 16);
  assert.doesNotThrow(() => validateWorkspace(structuredClone(s.workspace)), 'a batch of 16 is stored in a valid workspace');
  const over = await agentSetup(t, { script: () => reads(17) });
  await send(over.s); await done(over.s);
  const failed = over.s.workspace.threads[0].turns[0].replies[0];
  assert.equal(failed.status, 'error'); assert.match(failed.error, /more than 16 tool calls in one response/); assert.equal(failed.tools.length, 0);
});

test('a conversation without a folder gets a new, empty one under the root when it first sends', windows, async t => {
  const root = join(scratch(t, 'workbench-agent-root-'), 'Tinfoil');
  const { s, requests, thread } = await agentSetup(t, { folder: false, script: () => answer('Done.') });
  // The scratch root is under Temp, which is an application data folder; the refusals are checked below.
  const tools = createAgentTools(); s.agentTools.createWorkFolder = (base, name) => tools.createWorkFolder(base, name, {});
  await assert.rejects(send(s), /Choose where the workspace agent keeps new work/); assert.equal(requests.length, 0);
  await s.setAgentRoot(root); assert.equal(s.snapshot().agent.root, root);
  thread.settings.model = '';
  await assert.rejects(send(s), /Choose a model/); assert.equal(thread.agentFolder, undefined, 'no folder for a send that cannot start');
  thread.settings.model = 'fixture';
  await send(s); await done(s);
  const folder = thread.agentFolder;
  // Native resolution, as the service's: it also expands 8.3 short names, which a runner's Temp path can be.
  assert.equal(folder, join(realpathSync.native(root), basename(folder))); assert.match(basename(folder), /^\d{4}-\d{2}-\d{2} Fix the answer [0-9a-f]{4}$/);
  assert.deepEqual(readdirSync(folder), []); assert.ok(requests[0].messages[0].content.includes(`<environment>\nfolder: ${folder}\n`));
  await send(s); await done(s); assert.equal(thread.agentFolder, folder, 'later messages keep the folder');
  assert.equal(await tools.createWorkFolder(root, basename(folder), {}), `${folder} (2)`, 'an existing folder is never reused');
  const stored = validateWorkspace(structuredClone(s.workspace)); assert.equal(stored.agentRoot, root);
  assert.throws(() => validateWorkspace({ ...structuredClone(s.workspace), agentRoot: 'Tinfoil' }), /absolute path/);
  await assert.rejects(tools.createWorkFolder('C:\\Users', 'x', { USERPROFILE: 'C:\\Users\\Ada' }), /home folder/);
  await assert.rejects(tools.createWorkFolder('D:\\', 'x', {}), /whole drive/);
});

test('a conversation that used the agent cannot move into a cloud project', windows, async t => {
  const { s, thread } = await agentSetup(t, { script: () => answer('Done.') });
  s.workspace.projects.push({ id: 'cloudproj', name: 'Cloud', createdAt: 1, cloud: { id: 'p1', etag: '1', description: '', instructions: '', color: '', documents: [], syncedAt: 1 } });
  await assert.rejects(s.execute({ type: 'thread.move', id: thread.id, projectId: 'cloudproj' }), new RegExp(AGENT_CLOUD.slice(0, 40)));
  await assert.rejects(s.setAgentFolder(thread.id, 'relative\\path'), /absolute path on a drive/);
});

test('a confirmation asks with Cancel by default and carries only what the main process gave it', () => {
  const asked = confirmation({ title: 'Remove your Tinfoil chat key from Workbench?', message: 'Cloud chats stay in your account.', approve: 'Remove chat key' });
  assert.deepEqual(asked, { kind: 'confirm', title: 'Remove your Tinfoil chat key from Workbench?', message: 'Cloud chats stay in your account.', approve: 'Remove chat key', decline: 'Cancel', tone: 'question', facts: [], outside: [], warning: '' });
  const folder = confirmation({ title: 'Let the workspace agent work in this folder?', message: 'The model can read files here.', approve: 'Use this folder', decline: 'Keep asking', tone: 'danger', text: 'D:/work' });
  assert.equal(folder.text, 'D:/work'); assert.equal(folder.decline, 'Keep asking'); assert.equal(folder.tone, 'danger');
});

test('the environment says a folder Workbench made is named after the first message, and what runs without asking', () => {
  const id = '2DDB91c0-aaaa', root = 'D:/Work/Tinfoil/workspaces';
  const made = String.raw`D:\Work\Tinfoil\workspaces\2026-09-30 Hello fork 2ddb`;
  assert.equal(madeFolder(made, root, id), true);
  assert.equal(madeFolder(made + ' (2)', root, id), true);
  assert.equal(madeFolder(String.raw`E:\old-root\2026-09-30 Hello fork 2ddb`, root, id), true, 'a branch or an earlier root keeps its name');
  assert.equal(madeFolder(String.raw`D:\Work\Tinfoil\workspaces\2026-09-30 Hello fork 9f1c`, root, 'ffff'), true, 'made under the root');
  assert.equal(madeFolder(String.raw`D:\Projects\shop`, root, id), false);
  assert.equal(madeFolder(String.raw`D:\Projects\2026-09-30 notes 1234`, root, id), false);
  const environment = agentEnvironment(made, 'powershell', { approval: 'auto', made: true });
  assert.match(environment, /folder origin: made by Workbench for this conversation and named after its first message; the user did not choose or mention this name/);
  assert.match(environment, /approvals: commands and file changes run without asking/);
  assert.match(agentEnvironment(made, 'powershell', { approval: 'changes' }), /approvals: file changes inside the folder are written without asking[^\n]*the user approves every command first/);
});
