// Headless QA for the MATCH 5 engine extracted straight out of match5.html
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../match5.html', import.meta.url), 'utf8');
const block = html.match(/\/\*__ENGINE_START__\*\/([\s\S]*?)\/\*__ENGINE_END__\*\//);
if (!block) { console.error('ENGINE markers not found'); process.exit(1); }
const Match5Engine = eval('(' + block[1].trim() + ')');
const ENG = Match5Engine();
const A = ENG.A, B = ENG.B;
const WT = [0, 3, 32, 420, 6200, 90000000];
const DX = [1, 0, 1, 1], DY = [0, 1, 1, -1];

let fails = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { fails++; console.log('  FAIL ' + msg); } }

function mk(size, moves) {
  const g = ENG.createGame({ size, win: 5 });
  for (const m of moves) g.play(m);
  return g;
}
const id = (size, x, y) => y * size + x;
const nm = (size, c) => '(' + (c % size) + ',' + Math.floor(c / size) + ')';

/* ---------- independent brute force reference ---------- */
function brute(size) {
  const wins = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) for (let d = 0; d < 4; d++) {
    const ex = x + 4 * DX[d], ey = y + 4 * DY[d];
    if (ex < 0 || ex >= size || ey < 0 || ey >= size) continue;
    const cells = [];
    for (let k = 0; k < 5; k++) cells.push((y + k * DY[d]) * size + (x + k * DX[d]));
    wins.push(cells);
  }
  return {
    scores(board) {
      let sa = 0, sb = 0, fa = 0, fb = 0;
      for (const w of wins) {
        let a = 0, b = 0;
        for (const c of w) { if (board[c] === A) a++; else if (board[c] === B) b++; }
        if (a > 0 && b === 0) sa += WT[a]; else if (b > 0 && a === 0) sb += WT[b];
        if (a === 4 && b === 0) fa++; else if (b === 4 && a === 0) fb++;
      }
      return { sa, sb, fa, fb };
    },
    winCells(board, player) {
      const out = [];
      for (const w of wins) {
        let a = 0, b = 0, empty = -1;
        for (const c of w) { if (board[c] === A) a++; else if (board[c] === B) b++; else empty = c; }
        if (player === A && a === 4 && b === 0 && empty >= 0) out.push(empty);
        if (player === B && b === 4 && a === 0 && empty >= 0) out.push(empty);
      }
      return out;
    },
    winner(board) {
      for (const w of wins) {
        let a = 0, b = 0;
        for (const c of w) { if (board[c] === A) a++; else if (board[c] === B) b++; }
        if (a === 5) return A;
        if (b === 5) return B;
      }
      return 0;
    }
  };
}

/* ---------- 0. move alternation / move-count bookkeeping ---------- */
console.log('[0] move alternation and turn parity');
{
  const S = 13;
  const g = ENG.createGame({ size: S, win: 5 });
  ok(g.legalMoves().length === 1, 'empty board should offer only the centre, got ' + g.legalMoves().length);
  ok(g.turn() === A, 'X must move first');
  const placed = [];
  for (let i = 0; i < 14; i++) {
    const legal = g.legalMoves(g.turn());
    const pick = legal[(i * 5) % legal.length];
    placed.push(pick);
    g.play(pick);
  }
  let c = g.counts();
  ok(c.a === 7 && c.b === 7, 'alternation broken after 14 plies: ' + JSON.stringify(c));
  ok(g.turn() === A, 'turn parity wrong after even ply count');
  ok(g.moveCount() === 14, 'moveCount wrong: ' + g.moveCount());
  g.undo(); g.undo();
  c = g.counts();
  ok(c.a === 6 && c.b === 6 && g.turn() === A, 'undo parity wrong: ' + JSON.stringify(c) + ' turn ' + g.turn());
  g.loadMoves(placed);
  c = g.counts();
  ok(c.a === 7 && c.b === 7, 'loadMoves alternation wrong: ' + JSON.stringify(c));
  // the engine must never answer with the wrong colour
  const r = g.search(B, 'medium', {});
  ok(r.cell >= 0 && g.board[r.cell] === 0, 'B search returned a bad cell');
}

