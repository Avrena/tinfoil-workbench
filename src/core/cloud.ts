/** Tinfoil cloud chats and projects: the parts that need no network or cryptography. The formats follow Tinfoil's
 * own client (docs/CLOUD.md). Remote plaintext is untrusted input; everything taken from it is length-limited. */
import type { Attachment, Project, Reply, Thread, Turn } from './types.js';
import { LIMITS } from './validation.js';
import { defaults, uid } from './workspace.js';
import { escapePromptContent } from './prompt.js';

/** A conversation that is also a Tinfoil cloud chat. `turns` is how many turns came from the cloud at the last sync:
 * later turns are Workbench's own until they are written back. `loaded` is false for a listed chat whose messages
 * have not been fetched yet. */
export interface CloudChatLink { id: string; etag: string; project: string | null; turns: number; loaded: boolean; dirty: boolean; syncedAt: number }
export interface CloudDocument { id: string; etag: string; name: string; type: string; content: string }
export interface CloudProjectLink { id: string; etag: string; description: string; instructions: string; color: string; documents: CloudDocument[]; syncedAt: number }

const KEY_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const PEM = /-----BEGIN TINFOIL CHAT ENCRYPTION KEY-----\s*([a-z0-9]+)\s*-----END TINFOIL CHAT ENCRYPTION KEY-----/;
/** Tinfoil shows its 32-byte chat key as `key_` and two base-36 characters per byte; its key file holds the same
 * characters between PEM markers. Returns the canonical `key_…` form and the bytes, or null. */
export function parseCloudKey(input: string): { key: string; bytes: Uint8Array } | null {
  if (typeof input !== 'string' || input.length > 4096) return null;
  const pem = PEM.exec(input), body = pem ? pem[1]! : input.trim().replace(/^key_/, '');
  if (!/^[a-z0-9]{64}$/.test(body)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    const value = KEY_CHARS.indexOf(body[i * 2]!) * 36 + KEY_CHARS.indexOf(body[i * 2 + 1]!);
    if (value > 255) return null;
    bytes[i] = value;
  }
  return { key: 'key_' + body, bytes };
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Json : null;
const str = (v: unknown, max: number): string => typeof v === 'string' ? v.slice(0, max) : '';
const time = (v: unknown, fallback: number): number => {
  const t = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) && t > 0 && t < 8.64e15 ? t : fallback;
};
const plainName = (v: unknown, max: number): string => str(v, max * 4).replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
export const cloudTitle = (v: unknown): string => plainName(v, 120) || 'Untitled chat';

/** Messages grouped into turns: a user message starts one, and the first assistant message after it answers it. An
 * assistant message with no user message before it becomes a turn with an empty prompt. Deterministic, so the same
 * remote messages always give the same turns (write-back relies on it). */
export function groupMessages(messages: unknown[]): { user: number | null; assistant: number | null }[] {
  const groups: { user: number | null; assistant: number | null }[] = [];
  messages.forEach((m, i) => {
    const role = obj(m)?.role;
    if (role === 'user') groups.push({ user: i, assistant: null });
    else if (role === 'assistant') {
      const last = groups[groups.length - 1];
      if (last && last.assistant === null) last.assistant = i; else groups.push({ user: null, assistant: i });
    }
  });
  return groups;
}

/** Documents attached to a Tinfoil message become reference files; images, which Workbench cannot send, are named in
 * the turn's display only (never added to its prompt, which must stay the cloud message's text). */
function cloudAttachments(message: Json | null): Attachment[] {
  const list = Array.isArray(message?.attachments) ? message!.attachments as unknown[] : [];
  const files: Attachment[] = [];
  for (const a of list.slice(0, LIMITS.attachments)) {
    const item = obj(a); const content = str(item?.textContent, LIMITS.attachment);
    if (item?.type === 'document' && content) files.push({ name: str(item.fileName, 200).replace(/[\x00-\x1f\x7f]/g, '') || 'document', content });
  }
  return files;
}

/** Maps a cloud chat's plaintext onto a conversation. `existing` keeps the local conversation's identity and
 * settings; replies get fresh IDs because Tinfoil's messages have none. */
export function threadFromCloud(plain: Json, link: Omit<CloudChatLink, 'turns' | 'loaded' | 'dirty' | 'syncedAt'>, projectId: string | null, now: number, existing?: Thread, loaded = true): Thread {
  const messages = Array.isArray(plain.messages) ? plain.messages : [];
  const created = time(plain.createdAt, now), updated = time(plain.updatedAt, created);
  const model = str(plain.model, 200);
  const turns: Turn[] = loaded ? groupMessages(messages).slice(0, LIMITS.turns).map(g => {
    const user = g.user === null ? null : obj(messages[g.user]), answer = g.assistant === null ? null : obj(messages[g.assistant]);
    const replies: Reply[] = [{ id: uid(), model: str(answer?.modelDisplayName, 200) || model || 'Tinfoil Chat', content: str(answer?.content, LIMITS.response),
      reasoning: str(answer?.thoughts, LIMITS.response), status: answer ? (answer.isError === true ? 'error' : 'complete') : 'interrupted',
      finishReason: null, error: answer?.isError === true ? 'The reply failed in Tinfoil Chat.' : answer ? null : 'No reply was saved in Tinfoil Chat.', usage: null, elapsedMs: 0 }];
    return { id: uid(), prompt: str(user?.content, LIMITS.prompt), attachments: cloudAttachments(user), createdAt: time(user?.timestamp, created), replies, selectedReplyId: replies[0]!.id };
  }) : [];
  const base = existing ?? { id: uid(), pinned: false, draft: '', draftAttachments: [], settings: { ...defaults, model } };
  return { ...base, title: cloudTitle(plain.title), createdAt: created, updatedAt: updated, turns: loaded ? turns : existing?.turns ?? [],
    projectId, cloud: { ...link, turns: loaded ? turns.length : existing?.cloud?.turns ?? 0, loaded: loaded || !!existing?.cloud?.loaded, dirty: false, syncedAt: now } } as Thread;
}

