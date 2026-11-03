/* How heavy should the pen be that draws an X or an O?
   (needs the QA browser on :9333 - see README, "Browser QA")

   Not a taste question left to taste. One position is played, then drawn again at several pen
   widths on both boards, and what the pixels produced is read five ways:

     asked   --stonpen x the cell pitch: the width the theme asked for, in device pixels;
     pitch   the cell size, measured from the grid lines the board just drew - not from what the
             page thinks the cell is, so a wrong layout could not hide inside the numbers;
     drawn   the width that is really on screen. A pixel of a stroked line is a mixture of the
             line's colour and the surface behind it, so a line has a well-defined width: the
             distance across the pixels that are at least half the line's own colour. That is what
             an eye sees, and comparing it with "asked" is the calibration of this instrument;
     line    how long each drawn stroke is, twice (extent - pen/2) in cells: a thinner pen makes a
             smaller mark by itself, because a round cap reaches half a pen past the end of a line,
             so keeping the mark the same size means drawing a longer line. This number is computed
             from the constants; the two below are what makes keeping to it testable;
     extent  how far the mark reaches along a grid axis, in cells - its outside size as an eye
             measures it. Both marks should have the same one, and it must not move when the pen
             does: "same outside size, thinner line" is exactly that constraint, and this is where
             getting it wrong would show. Pixels are read in a window 0.52 of a cell wide, and a
             mark that reached further would report windowClipped.
     colour  how close the stroke's own pixels come to the colour it was asked for. A line thinner
             than a pixel never reaches it, and that is what makes a thin mark read as weak rather
             than as fine - so this number says where the pen stops being thin and starts being
             faded.

   Two ways of measuring the drawn width are used, each where it has no bias of its own: a distance
   transform over the stroke's pixels (exact for the straight arms of a cross), and the length of a
   run along the horizontal line through the centre (exact for a ring, where the ridge of a curved
   stroke reads short). Both are printed; where they disagree, the difference is the bias, not a
   second measurement.

   Then it writes a sheet of enlarged crops, because the last question - does this look drawn with a
   pen - is answered by looking at it, and the numbers are what make that answer honest.

  usage: node qa/pen-ab.mjs [board size, default 25] [scale for the sheet, default 1.5]
         edit VALUES below to change the pen widths tried; they are fractions of a cell, the unit
         --stonpen is written in.
*/
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const QA = path.join(ROOT, 'qa');
const SIZE = +(process.argv[2] || 25);
const SHEET_SCALE = +(process.argv[3] || 1.5);
const VALUES = [.14, .10, .075, .055];            // .14 is the thickness this page shipped with
const THEMES = ['paper', 'slate'];
const base = 'http://127.0.0.1:9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(base + '/json/list')).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('no page target: ' + list.map((t) => t.type).join(','));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws failed')); });
let idc = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push('EXCEPTION: ' + (m.params.exceptionDetails?.exception?.description || ''));
  else if (m.method === 'Log.entryAdded' && m.params.entry?.level === 'error') errors.push('LOG: ' + m.params.entry.text);
};
const send = (method, params = {}) => new Promise((res) => { const id = ++idc; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression, awaitPromise) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: !!awaitPromise })).result?.result?.value;
const fileUrl = (p) => 'file:///' + path.join(ROOT, p).replace(/\\/g, '/');

/* The measuring happens in the page, where the pixels already are. The grid lines give the cell
   pitch; everything else comes from how far each pixel travelled from the board surface toward the
   colour the mark was asked to draw with - a coverage between 0 and 1. */
