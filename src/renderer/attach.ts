import type { Attachment, PickedFile } from '../core/types.js';
import { IMAGE_LIMITS, PDF_SOURCE_BYTES, attachmentKind, sniffText } from '../core/attachments.js';
import { LIMITS } from '../core/validation.js';
import { pdfText } from './pdf-viewer.js';

/** Files dropped, pasted or picked for a message, made into attachments here in the page (core/attachments.ts).
 * Text and code are read as UTF-8; a PDF's text is read with the bundled PDF.js; a picture is redrawn to fit
 * 1536 × 1536, as Tinfoil Chat does, and stored by the service (`image.add`) with a small thumbnail for the page.
 * Folders never come here: only the Windows host can name one (preload `folderFor`). */
export interface Prepared { attachment: Attachment; image?: { id: string; mime: string; data: string } }
export class AttachError extends Error {}

const WORD = 'Word, PowerPoint and Excel files cannot be read here. Save it as a PDF or as text, then attach that.';
export async function prepareFile(file: File): Promise<Prepared> {
  const name = file.name || 'Pasted file', kind = attachmentKind(name, file.type);
  if (kind === 'office') throw new AttachError(`${name}: ${WORD}`);
  if (kind === 'image') return preparePicture(file, name);
  if (kind === 'pdf') {
    if (file.size > PDF_SOURCE_BYTES) throw new AttachError(`${name} is larger than 40 MB.`);
    let content: string;
    try { content = (await pdfText(new Uint8Array(await file.arrayBuffer()), LIMITS.attachment)).trim(); }
    catch (error) { throw new AttachError(`${name}: ${error instanceof Error ? error.message : 'the PDF could not be read.'}`); }
    if (!content.replace(/\[Page \d+\]/g, '').trim()) throw new AttachError(`${name} has no text to read; it may be scanned. Attach its pages as pictures instead.`);
    if (content.length > LIMITS.attachment) throw new AttachError(`${name} has more than 200,000 characters of text.`);
    return { attachment: { name, content } };
  }
  if (file.size > LIMITS.attachment * 4) throw new AttachError(`${name} is too large to attach as text.`);
  const content = sniffText(new Uint8Array(await file.arrayBuffer()));
  if (content === null) throw new AttachError(kind === 'text' ? `${name} is not UTF-8 text.` : `${name} is not a text file, picture or PDF, so it cannot be attached.`);
  return { attachment: { name, content } };
}

async function preparePicture(file: File, name: string): Promise<Prepared> {
  if (file.size > IMAGE_LIMITS.sourceBytes) throw new AttachError(`${name} is larger than 40 MB.`);
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new AttachError(`${name} could not be opened as a picture.`); }
  try {
    const scale = Math.min(1, IMAGE_LIMITS.edge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = drawn(bitmap, width, height), alpha = transparent(canvas);
    // Transparency needs PNG; anything else is smaller as JPEG at the quality Tinfoil Chat uses.
    const mime = alpha ? 'image/png' : 'image/jpeg';
    const data = await encode(canvas, mime, .85);
    if (data.length > IMAGE_LIMITS.dataChars) throw new AttachError(`${name} is too detailed to store, even at 1536 pixels.`);
    const small = Math.min(1, IMAGE_LIMITS.thumbEdge / Math.max(width, height)), w = Math.max(1, Math.round(width * small)), h = Math.max(1, Math.round(height * small));
    // A transparent picture keeps its transparency in the thumbnail when that stays small; otherwise JPEG on white.
    const clear = alpha ? `data:image/png;base64,${await encode(drawn(bitmap, w, h), 'image/png', 1)}` : '';
    const thumb = clear && clear.length <= IMAGE_LIMITS.thumbChars ? clear : `data:image/jpeg;base64,${await encode(drawn(bitmap, w, h, '#ffffff'), 'image/jpeg', .72)}`;
    const id = `img-${crypto.randomUUID().replace(/-/g, '')}`;
    return { attachment: { name, content: '', kind: 'image', image: { id, mime, width, height, thumb } }, image: { id, mime, data } };
  } finally { bitmap.close(); }
}
function drawn(bitmap: ImageBitmap, width: number, height: number, background = ''): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d')!;
  if (background) { context.fillStyle = background; context.fillRect(0, 0, width, height); }
  context.imageSmoothingQuality = 'high'; context.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}
function transparent(canvas: HTMLCanvasElement): boolean {
  const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! < 255) return true;
  return false;
}
function encode(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<string> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (!blob) { reject(new AttachError('The picture could not be encoded.')); return; }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
    reader.onerror = () => reject(new AttachError('The picture could not be encoded.'));
    reader.readAsDataURL(blob);
  }, mime, quality));
}
/** A picture or PDF the host's picker read, as a file object for prepareFile. */
export function pickedFile(file: PickedFile): File {
  const binary = atob(file.data), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], file.name, { type: file.mime });
}
