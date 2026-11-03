/* match5.ico -> PNG bytes for one frame, without libraries.

   Why this exists: a browser tab wants a 16px and a 32px icon, and a single-file page can only carry
   those inside itself. Re-typing the artwork as a new PNG would be a second copy of it, free to drift
   from the .ico that the shell uses. So the embedded bytes are derived from match5.ico: the frames are
   32-bit BGRA bitmaps (measured: alpha carries the real transparency and every AND mask in the file is
   all zero), and what comes out is the same pixels in a different container. `tests/icon-check.mjs`
   proves the container holds those frames and what is in them; the gate in `tests/file-check.mjs`
   re-derives these bytes and fails if the page no longer holds them.

   A frame's payload is a BITMAPINFOHEADER (40 bytes, biHeight doubled for colour + AND mask), then
   the bottom-up pixel rows, then 1-bit-per-pixel mask rows. The 96/128/256 frames in this file are
   PNG-compressed already and are not handled here: this only needs the two sizes a tab asks for. */
import fs from 'node:fs';
import zlib from 'node:zlib';

export function icoFrames(buf) {
  if (buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) {
    throw new Error('not an ICO container (reserved/type)');
  }
  const count = buf.readUInt16LE(4);
  const out = [];
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    const w = buf[e] === 0 ? 256 : buf[e];
    const h = buf[e + 1] === 0 ? 256 : buf[e + 1];
    out.push({
      w, h,
      bpp: buf.readUInt16LE(e + 6),
      bytes: buf.readUInt32LE(e + 8),
      off: buf.readUInt32LE(e + 12),
      png: buf.readUInt32BE(buf.readUInt32LE(e + 12)) === 0x89504e47,
    });
  }
  return out;
}

/* the pixels of one BMP frame, top-down, as RGBA (4 bytes per pixel) */
export function icoFrameRGBA(buf, f) {
  if (f.png) throw new Error(`${f.w}x${f.h} is a PNG-compressed frame; this reads the bitmap ones`);
  if (f.bpp !== 32) throw new Error(`${f.w}x${f.h} is not 32-bit: ${f.bpp}`);
  if (buf.readUInt32LE(f.off) !== 40) throw new Error(`${f.w}x${f.h}: not a 40-byte BITMAPINFOHEADER`);
  if (buf.readInt32LE(f.off + 8) !== 2 * f.h) {
    throw new Error(`${f.w}x${f.h}: biHeight is not twice the height: ${buf.readInt32LE(f.off + 8)}`);
  }
  const stride = f.w * 4;
  const maskRowBytes = ((f.w + 31) >> 5) * 4;
  const pixels = f.off + 40;
  const maskStart = pixels + stride * f.h;
  if (f.off + 40 + stride * f.h + maskRowBytes * f.h > f.off + f.bytes) {
    throw new Error(`${f.w}x${f.h}: the payload is shorter than the image plus its masks`);
  }
  let maskUsed = 0;
  const rgba = Buffer.alloc(f.w * f.h * 4);
  for (let y = 0; y < f.h; y++) {
    const src = pixels + (f.h - 1 - y) * stride;   // bottom-up
    const maskRow = maskStart + (f.h - 1 - y) * maskRowBytes;
    for (let x = 0; x < f.w; x++) {
      const s = src + x * 4, d = (y * f.w + x) * 4;
      rgba[d] = buf[s + 2];                        // R (the bitmap is BGRA)
      rgba[d + 1] = buf[s + 1];
      rgba[d + 2] = buf[s];
      let a = buf[s + 3];
      if ((buf[maskRow + (x >> 3)] >> (7 - (x & 7))) & 1) { a = 0; maskUsed++; }
      rgba[d + 3] = a;
    }
  }
  return { w: f.w, h: f.h, rgba, maskUsed };
}

/* a minimal PNG: one IDAT, no optional chunks, colour type 6 (RGBA, 8 bits) */
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'latin1');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

/* filter per row, picked the way libpng's heuristics do it (smallest absolute sum wins), because a
   flat-colour icon compresses roughly a third better than unfiltered scanlines and 30 lines of code
   is cheaper than 1.5 KB for something a page loads on every open. */
