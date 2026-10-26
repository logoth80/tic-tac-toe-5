/* Does the longest level's "every core but one" buy anything over a smaller pool, on the same
   position?  A/B, in the shipping page, on the same machine:
     1. a CPU-vs-CPU game where both sides think at the level under test;
     2. wait for the page to write a decision line for a move;
     3. set navigator.hardwareConcurrency to the pool we are considering, press Undo - which puts
        that identical position back and makes the same side think again - and read the decision
        line the page writes: workers used, plies reached, nodes, milliseconds;
     4. press Undo again with a different core count and measure the same position that way.
   The page reads navigator.hardwareConcurrency when it decides how many workers to start, so
   nothing in the product is patched; the only thing changed is how many cores the machine
   claims to have. The numbers come from the game's own decision log, so this measures what a
   player would actually see, at the level's own clock.

     node tests/pool-compare.mjs [pool-a] [pool-b] [level]   defaults: 15, 8, master
   Expects headless Chrome with DevTools on 127.0.0.1:9333 - the same browser qa/cdp-drive.mjs
   uses; the README describes how to start it. A run takes a few minutes: every arm is a full
   search at the level's clock. */
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9333;
const base = 'http://127.0.0.1:' + PORT;
const POOL_A = +(process.argv[2] || 15);
const POOL_B = +(process.argv[3] || 8);
const LEVEL = process.argv[4] || 'master';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* read a decision line the page wrote for itself */
const parse = (t) => {
  const w = t.match(/(\d+)\s+workers/);
  const d = t.match(/(\d+)\s+ply \(max (\d+)\)/);
  const n = t.match(/([\d,]+)\s+nodes in\s+([\d,]+)\s*ms/);
  return {
    who: (t.match(/engine ([xo])/) || [])[1] || null,
    workers: w ? +w[1] : (/one core/.test(t) ? 1 : null),
    depth: d ? +d[1] : null, target: d ? +d[2] : null,
    nodes: n ? +n[1].replace(/,/g, '') : null,
    ms: n ? +n[2].replace(/,/g, '') : null,
    perSec: n ? Math.round((+n[1].replace(/,/g, '') / +n[2]) * 1000) : null,
    opening: /nothing searched/.test(t)
  };
};

async function main() {
  const list = await (await fetch(base + '/json/list')).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target; is Chrome running with --remote-debugging-port=' + PORT + '?');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws failed')); });
  let idc = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const id = ++idc;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (r.result?.exceptionDetails) {
      throw new Error('page eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text) +
        '\n  expression: ' + JSON.stringify(expression));
    }
    return r.result?.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + path.join(ROOT, 'match5.html').replace(/\\/g, '/') });
  await sleep(1200);

  const realCores = await evaluate('navigator.hardwareConcurrency');
  console.log('level under test: ' + LEVEL + '   comparing a pool of ' + POOL_A + ' workers with one of ' + POOL_B);
  console.log('this machine reports ' + realCores + ' logical cores; the product itself would use ' + (realCores - 1));

  await evaluate("(function(){var s=function(id,v){var e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}));};" +
    "document.querySelector('#modeSeg button[data-mode=\"cvc\"]').click();" +
    "s('lvl1Sel','" + LEVEL + "');s('lvl2Sel','" + LEVEL + "');return 'ok';})()");

  const logLines = async () => JSON.parse(await evaluate(
    "(function(){var o=[];document.querySelectorAll('#logList .msg').forEach(function(e){o.push(e.textContent.replace(/\\s+/g,' '));});return JSON.stringify(o);})()"));
  const setHw = (n) => evaluate("Object.defineProperty(navigator,'hardwareConcurrency',{configurable:true,get:function(){return " + n + ";}}); 0");

  /* wait until the page has written one more decision line than it had before */
  const waitDecisionAfter = async (count, limitMs) => {
    const t0 = Date.now();
    while (Date.now() - t0 < limitMs) {
      await sleep(900);
      const all = await logLines();
      if (all.length > count) {
        /* the log is newest-first, so the line that just arrived is the first one */
        const r = parse(all[0]);
        if (r.nodes !== null && r.depth > 0) return r;
      }
    }
    throw new Error('no new decision within ' + limitMs + ' ms');
  };
  const rewindAndSearch = async (cores) => {
    await setHw(cores);
    await evaluate("document.getElementById('undoBtn').click();'undo'");
    /* The log right after the rewind, once the lines for the taken-back moves are gone. The next
       line the game writes is the re-search of the position just rewound to, and with the log
       newest-first that line is the first one - not the last, which is the oldest line of the
       game and would measure nothing about this position. */
    const after = (await logLines()).length;
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) {
      await sleep(900);
      const all = await logLines();
      if (all.length <= after) continue;
      const r = parse(all[0]);
      /* the worker count in the line is the engine's own account of what it used, so an arm can
         only be accepted if it actually ran with no more workers than it asked for */
      if (r.nodes !== null && r.depth > 0 && r.workers !== null && r.workers <= cores) return r;
    }
    throw new Error('no re-search within 120 s at ' + cores + ' cores');
  };

  const lead = await waitDecisionAfter(0, 180000);
  console.log('first search at the level clock: depth ' + lead.depth + '/' + lead.target +
    ', ' + lead.workers + ' workers - now measuring the next positions as an A/B');

  const rows = [];
  for (let round = 1; round <= 2; round++) {
    rows.push({ round, arm: POOL_A, r: await rewindAndSearch(POOL_A) });
    rows.push({ round, arm: POOL_B, r: await rewindAndSearch(POOL_B) });
    if (round < 2) await waitDecisionAfter((await logLines()).length, 180000);   // a different position next
  }

  console.log('\nposition  asked  used  plies reached  nodes        milliseconds  nodes/s');
  for (const { round, arm, r } of rows) {
    console.log(String(round).padStart(6) + String(arm).padStart(7) + String(r.workers).padStart(6) +
      String(r.depth + '/' + r.target).padStart(15) + String(r.nodes.toLocaleString('en-US')).padStart(13) +
      String(r.ms).padStart(13) + String(r.perSec.toLocaleString('en-US')).padStart(11));
  }
  const sum = (arm) => rows.filter((x) => x.arm === arm).reduce((a, x) => a + x.r.nodes, 0);
  const deepest = (arm) => Math.max(...rows.filter((x) => x.arm === arm).map((x) => x.r.depth));
  console.log('\n  ' + POOL_A + ' workers: ' + sum(POOL_A).toLocaleString('en-US') + ' nodes across both positions, deepest ' + deepest(POOL_A) + ' plies');
  console.log('  ' + POOL_B + ' workers: ' + sum(POOL_B).toLocaleString('en-US') + ' nodes across both positions, deepest ' + deepest(POOL_B) + ' plies');
  console.log('  each pair of rows is the same position: the game was rewound between them, and the side to move was the same.');
  console.log('  plies is what a player feels; nodes is what the cores buy. A ply costs about a root-width times the nodes of the ply before it.');

  ws.close();
}

main().then(() => process.exit(0), (e) => { console.error('FAILED: ' + e.message); process.exit(1); });
