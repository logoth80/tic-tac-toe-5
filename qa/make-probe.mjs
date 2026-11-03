/* qa/probe.html is not a second game. It is the shipped file with one extra script in front of
   </body>, so that headless Chrome can drive the real page and read its state out of the panel.
   It used to be kept up to date by hand, and it drifted: a whole round of changes to how marks are
   drawn went untested because the gate was measuring a page that still drew the old marks. So the
   copy is built here, from the file it is supposed to be a copy of, and tests/file-check.mjs fails
   when the two are not the same.

     node qa/make-probe.mjs             rebuild qa/probe.html from match5.html + qa/probe.js
     node qa/make-probe.mjs --extract   pull the probe script out of an existing hand-made copy,
                                        writing it back over qa/probe.js (only for re-starting from
                                        a copy someone edited by hand)

   One thing to know about the copy: a path written in the game resolves against the *directory of
   the page that runs it*, so qa/probe.html would look for sounds/ inside qa/. Anything that reads
   files by path - the sound gate, the remembered-settings gate - is run against match5.html, not
   against this copy. */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const GAME = path.join(ROOT, 'match5.html');
const OUT = path.join(ROOT, 'qa', 'probe.html');
const SCRIPT = path.join(ROOT, 'qa', 'probe.js');
const MARK = '/* QA probe (not shipped)';
const CLOSE = '</script></body>';

if (process.argv.includes('--extract')) {
  const probe = fs.readFileSync(OUT, 'utf8');
  const from = probe.search(/\r?\n<script>\r?\n\/\* QA probe \(not shipped\)/);
  const to = probe.indexOf(CLOSE);
  if (from < 0 || to < 0 || to < from) {
    console.log('cannot find the probe script in qa/probe.html (looking for "<script>\\n' + MARK + '" and "' + CLOSE + '")');
    process.exitCode = 1;
  } else {
    const inner = probe.slice(from + 1, to + '</script>'.length)
      .replace(/^<script>\r?\n/, '').replace(/\r?\n<\/script>$/, '') + '\n';
    fs.writeFileSync(SCRIPT, inner);
    console.log('took ' + inner.length + ' bytes of probe script out of qa/probe.html and wrote qa/probe.js');
    console.log('  it starts: ' + inner.split('\n')[0].slice(0, 70));
    console.log('  it ends:   ' + inner.split('\n').filter(Boolean).pop());
  }
} else {
  const game = fs.readFileSync(GAME, 'utf8');
  if (!fs.existsSync(SCRIPT)) {
    console.log('qa/probe.js is missing - run: node qa/make-probe.mjs --extract');
    process.exitCode = 1;
  } else {
    const src = fs.readFileSync(SCRIPT, 'utf8').replace(/\s+$/, '');
    const seam = /<\/script>(\r?\n)(<\/body>)/;
    if (!seam.test(game)) { console.log('match5.html does not end the way this expects ("</script>" then "</body>")'); process.exitCode = 1; }
    const out = game.replace(seam, (_, nl) =>
      '</script>' + nl + '<script>' + nl + src.replace(/\r?\n/g, nl) + nl + '</script></body>');
    const was = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    fs.writeFileSync(OUT, out);
    const changed = (a, b) => { const x = a.split('\n'), y = b.split('\n'); let d = 0; for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) d++; return d; };
    console.log('built qa/probe.html from match5.html (' + game.length + ' + ' + src.length + ' = ' + out.length + ' bytes)');
    if (was) console.log('  replaced a copy of ' + was.length + ' bytes; ' + changed(was, out) + ' of its lines differ from the previous one');
  }
}
