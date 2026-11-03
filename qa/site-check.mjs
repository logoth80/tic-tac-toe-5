/* Can the game be played from the address in the README, or only from the disk?
   (needs the QA browser on :9333 - see README, "Browser QA" - and a network route to the site)

   A page that works from a folder can still fail once it is served: the address may end without the
   slash that relative paths depend on, a build step may rewrite the bytes, a file may be left out of
   the deploy, and a page that is served but not *run* proves none of the things a player notices. So
   this asks three questions, in the order where a failure is most useful:

     the same thing: the bytes the site serves are the bytes of index.html, hash for hash. This also
       catches a site quietly serving an older build, which is the same fault as a hand-kept copy of
       the page; when they differ the first differing byte is shown, because the interesting part of a
       mangled HTML file is what came in place of the bytes that went missing;
     all the parts: every clip the page asks for is served too, at the address a page under a subpath
       resolves to, and each is the file that is in the repository. A single-file page is allowed to
       lose its sounds and stay playable; a site that never had them is a different thing and should
       say so out loud;
     it plays there: the deployed page is opened in a browser from the address *without* the trailing
       slash - the one a person or a link is most likely to get wrong - and marks are drawn there with
       real clicks. The moves have to reach the game's own count, the pencil has to be asked for and
       start, and the resource records have to show the clips arriving from the site rather than from
       the disk, which is the part that a file:// run cannot show at all.

   What it cannot show, and does not claim: that a person has seen it, and what happens on a phone or
   a browser this machine does not have. It is also the one gate in this repository that needs the
   network: when the site cannot be reached at all the run says SKIP and exits 0, because "no route"
   is not evidence about the page. A site that answers with the wrong bytes, an error status, or a page
   that will not play fails, and carries an exit code. When the first question is answered "no", the
   third is not asked: drawing marks on a page that is not this file would say nothing about this file,
   and the run says that in words rather than crashing on it. The first run of this script found exactly
   that case - before this change the site's root served the repository's README rendered as a page,
   63,065 bytes of HTML that is not the game - and said so in bytes.

     node qa/site-check.mjs                     # the address in the README
     node qa/site-check.mjs http://127.0.0.1:8080/   # or a local stand-in for it
*/
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const SITE = (process.argv[2] || 'https://logoth80.github.io/tic-tac-toe-5/').replace(/\/?$/, '/');
const CDP = 'http://127.0.0.1:9333';
const CLIPS = ['marker-x1', 'marker-x2', 'marker-x3', 'marker-o1', 'marker-o2'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let checks = 0, fails = 0;
const ok = (cond, what) => { checks++; if (cond) console.log('  ok   ' + what); else { fails++; console.log('  FAIL ' + what); } };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hex = (b, at, n) => Buffer.from(b.slice(Math.max(0, at - n), at + n)).toString('hex').replace(/(..)/g, '$1 ').trim();

/* ---------------------------------------------------------------- one: the same bytes */
const local = fs.readFileSync(path.join(ROOT, 'index.html'));
console.log('index.html on this disk: ' + local.length + ' bytes, sha256 ' + sha(local));

let served = null, reached = null, head = null;
try {
  const r = await fetch(SITE, { redirect: 'follow', headers: { 'Cache-Control': 'no-cache' } });
  head = { status: r.status, finalUrl: r.url, type: r.headers.get('content-type'),
    length: r.headers.get('content-length'), age: r.headers.get('age'),
    lastModified: r.headers.get('last-modified'), cache: r.headers.get('cache-control') };
  served = Buffer.from(await r.arrayBuffer());
  reached = r.url;
} catch (e) {
  console.log('\nSKIP: the site could not be reached from this machine: ' + (e.cause?.code || e.message));
  console.log('nothing is claimed about the page either way.');
  process.exit(0);
}
console.log('the site answered ' + head.status + ' at ' + reached + '  (' + (head.type || 'no content-type') +
  ', ' + served.length + ' bytes' + (head.age !== null ? ', served from cache ' + head.age + ' s old' : '') +
  (head.lastModified ? ', last-modified ' + head.lastModified : '') + ')');
ok(head.status === 200, 'the address answers 200 rather than an error');
ok(/text\/html/.test(head.type || ''), 'and calls it HTML, which is what makes a browser render it instead of offering to save it');

/* A push and a deploy are not the same instant, so a mismatch right after pushing is expected and is
   worth waiting a little for; a mismatch that survives the wait is the fault this is here for. */
for (let tryNo = 1; sha(served) !== sha(local) && tryNo <= 4; tryNo++) {
  console.log('  the site is on different bytes than this disk; GitHub may still be building (' + tryNo + '/4), waiting 20 s');
  await sleep(20000);
  served = Buffer.from(await (await fetch(SITE, { headers: { 'Cache-Control': 'no-cache' } })).arrayBuffer());
}
const sameBytes = sha(served) === sha(local);
if (sameBytes) {
  ok(true, 'the served page is this file, byte for byte (sha256 matches, ' + served.length + ' bytes)');
} else {
  const at = (() => { for (let i = 0; i < Math.min(served.length, local.length); i++) if (served[i] !== local[i]) return i; return -1; })();
  console.log('  first difference at byte ' + at + (at < 0 ? ' (one is a prefix of the other)' : '') +
    '\n    on disk: ' + hex(local, at, 24) + '\n    served : ' + hex(served, at, 24));
  ok(false, 'the served page differs from the file (' + served.length + ' bytes against ' + local.length +
    '; ' + sha(served).slice(0, 12) + ' against ' + sha(local).slice(0, 12) + ')');
}

/* ---------------------------------------------------------------- two: all the parts */
const servedClips = [];
for (const name of CLIPS) {
  const url = SITE + 'sounds/' + name + '.mp3';
  let r, buf = null;
  try { r = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } }); buf = Buffer.from(await r.arrayBuffer()); }
  catch (e) { r = { status: 'no answer: ' + (e.cause?.code || e.message) }; }
  const file = fs.readFileSync(path.join(ROOT, 'sounds', name + '.mp3'));
  const same = buf && sha(buf) === sha(file);
  servedClips.push({ name, status: r.status, bytes: buf ? buf.length : 0, same, url });
  console.log('  ' + name + '.mp3  ' + String(r.status).padEnd(4) + ' ' + String(buf ? buf.length : 0).padStart(6) +
    ' bytes  ' + (same ? 'the same bytes as the repository' : '*** not the file in the repository ***') + '\n      ' + url);
}
ok(servedClips.every((c) => c.status === 200 && c.same),
  'every clip the page may ask for is served, at the address a page under a subpath asks for, and is the file it is here');