/* ---------- 1. incremental bookkeeping matches brute force ---------- */
console.log('[1] incremental score bookkeeping vs brute force');
{
  let worst = 0;
  for (let trial = 0; trial < 6; trial++) {
    const size = [9, 15, 25][trial % 3];
    const ref = brute(size);
    const g = ENG.createGame({ size, win: 5 });
    const seen = [];
    let moves = 0;
    const target = Math.floor(size * size * 0.35);
    let rnd = 1234 + trial;
    const rand = () => (rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    while (moves < target && !g.winner()) {
      const legal = g.legalMoves(g.turn());
      if (!legal.length) break;
      const pick = legal[(rand() * legal.length) | 0];
      g.play(pick); seen.push(pick); moves++;
      const bf = ref.scores(g.board), st = g.stats();
      worst = Math.max(worst, Math.abs(bf.sa - st.scoreA) + Math.abs(bf.sb - st.scoreB) + Math.abs(bf.fa - st.fourA) + Math.abs(bf.fb - st.fourB));
      ok(worst < 1e-6, 'drift at move ' + moves + ' size ' + size + ' (max delta ' + worst + ')');
      // incremental five-threat bookkeeping must match brute force exactly
      for (const p of [A, B]) {
        const live = new Set(g.threatCells(p)), ref2 = new Set(ref.winCells(g.board, p));
        let diff = ref2.size !== live.size;
        for (const c of ref2) if (!live.has(c)) diff = true;
        ok(!diff, 'threatCells drift for ' + (p === A ? 'A' : 'B') + ' at move ' + moves + ' size ' + size +
          ' (' + [...ref2].map(c => nm(size, c)) + ' vs ' + [...live].map(c => nm(size, c)) + ')');
        ok((p === A ? st.fourA : st.fourB) >= live.size, 'four counter disagrees with threat list');
      }
      // wouldWin must match brute force for both players
      for (let c = 0; c < size * size; c += 7) {
        if (g.board[c] !== 0) continue;
        ok(g.wouldWin(c, A) === ref.winCells(g.board, A).includes(c), 'wouldWin(A) mismatch at ' + nm(size, c));
        ok(g.wouldWin(c, B) === ref.winCells(g.board, B).includes(c), 'wouldWin(B) mismatch at ' + nm(size, c));
      }
    }
    // full unwind must restore an empty board
    while (g.moveCount()) g.undo();
    const st = g.stats();
    ok(st.scoreA === 0 && st.scoreB === 0 && st.fourA === 0 && st.fourB === 0, 'unwind residue size ' + size);
    let stones = 0; for (const v of g.board) if (v) stones++;
    ok(stones === 0, 'unwind left ' + stones + ' stones on size ' + size);
    // replay the same moves and re-verify
    g.loadMoves(seen);
    const bf2 = ref.scores(g.board), st2 = g.stats();
    ok(bf2.sa === st2.scoreA && bf2.sb === st2.scoreB, 'replay mismatch size ' + size);
    /* Searching a position explores it with the same place/unplace machinery as the game.
       Whatever it looks at, the real position has to come back unchanged - an undo that
       failed to re-register a window leaves the next move played on a board the engine
       can no longer read. */
    const stb = g.stats();
    g.search(g.turn(), 'hard', { maxDepth: 6, minDepth: 2, timeMs: 300, timeMsSet: true, tieChance: 0 });
    g.search(g.turn() === A ? B : A, 'expert', { maxDepth: 7, minDepth: 2, timeMs: 300, timeMsSet: true, tieChance: 0 });
    const sta = g.stats();
    ok(stb.scoreA === sta.scoreA && stb.scoreB === sta.scoreB && stb.fourA === sta.fourA &&
      stb.fourB === sta.fourB && stb.moves === sta.moves,
      'a search changed the position bookkeeping at size ' + size + ': ' +
      JSON.stringify(stb) + ' -> ' + JSON.stringify(sta));
    const bf4 = ref.scores(g.board);
    ok(bf4.sa === sta.scoreA && bf4.sb === sta.scoreB && bf4.fa === sta.fourA && bf4.fb === sta.fourB,
      'a search desynchronised the counters from the board at size ' + size + ': ' +
      JSON.stringify(sta) + ' vs ' + JSON.stringify(bf4));
  }
  console.log('  checks: ' + checks + ', max drift: ' + worst);
}

/* ---------- 2. forced win / forced block, every level ---------- */
console.log('[2] tactical forcing per level');
{
  const S = 9;
  const winSeq = [id(S,2,4), id(S,0,0), id(S,3,4), id(S,1,0), id(S,4,4), id(S,0,2), id(S,5,4), id(S,1,3)];
  const blockSeq = [id(S,0,0), id(S,4,4), id(S,0,7), id(S,4,5), id(S,7,0), id(S,4,6), id(S,7,7), id(S,4,3)];
  const winTargets = [id(S,1,4), id(S,6,4)];
  const blockTargets = [id(S,4,2), id(S,4,7)];
  for (const lv of ENG.LEVEL_ORDER) {
    let g = mk(S, winSeq);
    let r = g.search(A, lv, {});
    ok(winTargets.includes(r.cell), lv + ': win-now move = ' + nm(S, r.cell) + ' expected one of ' + winTargets.map(c => nm(S, c)));
    ok(Math.abs(r.score) >= 1e8, lv + ': win-now score reported huge (' + r.score + ')');
    ok(/five/.test(r.forced || ''), lv + ': win-now not flagged as forced (' + r.forced + ')');
    g = mk(S, blockSeq);
    r = g.search(A, lv, {});
    ok(blockTargets.includes(r.cell), lv + ': block move = ' + nm(S, r.cell) + ' expected one of ' + blockTargets.map(c => nm(S, c)));
    ok(/block|double/.test(r.forced || ''), lv + ': block not flagged as forced (' + r.forced + ')');
    // and after the block the game must still be alive
    g.play(r.cell);
    ok(g.winner() === 0, lv + ': the forced block lost immediately');
  }
}

/* ---------- 3. building a four when it has an open three ---------- */
console.log('[3] converts an open three into a four');
{
  const S = 11;
  const seq = [id(S,5,5), id(S,0,0), id(S,6,5), id(S,0,1), id(S,7,5), id(S,1,7)];
  for (const lv of ['medium', 'hard', 'expert']) {
    const g = mk(S, seq);
    const r = g.search(A, lv, {});
    g.play(r.cell);
    const st = g.stats();
    ok(st.fourA >= 1, lv + ': no four created after best move (' + JSON.stringify(st) + ')');
    ok(g.winner() === 0, lv + ': unexpected instant win in test 3');
  }
}

/* ---------- 4. forcing discipline during self-play ---------- */
console.log('[4] self-play forcing discipline (no missed win, no missed block)');
{
  const S = 25;
  const g = ENG.createGame({ size: S, win: 5 });
  let rnd = 99;
  const rand = () => (rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  // seed the board with a few random duels so the midgame search is realistic
  const seed = [[5,5],[19,19],[5,19],[19,5],[12,12],[12,13],[11,12],[13,12],[10,11],[14,13]];
  for (const [x, y] of seed) g.play(id(S, x, y));
  const moves = seed.map(([x, y]) => id(S, x, y));
  let violations = 0, missedWin = 0, missedBlock = 0, deepest = 0, maxMs = 0, totalMs = 0, plies = 0;
  const levels = ['hard', 'hard'];
  while (!g.winner() && !g.isFull() && plies < 30) {
    const player = g.turn(), other = player === A ? B : A;
    const legal = g.legalMoves(player);
    if (!legal.length) break;
    const mine = legal.filter(c => g.wouldWin(c, player));
    const theirs = legal.filter(c => g.wouldWin(c, other));
    const liveMine = new Set(g.threatCells(player)), liveTheirs = new Set(g.threatCells(other));
    ok(mine.length === liveMine.size && mine.every(c => liveMine.has(c)), 'threatCells(player) != wouldWin at ply ' + plies);
    ok(theirs.length === liveTheirs.size && theirs.every(c => liveTheirs.has(c)), 'threatCells(other) != wouldWin at ply ' + plies);
    const r = g.search(player, levels[plies % 2], {});
    plies++;
    deepest = Math.max(deepest, r.depth); maxMs = Math.max(maxMs, r.ms); totalMs += r.ms;
    ok(g.board[r.cell] === 0, 'engine picked an occupied cell');
    if (mine.length && !mine.includes(r.cell)) { missedWin++; violations++; console.log('  missed immediate win at ply ' + plies); }
    else if (!mine.length && theirs.length && !theirs.includes(r.cell)) { missedBlock++; violations++; console.log('  missed forced block at ply ' + plies + ' threats ' + theirs.map(c => nm(S, c))); }
    g.play(r.cell); moves.push(r.cell);
  }
  console.log('  plies: ' + plies + ', deepest reached: ' + deepest + ', avg ms: ' + Math.round(totalMs / Math.max(1, plies)) + ', max ms: ' + maxMs);
  ok(violations === 0, violations + ' forcing violations (missed win ' + missedWin + ', missed block ' + missedBlock + ')');
  ok(deepest >= 3, 'search only reached depth ' + deepest + ' (expected >= 3 for hard)');
  ok(maxMs < 1600, 'a single move took ' + maxMs + ' ms (time budget not respected)');
  const ref = brute(S);
  ok(ref.winner(g.board) === g.winner(), 'winner detection disagrees with brute force');
  const line = g.findWin();
  if (line) {
    ok(line.line.length === 5, 'win line has ' + line.line.length + ' cells');
    const vals = line.line.map(c => g.board[c]);
    ok(vals.every(v => v === line.winner), 'win line cells not all the winner colour');
  }
  console.log('  finished: winner=' + g.winner() + ' moves=' + moves.length + ' winLine=' + (line ? line.line.map(c => nm(S, c)).join(' ') : 'none'));
}

/* ---------- 5. depth / performance ladder on 25x25 midgame ---------- */
console.log('[5] look-ahead depth and performance by level (25x25 midgame)');
{
  const S = 25;
  // build a midgame with the engine itself, then walk back until it is both
  // tactic-free (no five-threat on the board) and not a proven forced win,
  // so the numbers below measure genuine look-ahead instead of an instant five
  let g = null, rewound = 0, quiet = false;
  const quietOv = { maxDepth: 2, timeMs: 45, tieMargin: 0, tieChance: 0 };
  const unclear = (gg) => {
    const t = gg.turn(), o = t === A ? B : A;
    if (gg.threatCells(t).length || gg.threatCells(o).length) return false;
    const a = gg.search(t, 'hard', { maxDepth: 6, timeMs: 400 });
    if (Math.abs(a.score) >= 1e8) return false;
    const b = gg.search(o, 'hard', { maxDepth: 6, timeMs: 400 });
    return Math.abs(b.score) < 1e8;
  };
  /* Several games: the opening is deliberately varied, so some self-play runs are already
     a proven win by move ten - and a decided position measures proofs, not look-ahead. */
  for (let attempt = 0; attempt < 5 && !quiet; attempt++) {
    g = ENG.createGame({ size: S, win: 5 });
    while (g.moveCount() < 34 && !g.winner()) g.play(g.search(g.turn(), 'medium', quietOv).cell);
    rewound = 0;
    while (!unclear(g) && g.moveCount() > 10 && rewound < 22) { g.undo(); rewound++; }
    quiet = unclear(g);
  }
  if (!quiet) {   // last resort: a scattered arrangement that cannot be decided in six plies
    g = mk(S, [id(S,6,6), id(S,7,14), id(S,13,17), id(S,16,16), id(S,18,7), id(S,11,11)]);
    rewound = 0; quiet = unclear(g);
  }
  ok(quiet, 'no quiet 25x25 midgame position could be built - the numbers below would measure a proof, not depth');
  console.log('  test position: ' + g.moveCount() + ' plies (rewound ' + rewound + '), turn ' + (g.turn() === A ? 'X' : 'O') +
    ', quiet midgame: ' + quiet + ', ' + JSON.stringify(g.stats()));
  const mover = g.turn();
  const probe = g.search(mover, 'hard', { maxDepth: 6, timeMs: 900 });
  console.log('  probe: ' + (mover === A ? 'X' : 'O') + ' score ' + probe.score.toExponential(2) + ' depth ' + probe.depth + (probe.aborted ? ' (aborted)' : ''));
  const mate = Math.abs(probe.score) >= 1e8;
  const who = mate ? (probe.score > 0 ? mover : (mover === A ? B : A)) : mover;
  let deepestLevel = 0;
  for (const lv of ENG.LEVEL_ORDER) {
    const r = g.search(who, lv, {});
    const rate = r.ms > 0 ? Math.round(r.nodes / (r.ms / 1000)) : r.nodes * 1000;
    deepestLevel = Math.max(deepestLevel, r.depth);
    console.log('  ' + lv.padEnd(7) + ' depth ' + String(r.depth).padStart(2) + '/' + String(r.target).padEnd(2) + '  nodes ' + String(r.nodes).padStart(8) + '  ' + String(r.ms).padStart(5) + ' ms  ' + rate.toLocaleString('en-US').padStart(9) + ' n/s  ' + r.score.toExponential(1).padStart(9) + '  best ' + nm(S, r.cell));
    ok(r.forced === 'search', lv + ' short-circuited a quiet position: ' + r.forced);
    ok(r.depth >= (ENG.LEVELS[lv].minDepth), lv + ' did not reach its minimum depth');
    ok(r.ms < ENG.LEVELS[lv].timeMs + 600, lv + ' overshot its time budget: ' + r.ms + ' ms');
  }
  if (quiet && !mate) ok(deepestLevel >= 6, 'quiet position: search never went deeper than ' + deepestLevel);
  // explicit deep override
  const r = g.search(who, 'hard', { maxDepth: 12, timeMs: 3000, branch: 16 });
  console.log('  forced deep override -> depth ' + r.depth + ', ' + r.nodes.toLocaleString('en-US') + ' nodes, ' + r.ms + ' ms, score ' + r.score.toExponential(2));
  ok(r.depth >= 4 || Math.abs(r.score) >= 1e8, 'forced deep override only reached ' + r.depth);
}

/* ---------- 6. endgame / edge cases ---------- */
console.log('[6] edge cases');
{
  const S = 9;
  let g = mk(S, [id(S,4,4)]);
  let r = g.search(B, 'medium', {});
  ok(r.cell >= 0 && g.board[r.cell] === 0, 'empty-ish board returned no move');
  // near-full board: fill everything except a few holes, search must not crash
  g = ENG.createGame({ size: 5, win: 5 });
  let played = 0;
  while (!g.isFull() && !g.winner()) {
    const legal = g.legalMoves(g.turn());
    if (!legal.length) break;
    g.play(legal[0]); played++;
  }
  ok(g.winner() !== 0 || g.isFull() || played >= 25, '5x5 self-play stalled without a result (played ' + played + ', winner ' + g.winner() + ')');
  // no legal moves at all
  const g2 = ENG.createGame({ size: 3, win: 5 });
  for (let c = 0; c < 9; c++) if (g2.board[c] === 0) { }
  const r2 = g2.search(A, 'hard', {});
  ok(r2.cell >= 0, '3x3 board gave no move at all');
  // undo after game over state
  const g3 = mk(9, [id(9,4,4), id(9,0,0), id(9,5,4), id(9,0,1), id(9,6,4), id(9,0,2), id(9,7,4), id(9,0,3), id(9,8,4)]);
  ok(g3.winner() === A, 'A should have won with 5 in a row on row 4');
  ok((g3.findWin() || {}).line?.length === 5, 'findWin did not return a 5-cell line');
  g3.undo();
  ok(g3.winner() === 0, 'undo did not clear the win state');
}

/* ---------- 7. strength: each level must beat the one below it ---------- */
console.log('[7] strength ladder (13x13, colours swapped per pairing)');
{
  const S = 13;
  const pairings = [
    // Bars from tests/ladder-sample.mjs over 8-game shipped samples, not from hope:
    //   hard vs medium  8/8 pure (twice), 7/8 and 5/6 shipped
    //   hard vs easy    8/8 pure (twice), 7/8 and 8/8 shipped
    //   medium vs easy  3/6 pure, 5/6 to 3/4 shipped
    // A 13x13 endgame is a four-race melee: the shallower level wins about one game in eight,
    // and a one-ply edge (medium vs easy) flips often enough that the honest bar there is
    // "not a majority of losses". Wide gaps and pure search are gated strictly; the tactical
    // guarantees that do not depend on luck live in [2], [4], [9] and [10].
    // The variety dice are pinned per game (cfg.entropy) so a game replays identically.
    { strong: 'hard', weak: 'medium', pure: 1.5, shipped: 2.0 },
    { strong: 'medium', weak: 'easy', pure: 0, shipped: 2.0 },
    { strong: 'hard', weak: 'easy', pure: 0, shipped: 3.0 }
  ];
  for (const { strong: strongLevel, weak: weakLevel, pure: pureNeed, shipped: shippedNeed } of pairings) {
    const passes = [];
    if (pureNeed > 0) {
      passes.push({ name: 'pure search', ov: { tieChance: 0 }, need: pureNeed,
        openers: [[strongLevel, weakLevel], [weakLevel, strongLevel]] });
    }
    passes.push({ name: 'as shipped', ov: { entropy: 0x5EED }, need: shippedNeed, pinStep: 7919,
      openers: [[strongLevel, weakLevel], [weakLevel, strongLevel], [strongLevel, weakLevel], [weakLevel, strongLevel]] });
    for (const pass of passes) {
      let strongScore = 0, upsets = 0;
      const allowUpsets = Math.floor(pass.openers.length - pass.need);
      for (let i = 0; i < pass.openers.length; i++) {
        const g = ENG.createGame({ size: S, win: 5 });
        const lvOf = (player) => player === A ? pass.openers[i][0] : pass.openers[i][1];
        const strongSide = pass.openers[i].indexOf(strongLevel) === 0 ? A : B;
        // a different fixed dice per game: reproducible, but not the same game four times over
        const ov = pass.pinStep ? Object.assign({}, pass.ov, { entropy: (pass.ov.entropy + i * pass.pinStep) >>> 0 }) : pass.ov;
        let plies = 0;
        while (!g.winner() && !g.isFull() && plies < 60) {
          const p = g.turn();
          const r = g.search(p, lvOf(p), ov);
          if (r.cell < 0) break;
          g.play(r.cell);
          plies++;
        }
        const w = g.winner();
        let note;
        if (w === 0) { strongScore += 0.5; note = 'draw after ' + plies + ' plies'; }
        else if (w === strongSide) { strongScore += 1; note = strongLevel + ' wins as ' + (strongSide === A ? 'X' : 'O') + ' in ' + plies + ' plies'; }
        else { upsets++; note = weakLevel + ' wins in ' + plies + ' plies  <-- upset ' + upsets + ' (up to ' + allowUpsets + ' allowed)'; }
        console.log('  ' + strongLevel + ' vs ' + weakLevel + ' [' + pass.name + '] -> ' + note);
        ok(g.winner() !== 0 || plies >= 60, strongLevel + ' vs ' + weakLevel + ' game stalled at ' + plies + ' plies');
      }
      console.log('  ' + strongLevel + ' scores ' + strongScore + ' / ' + pass.openers.length + ' [' + pass.name + ']');
      ok(strongScore >= pass.need, strongLevel + ' only scored ' + strongScore + ' of ' + pass.openers.length +
        ' against ' + weakLevel + ' [' + pass.name + '] - depth is not converting into results');
    }
  }
}

/* ---------- 8. variety: depth 0/1, opening spread, near-tie picks ---------- */
console.log('[8] depth 0/1, opening variety, near-tie selection');
{
  const S = 25, mid = S >> 1;

  // empty board: the first move must vary, stay in the central block, and skip the search
  const firsts = new Set();
  let wrongBranch = 0, offCentre = 0;
  for (let i = 0; i < 40; i++) {
    const g = ENG.createGame({ size: S, win: 5 });
    const r = g.search(A, 'hard', {});
    if (r.forced !== 'opening variation' || r.depth !== 0) wrongBranch++;
    const x = r.cell % S, y = Math.floor(r.cell / S);
    if (Math.abs(x - mid) > 3 || Math.abs(y - mid) > 3) offCentre++;
    firsts.add(r.cell);
  }
  ok(wrongBranch === 0, 'empty-board searches did not report the opening branch at depth 0');
  ok(offCentre === 0, 'opening moves landed outside the central block');
  ok(firsts.size >= 6, 'opening variety too small: ' + firsts.size + ' distinct first moves in 40 games');
  console.log('  openings: ' + firsts.size + ' distinct first moves in 40 games, all central');

  // pinned depths 0 and 1 must run, stay at that depth and return legal moves
  const q = mk(S, [id(S, 12, 12), id(S, 13, 13)]);
  for (const d of [0, 1]) {
    const r = q.search(A, 'hard', { maxDepth: d, minDepth: d, timeMs: 1500 });
    ok(r.cell >= 0 && q.board[r.cell] === 0, 'depth ' + d + ': no legal move returned');
    ok(r.depth === d, 'depth ' + d + ': search reported ' + r.depth);
    ok(Number.isFinite(r.score) && r.cand >= 2, 'depth ' + d + ': bad score/candidate count (' + r.score + ', ' + r.cand + ')');
    ok(r.nodes === 0, 'depth ' + d + ': nodes counted where no tree should be searched (' + r.nodes + ')');
  }
  // depth 0 is greedy: it still rates its own four and the enemy four
  const g0 = mk(S, [id(S,10,10), id(S,0,0), id(S,11,10), id(S,0,1), id(S,12,10), id(S,0,2), id(S,13,10), id(S,0,3)]);
  const deep0 = g0.search(A, 'hard', { maxDepth: 0, minDepth: 0, timeMs: 1500 });
  ok(deep0.forced === 'completes five now' && deep0.cell >= 0, 'depth 0 failed to take the five it was holding');

  // near-ties: identical quiet position, pinned depth, variety on -> different but legal moves
  const picks = new Map();
  let softSeen = 0, illegal = 0;
  for (let i = 0; i < 30; i++) {
    const r = q.search(A, 'hard', { maxDepth: 3, minDepth: 3, timeMs: 1500 });
    if (q.board[r.cell] !== 0) illegal++;
    picks.set(r.cell, (picks.get(r.cell) || 0) + 1);
    if (r.soft) softSeen++;
  }
  ok(illegal === 0, 'a near-tie pick landed on an occupied cell');
  ok(picks.size >= 2, 'hard never deviated from the top move in 30 identical quiet searches');
  ok(softSeen >= 3, 'near-tie picks reported too rarely: ' + softSeen + '/30');
  const topPick = [...picks.entries()].sort((a, b) => b[1] - a[1])[0];
  ok(topPick[1] >= 2, 'the best move stopped being the most likely pick');
  console.log('  quiet position, depth 3, 30 searches -> ' + picks.size + ' different moves chosen, ' +
    softSeen + ' flagged near-tie, best move chosen ' + topPick[1] + 'x');

  // with variety switched off the same position must give the same move
  const fixed = new Set();
  for (let i = 0; i < 8; i++) fixed.add(q.search(A, 'hard', { maxDepth: 3, minDepth: 3, timeMs: 1500, tieChance: 0 }).cell);
  ok(fixed.size === 1, 'tieChance 0 still produced ' + fixed.size + ' different moves');

  // a proven win is never randomised
  const wins = new Set();
  let proofScore = 0;
  for (let i = 0; i < 20; i++) {
    const r = g0.search(A, 'hard', {});
    wins.add(r.cell); proofScore = r.score;
  }
  ok(wins.size === 1, 'a guaranteed five was played ' + wins.size + ' different ways');
  ok(proofScore >= 1e8, 'the guaranteed five was not scored as a win (' + proofScore + ')');

  // the same discipline for a forced block at the shallowest setting: B has 11..14 on row 10,
  // the (10,10) stone closes one end, so (15,10) is the single block square
  const g1 = mk(S, [id(S,10,10), id(S,11,10), id(S,0,0), id(S,12,10), id(S,0,1), id(S,13,10), id(S,0,2), id(S,14,10)]);
  const blk = g1.search(A, 'easy', { maxDepth: 0, minDepth: 0, timeMs: 1500 });
  ok(blk.forced === 'must block the five' && blk.cell === id(S, 15, 10),
    'depth 0 / easy did not block the enemy five (' + blk.forced + ' ' + nm(S, blk.cell) + ')');
}

/* ---------- 9. forced-tactic branch matches ground truth at every ply ---------- */
console.log('[9] forced tactic labels, single vs double five-threats');
{
  const S = 25, OV = { maxDepth: 5, minDepth: 2, timeMs: 300, tieChance: 0 };
  const g = ENG.createGame({ size: S, win: 5 });
  let badLabel = 0, badBlock = 0, unsearchedBlock = 0, fakeLoss = 0, dupThreat = 0, ply = 0;

  for (; ply < 46 && !g.winner() && !g.isFull(); ply++) {
    const p = g.turn(), o = p === A ? B : A;
    const mine = g.threatCells(p), theirs = g.threatCells(o);
    if (mine.length !== new Set(mine).size || theirs.length !== new Set(theirs).size) dupThreat++;
    const r = g.search(p, 'medium', OV);
    if (mine.length) {
      if (r.forced !== 'completes five now') badLabel++;
      else if (mine.indexOf(r.cell) < 0) badBlock++;
    } else if (theirs.length > 1) {
      if (r.forced !== 'double threat - already lost') badLabel++;
      else if (theirs.indexOf(r.cell) < 0) badBlock++;
    } else if (theirs.length === 1) {
      if (r.forced !== 'must block the five') badLabel++;
      else if (r.cell !== theirs[0]) badBlock++;
      else if (!(r.nodes > 0)) unsearchedBlock++;                 // a block deserves a real score
      else if (!Number.isFinite(r.score)) fakeLoss++;             // and must be measured, not invented
    } else if (r.forced !== 'search' && r.forced !== 'opening variation') badLabel++;
    g.play(r.cell);
    // after a single-square block the enemy must no longer hold a five-completion
    if (theirs.length === 1 && g.winner() === 0 && g.threatCells(g.turn()).length !== 0) fakeLoss++;
  }
  ok(dupThreat === 0, 'the engine reported the same five-threat cell twice');
  ok(badLabel === 0, badLabel + ' moves were labelled with the wrong forced tactic');
  ok(badBlock === 0, badBlock + ' forced replies did not answer the actual five-threat');
  ok(unsearchedBlock === 0, unsearchedBlock + ' forced blocks were returned without any search at depth 6');
  ok(fakeLoss === 0, fakeLoss + ' rescued positions were scored as a certain loss');
  console.log('  ' + ply + ' plies checked: five-threats answered correctly, blocks searched, no false "already lost"');

  // a single closed four: exactly one block square, and the rescue is real
  const g1 = mk(25, [id(25,10,10), id(25,11,10), id(25,0,0), id(25,12,10), id(25,0,1), id(25,13,10), id(25,0,2), id(25,14,10)]);
  const r1 = g1.search(A, 'hard', OV);
  ok(r1.forced === 'must block the five' && r1.cell === id(25, 15, 10),
    'single closed four: expected a searched block, got ' + r1.forced + ' ' + nm(25, r1.cell));
  ok(r1.nodes > 0 && r1.depth >= 1, 'the forced block was not searched (' + r1.nodes + ' nodes, depth ' + r1.depth + ')');
  ok(r1.score > -1e8, 'the forced block claimed a lost game: ' + r1.score);

  // four in a row for O with both ends clear: two five squares, so A is lost whichever it takes
  const g2 = mk(25, [id(25,6,6), id(25,11,10), id(25,7,14), id(25,12,10), id(25,13,17), id(25,13,10), id(25,16,16), id(25,14,10)]);
  const r2 = g2.search(A, 'hard', OV);
  ok(r2.forced === 'double threat - already lost', 'open four for the enemy was not called a lost game: ' + r2.forced);
  ok(g2.threatCells(B).length === 2, 'expected two enemy five squares in the open-four position');

  /* Ask the same position again after the engine has searched a lot around it. The double
     threat is read from the live threat bookkeeping, so if any undo dropped a window's
     threat while searching, the tactic stops being recognised on the second look. */
  const g3 = mk(25, [id(25,6,6), id(25,11,10), id(25,7,14), id(25,12,10), id(25,13,17), id(25,13,10), id(25,16,16), id(25,14,10)]);
  g3.search(A, 'expert', { maxDepth: 9, minDepth: 2, timeMs: 1200, timeMsSet: true, tieChance: 0 });
  g3.search(B, 'hard', { maxDepth: 7, minDepth: 2, timeMs: 700, timeMsSet: true, tieChance: 0 });
  const st4 = g3.stats();
  ok(st4.fourB === 2, 'searching desynchronised the four-counter: fourB ' + st4.fourB + ', expected 2');
  const r3 = g3.search(A, 'hard', OV);
  ok(r3.forced === 'double threat - already lost',
    'after searching, the double threat was no longer recognised: ' + r3.forced + ' ' + nm(25, r3.cell));
  ok(r3.cell === r2.cell, 'the double-threat answer changed between identical searches: ' +
    nm(25, r2.cell) + ' vs ' + nm(25, r3.cell));
  // four in a row for O with one end already blocked: one five square, so it is rescuable
  const g4 = mk(25, [id(25,6,6), id(25,11,10), id(25,7,14), id(25,12,10), id(25,13,17), id(25,13,10), id(25,10,10), id(25,14,10)]);
  const r4a = g4.search(A, 'hard', OV);
  g4.search(A, 'expert', { maxDepth: 9, minDepth: 2, timeMs: 1200, timeMsSet: true, tieChance: 0 });
  const r4b = g4.search(A, 'hard', OV);
  ok(r4a.forced !== 'double threat - already lost' && r4b.forced !== 'double threat - already lost',
    'one-block position called lost: before "' + r4a.forced + '", after a deep search "' + r4b.forced + '"');
  ok(r4a.cell === r4b.cell, 'the block answer moved after searching: ' + nm(25, r4a.cell) + ' vs ' + nm(25, r4b.cell));

  // pinning deep plies must stay near the clock instead of running 4x past it
  const q = mk(25, [id(25,12,12), id(25,13,13), id(25,11,13), id(25,14,11)]);
  const rp = q.search(A, 'hard', { maxDepth: 12, minDepth: 12 });
  ok(rp.ms < 5200, 'a pinned 12-ply search ran ' + rp.ms + ' ms on the default clock');
  ok(rp.depth >= 4, 'a pinned 12-ply search barely deepened: ' + rp.depth);
  console.log('  pinned 12 plies on a quiet position: depth ' + rp.depth + ', ' + rp.nodes.toLocaleString('en-US') +
    ' nodes, ' + rp.ms + ' ms' + (rp.aborted ? ' (cut off)' : ''));
}

/* ---------- 10. proof handling: a proven win stops, a proven loss keeps working ---------- */
console.log('[10] proof handling: forced win stops short, forced loss resists');
{
  // B holds two open threes and A has no counterplay, so A is lost. "Lost" must not mean
  // "resigned at the first proof": the deeper the proof, the more plies the win must be forced.
  const S = 19, id = (x, y) => y * S + x;
  const fixture = [id(1, 1), id(10, 10), id(3, 4), id(11, 10), id(5, 7), id(12, 10),
                   id(7, 2), id(14, 6), id(9, 3), id(15, 7), id(11, 1), id(16, 8)];
  const g = ENG.createGame({ size: S, win: 5 });
  for (const c of fixture) g.play(c);
  const deep = { maxDepth: 10, minDepth: 2, timeMs: 1500, timeMsSet: true, tieChance: 0 };
  const rl = g.search(A, 'hard', deep);                  // the losing side to move
  const rw = g.search(B, 'hard', deep);                  // same board, winning side to move
  console.log('  losing side : depth ' + rl.depth + '  "' + rl.stop + '"  five delayed ' + rl.mate +
    ' ply  ' + rl.nodes.toLocaleString('en-US') + ' nodes  ' + rl.ms + ' ms  ' + nm(S, rl.cell));
  console.log('  winning side: depth ' + rw.depth + '  "' + rw.stop + '"  five in ' + rw.mate +
    ' ply  ' + rw.nodes.toLocaleString('en-US') + ' nodes  ' + rw.ms + ' ms  ' + nm(S, rw.cell));
  ok(rl.forced === 'search', 'the lost position was answered by a tactic shortcut: ' + rl.forced);
  ok(/proved a forced loss/.test(rl.stop || ''),
    'the lost side stopped as if the proof ended the work: "' + rl.stop + '"');
  ok(rl.mate > 0, 'the lost side did not say how long the five is delayed');
  ok(rw.stop === 'proved a forced win', 'the winning side did not stop on its proof: "' + rw.stop + '"');
  ok(rw.mate > 0 && rw.mate <= 64, 'the winning side did not report the distance to the five: ' + rw.mate);
  ok(rl.depth > rw.depth,
    'the lost side searched no deeper than the winning one: ' + rl.depth + ' vs ' + rw.depth);
  ok(rl.ms >= rw.ms + 100, 'the lost side handed its clock back: ' + rl.ms + ' ms vs ' + rw.ms + ' ms');
  /* The same proof has to be reachable at a shallow depth. Before the live-line squares were
     in the move set, the extension that wins this position was simply not a move the search
     could try, so a 6-ply search saw nothing wrong with the board at all. */
  const rl6 = g.search(A, 'hard', { maxDepth: 6, minDepth: 2, timeMs: 1500, timeMsSet: true, tieChance: 0 });
  console.log('  at 6 plies  : depth ' + rl6.depth + '  "' + rl6.stop + '"  five delayed ' + rl6.mate +
    ' ply  ' + rl6.nodes.toLocaleString('en-US') + ' nodes  ' + rl6.ms + ' ms');
  ok(/proved a forced loss/.test(rl6.stop || ''),
    'a 6-ply search did not see the loss that wins this position: "' + rl6.stop + '" score ' + rl6.score);
  ok(rl6.mate === rl.mate, 'the proven distance moved with depth: ' + rl6.mate + ' at 6 ply vs ' + rl.mate + ' at 10 ply');
  // best resistance shortens the enemy win by exactly one ply, never more
  g.play(rl.cell);
  const rb = g.search(B, 'hard', deep);
  console.log('  after that defence: "' + rb.stop + '"  five in ' + rb.mate + ' ply (was delayed ' + rl.mate + ')');
  ok(rb.mate === rl.mate - 1,
    'the defence gave up more than one ply of resistance: ' + rl.mate + ' -> ' + rb.mate);
  // the winning line must be the real one: the move that makes an unbeatable open four
  const g2 = ENG.createGame({ size: S, win: 5 });
  for (const c of fixture.concat([rl.cell])) g2.play(c);
  const rw2 = g2.search(B, 'hard', deep);
  g2.play(rw2.cell);
  const st = g2.stats();
  console.log('  winning move: ' + nm(S, rw2.cell) + ' -> fourB ' + st.fourB + ', five squares ' +
    g2.threatCells(B).length);
  ok(st.fourB >= 2, 'the proven win did not make an open four: fourB ' + st.fourB + ' after ' + nm(S, rw2.cell));
  ok(g2.threatCells(B).length >= 2, 'the open four left fewer than two five squares: ' + g2.threatCells(B).length);

  /* The distance the engine promises has to be the distance the board delivers. Play the
     proven line out for real - the loser resisting, the winner forcing - and count the
     half-moves. This is also the parity check that makes "their five in 2 moves" in the
     report something a player can rely on. */
  const gp = ENG.createGame({ size: S, win: 5 });
  for (const c of fixture) gp.play(c);
  const pr = gp.search(A, 'hard', deep);
  ok(pr.score < 0 ? pr.mate % 2 === 0 : pr.mate % 2 === 1,
    'a proven five cannot land on that side of the board: ' + pr.mate + ' ply with score ' + pr.score);
  gp.play(pr.cell);
  let plies = 1;
  while (!gp.winner() && plies < 24) {
    const p = gp.turn();
    const r = gp.search(p, 'hard', deep);
    if (r.cell < 0) break;
    gp.play(r.cell); plies++;
  }
  console.log('  played out  : ' + (gp.winner() ? 'five after ' + plies + ' half-moves, promised ' + pr.mate
    : 'no five within 24 plies') + '  winner=' + gp.winner());
  ok(gp.winner() !== 0, 'the proven line never produced a five on the board');
  ok(plies === pr.mate, 'the engine promised the five after ' + pr.mate + ' half-moves; the board took ' + plies);
}

console.log('\n' + (fails ? 'FAILED ' + fails + ' of ' + checks + ' checks' : 'ALL PASS — ' + checks + ' checks'));
process.exit(fails ? 1 : 0);
