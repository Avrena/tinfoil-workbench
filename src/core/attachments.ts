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
/** What a stored picture can be: Workbench stores PNG and JPEG; a picture fetched from a Tinfoil cloud chat keeps the
 * type Tinfoil Chat stored, which can also be GIF or WebP. */
export const STORED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
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
/** A picture in a Tinfoil cloud chat: the ID Tinfoil's sync enclave gave it, and the stored picture's ID here. */
export const CLOUD_PICTURE_ID = /^[A-Za-z0-9_-]{8,79}$/;
export const cloudImageId = (id: string): string => 'img-c' + id;
/** The type of a picture from its first bytes (PNG, JPEG, GIF or WebP), or null. A picture's stated type is not
 * trusted: Tinfoil Chat can label a redrawn BMP as BMP while storing PNG. */
export function pictureType(bytes: Uint8Array): string | null {
  const at = (offset: number, ...expected: number[]): boolean => expected.every((b, i) => bytes[offset + i] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}
/** A PNG's or JPEG's width and height from its header, or null. Used for thumbnails, whose shape the page keeps. */
export function pictureSize(bytes: Uint8Array): { width: number; height: number } | null {
  const sized = (width: number, height: number) => width >= 1 && width <= 20000 && height >= 1 && height <= 20000 ? { width, height } : null;
  const u16 = (i: number): number => (bytes[i]! << 8) | bytes[i + 1]!;
  const type = pictureType(bytes);
  if (type === 'image/png') return bytes.length >= 24 ? sized(u16(16) * 65536 + u16(18), u16(20) * 65536 + u16(22)) : null;
  if (type !== 'image/jpeg') return null;
  // JPEG segments: FF, a marker, a two-byte length that counts itself. A start-of-frame segment holds the size.
  for (let i = 2; i + 9 < bytes.length;) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1]!;
    if (marker === 0xff) { i++; continue; }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return sized(u16(i + 7), u16(i + 5));
    const length = u16(i + 2);
    if (length < 2) return null;
    i += 2 + length;
  }
  return null;
}
/** Base64 as bytes, without Node's Buffer, since this module also runs in the page. */
export function base64Bytes(text: string): Uint8Array {
  const binary = atob(text), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
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
