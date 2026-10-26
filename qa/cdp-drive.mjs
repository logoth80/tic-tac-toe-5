// Drives the real page over Chrome DevTools Protocol: console/exception capture,
// real gameplay via the probe script, screenshots, and worker-target detection.
// Usage: node qa/cdp-drive.mjs   (expects headless Chrome on 127.0.0.1:9333)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const QA = path.join(ROOT, 'qa');
const PORT = 9333;
const base = `http://127.0.0.1:${PORT}`;
const fileUrl = (p, hash) => 'file:///' + path.join(QA, p).replace(/\\/g, '/') + (hash || '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const list = await (await fetch(base + '/json/list')).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target; CDP list: ' + list.map((t) => t.type).join(','));

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws failed')); });

  let idc = 0;
  const pending = new Map();
  const handlers = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else handlers.forEach((h) => h(m));
  };
  const send = (method, params = {}) => new Promise((res) => {
    const id = ++idc;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const on = (fn) => handlers.push(fn);

  const errors = [];
  on((m) => {
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      errors.push('EXCEPTION: ' + (d.exception?.description || d.text || 'unknown'));
    } else if (m.method === 'Log.entryAdded' && m.params.entry?.level === 'error') {
      errors.push('LOG: ' + m.params.entry.text + (m.params.entry.url ? ' @ ' + m.params.entry.url : ''));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push('CONSOLE: ' + (m.params.args || []).map((a) => a.value ?? a.description).join(' '));
    }
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');

  const status = async (dbg) => {
    const r = await send('Runtime.evaluate', {
      expression: "(function(){var e=document.getElementById('probeStatus');var t=document.getElementById('turnTxt');return e?e.textContent:((t?t.textContent:'no-dom') + ' scripts=' + document.scripts.length);})()",
      returnByValue: true
    });
    if (dbg) console.log('  [eval dbg] ' + JSON.stringify(r).slice(0, 400));
    if (r.result?.exceptionDetails) {
      return 'EVAL-EXCEPTION: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    }
    // Runtime.evaluate nests the RemoteObject under result.result
    const v = r.result?.result?.value ?? r.result?.value ?? '';
    return typeof v === 'string' ? v : JSON.stringify(v);
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (!r.result?.data) { console.log('  no screenshot data for ' + name); return; }
    const p = path.join(QA, name);
    fs.writeFileSync(p, Buffer.from(r.result.data, 'base64'));
    console.log('  wrote ' + path.relative(ROOT, p) + ' (' + fs.statSync(p).size.toLocaleString('en-US') + ' bytes)');
  };
  const workerSeen = new Set();
  const browserWatch = async () => {
    const v = await (await fetch(base + '/json/version')).json();
    const bws = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise((res, rej) => { bws.onopen = res; bws.onerror = () => rej(new Error('browser ws failed')); });
    let bid = 0;
    const bs = (method, params = {}) => bws.send(JSON.stringify({ id: ++bid, method, params }));
    bws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Target.targetCreated' || m.method === 'Target.attachedToTarget') {
        const t = m.params.targetInfo || {};
        if (/worker/i.test(t.type) || /^blob:|^data:/.test(t.url || '')) workerSeen.add(t.type + ' ' + (t.url || '').slice(0, 48));
      }
    };
    bs('Target.setDiscoverTargets', { discover: true });
    return bws;
  };
  const bws = await browserWatch();
  const workerTargets = () => [...workerSeen];

  const run = async (label, hash, checks) => {
    console.log('\n=== ' + label + ' ===');
    errors.length = 0;
    // hash-only changes do not reload the document, so force a fresh page each case
    await send('Page.navigate', { url: 'about:blank' });
    await sleep(400);
    await send('Page.navigate', { url: fileUrl('probe.html', hash) });
    await sleep(600);
    const seen = new Set();
    let banner = '';
    const proofKeys = new Set();   // read-outs that told the user the outcome had been proven
    const byMove = new Map();      // latest read-out seen for each move number
    const note = (t) => {
      const mm = t.match(/MOVES=(\d+)/);
      const wm = t.match(/WHY=([^|]*)/);
      const dm = t.match(/DEPTH=([^|]*)/);
      if (mm) byMove.set(+mm[1], t);
      if (wm && /proved a forced|proven:/.test(wm[1] + ' ' + (dm ? dm[1] : ''))) {
        proofKeys.add((mm ? mm[1] : '?') + '|' + (dm ? dm[1].trim() : '') + '|' + wm[1].trim());
      }
      const bm = t.match(/BANNER=([^|]*)/);
      if (bm && bm[1].trim() && bm[1].trim() !== '(hidden)') banner = bm[1].trim();
    };
    for (let i = 0; i < checks.length; i++) {
      const [waitMs, shotName] = checks[i];
      /* Poll through the wait instead of only looking at the end of each slice: once forcing
         lines got converted the games ended sooner, and the mid-game read-outs - the ones that
         say how deep and how long the engine is really thinking - were never sampled. */
      let left = waitMs;
      while (left > 0) {
        const slice = Math.min(900, left);
        await sleep(slice); left -= slice;
        note(await status(false));
      }
      const s = await status(i === 0);
      seen.add(s);
      note(s);
      if (shotName) await shot(shotName);
      if (i === checks.length - 2) console.log('  workers: ' + JSON.stringify(await workerTargets()));
    }
    [...seen].filter(Boolean).slice(-1).forEach((s) => console.log('  ' + s));
    const last = [...seen].filter(Boolean).pop() || '';
    const f = (k) => { const m = last.match(new RegExp(k + '=([^|]*)')); return m ? m[1].trim() : '-'; };
    console.log('  final: moves=' + f('MOVES') + ' | depth=' + f('DEPTH') + ' | why=' + f('WHY') +
      ' | by=' + f('BY') + ' in ' + f('DECCOL') +
      ' | workers=' + f('WORKERS') +
      ' | ink=' + ((last.match(/ink=(\d+)/) || [])[1] || '-') +
      ' | panel-over-board=' + f('OVERLAP') + ' px2 | banner=' + f('BANNER'));
    console.log('  strength menu reads: ' + f('LVL'));
    if (last && f('OVERLAP') !== '0') {
      console.log('  !! VIOLATION: the result panel covers ' + f('OVERLAP') + ' px^2 of the board');
    }
    const field = (t, k) => { const m = t.match(new RegExp(k + '=([^|]*)')); return m ? m[1].trim() : '-'; };
    const late = [...byMove].filter(([n]) => n >= 8);
    if (late.length >= 4) {
      console.log('  pacing, latest read-out per move (from move 8 on):');
      for (const [n, t] of late) {
        console.log('   ' + String(n).padStart(3) + '  ' + field(t, 'DEPTH').padEnd(24) +
          field(t, 'NODES').padEnd(20) + field(t, 'TIME').padEnd(20) + field(t, 'WORKERS').padEnd(32) + field(t, 'WHY'));
      }
      const heavy = late.filter(([, t]) => {
        const v = parseInt((field(t, 'NODES').match(/[\d,]+/) || ['0'])[0].replace(/,/g, ''), 10);
        return v > 2000;
      }).length;
      console.log('  late read-outs backed by more than 2,000 nodes: ' + heavy + ' of ' + late.length);
      /* The level promises cores as well as time: a move answered by a pool must say so, and a
         move that was not (a pinned depth, a forced tactic, a one-core level) must not. */
      const split = late.filter(([, t]) => /^\d+ workers/.test(field(t, 'WORKERS')));
      const solo = late.filter(([, t]) => /^1 · one core/.test(field(t, 'WORKERS')));
      console.log('  late read-outs answered across a pool: ' + split.length + ' of ' + late.length +
        ' (single core: ' + solo.length + ')' +
        (split.length ? '  e.g. ' + (split[0][1].match(/WORKERS=([^|]*)/) || [])[1].trim() : ''));
      /* A decision belongs to the side that made it, so its text is drawn in that side's stone
         colour; the log keeps every decision readable after the opponent moves, in the same colours.
         Both are properties of rendered style, so they are measured from computed colour, not assumed. */
      const owned = late.filter(([, t]) => /^(rgb\(245, 167, 66\)|rgb\(72, 207, 216\))$/.test(field(t, 'DECCOL'))).length;
      console.log('  decision text drawn in a player colour: ' + owned + ' of ' + late.length +
        '  seen: ' + [...new Set(late.map(([, t]) => field(t, 'DECCOL')))].join(' / '));
      console.log('  decision log (newest read-out): ' + field(late[late.length - 1][1], 'LOG'));
      /* Advanced settings are folded by default; the summary line is what stays visible, and it has
         to name anything the player pinned (the #d12 case pins a look-ahead, so it must show). */
      const folds = late.map(([, t]) => field(t, 'SETTINGS'));
      console.log('  advanced panel open when it should be closed: ' +
        folds.filter((s) => /^open/.test(s)).length + ' of ' + folds.length);
      console.log('  settings summary (newest): ' + folds[folds.length - 1]);
    }
    console.log('  banner: ' + (banner || '(never shown)'));
    console.log('  read-outs naming a proven forced line: ' + proofKeys.size);
    console.log('  js errors: ' + (errors.length ? '\n    ' + errors.slice(0, 8).join('\n    ') : 'none'));
  };

  await run('CPU vs CPU, both Medium (a full decisive game)', '#fast', [
    [700, null], [1600, null], [2500, 'cvc-end.png'], [3300, null], [4100, 'cvc-late.png'], [5200, null]
  ]);
  await run('Look-ahead pinned to 12 plies (the reported case: deep thinking must not collapse)', '#d12', [
    [2000, null], [9000, 'deep-1.png'], [21000, 'deep-late.png'], [46000, 'deep-move24.png']
  ]);
  await run('CPU vs CPU, Expert vs Expert (the longest clock, every spare core)', '#expert', [
    [5000, null], [11000, 'expert-1.png'], [20000, 'expert-late.png']
  ]);
  await run('CPU vs CPU, Hard vs Medium (rich report, worker search)', '#hard', [
    [1500, null], [4000, 'hard-1.png'], [8000, 'hard-3.png']
  ]);
  await run('Look-ahead pinned to 0 plies (no search, random opening)', '#d0', [
    [300, 'opening.png'], [1200, 'depth0.png'], [4000, null], [7000, 'depth0-late.png']
  ]);
  await run('2 Players, synthetic board clicks, then Undo and Hint', '#pvp', [
    [1500, null], [1900, null], [3400, 'pvp-2.png']
  ]);

  console.log('\n=== plain load, no probe ===');
  errors.length = 0;
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(400);
  await send('Page.navigate', { url: 'file:///' + path.join(ROOT, 'match5.html').replace(/\\/g, '/') });
  await sleep(2500);
  console.log('  turn: ' + (await status(true)));
  console.log('  js errors: ' + (errors.length ? errors.join(' | ') : 'none'));
  await shot('plain-load.png');

  ws.close();
}

main().then(() => process.exit(0)).catch((e) => { console.error('DRIVER FAIL: ' + e.message); process.exit(1); });
