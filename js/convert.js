// Turns one photo (HEIC, HEIF or any browser-readable image) into JPG, PNG or WebP.
import { heicExif, cleanExif, jpegWithExif } from './exif.js';

// Each "lane" gets its own copy of the decoder (its own worker), so photos decode side by side.
const lanes = new Map();
const loadHeic = lane => {
  if (!lanes.has(lane)) lanes.set(lane, import(lane ? `../vendor/heic-to.js?lane=${lane}` : '../vendor/heic-to.js'));
  return lanes.get(lane);
};

export const FORMATS = {
  jpg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPG' },
  png: { mime: 'image/png', ext: 'png', label: 'PNG' },
  webp: { mime: 'image/webp', ext: 'webp', label: 'WebP' },
};

const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'avif'];
/** True when the file is HEIC/HEIF (checked by content, not by name). */
export async function isHeif(file) {
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  if (head.length < 12 || String.fromCharCode(...head.subarray(4, 8)) !== 'ftyp') return false;
  const brand = String.fromCharCode(...head.subarray(8, 12));
  if (brand === 'avif' || brand === 'avis') return false; // browsers open AVIF on their own
  return HEIF_BRANDS.includes(brand);
}

export const isPhotoName = name => /\.(heic|heif|hif|jpe?g|png|webp|avif|gif|bmp)$/i.test(name);

async function decode(file, lane) {
  if (await isHeif(file)) {
    const { heicTo } = await loadHeic(lane);
    const bitmap = await heicTo({ blob: file, type: 'bitmap' });
    return { bitmap, heif: true };
  }
  try {
    return { bitmap: await createImageBitmap(file, { imageOrientation: 'from-image' }), heif: false };
  } catch {
    throw new Error('This file isn’t a photo this app can open.');
  }
}

function canvasBlob(canvas, mime, quality) {
  return new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('Couldn’t save the image.')), mime, quality));
}

/**
 * opts: { format: 'jpg'|'png'|'webp', quality: 0..1, maxSide: 0 (keep) or pixels,
 *         keepDetails: bool, removeLocation: bool, thumb: pixels, lane: decoder lane }
 * → { blob, width, height, thumb: Blob, keptDetails: bool }
 */
export async function convertPhoto(file, opts) {
  const fmt = FORMATS[opts.format] || FORMATS.jpg;
  const { bitmap, heif } = await decode(file, opts.lane || 0);
  try {
    let w = bitmap.width, hgt = bitmap.height;
    const k = opts.maxSide && Math.max(w, hgt) > opts.maxSide ? opts.maxSide / Math.max(w, hgt) : 1;
    w = Math.max(1, Math.round(w * k)); hgt = Math.max(1, Math.round(hgt * k));

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = hgt;
    const ctx = canvas.getContext('2d');
    if (fmt.ext === 'jpg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, hgt); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, hgt);
    let blob = await canvasBlob(canvas, fmt.mime, opts.quality);
    if (fmt.ext === 'webp' && blob.type !== 'image/webp') throw new Error('WebP isn’t supported here. Pick JPG or PNG.');

    let keptDetails = false;
    if (heif && fmt.ext === 'jpg' && opts.keepDetails) {
      const tiff = heicExif(await file.arrayBuffer());
      if (tiff) {
        blob = await jpegWithExif(blob, cleanExif(tiff, { width: w, height: hgt, removeLocation: opts.removeLocation }));
        keptDetails = true;
      }
    }

    const ts = opts.thumb || 240;
    const tk = Math.min(1, ts / Math.max(w, hgt));
    const tc = document.createElement('canvas');
    tc.width = Math.max(1, Math.round(w * tk)); tc.height = Math.max(1, Math.round(hgt * tk));
    const tctx = tc.getContext('2d');
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(canvas, 0, 0, tc.width, tc.height);
    const thumb = await canvasBlob(tc, 'image/jpeg', 0.8);
    canvas.width = canvas.height = 0; tc.width = tc.height = 0;
    return { blob, width: w, height: hgt, thumb, keptDetails };
  } finally {
    bitmap.close && bitmap.close();
  }
}
