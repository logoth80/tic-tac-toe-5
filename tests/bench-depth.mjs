// Branch-factor / budget sweep on a quiet 25x25 midgame, to tune LEVELS.
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../match5.html', import.meta.url), 'utf8');
const block = html.match(/\/\*__ENGINE_START__\*\/([\s\S]*?)\/\*__ENGINE_END__\*\//);
const Match5Engine = eval('(' + block[1].trim() + ')');
const ENG = Match5Engine();
const A = ENG.A, B = ENG.B;
const S = 25;

const g = ENG.createGame({ size: S, win: 5 });
const quietOv = { maxDepth: 2, timeMs: 45, tieMargin: 0, tieChance: 0 };
while (g.moveCount() < 34 && !g.winner()) g.play(g.search(g.turn(), 'medium', quietOv).cell);
const unclear = (gg) => {
  const t = gg.turn(), o = t === A ? B : A;
  if (gg.threatCells(t).length || gg.threatCells(o).length) return false;
  if (Math.abs(gg.search(t, 'hard', { maxDepth: 6, timeMs: 400 }).score) >= 1e8) return false;
  return Math.abs(gg.search(o, 'hard', { maxDepth: 6, timeMs: 400 }).score) < 1e8;
};
let rew = 0;
while (!unclear(g) && g.moveCount() > 8 && rew < 14) { g.undo(); rew++; }
console.log('position: ' + g.moveCount() + ' plies, turn ' + (g.turn() === A ? 'X' : 'O') + ', quiet=' + unclear(g));
const mover = g.turn();

console.log('\nbranch  budget   depth  nodes      ms      n/s       score');
for (const branch of [8, 10, 12, 16, 20]) {
  for (const timeMs of [600, 900, 1500, 2500]) {
    const r = g.search(mover, 'hard', { maxDepth: 10, timeMs, branch, rootBranch: Math.max(18, branch + 8) });
    const rate = Math.round(r.nodes / Math.max(1, r.ms) * 1000);
    console.log(String(branch).padStart(5) + '  ' + String(timeMs).padStart(6) + '   ' + String(r.depth).padStart(4) +
      '  ' + r.nodes.toLocaleString('en-US').padStart(9) + '  ' + String(r.ms).padStart(6) + '  ' + rate.toLocaleString('en-US').padStart(8) +
      '  ' + r.score.toExponential(2).padStart(9) + (r.aborted ? '  (aborted)' : ''));
  }
}

// tactical stress: several live threes on the board should extend and go deep
console.log('\nforcing-position depth (live threes / fours on the board):');
const T = 15, id = (x, y) => y * T + x;
const gt = ENG.createGame({ size: T, win: 5 });
const tseq = [[3,7],[3,6],[4,7],[4,6],[5,7],[5,6],[8,8],[9,9],[12,4],[11,3]];
for (const [x, y] of tseq) gt.play(id(x, y));
console.log('  stats ' + JSON.stringify(gt.stats()) + ' turn ' + (gt.turn() === A ? 'X' : 'O'));
for (const branch of [8, 12, 16]) {
  const r = gt.search(gt.turn(), 'hard', { maxDepth: 12, timeMs: 1500, branch });
  console.log('  branch ' + branch + ' -> depth ' + r.depth + ', ' + r.nodes.toLocaleString('en-US') + ' nodes, ' + r.ms + ' ms, score ' + r.score.toExponential(2) + ' forced=' + r.forced);
}