const PROBE = `
  window.__pen = (function () {
    var cs = getComputedStyle(document.documentElement);
    function rgbOf(v) {
      v = (v || '').trim();
      var m = v.match(/rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)/);
      if (m) return [+m[1], +m[2], +m[3]];
      m = v.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
      return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
    }
    function pal() {
      return {
        grid: rgbOf(cs.getPropertyValue('--grid')),
        x: rgbOf(cs.getPropertyValue('--p1')),
        o: rgbOf(cs.getPropertyValue('--p2')),
        surface: rgbOf(cs.getPropertyValue('--felt-a'))
      };
    }
    function geo() {
      var cv = document.getElementById('board'), c = cv.getContext('2d');
      var W = cv.width, H = cv.height, d = c.getImageData(0, 0, W, H).data, want = pal().grid;
      function close(p) { return Math.max(Math.abs(p[0] - want[0]), Math.abs(p[1] - want[1]), Math.abs(p[2] - want[2])) <= 26; }
      var hits = [];
      for (var x = 0; x < W; x++) {
        var n = 0;
        for (var y = 8; y < H - 8; y += 3) { var i = (y * W + x) * 4; if (close([d[i], d[i + 1], d[i + 2]])) n++; }
        if (n > (H / 3) * 0.5) hits.push(x);
      }
      var lines = [];
      for (var i = 0; i < hits.length; i++) if (!lines.length || hits[i] - lines[lines.length - 1] > 2) lines.push(hits[i]);
      var gap = [];
      for (var i = 1; i < lines.length; i++) gap.push(lines[i] - lines[i - 1]);
      gap.sort(function (a, b) { return a - b; });
      return { W: W, H: H, pitch: gap.length ? gap[gap.length >> 1] : 0, pad: lines.length ? lines[0] : 0,
               lines: lines.length };
    }

    // the coverage of a pixel: 0 at the board surface, 1 at the mark's own colour
    function cover(px, target, surface) {
      var num = 0, den = 0;
      for (var k = 0; k < 3; k++) { num += (px[k] - surface[k]) * (target[k] - surface[k]); den += (target[k] - surface[k]) * (target[k] - surface[k]); }
      return den ? Math.max(0, Math.min(1, num / den)) : 0;
    }

    function look(cell, which) {
      var g = geo();
      if (!g.pitch) return JSON.stringify({ error: 'no grid measured' });
      var cv = document.getElementById('board'), c = cv.getContext('2d');
      var p = pal(), target = p[which], surface = p.surface;
      var cx = Math.round(g.pad + (cell[0] + 0.5) * g.pitch), cy = Math.round(g.pad + (cell[1] + 0.5) * g.pitch);
      // a mark reaches 0.43 of a cell along an axis, so this window holds it and nothing of its own
      var half = Math.round(g.pitch * 0.52);
      var x0 = cx - half, y0 = cy - half, w = 2 * half, h = 2 * half;
      var d = c.getImageData(x0, y0, w, h).data;
      var IN = 1e9, inside = new Uint8Array(w * h), dist = new Float64Array(w * h), cov = [];
      /* One threshold for everything: half of the mark's colour. That is the line. It also keeps the
         measurement from mistaking the board's own grid for ink - on the paper board the pale grid
         sits 0.24 of the way from the surface to blue, so a loose threshold counts it. Pixels that
         are only partly the mark's colour are counted separately, as the halo: how soft the line is. */
      var inkPixels = 0, haloPixels = 0, extentX = 0, extentY = 0, clipped = false;
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var q = (y * w + x) * 4, t = cover([d[q], d[q + 1], d[q + 2]], target, surface);
        cov.push(t);
        if (t >= 0.2) {
          haloPixels++;
          if (t >= 0.5) inkPixels++;
        }
        if (t >= 0.5) {
          inside[y * w + x] = 1;
          var dx = Math.abs(x - half), dy = Math.abs(y - half);
          if (dx > extentX) extentX = dx;
          if (dy > extentY) extentY = dy;
          if (dx >= half - 1 || dy >= half - 1) clipped = true;   // the mark reached the window edge
        }
      }
      if (!inkPixels) return JSON.stringify({ error: 'nothing of that colour near this cell' });
      for (var k = 0; k < w * h; k++) dist[k] = inside[k] ? IN : 0;
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var i = y * w + x;
        if (!inside[i]) continue;
        var best = dist[i];
        if (y > 0) best = Math.min(best, dist[i - w] + 1);
        if (x > 0) best = Math.min(best, dist[i - 1] + 1);
        if (y > 0 && x > 0) best = Math.min(best, dist[i - w - 1] + 1.4142);
        if (y > 0 && x < w - 1) best = Math.min(best, dist[i - w + 1] + 1.4142);
        dist[i] = best;
      }
      for (var y = h - 1; y >= 0; y--) for (var x = w - 1; x >= 0; x--) {
        var i = y * w + x;
        if (!inside[i]) continue;
        var best = dist[i];
        if (y < h - 1) best = Math.min(best, dist[i + w] + 1);
        if (x < w - 1) best = Math.min(best, dist[i + 1] + 1);
        if (y < h - 1 && x < w - 1) best = Math.min(best, dist[i + w + 1] + 1.4142);
        if (y < h - 1 && x > 0) best = Math.min(best, dist[i + w - 1] + 1.4142);
        dist[i] = best;
      }
      var ridge = [];
      for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) {
        var i = y * w + x;
        if (!inside[i] || dist[i] >= IN / 2) continue;
        var v = dist[i], ok = true;
        for (var dy = -1; dy <= 1 && ok; dy++) for (var dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          if (dist[i + dy * w + dx] > v + 1e-6) { ok = false; break; }
        }
        if (ok) ridge.push(v);
      }
      ridge.sort(function (a, b) { return a - b; });
      var penRidge = ridge.length ? +(2 * ridge[ridge.length >> 1] - 1).toFixed(2) : null;

      /* the unbiased width for a ring: along the row through its centre the stroke is crossed at
         right angles, so the run of pixels there is exactly its own width */
      var runs = [];
      for (var row = -2; row <= 2; row++) {
        var y = half + row, x = 0;
        while (x < w) {
          while (x < w && cov[y * w + x] < 0.5) x++;
          var start = x;
          while (x < w && cov[y * w + x] >= 0.5) x++;
          if (x - start >= 1 && x - start <= g.pitch * 0.45) runs.push(x - start);
        }
      }
      runs.sort(function (a, b) { return a - b; });
      var penRun = runs.length ? runs[runs.length >> 1] : null;

      var colourMax = 0;
      for (var k = 0; k < cov.length; k++) if (cov[k] > colourMax) colourMax = cov[k];
      var area = w * h;
      return JSON.stringify({
        cell: cell, at: [cx, cy], pitch: g.pitch, pad: g.pad, gridLines: g.lines,
        penRidge: penRidge, penRun: penRun, runSamples: runs.length,
        extentX: +(extentX / g.pitch).toFixed(3), extentY: +(extentY / g.pitch).toFixed(3),
        windowClipped: clipped,
        inkPct: +(inkPixels / area * 100).toFixed(1),
        haloPct: +((haloPixels - inkPixels) / area * 100).toFixed(1),
        colourMax: +colourMax.toFixed(3)
      });
    }

    function crop(cell, scale) {
      var g = geo();
      var src = document.getElementById('board');
      var box = Math.round(g.pitch * 4);
      var cx = Math.round(g.pad + (cell[0] + 0.5) * g.pitch), cy = Math.round(g.pad + (cell[1] + 0.5) * g.pitch);
      var d = document.createElement('canvas');
      d.width = Math.round(box * scale); d.height = Math.round(box * scale);
      var c2 = d.getContext('2d');
      c2.imageSmoothingEnabled = false;
      c2.drawImage(src, cx - box / 2, cy - box / 2, box, box, 0, 0, d.width, d.height);
      return d.toDataURL('image/png');
    }
    return { look: look, crop: crop, geo: geo };
  })(); 'ok';`;

