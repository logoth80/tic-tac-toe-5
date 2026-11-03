/* First-move advantage, measured on the product's own levels.
 *
 * The question: at equal strength on both sides, does the player who moves first win more?
 * Both sides are the same level, the same engine code, the same clock - the only asymmetry is
 * who moves first. The levels are the shipped ones (their clocks and ply ceilings), so the answer
 * is about the game as it is played rather than about some abstract depth.
 *
 * Two things this run cannot help, and says so out loud:
 *   - the level's `threads` value is the page's worker pool. This harness has no workers, so both
 *     sides search on one core. That lowers absolute strength at medium and hard; it does not
 *     break the symmetry the question depends on.
 *   - the game is free-style gomoku: no three-three, four-four or overline bans, no swap rule.
 *     Such games are known to favour the first player in principle; what is measured here is
 *     how much of that a given level actually converts into wins.
 *
 * Every game is written to qa/first-move.jsonl as it finishes - including the whole move list, so
 * a question that was not thought of before the run can still be answered from the record without
 * playing another game. qa/first-move-summary.md is rewritten as each stratum finishes.
 *
 * Usage: node tests/first-move.mjs [--games 100] [--levels easy,medium,hard] [--size 25]
 *                                  [--max-plies 200] [--seed 0x5EED0000] [--permutations 10000]
 */
import fs from 'node:fs';
import os from 'node:os';

