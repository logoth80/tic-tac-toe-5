/* Does the pencil actually go with the mark?
   (needs the QA browser on :9333 - see README, "Browser QA")

   A sound that is wired up wrong is either silent or wrong-sided, and neither shows in a screenshot,
   so this asks the browser what it really did. The page carries no hook for sound and none is added
   for the test: instead the test wraps window.Audio in a new document before the page's own script
   runs, which is a measuring instrument in the harness and not a change to the thing measured. Every
   clip the page asks for, and what happened when it tried to play it, is then on the record.

     nothing asked for until a mark is drawn - the page must not reach for audio when it is only
       being looked at, which is what keeps the five clips from being a cost of opening a page;
     one clip per mark, and the right family: an X may only ever pick an x clip, an O only an o clip.
       Which one is picked is random, so this checks the family and that the choice is not fixed, and
       prints the tally rather than pretending a handful of draws proves a one-in-three share;
     it really played: play() resolved. If it was refused, the reason is printed - a refusal is the
       browser's autoplay rule, not a broken page, and the page is written to stay silent instead of
       throwing in exactly that case, which is why the run must also be free of JS errors;
     the switch works: off means nothing is asked for, on means they come back;
     undo is silent: taking a move back did not un-draw a pencil, and must not play one;
     the files themselves: decoded in the page and measured. A clip that is silent, or a length that
       disagrees with what tests/mp3-info.mjs reads out of the frame headers, is a broken asset - two
       independent readers agreeing is what makes the number real.

   The clicks are dispatched through CDP's Input domain, so they arrive as real user input, which is
   also what gives the page the user activation browsers require before sound may start. The opposite
   case - a move with no gesture behind it, as when a search answers on a page nobody has touched - is
   already exercised by qa/cdp-drive.mjs and qa/ui-check.mjs, which load the page with #hard and #fast
   and let the engine play first; they must stay, and are, free of JS errors.
*/
import path from 'node:path';
import { readMp3 } from '../tests/mp3-info.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const base = 'http://127.0.0.1:9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let checks = 0, fails = 0;
const ok = (cond, what) => { checks++; if (cond) console.log('  ok   ' + what); else { fails++; console.log('  FAIL ' + what); } };

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

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1040, deviceScaleFactor: 1, mobile: false });

/* The instrument. Put in the harness, before the page's script runs, so the page under test is the
   page that ships. It records the file asked for and the outcome of the play the page itself asked
   for - it does not play anything of its own. */
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__audio = [];
  var RealAudio = window.Audio;
  window.Audio = function (url) {
    var el = new RealAudio(url);
    var rec = { url: String(url), played: false, outcome: 'play was not called' };
    window.__audio.push(rec);
    var play = el.play.bind(el);
    el.play = function () {
      return play().then(function () { rec.played = true; rec.outcome = 'started'; },
                         function (e) { rec.outcome = 'refused: ' + (e && e.name); });
    };
    return el;
  };
  window.__audioCount = function () { return window.__audio.length; };
  window.__audioList = function () { return JSON.stringify(window.__audio); };
