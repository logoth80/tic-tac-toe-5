/* What does one search worker's transposition table actually cost?
   Every search worker keeps its own Map and nothing in the page shares it, so the top level -
   one worker per spare core - multiplies that cost by the core count. The engine bounds the
   table by dropping it when it gets too large; this measures how large it grows inside a real
   search at a real clock, what one entry costs in bytes, and what the bound therefore means
   for a whole pool. Nothing here is a guess: the cap is read out of match5.html.

     node --expose-gc tests/diag-tt.mjs        longest clock (10 s), ceiling 16 plies
     node --expose-gc tests/diag-tt.mjs 3000 10   a shorter clock, e.g. Expert
   (--expose-gc makes the byte measurement clean; without it the number carries GC noise.)
   Prints the depth reached, nodes, table entries and their share of visited positions, the
   measured bytes per entry, and the footprint of one worker and of a pool of them. */
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../match5.html', import.meta.url), 'utf8');
const block = html.match(/\/\*__ENGINE_START__\*\/([\s\S]*?)\/\*__ENGINE_END__\*\//);
const Match5Engine = eval('(' + block[1].trim() + ')');
const ENG = Match5Engine();
const S = 25;

/* the engine's own bound, straight from the source, so this file cannot drift from it */
const capLine = html.match(/tt\.size > (\d+)/);
const TT_CAP = capLine ? +capLine[1] : 0;

const timeMs = +(process.argv[2] || 10000);
const ceiling = +(process.argv[3] || 16);

/* A quiet midgame, built the way the suite builds one: self-play with shallow deterministic
   searches, then walk back until no five-threat is on the board and neither side is a proven
   win in six plies. A forced tactic would end the search in microseconds and say nothing about
   how large a table a long clock can grow. */
const quietOv = { maxDepth: 2, timeMs: 45, tieMargin: 0, tieChance: 0 };
const unclear = (gg) => {
  const t = gg.turn(), o = t === ENG.A ? ENG.B : ENG.A;
  if (gg.threatCells(t).length || gg.threatCells(o).length) return false;
  return Math.abs(gg.search(t, 'hard', { maxDepth: 6, timeMs: 400 }).score) < 1e8 &&
    Math.abs(gg.search(o, 'hard', { maxDepth: 6, timeMs: 400 }).score) < 1e8;
};
let g = null, rewound = 0, quiet = false;
for (let attempt = 0; attempt < 5 && !quiet; attempt++) {
  g = ENG.createGame({ size: S, win: 5 });
  while (g.moveCount() < 34 && !g.winner()) g.play(g.search(g.turn(), 'medium', quietOv).cell);
  rewound = 0;
  while (!unclear(g) && g.moveCount() > 10 && rewound < 22) { g.undo(); rewound++; }
  quiet = unclear(g);
}
if (!quiet) throw new Error('no quiet 25x25 midgame could be built - the numbers would measure a proof, not a search');
console.log('fixture: ' + g.moveCount() + ' moves (rewound ' + rewound + '), quiet midgame, turn ' +
  (g.turn() === ENG.A ? 'X' : 'O'));

const r = g.search(g.turn(), 'master', { maxDepth: ceiling, minDepth: 2, timeMs, timeMsSet: true, tieChance: 0 });
console.log('one worker, clock ' + timeMs + ' ms, ceiling ' + ceiling + ' plies');
console.log('  depth ' + r.depth + '/' + r.target + ' in ' + r.ms + ' ms, ' +
  r.nodes.toLocaleString('en-US') + ' nodes: table ' + (r.tt | 0).toLocaleString('en-US') +
  ' entries, ' + ((r.tt / Math.max(1, r.nodes)) * 100).toFixed(1) + '% of visited positions stored');
console.log('  the engine stopped because: ' + r.stop);

/* Bytes per entry, measured with the shape the engine stores: a numeric key (a 53-bit hash, so
   a real heap number) mapped to a five-element array. */
const mk = (m, n) => { for (let i = 0; i < n; i++) m.set(i * 7212121 + (i % 991) * 1e9, [i + 1, 7, 12, 1, 40]); };
const probe = new Map();
mk(probe, 100000);                          // warm the shape so the measurement is not first-touch cost
const gc = global.gc;
if (gc) { gc(); gc(); }
const before = process.memoryUsage().heapUsed;
const m = new Map();
mk(m, 400000);
if (gc) { gc(); gc(); }
const per = (process.memoryUsage().heapUsed - before) / m.size;
console.log('  measured cost of one entry: ~' + Math.round(per) + ' bytes' +
  (gc ? '' : '  (run with --expose-gc for a clean number; this one carries GC noise)'));
probe.clear(); m.clear();

const worst = (n) => (TT_CAP * per * n / 1048576).toFixed(0);
console.log('  the engine drops its table above ' + TT_CAP.toLocaleString('en-US') + ' entries, so one worker peaks at ~' +
  worst(1) + ' MB of table');
for (const cores of [1, 2, 4, 8, 15]) {
  console.log('    ' + String(cores).padStart(2) + ' workers: this search ~' +
    ((r.tt | 0) * per * cores / 1048576).toFixed(0).padStart(5) + ' MB, worst case ~' + worst(cores) + ' MB');
}
console.log('  (no worker shares another worker\'s table: the page has no SharedArrayBuffer on file://)');
