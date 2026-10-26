/* Icon gate.  match5.ico is a container: a directory of frames, each one a full image. A
   re-export is the thing that breaks it - one truncated frame, or the small sizes missing, and
   the icon still opens in every viewer that picks a different frame, so nobody notices until a
   16px tab does. So this checks the container and every frame in it, without libraries:

     - the header, and that no frame runs past the end of the file or over another;
     - that the sizes a browser and the Windows shell actually ask for are present (16, 32),
       and that a large one exists for touch/taskbar (256);
     - BMP frames: a BITMAPINFOHEADER of 40 bytes, the height stored doubled (colour + AND
       mask), and a payload exactly the size a complete image plus its masks needs;
     - PNG frames: signature, an IHDR whose big-endian dimensions match the directory entry,
       and a payload ending on an IEND chunk - if these hold, a consumer that refuses the
       frame is refusing the container, not the image.

     node tests/icon-check.mjs [path-to-ico]      default: match5.ico in the project root */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'match5.ico');
const buf = fs.readFileSync(FILE);
const le16 = (o) => buf.readUInt16LE(o);
const le32 = (o) => buf.readUInt32LE(o);
const be32 = (o) => buf.readUInt32BE(o);
let checks = 0, fails = 0;
const ok = (cond, label) => {
  checks++;
  if (!cond) { fails++; console.log('  FAIL ' + label); }
};

console.log('icon: ' + path.relative(ROOT, FILE) + '  ' + buf.length + ' bytes');
ok(buf.length >= 6, 'file is long enough to hold a header');
ok(le16(0) === 0, 'reserved field is 0');
ok(le16(2) === 1, 'type is 1 (icon, not cursor)');
const count = le16(4);
ok(count >= 1, 'the directory names at least one frame: ' + count);
ok(buf.length >= 6 + count * 16, 'the directory itself fits in the file');

const frames = [];
for (let i = 0; i < count; i++) {
  const e = 6 + i * 16;
  const w = buf[e] === 0 ? 256 : buf[e];
  const h = buf[e + 1] === 0 ? 256 : buf[e + 1];
  const planes = le16(e + 4), bpp = le16(e + 6), bytes = le32(e + 8), off = le32(e + 12);
  frames.push({ i, w, h, planes, bpp, bytes, off });
}

/* every frame lies inside the file and no two frames share bytes */
for (const f of frames) ok(f.off >= 6 + count * 16 && f.off + f.bytes <= buf.length,
  'frame ' + f.i + ' (' + f.w + 'x' + f.h + ') lies inside the file: ' + f.off + ' +' + f.bytes);
const byOff = [...frames].sort((a, b) => a.off - b.off);
for (let i = 1; i < byOff.length; i++) ok(byOff[i].off >= byOff[i - 1].off + byOff[i - 1].bytes,
  'frame ' + byOff[i].i + ' does not overlap the one before it');

const sizes = new Set(frames.map((f) => f.w));
const list = [...sizes].sort((a, b) => a - b).join(', ');
console.log('frames: ' + frames.length + '  sizes: ' + list);
for (const need of [16, 32, 256]) ok(sizes.has(need), 'a ' + need + 'px frame is present');
ok(frames.every((f) => f.bpp === 32), 'every frame is 32-bit (so the icon has real transparency, not a colour key)');

for (const f of frames) {
  const at = f.off;
  const isPng = buf[at] === 0x89 && buf[at + 1] === 0x50 && buf[at + 2] === 0x4e && buf[at + 3] === 0x47;
  if (isPng) {
    ok([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, k) => buf[at + k] === v),
      'frame ' + f.i + ' PNG signature');
    ok(buf.slice(at + 12, at + 16).toString('latin1') === 'IHDR' && be32(at + 8) === 13,
      'frame ' + f.i + ' starts with a 13-byte IHDR chunk');
    ok(be32(at + 16) === f.w && be32(at + 20) === f.h,
      'frame ' + f.i + ' IHDR ' + be32(at + 16) + 'x' + be32(at + 20) + ' matches the directory entry ' + f.w + 'x' + f.h);
    ok(buf[at + 24] === 8 && buf[at + 25] === 6, 'frame ' + f.i + ' is 8-bit RGBA');
    ok(buf.slice(at + f.bytes - 8, at + f.bytes - 4).toString('latin1') === 'IEND',
      'frame ' + f.i + ' payload ends on an IEND chunk');
    continue;
  }
  /* a BMP frame. BITMAPINFOHEADER: size(4) width(4) height(4, doubled because the AND mask
     follows the colour bitmap) planes(2) bitcount(2) compression(4) imageSize(4) xppm(4)
     yppm(4) colorsUsed(4) colorsImportant(4) = 40 bytes. */
  ok(le32(at) === 40, 'frame ' + f.i + ' is a 40-byte BITMAPINFOHEADER');
  ok(le32(at + 4) === f.w, 'frame ' + f.i + ' bitmap width ' + le32(at + 4) + ' matches the entry ' + f.w);
  ok(le32(at + 8) === f.h * 2, 'frame ' + f.i + ' declares its height doubled (' + le32(at + 8) + ')');
  ok(le16(at + 12) === 1 && le16(at + 14) === f.bpp,
    'frame ' + f.i + ' planes and bit count agree with the directory entry (' + le16(at + 12) + ', ' + le16(at + 14) + ')');
  ok(le32(at + 16) === 0, 'frame ' + f.i + ' is uncompressed');
  const rowBytes = Math.ceil((f.w * f.bpp) / 32) * 4;
  const maskBytes = Math.ceil(f.w / 32) * 4;
  const need = 40 + f.h * rowBytes + f.h * maskBytes;
  ok(f.bytes === need, 'frame ' + f.i + ' holds a complete image and mask: ' + f.bytes + ' bytes, needs ' + need);
}

if (byOff.length && buf.length - (byOff[byOff.length - 1].off + byOff[byOff.length - 1].bytes) > 0) {
  console.log('  note: trailing bytes after the last frame (legal, usually an editor padding)');
}

console.log(fails === 0 ? '\nALL PASS — ' + checks + ' checks' : '\nFAILED ' + fails + ' of ' + checks + ' checks');
process.exit(fails === 0 ? 0 : 1);
