// Layout check (needs the QA Chrome on :9333, like cdp-drive.mjs). It measures what a
// screenshot alone should not be trusted for: where the Engine report sits on the first
// screen, the computed colour of the decision text and of the log lines, what the decision
// log actually holds, and that the advanced settings are folded by default while the summary
// line still states what is pinned. It also measures the log's place in the page rather than
// trusting the markup - that it starts immediately under the board, in that column's width,
// laid out as one row per decision with no text spilling out of the card. It photographs the
// log and the opened panel.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const QA = path.join(ROOT, 'qa');
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
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    errors.push('EXCEPTION: ' + (d.exception?.description || d.text));
  } else if (m.method === 'Log.entryAdded' && m.params.entry?.level === 'error') {
    errors.push('LOG: ' + m.params.entry.text);
  }
};
const send = (method, params = {}) => new Promise((res) => { const id = ++idc; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  /* A probe that throws must not arrive as undefined a few lines later, where it reads as a bad
     value from the page rather than a broken instrument. */
  const bad = r.result?.exceptionDetails;
  if (bad) {
    const why = bad.exception?.description || bad.text;
    errors.push('EVAL: ' + why);
    throw new Error('the probe threw: ' + why);
  }
  return r.result?.result?.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (!r.result?.data) { console.log('no screenshot data'); return; }
  const p = path.join(QA, name);
  fs.writeFileSync(p, Buffer.from(r.result.data, 'base64'));
  console.log('wrote ' + path.relative(ROOT, p) + ' (' + fs.statSync(p).size.toLocaleString('en-US') + ' bytes)');
};
const fileUrl = (p, hash) => 'file:///' + path.join(ROOT, p).replace(/\\/g, '/') + (hash || '');

await send('Page.enable');
await send('Runtime.enable');

/* Navigating to the same URL twice is not a reload, and the previous run leaves the page
   scrolled and its settings panel open - both of which would be measured as if they were the
   product's own behaviour. So leave the document first. */
await send('Page.navigate', { url: 'about:blank' });
await sleep(400);
await send('Page.navigate', { url: fileUrl('qa/probe.html', '#fast') });
await sleep(16000);

console.log('where things sit: ' + await evaluate(
  "(function(){var g=function(id){var r=document.getElementById(id).getBoundingClientRect();" +
  "return {top:Math.round(r.top),bottom:Math.round(r.bottom),left:Math.round(r.left),width:Math.round(r.width)," +
  "visibleOnFirstScreen:Math.round(r.bottom)<window.innerHeight};};" +
  "var b=g('boardCard');var l=document.getElementById('logList').closest('.card').getBoundingClientRect();" +
  "l={top:Math.round(l.top),bottom:Math.round(l.bottom),left:Math.round(l.left),width:Math.round(l.width)};" +
  "var m=document.querySelector('#logList .msg');" +
  "var spill=0, rows=0;" +
  "document.querySelectorAll('#logList .msg').forEach(function(e){ if(e.scrollWidth>e.clientWidth+1) spill++; rows++; });" +
  "return JSON.stringify({viewport:[window.innerWidth,window.innerHeight],reportRow:g('stBy'),board:b," +
  "logCard:l,underTheBoard:l.top>=b.bottom,immediatelyUnderBoard:l.top-b.bottom<=30,gapUnderBoard:l.top-b.bottom," +
  "sameColumnAsBoard:l.left===b.left&&l.width===b.width," +
  "rowColumns:m?getComputedStyle(m).gridTemplateColumns:'no rows',rowsSpillingOut:spill,rows:rows," +
  "settings:g('settingsCard'),docHeight:document.documentElement.scrollHeight});})()"));

console.log('the log as it stands (newest first, at the top): ' + await evaluate(
  "(function(){var l=document.getElementById('logList');var k=l.querySelectorAll('.msg');" +
  "var cols={},out=[];k.forEach(function(m){var c=getComputedStyle(m.querySelector('.mv')).color;cols[c]=(cols[c]||0)+1;});" +
  "out.push(k.length+' lines');out.push(JSON.stringify(cols));" +
  "out.push('newest: '+k[0].textContent.replace(/\\s+/g,' '));" +
  "out.push('oldest: '+k[k.length-1].textContent.replace(/\\s+/g,' '));" +
  "return out.join(' | ');})()"));

console.log('settings panel before opening: ' + await evaluate(
  "(function(){var d=document.getElementById('settingsCard');var r=d.getBoundingClientRect();" +
  "return JSON.stringify({open:d.open,cardTop:Math.round(r.top),cardBottom:Math.round(r.bottom)," +
  "summaryText:document.querySelector('#settingsCard summary').textContent.replace(/\\s+/g,' ').slice(0,190)});})()"));

// photograph the log where it now lives: under the board, in the board's own column
await evaluate("document.getElementById('logList').closest('.card').scrollIntoView({ block: 'start' }); 'ok'");
await sleep(500);
await shot('log-look.png');

await evaluate("document.getElementById('settingsCard').open = true; 'ok'");
await sleep(400);
// bring the opened panel into view, otherwise the photograph shows a closed-looking card
await evaluate("document.getElementById('settingsCard').scrollIntoView({ block: 'start' }); 'ok'");
await sleep(300);
console.log('settings panel after opening: ' + await evaluate(
  "(function(){var d=document.getElementById('settingsCard');var r=d.getBoundingClientRect();" +
  "return JSON.stringify({open:d.open,height:Math.round(r.height),controls:[].slice.call(d.querySelectorAll('select,input')).map(function(e){return e.id+'='+e.value;})});})()"));
await shot('settings-open.png');

/* ---------- the two boards, measured the way the reference picture was measured ----------
   A drawn board has no stylesheet colours to read: the canvas produces pixels. So the same
   quantized histogram qa/paper-palette.py prints for the picture is printed here for the game,
   the surface it actually drew on is taken from that histogram rather than from the source, and
   every mark's contrast is computed against the surface it really has to be legible on. */
const BOARD_PROBE = `
  window.__qaBoard = function () {
    var cv = document.getElementById('board'), c = cv.getContext('2d');
    var d = c.getImageData(0, 0, cv.width, cv.height).data, q = {}, n = 0;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      n++;
      var k = ((d[i] / 12 | 0) * 12) + ',' + ((d[i + 1] / 12 | 0) * 12) + ',' + ((d[i + 2] / 12 | 0) * 12);
      q[k] = (q[k] || 0) + 1;
    }
    var top = Object.keys(q).map(function (k) { return k.split(',').map(Number).concat(q[k] / n); });
    top.sort(function (a, b) { return b[3] - a[3]; });
    var cs = getComputedStyle(document.documentElement);
    function rgbOf(v) {
      v = (v || '').trim();
      var m = v.match(/rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)/);
      if (m) return [+m[1], +m[2], +m[3]];
      m = v.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
      return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
    }
    function lum(p) {
      function f(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
      return 0.2126 * f(p[0]) + 0.7152 * f(p[1]) + 0.0722 * f(p[2]);
    }
    function ratio(a, b) { var x = lum(a), y = lum(b); if (x < y) { var t = x; x = y; y = t; } return (x + 0.05) / (y + 0.05); }
    var surface = top[0], win = (cs.getPropertyValue('--winrgb') || '').trim();
    /* How much of the board is drawn in warm hues and how much in cool ones. On the paper
       theme that is the picture's own signature: blue pens for X, a red stroke for the five
       that won. The picture measured 0.29% red, 1.00% blue, and 4.47% pale grid. */
    var warm = 0, cool = 0;
    Object.keys(q).forEach(function (k) {
      var p = k.split(',').map(Number);
      if (p[0] > p[1] + 60 && p[0] > p[2] + 60) warm += q[k];
      if (p[2] > p[0] + 60 && p[2] > p[1] + 60) cool += q[k];
    });
    var marks = {
      X: cs.getPropertyValue('--p1'), O: cs.getPropertyValue('--p2'),
      winLine: win ? 'rgb(' + win + ')' : cs.getPropertyValue('--p1'),
      text: cs.getPropertyValue('--ink'), label: cs.getPropertyValue('--dim2'),
      grid: cs.getPropertyValue('--grid')
    };
    var contrast = {};
    Object.keys(marks).forEach(function (k) { contrast[k] = +ratio(rgbOf(marks[k]), surface).toFixed(2); });
    var felt = rgbOf(cs.getPropertyValue('--felt-a'));
    var hex = function (t) { return '#' + t.slice(0, 3).map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join(''); };
    return JSON.stringify({
      theme: document.documentElement.getAttribute('data-theme') || 'slate',
      deviceCanvas: [cv.width, cv.height],
      surface: hex(surface), surfaceShare: +(surface[3] * 100).toFixed(2),
      feltMatchesDrawn: Math.max(Math.abs(felt[0] - surface[0]), Math.abs(felt[1] - surface[1]), Math.abs(felt[2] - surface[2])) <= 12,
      fiveMostCommon: top.slice(0, 5).map(function (t) { return hex(t) + ' ' + (t[3] * 100).toFixed(2) + '%'; }),
      contrastAgainstSurface: contrast,
      warmPixels: +(warm * 100 / n).toFixed(2), coolPixels: +(cool * 100 / n).toFixed(2)
    });
  }; 'installed';`;
const installBoardProbe = () => evaluate(BOARD_PROBE);
const boardLook = async () => { await installBoardProbe(); return evaluate('window.__qaBoard()'); };

await evaluate("window.scrollTo(0,0); 'ok'");
await sleep(400);
console.log('the board as drawn (slate): ' + await boardLook());
await shot('board-slate.png');

// a second board, from the picture: the point is that the picture's own colours are in the pixels
const movesBefore = await evaluate("document.getElementById('stMoves').textContent");
await evaluate("document.querySelector('#themeSeg button[data-theme=\\'paper\\']').click(); 'clicked'");
await sleep(700);
const movesAfter = await evaluate("document.getElementById('stMoves').textContent");
console.log('switching board colour kept the game: moves before ' + movesBefore + ', after ' + movesAfter +
  ', seg state ' + await evaluate("(function(){var b=[].slice.call(document.querySelectorAll('#themeSeg button'));" +
  "return b.map(function(x){return x.textContent + (x.classList.contains('on') ? '=on' : '=off');}).join(' ');})()"));
console.log('the board as drawn (paper): ' + await boardLook());
await shot('board-paper.png');

/* The picture's other mark is the single red stroke over the winning five. This waits for the
   game #fast started to finish, then asks the pixels whether that stroke is really drawn. */
let finished = false, waited = 0;
for (; waited < 45 && !finished; waited++) {
  await sleep(1000);
  finished = await evaluate("document.getElementById('banner').classList.contains('show')");
}
console.log('the game on paper ended as: ' + await evaluate("document.getElementById('bannerRes').textContent") +
  ' (waited ' + waited + ' s' + (finished ? '' : ', no finish in time') + ')');
console.log('the board as drawn (paper, finished): ' + await boardLook());
if (finished) await shot('board-paper-winner.png');

/* ---------- the log's order, with lines arriving on purpose ----------
   Newest has to be the first row of the list, and a reader who has scrolled down into the older
   lines has to keep looking at the same line as rows are added above them. Racing a real game
   makes that a coin toss - two engines at Medium finish a 25×25 game in well under the time it
   takes to look - so the moves are made here, one pointer event each, in "2 Players" mode. A
   human line goes through the same logEntry path as an engine line and lands the moment the
   square is clicked, and the squares are chosen on a lattice wider than two cells, so no five
   can appear by accident. The row being read is identified by the move it describes and located
   by its real position inside the scroll port, before and after. */
await evaluate("document.querySelector('#modeSeg button[data-mode=\\'pvp\\']').click(); 'two players'");
await sleep(600);
await evaluate(`
  window.__qaClick = (function () {
    var c = document.getElementById('board'), i = 0;
    return function () {
      var r = c.getBoundingClientRect(), per = Math.floor((r.width - 140) / 78) + 1;
      for (var guard = 0; guard < 500; guard++) {
        var x = r.left + 70 + (i % per) * 78, y = r.top + 70 + Math.floor(i / per) * 78;
        i++;
        if (y > r.bottom - 70) return false;
        var before = document.getElementById('stMoves').textContent;
        c.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }));
        if (document.getElementById('stMoves').textContent !== before) return true;   // an empty square
      }
      return false;
    };
  })(); 'clicking helper installed';`);
const placed = await evaluate(
  "(function(){var n=0,fail=0,t=0;while(t++<400 && fail<15){n++;if(window.__qaClick()){fail=0;}else{fail++;}" +
  "if(document.getElementById('logList').querySelectorAll('.msg').length>=36)break;}" +
  "return 'walked ' + n + ' squares, log rows ' + document.querySelectorAll('#logList .msg').length + ', moves ' + document.getElementById('stMoves').textContent;})()");
console.log('making the log deliberately: ' + placed);
const readBefore = await evaluate(
  "(function(){var l=document.getElementById('logList');l.scrollTop=140;" +
  "var rows=[].slice.call(l.querySelectorAll('.msg'));" +
  "var mv=rows.filter(function(m){return m.dataset.mv;}).map(function(m){return +m.dataset.mv;});" +
  "var newestFirst=true;for(var i=1;i<mv.length;i++){if(mv[i]>mv[i-1])newestFirst=false;}" +
  "var base=l.getBoundingClientRect().top,pick=null;" +
  "rows.forEach(function(m){var o=m.getBoundingClientRect().top-base;if(!pick&&o>=0){pick={move:m.dataset.mv||'-',offset:Math.round(o)};}});" +
  "return JSON.stringify({gameSays:document.getElementById('stMoves').textContent,rows:rows.length," +
  "scrollable:l.scrollHeight>l.clientHeight,moveNumbersDownTheList:mv.slice(0,5),newestFirst:newestFirst," +
  "readerIsOn:pick,scrollTop:l.scrollTop});})()");
const oneMore = await evaluate("window.__qaClick()");
await sleep(120);
const readAfter = await evaluate(
  "(function(){var l=document.getElementById('logList');var rows=[].slice.call(l.querySelectorAll('.msg'));" +
  "var mv=rows.filter(function(m){return m.dataset.mv;}).map(function(m){return +m.dataset.mv;});" +
  "var newestFirst=true;for(var i=1;i<mv.length;i++){if(mv[i]>mv[i-1])newestFirst=false;}" +
  "var base=l.getBoundingClientRect().top,pick=null;" +
  "rows.forEach(function(m){var o=m.getBoundingClientRect().top-base;if(!pick&&o>=0){pick={move:m.dataset.mv||'-',offset:Math.round(o)};}});" +
  "var top=rows[0];" +
  "return JSON.stringify({gameSays:document.getElementById('stMoves').textContent,rows:rows.length," +
  "topRowDescribesMove:top.dataset.mv||'-',topRowSays:top.textContent.replace(/\\s+/g,' ').slice(0,70)," +
  "newestFirst:newestFirst,readerIsOn:pick,scrollTop:l.scrollTop});})()");
const a = JSON.parse(readBefore), b = JSON.parse(readAfter);
const added = Number(b.gameSays) > Number(a.gameSays);
console.log('log before one more move: ' + readBefore);
console.log('log after one more move:  ' + readAfter);
console.log('  a line arrived: ' + added + ' (moves ' + a.gameSays + ' -> ' + b.gameSays + ')' +
  ', newest line is the first row: ' + (b.topRowDescribesMove === b.gameSays) +
  ', the list stayed newest-first: ' + (a.newestFirst && b.newestFirst) +
  ', the reader kept their line while a row was added above them: ' + (added && a.readerIsOn && b.readerIsOn &&
    a.readerIsOn.move === b.readerIsOn.move && Math.abs(a.readerIsOn.offset - b.readerIsOn.offset) <= 2));

/* ---------- the marker for the last move takes the shape of the mark it marks ----------
   A circle around a round mark says "this one" without covering anything up; the same circle around a
   cross is a shape the mark does not have. So the marker is the outline of the mark it marks, drawn at
   one fixed distance out from its edge: for the round mark a circle, as it has always been; for the
   cross, the ends of that outline - short strokes across each arm, just clear of its tip. (The sides
   of a cross's outline cannot be drawn: they run along the arms, and measured on the default board the clear space
   between such a pair is 0-1.5 px when a cell is 28 px, which reads as a thicker mark, not a marker.)

   This is read out of pixels, and the question has to be asked in a way the drawing can answer. In
   each of sixteen wedges from the marked square - 22.5 degrees apart, from pointing right - take the
   most of the mark's colour anywhere in that wedge, past where the mark can reach: for a cross, it
   has to be found at the four directions its arms point and in none of the other twelve; for a round
   mark, in all sixteen, because a circle is in every direction. That is also exactly what would fail
   if either shape were drawn as the other's: a circle round a cross puts ink along the axes, which
   the cross's marker never does. Two things have to be measured for that to mean anything. The centre
   comes from the mark's own deep ink rather than from the cell arithmetic, because the arithmetic is
   good to about a pixel and the clearance here is 3 px at a 28 px cell. And the search is a patch,
   not a ray: the marker line is 1.5 px wide, so a single ray at half-pixel steps can miss it outright
   - an earlier version of this gate did exactly that and failed on the drawing rather than on the
   page. The grid pitch and padding are measured off the lines the board drew, and a pixel's colour is
   read the way qa/pen-ab.mjs reads it - how far it lies between the surface and the mark's colour -
   so a thin marker line counts and a pale grid line does not. Nothing marked is within a cell of the square
   being read, so what is found past the mark really belongs to the marker, and its reach past the
   square's own edge is reported in pixels. */
await evaluate("var s=document.getElementById('sizeSel'); s.value='13'; s.dispatchEvent(new Event('change',{bubbles:true})); '13x13'");
await sleep(900);
const MARK_PROBE = `
// Where the grid is, measured off the lines the board drew rather than from what the page thinks.
// Asked again for every click and every read: the panel beside the board grows as moves are played
// and logged, the canvas shrinks with it, so one measurement does not hold for the whole run.
window.__geo = function (side) {
  var cv = document.getElementById('board'), c = cv.getContext('2d');
  var cs = getComputedStyle(document.documentElement);
  function rgbOf(v) {
    v = (v || '').trim();
    var m = v.match(/rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)/);
    if (m) return [+m[1], +m[2], +m[3]];
    m = v.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
  }
  var grid = rgbOf(cs.getPropertyValue('--grid')), surface = rgbOf(cs.getPropertyValue('--felt-a'));
  var target = rgbOf(cs.getPropertyValue(side === 'x' ? '--p1' : side === 'o' ? '--p2' : '--grid'));
  // where the grid is, measured off the lines the board drew rather than from what the page thinks
  var W = cv.width, H = cv.height, d = c.getImageData(0, 0, W, H).data;
  function close(p) { return Math.max(Math.abs(p[0] - grid[0]), Math.abs(p[1] - grid[1]), Math.abs(p[2] - grid[2])) <= 26; }
  var hits = [];
  for (var x = 0; x < W; x++) {
    var n = 0;
    for (var y = 8; y < H - 8; y += 3) { var i = (y * W + x) * 4; if (close([d[i], d[i + 1], d[i + 2]])) n++; }
    if (n > (H / 3) * 0.5) hits.push(x);
  }
  var lines = [];
  for (var i = 0; i < hits.length; i++) if (!lines.length || hits[i] - lines[lines.length - 1] > 2) lines.push(hits[i]);
  if (lines.length < 3) return { error: 'the grid could not be measured' };
  var gaps = [];
  for (var i = 1; i < lines.length; i++) gaps.push(lines[i] - lines[i - 1]);
  gaps.sort(function (a, b) { return a - b; });
  var pitch = gaps[gaps.length >> 1], pad = lines[0], r = cv.getBoundingClientRect();
  return { W: W, H: H, d: d, pitch: pitch, pad: pad, left: r.left, top: r.top,
    scaleX: r.width / W, scaleY: r.height / H, surface: surface, target: target };
};
// where to put a real mouse for a given cell, from the grid as it is right now
window.__aim = function (cell) {
  var g = window.__geo();
  if (g.error) return JSON.stringify(g);
  return JSON.stringify({ x: g.left + (g.pad + (cell[0] + 0.5) * g.pitch) * g.scaleX,
    y: g.top + (g.pad + (cell[1] + 0.5) * g.pitch) * g.scaleY, pitch: g.pitch });
};
window.__markerLook = function (cell, side) {
  var g = window.__geo(side);
  if (g.error) return JSON.stringify(g);
  var W = g.W, H = g.H, d = g.d, pitch = g.pitch;
  var surface = g.surface, target = g.target;
  function coverAt(x, y) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return -1;
    var i = (y * W + x) * 4, p = [d[i], d[i + 1], d[i + 2]], num = 0, den = 0;
    for (var k = 0; k < 3; k++) {
      num += (p[k] - surface[k]) * (target[k] - surface[k]);
      den += (target[k] - surface[k]) * (target[k] - surface[k]);
    }
    return num / den;                       // how much of the mark's colour this pixel is
  }
  // The mark's own centre, taken from the deep ink rather than from the grid arithmetic. A cell
  // centre computed from the first grid line is good to about a pixel, and the space between a mark
  // and its marker is two or three pixels, so the arithmetic is not good enough to measure it.
  var ax = g.pad + (cell[0] + 0.5) * pitch, ay = g.pad + (cell[1] + 0.5) * pitch;
  var sx = 0, sy = 0, n = 0;
  for (var y = ay - 0.30 * pitch; y <= ay + 0.30 * pitch; y += 1)
    for (var x = ax - 0.30 * pitch; x <= ax + 0.30 * pitch; x += 1)
      if (coverAt(x, y) >= 0.55) { sx += x; sy += y; n++; }   // marks are solid; the marker is half tone
  if (n < 15) return JSON.stringify({ error: 'no mark of that kind was found in that square' });
  var cx = sx / n, cy = sy / n;
  /* What the mark's colour reaches in a wedge, taking the best over a patch rather than along one
     hair-thin line: the marker is 1.5px wide and stands about 3px clear, so a single ray at 0.5px
     steps walks past both and reports nothing. Wedges are 16 x 22.5 degrees, 8 degrees either side
     of centre; a cap is under 6px to either side of its arm, which at these radii is under 9
     degrees, so a wedge centred between arms cannot reach one.
     Where to start looking depends on the mark: a cross's own arms end at 0.593 of a cell, so its
     caps are sought past that; the other twelve directions of a cross start at its edge, because
     what must not be there is a circle round it. A round mark's ink ends at 0.47 with the shipped
     pen, so its circle is sought past that. */
  var wedges = [], map = '', dirs = [];
  for (var k = 0; k < 16; k++) {
    var th = k * Math.PI / 8, hw = 8 * Math.PI / 180;
    var from = side === 'o' ? 0.47 : (k % 4 === 2 ? 0.60 : 0.44), to = 0.90;
    var peak = -1, atR = -1, farR = -1;
    for (var r = from * pitch; r <= to * pitch; r += 0.4) {
      for (var a = th - hw; a <= th + hw + 1e-12; a += 0.4 / r) {
        var v = coverAt(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        if (v < 0.28) continue;
        if (v > peak) { peak = v; atR = r; }
        if (r > farR) farR = r;
      }
    }
    var bound = (pitch / 2) / Math.max(Math.abs(Math.cos(th)), Math.abs(Math.sin(th)));
    dirs.push({ deg: Math.round(th * 180 / Math.PI), from: +from.toFixed(2), peak: +peak.toFixed(2),
      atCell: +(atR / pitch).toFixed(2), farCell: +(farR / pitch).toFixed(2), pastPx: +Math.max(0, farR - bound).toFixed(1) });
    map += peak >= 0.28 ? '#' : '.';
  }
  return JSON.stringify({
    pitch: pitch, pad: g.pad, at: [+cx.toFixed(1), +cy.toFixed(1)], shift: [+(cx - ax).toFixed(1), +(cy - ay).toFixed(1)],
    inkPixels: n, map: map, dirs: dirs
  });
}; 'installed';`;
await evaluate(MARK_PROBE);

console.log('\nthe marker that says which was placed last, in the shape of the mark it marks');
const probeEmpty = JSON.parse(await evaluate("var g=window.__geo(); JSON.stringify({pitch:g.pitch,pad:g.pad})"));  // an empty square: the grid reading only
console.log('  measured grid: ' + probeEmpty.pitch + ' px a cell, first grid line at ' + probeEmpty.pad);
const clickCell = async (cell) => {
  const aim = JSON.parse(await evaluate("window.__aim([" + cell.join(',') + "])"));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: aim.x, y: aim.y, buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: aim.x, y: aim.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: aim.x, y: aim.y, button: 'left', buttons: 0, clickCount: 1 });
  return evaluate("document.getElementById('stMoves').textContent");
};
// and put the pointer somewhere that is not the board before reading pixels: an empty square under
// the cursor gets a ghost of the next mark drawn on it, and that is not what is being measured
const movePointerOffBoard = async () => {
  const aim = JSON.parse(await evaluate("var g=window.__geo(); JSON.stringify({x:g.left+g.W*g.scaleX+80,y:g.top+20})"));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: aim.x, y: aim.y, buttons: 0 });
  await sleep(140);
};

