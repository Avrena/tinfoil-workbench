import { AccountWindow } from './account-window.mjs';
import { AccountSession } from './account-session.mjs';
import { InputError } from '../dist/core/validation.js';

/** A fresh native account partition; never copies the desktop account or regular browser. */
export async function enrollRemoteChat(host, send, { BrowserWindow, session, confirm }) {
  if (!await confirm({ title: `Connect remote Tinfoil Chat to ${host.name}?`, message: 'A fresh Tinfoil sign-in opens. Only its dedicated session will be sent through SSH and encrypted on this host, so jobs can renew Chat access after this PC closes. Host administrators can access the session. Existing browser and Workbench sign-ins are not copied.', approve: 'Open remote sign-in' })) return;
  let account, connected = false;
  const adapter = new AccountWindow({ BrowserWindow, session }, message => account?.invalidate(message), name => account?.blocked(name));
  account = new AccountSession(adapter);
  try {
    await account.login();
    const state = account.snapshot();
    if (state.status !== 'signed-in' || state.entitlement !== 'active') throw new InputError(state.message || 'Chat subscription access was not established.');
    if (!await confirm({ title: `Use ${state.profile.name} on ${host.name}?`, message: `The dedicated session is transferred to SSH host ${host.alias}. No conversation history is sent.`, approve: 'Connect this account' })) return;
    await adapter.readSession(true, account.binding);
    await send({ op: 'configure-chat', session: { version: 1, binding: account.binding, profile: state.profile, cookies: await adapter.cookies(), savedAt: Date.now() } });
    connected = true;
  } finally { await adapter.clear({ end: !connected }).catch(() => {}); }
}
