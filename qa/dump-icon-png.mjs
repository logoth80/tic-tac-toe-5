/* Write out, as PNG files, the two icons the page carries - so a decoder that is not this code can be
   asked what they are (qa/favicon-pixel-check.ps1). The bytes are the ones in index.html: they come
   from tests/ico-png.mjs, which is what wrote them into the page in the first place.

     node qa/dump-icon-png.mjs [size ...]     default: 16 32   ->  qa/icon-16.png, qa/icon-32.png */
import fs from 'node:fs';
import path from 'node:path';
import { faviconBytes } from '../tests/ico-png.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const sizes = process.argv.slice(2).map((s) => parseInt(s, 10)).filter((n) => n > 0);
const data = faviconBytes(path.join(ROOT, 'match5.ico'), sizes.length ? sizes : [16, 32]);
for (const it of data.items) {
  const png = Buffer.from(it.base64, 'base64');
  const out = path.join(ROOT, 'qa', 'icon-' + it.size + '.png');
  fs.writeFileSync(out, png);
  console.log(it.size + ' px: ' + png.length + ' bytes -> ' + path.relative(ROOT, out));
}
