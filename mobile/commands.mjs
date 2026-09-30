import { InputError, record, identifier, text, attachments, LIMITS } from '../dist/core/validation.js';
import { findThread, exportThread, exportMarkdown } from '../dist/core/workspace.js';
import { safeExternalURL } from '../dist/core/markdown.js';
import { PREVIEW_LIMIT, previewFile, textAttachments, importText, bytesToBase64 } from './files.mjs';

/** Android counterpart of the command switch in desktop/main.mjs. Keep the two in step:
 * every native confirmation, stale-request recheck and limit here mirrors the desktop case.
 * Features the Android host does not provide fail with an explicit message. */
export const CHAT_UNAVAILABLE = 'Tinfoil Chat sign-in needs a newer Android System WebView on this device. Use a developer API key.';
export const PYTHON_UNAVAILABLE = 'Python execution is not available in the Android app.';
export const PYTHON_SETTING = 'Python execution is not available in the Android app. Set Model-requested Python to Off for this conversation.';
export const PDF_UNAVAILABLE = 'PDF export is not available in the Android app yet. Use Save to keep the original file.';
export const WINDOW_UNAVAILABLE = 'Window controls are not used in the Android app.';

/** `chatAvailable` is false when this WebView cannot isolate Tinfoil's sign-in page (docs/ANDROID-ACCOUNT.md). */
export const withPlatform = (snapshot, chatAvailable = false) => ({ ...snapshot, platform: 'android', chatAvailable });

const utf8Base64 = value => bytesToBase64(new TextEncoder().encode(value));
function artifactFor(service, c) {
  const thread = findThread(service.workspace, identifier(c.id));
  const tool = thread.turns.flatMap(t => t.replies).flatMap(r => r.tools ?? []).find(t => t.id === identifier(c.toolId));
  return tool?.artifacts.find(a => a.id === identifier(c.artifactId)) ?? null;
}
async function pick(native, options) {
  const { files } = await native.openDocuments(options);
  if (!Array.isArray(files)) throw new InputError('The selected file could not be read.');
  return files;
}