/* ---------------------------------------------------------------- three: it plays there */
if (!sameBytes) {
  console.log('\nthe browser is not pointed at the address: drawing marks on a page that is not this file' +
    ' would say nothing about this file. The two parts above are still reported, because they say what is' +
    ' actually being served.');
  console.log('\nFAILED ' + fails + ' of ' + checks + ' checks about ' + SITE);
  process.exit(1);
}

/* A read that comes back empty is reported as the check that failed rather than thrown as a stack
   trace, because the interesting case is a page that answered with HTML and is not the game. */
const jsonEval = async (expression, what) => {
  const text = await evaluate(expression);
  try { return JSON.parse(text); }
  catch (e) { ok(false, what + ': the page did not answer that (' + (text === undefined ? 'no answer' : text) + ')'); return null; }
};

const list = await (await fetch(CDP + '/json/list')).json();
const target = list.find((t) => t.type === 'page');
if (!target) throw new Error('no page target on ' + CDP + ': start the QA browser (README, Browser QA)');
const ws = new WebSocket(target.webSocketDebuggerUrl);
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

/* The ending is written once, because two of the guards below need it: a page that answers with HTML
   and is not the game is a result, not a crash. */
const finish = () => {
  console.log('\njs errors: ' + (errors.length ? errors.join(' | ') : 'none'));
  ok(errors.length === 0, 'nothing was logged to the console as an error');
  console.log(fails ? '\nFAILED ' + fails + ' of ' + checks + ' checks about ' + SITE
    : '\nSITE OK — ' + checks + ' checks: ' + SITE + ' serves this file and plays from it');
  ws.close();
  process.exit(fails ? 1 : 0);
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1040, deviceScaleFactor: 1, mobile: false });

