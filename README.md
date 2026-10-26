# Match-5

Five in a row — horizontally, vertically or on either diagonal — on a 25×25 grid,
for zero, one or two players. The whole product is **`match5.html`**: game, UI and
search engine in a single file with no dependencies and no build step. Open it in
a browser.

## Controls

| Control | Meaning |
| --- | --- |
| Mode | 2 Players / 1P vs CPU / CPU vs CPU |
| Board | 9×9 up to 40×40; 25×25 is the default |
| CPU strength / Engine X + Engine O | Easy, Medium, Hard, Expert. In "1P vs CPU" there is one strength control and it applies to the CPU on either side; in "CPU vs CPU" each side has its own |
| Look ahead · Move width · Time per move | these three live in **Search settings — advanced**, folded by default and placed last. Pinning any of them overrides what the level menu promises; the summary line of the collapsed panel states what is pinned |
| Engine report | what the last search actually did — which engine made it (written in that player's colour), how deep it got, positions looked at, the time, how many workers answered, why it stopped, and the distance to a five when the outcome is proven |
| Decision log | every engine decision, and every move you make, in the order they happened and in the colours of the stones, so an answer is still readable after the opponent has moved. Undo takes the lines back together with the moves |

## Strength is a clock

A level says how long the CPU may think, and nothing else except — below the top
level — how deep it is allowed to spend that time:

| Level | Clock per move | Depth ceiling | Cores used |
| --- | --- | --- | --- |
| Easy | 0.5 s | 4 plies | 1 |
| Medium | 1.5 s | 6 plies | 2 |
| Hard | 3 s | 10 plies | 4 |
| Expert | 6 s | none in practice (16) | every core but one, up to 8 |

The move width is the widest available at every level: strength is time and
depth, never a hidden narrowing of which moves get considered. The ceilings exist
so that Easy still reasons four moves ahead on a fast machine instead of turning
into "Hard, but slow". The strength menu spells all of this out in its own
labels, and the report repeats what actually happened. Everything that overrides
a level — a pinned look-ahead, a pinned width, a longer clock — sits in one
**Search settings — advanced** panel that is folded by default and placed last;
the one line that stays visible states what is currently pinned.

Time is spent across cores where the level asks for it: the root squares are
dealt round-robin to a pool of Web Workers, each worker searches its own first
moves **to the same depth**, and the parts are merged. A depth only counts when
every part finished it, so the depth in the report is the depth the whole root
reached — never one worker's best. Threads follow the clock, so a clock slid
above the level's own gets the cores the longer level would use. `SharedArrayBuffer`
is unavailable on a `file://` page, so the workers share no transposition table;
that duplication costs some efficiency and the extra cores pay for it in plies.

The engine runs in Web Workers built from the serialised engine function, so the
board never blocks (one worker for short answers and for the one-core levels; the
pool only when there is a root worth splitting).

Two surfaces say what a search did. The **Engine report** shows the most recent
one in detail and names the engine that made it, written in that player's colour
— orange for X, cyan for O. There is deliberately no third colour for "the
decision": a third hue would compete with the two the stones already use, and the
colour is the identity of who decided. The **Decision log** keeps every decision
as a line of the game — the square chosen, how deep the search actually saw, what
it cost, how many workers it took, and why — so "why did it play there" is still
answerable after the opponent has moved, and a game between two engines reads as
a conversation. Both surfaces are built from the same composed strings, so they
cannot disagree about what happened. Why a search stopped is stated as it
happened (`clock ran out
during a deeper pass`, `proved a forced win`, `proved a forced loss - delaying
the five as long as possible`, …) and, when the outcome is proven, how many
moves are left before the five. A search that ends quickly and says "proved" is
done, not starved; a search that says "cut off" is the clock stopping it.

First moves are deliberately varied: the opening choice is randomised over the
equivalent central squares, and when several moves are measured to be almost as
good the engine sometimes takes one of them instead of the top one.

## Tests

All plain Node (no packages, no test runner; developed on Node v24):

```
node tests/file-check.mjs        # static gate: engine block parses, stays DOM-free, every ui.* exists
node tests/engine-test.mjs       # engine suite (~51,000 checks)
```

The suite covers: incremental scoring vs a brute-force rescan of every 5-window;
tactical forcing per level; never missing a win or a block in self-play; the
strength ladder (Hard ≥ Medium ≥ Easy, with and without the variety dice);
opening variety and near-tie selection; the forced-tactic labels (a *single*
five-completion square is a block, two distinct ones are already lost); the
proof handling, including playing the proven line out on the board and counting
the half-moves to check the distance the engine promised; and that a search
split across parts returns the same value, the same proof and the same distance
as a single search, with a level's clock honoured as a promise and the ladder
checked for monotonicity (more clock at every step, never a lower ceiling, the
same width throughout). The ladder runs the shipped clock *ratios* at a fraction
of the shipped budgets — a third of them, which is about what the older fixed
budgets cost — because at a sixth the gap between levels is noise rather than
strength.

### Diagnostics (dev-only, nothing here ships)

```
node tests/bench-depth.mjs                        # branch-factor / budget sweep on a quiet 25x25 midgame, to tune LEVELS
node tests/diag-pace.mjs hard hard 25 44 12       # per-move trace: depth, nodes, ms, why each move stopped
node tests/diag-lost.mjs                          # one position known lost in 3: does every depth prove it?
node tests/ladder-sample.mjs 8 13 hard:medium,hard:easy   # strength measured over N games, no pass/fail bars
```

## Browser QA

`qa/cdp-drive.mjs` drives the real page through Chrome DevTools Protocol: it
plays full games, checks for JS errors, measures that the result panel never
covers the board or the last-move ring, prints a per-move pacing trace, and
screenshots. It needs a Chrome listening on port 9333:

```
start chrome --headless=new --remote-debugging-port=9333 `
  --user-data-dir=qa/cdp-profile --window-size=1440,1040
```

Then build the probe page (it is `match5.html` plus `qa/probe.js` injected before
`</body>`, so the real file is never modified) and run the pass:

```powershell
$out = (Get-Content match5.html -Raw -Encoding UTF8).Replace('</body>',
  "<script>`r`n" + (Get-Content qa/probe.js -Raw -Encoding UTF8) + "`r`n</script></body>")
[System.IO.File]::WriteAllText("$PWD/qa/probe.html", $out, [System.Text.UTF8Encoding]::new($false))
node qa/cdp-drive.mjs
```

`qa/probe.js` accepts hash cases in the URL (`#fast`, `#expert`, `#hard`, `#pvp`,
`#d0`, `#d12`) to pin mode, level and look-ahead. Its status strip carries the
engine report's own fields — depth, nodes, the search-workers row, the decision
text — and the things a screenshot should not be asked to prove by eye: the
**computed colour** of the decision text and of the "searched by" row (`DECCOL`,
`BYCOL`), the decision log's line count and colour histogram (`LOG`), and the
open/closed state of the advanced panel together with the summary line that stays
visible (`SETTINGS`). The pass therefore counts how many late read-outs were
answered across a pool, how many correctly say "one core", how many decisions are
drawn in one of the two stone colours rather than a third colour, and that the
advanced panel stays closed while still naming what was pinned.
`qa/cdp-profile/`, `qa/*.png` and `qa/probe.html` are generated and ignored.

