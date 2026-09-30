import type { BackgroundPreferences } from '../core/preferences.js';
import { AttachError } from './attach.js';
import { IMAGE_LIMITS } from '../core/attachments.js';

/** The layer behind the conversation (Settings → Chat background). A texture is drawn by CSS in the theme's text
 * colour at the chosen strength; a picture is the stored copy (`background.get`), blurred, turned grey and dimmed
 * toward the theme's background as the settings say. Nothing here is interactive: the layer never takes the pointer. */
let paintedPicture = '';
export function paintBackdrop(main: HTMLElement, layer: HTMLElement, background: BackgroundPreferences, picture: string | null): void {
  const kind = background.kind === 'picture' && !picture ? 'none' : background.kind;
  main.classList.toggle('has-backdrop', kind !== 'none');
  layer.hidden = kind === 'none'; layer.dataset.kind = kind; layer.dataset.texture = background.texture;
  layer.style.setProperty('--texture-strength', String(background.strength / 100));
  const image = layer.querySelector<HTMLElement>('.backdrop-picture')!, blur = background.blur.on ? background.blur.value : 0;
  const url = kind === 'picture' && picture ? picture : '';
  // A picture is set once; its data URL can be megabytes.
  if (url !== paintedPicture) { image.style.backgroundImage = url ? `url("${url}")` : 'none'; paintedPicture = url; }
  image.style.filter = [blur ? `blur(${blur}px)` : '', background.greyscale.on ? `grayscale(${background.greyscale.value}%)` : ''].filter(Boolean).join(' ') || 'none';
  // Blurring pulls the edges in; the picture reaches past them by twice the blur.
  image.style.setProperty('--bleed', `${blur * 2}px`);
  layer.style.setProperty('--dim', String(kind === 'picture' && background.dim.on ? background.dim.value / 100 : 0));
}
/** A picked picture, made fit to stay behind the conversation: at most 2048 pixels on its longer side, as JPEG, or as
 * PNG when it has transparency and that stays within the stored size. */
export async function backgroundPicture(file: File): Promise<{ mime: string; data: string }> {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new AttachError(`${file.name} could not be opened as a picture.`); }
  try {
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height)), canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d')!;
    context.imageSmoothingQuality = 'high'; context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let clear = false;
    for (let i = 3; i < pixels.length && !clear; i += 4) clear = pixels[i]! < 255;
    const png = clear ? canvas.toDataURL('image/png') : '';
    if (png && png.length - png.indexOf(',') - 1 <= IMAGE_LIMITS.dataChars) return { mime: 'image/png', data: png.slice(png.indexOf(',') + 1) };
    const url = canvas.toDataURL('image/jpeg', .86);
    return { mime: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) };
  } finally { bitmap.close(); }
}
