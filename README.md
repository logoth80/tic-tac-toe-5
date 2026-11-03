# Match-5

Five in a row — horizontally, vertically or on either diagonal — on a 25×25 grid,
for zero, one or two players. The whole product is **`index.html`**: game, UI and
search engine in a single file with no dependencies and no build step.

Play it at **<https://logoth80.github.io/tic-tac-toe-5/>**, or open the file in a browser — see
[Served, not just opened](#served-not-just-opened) for what keeps those the same page. The file is
named `index.html` rather than after the game so that the address needs nothing after the repository
name; `match5.ico` keeps the game's name because it is the project's mark, not the page.

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
| Position bar | under the board, a scale whose zero is in the middle: it grows out of that middle to the right, in ✕'s own colour, while ✕ is ahead, and to the left, in ○'s colour, while ○ is ahead, and it stays empty when the position is level. The number beside it is the same reading, not a second opinion — see [the position bar](#the-position-bar) |
| Pencil sound | on by default: a short pencil scratch as each mark is drawn, taken at random from the five recordings in `sounds/` — three for ✕, two for ○ — because on paper no two strokes sound identical. One box, and what it says is remembered |

The **board size, the difficulty, the board colour and the sound switch are kept on the computer** and
put back when the page is opened again — see [what the page remembers](#what-the-page-remembers). A
game in progress is not kept, and neither is the mode.

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

What that opening is worth is measured on the shipped levels (`node tests/first-move.mjs --games 100`):
both sides run the same level, the same clock and the same ply ceiling, so the only asymmetry is who
moves first. The player who moves first wins **67 of 100** games at Easy (95% interval 57.3–75.4,
p = 0.0009 against an even split), **58 of 100** at Medium (48.2–67.2, p = 0.1332 — which shows
nothing in either direction), and **84 of 100** at Hard (75.6–89.9, p = 2.6e-12; the summary keeps
four decimal places and prints `0.0000`). Kept separate by level, the pooled 300 games come to 209–91
in the first player's favour, p = 0.0001 by a stratified sign-flip test over 10000 shuffles; none of
the 300 was drawn. The same record reports the depth the levels reached — means of 2.79, 4.64 and 5.15
against their 3, 5 and 6 ply ceilings — the ladder doing what the menu says it does. Two things that
run cannot show, and it says so out loud: the level's worker pool belongs to the page, so both sides
searched on one core, which lowers absolute strength at Medium and Hard without breaking the symmetry
the question depends on; and the restrictions free-style gomoku is usually played with — three-three
and four-four bans, a swap rule — are not in this game, which is why the answer is about the game as
it is played rather than about the theory that such games favour the first player in principle.

The raw records are `qa/first-move.jsonl` — every game, with its whole move list, written as it
finishes — and `qa/first-move-summary.md`; that run reads back with
`node tests/first-move.mjs --report 2026-10-27T12-02-35-200Z` rather than being replayed, which is
the reason the record is committed.

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

### How thick the pen is

Both marks are drawn with a pen whose width is a fraction of a cell: `--stonpen`, `.075` in both
themes. The **outside size is not part of that**, and it does not move when the pen does. The request
was "same outside size, less thickness, more like a pen", and a line with round caps ends half a pen
short of where it is pointed — so both marks are drawn with their endpoints set at
`out − pen/2` (`out` being `cell * MARK_EXTENT`, `MARK_EXTENT = 0.43` from the centre to the outside
edge along a grid axis) and the caps add that half back. The footprint is therefore 0.86 of a cell
across at any pen width. That is not a theory: when the pen was first thinned, the cross came out
0.61 of a cell beside the circle's 0.86, because the arms had been drawn to a fixed half-length; they
are drawn to `out − pen/2` since, and the ask along the way — "make the X lines a little longer too" —
is that measurement turned into words.

`qa/pen-ab.mjs` draws one position at several thicknesses and measures what came out:

| `--stonpen` | the line it draws at the default 25×25 (a cell is 28–29 px) | the mark's colour, share of its own square |
| --- | --- | --- |
| `.14` | 4 px | ○ 29.8% · ✕ 25.0% |
| `.10` | 3 px | between those |
| `.075` (shipped) | 2 px | ○ 18.0% · ✕ 15.7% |
| `.055` | 1–2 px — thinner than a pixel, so it alternates | — |

At 13×13, where a cell is 54–56 px, `.075` draws a 4.2 px line and the extent measures back at
0.429 of a cell, unclipped. The share of the square counts the anti-aliased halo around the stroke,
which is larger on Paper (8–17%) than on Slate (0–4%) because a mark there crosses the printed grid
lines; the two rows are only comparable within a theme. What the reference photo's pen would have
been cannot be checked: the picture it was taken from is not in the repo and cannot be recovered from
where it was posted — `qa/find-reference.py` searched 377 stored attachments, and the 42 that show a
sheet with a grid on it carry no meaningful blue or red. Pen thickness is therefore calibrated against
the game's own render, which is what the table quotes.

### The marker for the last move

The marker that says which mark was placed last is the outline of that mark: a circle for the round
mark, as it has always been, and for a cross the four **ends** of that outline — short strokes across
each arm, facing the corners of the square. One number places it, `LAST_GAP = 0.05` of a cell outside
the mark's own edge, and both bounds of that number are measured:

- a circle around a cross is the wrong shape, and it is visibly wrong: the tip of a cross's arm
  reaches 0.593 of a cell while that circle would sit at 0.48, so the mark's own arms cross it;
- an outline that hugs the arms merges into the mark. At a 28 px cell the clear space between such a
  pair is 0–1.5 px, which is less than the ink of either line, so it reads as a heavier mark rather
  than as a marker;
- brought in to `.03`, a cross's caps merge into its tips (0 px of clear space at a 28 px cell);
  out at `.07` the outermost ink reaches 2.7 px past the square's edge at that cell — 5.4 px at a
  79 px one — and the pair stops looking like one mark.

At `.05` the outermost ink of either marker gets 1.6 px past the grid line at a 28 px cell and
0.3 px at a 56 px one: 0.005 of a cell into the neighbouring square, where a mark's own ink begins
0.070 in. What separates the marker from the mark at a small cell is the **tone** — the same colour
at 55%, not at full ink — because a pen half a pixel wide already reaches that far; at a 56 px cell
there are 2 px of real space as well. `qa/ui-check.mjs` reads the drawing instead of trusting it: it
finds the mark's centre from the mark's own deep ink, then samples sixteen wedges around it and asks
for ink at the four directions a cross's arms point and none of the other twelve, and for a whole
circle at 0.47–0.51 of a cell in all sixteen directions for the round mark. That is exactly the test
a circle around a cross would fail.

### The position bar

The bar under the board is a scale with its zero in the middle, and it is filled from that middle
outwards: to the right in ✕'s colour while ✕ is ahead, to the left in ○'s colour while ○ is ahead,
empty while the position is level. The version it replaced filled from the left edge and was one
colour, so a level position read as half ✕ and the bar could not say which side was ahead at all —
which is what it is for. Filling from the middle is also the only shape that matches the number
printed beside it, since that number is signed the same way. The two halves are anchored at the centre
tick and only ever change length, so the bar grows and never slides; the fill wears the two marks'
colours, for the same reason the decision text does — a third hue would compete with the two the
stones use. The scale is the one the number uses: the difference of the two positional scores,
saturated by a tanh at ±12 k, so a bar that reaches the end of its half is a position effectively
decided rather than merely comfortable.

The pass plays a line whose lead changes hands — an open three for ✕ against a two for ○, then ○
raised to a four with one end against the edge of the board — and reads the laid-out boxes rather than
the style text. Measured: at a 1.3k lead for ✕ the right half grew and the left stayed at nothing; at
−5.3k and −5.5k for ○ the left half grew and the right was nothing. Five things have to hold at every
sample: never both halves, the grown half matches the sign of the printed number, its inner edge stays
within a pixel of the middle, it never exceeds the half it belongs to, and it never stands past the
end of the bar.

### The pencil sound

A mark is drawn with a sound, and the sound is a pencil scratching on paper: five recordings sit beside
the page in `sounds/` — three for ✕, two for ○ — supplied as `marker x1-3.mp3` and `marker o1-2.mp3`
and kept under those names, lower-cased. Which of a side's clips plays is chosen at random, because on
paper no two strokes sound alike and the same clip every move is what makes a page like this sound
synthetic. Nothing is asked for until a mark is really drawn, every start is guarded
(`clip.play().catch`), a page that will not start sound before it has been touched is not argued with,
and a missing `sounds/` folder costs a page nothing but the sound. The box turns it off and, when it
is turned back on, plays one clip at once so the control says what it does.

The files are MPEG-2 Layer III, 24 kHz, stereo, 160 kbps, and carry no header stating a length, so the
length has to be counted in frames: 0.24–0.34 s that way. Chrome decodes each of them 0.046 s shorter,
by the same amount every time. `tests/mp3-info.mjs` reads the files (frames, sample rate, duration,
peak and level), and `qa/sound-check.mjs` drives a real page and asserts that the gap between the two
readings is **constant** rather than claiming either one is the file's true length; it does not treat
the audio device's sample rate as a property of the file either. One caveat that follows from a
single-file page: paths resolve against the page, so the copy in `qa/` that the browser gates drive
cannot find `sounds/` and says so in the console while still playing — which is why the sound gate and
the remembered-settings gate run against `index.html` itself.

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

The board size, the difficulty, the board colour and whether the pencil sound is on are written to
`localStorage` under `match5.prefs.v1` as the player chooses them, and read back when the page is
opened again.

- every remembered value is re-checked against the choices actually on offer before it is used. A
  size no longer offered, a level that no longer exists, a theme that was renamed: each falls back
  to the default instead of being followed into something the page cannot render;
- reading and writing are both inside a guard, so a page whose storage is refused — private mode,
  a full quota, an origin that disallows it — still plays;
- a small script in `<head>` applies the remembered theme before the first paint, so the page does
  not open dark and then change under the reader;
- what the controls show is what gets stored: the write happens after the state and the controls
  have been reconciled, so in "1P vs CPU" the stored difficulty is the one the single control
  displays, not a stale value left behind by an earlier two-engine game;
- the sound switch is stored as a boolean and read back as one: only a literal `true` or `false` is
  accepted, and anything else leaves the shipped default in place, because a stored `"on"` is not the
  same fact as a switch that is on.

Not kept, deliberately: the game in progress (a resumed position would ask the player to remember
where they were, and the log that explains that position is not kept either), the mode, and the
advanced pins, which belong to an afternoon of tuning rather than to a preference.

Measured rather than assumed: the pass sets 31×31, Expert and Paper through the real controls, and
turns the pencil sound off through its box, prints what the entry says — including `sound false` —
leaves the page and comes back to the shipped file with no query string, and reports what a new
session puts back: `size 31, level expert, theme paper`, the paper palette applied and the board
already drawn in it, the sound box still off, `movesAtStart 0` and an empty log. Then it puts
`{not json` into the key and reloads: the page comes back at 25×25, Hard and Slate, with the sound
on as it ships, rewrites the entry cleanly, and reports no errors. The sound round-trip is a gate: a
checkbox that came back the other way is a setting that was not remembered.

## Served, not just opened

The repository is published as a site: Pages is enabled for it with **main / root** as the source, so
<https://logoth80.github.io/tic-tac-toe-5/> is the game itself — no build step, no action, nothing to
run first. The file had to be called `index.html` for that address to resolve at all; a page called
`match5.html` would have needed its name typed after the repository's. The old name is not kept
alongside the new one — two copies of the page is the fault every other gate in this repository exists
to prevent — and the history follows the rename, which Git recorded as one rather than as a deletion
and an addition.

`node qa/site-check.mjs` is the gate for it, and it asks three questions in the order where a failure
is most useful:

- **the same thing**: the bytes the site serves hash to the hash of `index.html` here. That catches a
  build step rewriting something, and it catches the quieter version — a site quietly still on an older
  build, which is the same fault as a hand-kept copy of the page. When they differ, the first differing
  byte is printed with what surrounds it, because the interesting part of a mangled HTML file is what
  took the place of the bytes that went away;
- **all the parts**: every one of the five clips is fetched from the address a page *under a subpath*
  resolves to, and each is the file in this repository. A single-file page is allowed to lose its
  sounds and stay playable; a site that never had them is a different thing and should say so;
- **it plays there**: the deployed page is opened in the QA browser at the address **without** the
  trailing slash — the case where relative paths go wrong, because they are resolved against the page's
  own address — marks are drawn with real clicks, the game has to count them as its own moves, the
  pencil has to start, and the browser's resource records have to show the clips arriving over https.
  That last part is what no `file://` run in this repository can show at all.

It is the only gate here that needs a network. When the site cannot be reached it prints `SKIP` and
exits 0, because having no route is not evidence about the page; a site that answers with wrong bytes,
an error status, or a page that will not play carries an exit code. A push and a deploy are not the
same instant, so on a mismatch it waits up to a minute for GitHub to catch up before failing — that
part is written down so nobody mistakes a deploy in progress for a broken page.

Two settings make the served thing the repository thing, and both were checked rather than assumed.
`.nojekyll` asks Pages to copy the tree instead of building it with Jekyll, and it turned out not to be
a theoretical precaution: the first run of `qa/site-check.mjs`, before that file existed, found the
site's root answering 200 with **63,065 bytes of HTML that is this README rendered as a page** —
sha256 `3665ac0446da…` against the game's `0a736514dd3e…`, and the first differing byte printed with
what surrounds it. With no `index.html` in the tree, the build put the repository's own description at
the address a player would type. Once the page is named `index.html` even a Jekyll build would serve
it, so what `.nojekyll` really buys is that nothing sits between this file and a stranger's browser:
the page holds no Liquid token today (measured: zero `{{`, zero `{%`), so no *current* line of it is at
risk, and the risk that is left — a future edit that reads like a template — is exactly what the byte
gate would catch, though only after the page had been published wrong once. And the page holds no absolute path, no origin and no external
reference of any kind: reading it for `src="/`, `location.origin` and for any `http://` returns
nothing, which is what lets one file sit in a folder, on a subpath, or at a root without knowing the
difference.

What that section cannot show, and does not claim: what the page looks like on a phone, or in a browser
this machine does not have; and that anyone has seen it.

## Tests

All plain Node (no packages, no test runner; developed on Node v24):

```
node tests/file-check.mjs        # static gate (99 checks): the engine block parses and stays DOM-free, every ui.* exists, every theme palette defines every colour the first one does, a remembered setting is checked against the choices on offer, the decision log inserts at the top and trims from the bottom, the marker for the last move keeps the rule that gives it the shape of the mark it marks, the sound files are present and readable, the markup reaches outside the file for nothing (every src/href is a data: URI), the tab icon is exactly what match5.ico produces and stays under its byte budget, and qa/probe.html is the built copy it claims to be
node tests/engine-test.mjs       # engine suite (~51,000 checks)
node tests/icon-check.mjs        # the shipped icon: the container, every frame in it, the sizes a browser or shell asks for
node tests/mp3-info.mjs          # what the five sound files are: codec, sample rate, duration counted in frames, peak and level
node tests/first-move.mjs --games 100   # is the first move worth anything? same level both sides, N games each, with the interval
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
strength. About 70 s per run on this machine.

One claim in the suite used to be able to fail without anything being wrong, and it took twenty-five
runs to hear it. The suite was run twenty-five times during a working session, twice with one failing
check and never the same message twice in a row; when it finally named itself, on the tenth run of a
deliberate batch, it was `hard only scored 1 of 2 against medium [pure search] - depth is not
converting into results`. Two things about the *test* made that possible: that pairing ran on the
clocks — a third of the shipped budgets, so Hard had 495 ms for a sixth-ply tree that takes longer
than 495 ms when other work is on the machine — and it left the opening dice unpinned, so every run
started from a different position. A two-game pairing cannot tell a weaker search from an unlucky
line. It is now run each side to its own ply ceiling with a clock far too large to bind, the dice
pinned per game like every other game in the section, which makes it a claim about depth that replays
identically: two runs in a row produce the same win in 27 plies and the same draw after 60. The pass
that is *meant* to feel the machine is `as shipped`, four games across both opening orders with an
upset allowance, because a time-limited search is what it is testing; its bar is a floor rather than a
target. The assertions that measure what a clock buys, in the section that reports depth and nodes per
level, are sensitive to load by design and say so where they are made.

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

The page carries the tab icon, and it carries this mark rather than a second drawing of it.
`qa/make-favicon.mjs` reads the 16 and 32 px frames out of `match5.ico` (`tests/ico-png.mjs` does the
reading and the re-containing: no libraries, an ICO reader and a minimal PNG writer) — 32-bit bitmaps,
whose alpha channel holds the real transparency and whose AND masks turn out to be all zero (measured,
both) — and writes them into `index.html` as PNG data URIs, one `<link rel="icon" sizes="…">` per
size, so a browser picks the frame that matches the tab it is drawing instead of scaling one down. The
bytes come out of the .ico instead of being typed in beside it, which is what keeps the tab and the
shell one identity: `tests/file-check.mjs` re-derives them and fails when the page stops holding what
`match5.ico` produces — the same shape as the gate for the built browser copy, which once went
unnoticed for a whole round of changes. Measured cost, in bytes: 864 and 1,958 for the two PNGs, 3,764
of base64, 4,416 for the block the page holds plus the line break it sits on — 4,417 bytes added to a
129,012-byte page, about 3.4%, and the page is 133,429 bytes now. (Those are byte counts, deliberately:
the tools print them as bytes because the page itself holds multi-byte characters — a character count
for the same file is 133,323, a hundred-odd smaller, and it is not the number a download or a directory
listing shows.) All nine frames as data would be 76,787 bytes, which is why only the two sizes a tab
asks for are carried — and why the gate also fails past 8,192 bytes, so that spending a quarter of the
page on a picture the size of a fingernail has to be decided and not drift.

`node qa/make-favicon.mjs` reports what each size would cost and whether the page holds exactly those
bytes; `--write` writes them; `--sizes` asks for others. `match5.ico` has no 48 px frame and the tool
answers by listing the sizes it does hold. The 96, 128 and 256 frames are already PNG-compressed
inside the container, so carrying those would be a copy rather than a re-encode; the tool reads the
bitmap frames, which is what the small sizes are.

The reader and the writer in `tests/ico-png.mjs` are hand-written — an ICO directory walk, a bottom-up
BGRA decode, a PNG filter pass, a zlib stream, a CRC32 — and a wrong sign or an off-by-one in any of
them survives happily as long as one program reads what the same code wrote. So the bytes are also
handed to decoders that are not that code: `node qa/dump-icon-png.mjs` writes them out as
`qa/icon-16.png` and `qa/icon-32.png`, and `qa/favicon-pixel-check.ps1` (Windows only) asks GDI+ to
decode the PNG while PowerShell itself walks the ICO, and compares. Measured: 256 of 256 pixels at
16 px and 1,024 of 1,024 at 32 px read identically, with no pixel needing the premultiplied-alpha
allowance the script also offers. Chrome accepting the file is not the same evidence as that.

What a tab does with those bytes is a separate claim, and `qa/ui-check.mjs` measures it as far as a
headless browser can: every declared icon must be self-contained and name its size, the browser must
decode each one to exactly that size, the corners must stay transparent, and the decoded pixels must
hold the two colours the stones use — read while the palette the icon was built from is the one in
force, since the icon's cyan next to the paper theme's near-black ink would be a coincidence about
black rather than a statement about the icon. The 32 px frame holds both exactly (closest channel
delta 0, 25 and 22 pixels of them); the 16 px one holds them blended (nearest 3 and 4 away, 8 and 9
pixels), which is what happens to a mark a few pixels wide when it is drawn small. The pass also
enlarges both frames 8× nearest-neighbour into `qa/tab-icon.png`, because a smooth enlargement hides
exactly the pixel work that lets a 16 px drawing survive a tab. What none of this can show is a tab
strip: the QA browser is headless and has no tabs.

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

Then build the probe page and run the pass:

```powershell
node qa/make-probe.mjs      # qa/probe.html = index.html + qa/probe.js, injected before </body>
node qa/make-favicon.mjs    # says whether the tab icon in index.html is still what match5.ico produces; --write writes it
node qa/cdp-drive.mjs
node qa/site-check.mjs       # the address, not this folder: same bytes, all the parts, a game played there
```

The copy is **built, not kept**. It used to be updated by hand, and it drifted: a whole round of
changes to how marks are drawn went untested because the gate was measuring a page that still drew the
marks that used to be. `tests/file-check.mjs` now fails if `qa/probe.html` is not exactly
`index.html` plus that script, and says to run `qa/make-probe.mjs` — so the copy cannot be behind the
game it is a copy of. One consequence of a single-file page is worth knowing before reading a log: a
path in the game resolves against the page that runs it, so the copy in `qa/` looks for `sounds/`
inside `qa/` and reports those files missing. It still plays. Anything that reads files by path — the
sound gate, the remembered-settings gate — runs against `index.html` itself.

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
tested on the shipped `index.html` rather than on the probe page, because the probe pins the
levels from the URL hash and would hide what the page restored by itself. For the eye it writes
`qa/log-look.png`, `qa/settings-open.png`, `qa/board-slate.png`, `qa/board-paper.png`,
`qa/board-paper-winner.png` (a finished game, so the red five is in the frame) and
`qa/board-remembered.png`.

The marks are measured as pixels as well. `node qa/pen-ab.mjs` draws one position at several pen
widths and reports what each produces: the line it draws in px at the cell size actually on screen, the
mark's extent as a fraction of a cell, and how much of the square its colour covers — the numbers
behind [How thick the pen is](#how-thick-the-pen-is). It stays a separate tool rather than a gate
because it answers a question that has no pass/fail bar: what a given thickness would look like. It
reads colour the same way the legibility pass does, as a projection between the surface and the mark,
which is why a thin line still counts and a pale grid line does not.

The marker for the last move is read out of the canvas by the same pass, at 13×13 where a cell is
54–56 px and the drawing can be examined at that scale. The grid is measured off the lines the board
drew, not assumed; a mark is placed with real mouse events, the pointer is then parked off the board so
that the hover ghost cannot be mistaken for ink; the mark's centre is refined from its own deep ink
(the cell arithmetic is good to about a pixel, and the clearances here are a few pixels); and the
search is sixteen wedges 16° wide rather than a hair-thin ray — a 1.5 px line sampled along one ray at
half-pixel steps can be missed entirely, which is what an earlier version of this check did, and it
failed on the check rather than on the page. For a cross it wants ink at the four directions its arms
point (measured: 0.64–0.67 of a cell out) and **none** of the other twelve; for the round mark it wants
a whole circle (measured: 0.47–0.51 of a cell, in all sixteen). That is precisely the test a circle
around a cross would fail, and the reason the cross is drawn with ends. For the eye it writes
`qa/board-last-marker.png`, with a cross and then a circle placed last.

The position bar is checked by playing a line whose lead changes hands and reading the laid-out boxes
rather than the style text, as described in [The position bar](#the-position-bar). It writes
`qa/board-eval-bar.png`, with the bar grown towards the side that is ahead. The tab icon is checked by
having the browser decode it, as described in [Icon](#icon); it writes `qa/tab-icon.png`, the 16 px and
32 px frames enlarged 8× nearest-neighbour. Four of the pass's findings carry an exit code — the shape
of the marker, which way the bar grew, whether the sound switch came back as it was left, and whether
the page still carries a decodable icon at the sizes it declares — because those are things that can
simply be wrong; the rest of the pass reports what it measured and leaves the reading to whoever runs
it.

`node qa/sound-check.mjs` (18 checks) drives the shipped page in the browser: each of the five clips
is asked for and starts, the length Chrome reports is compared with the length counted in frames and
required to differ by the *same* offset for all five, a move plays exactly one clip, and nothing is
logged to the console as an error. It needs the same Chrome as the other browser gates, and it runs
against `index.html` rather than the copy in `qa/` because the clips are found by path.

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
