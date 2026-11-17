// Photo details (EXIF): read them out of a HEIC file, tidy them up, and put them into a JPEG.
// HEIC files keep EXIF as an item inside the ISO-BMFF "meta" box; JPEG keeps it in an APP1 segment.

const u8 = b => b instanceof Uint8Array ? b : new Uint8Array(b);
const fourcc = (d, o) => String.fromCharCode(d[o], d[o + 1], d[o + 2], d[o + 3]);

function readUint(dv, o, size) {
  if (size === 0) return 0;
  if (size === 1) return dv.getUint8(o);
  if (size === 2) return dv.getUint16(o);
  if (size === 4) return dv.getUint32(o);
  if (size === 8) return dv.getUint32(o) * 2 ** 32 + dv.getUint32(o + 4);
  throw new Error('bad int size');
}

/** Iterates the boxes in d[start, end): yields { type, start (payload), end }. */
function* boxes(d, dv, start, end) {
  let o = start;
  while (o + 8 <= end) {
    let size = dv.getUint32(o);
    const type = fourcc(d, o + 4);
    let head = 8;
    if (size === 1) { size = readUint(dv, o + 8, 8); head = 16; }
    else if (size === 0) size = end - o;
    if (size < head || o + size > end) return;
    yield { type, start: o + head, end: o + size };
    o += size;
  }
}

/** Returns the TIFF block (starts with "II*\0" or "MM\0*") from a HEIC file, or null. */
export function heicExif(buffer) {
  try {
    const d = u8(buffer), dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    let meta = null;
    for (const b of boxes(d, dv, 0, d.length)) if (b.type === 'meta') { meta = b; break; }
    if (!meta) return null;
    const ms = meta.start + 4; // full box: version + flags
    let exifId = null, iloc = null, idat = null;
    for (const b of boxes(d, dv, ms, meta.end)) {
      if (b.type === 'iinf') {
        const v = d[b.start];
        let o = b.start + 4;
        const n = v === 0 ? dv.getUint16(o) : dv.getUint32(o);
        o += v === 0 ? 2 : 4;
        let k = 0;
        for (const e of boxes(d, dv, o, b.end)) {
          if (k++ >= n) break;
          if (e.type !== 'infe') continue;
          const ev = d[e.start];
          if (ev < 2) continue;
          let p = e.start + 4;
          const id = ev === 2 ? dv.getUint16(p) : dv.getUint32(p);
          p += ev === 2 ? 2 : 4;
          p += 2; // protection index
          if (fourcc(d, p) === 'Exif') { exifId = id; }
        }
      } else if (b.type === 'iloc') iloc = b;
      else if (b.type === 'idat') idat = b;
    }
    if (exifId == null || !iloc) return null;

    const v = d[iloc.start];
    let o = iloc.start + 4;
    const offSize = d[o] >> 4, lenSize = d[o] & 15, baseSize = d[o + 1] >> 4, idxSize = v > 0 ? d[o + 1] & 15 : 0;
    o += 2;
    const count = v < 2 ? dv.getUint16(o) : dv.getUint32(o);
    o += v < 2 ? 2 : 4;
    for (let i = 0; i < count; i++) {
      const id = v < 2 ? dv.getUint16(o) : dv.getUint32(o);
      o += v < 2 ? 2 : 4;
      let method = 0;
      if (v > 0) { method = dv.getUint16(o) & 15; o += 2; }
      o += 2; // data reference index
      const base = readUint(dv, o, baseSize); o += baseSize;
      const extents = dv.getUint16(o); o += 2;
      const parts = [];
      for (let e = 0; e < extents; e++) {
        o += idxSize;
        const off = readUint(dv, o, offSize); o += offSize;
        const len = readUint(dv, o, lenSize); o += lenSize;
        parts.push([base + off, len]);
      }
      if (id !== exifId) continue;
      if (method > 1) return null;
      const origin = method === 1 ? (idat ? idat.start : -1) : 0;
      if (origin < 0) return null;
      const chunks = parts.map(([off, len]) => d.subarray(origin + off, origin + off + (len || d.length)));
      const total = chunks.reduce((s, c) => s + c.length, 0);
      const item = new Uint8Array(total);
      let w = 0; for (const c of chunks) { item.set(c, w); w += c.length; }
      return findTiff(item);
    }
    return null;
  } catch { return null; }
}

function findTiff(item) {
  // Normal layout: 4-byte offset to the TIFF header, then the TIFF block. Be lenient and search.
  if (item.length > 8) {
    const skip = new DataView(item.buffer, item.byteOffset).getUint32(0);
    const at = 4 + skip;
    if (at < item.length - 8 && isTiff(item, at)) return item.slice(at);
  }
  for (let i = 0; i < Math.min(item.length - 8, 64); i++) if (isTiff(item, i)) return item.slice(i);
  return null;
}
const isTiff = (d, o) => (d[o] === 0x49 && d[o + 1] === 0x49 && d[o + 2] === 0x2a && d[o + 3] === 0) ||
                         (d[o] === 0x4d && d[o + 1] === 0x4d && d[o + 2] === 0 && d[o + 3] === 0x2a);

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

