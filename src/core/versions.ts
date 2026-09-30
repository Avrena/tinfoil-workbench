import type { Thread, Turn } from './types.js';
import { InputError, LIMITS } from './validation.js';

/* Versions inside a conversation. A conversation shows one path, `thread.turns`. An edited prompt, a Retry, or an edited
 * answer or thinking text makes a new version of the turn where it happens: that turn and the turns after it are set
 * aside, whole, in the new turn's `versions`, and the version arrows bring them back. Only the turn on the path holds
 * the versions of its point; a turn set aside never does, though the turns after it keep the versions of theirs. */

export const versionNumber = (turn: Turn): number => turn.version ?? 1;

/** Every version of the point where `turn` stands, in the order they were made. */
export function versionsOf(turn: Turn): Turn[] {
  return [turn, ...(turn.versions ?? []).map(v => v.turns[0]!)].sort((a, b) => versionNumber(a) - versionNumber(b));
}

/** What a version says: its role, message and files. Versions that say the same differ only in their replies. */
const messageKey = (turn: Turn): string => JSON.stringify([turn.role ?? 'user', turn.prompt, turn.attachments]);

export interface VersionPosition { index: number; count: number }
/** Where the turn on the path stands among the versions of its point: among the different messages (edited prompts),
 * and among the versions of its own message (Retry, edited answers and thinking). Messages are in the order of their
 * first version; the versions of one message in the order they were made. */
export function versionPosition(turn: Turn): { message: VersionPosition; reply: VersionPosition } {
  const all = versionsOf(turn), key = messageKey(turn), keys = [...new Set(all.map(messageKey))], own = all.filter(t => messageKey(t) === key);
  return { message: { index: keys.indexOf(key), count: keys.length }, reply: { index: own.indexOf(turn), count: own.length } };
}

/** The version one step from the turn on the path, or null at either end. A step between messages lands on the most
 * recent version of the other message. */
export function versionStep(turn: Turn, kind: 'message' | 'reply', step: -1 | 1): number | null {
  const all = versionsOf(turn), key = messageKey(turn);
  if (kind === 'reply') { const own = all.filter(t => messageKey(t) === key), next = own[own.indexOf(turn) + step]; return next ? versionNumber(next) : null; }
  const keys = [...new Set(all.map(messageKey))], target = keys[keys.indexOf(key) + step];
  return target === undefined ? null : versionNumber(all.filter(t => messageKey(t) === target).at(-1)!);
}

/** Every turn a conversation stores: its path and, recursively, the versions set aside. */
export function* everyTurn(turns: Turn[]): Generator<Turn> {
  for (const turn of turns) { yield turn; for (const version of turn.versions ?? []) yield* everyTurn(version.turns); }
}
export function storedTurns(thread: Thread): number { let count = 0; for (const _ of everyTurn(thread.turns)) count++; return count; }

/** A cloud chat's messages from `index` on no longer match the path; the next write replaces them (core/cloud.ts). */
function pathChanged(thread: Thread, index: number): void {
  if (!thread.cloud) return;
  thread.cloud.turns = Math.min(thread.cloud.turns, index); thread.cloud.rewritten = true;
}

/** Puts `head` at `index` as a new version; the turn there and the turns after it become the version before it. */
export function addVersion(thread: Thread, index: number, head: Turn): void {
  const current = thread.turns[index];
  if (!current) throw new InputError('Turn not found.');
  const others = current.versions ?? [];
  if (others.length + 1 >= LIMITS.versions) throw new InputError(`This message already has ${LIMITS.versions} versions, the most that are kept. Branch to a new conversation instead.`);
  if (storedTurns(thread) >= LIMITS.storedTurns) throw new InputError('This conversation keeps as many versions as it can. Branch to a new conversation instead.');
  const { versions: _, ...previous } = current;
  head.version = Math.max(...versionsOf(current).map(versionNumber)) + 1;
  head.versions = [...others, { turns: [previous, ...thread.turns.slice(index + 1)] }];
  thread.turns = [...thread.turns.slice(0, index), head];
  pathChanged(thread, index);
}

/** Shows another version of the point where `turnId` stands; the version shown until now is set aside with the turns
 * after it. Nothing is sent. */
export function showVersion(thread: Thread, turnId: string, version: number): void {
  const index = thread.turns.findIndex(t => t.id === turnId), current = thread.turns[index];
  if (!current) throw new InputError('Turn not found.');
  const others = current.versions ?? [], chosen = others.findIndex(v => versionNumber(v.turns[0]!) === version);
  if (chosen < 0) throw new InputError('That version no longer exists.');
  const { versions: _, ...previous } = current, [head, ...rest] = others[chosen]!.turns;
  head!.versions = [...others.slice(0, chosen), ...others.slice(chosen + 1), { turns: [previous, ...thread.turns.slice(index + 1)] }];
  thread.turns = [...thread.turns.slice(0, index), head!, ...rest];
  pathChanged(thread, index);
}
