import { join } from 'node:path';

/** Approval windows (docs/WORKSPACE-AGENT.md). Each is a small modal window of its own, opened by the main process for
 * one pending call, or for a question it asks before acting (`confirmation`), from app://approval: another origin than
 * the conversation page, with its own preload. It shows the request the main process built (core/approval.ts), and
 * only that window can answer it; closing it declines. */
export function createApprovals({ BrowserWindow, ipcMain, screen, root, devTools = false, theme = null }) {
  const open = new Map(); // webContents id -> { request, win, decided, fitted }
  // The request, with the conversation window's theme so the approval window matches it.
  ipcMain.handle('approval:request', event => { const entry = open.get(event.sender.id); return entry ? { ...entry.request, ...(entry.theme ? { theme: entry.theme } : {}) } : null; });
  ipcMain.on('approval:decide', (event, approve) => {
    const entry = open.get(event.sender.id);
    if (!entry || entry.decided !== null) return;
    entry.decided = approve === true; entry.win.close();
  });
  // The page reports its height once; the window takes it, up to most of the screen, and is shown centred.
  ipcMain.on('approval:fit', (event, height) => {
    const entry = open.get(event.sender.id);
    if (!entry || entry.fitted || entry.win.isDestroyed()) return;
    entry.fitted = true;
    const area = screen.getDisplayMatching(entry.win.getBounds()).workArea, [width] = entry.win.getContentSize();
    const least = entry.request.kind === 'confirm' ? 120 : 220;
    entry.win.setContentSize(width, Math.max(least, Math.min(Math.ceil(Number(height) || 0), Math.floor(area.height * 0.85))));
    entry.win.center(); entry.win.show();
  });
  return {
    /** Resolves true only when the person chose to approve in this window. `onShow` is for the smoke test. */
    ask(parent, request, { onShow } = {}) {
      return new Promise(resolve => {
        const look = theme?.() ?? null;
        const win = new BrowserWindow({ parent: parent ?? undefined, modal: !!parent, show: false, width: request.kind === 'confirm' ? 520 : 680, height: 420, useContentSize: true,
          minWidth: 420, minHeight: request.kind === 'confirm' ? 120 : 220, title: 'Tinfoil Workbench', backgroundColor: look?.tokens.n0 ?? '#1e1e1e', autoHideMenuBar: true,
          minimizable: false, maximizable: false, fullscreenable: false,
          webPreferences: { preload: join(root, 'desktop', 'approval-preload.cjs'), contextIsolation: true, nodeIntegration: false,
            sandbox: true, webSecurity: true, webviewTag: false, spellcheck: false, devTools } });
        const id = win.webContents.id, entry = { request, theme: look, win, decided: null, fitted: false };
        open.set(id, entry);
        win.setMenu(null);
        // The heading already asks the question; the title bar names the app.
        win.on('page-title-updated', event => event.preventDefault());
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        win.webContents.on('will-navigate', event => event.preventDefault());
        win.webContents.on('will-attach-webview', event => event.preventDefault());
        if (onShow) win.once('show', () => onShow(win));
        // A page that never reports its height is still shown.
        const fallback = setTimeout(() => { if (!win.isDestroyed() && !win.isVisible()) win.show(); }, 1500);
        win.on('closed', () => { clearTimeout(fallback); open.delete(id); resolve(entry.decided === true); });
        win.loadURL('app://approval/approval.html').catch(() => { if (!win.isDestroyed()) win.close(); });
      });
    },
  };
}