/* The same instrument qa/sound-check.mjs uses: it records what the page asked for and what came of
   the play the page asked for, and it plays nothing of its own. */
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
` });

/* Deliberately the address without the trailing slash: relative paths are resolved against the page's
   own address, so this is the case where a page under a subpath can lose its sounds. */
const noSlash = SITE.replace(/\/$/, '');
console.log('\nopening ' + noSlash + ' (no trailing slash) in the browser');
await send('Page.navigate', { url: noSlash });
await sleep(2500);
const where = await jsonEval("JSON.stringify({origin:location.origin,path:location.pathname,slash:location.href.slice(-1)==='/'})",
  'where the browser ended up after the address without the trailing slash');
if (!where) finish();
console.log('  the browser ended up at ' + where.origin + where.path + '  (trailing slash: ' + where.slash + ')');
ok(where.origin === new URL(SITE).origin, 'the page is running from the site, not from a file or a cache of one');
await evaluate("localStorage.removeItem('match5.prefs.v1'); 'cleared'");
await send('Page.navigate', { url: noSlash });
await sleep(2500);
await evaluate("(function(){document.querySelector('#modeSeg button[data-mode=\"pvp\"]').click();" +
  "var s=document.getElementById('sizeSel');s.value='13';s.dispatchEvent(new Event('change',{bubbles:true}));return 'set';})()");
await sleep(700);

/* Aim by measuring the grid the page drew, as the other browser gates do - the page's padding depends
   on the board size and a test should not have to know that. */
await evaluate(`window.__geo = function () {
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
};`);
const geo = await jsonEval('window.__geo()', 'the grid the site drew');
if (!geo || !geo.pitch) {
  ok(false, 'no board was found to aim at, so no mark could be placed honestly');
  finish();
}
console.log('  drawn on a ' + geo.W + 'x' + geo.H + ' canvas: ' + geo.lines + ' grid lines, cell ' + geo.pitch + ' px');
ok(geo.pitch > 0 && geo.lines >= 13, 'the board is really drawn there, so the aim is not a guess');

const place = async (col, row) => {
  const at = JSON.parse(await evaluate("(function(){var cv=document.getElementById('board'),r=cv.getBoundingClientRect();" +
    "var x=r.left+(" + geo.pad + "+(" + col + "+0.5)*" + geo.pitch + ")*(r.width/cv.width);" +
    "var y=r.top+(" + geo.pad + "+(" + row + "+0.5)*" + geo.pitch + ")*(r.height/cv.height);" +
    "return JSON.stringify({x:Math.round(x),y:Math.round(y)});})()"));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
  await sleep(40);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1 });
  await sleep(220);
};
const PLAY = [[6, 6], [7, 6], [8, 6], [6, 7], [9, 9]];
console.log('drawing ' + PLAY.length + ' marks with real clicks on the live site');
for (const [c, r] of PLAY) await place(c, r);
const moves = await evaluate("document.getElementById('stMoves').textContent");
const asked = (await jsonEval('JSON.stringify(window.__audio)', 'the clips the page asked for')) || [];
asked.forEach((a, i) => console.log('   #' + (i + 1) + '  ' + a.url.replace(where.origin, '') + '  ' + a.outcome));
console.log('  the game says it has ' + moves + ' moves on the board; it asked for ' + asked.length + ' clips');
ok(String(moves).trim() === String(PLAY.length), 'the clicks reached the game: it counts ' + PLAY.length + ' moves of its own');
ok(asked.length === PLAY.length && asked.every((a) => a.played),
  'the pencil plays there too (' + asked.filter((a) => a.played).length + '/' + asked.length + ' started)');
const fromNetwork = (await jsonEval("JSON.stringify(performance.getEntriesByType('resource')" +
  ".filter(function(e){return /sounds\\//.test(e.name);})" +
  ".map(function(e){return {name:e.name.replace(location.origin,''),type:e.initiatorType,bytes:e.transferSize," +
  "ms:Math.round(e.duration),from:e.name.replace(/^(https?:\\/\\/[^/]+\\/[^/]+)\\.*/, '$1')};}))",
  'the browser\'s own record of the sound requests')) || [];
fromNetwork.forEach((e) => console.log('   resource: ' + e.name + '  initiator ' + e.type + '  ' + e.bytes +
  ' bytes transferred  ' + e.ms + ' ms  path root ' + e.from));
const arriving = fromNetwork.filter((e) => /marker-[xo]\d\.mp3$/.test(e.name));
console.log('  ' + fromNetwork.length + ' sound requests on the record, ' + arriving.length +
  ' of them for a clip, ' + arriving.filter((e) => e.bytes > 0).length + ' fetched rather than read from a cache');
ok(arriving.length >= 1, 'the page asked the network for its clips, which a page opened from the disk cannot show');
ok(arriving.every((e) => e.from === '/' + new URL(SITE).pathname.split('/').filter(Boolean)[0]),
  'and asked under this subpath, not at the root of the site - which is what the missing slash would break');

/* Leave nothing remembered, so a person opening the real site afterwards does not find a board size a
   test picked. */
await evaluate("localStorage.removeItem('match5.prefs.v1'); 'cleaned'");
finish();
