import { app, BrowserWindow, Menu, protocol, session, ipcMain, safeStorage, dialog, clipboard, shell, nativeTheme, powerMonitor } from 'electron';
import { join, dirname, basename, extname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readFile, writeFile, open, stat } from 'node:fs/promises';
import { renderPDF } from './pdf-renderer.mjs';
import { loadModelCapabilities } from './model-catalog.mjs';
import { artifactSource, chartSpec, chartSVG, diagramSpec, diagramSVG, tableSpec, tableHTML } from '../dist/core/visual-tools.js';
import { markdown, escapeHtml } from '../dist/core/markdown.js';
import { randomUUID } from 'node:crypto';
import { EncryptedVault } from './vault.mjs';
import { WorkbenchService } from './service.mjs';
import { runPython } from './python-runner.mjs';
import { safeExternalURL } from '../dist/core/markdown.js';
import { pythonArguments } from '../dist/core/tools.js';
import { createProvider } from './provider.mjs';
import { CloudClient, SYNC_URL, SYNC_REPO } from './cloud-client.mjs';
import { CloseCoordinator, persistCloseDecision } from './close-coordinator.mjs';
import { AccountSession } from './account-session.mjs';
import { AccountWindow } from './account-window.mjs';
import { AccountStore } from './account-store.mjs';
import { resourcePath, trustedFrame, publicError } from '../dist/core/security.js';
import { InputError, record, identifier, text, attachments, LIMITS } from '../dist/core/validation.js';
import { findThread, exportThread, exportMarkdown } from '../dist/core/workspace.js';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const smoke = process.argv.includes('--smoke-test');
if (smoke) app.setPath('userData', mkdtempSync(join(tmpdir(), 'tinfoil-smoke-')));
const origin = 'app://workbench/index.html';
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.enableSandbox();
app.setAppUserModelId('org.avrena.tinfoil.workbench');
let window, service, account, accountFlow, closeCoordinator, quitting = false;
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
  service = new WorkbenchService(vault, createProvider, snapshot => {
    if (window && !window.isDestroyed()) window.webContents.send('workbench:changed', snapshot);
  }, runPython, {pdfRenderer:renderPDF,capabilityLoader:loadModelCapabilities,account,cloudClient:new CloudClient({
    // Tinfoil's sync enclave, attested like inference; the SDK is loaded only when cloud sync is used.
    secureClient: async () => { const { SecureClient } = await import('tinfoil'); return new SecureClient({ enclaveURL: SYNC_URL, configRepo: SYNC_REPO, userCacheSecret: service.workspace.cacheSecret }); },
    token: async force => (await account.sessionToken(force)).bearer,
  })});
  await service.initialize();
  // Cloud chats sync after sign-in and then every ten minutes while the app is open.
  if (!smoke) setInterval(() => service.syncCloud(), 600_000).unref?.();
  await account.setRemember(service.workspace.rememberAccount!==false);
  // Restores in the background; the account view shows "Restoring" until it finishes.
  void account.restore();
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
    callback({ cancel: !(u.protocol === 'app:' && u.hostname === 'workbench') && !['about:', 'data:'].includes(u.protocol) });
  });
  window = new BrowserWindow({ width: 1440, height: 920, minWidth: 360, minHeight: 420,
    title: 'Tinfoil Workbench', backgroundColor: '#1e1e1e', frame: false, show: false,
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
      const answer = await dialog.showMessageBox(window, {
        type: 'warning', buttons: ['Keep open', 'Close anyway'], defaultId: 0, cancelId: 0,
        message: 'The interface did not confirm that the draft was saved.',
        detail: 'Closing now may discard unsaved edits or the latest draft. Already saved encrypted conversations are not reset. Keep the window open to retry or export your work.'
      });
      return answer.response === 1;
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
    console.log('DESKTOP_SMOKE_OK: encrypted storage, bridge, attested SDK import, native PDF print and PDF.js canvas');
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
const EXTENSIONS = new Set(['.txt','.md','.markdown','.json','.csv','.ts','.tsx','.js','.jsx','.mjs','.cjs','.lua','.py','.c','.h','.cpp','.hpp','.cs','.rs','.go','.html','.css','.xml','.yaml','.yml','.toml','.ini','.log','.sql','.sh','.ps1']);
async function boundedRead(path, limit) {
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw new InputError('The selected file is too large or is not a regular file.');
    // Read at most limit+1 even when another process grows a file after stat().
    const buffer = Buffer.alloc(limit + 1); let offset = 0;
    while (offset < buffer.length) { const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null); if (!bytesRead) break; offset += bytesRead; }
    if (offset > limit) throw new InputError('The selected file exceeds the size limit.');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset)); }
    catch { throw new InputError('Only UTF-8 text files are supported.'); }
  } finally { await handle.close(); }
}
async function command(input) {
  const c = record(input); text(c.type, 'Command', 80, true);
  switch (c.type) {
    case 'account.login': {
      if(service.busyThreadId||service.connection)throw new InputError('Stop the response or wait for verification before signing in.');
      if(accountFlow)throw new InputError('Sign-in is already open.');
      if(account.snapshot().status==='signed-in')throw new InputError('Sign out before connecting another account.');
      if(account.snapshot().status==='restoring')throw new InputError('Workbench is restoring your saved sign-in. Wait a moment.');
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
      const result=await dialog.showMessageBox(window,{type:'question',buttons:['Keep signed in','Sign out on this device'],defaultId:0,cancelId:0,
        message:'Sign out of Tinfoil Chat?',detail:'This stops active responses, ends Workbench’s website session, deletes the sign-in saved on this PC and clears account tokens. Your local conversations and separately saved API key remain. No automatic API-key fallback is used. This does not sign out your regular browser.'});
      if(result.response!==1)break;
      for(const ctrl of service.controllers.values())ctrl.abort();
      await account.signOut();service.resetConnection();service.emit();break;
    }
    case 'thread.authorize-account': {
      const id=identifier(c.id);service.editable(id);
      if(!service.needsAuthorization(id))break;
      const owner=service.activeOwner(),thread=findThread(service.workspace,id);
      const name=owner==='api-key'?'the saved developer API key':account.snapshot().profile?.name;
      const result=await dialog.showMessageBox(window,{type:'question',buttons:['Cancel','Allow this thread'],defaultId:0,cancelId:0,
        message:'Use this existing thread with '+name+'?',detail:'Thread: '+thread.title+'\nThe selected conversation history and attached reference text will be sent only when you next press Send. This approval does not send a request, upload a workspace or move cloud chats.'});
      if(result.response===1){if(owner!==service.activeOwner())throw new InputError('The account changed. Review it again.');await service.authorizeThread(id);}break;
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
      const result = await dialog.showMessageBox(window, { type: 'question', buttons: ['Cancel', 'Open in browser'], defaultId: 0, cancelId: 0,
        message: `Open ${new URL(url).hostname} outside Workbench?`, detail: url + '\n\nThis link comes from conversation content. Opening it shares the URL with your browser and the destination site.' });
      if (result.response === 1) await shell.openExternal(url);
      break;
    }
    case 'python.pick': {
      if (service.busyThreadId) throw new InputError('Stop the active operation before changing the Python interpreter.');
      const selected = await dialog.showOpenDialog(window, { title: 'Choose an installed Python interpreter (python.exe)', properties: ['openFile'],
        ...(process.platform === 'win32' ? { filters: [{ name: 'Python executable', extensions: ['exe'] }] } : {}) });
      if (selected.canceled || !selected.filePaths[0]) break;
      const path = selected.filePaths[0];
      if (!isAbsolute(path) || !(await stat(path)).isFile() || (process.platform === 'win32' && extname(path).toLowerCase() !== '.exe')) throw new InputError('Choose a regular Python executable.');
      if (service.busyThreadId) throw new InputError('Stop the active operation before changing the Python interpreter.');
      service.workspace.pythonPath = path; await service.save(); service.emit();
      break;
    }
    case 'tool.approve': {
      const pending = service.approvals.get(identifier(c.toolId));
      if (!pending || pending.threadId !== identifier(c.id) || typeof c.approve !== 'boolean') throw new InputError('This execution request is no longer awaiting approval.');
      let approve = false;
      if (c.approve && pending.tool.name === 'delegate_task') {
        const child=pending.tool.delegate;
        if(!child)throw new InputError('The delegated task is not ready for approval.');
        const result=await dialog.showMessageBox(window,{type:'question',buttons:['Cancel','Send one delegated request'],defaultId:0,cancelId:0,noLink:true,
          message:'Approve one additional model request?',detail:'Model: '+child.model+'\nMaximum output: 4,096 tokens (or the lower conversation limit). Additional inference usage applies. Only the task below is sent; no tools or conversation history are inherited.\n\n'+child.task});
        approve=result.response===1;
      } else if (c.approve) {
        if(pending.tool.name!=='python')throw new InputError('This tool has no approval handler.');
        if (!service.workspace.pythonPath) throw new InputError('Choose Python in Settings → Execution first. Decline this run and stop the response to change the interpreter.');
        const code = pythonArguments(pending.tool.arguments).code;
        const result = await dialog.showMessageBox(window, { type: 'warning', buttons: ['Do not run', 'Run this code once'], defaultId: 0, cancelId: 0, noLink: true,
          message: 'Run model-provided Python on this computer?',
          detail: 'NOT A SANDBOX: this code can access files and the network with your Windows account permissions. Review all code. This approval applies to this exact run only.\n\nInterpreter: ' + service.workspace.pythonPath + '\n\n' + code });
        approve = result.response === 1;
      }
      // Recheck after the native dialog: cancellation and stale requests cannot execute.
      if (service.approvals.get(c.toolId) !== pending) throw new InputError('This execution request is no longer awaiting approval.');
      await service.execute({ type: 'tool.approve', id: c.id, toolId: c.toolId, approve });
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
        const warning = await dialog.showMessageBox(window, {type:'warning', buttons:['Cancel','Save original source'],defaultId:0,cancelId:0,
          message:'Save original markup outside the protected preview?',detail:'The saved file is unencrypted. HTML or SVG can contain scripts and external references; opening it in another browser does not retain Workbench’s preview restrictions.'});
        if (warning.response !== 1) break;
      }
      const choice = await dialog.showSaveDialog(window, { title: 'Save generated file outside the encrypted workspace', defaultPath: artifact.name });
      if (!choice.canceled && choice.filePath) await writeFile(choice.filePath, Buffer.from(artifact.data, 'base64'), { mode: 0o600 });
      break;
    }
    case 'open.docs': await shell.openExternal('https://docs.tinfoil.sh/get-api-key'); break;
    case 'cloud.key.file': {
      // The key file is read here, so the key does not pass through the page.
      const picked = await dialog.showOpenDialog(window, { properties: ['openFile'], title: 'Open your Tinfoil chat key file', filters: [{ name: 'Tinfoil chat key', extensions: ['pem', 'txt'] }] });
      if (picked.canceled || !picked.filePaths[0]) break;
      if ((await stat(picked.filePaths[0])).size > 4096) throw new InputError('That file is too large to be a Tinfoil chat key.');
      await service.execute({ type: 'cloud.connect', key: await readFile(picked.filePaths[0], 'utf8') });
      break;
    }
    case 'cloud.disconnect': {
      const result = await dialog.showMessageBox(window, { type: 'question', buttons: ['Cancel', 'Remove chat key'], defaultId: 0, cancelId: 0,
        message: 'Remove your Tinfoil chat key from Workbench?', detail: 'Cloud chats and projects are removed from this PC and stay in your Tinfoil account. A chat with changes that were not written yet is kept here as a local conversation.' });
      if (result.response === 1) await service.execute(c);
      break;
    }
    case 'thread.delete': {
      const thread = findThread(service.workspace, identifier(c.id));
      if (service.busyThreadId === c.id) throw new InputError('Stop the active response before deleting.');
      const result = await dialog.showMessageBox(window, thread.cloud
        ? { type: 'warning', buttons: ['Cancel', 'Delete from Tinfoil cloud'], defaultId: 0, cancelId: 0, message: `Delete “${thread.title}” from Tinfoil cloud?`,
          detail: 'This deletes the chat from your Tinfoil account, so it also disappears from Tinfoil Chat on your other devices. There is no undo.' }
        : { type: 'warning', buttons: ['Cancel', 'Delete conversation'], defaultId: 0, cancelId: 0,
          message: `Delete “${thread.title}”?`, detail: 'This removes the local conversation. There is no undo; exported copies and filesystem backups are not erased.' });
      if (result.response === 1) await service.execute(c);
      break;
    }
    case 'attachments.pick': {
      const selected = await dialog.showOpenDialog(window, { properties: ['openFile','multiSelections'], title: 'Attach UTF-8 text or code',
        filters: [{ name: 'Text and source files', extensions: [...EXTENSIONS].map(e => e.slice(1)) }] });
      if (selected.canceled) return { snapshot: service.snapshot(), attachments: [] };
      if (selected.filePaths.length > LIMITS.attachments) throw new InputError('Choose at most eight text files.');
      const files = [];
      for (const path of selected.filePaths) {
        if (!EXTENSIONS.has(extname(path).toLowerCase())) throw new InputError('Only supported text and source files can be attached.');
        const content = await boundedRead(path, LIMITS.attachment * 4);
        if (content.includes('\0')) throw new InputError('Binary files cannot be attached.');
        files.push({ name: basename(path), content });
      }
      return { snapshot: service.snapshot(), attachments: attachments(files) };
    }
    case 'export': {
      const thread = structuredClone(findThread(service.workspace, identifier(c.id)));
      if (!['json','markdown'].includes(c.format)) throw new InputError('Invalid export format.');
      const warning = await dialog.showMessageBox(window, { type: 'warning', buttons: ['Cancel','Export plaintext'], defaultId: 0, cancelId: 0,
        message: 'Export an unencrypted copy?', detail: 'The export contains conversation text, reasoning, system instructions attached file contents, tool arguments, outputs and generated artifacts (JSON). It never includes your API key. Store it somewhere private.' });
      if (warning.response !== 1) break;
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
