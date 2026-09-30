import { InputError } from '../dist/core/validation.js';
import { TEXT_EXTENSIONS as SHARED_TEXT, IMAGE_EXTENSIONS, attachmentKind } from '../dist/core/attachments.js';

/** File checks for Android document pickers. They mirror desktop/main.mjs: the same
 * extensions, size limits, UTF-8 decoding and magic-byte checks. */
export const TEXT_EXTENSIONS = SHARED_TEXT;
export const PREVIEW_TYPES = {'.pdf':'application/pdf','.png':'image/png','.svg':'image/svg+xml','.html':'text/html','.md':'text/markdown','.txt':'text/plain','.json':'application/json','.csv':'text/csv'};
export const PREVIEW_LIMIT = 2 * 1024 * 1024;
const PNG = [137, 80, 78, 71, 13, 10, 26, 10];

export function extension(name) {
  const match = /(\.[^./\\]+)$/.exec(String(name ?? ''));
  return match ? match[1].toLowerCase() : '';
}

export function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Strict base64 decoding with a byte limit; the native picker also enforces the limit. */
export function base64ToBytes(value, limit) {
  if (typeof value !== 'string' || value.length > Math.ceil((limit + 1) / 3) * 4 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new InputError('The selected file could not be read.');
  const binary = atob(value);
  if (binary.length > limit) throw new InputError('The selected file exceeds the size limit.');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function utf8(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new InputError('Only UTF-8 text files are supported.'); }
}

/** Files picked with the system document picker are untrusted: re-check every limit here. */
function picked(file, limit) {
  if (!file || typeof file !== 'object' || typeof file.name !== 'string' || !file.name || file.name.length > 255) throw new InputError('The selected file could not be read.');
  return { name: file.name, bytes: base64ToBytes(file.data, limit) };
}

/** A picture or PDF picked for a message, passed to the page to prepare like a dropped file (renderer/attach.ts). */
export function mediaFile(file, limit) {
  const { name, bytes } = picked(file, limit), kind = attachmentKind(name);
  if (kind !== 'image' && kind !== 'pdf') throw new InputError('Only text and code files, pictures and PDFs can be attached.');
  return { name, mime: kind === 'pdf' ? 'application/pdf' : IMAGE_EXTENSIONS[extension(name)], data: bytesToBase64(bytes) };
}

export function textAttachments(files, limits) {
  if (files.length > limits.attachments) throw new InputError('Attach at most eight files or folders.');
  return files.map(file => {
    const { name, bytes } = picked(file, limits.attachment * 4);
    if (!TEXT_EXTENSIONS.has(extension(name))) throw new InputError('Only supported text and source files can be attached.');
    const content = utf8(bytes);
    if (content.includes('\0')) throw new InputError('Binary files cannot be attached.');
    return { name, content };
  });
}

export function previewFile(file) {
  const { name, bytes } = picked(file, PREVIEW_LIMIT);
  const mime = PREVIEW_TYPES[extension(name)];
  if (!mime) throw new InputError('Unsupported preview type.');
  if (mime === 'application/pdf' && String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') throw new InputError('This does not appear to be a PDF.');
  if (mime === 'image/png' && !PNG.every((b, i) => bytes[i] === b)) throw new InputError('This does not appear to be a PNG.');
  return { name, mime, data: bytesToBase64(bytes) };
}

export function importText(file, limit) {
  const { bytes } = picked(file, limit);
  return utf8(bytes);
}