/* One position, played with real clicks so it is the page's own game and not a fake one. The
   cells are aimed at the middle of a square computed from the measured grid. They put marks beside
   each other and alone, so the pen can be judged where it has to work. */
const PLAY = [[6, 6], [7, 6], [8, 6], [6, 7], [6, 8], [9, 9], [10, 7], [7, 10], [11, 11], [4, 4], [5, 6], [10, 10]];

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: 'about:blank' });
await sleep(300);
await send('Page.navigate', { url: fileUrl('match5.html') });
await sleep(1500);
await evaluate("(function(){document.querySelector('#modeSeg button[data-mode=\"pvp\"]').click();" +
  "var s=document.getElementById('sizeSel');s.value='" + SIZE + "';s.dispatchEvent(new Event('change',{bubbles:true}));return 'set';})()");
await sleep(800);
await evaluate(PROBE);
const g0 = JSON.parse(await evaluate("JSON.stringify(window.__pen.geo())"));
console.log('board ' + SIZE + 'x' + SIZE + ': canvas ' + g0.W + 'x' + g0.H + ', ' + g0.lines + ' grid lines, cell ' +
  g0.pitch + ' px, first grid line at ' + g0.pad);

for (const cell of PLAY) {
  await evaluate("(function(){var cv=document.getElementById('board');var r=cv.getBoundingClientRect();" +
    "var sx=r.width/cv.width, sy=r.height/cv.height;" +
    "var x=r.left+(" + g0.pad + "+(" + cell[0] + "+0.5)*" + g0.pitch + ")*sx;" +
    "var y=r.top+(" + g0.pad + "+(" + cell[1] + "+0.5)*" + g0.pitch + ")*sy;" +
    "cv.dispatchEvent(new PointerEvent('pointermove',{clientX:x,clientY:y,bubbles:true}));" +
    "cv.dispatchEvent(new PointerEvent('pointerdown',{clientX:x,clientY:y,bubbles:true}));return 'x';})()");
  await sleep(80);
}
await evaluate("(function(){var cv=document.getElementById('board'),r=cv.getBoundingClientRect();" +
  "cv.dispatchEvent(new PointerEvent('pointermove',{clientX:r.left-60,clientY:r.top-60,bubbles:true}));return 'away';})()");
