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
| Board colour | Slate (the default, a dark board) or Paper — a light graph-paper sheet in the colours of a hand-drawn game. See [Two boards](#two-boards) |
| CPU strength / Engine X + Engine O | Easy, Medium, Hard, Expert, Master. In "1P vs CPU" there is one strength control and it applies to the CPU on either side; in "CPU vs CPU" each side has its own |
| Look ahead · Move width · Time per move | these three live in **Search settings — advanced**, folded by default and placed last. Pinning any of them overrides what the level menu promises; the summary line of the collapsed panel states what is pinned |
| Engine report | what the last search actually did — which engine made it (written in that player's colour), how deep it got, positions looked at, the time, how many workers answered, why it stopped, and the distance to a five when the outcome is proven |
| Decision log | under the board, as wide as it is: every engine decision, and every move you make, newest at the top and the older ones pushed down. Engine lines are written in the colour of the side that decided, so an answer is still readable after the opponent has moved; your own moves are plain ink. Undo takes the lines back together with the moves |

The **board size, the difficulty and the board colour are kept on the computer** and put back
when the page is opened again — see [what the page remembers](#what-the-page-remembers). A game
in progress is not kept, and neither is the mode.

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
a conversation. The newest line is the one at the top and the older ones are
pushed down, because that is the line being read; a reader who has scrolled into
the older lines keeps looking at the same line as new ones arrive above them, and
the list is bounded from the bottom, where its oldest lines are. Both surfaces are
built from the same composed strings, so they
cannot disagree about what happened. Why a search stopped is stated as it
happened (`clock ran out
during a deeper pass`, `proved a forced win`, `proved a forced loss - delaying
the five as long as possible`, …) and, when the outcome is proven, how many
moves are left before the five. A search that ends quickly and says "proved" is
done, not starved; a search that says "cut off" is the clock stopping it.

First moves are deliberately varied: the opening choice is randomised over the
equivalent central squares, and when several moves are measured to be almost as
good the engine sometimes takes one of them instead of the top one.

## Two boards

The page offers two board colours, **Slate** (the default) and **Paper**. They are not two
screenshots of a style: the theme is one block of CSS custom properties, and the canvas — which
is drawn, not styled — reads those same properties into a palette once per theme change, so the
page and the board cannot drift apart. `node tests/file-check.mjs` compares the two palettes
variable by variable, so an alternative theme that forgets one colour cannot land.

Paper was taken from a photograph of a hand-drawn game rather than invented.
`qa/paper-palette.py <picture>` (bundled Python with Pillow — the one non-Node tool here, and
the picture itself is not in the repo) quantizes the image and prints what is in it:

| in the picture | share | colour |
| --- | --- | --- |
| the paper | 93.0% | `#fcfcfc` |
| the grid | 4.5% | `#a8d8e4` |
| black ○ | 1.24% | `#000000` |
| blue ✕ | 1.00% | `#0000ff` |
| the red stroke over the winning five | 0.29% | `#ff0000` |

Those five values are exactly what `[data-theme=paper]` carries for the board surface, the grid,
the two stones and the winning line. Two things are **not** taken from the picture, and are said
here rather than left to be noticed afterwards:

- the cards and the page behind the sheet are greyed (`#f4f7f9`, `#eef2f5`) instead of the same
  white, so the board stays a distinct object on the page. The picture is a board filling the
  frame; it has no page to sit on, and a white sheet on white cards would disappear;
- the mark over the winning five is drawn from the theme rather than hardcoded, because a wide
  translucent band is what reads as a highlight on a dark board and would be a wash over the
  sheet that Paper is made of — and the reference has no wash. Slate therefore draws a band
  `0.62` of a cell wide in the winner's colour at 0.3–0.6 alpha; Paper draws a pen `0.16` of a
  cell wide, near-solid `#ff0000`. The width, the solidity and how much of it the pulse adds are
  palette values (`--winpen`, `--winink`, `--winrange`). `qa/paper-palette.py` measures the
  picture's own pen for that: its grid is drawn at **45 px a cell** and the stroke across the five
  is **7 px** thick, spanning 3.98 cells centre to centre, which is 0.16 of a cell — and a span of
  four cell-widths is exactly what this game draws, from the first square's centre to the fifth's.
  What stays identical between themes is the behaviour: the same pulse that says "these five".

Slate leaves `--winrgb` empty, which the drawing takes to mean "wear the winner's own colour".
That is a stated difference between the themes, not an oversight — a red pen is what the picture
shows, while a red five on a dark board would be a third hue competing with the two the stones use.

Legibility was measured from the pixels the game produced, not from the values in the stylesheet.
`node qa/ui-check.mjs` histograms the canvas of each theme, takes the dominant colour as the
surface everything has to be read against, and computes every mark against *that*:

| Theme | X | O | the winning five | body text | secondary text |
| --- | --- | --- | --- | --- | --- |
| Slate | 9.7 | 10.4 | 9.7 (wears the winner's colour) | 16.6 | 5.8 |
| Paper | 7.5 | 16.6 | 3.5 (the red pen) | 16.1 | 4.8 |

Small text has to clear 4.5:1 and a mark that carries meaning 3.0:1; both themes do, on the
surface they actually draw. The grid line is deliberately quiet — 1.4:1 against the surface,
against 1.5:1 measured in the picture — because it is a guide and not information.

That pass is also what changed a number in the *default* theme: its secondary text colour came to
3.4–4.1:1 on the surfaces it is used on, under the bar for small text, and is now `#7a8ea6` at
4.8–5.8.

What the drawing is measured for is the parts that are not decoration:

- the surface it paints **is** the surface the theme declares: the dominant colour of the canvas
  sits within 12/255 of `--felt-a`/`--felt-b` in both themes (`feltMatchesDrawn: true` in the
  pass output), which is the claim that a drawn board follows its theme instead of keeping last
  session's colours under a new coat of page;
- the grid paints at exactly `#a8d8e4` — 6.6% of the canvas, which is what 25 lines a device
  pixel or two across 749 px have to come to; the picture's grid is the same colour at 4.5%, on
  cells 45 px wide with thinner lines;
- the pen's width relative to a cell: 0.16 here, 7 px on a 45 px cell in the picture.

The area shares of the **stones and the pen** are deliberately not quoted. How much red or blue a
frame contains depends on how many moves have been played, and for the pen on where its pulse
happens to be when the frame is taken — two runs of one game gave 0.09% and 0.12% for the same
stroke. A number that moves between runs is not a claim, so it is not made.

Changing the colour does not disturb the game either: the pass reports the same move count before
and after the switch, and that the segment control moved to the other button.

## What the page remembers

The board size, the difficulty and the board colour are written to `localStorage` under
`match5.prefs.v1` as the player chooses them, and read back when the page is opened again.

- every remembered value is re-checked against the choices actually on offer before it is used. A
  size no longer offered, a level that no longer exists, a theme that was renamed: each falls back
  to the default instead of being followed into something the page cannot render;
- reading and writing are both inside a guard, so a page whose storage is refused — private mode,
  a full quota, an origin that disallows it — still plays;
- a small script in `<head>` applies the remembered theme before the first paint, so the page does
  not open dark and then change under the reader;
- what the controls show is what gets stored: the write happens after the state and the controls
  have been reconciled, so in "1P vs CPU" the stored difficulty is the one the single control
  displays, not a stale value left behind by an earlier two-engine game.

Not kept, deliberately: the game in progress (a resumed position would ask the player to remember
where they were, and the log that explains that position is not kept either), the mode, and the
advanced pins, which belong to an afternoon of tuning rather than to a preference.

Measured rather than assumed: the pass sets 31×31, Expert and Paper through the real controls,
prints what the entry says, leaves the page and comes back to the shipped file with no query
string, and reports what a new session puts back — `size 31, level expert, theme paper`, the paper
palette applied and the board already drawn in it, `movesAtStart 0` and an empty log. Then it puts
`{not json` into the key and reloads: the page comes back at 25×25, Hard and Slate, rewrites the
entry cleanly, and reports no errors.

## Tests

All plain Node (no packages, no test runner; developed on Node v24):

```
node tests/file-check.mjs        # static gate: engine block parses and stays DOM-free, every ui.* exists, every theme palette defines every colour the first one does, a remembered setting is checked against the choices on offer, and the decision log inserts at the top and trims from the bottom
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

The layout is checked separately (`node qa/ui-check.mjs`), because a report that tells the truth is
not enough — it has to stay reachable and readable while the game moves on, and a second board
colour has to be legible rather than merely different. It prints where the Engine report sits
relative to the first screen, the computed colour of the decision text, the decision log's line
count and colour histogram plus its newest and oldest line, and the state of the folded advanced
panel together with the summary line that stays visible when it is closed. It also measures the
log's position in the page rather than trusting the markup: that it starts below the board and
shares that column's left edge and width, that its rows are laid out as one row per decision, and
that no row's text spills out of the card.

The log's order is measured with lines arriving **on purpose**. Two engines at Medium finish a
25×25 game faster than the pass can look at one, so the moves are made there: pointer events on
squares chosen on a lattice wider than two cells, in "2 Players" mode, which sends a line through
the same `logEntry` path an engine line uses and lands it the moment the square is clicked. The
pass then reads the move numbers down the list (36, 35, 34, 33, 32), scrolls into the older lines,
adds one more move, and identifies the row the reader was on both times by the move it describes.
Three things have to hold: the newest decision is the first row, the list stays newest-first, and
the row being read stays at the same pixel inside the scroll port. That last one is what caught a
slip of 6 px per line — the compensation counted the row and not the gap above it — and it is why
the list switches the browser's own scroll anchoring off: the page is then the only thing moving
the reader, and it moves them the same amount in every browser.

The two boards are measured as pixels. The pass histograms the canvas of each theme the way
`qa/paper-palette.py` histograms the reference picture, and reports the surface the game actually
drew — within 12/255 of the declared felt, which is the claim that a drawn board follows its theme
— the five most common colours, whether the surface it painted is the one the theme declares, and
the contrast of every mark against that surface, sampled from the drawing rather than from the
stylesheet. The
remembered settings are
tested on the shipped `match5.html` rather than on the probe page, because the probe pins the
levels from the URL hash and would hide what the page restored by itself. For the eye it writes
`qa/log-look.png`, `qa/settings-open.png`, `qa/board-slate.png`, `qa/board-paper.png`,
`qa/board-paper-winner.png` (a finished game, so the red five is in the frame) and
`qa/board-remembered.png`.

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