// nothing marked within a cell of the two squares that get read
const lineUp = [[5, 5], [3, 9], [9, 3]];     // X, O, X: the last mark placed is a cross
for (const cell of lineUp) { console.log('  placed at ' + cell.join(',') + ', moves now ' + await clickCell(cell)); await sleep(180); }
await movePointerOffBoard();
const describe = (r) => r.dirs.filter((d) => d.peak >= 0.28)
  .map((d) => d.deg + '° ' + d.peak + ' at ' + d.atCell + (d.farCell > d.atCell ? '→' + d.farCell : '') + ' of a cell').join(' | ');
const lastX = JSON.parse(await evaluate("window.__markerLook([9,3],'x')"));
const ARM = [2, 6, 10, 14];
console.log('  a cross placed last, what its colour reaches from 0.44 of a cell out: ' + lastX.map);
console.log('    (sixteen directions, left to right from pointing right; # = found, . = not; ' +
  'the mark\'s arms were skipped to 0.60, everything else from its edge)');
console.log('    the mark\'s centre measured ' + lastX.shift.join(',') + ' px off the cell centre computed from the grid, from ' + lastX.inkPixels + ' px of solid ink');
console.log('    ' + describe(lastX));
const caps = ARM.every((k) => lastX.dirs[k].peak >= 0.28 && lastX.dirs[k].atCell >= 0.60);
const noRing = lastX.dirs.every((d, k) => ARM.includes(k) || d.peak < 0.28);
const pastX = Math.max(...lastX.dirs.map((d) => d.pastPx));
console.log('    marker clear of the mark at all four arm ends: ' + caps +
  '; nothing at all in the twelve directions between them: ' + noRing + '; furthest past the square: ' + pastX + ' px');

