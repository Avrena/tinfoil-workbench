// Run with Electron. Uses a fresh Workbench sign-in window, not a regular browser
// profile or the installed app's account store. Credentials never reach stdout.
import { app, BrowserWindow, session, dialog } from 'electron';
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { AccountWindow } from '../desktop/account-window.mjs';
import { AccountSession } from '../desktop/account-session.mjs';

const host = process.argv[2];
if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(host ?? '')) throw new Error('Supply an SSH config alias.');
const directory = mkdtempSync(join(tmpdir(), 'tinfoil-remote-enroll-'));
app.setPath('userData', directory);
app.on('window-all-closed', () => {});
// Electron waits for the entry module to finish before ready. Awaiting ready at
// module scope deadlocks startup; register the continuation instead.
void app.whenReady().then(async () => {
let adapter, installed = false;
try {
  const choice = await dialog.showMessageBox({ type: 'question', buttons: ['Cancel', 'Sign in for this VPS'], defaultId: 0, cancelId: 0,
    title: 'Connect remote Tinfoil Chat',
    message: 'Connect your Chat subscription to ' + host + '?',
    detail: 'This opens a fresh Tinfoil sign-in. Its Tinfoil session will be encrypted on this VPS so jobs can renew Chat access after this PC closes. VPS administrators can use that session. Existing browser and Workbench sign-ins are not copied. No developer API fallback.' });
  if (choice.response !== 1) throw new Error('Cancelled.');
  adapter = new AccountWindow({ BrowserWindow, session });
  const account = new AccountSession(adapter);
  await account.login();
  if (account.snapshot().status !== 'signed-in' || account.snapshot().entitlement !== 'active')
    throw new Error('Chat sign-in did not establish subscription access.');
  const choice2 = await dialog.showMessageBox({ type: 'question', buttons: ['Cancel', 'Connect this account'], defaultId: 0, cancelId: 0,
    title: 'Confirm remote account', message: 'Use ' + account.snapshot().profile.name + ' on ' + host + '?',
    detail: 'Only this fresh Tinfoil session is transferred through key-authenticated SSH. No conversation history is uploaded.' });
  if (choice2.response !== 1) throw new Error('Cancelled.');
  await adapter.readSession(true, account.binding);
  const record = { version: 1, binding: account.binding, profile: account.snapshot().profile,
    cookies: await adapter.cookies(), savedAt: Date.now() };
  await new Promise((yes, no) => {
    const child = spawn('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10',
      host, '/usr/local/bin/tinfoil-workbench'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    let result = ''; child.stdout.on('data', c => { result += c; if (result.length > 10000) child.kill(); });
    child.on('error', () => no(new Error('SSH could not start.')));
    child.on('close', code => {
      try { if (code !== 0 || !JSON.parse(result).ok) throw new Error(); yes(); }
      catch { no(new Error('The VPS did not accept the Chat session.')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ op: 'configure-chat', session: record }));
  });
  installed = true;
  await dialog.showMessageBox({ message: 'Remote Chat session connected.', detail: 'The VPS can now renew subscription credentials. No agent task was submitted.' });
} catch (error) {
  await dialog.showMessageBox({ type: 'error', message: error.message || 'Remote sign-in failed.' });
} finally {
  await adapter?.clear({ end: !installed }).catch(() => {});
  // Dedicated temp directory only, never the installed Workbench profile.
  if (dirname(resolve(directory)) === resolve(tmpdir()) && directory.includes('tinfoil-remote-enroll-'))
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  app.quit();
}
});
