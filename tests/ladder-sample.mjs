// Throwaway measurement: how often does the deeper level actually out-score the shallower
// one? Used to pick honest thresholds for test [7]; dev-only, not part of the deliverable.
// Usage: node tests/ladder-sample.mjs [games] [board]
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../match5.html', import.meta.url), 'utf8');
const block = html.match(/\/\*__ENGINE_START__\*\/([\s\S]*?)\/\*__ENGINE_END__\*\//);
const Match5Engine = eval('(' + block[1].trim() + ')');
const ENG = Match5Engine();
const A = ENG.A, B = ENG.B;

const GAMES = +(process.argv[2] || 8), S = +(process.argv[3] || 13);

function duel(strong, weak, strongIsX, ov) {
  const g = ENG.createGame({ size: S, win: 5 });
  const lv = (p) => p === A ? (strongIsX ? strong : weak) : (strongIsX ? weak : strong);
  const strongSide = strongIsX ? A : B;
  let plies = 0, aborts = 0, strongSearches = 0;
  while (!g.winner() && !g.isFull() && plies < 60) {
    const p = g.turn();
    const r = g.search(p, lv(p), ov);
    if (p === strongSide) { strongSearches++; if (r.aborted) aborts++; }
    if (r.cell < 0) break;
    g.play(r.cell);
    plies++;
  }
  const w = g.winner();
  return { result: w === 0 ? 'draw' : (w === strongSide ? 'win' : 'UPSET'), plies, aborts, strongSearches };
}

const PAIRS = (process.argv[4] || 'hard:medium,medium:easy').split(',').map((p) => p.split(':'));
for (const [strong, weak] of PAIRS) {
  for (const [passName, ov] of [['pure search', { tieChance: 0 }], ['as shipped', {}]]) {
    let wins = 0, upsets = 0, draws = 0;
    const notes = [];
    for (let i = 0; i < GAMES; i++) {
      const d = duel(strong, weak, i % 2 === 0, ov);
      if (d.result === 'win') wins++; else if (d.result === 'UPSET') upsets++; else draws++;
      notes.push(d.result[0] + d.plies + '(a' + d.aborts + '/' + d.strongSearches + ')');
    }
    console.log(strong.padEnd(7) + ' vs ' + weak.padEnd(7) + ' [' + passName.padEnd(11) + '] ' +
      GAMES + ' games -> ' + wins + ' win / ' + upsets + ' upset / ' + draws + ' draw   ' + notes.join(' '));
  }
}