await clickCell([7, 7]); await sleep(220);      // an O placed last
await movePointerOffBoard();
const lastO = JSON.parse(await evaluate("window.__markerLook([7,7],'o')"));
console.log('  a round mark placed last, what its colour reaches from 0.47 of a cell out: ' + lastO.map);
console.log('    ' + describe(lastO));
const ring = lastO.dirs.filter((d) => d.peak >= 0.28).length;
const pastO = Math.max(...lastO.dirs.map((d) => d.pastPx));
console.log('    a whole circle, ink in ' + ring + ' of sixteen directions; furthest past the square: ' + pastO + ' px');
await shot('board-last-marker.png');

const markerFails = [];
if (!caps) markerFails.push('a cross placed last has nothing across its arms');
if (!noRing) markerFails.push('a cross placed last carries something round: its colour was found in a direction the arms do not point');
if (ring < 16) markerFails.push('a round mark placed last does not get a whole circle (' + ring + ' of 16 directions)');
if (pastX > 2.5 || pastO > 2.5) markerFails.push('the marker reaches ' + Math.max(pastX, pastO) + ' px past its own square');
// and what stands past the edge is judged against the next square's own mark, not against pixels:
// a mark's ink begins 0.07 of a cell inside its edge, so this has to stay well under that
const intrusion = Math.max(...[...lastX.dirs, ...lastO.dirs].map((d) => d.pastPx / lastX.pitch));
if (intrusion > 0.10) markerFails.push('the marker stands ' + intrusion.toFixed(3) + ' of a cell into the next square');
console.log('  furthest into the next square: ' + intrusion.toFixed(3) + ' of a cell, where a mark begins at 0.070');
console.log('  ' + (markerFails.length ? 'FAILED: ' + markerFails.join('; ') :
  'the marker is the mark\'s own outline: caps at the cross\'s ends, a circle around the round mark'));

