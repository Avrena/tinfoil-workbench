import { WorkbenchService } from '../desktop/service.mjs';
import { createProvider } from '../desktop/provider.mjs';
import { loadModelCapabilities } from '../desktop/model-catalog.mjs';
import { publicError } from '../dist/core/security.js';
import { InputError } from '../dist/core/validation.js';
import { MobileVault } from './vault.mjs';
import { createCommandHandler, withPlatform } from './commands.mjs';
import { NATIVE_OPERATIONS } from './native-ops.mjs';
import { AccountSession } from '../desktop/account-session.mjs';
import { createAccountChannel, NativeAccountWindow, nativeAccountStore, nativeFetcher } from './account.mjs';

/** Dedicated worker that plays the role of the Electron main process on Android. The shared
 * service, the verified Tinfoil SDK (attestation + EHBP), the vault data key and the API key live
 * here, outside the renderer document, whose CSP keeps connect-src 'self'. The worker reaches the
 * device only through the fixed native operations relayed by mobile/bridge.mjs. */
const calls = new Map();
let nextCall = 0;
function nativeCall(op, args) {
  const id = ++nextCall;
  return new Promise((resolve, reject) => {
    calls.set(id, { resolve, reject });
    self.postMessage({ kind: 'native', id, op, args });
  });
}
const native = Object.freeze(Object.fromEntries(NATIVE_OPERATIONS.map(op => [op, (args = {}) => nativeCall(op, args)])));

// Tinfoil Chat sign-in: mobile/bridge.mjs sends exactly one account message, with the private port or without
// one when this WebView cannot support it. Later account messages are ignored.
let settleAccount;
const accountPort = new Promise(resolve => { settleAccount = resolve; setTimeout(() => resolve(null), 5000); });

let service = null, command = null, account = null, lastPause = 0;
const ready = (async () => {
  const port = await accountPort;
  if (port) {
    const channel = createAccountChannel(port);
    const page = new NativeAccountWindow(channel, message => account?.invalidate(message), host => account?.blocked(host), { onCookies: () => account?.cookiesChanged() });
    // Staying signed in keeps Tinfoil's website session between launches, sealed with an Android Keystore key.
    account = new AccountSession(page, () => service?.accountChanged(), { fetcher: nativeFetcher(channel), store: nativeAccountStore(channel) });
  }
  const chat = !!account;
  service = new WorkbenchService(new MobileVault(native), createProvider,
    snapshot => self.postMessage({ kind: 'changed', snapshot: withPlatform(snapshot, chat) }),
    null, { capabilityLoader: loadModelCapabilities, account, autoConnect: true, backgroundedSince: time => lastPause >= time });
  await service.initialize();
  if (account) {
    await account.setRemember(service.workspace.rememberAccount !== false);
    // Restores in the background; Account shows "Restoring" until it finishes, as on Windows.
    void account.restore();
  }
  void service.autoConnect();
  command = createCommandHandler({ service, native, account });
})();
ready.then(() => self.postMessage({ kind: 'ready' }), () => self.postMessage({ kind: 'fatal',
  message: 'The encrypted workspace could not be opened. It has not been reset or overwritten. Check device storage and restart the app.' }));

self.addEventListener('message', async ({ data }) => {
  if (!data || typeof data !== 'object') return;
  if (data.kind === 'native-result') {
    const call = calls.get(data.id);
    if (!call) return;
    calls.delete(data.id);
    // Native rejections carry fixed, user-facing messages written in the Android plugin.
    if (data.ok) call.resolve(data.value); else call.reject(new InputError(typeof data.error === 'string' && data.error ? data.error.slice(0, 300) : 'The Android operation failed.'));
    return;
  }
  if (data.kind === 'account') { settleAccount(data.port instanceof MessagePort ? data.port : null); return; }
  if (data.kind === 'resume') { account?.resume(); return; }
  // Android may end a paused app without warning, so a saved sign-in is refreshed now rather than after a delay.
  if (data.kind === 'pause') { lastPause = Number.isFinite(data.at) ? data.at : Date.now(); void account?.persist().catch(() => {}); return; }
  if (data.kind !== 'snapshot' && data.kind !== 'command') return;
  try {
    await ready;
    const value = data.kind === 'snapshot' ? withPlatform(service.snapshot(), !!account) : await command(data.command);
    self.postMessage({ kind: 'reply', id: data.id, ok: true, value });
  } catch (error) {
    self.postMessage({ kind: 'reply', id: data.id, ok: false, error: publicError(error) });
  }
});