function scanlines(w, h, rgba) {
  const bpp = 4, row = w * bpp;
  const out = Buffer.alloc(h * (row + 1));
  for (let y = 0; y < h; y++) {
    const cur = y * row, prev = y ? (y - 1) * row : -row;
    let best = 0, bestCost = Infinity;
    for (let filter = 0; filter <= 3; filter++) {
      let cost = 0;
      for (let x = 0; x < row; x++) {
        const v = rgba[cur + x];
        const a = x >= bpp ? rgba[cur + x - bpp] : 0;
        const b = y ? rgba[prev + x] : 0;
        const c = (y && x >= bpp) ? rgba[prev + x - bpp] : 0;
        const d = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : ((a + b + c) >> 2);
        let e = v - d; e = e < -128 ? e + 256 : e > 127 ? e - 256 : e;
        cost += e < 0 ? -e : e;
      }
      if (cost < bestCost) { bestCost = cost; best = filter; }
    }
    const dst = y * (row + 1);
    out[dst] = best;
    for (let x = 0; x < row; x++) {
      const v = rgba[cur + x];
      const a = x >= bpp ? rgba[cur + x - bpp] : 0;
      const b = y ? rgba[prev + x] : 0;
      const c = (y && x >= bpp) ? rgba[prev + x - bpp] : 0;
      const d = best === 0 ? 0 : best === 1 ? a : best === 2 ? b : ((a + b + c) >> 2);
      out[dst + 1 + x] = (v - d) & 0xff;
    }
  }
  return out;
}

export function pngFromRGBA(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;   // 8-bit, truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(scanlines(w, h, rgba), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* The bytes a page should carry for a set of sizes, and the markup that carries them.
   One PNG per size, each declared with its own sizes= - which is what lets the browser pick the one
   that matches the tab it is drawing instead of scaling one down. */
export function faviconBytes(icoPath, sizes) {
  const buf = fs.readFileSync(icoPath);
  const frames = icoFrames(buf);
  const items = sizes.map((size) => {
    const frame = frames.find((f) => f.w === size && f.h === size);
    if (!frame) throw new Error(`match5.ico has no ${size}x${size} frame; it has ` +
      frames.map((f) => f.w).sort((a, b) => a - b).join(', '));
    const decoded = icoFrameRGBA(buf, frame);
    const png = pngFromRGBA(decoded.w, decoded.h, decoded.rgba);
    return { size, pngBytes: png.length, base64: png.toString('base64'), maskUsed: decoded.maskUsed };
  });
  return { icoBytes: buf.length, frames: frames.length, items };
}

export function faviconMarkup(data) {
  return data.items.map((it) =>
    `<link rel="icon" type="image/png" sizes="${it.size}x${it.size}" ` +
    `href="data:image/png;base64,${it.base64}">`).join('\n');
}

/* The whole block a page should hold, markers and all: the comment states the byte cost it was
   measured at, and the gate compares this against what the page holds, so the comment cannot drift
   away from the bytes it describes. Shared by qa/make-favicon.mjs (which writes it) and
   tests/file-check.mjs (which fails when the page stops holding it). */
export const FAVICON_START = '<!--__FAVICON_START__-->';
export const FAVICON_END = '<!--__FAVICON_END__-->';

export function faviconBlock(icoPath, sizes, eol = '\n') {
  const data = faviconBytes(icoPath, sizes);
  const total = data.items.reduce((s, it) => s + it.base64.length, 0);
  const comment = [
    '<!-- The tab icon: the ' + sizes.join(' and ') + ' px frames of match5.ico, read out of that file and',
    '     put in a PNG container - the same pixels, a different container, ' + total + ' bytes of it.',
    '     A page opened on its own has nothing next to it to link, so the bytes are carried here;',
    '     qa/make-favicon.mjs writes them and tests/file-check.mjs fails if the page stops holding',
    '     them, so the tab icon and the shell icon cannot drift into different pictures. -->',
  ].join(eol);
  return FAVICON_START + eol + comment + eol +
    faviconMarkup(data).split('\n').join(eol) + eol + FAVICON_END;
}
