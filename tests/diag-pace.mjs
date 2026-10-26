// Diagnostic (dev only): per-move pacing of the engine through a real 25x25 game.
// Prints, for every move, whether the answer was a forced tactic, the depth reached,
// nodes, ms, and whether a genuine five-completion really existed at that moment.
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../match5.html', import.meta.url), 'utf8');
const block = html.match(/\/\*__ENGINE_START__\*\/([\s\S]*?)\/\*__ENGINE_END__\*\//);
const Match5Engine = eval('(' + block[1].trim() + ')');
const ENG = Match5Engine();
const A = ENG.A, B = ENG.B;

const [lv1, lv2, size, cap, pin] = [process.argv[2] || 'hard', process.argv[3] || 'medium', +(process.argv[4] || 25), +(process.argv[5] || 60), process.argv[6] === undefined ? null : +(process.argv[6])];
const g = ENG.createGame({ size, win: 5 });
const lvOf = (p) => (p === A ? lv1 : lv2);
const ovOf = () => (pin === null ? {} : { maxDepth: pin, minDepth: pin });
let instantNoThreat = 0, forced = 0, shallowQuiet = 0, proven = 0;

for (let m = 0; m < cap && !g.winner() && !g.isFull(); m++) {
  const p = g.turn();
  const myT = g.threatCells(p).length, foeT = g.threatCells(p === A ? B : A).length;
  const r = g.search(p, lvOf(p), ovOf());
  const isForced = r.forced && r.forced !== 'search';
  if (isForced) forced++;
  if (r.ms <= 2 && !myT && !foeT) instantNoThreat++;
  if (!isForced && r.depth <= 2 && !myT && !foeT) shallowQuiet++;
  const st = g.stats();
  console.log(
    String(m + 1).padStart(3) + ' ' + (p === A ? 'X' : 'O') + ' ' + lvOf(p).padEnd(6) +
    ' d' + String(r.depth).padStart(2) + '/' + String(r.target).padStart(2) +
    ' nodes ' + String(r.nodes).padStart(7) +
    ' ms ' + String(r.ms).padStart(5) +
    ' thr ' + myT + '/' + foeT +
    ' fours ' + st.fourA + '/' + st.fourB +
    ' score ' + String(r.score).padStart(11) +
    (isForced ? '  FORCED: ' + r.forced : '') + (r.aborted ? '  cut' : '') +
    '  [' + (r.stop || r.forced) + (r.mate ? ' mate=' + r.mate : '') + ']'
  );
  if (r.stop && /^proved/.test(r.stop)) proven++;
  const dbg = isForced && /five|threat/.test(r.forced);
  const nmS = (c) => c < 0 ? '-' : '(' + (c % size) + ',' + Math.floor(c / size) + ')';
  const mineB4 = dbg ? g.threatCells(p).map(nmS).join(' ') : '';
  const theirsB4 = dbg ? g.threatCells(p === A ? B : A).map(nmS).join(' ') : '';
  g.play(r.cell);
  if (dbg) {
    console.log('        engine saw [' + r.root.map((o) => nmS(o.cell)).join(' ') + '] | before: mine=[' + mineB4 +
      '] theirs=[' + theirsB4 + '] | after our move they still threaten five: ' + g.threatCells(g.turn()).length);
  }
}
console.log('\nsummary: forced/instant-tactic moves ' + forced + ', instant with no five-threat anywhere ' +
  instantNoThreat + ', shallow (<=2) searches in quiet positions ' + shallowQuiet +
  ', moves that ended on a proof (win or loss) ' + proven);
console.log('result: winner=' + g.winner() + ' moves=' + g.moveCount());