const html = fs.readFileSync(new URL('../match5.html', import.meta.url), 'utf8');
const block = html.match(/\/\*__ENGINE_START__\*\/([\s\S]*?)\/\*__ENGINE_END__\*\//);
if (!block) { console.error('ENGINE markers not found in match5.html'); process.exit(1); }
const ENG = eval('(' + block[1].trim() + ')')();
const A = ENG.A, B = ENG.B;
const name = (cell) => {
  const x = cell % SIZE, y = Math.floor((cell - x) / SIZE);
  return String.fromCharCode(97 + (x % 26)) + (y + 1);
};

/* ---------------- arguments ---------------- */
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const GAMES = Math.max(1, Math.min(1000, Number(flag('games', 100)) || 100));
const SIZE = Math.max(9, Math.min(40, Number(flag('size', 25)) || 25));
const MAX_PLIES = Math.max(10, Number(flag('max-plies', 200)) || 200);
const SEED = (Number(flag('seed', 0x5EED0000)) || 0) >>> 0;
const PERMS = Math.max(200, Math.min(200000, Number(flag('permutations', 10000)) || 10000));
const levels = String(flag('levels', 'easy,medium,hard')).split(',').map((s) => s.trim()).filter(Boolean);
const bad = levels.filter((l) => !ENG.LEVEL_ORDER.includes(l));
if (bad.length) { console.error('unknown level(s): ' + bad.join(',') + ' - offered: ' + ENG.LEVEL_ORDER.join(',')); process.exit(1); }

const RECORD = new URL('../qa/first-move.jsonl', import.meta.url);
const SUMMARY = new URL('../qa/first-move-summary.md', import.meta.url);
const RUN = new Date().toISOString().replace(/[:.]/g, '-');
const t0run = Date.now();

/* ---------------- numbers ---------------- */
/* The statistics are written here rather than taken from a package: the whole point is that the
   numbers can be read and checked. A proportion's interval is Wilson's (a point estimate alone
   would be read as fact); the test for "is this stratum's split different from chance" is the
   exact binomial (the sign test) rather than a normal approximation, because 100 games is not
   large enough for that shortcut to be free; and the test across strata is a permutation test
   with the same dice every time, so the p it reports is reproducible and not a coin flip itself. */
const Z95 = 1.959963985;
function wilson(k, n) {
  if (!n) return null;
  const p = k / n, d = 1 + Z95 * Z95 / n;
  const c = (p + Z95 * Z95 / (2 * n)) / d;
  const h = Z95 * Math.sqrt(p * (1 - p) / n + Z95 * Z95 / (4 * n * n)) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
function logChoose(n, k) {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}
function signTest(k, n) {           // two-sided exact test of a split against 50/50
  const m = Math.min(k, n - k);
  let tail = 0;
  for (let i = 0; i <= m; i++) tail += Math.exp(logChoose(n, i) - n * Math.LN2);
  return Math.min(1, 2 * tail);
}
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
const pct = (x) => (x === null ? '—' : (100 * x).toFixed(1) + '%');
const fmtP = (p) => (p < 1e-4 ? p.toExponential(2) : p.toFixed(4));
const p3 = (x) => (x === null ? '—' : x.toFixed(3));
const sig = (n) => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
const clock = (ms) => {
  const s = Math.round(ms / 1000);
  return s < 3600 ? Math.floor(s / 60) + 'm' + String(s % 60).padStart(2, '0') + 's'
                  : Math.floor(s / 3600) + 'h' + String(Math.floor(s / 60) % 60).padStart(2, '0') + 'm';
};

/* deterministic dice for the permutation test, and for shuffling which stratum runs first */
let rng = 0x9E3779B9 ^ SEED;
const next = () => { rng ^= rng << 13; rng >>>= 0; rng ^= rng >>> 17; rng ^= rng << 5; rng >>>= 0; return rng / 4294967296; };

function fisher(a, b, c, d) {
  /* Fisher's exact test on two strata's decisive games. Comparing two 100-game strata by eyeing
     whether their intervals overlap is a rule of thumb; this is the actual probability that the
     two splits, or more extreme ones, came from the same underlying rate. */
  const n = a + b + c + d, r1 = a + b, c1 = a + c;
  /* the denominator is the number of ways to place the column total anywhere in the table, not n!:
     getting that wrong leaves a constant offset per table, which does not change which tables are
     more extreme but makes the summed probability meaningless */
  const lsel = (k) => logChoose(r1, k) + logChoose(n - r1, c1 - k) - logChoose(n, c1);
  const lo = Math.max(0, c1 - (n - r1)), hi = Math.min(r1, c1), obs = lsel(a);
  let p = 0;
  for (let k = lo; k <= hi; k++) { if (lsel(k) <= obs + 1e-9) p += Math.exp(lsel(k)); }
  return Math.min(1, p);
}
function stratifiedPermutation(strata, perms) {
  /* Strata = [{wins, losses}]. Under the null there is no first-move advantage at any level, so
     inside a stratum the label "first player won" is exchangeable with "second player won": flip
     it at random and see how large |X - n/2| gets. Two statistics: the pooled z (one-sided
     direction-free, i.e. the strength of the pooled effect) and the spread between strata. */
  const obs = strata.map((s) => s.wins - s.losses);
  const obsPool = obs.reduce((a, b) => a + b, 0);
  const obsSpread = Math.max(...strata.map((s, i) => {
    const n = s.wins + s.losses;
    return n ? Math.abs((s.wins - n / 2) / n) : 0;
  })) - Math.min(...strata.map((s, i) => {
    const n = s.wins + s.losses;
    return n ? Math.abs((s.wins - n / 2) / n) : 0;
  }));
  let gePool = 0, geSpread = 0;
  for (let p = 0; p < perms; p++) {
    let pool = 0, rates = [];
    for (const s of strata) {
      const n = s.wins + s.losses;
      let w = 0;
      for (let i = 0; i < n; i++) if (next() < 0.5) w++;
      pool += w - (n - w);
      rates.push(n ? Math.abs((w - n / 2) / n) : 0);
    }
    if (Math.abs(pool) >= Math.abs(obsPool)) gePool++;
    const spread = Math.max(...rates) - Math.min(...rates);
    if (spread >= obsSpread) geSpread++;
  }
  return { poolP: (gePool + 1) / (perms + 1), spreadP: (geSpread + 1) / (perms + 1) };
}

/* The statistics get tests of their own, with values worked out by hand, because a p printed under
   a heading is otherwise just arithmetic nobody checked:
     - 10-0 is 2/2^10 = 0.001953;
     - 8-4 of 12: 2*(1+12+66+220+495)/4096 = 1588/4096 = 0.38770;
     - Wilson for 1 of 10: centre (0.1+0.1920)/1.384 = 0.2124, half-width 1.96*sqrt(0.009+0.0096)/1.384
       = 0.1931, so 0.019 - 0.406;
     - the 5-0 / 0-5 table: P(a) = C(5,a)C(5,5-a)/C(10,5) over 252, so the only tables at least as
       improbable as the observed one are a=0 and a=5, 2/252 = 0.00794 (this is the ordering that
       sums every table no more likely than the observed one - R's two-sided definition differs
       slightly, and this test is the check that this one is what it says it is);
     - an even split must give p = 1. */
function selfTest() {
  const fails = [];
  const near = (a, b, tol, what) => { if (!(Math.abs(a - b) <= tol)) fails.push(what + ': got ' + a + ', expected ' + b); };
  near(signTest(10, 10), 0.001953, 1e-5, 'sign test 10-0');
  near(signTest(8, 12), 0.38770, 1e-4, 'sign test 8-4');
  const w = wilson(1, 10);
  near(w[0], 0.0193, 2e-3, 'Wilson lower for 1 of 10');
  near(w[1], 0.4055, 2e-3, 'Wilson upper for 1 of 10');
  near(fisher(5, 0, 0, 5), 0.00794, 1e-4, 'Fisher on 5-0/0-5');
  if (fisher(50, 50, 50, 50) < 0.999) fails.push('Fisher on an even split should be 1, got ' + fisher(50, 50, 50, 50));
  if (fails.length) { console.error('statistics self-check FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('statistics self-check: sign test, Wilson interval, Fisher exact - ok (values worked out by hand)');
}
selfTest();

/* ---------------- one stratum (a level pair) ---------------- */
function newAcc() {
  return {
    level: null, games: 0, first: 0, second: 0, draw: 0, unfinished: 0, stalled: 0,
    pliesAll: [], pliesFirst: [], pliesSecond: [],
    loserKnew: 0, loserKnewPly: [], winnerProved: 0,
    depth: [], nodes: [], ms: [], proofs: 0, soft: 0, softUnknown: false, forcedBlocks: 0,
    secondsPerGame: 0, dirs: {}, openings: {},
    rows: [],
  };
}

function dirOf(line) {
  if (!line || line.length < 2) return 'n/a';
  const s = SIZE;
  const x0 = line[0] % s, y0 = Math.floor(line[0] / s);
  const x1 = line[1] % s, y1 = Math.floor(line[1] / s);
  if (y0 === y1) return 'horizontal';
  if (x0 === x1) return 'vertical';
  return (x1 - x0) * (y1 - y0) > 0 ? 'diagonal down-right' : 'diagonal up-right';
}

function playGame(level, dice) {
  const g = ENG.createGame({ size: SIZE, win: 5 });
  const perPly = [];
  let plies = 0, stalled = false;
  while (!g.winner() && !g.isFull() && plies < MAX_PLIES) {
    const p = g.turn();
    const r = g.search(p, level, { entropy: dice });
    if (r.cell < 0) { stalled = true; break; }
    perPly.push({ side: p, depth: r.depth, target: r.target, nodes: r.nodes, ms: r.ms,
                  proved: r.mate > 0 ? (r.score > 0 ? 'win' : 'loss') : null,
                  forced: r.forced, soft: !!r.soft, cell: r.cell });
    g.play(r.cell);
    plies++;
  }
  const winner = g.winner();
  const win = g.findWin();
  return { g, perPly, plies, stalled, winner, winLine: win ? win.line : null };
}

function runStratum(level, acc) {
  const cfg = ENG.LEVELS[level];
  acc.level = level;
  console.log('\n[' + level + ' vs ' + level + ']  ' + GAMES + ' games on a ' + SIZE + 'x' + SIZE +
    ' board - clock ' + cfg.timeMs + ' ms per move, up to ' + cfg.maxDepth + ' plies, ' +
    cfg.rootBranch + ' root squares, one core per side (the level\'s ' + cfg.threads +
    ' worker hint is the page\'s pool, which this harness does not use)');
  for (let i = 0; i < GAMES; i++) {
    /* a different dice per game: reproducible, and not the same game over and over. The stratum
       is mixed in so the easy run's 37th game and the hard run's 37th game do not share a seed. */
    const dice = (SEED + i * 0x9E3779B1 + levels.indexOf(level) * 0x85EBCA6B) >>> 0;
    const t0 = Date.now();
    const r = playGame(level, dice);
    const dur = Date.now() - t0;
    acc.games++;
    acc.secondsPerGame += dur;
    for (const p of r.perPly) {
      acc.depth.push(p.depth); acc.nodes.push(p.nodes); acc.ms.push(p.ms);
      if (p.proved) acc.proofs++;
      if (p.soft) acc.soft++;
      if (p.forced === 'must block the five' || p.forced === 'double threat - already lost') acc.forcedBlocks++;
    }
    const moves = r.perPly.map((p) => p.cell).map(name);   // the record keeps the whole move list
    const outcome = r.winner ? (r.winner === A ? 'first' : 'second') : (r.stalled ? 'stalled' : 'draw');
    if (outcome === 'first') acc.first++; else if (outcome === 'second') acc.second++;
    else if (outcome === 'draw') acc.draw++; else { acc.unfinished++; acc.stalled++; }
    if (outcome !== 'stalled') {
      acc.pliesAll.push(r.plies);
      if (outcome === 'first') acc.pliesFirst.push(r.plies); else if (outcome === 'second') acc.pliesSecond.push(r.plies);
      if (r.winLine) { const d = dirOf(r.winLine); acc.dirs[d] = (acc.dirs[d] || 0) + 1; }
      /* did the loser see it coming, and did the winner already know? both are read out of the
         engines' own proven-line reports, so this is the engines' account, not an outside guess */
      const loser = outcome === 'first' ? B : A;
      const firstKnew = r.perPly.findIndex((p) => p.side === loser && p.proved === 'loss');
      if (firstKnew >= 0) { acc.loserKnew++; acc.loserKnewPly.push(firstKnew + 1); }
      const winSide = outcome === 'first' ? A : B;
      if (r.perPly.some((p) => p.side === winSide && p.proved === 'win')) acc.winnerProved++;
      acc.openings[moves.slice(0, 2).join(' ')] = (acc.openings[moves.slice(0, 2).join(' ')] || 0) + 1;
    }
    fs.appendFileSync(RECORD, JSON.stringify({
      run: RUN, level, game: i + 1, dice: '0x' + dice.toString(16), size: SIZE,
      outcome, plies: r.plies, stalled: r.stalled, durationMs: dur,
      moves, five: r.winLine ? r.winLine.map(name) : null,
      fiveDirection: dirOf(r.winLine),
      perPly: r.perPly.map((p) => [p.side === A ? 'X' : 'O', name(p.cell), p.depth, p.nodes, p.ms, p.proved, p.forced, p.soft ? 1 : 0]),
    }) + '\n');
    const decisive = acc.first + acc.second;
    console.log('  g' + String(i + 1).padStart(4) + '/' + GAMES + '  ' +
      (outcome === 'first' ? 'X (first) wins in ' + r.plies + ' plies'
        : outcome === 'second' ? 'O (second) wins in ' + r.plies + ' plies'
        : outcome === 'draw' ? 'board full, no five after ' + r.plies + ' plies'
        : 'no move returned after ' + r.plies + ' plies') +
      '  [' + (r.perPly.length ? r.perPly[r.perPly.length - 1].forced + ' at ' + name(r.perPly[r.perPly.length - 1].cell) : 'no search') + ']' +
      '  dice=0x' + dice.toString(16) + '  ' + clock(dur) +
      '  |  running: first ' + acc.first + '  second ' + acc.second + '  draw ' + acc.draw +
      (acc.unfinished ? '  unfinished ' + acc.unfinished : '') +
      (decisive ? '  first ' + pct(acc.first / decisive) : ''));
    if ((i + 1) % 10 === 0) { writeSummary(); console.log('  .. summary refreshed in qa/first-move-summary.md after ' + (i + 1) + ' games'); }
  }
  console.log(stratumReport(acc).join('\n'));
}

function stratumReport(acc) {
  const decisive = acc.first + acc.second;
  const rate = decisive ? acc.first / decisive : null;
  const ci = wilson(acc.first, decisive);
  const p = decisive ? signTest(acc.first, decisive) : null;
  const srt = (a) => a.slice().sort((x, y) => x - y);
  const q = (a, x) => quantile(srt(a), x);
  const mean = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
  const out = [];
  out.push('  == ' + acc.level + ' after ' + acc.games + ' games');
  out.push('     first player (X) won ' + acc.first + ', second player (O) won ' + acc.second +
    ', draws ' + acc.draw + (acc.unfinished ? ', unfinished ' + acc.unfinished + ' (' + acc.stalled + ' stalled)' : ''));
  out.push('     first wins ' + pct(rate) + ' of ' + decisive + ' decisive games; 95% CI ' +
    (ci ? (100 * ci[0]).toFixed(1) + '-' + (100 * ci[1]).toFixed(1) + '%' : '—') +
    '; exact sign test p = ' + (p === null ? '—' : p < 1e-4 ? p.toExponential(1) : p.toFixed(4)));
  out.push('     plies to the five: median ' + q(acc.pliesAll, 0.5) + ', mean ' + p3(mean(acc.pliesAll)) +
    (acc.pliesAll.length ? ', ' + Math.min(...acc.pliesAll) + '-' + Math.max(...acc.pliesAll) : ' (no decisive games)'));
  if (acc.pliesFirst.length && acc.pliesSecond.length) {
    out.push('       when the first player wins: median ' + q(acc.pliesFirst, 0.5) + ', mean ' + p3(mean(acc.pliesFirst)) +
      '  |  when the second player wins: median ' + q(acc.pliesSecond, 0.5) + ', mean ' + p3(mean(acc.pliesSecond)));
  }
  out.push('     forced lines the engines reported about their own position - inside that level\'s horizon of ' +
    ENG.LEVELS[acc.level].maxDepth + ' plies, so this is the engine\'s short view rather than a proof about the game:' +
    ' the losing side had seen a forced loss in ' + acc.loserKnew + ' of ' + decisive + ' decisive games, first at ply ' +
    (acc.loserKnewPly.length ? q(acc.loserKnewPly, 0.5) : '—') + ' (median of those); the winner had a forced win in hand in ' +
    acc.winnerProved);
  const dirs = Object.entries(acc.dirs).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v);
  out.push('     fives by direction: ' + (dirs.join(', ') || '—'));
  out.push('     per move on one core: depth mean ' + p3(mean(acc.depth)) + ' of ceiling ' + ENG.LEVELS[acc.level].maxDepth +
    ', nodes mean ' + sig(Math.round(mean(acc.nodes) || 0)) + ', ms mean ' + Math.round(mean(acc.ms) || 0) +
    ', ' + acc.proofs + ' forced lines reported, ' + acc.forcedBlocks + ' forced blocks, ' +
    (acc.softUnknown ? 'near-tie picks were not recorded by that run' : acc.soft + ' near-tie picks'));
  out.push('     wall clock ' + clock(acc.secondsPerGame) + ' for this stratum, mean ' + clock(acc.secondsPerGame / acc.games) + ' per game');
  return out;
}

/* ---------------- overall ---------------- */
const done = [];
function writeSummary() {
  const lines = [];
  lines.push('# First-move advantage - ' + (done.length < levels.length ? 'in progress' : 'complete') +
    '  (run ' + RUN + ')');
  lines.push('');
  lines.push('Both sides the same level and the same engine; only who moves first differs. ' +
    SIZE + 'x' + SIZE + ', no forbidden moves, no swap rule, one core per side ' +
    '(the level worker pool belongs to the page and is not used here). Dice base 0x' + SEED.toString(16) +
    ', games per stratum ' + GAMES + '.');
  lines.push('');
  lines.push('| level | games | first wins | second wins | draws | first share of decisive | 95% CI | sign test p | median plies |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const a of done) {
    const dec = a.first + a.second, ci = wilson(a.first, dec);
    lines.push('| ' + a.level + ' | ' + a.games + ' | ' + a.first + ' | ' + a.second + ' | ' + a.draw +
      ' | ' + pct(dec ? a.first / dec : null) + ' | ' + (ci ? (100 * ci[0]).toFixed(1) + '-' + (100 * ci[1]).toFixed(1) : '—') +
      ' | ' + (dec ? signTest(a.first, dec).toFixed(4) : '—') + ' | ' + quantile(a.pliesAll.slice().sort((x, y) => x - y), 0.5) + ' |');
  }
  if (done.length) {
    const tot = done.reduce((t, a) => ({ first: t.first + a.first, second: t.second + a.second, draw: t.draw + a.draw }), { first: 0, second: 0, draw: 0 });
    const dec = tot.first + tot.second, ci = wilson(tot.first, dec);
    lines.push('');
    lines.push('Across the strata above: first player ' + tot.first + ', second player ' + tot.second +
      ', share ' + pct(dec ? tot.first / dec : null) + ' (95% CI ' + (ci ? (100 * ci[0]).toFixed(1) + '-' + (100 * ci[1]).toFixed(1) : '—') +
      '). Stratified sign-flip permutation test (' + PERMS + ' shuffles): p = ' +
      stratifiedPermutation(done.map((a) => ({ wins: a.first, losses: a.second })), PERMS).poolP.toFixed(4));
    lines.push('');
    lines.push(REPORT
      ? 'Engine time measured inside the games: ' + clock(done.reduce((s, a) => s + a.secondsPerGame, 0)) +
        ' across ' + done.reduce((s, a) => s + a.games, 0) + ' games.'
      : 'Elapsed ' + clock(Date.now() - t0run) + '.');
  }
  lines.push('');
  lines.push('A share of 50% would mean no advantage. What ' + GAMES + ' decisive games per stratum can resolve is about');
  lines.push('±' + Math.round(100 * Z95 * Math.sqrt(0.25 / Math.max(1, GAMES))) + ' percentage points in one stratum; reading several strata together can see less than that,');
  lines.push('so the interval is the result, not the share.');
  fs.writeFileSync(SUMMARY, lines.join('\n'));
}

console.log('first-move advantage - ' + levels.join(', ') + ' - ' + GAMES + ' games each, ' + SIZE + 'x' + SIZE);
console.log('  identical engines on both sides; the only difference is who moves first');
console.log('  level clocks and ply ceilings exactly as shipped, single core per side:',
  levels.map((l) => l + ' ' + ENG.LEVELS[l].timeMs + 'ms/' + ENG.LEVELS[l].maxDepth + 'ply').join('  '));
console.log('  free-style gomoku: no three-three/overline bans, no swap rule - those restrictions exist');
console.log('  precisely because this game favours the first player in theory, and they are not in force here');
console.log('  dice base 0x' + SEED.toString(16) + ' (reproduce with --seed 0x' + SEED.toString(16) + '); record: qa/first-move.jsonl');
console.log('  node ' + process.version + ', ' + (os.availableParallelism?.() ?? os.cpus().length) +
  ' logical cores on this machine, of which this run uses one');

function printOverall(strata, elapsedMs, note) {
  const games = strata.reduce((s, a) => s + a.games, 0);
  console.log('\n== overall: ' + strata.length + ' strata, ' + games + ' games' +
    (elapsedMs === null ? ' ' + note : ', elapsed ' + clock(elapsedMs)));
  console.log(strata.map((a) => stratumReport(a).join('\n')).join('\n'));
  const tot = strata.reduce((t, a) => ({ first: t.first + a.first, second: t.second + a.second, draw: t.draw + a.draw }), { first: 0, second: 0, draw: 0 });
  const dec = tot.first + tot.second, ciTot = wilson(tot.first, dec);
  console.log('  pooled: first player won ' + tot.first + ', second player ' + tot.second + ', draws ' + tot.draw +
    '; first share of decisive games ' + pct(dec ? tot.first / dec : null) + ' (95% CI ' +
    (ciTot ? (100 * ciTot[0]).toFixed(1) + '-' + (100 * ciTot[1]).toFixed(1) + '%' : '—') + ')');
  const st = stratifiedPermutation(strata.map((a) => ({ wins: a.first, losses: a.second })), PERMS);
  console.log('  stratified test - pooled first-move effect p = ' + fmtP(st.poolP) +
    '; difference between strata (spread of their shares) p = ' + fmtP(st.spreadP));
  const pairs = [];
  for (let i = 0; i < strata.length; i++) for (let j = i + 1; j < strata.length; j++) {
    const x = strata[i], y = strata[j];
    const nx = x.first + x.second, ny = y.first + y.second;
    pairs.push('    ' + x.level + ' vs ' + y.level + ': first-player share ' + pct(x.first / nx) + ' (' + x.first + '/' + nx +
      ') vs ' + pct(y.first / ny) + ' (' + y.first + '/' + ny + ')  Fisher exact p = ' + fmtP(fisher(x.first, x.second, y.first, y.second)));
  }
  console.log('  pairs of strata, Fisher exact on their decisive games:');
  console.log(pairs.join('\n'));
  console.log('  reading: a stratum whose CI covers 50% has shown nothing at that level. The pooled p says');
  console.log('  whether the strata together point one way; the between-strata p says whether the');
  console.log('  advantage grows or shrinks with the clock, and the pairwise rows say which two levels genuinely');
  console.log('  differ. None of it is meaningful without the intervals above.');
}

/* Rebuilding a stratum from the record is what makes the record worth keeping: the same report can
   be printed from the games that were played without playing them again, and any other question
   about those games can be answered from the move lists in the same file. */
function accFromRecord(rows, level) {
  const acc = newAcc();
  acc.level = level;
  for (const r of rows) {
    acc.games++;
    acc.secondsPerGame += r.durationMs || 0;
    for (const p of r.perPly) {
      acc.depth.push(p[2]); acc.nodes.push(p[3]); acc.ms.push(p[4]);
      if (p[5]) acc.proofs++;
      if (p[6] === 'must block the five' || p[6] === 'double threat - already lost') acc.forcedBlocks++;
      if (p[7] === undefined) acc.softUnknown = true; else if (p[7]) acc.soft++;
    }
    if (r.outcome === 'first') acc.first++;
    else if (r.outcome === 'second') acc.second++;
    else if (r.outcome === 'draw') acc.draw++;
    else { acc.unfinished++; acc.stalled++; }
    if (r.outcome === 'stalled') continue;
    acc.pliesAll.push(r.plies);
    if (r.outcome === 'first') acc.pliesFirst.push(r.plies); else acc.pliesSecond.push(r.plies);
    if (r.fiveDirection) acc.dirs[r.fiveDirection] = (acc.dirs[r.fiveDirection] || 0) + 1;
    const loser = r.outcome === 'first' ? 'O' : 'X', winSide = r.outcome === 'first' ? 'X' : 'O';
    const knew = r.perPly.findIndex((p) => p[0] === loser && p[5] === 'loss');
    if (knew >= 0) { acc.loserKnew++; acc.loserKnewPly.push(knew + 1); }
    if (r.perPly.some((p) => p[0] === winSide && p[5] === 'win')) acc.winnerProved++;
    const opening = (r.moves || []).slice(0, 2).join(' ');
    if (opening) acc.openings[opening] = (acc.openings[opening] || 0) + 1;
  }
  return acc;
}

const REPORT = flag('report', null);
if (REPORT) {
  const all = fs.readFileSync(RECORD, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const rows = all.filter((r) => r.run === REPORT);
  if (!rows.length) { console.error('no games with run id "' + REPORT + '" in qa/first-move.jsonl'); process.exit(1); }
  console.log('reporting run ' + REPORT + ' from the record: ' + rows.length + ' games, no games played');
  for (const level of [...new Set(rows.map((r) => r.level))]) {
    done.push(accFromRecord(rows.filter((r) => r.level === level), level));
  }
  printOverall(done, null, '(recomputed from the record - the games behind these numbers were played, not replayed)');
  writeSummary();
  process.exit(0);
}

for (const level of levels) {
  const acc = newAcc();
  runStratum(level, acc);
  done.push(acc);
  writeSummary();
  console.log('  stratum ' + level + ' written; overall so far in qa/first-move-summary.md; total elapsed ' + clock(Date.now() - t0run));
}

printOverall(done, Date.now() - t0run, '');
writeSummary();
console.log('\nrecord: qa/first-move.jsonl (' + done.reduce((s, a) => s + a.games, 0) + ' games with their full move lists)');
console.log('summary: qa/first-move-summary.md');
