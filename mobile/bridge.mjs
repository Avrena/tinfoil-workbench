import { registerPlugin } from '@capacitor/core';
import { nativeRequest } from './native-ops.mjs';

/** Android counterpart of desktop/preload.cjs. It exposes the same data-only window.tinfoil
 * surface to the unchanged renderer and relays it to the host worker. Worker requests for
 * device access are limited to the validated operations in native-ops.mjs. */
const Workbench = registerPlugin('Workbench');
const worker = new Worker('/mobile/host-worker.js', { name: 'workbench-host' });
const replies = new Map(), listeners = new Set(), appListeners = new Set();
let nextRequest = 0, fatal = null;

function request(kind, extra) {
  if (fatal) return Promise.reject(new Error(fatal));
  const id = ++nextRequest;
  return new Promise((resolve, reject) => {
    replies.set(id, { resolve, reject });
    worker.postMessage({ kind, id, ...extra });
  });
}
function failAll(message) {
  fatal = message;
  for (const { reject } of replies.values()) reject(new Error(message));
  replies.clear();
}
async function runNative(id, op, args) {
  let message;
  try {
    const value = await Workbench[op](nativeRequest(op, args));
    worker.postMessage({ kind: 'native-result', id, ok: true, value });
    return;
  } catch (error) {
    // Plugin rejections carry fixed messages; validation failures are programming errors.
    message = error instanceof TypeError ? 'The Android operation was refused.' : error?.message;
  }
  worker.postMessage({ kind: 'native-result', id, ok: false, error: typeof message === 'string' && message ? message : 'The Android operation failed.' });
}

worker.addEventListener('message', ({ data }) => {
  if (!data || typeof data !== 'object') return;
  switch (data.kind) {
    case 'reply': {
      const pending = replies.get(data.id);
      if (!pending) return;
      replies.delete(data.id);
      if (data.ok) pending.resolve(data.value); else pending.reject(new Error(typeof data.error === 'string' ? data.error : 'The operation failed.'));
      return;
    }
    case 'changed': for (const listener of listeners) listener(data.snapshot); return;
    case 'native': void runNative(data.id, data.op, data.args); return;
    case 'fatal': failAll(typeof data.message === 'string' ? data.message : 'Tinfoil Workbench could not start.'); return;
  }
});
worker.addEventListener('error', () => failAll('Tinfoil Workbench could not start its secure host.'));


// Back closes the topmost renderer layer first; otherwise the app moves to the background
// instead of finishing, so an active response is not cut off.
async function appEvent(event) {
  let handled = false;
  for (const listener of [...appListeners]) {
    try { handled = (await listener(event)) === true || handled; } catch { /* keep other listeners */ }
  }
  return handled;
}
void Workbench.addListener('backButton', async () => { if (!await appEvent('back')) await Workbench.moveTaskToBack(); });
void Workbench.addListener('pause', () => { void appEvent('pause'); });
// On resume the account session drops a key that expired meanwhile; timers do not run while the app sleeps.
void Workbench.addListener('resume', () => { worker.postMessage({ kind: 'resume' }); });

// Tinfoil Chat sign-in (docs/ANDROID-ACCOUNT.md). Native code posts one message port to this page, which runs
// before the renderer. It goes to the host worker unread, so account credentials never pass through this
// document. Only a message from native code (no source window) is accepted, and only the first. The channel is
// requested after the app-event listeners, so a Back press right after launch is not lost behind this call.
let accountSettled = false;
function settleAccount(port) {
  if (accountSettled) return;
  accountSettled = true;
  worker.postMessage({ kind: 'account', port }, port ? [port] : []);
}
window.addEventListener('message', event => {
  if (accountSettled || event.source !== null || event.data !== 'tinfoil-account-port' || event.ports.length !== 1) return;
  event.stopImmediatePropagation();
  settleAccount(event.ports[0]);
}, true);
Workbench.accountChannel().catch(() => settleAccount(null));

Object.defineProperty(window, 'tinfoil', { configurable: false, enumerable: false, writable: false, value: Object.freeze({
  snapshot: () => request('snapshot'),
  command: command => request('command', { command }),
  subscribe: callback => {
    if (typeof callback !== 'function') throw new TypeError('A callback is required.');
    listeners.add(callback);
    return () => listeners.delete(callback);
  },
  onAppEvent: callback => {
    if (typeof callback !== 'function') throw new TypeError('A callback is required.');
    appListeners.add(callback);
    return () => appListeners.delete(callback);
  },
}) });