await sleep(300);
console.log('moves played: ' + await evaluate("document.getElementById('stMoves').textContent"));

const tiles = [];
console.log('\nasked = --stonpen x ' + g0.pitch + ' px.  line = each drawn stroke\'s full length, 2 x (extent - pen/2) x cell.');
console.log('drawn = the width of the pixels holding at least half the mark colour: ridge = distance');
console.log('transform (exact on straight strokes), run = crossing a row through a ring centre (exact');
console.log('on rings).  extent = outside size along an axis, in cells - the same for both marks and');
console.log('not allowed to move (! = it reached the measuring window).  ink/halo = % of the window');
console.log('that is line / that is only partly the mark colour.  colour = the fullest colour reached.\n');
for (const theme of THEMES) {
  for (const v of VALUES) {
    const other = THEMES.find((t) => t !== theme);
    await evaluate("document.documentElement.style.setProperty('--stonpen','" + v + "');'x'");
    await evaluate("document.querySelector('#themeSeg button[data-theme=\"" + other + "\"]').click();'x'");
    await sleep(250);
    await evaluate("document.querySelector('#themeSeg button[data-theme=\"" + theme + "\"]').click();'x'");
    await sleep(450);
    const x = JSON.parse(await evaluate("window.__pen.look([6,6],'x')"));
    const o = JSON.parse(await evaluate("window.__pen.look([7,6],'o')"));
    console.log([
      (theme + ' stonpen ' + v).padEnd(21),
      'asked ' + String(+(v * g0.pitch).toFixed(2)).padStart(5),
      'line ' + String(+(2 * (0.43 - v / 2) * g0.pitch).toFixed(1)).padStart(5),
      '| X drawn ' + String(x.penRidge).padStart(5) + '  ext ' + x.extentX + '/' + x.extentY + (x.windowClipped ? '!' : ' ') +
      '  ink ' + String(x.inkPct).padStart(5) + '% halo ' + String(x.haloPct).padStart(5) + '%  colour ' + x.colourMax,
      '| O drawn ' + String(o.penRidge).padStart(5) + '/' + String(o.penRun).padStart(4) +
      '  ext ' + o.extentX + '/' + o.extentY + (o.windowClipped ? '!' : ' ') +
      '  ink ' + String(o.inkPct).padStart(5) + '% halo ' + String(o.haloPct).padStart(5) + '%  colour ' + o.colourMax,
    ].join(' '));
    tiles.push({ theme, v, dataUrl: await evaluate("window.__pen.crop([6,6]," + SHEET_SCALE + ")") });
  }
}

const sheet = await evaluate("(function(){var t=" + JSON.stringify(tiles) + ",pitch=" + g0.pitch + ",sc=" + SHEET_SCALE + ";" +
  "var tileW=Math.round(4*pitch*sc), tileH=tileW+22, cols=4;" +
  "var d=document.createElement('canvas');d.width=cols*tileW+10;d.height=Math.ceil(t.length/cols)*(tileH)+10;" +
  "var g=d.getContext('2d');g.fillStyle='#0b0f14';g.fillRect(0,0,d.width,d.height);" +
  "var imgs=t.map(function(x){var i=new Image();i.src=x.dataUrl;return i;});" +
  "return new Promise(function(res){" +
  "  var left=imgs.length;" +
  "  function fin(){g.fillStyle='#0b0f14';g.fillRect(0,0,d.width,d.height);" +
  "    t.forEach(function(x,k){var cx=5+(k%cols)*tileW,cy=5+Math.floor(k/cols)*tileH;" +
  "      try{g.drawImage(imgs[k],cx,cy);}catch(e){}" +
  "      g.fillStyle='#fff';g.font='14px monospace';" +
  "      g.fillText(x.theme+'  stonpen '+x.v+'  -> '+(x.v*pitch).toFixed(1)+' px',cx+3,cy+tileW+16);});" +
  "      res(d.toDataURL('image/png'));}" +
  "  imgs.forEach(function(i){i.onload=function(){if(!--left)fin();};i.onerror=function(){if(!--left)fin();};});" +
  "});})()", true);
if (typeof sheet === 'string' && sheet.startsWith('data:')) {
  const out = path.join(QA, 'pen-ab.png');
  fs.writeFileSync(out, Buffer.from(sheet.split(',')[1], 'base64'));
  console.log('\nwrote qa/pen-ab.png (' + fs.statSync(out).size.toLocaleString('en-US') + ' bytes, ' +
    'each tile is a 4-cell patch at x' + SHEET_SCALE + ')');
} else console.log('\nsheet failed: ' + sheet);
console.log('js errors: ' + (errors.length ? errors.join(' | ') : 'none'));
ws.close();
