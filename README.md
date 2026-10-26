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
| CPU strength / Engine X + Engine O | Easy, Medium, Hard, Expert, Master. In "1P vs CPU" there is one strength control and it applies to the CPU on either side; in "CPU vs CPU" each side has its own |
| Look ahead · Move width · Time per move | these three live in **Search settings — advanced**, folded by default and placed last. Pinning any of them overrides what the level menu promises; the summary line of the collapsed panel states what is pinned |
| Engine report | what the last search actually did — which engine made it (written in that player's colour), how deep it got, positions looked at, the time, how many workers answered, why it stopped, and the distance to a five when the outcome is proven |
| Decision log | under the board, as wide as it is: every engine decision, and every move you make, in the order they happened and in the colours of the stones, so an answer is still readable after the opponent has moved. Undo takes the lines back together with the moves |

## Strength is a clock

A level says how long the CPU may think, and how deep it is allowed to spend that
time — both stated in the menu label itself:

| Level | Clock per move | Depth ceiling | Cores used |
| --- | --- | --- | --- |
| Easy | 0.1 s | 3 plies | 1 |
| Medium | 0.5 s | 5 plies | 2 |
| Hard | 1.5 s | 6 plies | 4 |
| Expert | 3 s | 10 plies | 4 |
| Master | 10 s | 16 plies | every core but one, up to 16 workers |

The move width is the widest available at every level: strength is time and
depth, never a hidden narrowing of which moves get considered. The ceilings exist
so that Easy still reasons three moves ahead on a fast machine instead of turning
into "Hard, but slow", and Master's exists only so that one search cannot run away
with the page. Measured on this machine (one core, Node, a quiet 25×25 midgame),
the clock is a maximum and not a target: Easy finishes its 3 plies in 2 ms, Medium
its 5 in 153 ms, Hard its 6 in 643 ms — below Expert the level is decided by its
ceiling, and only Expert and Master actually spend the clock they are given
(10 s on one core reaches depth 8, 3.1 M nodes). The strength menu spells all of
this out in its own labels, and the report repeats what actually happened.
Everything that overrides a level — a pinned look-ahead, a pinned width, a longer
clock — sits in one **Search settings — advanced** panel that is folded by default
and placed last; the one line that stays visible states what is currently pinned.

Time is spent across cores where the level asks for it: the root squares are
dealt round-robin to a pool of Web Workers, each worker searches its own first
moves **to the same depth**, and the parts are merged. The pool is as large as the
level asks for and as the root can feed — at least two squares per worker, so a
root of twenty squares in a long clock gets ten workers rather than none. A depth
only counts when every part finished it, so the depth in the report is the depth
the whole root reached — never one worker's best. Threads follow the clock, so a
clock slid above the level's own gets the cores the longer level would use.
`SharedArrayBuffer` is unavailable on a `file://` page, so the workers share no
transposition table; that duplication costs some efficiency and the extra cores
pay for it in plies.

The engine runs in Web Workers built from the serialised engine function, so the
board never blocks (one worker for short answers and for the one-core levels; the
pool only when there is a root worth splitting).

Two surfaces say what a search did. The **Engine report** shows the most recent
one in detail and names the engine that made it, written in that player's colour
— orange for X, cyan for O. There is deliberately no third colour for "the
decision": a third hue would compete with the two the stones already use, and the
colour is the identity of who decided. The **Decision log** sits under the board,
as wide as it is, and keeps every decision as a line of the game — who decided,
the square chosen, how deep the search actually saw, what it cost, how many
workers it took, and why — so "why did it play there" is still answerable after
the opponent has moved, and a game between two engines reads as
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
node tests/icon-check.mjs        # the shipped icon: the container, every frame in it, the sizes a browser or shell asks for
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
node tests/diag-tt.mjs                            # what one worker's transposition table costs: entries stored at a real clock, measured bytes per entry, the pool's worst case (--expose-gc gives a clean byte figure)
node tests/pool-compare.mjs 15 8 master           # A/B of two pool sizes on the *same* position in the real page, read from the game's own decision log; needs QA Chrome on 9333
```

### Icon

`match5.ico` is the project's mark: a dark tile, a grid, an orange ✕ and a cyan ○ — the two
colours the stones use, so the file icon and the board are one identity. It is a container of
nine frames (16, 20, 24, 32, 40 and 64 as uncompressed 32-bit bitmaps; 96, 128 and 256 as
PNG-compressed), which is what lets Windows, a taskbar or a browser tab pick a real size
instead of scaling one image down. `node tests/icon-check.mjs` checks the container and every
frame inside it: that the small sizes a browser and the shell ask for actually exist, that no
frame runs past the end of the file or over its neighbour, that each bitmap holds a complete
image *plus* its AND mask (to the byte), and that each PNG frame parses as an RGBA image of
exactly the size its directory entry claims. The reason to gate it is that a re-export breaks
it quietly — one truncated frame, or a dropped 16px one — and every viewer that happens to
choose a different frame hides the damage.

`qa/icon-shell-check.ps1` checks the other end of it, Windows only: it asks System.Drawing and
the shell itself (`SHGetFileInfo`) to load the icon and renders what they hand back. Both agree
at 16px and 32px. System.Drawing on .NET Framework — the one PowerShell 5.1 runs — cannot
render the PNG-compressed frames ("Requested range extends past the end of the array"); that is
the old parser, not this file, since those frames parse standalone and the shell renders them.

The game itself does not reference the icon. A page opened from `file://` picks up no icon on
its own, and embedding one would mean carrying about 77 KB of base64 inside the single HTML
file — a trade for whoever wants a tab icon, not a default to take silently.

`qa/icon-audit.txt` is the record of the audit this icon was accepted on. For each of the nine
frames it lists the extent and bounding box of both marks, whether the ring is still a ring with
its hole open, the gap between the two marks, and the contrast ratios: mark against the tile
6.5–7.9:1, the grid lines 3.4–3.5:1 (so the marks lead the grid by 1.9–2.3× — at 16px the grid
is allowed to fall away and the ✕ and ○ are not), and the separation from the wallpaper behind a
transparent icon: 16.1:1 against a light desktop, 2.9–4.9:1 against a dark one, against a 1.5:1
floor. Every row reads `ok`, and it ends by stating both halves plainly: marks legible at every
size, container well formed. It is kept as **evidence, not as a check**: the container half is
regenerated today by `node tests/icon-check.mjs`; the legibility half was measured by an ad-hoc
pass when the icon was made, so it says nothing about a future re-export until that pass is
written down as a test.

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

`qa/probe.js` accepts hash cases in the URL (`#fast`, `#easy`, `#hard`, `#expert`,
`#master`, `#pvp`, `#d0`, `#d12`) to pin mode, level and look-ahead. Its status
strip carries the
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

The layout is checked separately (`node qa/ui-check.mjs`), because a report that tells the
truth is not enough — it has to stay reachable and readable while the game moves on. It
prints where the Engine report sits relative to the first screen, the computed colour of the
decision text, the decision log's line count and colour histogram plus its oldest and newest
line, and the state of the folded advanced panel together with the summary line that stays
visible when it is closed. It also measures the log's position in the page rather than
trusting the markup: that it starts below the board and shares that column's left edge and
width, that its rows are laid out as one row per decision, and that no row's text spills out
of the card. It writes `qa/log-look.png` and `qa/settings-open.png` for the eye.

### What the pool was measured to do (the machine used for development: 16 logical cores)

Every figure is the page's own report row, printed by the pass above — not a
benchmark harness, and they move with machine load.

| Case | Reported |
| --- | --- |
| Master vs Master, 10 s clock | 15 workers · root split, 9 ply reached in 9.5 s, 15,415,513 positions, 1.62 M positions/s |
| An earlier move of the same game, where the root held 25 squares | 12 workers, not 15 — the pool was shrunk to what the root can feed |
| Expert vs Expert, 3 s clock | 4 workers · root split, 7–8 ply, 1.7–1.9 M positions per move, 0.56–0.67 M/s |
| Look-ahead pinned to 12, clock pinned to 2.5 s | 4 workers (that clock is the Hard level's), 6–7 ply, 0.6–1.4 M positions per move |
| Medium, 0.5 s clock | 5 ply — its ceiling — in 21–204 ms per move, 4–21k positions, 2 workers |
| Easy, 0.1 s clock | 3 ply — its ceiling — one core on every one of 38 moves |
| The same engine on one core (Node suite, its own midgame fixture) | ~200–330k positions/s |
| A Hint asked in a Hard position | 4 workers · root split, 6 ply (its ceiling), 51,030 positions in 140 ms |
| Look-ahead pinned to 0; or a settled tactic ("completes five now", "must block the five") | `1 · one core` — correct, there is nothing to split |

What the numbers say about cores, first as rates: per worker the rate falls as the
pool grows — ~250–330k positions/s alone, ~150k each with four, ~108k each with
fifteen, on hyper-threaded cores. The aggregate still rises (0.33 M → 0.61 M →
1.62 M positions/s), so the pool is not wasted work; it is just not linear.

Whether that aggregate turns into strength was measured rather than assumed, on the
same position (`node tests/pool-compare.mjs 15 8 master`: it rewinds the game so
that both arms are asked to think about an identical position, and reads the answer
out of the game's own decision log):

| Position | Pool asked for | Pool used | Plies reached | Positions searched |
| --- | --- | --- | --- | --- |
| A | 15 | 15 | 8 / 16 | 10,651,441 in 10.0 s |
| A | 8 | 7 | 8 / 16 | 3,039,149 in 6.3 s |
| B | 15 | 7 | 8 / 16 | 8,022,656 in 10.0 s |
| B | 8 | 7 | 8 / 16 | 6,741,873 in 10.0 s |

Two honest readings of that. Nearly twice the workers searched several times the
positions (the 8-worker arm did not even use its whole clock) and reached **the
same depth**: with a branching factor of ten to twenty, one extra ply costs roughly
an order of magnitude more positions, so doubling cores buys a fraction of a ply.
And on both positions the pool was capped *below* what the level asked for, because
the root is split only where each worker gets at least two squares — those roots fed
seven to fifteen. So Master's "every core but one" is headroom rather than a
measured gain in strength: it is honoured when a position can use it, it never
breaks anything, and the report says how many workers it actually used.

The node counts vary with the position and with what the previous moves left in the
transposition tables; the plies and the worker counts are what the level promises.

Two honest caveats: the two rows above are different positions, so they are not
a controlled speedup measurement, and a `file://` page cannot share a
transposition table between workers, so the pool is deliberately below linear
efficiency — it buys work, not a magic factor. What is *not* a guess is the
correctness claim behind it: engine-test section [11] asserts that the merged
answer is the same square, value and proof a single search would have returned.

The unshared tables are also the one place where "every core but one" could have
cost the page memory, so it was measured rather than assumed
(`node --expose-gc tests/diag-tt.mjs`): one entry costs ~141 bytes, the engine
drops a worker's table above 300,000 entries, so a worker peaks at ~40 MB of
table and a pool of fifteen at ~600 MB in the worst case. In practice it is far
below that — a full 10-second single-core search visited 3.1 M positions and kept
14,977 entries, because once a pass is cut off mid-way almost nothing gets
stored. The bound is what makes the top level's core count safe to grant.
