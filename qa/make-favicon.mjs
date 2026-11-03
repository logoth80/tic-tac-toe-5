/* Put the tab icon in the page, or check that it is still the icon.

   A page opened on its own has nothing next to it to link, so a tab icon has to be carried inside the
   file. The bytes are not typed in by hand and not re-drawn: they are the frames of match5.ico read
   out of that file and put in a PNG container (tests/ico-png.mjs), so the tab and the shell are
   looking at the same pixels rather than at two drawings of the same idea.

     node qa/make-favicon.mjs                 # report only: what each size would cost, and whether the
                                              # page already holds exactly those bytes
     node qa/make-favicon.mjs --write         # write them into match5.html (between the markers)
     node qa/make-favicon.mjs --sizes 16,32,48   # a different set (PWA tiles, taskbar)

   The default set is 16 and 32: what a tab asks for at 1x and at 2x. Nothing in the page links a
   file path, so a lone .html still shows the right mark. tests/file-check.mjs re-derives these bytes
   and fails if the page no longer holds them, which is the same drift that once went unnoticed in
   qa/probe.html. */
import fs from 'node:fs';
import path from 'node:path';
import { faviconBytes, faviconBlock, FAVICON_START, FAVICON_END } from '../tests/ico-png.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PAGE = path.join(ROOT, 'match5.html');
const ICO = path.join(ROOT, 'match5.ico');

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i < 0 ? dflt : argv[i + 1];
};
const write = argv.includes('--write');
const sizes = (flag('sizes', '16,32')).split(',').map((s) => parseInt(s, 10)).filter((n) => n > 0);

const page = fs.readFileSync(PAGE, 'utf8');
const eol = page.includes('\r\n') ? '\r\n' : '\n';
const data = faviconBytes(ICO, sizes);
const block = faviconBlock(ICO, sizes, eol);

console.log('icon source: ' + path.relative(ROOT, ICO) + '  ' + data.icoBytes + ' bytes, ' +
  data.frames + ' frames');
console.log('  (the whole file as data would cost ' + Math.ceil(data.icoBytes * 4 / 3) +
  ' bytes - which is why only the tab sizes are carried)');
let total = 0;
for (const it of data.items) {
  console.log('  ' + String(it.size).padStart(3) + ' px -> PNG ' + String(it.pngBytes).padStart(5) +
    ' bytes -> base64 ' + String(it.base64.length).padStart(5) + (it.maskUsed ? '  (AND mask used for ' + it.maskUsed + ' px)' : ''));
  total += it.base64.length;
}
console.log('  carried in the page: ' + total + ' bytes of base64 for ' + sizes.join('/') + ' px');

const at = page.indexOf(FAVICON_START), end = page.indexOf(FAVICON_END);
const current = at < 0 ? null : page.slice(at, end + FAVICON_END.length);
if (current === null) {
  console.log('  the page holds no icon block yet');
} else {
  console.log('  the page holds ' + current.length + ' bytes of icon block: ' +
    (current === block ? 'identical to what ' + path.basename(ICO) + ' produces' : 'IT DRIFTED - re-run this with --write'));
}

if (!write) {
  if (current !== null && current !== block) process.exitCode = 1;
  process.exit(process.exitCode || 0);
}

let out;
if (current !== null) {
  out = page.slice(0, at) + block + page.slice(end + FAVICON_END.length);
} else {
  const titleLine = page.split(eol).findIndex((l) => /<title[ >]/i.test(l));
  if (titleLine < 0) throw new Error('no <title> line to put the icon under');
  const lines = page.split(eol);
  lines.splice(titleLine + 1, 0, block);
  out = lines.join(eol);
}
fs.writeFileSync(PAGE, out, 'utf8');
console.log('  wrote ' + path.relative(ROOT, PAGE) + ': ' + page.length + ' -> ' + out.length +
  ' bytes (+' + (out.length - page.length) + ')');