export function createCommandHandler({ service, native, account = null, uuid = () => globalThis.crypto.randomUUID() }) {
  const confirm = async options => (await native.confirm(options)).confirmed === true;
  const snapshot = () => withPlatform(service.snapshot(), !!account);
  let accountFlow = null;
  return async function command(input) {
    const c = record(input); text(c.type, 'Command', 80, true);
    switch (c.type) {
      // Tinfoil Chat sign-in mirrors desktop/main.mjs; Tinfoil's page runs in native code (mobile/account.mjs).
      case 'account.login': {
        if (!account) throw new InputError(CHAT_UNAVAILABLE);
        if (service.busyThreadId || service.connection) throw new InputError('Stop the response or wait for verification before signing in.');
        if (accountFlow) throw new InputError('Sign-in is already open.');
        if (account.snapshot().status === 'signed-in') throw new InputError('Sign out before connecting another account.');
        const flow = (async () => {
          if (['expired', 'error'].includes(account.snapshot().status)) await account.signOut();
          await service.execute({ type: 'connection.mode', mode: 'chat-account' });
          await account.login();
        })().catch(() => account.invalidate('Sign-in could not finish. Reopen Account to try again.'));
        accountFlow = flow; void flow.finally(() => { if (accountFlow === flow) accountFlow = null; });
        break;
      }
      case 'account.cancel': {
        if (!account) throw new InputError(CHAT_UNAVAILABLE);
        if (account.snapshot().status !== 'signing-in' && account.snapshot().status !== 'error') throw new InputError('No sign-in is waiting to be cancelled.');
        await account.signOut(); break;
      }
      case 'account.refresh': case 'account.manage': {
        if (!account) throw new InputError(CHAT_UNAVAILABLE);
        if (service.busyThreadId || service.connection) throw new InputError('Finish or stop the response before managing your account.');
        if (c.type === 'account.manage') await account.manage(); else await account.refresh();
        break;
      }
      case 'account.signout': {
        if (!account) throw new InputError(CHAT_UNAVAILABLE);
        if (!await confirm({ title: 'Sign out of Tinfoil Chat?', confirm: 'Sign out on this device', cancel: 'Keep signed in',
          message: 'This stops active responses and clears Workbench’s website session and account tokens on this device. Your local conversations and separately saved API key remain. No automatic API-key fallback is used.' })) break;
        for (const ctrl of service.controllers.values()) ctrl.abort();
        await account.signOut(); service.resetConnection(); service.emit(); break;
      }
      // Staying signed in on this phone: the saved sign-in is sealed natively (mobile/account.mjs, WorkbenchAccount.java).
      case 'account.remember': {
        if (!account) throw new InputError(CHAT_UNAVAILABLE);
        const enabled = c.enabled === true;
        await service.execute({ type: 'account.remember', enabled }); await account.setRemember(enabled); service.emit(); break;
      }
      case 'connection.mode':
        if (c.mode !== 'api-key' && !account) throw new InputError(CHAT_UNAVAILABLE);
        await service.execute(c); break;
      case 'thread.authorize-account': {
        const id = identifier(c.id); service.editable(id);
        if (!service.needsAuthorization(id)) break;
        const owner = service.activeOwner(), thread = findThread(service.workspace, id);
        const name = owner === 'api-key' ? 'the saved developer API key' : account?.snapshot().profile?.name ?? 'your Tinfoil account';
        const allowed = await confirm({ title: 'Use this existing thread with ' + name + '?', confirm: 'Allow this thread', cancel: 'Cancel',
          message: 'Thread: ' + thread.title + '\nThe selected conversation history and attached reference text will be sent only when you next press Send. This approval does not send a request, upload a workspace or move cloud chats.' });
        if (allowed) { if (owner !== service.activeOwner()) throw new InputError('The account changed. Review it again.'); await service.authorizeThread(id); }
        break;
      }
      case 'window': case 'window.close-ack': case 'window.close-response':
        throw new InputError(WINDOW_UNAVAILABLE);
      case 'clipboard': {
        const value = text(c.text, 'Clipboard text', LIMITS.response);
        try { await native.copyText({ text: value }); }
        catch { throw new InputError('Android could not update the clipboard. Try copying again.'); }
        break;
      }
      case 'open.url': {
        const url = safeExternalURL(text(c.url, 'Link', 4096, true));
        if (!url) throw new InputError('Only absolute HTTP or HTTPS links without embedded credentials can be opened.');
        if (await confirm({ title: `Open ${new URL(url).hostname} outside Workbench?`, confirm: 'Open in browser', cancel: 'Cancel',
          message: url + '\n\nThis link comes from conversation content. Opening it shares the URL with your browser and the destination site.' }))
          await native.openExternal({ url });
        break;
      }
      case 'python.pick': case 'python.find': case 'python.use': case 'code.run':
        throw new InputError(PYTHON_UNAVAILABLE);
      case 'agent.folder': case 'agent.folder.clear': case 'agent.root': case 'agent.approval':
        throw new InputError('The workspace agent needs the Windows app.');
      case 'thread.settings':
        if (record(c.settings).toolsMode === 'ask') throw new InputError(PYTHON_SETTING);
        await service.execute(c); break;
      case 'send': case 'turn.retry': {
        // The shared service would ask for a desktop interpreter; give the Android reason instead.
        if (findThread(service.workspace, identifier(c.id)).settings.toolsMode === 'ask') throw new InputError(PYTHON_SETTING);
        await service.execute(c); break;
      }
      case 'tool.approve': {
        const pending = service.approvals.get(identifier(c.toolId));
        if (!pending || pending.threadId !== identifier(c.id) || typeof c.approve !== 'boolean') throw new InputError('This execution request is no longer awaiting approval.');
        let approve = false;
        if (c.approve && pending.tool.name === 'delegate_task') {
          const child = pending.tool.delegate;
          if (!child) throw new InputError('The delegated task is not ready for approval.');
          approve = await confirm({ title: 'Approve one additional model request?', confirm: 'Send one delegated request', cancel: 'Cancel',
            message: 'Model: ' + child.model + '\nMaximum output: 4,096 tokens (or the lower conversation limit). Additional inference usage applies. Only the task below is sent; no tools or conversation history are inherited.\n\n' + child.task });
        } else if (c.approve) {
          if (pending.tool.name !== 'python') throw new InputError('This tool has no approval handler.');
          throw new InputError(PYTHON_UNAVAILABLE);
        }
        // Recheck after the native dialog: cancellation and stale requests cannot execute.
        if (service.approvals.get(c.toolId) !== pending) throw new InputError('This execution request is no longer awaiting approval.');
        await service.execute({ type: 'tool.approve', id: c.id, toolId: c.toolId, approve });
        break;
      }
      case 'artifact.open': {
        const files = await pick(native, { multiple: false, maxCount: 1, maxBytes: PREVIEW_LIMIT });
        if (!files.length) break;
        return { snapshot: snapshot(), artifact: { id: uuid(), ...previewFile(files[0]) } };
      }
      case 'artifact.pdf': {
        const a = artifactFor(service, c);
        if (!a) throw new InputError('Artifact not found.');
        // An existing PDF is saved as-is; rendering other artifacts to PDF needs a print adapter Android lacks.
        if (a.mime !== 'application/pdf') throw new InputError(PDF_UNAVAILABLE);
        await native.saveDocument({ name: a.name.replace(/\.[^.]+$/, '') + '.pdf', mime: 'application/pdf', data: a.data });
        break;
      }
      case 'artifact.save': {
        const artifact = artifactFor(service, c);
        if (!artifact) throw new InputError('This generated file no longer exists.');
        if (['text/html', 'image/svg+xml'].includes(artifact.mime) && !await confirm({ title: 'Save original markup outside the protected preview?', confirm: 'Save original source', cancel: 'Cancel',
          message: 'The saved file is unencrypted. HTML or SVG can contain scripts and external references; opening it in another browser does not retain Workbench’s preview restrictions.' })) break;
        await native.saveDocument({ name: artifact.name, mime: artifact.mime, data: artifact.data });
        break;
      }
      case 'open.docs': await native.openExternal({ url: c.topic === 'python' ? 'https://www.python.org/downloads/windows/' : 'https://docs.tinfoil.sh/get-api-key' }); break;
      case 'thread.delete': {
        const thread = findThread(service.workspace, identifier(c.id));
        if (service.busyThreadId === c.id) throw new InputError('Stop the active response before deleting.');
        if (await confirm({ title: `Delete “${thread.title}”?`, confirm: 'Delete conversation', cancel: 'Cancel', danger: true,
          message: 'This removes the local conversation. There is no undo; exported copies and filesystem backups are not erased.' }))
          await service.execute(c);
        break;
      }
      case 'attachments.pick': {
        // One more than the limit is requested so an over-selection is reported instead of truncated.
        const files = await pick(native, { multiple: true, maxCount: LIMITS.attachments + 1, maxBytes: LIMITS.attachment * 4 });
        return { snapshot: snapshot(), attachments: files.length ? attachments(textAttachments(files, LIMITS)) : [] };
      }
      case 'export': {
        const thread = structuredClone(findThread(service.workspace, identifier(c.id)));
        if (!['json', 'markdown'].includes(c.format)) throw new InputError('Invalid export format.');
        if (!await confirm({ title: 'Export an unencrypted copy?', confirm: 'Export plaintext', cancel: 'Cancel',
          message: 'The export contains conversation text, reasoning, system instructions attached file contents, tool arguments, outputs and generated artifacts (JSON). It never includes your API key. Store it somewhere private.' })) break;
        const json = c.format === 'json';
        await native.saveDocument({ name: `conversation.${json ? 'json' : 'md'}`, mime: json ? 'application/json' : 'text/markdown',
          data: utf8Base64(json ? exportThread(thread) : exportMarkdown(thread)) });
        break;
      }
      case 'import': {
        const files = await pick(native, { multiple: false, maxCount: 1, maxBytes: LIMITS.importBytes });
        if (files.length) {
          let parsed; try { parsed = JSON.parse(importText(files[0], LIMITS.importBytes)); } catch (error) { throw error instanceof InputError ? error : new InputError('The file is not valid JSON.'); }
          await service.import(parsed);
        }
        break;
      }
      default: await service.execute(c);
    }
    return { snapshot: snapshot() };
  };
}
