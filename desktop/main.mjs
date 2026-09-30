import { app, BrowserWindow, Menu, protocol, session, ipcMain, safeStorage, dialog, clipboard, shell, nativeTheme, powerMonitor, screen } from 'electron';
import { join, dirname, basename, extname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readFile, writeFile, open, stat } from 'node:fs/promises';
import { renderPDF } from './pdf-renderer.mjs';
import { loadModelCapabilities } from './model-catalog.mjs';
import { artifactSource, chartSpec, chartSVG, diagramSpec, diagramSVG, tableSpec, tableHTML, timelineSpec, timelineHTML, statsSpec, statsHTML } from '../dist/core/visual-tools.js';
import { markdown, escapeHtml } from '../dist/core/markdown.js';
import { randomUUID } from 'node:crypto';
import { EncryptedVault } from './vault.mjs';
import { WorkbenchService } from './service.mjs';
import { runPython } from './python-runner.mjs';
import { findPythons, describePython } from './python-find.mjs';
import { createAgentTools, unsafeFolder } from './agent-tools.mjs';
import { agentArguments } from '../dist/core/agent.js';
import { commandApproval, changeApproval, pythonApproval, confirmation } from '../dist/core/approval.js';
import { createApprovals } from './approval-window.mjs';
import { safeExternalURL } from '../dist/core/markdown.js';
import { pythonArguments } from '../dist/core/tools.js';
import { createProvider } from './provider.mjs';
import { CloudClient, syncEnclave } from './cloud-client.mjs';
import { CloudSync } from './cloud-sync.mjs';
import { CloseCoordinator, persistCloseDecision } from './close-coordinator.mjs';
import { AccountSession } from './account-session.mjs';
import { AccountWindow } from './account-window.mjs';
import { AccountStore } from './account-store.mjs';
import { resourcePath, trustedFrame, publicError } from '../dist/core/security.js';
import { InputError, record, identifier, text, attachments, LIMITS } from '../dist/core/validation.js';
import { findThread, exportThread, exportMarkdown } from '../dist/core/workspace.js';
import { themePreferences, themeTokens, themeVariant } from '../dist/core/themes.js';
import { TEXT_EXTENSIONS, IMAGE_EXTENSIONS, IMAGE_LIMITS, PDF_SOURCE_BYTES, attachmentKind, folderKey, unknownFolder } from '../dist/core/attachments.js';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const smoke = process.argv.includes('--smoke-test');
if (smoke) app.setPath('userData', mkdtempSync(join(tmpdir(), 'tinfoil-smoke-')));
const origin = 'app://workbench/index.html';
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.enableSandbox();
app.setAppUserModelId('org.avrena.tinfoil.workbench');
let window, service, account, accountFlow, closeCoordinator, approvals, quitting = false;
/** Asks before acting, in Workbench's own window (core/approval.ts `confirmation`) rather than a Windows message box. */
const confirm = options => approvals.ask(window, confirmation(options));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(launch).catch(error => {
    if (smoke) { console.error(`DESKTOP_SMOKE_FAILED: ${error?.code ?? error?.name ?? 'Error'}: ${String(error?.message ?? error).slice(0, 300)}`); quitting = true; app.exit(1); return; }
    dialog.showErrorBox('Tinfoil Workbench could not open', 'The encrypted workspace could not be opened. It has not been reset or overwritten. Check Windows account access, disk space, or restore your own backup of workspace.vault.');
    quitting = true; app.quit();
  });
}
async function launch() {
  nativeTheme.themeSource = 'dark'; Menu.setApplicationMenu(null);
  // Windows is the release target. On other OSes, only an actual secure backend may be used for development.
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') throw new Error('No secure key store');
  const vault = new EncryptedVault(app.getPath('userData'), safeStorage);
  const accountWindow=new AccountWindow({BrowserWindow,session},message=>account?.invalidate(message),host=>account?.blocked(host),()=>account?.cookiesChanged());
  // Staying signed in keeps Tinfoil's website session between launches, sealed by DPAPI. The smoke test never restores one.
  const accountStore=smoke?null:new AccountStore(join(app.getPath('userData'),'account-session.bin'),safeStorage);
  account=new AccountSession(accountWindow,()=>service?.accountChanged(),{store:accountStore});
  // Timers do not run during sleep; requests recheck expiry anyway, and resume drops a stale key at once.
  powerMonitor.on('resume',()=>account?.resume());
  // The workspace agent's file and command tools (docs/WORKSPACE-AGENT.md) exist only on Windows.
  const agentTools = process.platform === 'win32' ? await createAgentTools().detect() : null;
  service = new WorkbenchService(vault, createProvider, snapshot => {
    if (window && !window.isDestroyed()) window.webContents.send('workbench:changed', snapshot);
  }, runPython, {pdfRenderer:renderPDF,capabilityLoader:loadModelCapabilities,account,agentTools,python:{find:()=>findPythons(),describe:path=>describePython(path)},autoConnect:!smoke,cloud:host=>new CloudSync({host,account,client:new CloudClient({
    // Tinfoil's sync enclave, attested like inference; the SDK is loaded only when cloud sync is used.
    secureClient: () => syncEnclave(service.workspace.cacheSecret),
    token: async force => (await account.sessionToken(force)).bearer,
  })})});
  await service.initialize();
  syncTheme();
  // Cloud chats sync after sign-in and then every ten minutes while the app is open.
  if (!smoke) setInterval(() => service.syncCloud(), 600_000).unref?.();
  await account.setRemember(service.workspace.rememberAccount!==false);
  // Restores in the background; the account view shows "Restoring" until it finishes. A saved API key is verified at
  // once; a Chat sign-in is verified when its restore completes.
  void account.restore();
  void service.autoConnect();
  protocol.handle('app', async request => {
    const path = resourcePath(request.url);
    if (request.method !== 'GET' || !path) return new Response('Not found', { status: 404 });
    try {
      const data = await readFile(join(root, 'dist', path));
      const mime = path.endsWith('.html') ? 'text/html' : path.endsWith('.css') ? 'text/css' : 'application/javascript';
      return new Response(data, { headers: { 'Content-Type': `${mime}; charset=utf-8`,
        'Content-Security-Policy': "default-src 'none'; script-src 'self' 'nonce-workbench-artifact'; worker-src 'self'; font-src data: blob:; style-src 'self' 'nonce-workbench-artifact'; img-src data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'self' about:; form-action 'none'",
        'X-Content-Type-Options': 'nosniff' } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', event => event.preventDefault());
  // Renderer previews are never a route to the network. SDK traffic uses Node,
  // outside this Electron session. Opaque srcdoc frames have no preload bridge.
  ses.webRequest.onBeforeRequest((details, callback) => {
    const u = new URL(details.url);
    callback({ cancel: !(u.protocol === 'app:' && (u.hostname === 'workbench' || u.hostname === 'approval')) && !['about:', 'data:'].includes(u.protocol) });
  });
  approvals = createApprovals({ BrowserWindow, ipcMain, screen, root, devTools: !app.isPackaged, theme: currentTheme });
  window = new BrowserWindow({ width: 1440, height: 920, minWidth: 360, minHeight: 420,
    title: 'Tinfoil Workbench', backgroundColor: currentTheme().tokens.n0, frame: false, show: false,
    icon: join(root, 'assets', 'icon.ico'),
    webPreferences: { preload: join(root, 'desktop', 'preload.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, webSecurity: true, webviewTag: false,
      allowRunningInsecureContent: false, spellcheck: false, devTools: !app.isPackaged } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-frame-navigate',event=>{ if(!event.url?.startsWith('about:'))event.preventDefault(); });
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  closeCoordinator = new CloseCoordinator({
    notify: id => window.webContents.send('workbench:close-request', id),
    close: () => { if (window && !window.isDestroyed()) window.close(); },
    confirmForce: async () => {
      if (!window || window.isDestroyed()) return false;
      return confirm({ tone: 'warning', decline: 'Keep open', approve: 'Close anyway',
        title: 'The interface did not confirm that the draft was saved.',
        message: 'Closing now may discard unsaved edits or the latest draft. Already saved encrypted conversations are not reset. Keep the window open to retry or export your work.' });
    }
  });
  window.on('close', event => {
    if (smoke || quitting || closeCoordinator.approved) return;
    event.preventDefault(); closeCoordinator.request();
  });
  window.on('unresponsive', () => {
    if (closeCoordinator.pending) void closeCoordinator.fallback(closeCoordinator.pending);
  });
  window.webContents.on('render-process-gone', () => {
    if (closeCoordinator.pending) void closeCoordinator.fallback(closeCoordinator.pending);
  });
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => { closeCoordinator?.dispose(); window = null; app.quit(); });
  ipcMain.handle('workbench:snapshot', guarded(async () => service.snapshot()));
  ipcMain.handle('workbench:command', guarded(async (_event, input) => command(input)));
  ipcMain.handle('workbench:folder', guarded(async (_event, path) => droppedFolder(path)));
  await window.loadURL(origin);
  if (smoke) {
    const ok = await window.webContents.executeJavaScript(`(async () => {
      const s = await window.tinfoil.snapshot();
      return document.title === 'Tinfoil Workbench' && !!document.querySelector('#prompt') &&
        s.storage === 'os-encrypted' && !('apiKey' in s.workspace) && !s.hasKey;
    })()`);
    const probe = safeStorage.encryptString('workbench-smoke');
    if (!ok || safeStorage.decryptString(probe) !== 'workbench-smoke') throw new Error('Desktop smoke test failed');
    // Production print adapter + actual bundled PDF.js worker, not a mock. This
    // runs only on the user's machine/CI when --smoke-test is explicitly chosen.
    const samplePDF = await renderPDF({html:'<h1>Workbench PDF smoke test</h1><p>Synthetic local fixture.</p>'});
    const pdfOK = await window.webContents.executeJavaScript(`(async () => {
      const stage = document.createElement('div'); document.body.append(stage);
      const { mountPDF } = await import('/renderer/pdf-viewer.js');
      const cleanup = await mountPDF(stage, Uint8Array.from(atob('${samplePDF.toString('base64')}'), c => c.charCodeAt(0)), () => true);
      const passed = !!stage.querySelector('canvas') && stage.textContent.includes('Page 1 of 1');
      cleanup(); stage.remove(); return passed;
    })()`);
    if (!pdfOK) throw new Error('Native PDF print/view smoke test failed');
    // The attested SDK is imported only when a connection starts, so a package that lacks one of its modules
    // would otherwise fail every connection and nothing else. Building the client makes no request.
    const provider = await createProvider('smoke-test-placeholder', randomUUID() + randomUUID());
    if (typeof provider?.ready !== 'function') throw new Error('Attested SDK smoke test failed');
    // The workspace agent's runner: one PowerShell command in a scratch folder, its UTF-8 output and exit code.
    if (agentTools) {
      const folder = mkdtempSync(join(tmpdir(), 'workbench-agent-smoke-'));
      try {
        const ran = await agentTools.run({ folder, shell: 'powershell', workdir: '.', command: "Write-Output 'agent \u2713'; exit 3", timeout_seconds: 60 });
        if (ran.exitCode !== 3 || !ran.stdout.includes('agent \u2713')) throw new Error('Workspace agent smoke test failed');
      } finally { rmSync(folder, { recursive: true, force: true }); }
    }
    // The approval window loads from its own origin through its own preload, shows the request with the path outside
    // the folder marked and Decline focused, and closing it declines.
    const sample = commandApproval("Get-ChildItem -LiteralPath 'C:\\Users\\Public'", 'C:\\Workbench\\smoke', '.', 'powershell', 60);
    let shown = null;
    const answered = await approvals.ask(window, sample, { onShow: async win => {
      shown = await win.webContents.executeJavaScript(`[document.querySelector('pre.code')?.textContent, document.querySelectorAll('mark.outside-path').length, document.activeElement?.id].join('|')`);
      win.close();
    } });
    if (answered !== false || shown !== `${sample.text}|1|decline`) throw new Error('Approval window smoke test failed');
    console.log(`DESKTOP_SMOKE_OK: encrypted storage, bridge, attested SDK import, native PDF print and PDF.js canvas${agentTools ? ', workspace agent runner' : ''}, approval window`);
    await service.shutdown(); quitting = true; app.quit();
  }
}
function guarded(handler) {
  return async (event, ...args) => {
    try {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !trustedFrame(event.senderFrame.url))
        throw new InputError('Untrusted application frame.');
      return { ok: true, value: await handler(event, ...args) };
    } catch (error) { return { ok: false, error: publicError(error) }; }
  };
}
/** The theme the windows show (Settings → Appearance), for the approval window and window backgrounds. */
function currentTheme() {
  const theme = themePreferences(service?.workspace.view.theme), variant = themeVariant(theme.mode, nativeTheme.shouldUseDarkColors);
  return { variant, tokens: themeTokens(theme[variant], variant) };
}
/** Native dialogs, the window frame and the page's prefers-color-scheme follow the chosen mode. */
function syncTheme() {
  const { mode } = themePreferences(service.workspace.view.theme);
  nativeTheme.themeSource = mode;
  if (window && !window.isDestroyed()) window.setBackgroundColor(currentTheme().tokens.n0);
}
/** Folders the user dropped or pasted in this session (preload `folderFor`), which a message may attach. */
const droppedFolders = new Set();
async function droppedFolder(input) {
  const path = text(input, 'Folder', 1024, true);
  if (!isAbsolute(path) || !/^[a-zA-Z]:\\/.test(path)) throw new InputError('Only a folder on a drive of this computer can be attached.');
  let info;
  try { info = await stat(path); } catch { return null; }
  if (!info.isDirectory()) return null;
  const unsafe = unsafeFolder(path);
  if (unsafe) throw new InputError(`Workbench does not attach ${unsafe}. Attach a project folder instead.`);
  droppedFolders.add(folderKey(path));
  return { path, name: basename(path) || path };
}
/** A message or draft may attach a folder only if the user dropped or pasted it in this session, or it is already in
 * that conversation (core/attachments.ts unknownFolder). */
function checkFolders(c) {
  if (unknownFolder(c.attachments, findThread(service.workspace, identifier(c.id)), droppedFolders) !== null)
    throw new InputError('Attach a folder by dropping it on Workbench or pasting it.');
}
async function boundedBytes(path, limit) {
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw new InputError('The selected file is too large or is not a regular file.');
    // Read at most limit+1 even when another process grows a file after stat().
    const buffer = Buffer.alloc(limit + 1); let offset = 0;
    while (offset < buffer.length) { const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null); if (!bytesRead) break; offset += bytesRead; }
    if (offset > limit) throw new InputError('The selected file exceeds the size limit.');
    return buffer.subarray(0, offset);
  } finally { await handle.close(); }
}
async function boundedRead(path, limit) {
  const buffer = await boundedBytes(path, limit);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { throw new InputError('Only UTF-8 text files are supported.'); }
}
async function command(input) {
  const c = record(input); text(c.type, 'Command', 80, true);
  if (c.type === 'send' || c.type === 'thread.draft') checkFolders(c);
  if (c.type === 'view.set') { await service.execute(c); syncTheme(); return { snapshot: service.snapshot() }; }
  switch (c.type) {
    case 'account.login': {
      if(service.busyThreadId||service.connection)throw new InputError('Stop the response or wait for verification before signing in.');
      if(accountFlow)throw new InputError('Sign-in is already open.');
      if(account.snapshot().status==='signed-in')throw new InputError('Sign out before connecting another account.');
      if(account.snapshot().status==='restoring')throw new InputError('Workbench is restoring your saved sign-in. Wait a moment.');
      // Reconnect tries a saved sign-in that could not reach Tinfoil first; only an ended one needs a new sign-in.
      if(account.snapshot().status==='expired'&&await account.reconnect())break;
      const flow=(async()=>{
        if(['expired','error'].includes(account.snapshot().status))await account.signOut();
        await service.execute({type:'connection.mode',mode:'chat-account'});
        await account.login();
      })().catch(()=>account.invalidate('Sign-in could not finish. Reopen Account to try again.'));
      accountFlow=flow;void flow.finally(()=>{if(accountFlow===flow)accountFlow=null;});
      break;
    }
    case 'account.cancel': {
      if(account.snapshot().status!=='signing-in'&&account.snapshot().status!=='error')throw new InputError('No sign-in is waiting to be cancelled.');
      await account.signOut();break;
    }
    case 'account.remember': {
      const enabled=c.enabled===true;await service.execute({type:'account.remember',enabled});await account.setRemember(enabled);service.emit();break;
    }
    case 'account.refresh':case 'account.manage': {
      if(service.busyThreadId||service.connection)throw new InputError('Finish or stop the response before managing your account.');
      if(c.type==='account.manage')await account.manage();else await account.refresh();break;
    }
    case 'account.signout': {
      if(!await confirm({decline:'Keep signed in',approve:'Sign out on this device',
        title:'Sign out of Tinfoil Chat?',message:'This stops active responses, ends Workbench’s website session, deletes the sign-in saved on this PC and clears account tokens. Your local conversations and separately saved API key remain. No automatic API-key fallback is used. This does not sign out your regular browser.'}))break;
      for(const ctrl of service.controllers.values())ctrl.abort();
      await account.signOut();service.resetConnection();service.emit();break;
    }
    case 'thread.authorize-account': {
      const id=identifier(c.id);service.editable(id);
      if(!service.needsAuthorization(id))break;
      const owner=service.activeOwner(),thread=findThread(service.workspace,id);
      const name=owner==='api-key'?'the saved developer API key':account.snapshot().profile?.name;
      const allowed=await confirm({approve:'Allow this thread',
        title:'Use this existing thread with '+name+'?',message:'Thread: '+thread.title+'\n\nThe selected conversation history and attached reference text will be sent only when you next press Send. This approval does not send a request, upload a workspace or move cloud chats.'});
      if(allowed){if(owner!==service.activeOwner())throw new InputError('The account changed. Review it again.');await service.authorizeThread(id);}break;
    }
    case 'window.close-ack':
      if (!closeCoordinator?.acknowledge(identifier(c.requestId))) throw new InputError('This close request is no longer active.');
      break;
    case 'window.close-response':
      if (typeof c.allow !== 'boolean' || !await persistCloseDecision(closeCoordinator, identifier(c.requestId), c.allow, () => service.save())) throw new InputError('This close request is no longer active.');
      // Approval may destroy the renderer; do not perform any new operations.
      break;
    case 'window':
      if (c.action === 'minimize') window.minimize();
      else if (c.action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
      else if (c.action === 'close') window.close();
      else throw new InputError('Invalid window action.');
      break;
    case 'clipboard': {
      const value = text(c.text, 'Clipboard text', LIMITS.response);
      try { await clipboard.writeText(value); }
      catch { throw new InputError('Windows could not update the clipboard. Try copying again.'); }
      break;
    }
    case 'open.url': {
      const url = safeExternalURL(text(c.url, 'Link', 4096, true));
      if (!url) throw new InputError('Only absolute HTTP or HTTPS links without embedded credentials can be opened.');
      if (await confirm({ approve: 'Open in browser', title: `Open ${new URL(url).hostname} outside Workbench?`, text: url,
        message: 'This link comes from conversation content. Opening it shares the URL with your browser and the destination site.' })) await shell.openExternal(url);
      break;
    }
    case 'python.pick': {
      if (service.busyThreadId) throw new InputError('Stop the active operation before changing the Python interpreter.');
      const selected = await dialog.showOpenDialog(window, { title: 'Choose an installed Python interpreter (python.exe)', properties: ['openFile'],
        ...(process.platform === 'win32' ? { filters: [{ name: 'Python executable', extensions: ['exe'] }] } : {}) });
      if (selected.canceled || !selected.filePaths[0]) break;
      const path = selected.filePaths[0];
      if (!isAbsolute(path) || !(await stat(path)).isFile() || (process.platform === 'win32' && extname(path).toLowerCase() !== '.exe')) throw new InputError('Choose a regular Python executable.');
      await service.usePython(path, true);
      break;
    }
    // Installed Python, found without running it; the page may then pick one of the interpreters found.
    case 'python.find': await service.findPython(); break;
    case 'python.use': await service.usePython(text(c.path, 'Python interpreter path', 4096, true)); break;
    case 'tool.approve': {
      const pending = service.approvals.get(identifier(c.toolId));
      if (!pending || pending.threadId !== identifier(c.id) || typeof c.approve !== 'boolean') throw new InputError('This execution request is no longer awaiting approval.');
      let approve = false;
      if (c.approve && ['run_command', 'edit_file', 'write_file'].includes(pending.tool.name)) {
        // The workspace agent: the exact command, or the change, is shown in the approval window; approval covers this
        // call once.
        const tool = pending.tool, args = agentArguments(tool.name, tool.arguments), folder = tool.agent?.folder;
        if (!folder) throw new InputError('This action is not ready for approval.');
        approve = await approvals.ask(window, args.name === 'run_command'
          ? commandApproval(args.command, folder, args.workdir, tool.agent.shell ?? 'powershell', args.timeout_seconds, tool.agent.asked)
          : changeApproval(args.name, args.path, folder, tool.agent?.diff ?? ''));
      } else if (c.approve && pending.tool.name === 'delegate_task') {
        const child=pending.tool.delegate;
        if(!child)throw new InputError('The delegated task is not ready for approval.');
        approve=await confirm({approve:'Send one delegated request',title:'Approve one additional model request?',text:child.task,
          message:'Model: '+child.model+'\nMaximum output: 4,096 tokens (or the lower conversation limit). Additional inference usage applies.\n\nOnly the task below is sent; no tools or conversation history are inherited.'});
      } else if (c.approve) {
        if(pending.tool.name!=='python')throw new InputError('This tool has no approval handler.');
        if (!service.workspace.pythonPath) throw new InputError('Choose Python in Advanced, under Model-requested Python, first. Decline this run and stop the response to change the interpreter.');
        approve = await approvals.ask(window, pythonApproval(pythonArguments(pending.tool.arguments).code, service.workspace.pythonPath));
      }
      // Recheck after the approval window or dialog: cancellation and stale requests cannot execute.
      if (service.approvals.get(c.toolId) !== pending) throw new InputError('This execution request is no longer awaiting approval.');
      await service.execute({ type: 'tool.approve', id: c.id, toolId: c.toolId, approve });
      break;
    }
    // The workspace agent's folder is chosen here, never named by the page. Reading inside it needs no approval, so
    // folders that hold keys, app data or the system are refused, and the choice is confirmed natively.
    case 'agent.folder': {
      if (!service.agentTools) throw new InputError('The workspace agent needs the Windows app.');
      const selected = await dialog.showOpenDialog(window, { title: 'Choose the folder the workspace agent works in', properties: ['openDirectory'] });
      if (selected.canceled || !selected.filePaths[0]) break;
      const folder = selected.filePaths[0];
      if (!isAbsolute(folder) || !(await stat(folder)).isDirectory()) throw new InputError('Choose a folder.');
      const unsafe = unsafeFolder(folder);
      if (unsafe) throw new InputError(`The workspace agent cannot work in ${unsafe}. Choose a project folder instead.`);
      if (await confirm({ tone: 'warning', approve: 'Use this folder', title: 'Let the workspace agent work in this folder?', text: folder,
        message: "The model can list, search and read files in this folder without asking. Commands and file changes ask first unless Approvals in Advanced lets them run without asking. Commands run with your Windows account's permissions, not in a sandbox." }))
        await service.setAgentFolder(identifier(c.id), folder);
      break;
    }
    case 'agent.folder.clear': await service.setAgentFolder(identifier(c.id), null); break;
    // How many of the agent's calls run without asking. Raising it is confirmed here, never by the page alone.
    case 'agent.approval': {
      if (!service.agentTools) throw new InputError('The workspace agent needs the Windows app.');
      const level = c.level;
      if (level === 'changes' || level === 'auto') {
        const allowed = await confirm({ tone: 'warning', decline: 'Keep asking', approve: level === 'auto' ? 'Run without asking' : 'Change files without asking',
          title: level === 'auto' ? 'Let the workspace agent run commands and change files without asking?' : 'Let the workspace agent change files in its folder without asking?',
          message: level === 'auto'
            ? "In this conversation, commands run and files in its folder change as soon as the model asks, and so does model-requested Python when it is on. A command still asks when it names a path outside the folder, deletes files, changes git history or talks to a remote, changes system settings or asks for administrator rights, downloads or sends data, or installs packages.\n\nThat check reads the command's words. It is not a sandbox: a command can do more than it says, and commands run with your Windows account's permissions. Stop ends a response at any time."
            : 'In this conversation, edits and new files inside its folder are written as soon as the model asks, each shown in the conversation. Commands still ask.' });
        if (!allowed) break;
      } else if (level !== 'ask') throw new InputError('Unknown approval level.');
      await service.setAgentApproval(identifier(c.id), level);
      break;
    }
    // Where a conversation without a folder gets a new one. The agent works only inside that new folder, never in the
    // root itself, so the same places are refused as for a folder.
    case 'agent.root': {
      if (!service.agentTools) throw new InputError('The workspace agent needs the Windows app.');
      const selected = await dialog.showOpenDialog(window, { title: 'Choose where the workspace agent makes a folder for each new conversation', properties: ['openDirectory', 'createDirectory'] });
      if (selected.canceled || !selected.filePaths[0]) break;
      const folder = selected.filePaths[0];
      if (!isAbsolute(folder) || !(await stat(folder)).isDirectory()) throw new InputError('Choose a folder.');
      const unsafe = unsafeFolder(folder);
      if (unsafe) throw new InputError(`The workspace agent cannot keep its work in ${unsafe}. Choose a folder such as D:\\Work\\Tinfoil.`);
      await service.setAgentRoot(folder);
      break;
    }
    case 'artifact.open': {
      const selected=await dialog.showOpenDialog(window,{title:'Open a local preview (not shared with the model)',properties:['openFile'],filters:[{name:'Artifacts',extensions:['pdf','html','svg','png','md','txt','json','csv']}]});
      if(selected.canceled||!selected.filePaths[0])break;
      const path=selected.filePaths[0],handle=await open(path,'r');let bytes;
      try {const info=await handle.stat();if(!info.isFile()||info.size>2*1024*1024)throw new InputError('Preview files must be regular files up to 2 MiB.');const buffer=Buffer.alloc(2*1024*1024+1);let offset=0;while(offset<buffer.length){const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,null);if(!bytesRead)break;offset+=bytesRead;}if(offset>2*1024*1024)throw new InputError('Preview file exceeded the size limit.');bytes=buffer.subarray(0,offset);}finally{await handle.close();}
      const mime={'.pdf':'application/pdf','.png':'image/png','.svg':'image/svg+xml','.html':'text/html','.md':'text/markdown','.txt':'text/plain','.json':'application/json','.csv':'text/csv'}[extname(path).toLowerCase()];
      if(!mime)throw new InputError('Unsupported preview type.');
      if(mime==='application/pdf'&&bytes.subarray(0,5).toString()!=='%PDF-')throw new InputError('This does not appear to be a PDF.');
      if(mime==='image/png'&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new InputError('This does not appear to be a PNG.');
      return {snapshot:service.snapshot(),artifact:{id:randomUUID(),name:basename(path),mime,data:bytes.toString('base64')}};
    }
    case 'artifact.pdf': {
      const thread=findThread(service.workspace,identifier(c.id));
      const tool=thread.turns.flatMap(t=>t.replies).flatMap(r=>r.tools??[]).find(t=>t.id===identifier(c.toolId));
      const a=tool?.artifacts.find(a=>a.id===identifier(c.artifactId));if(!a)throw new InputError('Artifact not found.');
      const selected=await dialog.showSaveDialog(window,{title:'Export unencrypted PDF',defaultPath:a.name.replace(/\.[^.]+$/,'')+'.pdf',filters:[{name:'PDF',extensions:['pdf']}]});
      if(selected.canceled||!selected.filePath)break;
      let data;
      if(a.mime==='application/pdf')data=Buffer.from(a.data,'base64');
      else {
        let source=a.mime==='image/png'?'<img alt="Generated image" src="data:image/png;base64,'+a.data+'">':artifactSource(a);if(source===null)throw new InputError('This artifact cannot be printed.');
        if(a.kind==='chart')source=chartSVG(chartSpec(JSON.parse(source)),[],{print:true});
        else if(a.kind==='diagram')source=diagramSVG(diagramSpec(JSON.parse(source)),'print-arrow',true,true);
        else if(a.kind==='table')source=tableHTML(tableSpec(JSON.parse(source)));
        else if(a.kind==='timeline')source=timelineHTML(timelineSpec(JSON.parse(source)));
        else if(a.kind==='stats')source=statsHTML(statsSpec(JSON.parse(source)));
        else if(a.mime==='text/markdown')source=markdown(source,{codeTools:false});
        else if(!['text/html','image/svg+xml','image/png'].includes(a.mime))source='<pre>'+escapeHtml(source)+'</pre>';
        data=await renderPDF({html:source});
      }
      await writeFile(selected.filePath,data,{mode:0o600});break;
    }
    case 'artifact.save': {
      const thread = findThread(service.workspace, identifier(c.id));
      const tool = thread.turns.flatMap(t => t.replies).flatMap(r => r.tools ?? []).find(t => t.id === identifier(c.toolId));
      const artifact = tool?.artifacts.find(a => a.id === identifier(c.artifactId));
      if (!artifact) throw new InputError('This generated file no longer exists.');
      if (['text/html','image/svg+xml'].includes(artifact.mime)) {
        if (!await confirm({tone:'warning',approve:'Save original source',title:'Save original markup outside the protected preview?',
          message:'The saved file is unencrypted. HTML or SVG can contain scripts and external references; opening it in another browser does not retain Workbench’s preview restrictions.'})) break;
      }
      const choice = await dialog.showSaveDialog(window, { title: 'Save generated file outside the encrypted workspace', defaultPath: artifact.name });
      if (!choice.canceled && choice.filePath) await writeFile(choice.filePath, Buffer.from(artifact.data, 'base64'), { mode: 0o600 });
      break;
    }
    case 'open.docs': await shell.openExternal(c.topic === 'python' ? 'https://www.python.org/downloads/windows/' : 'https://docs.tinfoil.sh/get-api-key'); break;
    case 'cloud.key.file': {
      // The key file is read here, so the key does not pass through the page.
      const picked = await dialog.showOpenDialog(window, { properties: ['openFile'], title: 'Open your Tinfoil chat key file', filters: [{ name: 'Tinfoil chat key', extensions: ['pem', 'txt'] }] });
      if (picked.canceled || !picked.filePaths[0]) break;
      if ((await stat(picked.filePaths[0])).size > 4096) throw new InputError('That file is too large to be a Tinfoil chat key.');
      await service.execute({ type: 'cloud.connect', key: await readFile(picked.filePaths[0], 'utf8') });
      break;
    }
    case 'cloud.disconnect': {
      if (await confirm({ approve: 'Remove chat key', title: 'Remove your Tinfoil chat key from Workbench?',
        message: 'Cloud chats and projects are removed from this PC and stay in your Tinfoil account. A chat with changes that were not written yet is kept here as a local conversation.' })) await service.execute(c);
      break;
    }
    case 'thread.delete': {
      const thread = findThread(service.workspace, identifier(c.id));
      if (service.busyThreadId === c.id) throw new InputError('Stop the active response before deleting.');
      if (await confirm(thread.cloud
        ? { tone: 'danger', approve: 'Delete from Tinfoil cloud', title: `Delete “${thread.title}” from Tinfoil cloud?`,
          message: 'This deletes the chat from your Tinfoil account, so it also disappears from Tinfoil Chat on your other devices. There is no undo.' }
        : { tone: 'danger', approve: 'Delete conversation', title: `Delete “${thread.title}”?`,
          message: 'This removes the local conversation. There is no undo; exported copies and filesystem backups are not erased.' })) await service.execute(c);
      break;
    }
    case 'background.get': return { snapshot: service.snapshot(), picture: service.backgroundPicture() };
    case 'background.pick': {
      const selected = await dialog.showOpenDialog(window, { properties: ['openFile'], title: 'Choose a background picture',
        filters: [{ name: 'Pictures', extensions: Object.keys(IMAGE_EXTENSIONS).map(e => e.slice(1)) }] });
      const path = selected.canceled ? null : selected.filePaths[0];
      if (!path) return { snapshot: service.snapshot(), files: [] };
      if (attachmentKind(basename(path)) !== 'image') throw new InputError('Choose a PNG, JPEG, GIF, WebP or BMP picture.');
      const bytes = await boundedBytes(path, IMAGE_LIMITS.sourceBytes);
      return { snapshot: service.snapshot(), files: [{ name: basename(path), mime: IMAGE_EXTENSIONS[extname(path).toLowerCase()], data: bytes.toString('base64') }] };
    }
    case 'attachments.pick': {
      // Text is read here. Pictures and PDFs go to the page as bytes, which prepares them like a dropped file
      // (renderer/attach.ts): it redraws pictures and reads the text out of PDFs.
      const extensions = [...TEXT_EXTENSIONS, ...Object.keys(IMAGE_EXTENSIONS), '.pdf'].map(e => e.slice(1));
      const selected = await dialog.showOpenDialog(window, { properties: ['openFile','multiSelections'], title: 'Attach files',
        filters: [{ name: 'Text, code, pictures and PDFs', extensions }] });
      if (selected.canceled) return { snapshot: service.snapshot(), attachments: [], files: [] };
      if (selected.filePaths.length > LIMITS.attachments) throw new InputError('Attach at most eight files or folders.');
      const texts = [], files = [];
      for (const path of selected.filePaths) {
        const name = basename(path), kind = attachmentKind(name);
        if (kind === 'image' || kind === 'pdf') {
          const bytes = await boundedBytes(path, kind === 'pdf' ? PDF_SOURCE_BYTES : IMAGE_LIMITS.sourceBytes);
          files.push({ name, mime: kind === 'pdf' ? 'application/pdf' : IMAGE_EXTENSIONS[extname(path).toLowerCase()], data: bytes.toString('base64') });
          continue;
        }
        if (kind !== 'text') throw new InputError('Only text and code files, pictures and PDFs can be attached.');
        const content = await boundedRead(path, LIMITS.attachment * 4);
        if (content.includes('\0')) throw new InputError('Binary files cannot be attached.');
        texts.push({ name, content });
      }
      return { snapshot: service.snapshot(), attachments: attachments(texts), files };
    }
    case 'export': {
      const thread = structuredClone(findThread(service.workspace, identifier(c.id)));
      if (!['json','markdown'].includes(c.format)) throw new InputError('Invalid export format.');
      if (!await confirm({ tone: 'warning', approve: 'Export plaintext', title: 'Export an unencrypted copy?',
        message: 'The export contains conversation text, reasoning, system instructions, attached file contents, tool arguments, outputs and generated artifacts (JSON). It never includes your API key. Store it somewhere private.' })) break;
      const ext = c.format === 'json' ? 'json' : 'md';
      const selected = await dialog.showSaveDialog(window, { defaultPath: `conversation.${ext}`, filters: [{ name: 'Conversation', extensions: [ext] }] });
      if (!selected.canceled && selected.filePath) await writeFile(selected.filePath, c.format === 'json' ? exportThread(thread) : exportMarkdown(thread), { encoding: 'utf8', mode: 0o600 });
      break;
    }
    case 'import': {
      const selected = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'Workbench conversation', extensions: ['json'] }] });
      if (!selected.canceled && selected.filePaths[0]) {
        const content = await boundedRead(selected.filePaths[0], LIMITS.importBytes);
        let parsed; try { parsed = JSON.parse(content); } catch { throw new InputError('The file is not valid JSON.'); }
        await service.import(parsed);
      }
      break;
    }
    default: await service.execute(c);
  }
  return { snapshot: service.snapshot() };
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (quitting || !service) return;
  event.preventDefault();
  if (window && !smoke && !closeCoordinator?.approved) { closeCoordinator?.request(); return; }
  quitting = true;
  // Preserve partial text even when verification does not support cancellation.
  let timer;
  const grace = new Promise(resolve => { timer = setTimeout(resolve, 5000); });
  Promise.race([Promise.allSettled([service.shutdown(),account?.shutdown()]), grace]).finally(() => { clearTimeout(timer); app.quit(); });
});