/* ---------- the evaluation bar grows out of the middle, in the colour of the side that is ahead ----------
   The scale beside it runs from -90M to +90M with its zero in the middle, so a bar filled from the
   left edge reads a level position as half X, and one colour cannot say which side is ahead at all.
   What is checked here is the shape of the thing: each half is anchored at the middle and grows
   outwards, never both at once, in that side's own colour, never past the bar's own ends, and which
   half has grown agrees with the number printed next to it. A real line is played on a fresh board in
   "2 Players" mode - an open three for X against two for O, then O raised to a four with one end
   against the edge of the board - because it is a line whose lead changes hands and the bar has to
   follow it. Read from the laid-out boxes, not from the style text: the anchor at the middle is the
   part that was asked for. */
await evaluate("document.getElementById('newBtn').click(); 'a fresh board'");
await sleep(500);
const barLook = async () => JSON.parse(await evaluate(`(function(){
  var bar = document.querySelector('.evalbar').getBoundingClientRect();
  var middle = bar.left + bar.width / 2;
  function halfOf(id) {
    var r = document.getElementById(id).getBoundingClientRect();
    var at = id === 'evalX' ? r.left : r.right;          // the end of it that must not move off the middle
    return { w: Math.round(r.width), offMiddle: Math.round(Math.abs(at - middle)),
      past: Math.round(Math.max(0, id === 'evalX' ? r.right - bar.right : bar.left - r.left)) };
  }
  return JSON.stringify({ bar: Math.round(bar.width), x: halfOf('evalX'), o: halfOf('evalO'),
    num: document.getElementById('evalNum').textContent });
})()`));
const numValue = (s) => {
  const v = parseFloat(String(s).replace('M', 'e6').replace('k', 'e3'));
  return Number.isFinite(v) ? v : NaN;
};
const barFails = [];
const barSamples = [];
const sampleBar = async (what) => {
  await sleep(420);                       // the width is animated over a quarter second
  const s = await barLook();
  const v = numValue(s.num), side = v > 0 ? 'X' : v < 0 ? 'O' : 'level';
  const grown = s.x.w > 1 ? 'X' : s.o.w > 1 ? 'O' : 'none';
  barSamples.push({ what, v, side, grown, s });
  if (s.x.w > 1 && s.o.w > 1) barFails.push(what + ': both halves are filled at once');
  if (side !== 'level' && grown !== side) barFails.push(what + ': the bar is on the ' + grown + ' side while the number beside it says ' + s.num);
  if (side === 'level' && grown !== 'none') barFails.push(what + ': the bar grew ' + grown + ' while the position is level');
  if (s.x.w > 1 && s.x.offMiddle > 1) barFails.push(what + ': the X half starts ' + s.x.offMiddle + ' px away from the middle');
  if (s.o.w > 1 && s.o.offMiddle > 1) barFails.push(what + ': the O half starts ' + s.o.offMiddle + ' px away from the middle');
  if (s.x.w > s.bar / 2 + 1 || s.o.w > s.bar / 2 + 1) barFails.push(what + ': one half is longer than the bar it belongs to');
  if (s.x.past > 0 || s.o.past > 0) barFails.push(what + ': the fill stands past the end of the bar');
  console.log('  ' + what + ': number ' + s.num + ' (' + side + '), grown: ' + grown +
    ' - X half ' + s.x.w + 'px from the middle, O half ' + s.o.w + 'px');
};
// one line, played by hand so the lead is known instead of guessed
const barLine = [[2, 4, 'X'], [10, 1, 'O'], [3, 4, 'X'], [11, 1, 'O'], [4, 4, 'X'],
  [12, 1, 'O'], [1, 10, 'X'], [9, 1, 'O'], [4, 10, 'X'], [10, 2, 'O'], [7, 12, 'X'], [11, 2, 'O']];
