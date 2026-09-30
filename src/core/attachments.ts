import type { Attachment, Thread, Turn } from './types.js';
/** What can be attached to a message. Shared by the Windows main process, the Android worker and the page, which each
 * check it again: text and code travel as text, pictures as a stored image (service `images`), and a folder only as
 * its path, for the workspace agent to read (docs/WORKSPACE-AGENT.md). */
export const TEXT_EXTENSIONS = new Set(['.txt','.md','.markdown','.json','.jsonl','.csv','.tsv','.ts','.tsx','.js','.jsx','.mjs','.cjs',
  '.lua','.py','.c','.h','.cpp','.hpp','.cs','.rs','.go','.java','.kt','.swift','.rb','.php','.r','.html','.css','.scss','.xml','.svg',
  '.yaml','.yml','.toml','.ini','.cfg','.conf','.log','.sql','.sh','.ps1','.bat','.cmd','.tex','.rst','.srt','.vtt']);
/** Pictures the page can decode. Each is redrawn before it is stored, as PNG when it has transparency and JPEG otherwise. */
export const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };
export const STORED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg']);
/** Word, PowerPoint and Excel files need a converter Workbench does not have. */
export const OFFICE_EXTENSIONS = new Set(['.doc','.docx','.ppt','.pptx','.xls','.xlsx','.odt','.odp','.ods','.rtf','.pages','.key','.numbers']);
export const IMAGE_LIMITS = Object.freeze({
  /** The longest side a stored picture keeps, as Tinfoil Chat does; the thumbnail's longest side. */
  edge: 1536, thumbEdge: 240,
  /** A picture file as dropped, before it is redrawn; a stored picture and its thumbnail, as base64. */
  sourceBytes: 40 * 1024 * 1024, dataChars: 8_000_000, thumbChars: 96_000,
  /** How long a stored picture that no message or draft uses is kept (service `pruneImages`). */
  unusedMs: 60 * 60 * 1000,
});
/** A stored picture's id, chosen by the page: never a name an object already has, such as __proto__. */
export const IMAGE_ID = /^img-[A-Za-z0-9_-]{8,80}$/;
export const PDF_SOURCE_BYTES = 40 * 1024 * 1024;
export type AttachmentKind = 'text' | 'image' | 'pdf' | 'office' | 'other';
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}
export function attachmentKind(name: string, mime = ''): AttachmentKind {
  const extension = extensionOf(name);
  if (IMAGE_EXTENSIONS[extension] || /^image\/(png|jpeg|gif|webp|bmp)$/.test(mime)) return 'image';
  if (extension === '.pdf' || mime === 'application/pdf') return 'pdf';
  if (TEXT_EXTENSIONS.has(extension) || /^text\//.test(mime)) return 'text';
  if (OFFICE_EXTENSIONS.has(extension)) return 'office';
  return 'other';
}
/** Text of a file whose type is not known: UTF-8 without NUL bytes in its first 8 KB, or null. */
export function sniffText(bytes: Uint8Array): string | null {
  if (bytes.subarray(0, 8192).includes(0)) return null;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
}
/** How folder paths are compared: backslashes, no trailing separator, any case (Windows paths). */
export const folderKey = (path: string): string => path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
/** The folders a conversation already has: in its draft, its messages and their other versions. */
export function attachedFolders(thread: Pick<Thread, 'turns' | 'draftAttachments'>): Set<string> {
  const known = new Set<string>();
  const collect = (files: Attachment[] = []): void => { for (const f of files) if (f.kind === 'folder' && f.path) known.add(folderKey(f.path)); };
  const walk = (turns: Turn[]): void => { for (const turn of turns) { collect(turn.attachments); for (const version of turn.versions ?? []) walk(version.turns); } };
  collect(thread.draftAttachments); walk(thread.turns);
  return known;
}
/** The first folder in a draft or message that the user neither dropped or pasted in this session (`dropped`, by
 * folderKey) nor attached to this conversation before, or null. The Windows main process refuses such a command, so
 * the page cannot give the workspace agent a folder to read. */
export function unknownFolder(files: unknown, thread: Pick<Thread, 'turns' | 'draftAttachments'>, dropped: ReadonlySet<string>): string | null {
  const folders = Array.isArray(files) ? files.filter(a => a && typeof a === 'object' && (a as Attachment).kind === 'folder') as Attachment[] : [];
  if (!folders.length) return null;
  const known = attachedFolders(thread);
  for (const folder of folders) {
    const key = typeof folder.path === 'string' ? folderKey(folder.path) : '';
    if (!key || !(dropped.has(key) || known.has(key))) return typeof folder.path === 'string' ? folder.path : '';
  }
  return null;
}
