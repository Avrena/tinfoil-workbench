import { WorkbenchService } from '../desktop/service.mjs';
import { createProvider } from '../desktop/provider.mjs';
import { loadModelCapabilities } from '../desktop/model-catalog.mjs';
import { publicError } from '../dist/core/security.js';
import { InputError } from '../dist/core/validation.js';
import { MobileVault } from './vault.mjs';
import { createCommandHandler, withPlatform } from './commands.mjs';
import { NATIVE_OPERATIONS } from './native-ops.mjs';

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

let service = null, command = null;
const ready = (async () => {
  service = new WorkbenchService(new MobileVault(native), createProvider,
    snapshot => self.postMessage({ kind: 'changed', snapshot: withPlatform(snapshot) }),
    null, { capabilityLoader: loadModelCapabilities });
  await service.initialize();
  command = createCommandHandler({ service, native });
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
  if (data.kind !== 'snapshot' && data.kind !== 'command') return;
  try {
    await ready;
    const value = data.kind === 'snapshot' ? withPlatform(service.snapshot()) : await command(data.command);
    self.postMessage({ kind: 'reply', id: data.id, ok: true, value });
  } catch (error) {
    self.postMessage({ kind: 'reply', id: data.id, ok: false, error: publicError(error) });
  }
});