` });

/* What a previous run left behind lives in the file's own origin, so it has to be cleared there and
   the page loaded again: clearing it in about:blank would clear nothing. */
await send('Page.navigate', { url: fileUrl('index.html') });
await sleep(1000);
console.log('  a previous run had kept: ' + await evaluate("JSON.stringify(JSON.parse(localStorage.getItem('match5.prefs.v1')||'null'))"));
await evaluate("localStorage.removeItem('match5.prefs.v1'); 'cleared'");
await send('Page.reload', {});
await sleep(1400);
await evaluate("(function(){document.querySelector('#modeSeg button[data-mode=\"pvp\"]').click();" +
  "var s=document.getElementById('sizeSel');s.value='13';s.dispatchEvent(new Event('change',{bubbles:true}));return 'set';})()");
await sleep(700);

const picks = async () => JSON.parse(await evaluate('window.__audioList()'));
const clipOf = (u) => String(u).split(/[\\/]/).pop();

console.log('page opened, no mark drawn');
console.log('  clips asked for: ' + (await picks()).length +
  '   (browser resource records, which file:// pages often do not make: ' +
  await evaluate("performance.getEntriesByType('resource').length") + ')');
ok((await picks()).length === 0, 'opening the page asks for no audio');
console.log('  the switch is on: ' + await evaluate("document.getElementById('soundChk').checked") +
  '  labelled: ' + JSON.stringify(await evaluate("document.querySelector('label.chk').textContent.replace(/\\s+/g,' ').trim()")));
ok(await evaluate("document.getElementById('soundChk').checked === true"), 'the sound switch starts on');

/* Aim at the middle of a square. The cell pitch and the padding are measured from the grid lines the
   page just drew rather than recomputed from the page's own arithmetic: the page's padding depends on
   the board size, and a test should not have to know that to aim where the marks are. */
const GEO = `window.__geo = function () {
  var cv = document.getElementById('board'), c = cv.getContext('2d');
  var W = cv.width, H = cv.height, d = c.getImageData(0, 0, W, H).data;
  var want = (getComputedStyle(document.documentElement).getPropertyValue('--grid') || '').trim();
  var m = want.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  var g = m ? [parseInt(m[1],16),parseInt(m[2],16),parseInt(m[3],16)] : [0,0,0];
  function close(p){return Math.max(Math.abs(p[0]-g[0]),Math.abs(p[1]-g[1]),Math.abs(p[2]-g[2]))<=26;}
  var hits=[];
  for(var x=0;x<W;x++){var n=0;for(var y=8;y<H-8;y+=3){var i=(y*W+x)*4;if(close([d[i],d[i+1],d[i+2]]))n++;}if(n>(H/3)*0.5)hits.push(x);}
  var lines=[];for(var i=0;i<hits.length;i++)if(!lines.length||hits[i]-lines[lines.length-1]>2)lines.push(hits[i]);
  var gap=[];for(var i=1;i<lines.length;i++)gap.push(lines[i]-lines[i-1]);gap.sort(function(a,b){return a-b;});
  return JSON.stringify({W:W,H:H,pitch:gap.length?gap[gap.length>>1]:0,pad:lines.length?lines[0]:0,lines:lines.length});
};`;
await evaluate(GEO);
const geo = JSON.parse(await evaluate('window.__geo()'));
console.log('  the board is drawn on a ' + geo.W + 'x' + geo.H + ' canvas: ' + geo.lines +
  ' grid lines, cell ' + geo.pitch + ' px, first line at ' + geo.pad);
ok(geo.pitch > 0 && geo.lines >= 13, 'the grid could be measured, so the aim is not a guess');

const cellToClient = async (col, row) => JSON.parse(await evaluate(
  "(function(){var cv=document.getElementById('board'),r=cv.getBoundingClientRect();" +
  "var x=r.left+(" + geo.pad + "+(" + col + "+0.5)*" + geo.pitch + ")*(r.width/cv.width);" +
  "var y=r.top+(" + geo.pad + "+(" + row + "+0.5)*" + geo.pitch + ")*(r.height/cv.height);" +
  "return JSON.stringify({x:Math.round(x),y:Math.round(y)});})()"));

/* A mark is drawn with real input, which is also what allows the sound that follows it. */
const place = async (col, row) => {
  const at = await cellToClient(col, row);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
  await sleep(40);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1 });
  await sleep(160);
};

const PLAY = [[6, 6], [7, 6], [8, 6], [6, 7], [6, 8], [9, 9], [10, 7], [7, 10], [11, 11], [4, 4], [5, 6], [10, 10]];
console.log('\ndrawing ' + PLAY.length + ' marks with real clicks');
for (const [c, r] of PLAY) await place(c, r);
const rows = await picks();
console.log('  moves on the board: ' + await evaluate("document.getElementById('stMoves').textContent") +
  '   clips asked for: ' + rows.length);
rows.forEach((r, i) => console.log('   #' + String(i + 1).padStart(2) + '  ' + clipOf(r.url).padEnd(15) + r.outcome));
ok(rows.length === PLAY.length, 'one clip per mark drawn, no more and no fewer');
const sides = rows.map((r) => (/-x\d/.test(r.url) ? 'x' : (/-o\d/.test(r.url) ? 'o' : '?')));
const expected = PLAY.map((_, i) => (i % 2 === 0 ? 'x' : 'o'));
console.log('  whose mark vs what was asked for: ' + sides.join(' ') + '   (expected ' + expected.join(' ') + ')');
ok(sides.join('') === expected.join(''), 'an X only ever asks for an x clip and an O only ever for an o clip');
const xs = rows.filter((r) => /-x\d/.test(r.url)).map((r) => clipOf(r.url)), os = rows.filter((r) => /-o\d/.test(r.url)).map((r) => clipOf(r.url));
const tally = (a) => JSON.stringify(a.reduce((m, n) => (m[n] = (m[n] || 0) + 1, m), {}));
console.log('  tally   x: ' + tally(xs) + '   o: ' + tally(os) +
  '   (six draws each; this cannot show a one-in-three share, only that the pick is not fixed)');
ok(new Set(xs).size >= 2 && new Set(os).size >= 2,
  'the clip is not always the same one (x used ' + new Set(xs).size + ' of 3, o used ' + new Set(os).size + ' of 2)');
const played = rows.filter((r) => r.played).length, refused = [...new Set(rows.map((r) => r.outcome).filter((o) => o !== 'started'))];
console.log('  play resolved for ' + played + '/' + rows.length + (refused.length ? '   refused: ' + refused.join(', ') : ''));
console.log('  the browser says the page has had user activation: ' +
  await evaluate("(navigator.userActivation ? navigator.userActivation.hasBeenActive : 'not reported by this browser')"));
ok(rows.length > 0 && played === rows.length, 'the clip the page asked for actually started playing' +
  (refused.length ? ' - it was refused: ' + refused.join(', ') : ''));

console.log('\nturning the sound off, then drawing two more marks');
await evaluate("document.getElementById('soundChk').click(); 'clicked'");
await sleep(200);
const before = (await picks()).length;
await place(3, 3); await place(4, 9);
const after = await picks();
console.log('  asked for: ' + before + ' -> ' + after.length + ' while two marks were drawn');
ok(after.length === before, 'with the switch off, drawing marks asks for nothing at all');

console.log('\nundo, then switching it back on');
await evaluate("document.getElementById('undoBtn').click(); 'undo'");
await sleep(300);
ok((await picks()).length === after.length, 'undoing a move asks for nothing: taking it back did not draw it again');
const kept = async () => await evaluate("JSON.stringify({sound:JSON.parse(localStorage.getItem('match5.prefs.v1')||'{}').sound})");
console.log('  what the page kept about the switch: ' + await kept());
await evaluate("document.getElementById('soundChk').click(); 'on again'");
await sleep(200);
const back = (await picks()).length;
await place(2, 2);   // a square nothing has marked in this run, so a refusal to play cannot be blamed on it
ok((await picks()).length === back + 1, 'with the switch back on, a mark asks for its clip again');
console.log('  and the page now keeps: ' + await kept());
ok(await evaluate("JSON.parse(localStorage.getItem('match5.prefs.v1')||'{}').sound === true"),
  'the switch stays where it was left');
await evaluate("document.getElementById('soundChk').click(); 'off'");
await sleep(200);
console.log('  after turning it off the page keeps: ' + await kept());
await send('Page.reload', {});
await sleep(1200);
ok(await evaluate("document.getElementById('soundChk').checked") === false,
  'a page opened again has the switch where it was left - off');
ok((await picks()).length === 0, 'and the reopened page still asks for nothing until a mark is drawn');

/* The assets themselves: decoded here, and the same files read from their frame headers by
   tests/mp3-info.mjs. Two independent readers agreeing on a length is what makes that number real. */
console.log('\nthe five clips, decoded in the page and read from their headers by Node');
const decoded = await evaluate("(function(){var files=['marker-x1','marker-x2','marker-x3','marker-o1','marker-o2'];" +
  "return Promise.all(files.map(function(f){return fetch('sounds/'+f+'.mp3').then(function(r){return r.arrayBuffer();})" +
  ".then(function(b){return new (window.AudioContext||window.webkitAudioContext)().decodeAudioData(b);})" +
  ".then(function(a){var ch=a.getChannelData(0),peak=0,sq=0;" +
  "for(var i=0;i<ch.length;i++){var v=Math.abs(ch[i]);if(v>peak)peak=v;sq+=ch[i]*ch[i];}" +
  "var tail=0;for(var i=ch.length-1;i>=0;i--){if(Math.abs(ch[i])>0.01){tail=i;break;}}" +
  "return {name:a.name||f,sampleRate:a.sampleRate,length:a.length,duration:a.duration," +
  "peak:+peak.toFixed(3),rms:+Math.sqrt(sq/ch.length).toFixed(4)," +
  "audibleMs:Math.round(tail/a.sampleRate*1000)};}).catch(function(e){return {name:f,error:String(e)};});}))" +
  ".then(function(a){return JSON.stringify(a);});})()", true);
const clips = JSON.parse(decoded);
let silent = 0, bad = 0;
const offsets = [];
for (const c of clips) {
  if (c.error) { bad++; console.log('  ' + c.name + '  DECODE FAILED: ' + c.error); continue; }
  const head = readMp3(path.join(ROOT, 'sounds', c.name + '.mp3'));
  /* The two readers count different things and this is the part worth writing down: adding up frame
     headers gives the time the bits describe, decoding gives the time the samples fill, and the gap
     between them is the encoder delay and the padding at the end of the last frame. It comes out the
     same for all five files, which is what says it is a property of the encoding rather than of a
     file. A disagreement that is constant can be accounted for; one that wanders would be a bug. */
  const offset = head.seconds - c.duration;
  offsets.push(offset);
  if (c.peak < 0.05) silent++;
  console.log('  ' + c.name + '  ' + c.duration.toFixed(3) + ' s decoded, ' + head.seconds +
    ' s of frames, frames longer by ' + offset.toFixed(3) + ' s  peak ' + String(c.peak).padEnd(6) +
    ' rms ' + c.rms + '  last audible sample at ' + String(c.audibleMs).padStart(3) + ' ms of the ' +
    Math.round(c.duration * 1000) + ' ms it holds');
}
const spread = Math.max(...offsets) - Math.min(...offsets);
const peaks = clips.filter((c) => !c.error).map((c) => c.peak);
console.log('  the frame-vs-decode gap is the same for every file: ' + Math.min(...offsets).toFixed(3) +
  ' to ' + Math.max(...offsets).toFixed(3) + ' s (spread ' + spread.toFixed(4) +
  ' s) - two MPEG-2 Layer III frames of encoder delay and padding, which counting bits sees and playing samples does not');
console.log('  loudness across the five: peak ' + Math.min(...peaks) + ' to ' + Math.max(...peaks) +
  ' (' + (20 * Math.log10(Math.max(...peaks) / Math.min(...peaks))).toFixed(1) +
  ' dB apart), rms ' + Math.min(...clips.map((c) => c.rms || 0)) + ' to ' + Math.max(...clips.map((c) => c.rms || 0)) +
  ' - a random pick between them cannot change how loud the page sounds');
ok(clips.filter((c) => !c.error).length === 5, 'all five clips decode');
ok(silent === 0, 'none of them is silent (every peak above 0.05)');
ok(bad === 0 && spread < 0.005, 'the page and the frame-header reader agree on every length once the fixed' +
  ' encoder delay is accounted for (spread ' + spread.toFixed(4) + ' s)');
ok(Math.max(...peaks) < 4 * Math.min(...peaks), 'no clip is far louder than the others (loudest is ' +
  (Math.max(...peaks) / Math.min(...peaks)).toFixed(2) + 'x the quietest)');

/* What the page allows between moves is a slider, so its range is read rather than assumed. */
const pace = JSON.parse(await evaluate("(function(){var s=document.getElementById('speedSel');" +
  "return JSON.stringify({fastest:+s.min,default:+s.value,slowest:+s.max});})()"));
const longest = Math.max(...clips.filter((c) => !c.error).map((c) => c.duration));
console.log('  longest clip ' + longest.toFixed(3) + ' s. The demo pace is a slider from ' + pace.fastest + ' ms (no delay at all) to ' +
  pace.slowest + ' ms, at ' + pace.default + ' ms by default: at that pace a clip lies over ' +
  Math.ceil(longest / (pace.default / 1000)) + ' other at most, and at the fastest setting they overlap freely.' +
  ' Nothing cuts a previous clip off, which is what a hand drawing quickly sounds like.');

/* Leave the browser as this test found it: a person opening the page after a QA run should not find
   the sound switched off because a test turned it off. */
await evaluate("localStorage.removeItem('match5.prefs.v1'); 'cleaned'");
console.log('\nnothing is left remembered, so the next run - or a person opening the page - starts fresh');

console.log('\njs errors: ' + (errors.length ? errors.join(' | ') : 'none'));
ok(errors.length === 0, 'nothing was logged to the console as an error');
console.log(fails ? '\nFAILED ' + fails + ' of ' + checks : '\nSOUND OK — ' + checks + ' checks');
ws.close();
process.exit(fails ? 1 : 0);