for (let i = 0; i < barLine.length; i++) {
  await clickCell([barLine[i][0], barLine[i][1]]);
  await sleep(140);
  if (i === 4) await sampleBar('after X has an open three and O only a two');
  if (i === 9) await sampleBar('after O has raised a four against the edge');
  if (i === 11) await sampleBar('with O a move further ahead than before');
}
const leanedX = barSamples.filter((s) => s.grown === 'X').length;
const leanedO = barSamples.filter((s) => s.grown === 'O').length;
if (!leanedX || !leanedO) barFails.push('the bar never showed both sides leading (X ' + leanedX + ', O ' + leanedO + ')');
await shot('board-eval-bar.png');
console.log('  ' + (barFails.length ? 'FAILED: ' + barFails.join('; ') :
  'the bar grows out of the middle towards whichever side is ahead, in that side\'s colour'));

/* ---------- remembered settings, measured on the shipped file with a real reload ----------
   The values are put in through the real controls, then the page is left and come back to,
   because "remembered for new sessions" is only true if a new document asks for them again.
   The shipped match5.html is used here, not the probe page: the probe sets levels from the URL
   hash, which would hide what the page restored by itself. */
await evaluate("var s=document.getElementById('sizeSel'); s.value='31'; s.dispatchEvent(new Event('change',{bubbles:true})); 'size 31'");
await sleep(1200);
await evaluate("var s=document.getElementById('lvl1Sel'); s.value='expert'; s.dispatchEvent(new Event('change',{bubbles:true})); 'level expert'");
await sleep(600);
// a checkbox is one bit, and it is a setting like any other: turned off here, it has to be off there
await evaluate("var c=document.getElementById('soundChk'); c.checked=false; c.dispatchEvent(new Event('change',{bubbles:true})); 'sound off'");
await sleep(600);
console.log('what the page wrote down: ' + await evaluate("localStorage.getItem('match5.prefs.v1')"));
await send('Page.navigate', { url: 'about:blank' });
await sleep(500);
await send('Page.navigate', { url: fileUrl('match5.html') });
await sleep(2000);
const restoredPrefs = await evaluate(
  "(function(){return JSON.stringify({size:document.getElementById('sizeSel').value," +
  "level:document.getElementById('lvl1Sel').value,theme:document.documentElement.getAttribute('data-theme')," +
  "p1:getComputedStyle(document.documentElement).getPropertyValue('--p1').trim()," +
  "stoneButtonOn:(document.querySelector('#themeSeg button[data-theme=\\'paper\\']')||{}).classList.contains('on')," +
  "soundChk:document.getElementById('soundChk').checked," +
  "movesAtStart:document.getElementById('stMoves').textContent," +
  "logEmpty:/Nothing decided yet/.test(document.getElementById('logList').textContent)});})()");
