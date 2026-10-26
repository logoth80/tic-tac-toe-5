// Diagnostic (dev only): a hand-built position where the side to move is provably lost.
// The enemy holds an open three with both ends free; nothing else is in reach for us.
// Prints what both sides' searches report, so the proof-handling contract is visible.
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../match5.html', import.meta.url), 'utf8');
const block = html.match(/\/\*__ENGINE_START__\*\/([\s\S]*?)\/\*__ENGINE_END__\*\//);
const Match5Engine = eval('(' + block[1].trim() + ')');
const ENG = Match5Engine();
const A = ENG.A, B = ENG.B;
const S = 19;
const id = (x, y) => y * S + x;

const g = ENG.createGame({ size: S, win: 5 });
// alternating: A plays harmless scattered stones, B builds two open threes
for (const c of [id(1, 1), id(10, 10), id(3, 4), id(11, 10), id(5, 7), id(12, 10),
                 id(7, 2), id(14, 6), id(9, 3), id(15, 7), id(11, 1), id(16, 8)]) g.play(c);

console.log('position: B has two open threes - (10,10)(11,10)(12,10) and (14,6)(15,7)(16,8); A to move, no counterplay');
console.log('five squares for B: ' + g.threatCells(B).map((c) => '(' + (c % S) + ',' + Math.floor(c / S) + ')').join(' '));

for (const d of [6, 8, 10, 12]) {
  const ov = { maxDepth: d, minDepth: 2, timeMs: 1500, timeMsSet: true, tieChance: 0 };
  const rl = g.search(A, 'hard', ov);
  const rw = g.search(B, 'hard', ov);
  const line = (tag, r) => tag.padEnd(4) + ' d' + String(r.depth).padStart(2) + '/' + String(r.target).padStart(2) +
    ' nodes ' + String(r.nodes).padStart(7) + ' ms ' + String(r.ms).padStart(5) +
    ' score ' + String(r.score).padStart(12) + ' mate ' + String(r.mate).padStart(3) +
    '  [' + r.stop + ']  ' + (r.forced === 'search' ? 'search' : 'FORCED: ' + r.forced);
  console.log('maxDepth ' + String(d).padStart(2) + '  ' + line('A', rl));
  console.log('          ' + line('B', rw));
}