const selected = (turn: Turn): Reply | undefined => turn.replies.find(r => r.id === turn.selectedReplyId);
/** Changes Workbench made to a cloud chat, applied to its latest plaintext. `remote` must be the version the
 * conversation was last synced from (same etag); the caller checks that. Unchanged messages are kept byte for byte,
 * with every field Workbench does not know; a message whose text changed keeps its other fields but loses its
 * `timeline`, which would still show the old text. Only completed replies are written. */
export function cloudPatch(remote: Json, thread: Thread, clock: { v: number; w: string; version: number }, now: number): Json {
  const messages = Array.isArray(remote.messages) ? [...remote.messages] as unknown[] : [];
  const groups = groupMessages(messages), known = Math.min(thread.cloud?.turns ?? 0, groups.length, thread.turns.length);
  const out: unknown[] = [];
  let next = 0; // index into `messages`, so messages outside the known turns (none, normally) stay in order
  const edited = (m: Json, fields: Json): Json => { const copy: Json = { ...m, ...fields }; delete copy.timeline; return copy; };
  for (let j = 0; j < known; j++) {
    const g = groups[j]!, turn = thread.turns[j]!, reply = selected(turn);
    const first = Math.min(g.user ?? Infinity, g.assistant ?? Infinity);
    while (next < first) out.push(messages[next++]);
    if (g.user !== null) { const m = obj(messages[g.user])!; out.push(m.content === turn.prompt ? m : edited(m, { content: turn.prompt })); next = g.user + 1; }
    if (g.assistant !== null) {
      const m = obj(messages[g.assistant])!;
      const same = reply && reply.status === 'complete' && m.content === reply.content && (typeof m.thoughts === 'string' ? m.thoughts : '') === reply.reasoning;
      out.push(same || !reply || reply.status !== 'complete' ? m : edited(m, { content: reply.content, ...(reply.reasoning ? { thoughts: reply.reasoning } : {}) }));
      next = g.assistant + 1;
    } else if (reply?.status === 'complete') out.push(newAnswer(reply, now));
  }
  // Remote messages past the known turns (a chat longer than Workbench's turn limit) are kept, never dropped.
  while (next < messages.length) out.push(messages[next++]);
  for (const turn of thread.turns.slice(known)) {
    const reply = selected(turn);
    out.push({ role: 'user', content: turn.prompt, timestamp: new Date(turn.createdAt).toISOString(),
      ...(turn.attachments.length ? { attachments: turn.attachments.map(a => ({ id: uid(), type: 'document', fileName: a.name, textContent: a.content })) } : {}) });
    if (reply?.status === 'complete') out.push(newAnswer(reply, now));
  }
  return { ...remote, title: thread.title, ...(thread.title !== remote.title ? { titleState: 'manual' } : {}), messages: out,
    updatedAt: new Date(now).toISOString(), clock: clock.v, writer: clock.w, clockVersion: clock.version };
}
const newAnswer = (reply: Reply, now: number): Json => ({ role: 'assistant', content: reply.content, ...(reply.reasoning ? { thoughts: reply.reasoning } : {}),
  modelDisplayName: reply.model, timestamp: new Date(now).toISOString() });

/** A new cloud chat for a conversation that has none yet. */
export function newCloudChat(thread: Thread, cloudProject: string | null, clock: { v: number; w: string; version: number }, now: number): Json {
  return cloudPatch({ title: thread.title, messages: [], createdAt: new Date(thread.createdAt).toISOString(), model: thread.settings.model, projectId: cloudProject },
    { ...thread, cloud: { id: '', etag: '0', project: cloudProject, turns: 0, loaded: true, dirty: true, syncedAt: now } }, clock, now);
}

/** Maps a cloud project onto a Workbench project. */
export function projectFromCloud(plain: Json, id: string, etag: string, now: number, existing?: Project): Project & { cloud: CloudProjectLink } {
  return { id: existing?.id ?? uid(), name: plainName(plain.name, 80) || 'Tinfoil project', createdAt: existing?.createdAt ?? now,
    cloud: { id, etag, description: str(plain.description, 4000), instructions: str(plain.systemInstructions, LIMITS.instructions), color: str(plain.color, 40),
      documents: (existing as (Project & { cloud?: CloudProjectLink }) | undefined)?.cloud?.documents ?? [], syncedAt: now } };
}

/** The context Tinfoil adds to a project chat's system prompt: the project's name, description, instructions and
 * the text of its documents. Sent only for conversations in a cloud project. Escaped as Tinfoil Chat escapes it, so a
 * document cannot close `<project_context>` and be read as instructions. */
export function projectContext(project: Project & { cloud?: CloudProjectLink }): string {
  const c = project.cloud; if (!c) return '';
  const x = escapePromptContent;
  let text = `## Project: ${x(project.name)}\n`;
  if (c.description) text += `\n${x(c.description)}\n`;
  if (c.instructions) text += `\n### Instructions\n${x(c.instructions)}\n`;
  const docs = c.documents.filter(d => d.content);
  if (docs.length) { text += `\n### Documents\n`; for (const d of docs) text += `--- ${x(d.name)} ---\n${x(d.content)}\n\n`; }
  return text;
}