console.log('what a new session puts back: ' + restoredPrefs);
console.log('and the board it drew: ' + await boardLook());
await shot('board-remembered.png');

// a value that is not one of the choices any more has to be dropped, not followed
await evaluate("localStorage.setItem('match5.prefs.v1','{not json'); 'corrupt'");
await send('Page.navigate', { url: 'about:blank' });
await sleep(400);
await send('Page.navigate', { url: fileUrl('match5.html') });
await sleep(2000);
const corruptPrefs = await evaluate(
  "(function(){return JSON.stringify({size:document.getElementById('sizeSel').value," +
  "level:document.getElementById('lvl1Sel').value,theme:document.documentElement.getAttribute('data-theme')||'slate'," +
  "soundChk:document.getElementById('soundChk').checked," +
  "entry:localStorage.getItem('match5.prefs.v1')});})()");
console.log('a corrupt entry, and the page that survives it: ' + corruptPrefs);
const prefsFails = [];
const back = JSON.parse(restoredPrefs), afterCorrupt = JSON.parse(corruptPrefs);
if (back.soundChk !== false) {
  prefsFails.push('the sound switch came back ' + back.soundChk + ' after being turned off and the page reloaded');
}
if (afterCorrupt.soundChk !== true) {
  prefsFails.push('a corrupt entry left the sound switch ' + afterCorrupt.soundChk + ' instead of the shipped default');
}

console.log('js errors: ' + (errors.length ? errors.join(' | ') : 'none'));
/* The reports above describe what they measured and leave the reading to whoever runs them. Three
   things are plain enough to be wrong that they carry an exit code: the shape of the marker for the
   last move, which way the position bar grew, and whether the sound switch came back as it was left. */
if (markerFails.length || barFails.length || prefsFails.length || errors.length) {
  console.log('FAILED: ' + [...markerFails, ...barFails, ...prefsFails,
    errors.length ? 'the page logged console errors' : null].filter(Boolean).join('; '));
  process.exitCode = 1;
}
ws.close();