The sidebar is checked separately (`node qa/ui-check.mjs`), because a report that tells the
truth is not enough — it has to stay reachable and readable while the game moves on. It
prints where the Engine report sits relative to the first screen, the computed colour of the
decision text, the decision log's line count and colour histogram plus its oldest and newest
line, and the state of the folded advanced panel together with the summary line that stays
visible when it is closed. It writes `qa/log-look.png` and `qa/settings-open.png` for the eye.

### What the pool was measured to do (the machine used for development)

Both figures are the page's own report row, printed by the pass above — not a
benchmark harness, and they move with machine load.

| Case | Reported |
| --- | --- |
| Expert vs Expert, 6 s clock | 8 workers · root split, 8 ply reached in 6.0 s, 2.1 M nodes |
| Look-ahead pinned to 12, clock pinned to 2.5 s | 2 workers, 7–9 ply, 0.7–1.0 M nodes per move, 245–399k nodes/s |
| The same engine on one core (Node suite, its own midgame fixture) | ~200–240k nodes/s |
| A Hint in a Hard position (3 s clock) | 4 workers · root split, 7 ply, 1,127,067 nodes in 3,006 ms |
| Look-ahead pinned to 0; or a settled tactic ("completes five now") | `1 · one core` — correct, there is nothing to split |

The node counts vary with the position and with what the previous moves left in the
transposition tables; the plies and the worker counts are what the level promises.

Two honest caveats: the two rows above are different positions, so they are not
a controlled speedup measurement, and a `file://` page cannot share a
transposition table between workers, so the pool is deliberately below linear
efficiency — it buys work, not a magic factor. What is *not* a guess is the
correctness claim behind it: engine-test section [11] asserts that the merged
answer is the same square, value and proof a single search would have returned.
