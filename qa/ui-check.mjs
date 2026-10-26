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

/* ---------- remembered settings, measured on the shipped file with a real reload ----------
   The values are put in through the real controls, then the page is left and come back to,
   because "remembered for new sessions" is only true if a new document asks for them again.
   The shipped match5.html is used here, not the probe page: the probe sets levels from the URL
   hash, which would hide what the page restored by itself. */
await evaluate("var s=document.getElementById('sizeSel'); s.value='31'; s.dispatchEvent(new Event('change',{bubbles:true})); 'size 31'");
await sleep(1200);
await evaluate("var s=document.getElementById('lvl1Sel'); s.value='expert'; s.dispatchEvent(new Event('change',{bubbles:true})); 'level expert'");
await sleep(600);
console.log('what the page wrote down: ' + await evaluate("localStorage.getItem('match5.prefs.v1')"));
await send('Page.navigate', { url: 'about:blank' });
await sleep(500);
await send('Page.navigate', { url: fileUrl('match5.html') });
await sleep(2000);
console.log('what a new session puts back: ' + await evaluate(
  "(function(){return JSON.stringify({size:document.getElementById('sizeSel').value," +
  "level:document.getElementById('lvl1Sel').value,theme:document.documentElement.getAttribute('data-theme')," +
  "p1:getComputedStyle(document.documentElement).getPropertyValue('--p1').trim()," +
  "stoneButtonOn:(document.querySelector('#themeSeg button[data-theme=\\'paper\\']')||{}).classList.contains('on')," +
  "movesAtStart:document.getElementById('stMoves').textContent," +
  "logEmpty:/Nothing decided yet/.test(document.getElementById('logList').textContent)});})()"));
console.log('and the board it drew: ' + await boardLook());
await shot('board-remembered.png');

// a value that is not one of the choices any more has to be dropped, not followed
await evaluate("localStorage.setItem('match5.prefs.v1','{not json'); 'corrupt'");
await send('Page.navigate', { url: 'about:blank' });
await sleep(400);
await send('Page.navigate', { url: fileUrl('match5.html') });
await sleep(2000);
console.log('a corrupt entry, and the page that survives it: ' + await evaluate(
  "(function(){return JSON.stringify({size:document.getElementById('sizeSel').value," +
  "level:document.getElementById('lvl1Sel').value,theme:document.documentElement.getAttribute('data-theme')||'slate'," +
  "entry:localStorage.getItem('match5.prefs.v1')});})()"));

console.log('js errors: ' + (errors.length ? errors.join(' | ') : 'none'));
ws.close();
