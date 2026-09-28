import type { Artifact, Reply } from './types.js';
export interface InlineVersion { artifact: Artifact; toolId: string }
export interface InlineGroup { rootId: string; offset: number; versions: InlineVersion[] }
export type ReplyPart = { kind: 'text'; key: string; text: string; start: number } | { kind: 'artifact'; key: string; group: InlineGroup };
/** Offsets are renderer metadata, never model-supplied HTML markers. Legacy artifacts
 * without a recorded offset follow the answer. Revisions share one stable card. */
export function inlineGroups(reply: Reply): InlineGroup[] {
  const groups = new Map<string, InlineGroup>();
  for (const tool of reply.tools ?? []) for (const artifact of tool.artifacts) {
    const rootId = artifact.rootId ?? artifact.id;
    let offset = Number.isInteger(tool.contentOffset) ? Math.max(0, Math.min(reply.content.length, tool.contentOffset!)) : reply.content.length;
    // Never split a UTF-16 surrogate pair when reading imported metadata.
    if (offset > 0 && /[\uD800-\uDBFF]/.test(reply.content[offset - 1]!) && /[\uDC00-\uDFFF]/.test(reply.content[offset] ?? '')) offset--;
    let group = groups.get(rootId);
    if (!group) { group = {rootId, offset, versions: []}; groups.set(rootId, group); }
    if (!group.versions.some(v => v.artifact.id === artifact.id)) group.versions.push({artifact, toolId: tool.id});
  }
  return [...groups.values()].sort((a, b) => a.offset - b.offset);
}
export function replyParts(reply: Reply): ReplyPart[] {
  const parts: ReplyPart[] = []; let cursor = 0, previous = 'start';
  for (const group of inlineGroups(reply)) {
    if (group.offset > cursor) parts.push({kind: 'text', key: 'text-' + previous, text: reply.content.slice(cursor, group.offset), start: cursor});
    parts.push({kind: 'artifact', key: 'artifact-' + group.rootId, group}); cursor = group.offset; previous = group.rootId;
  }
  // Keep the final text slot present even before its first token arrives.
  parts.push({kind: 'text', key: 'text-' + previous, text: reply.content.slice(cursor), start: cursor});
  return parts;
}