/**
 * Cleans a TIFF/EXIF block in place (on a copy):
 *  - orientation is set to "normal", because the converted pixels are already upright;
 *  - pixel dimensions are set to the new width/height;
 *  - with removeLocation, every GPS value is wiped and the GPS directory emptied.
 */
export function cleanExif(tiff, { width, height, removeLocation }) {
  const d = tiff.slice();
  const dv = new DataView(d.buffer);
  const le = d[0] === 0x49;
  const g16 = o => dv.getUint16(o, le), g32 = o => dv.getUint32(o, le);
  const s16 = (o, v) => dv.setUint16(o, v, le), s32 = (o, v) => dv.setUint32(o, v, le);
  const inRange = o => o >= 8 && o + 2 <= d.length;

  const entries = ifd => {
    if (!inRange(ifd)) return [];
    const n = g16(ifd), out = [];
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > d.length) break;
      out.push({ at: e, tag: g16(e), type: g16(e + 2), count: g32(e + 4) });
    }
    return out;
  };
  const setNumber = (e, v) => {
    if (e.type === 3) s16(e.at + 8, v);
    else if (e.type === 4) s32(e.at + 8, v);
  };

  const ifd0 = g32(4);
  let exifIfd = 0, gpsIfd = 0;
  for (const e of entries(ifd0)) {
    if (e.tag === 0x0112) setNumber(e, 1);
    else if (e.tag === 0x8769) exifIfd = g32(e.at + 8);
    else if (e.tag === 0x8825) gpsIfd = g32(e.at + 8);
  }
  for (const e of entries(exifIfd)) {
    if (e.tag === 0xa002 && width) setNumber(e, width);
    else if (e.tag === 0xa003 && height) setNumber(e, height);
  }
  if (removeLocation && gpsIfd) {
    for (const e of entries(gpsIfd)) {
      const size = (TYPE_SIZE[e.type] || 1) * e.count;
      if (size > 4) {
        const off = g32(e.at + 8);
        if (off + size <= d.length) d.fill(0, off, off + size);
      }
      d.fill(0, e.at, e.at + 12);
    }
    if (inRange(gpsIfd)) s16(gpsIfd, 0);
  }
  return d;
}

/** Puts an EXIF block into a JPEG (replacing a JFIF header if there is one). Returns a new Blob. */
export async function jpegWithExif(jpegBlob, tiff) {
  const app1Len = 2 + 6 + tiff.length;
  if (app1Len > 0xffff) return jpegBlob; // too large for one segment: leave the photo as it is
  const jpg = new Uint8Array(await jpegBlob.arrayBuffer());
  if (jpg[0] !== 0xff || jpg[1] !== 0xd8) return jpegBlob;
  let rest = 2;
  if (jpg[2] === 0xff && jpg[3] === 0xe0) rest = 4 + ((jpg[4] << 8) | jpg[5]); // drop APP0/JFIF
  const seg = new Uint8Array(4 + 6 + tiff.length);
  seg.set([0xff, 0xe1, app1Len >> 8, app1Len & 255, 0x45, 0x78, 0x69, 0x66, 0, 0]);
  seg.set(tiff, 10);
  return new Blob([jpg.subarray(0, 2), seg, jpg.subarray(rest)], { type: 'image/jpeg' });
}

/** Reads a few fields for display / tests: { orientation, hasGps, gpsEntries, date, make, model }. */
export function readExifSummary(tiff) {
  const d = u8(tiff), dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const le = d[0] === 0x49;
  const g16 = o => dv.getUint16(o, le), g32 = o => dv.getUint32(o, le);
  const str = (o, n) => { let s = ''; for (let i = 0; i < n && d[o + i]; i++) s += String.fromCharCode(d[o + i]); return s; };
  const list = ifd => { const n = ifd >= 8 && ifd + 2 <= d.length ? g16(ifd) : 0; return Array.from({ length: n }, (_, i) => ifd + 2 + i * 12); };
  const ascii = e => { const n = g32(e + 4); return str(n > 4 ? g32(e + 8) : e + 8, n); };
  const out = { orientation: null, hasGps: false, gpsEntries: 0, date: null, make: null, model: null };
  let exif = 0, gps = 0;
  for (const e of list(g32(4))) {
    const t = g16(e);
    if (t === 0x0112) out.orientation = g16(e + 8);
    if (t === 0x010f) out.make = ascii(e);
    if (t === 0x0110) out.model = ascii(e);
    if (t === 0x8769) exif = g32(e + 8);
    if (t === 0x8825) gps = g32(e + 8);
  }
  for (const e of list(exif)) if (g16(e) === 0x9003) out.date = ascii(e);
  if (gps) { out.gpsEntries = list(gps).length; out.hasGps = out.gpsEntries > 0; }
  return out;
}

/** Finds the EXIF block in a JPEG (for tests). */
export function jpegExif(buf) {
  const d = u8(buf);
  let o = 2;
  while (o + 4 < d.length && d[o] === 0xff) {
    const m = d[o + 1], len = (d[o + 2] << 8) | d[o + 3];
    if (m === 0xe1 && d[o + 4] === 0x45 && d[o + 5] === 0x78) return d.slice(o + 10, o + 2 + len);
    if (m === 0xda) break;
    o += 2 + len;
  }
  return null;
}
