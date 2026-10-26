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
| Engine X / Engine Y | Easy, Medium, Hard, Expert per side |
| Look ahead | `Auto (by level)`, `0` (no search, local value only), `1`, or 2–12 ply |
| Move width | how many candidate moves are considered per position |
| Time | per-move budget in ms; `0` means the level's own default |

The engine runs in a Web Worker built from the serialised engine function, so the
board never blocks. The search panel reports what the search actually did: how
deep it got, how many positions it looked at, why it stopped (`clock ran out
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
five-completion square is a block, two distinct ones are already lost); and the
proof handling, including playing the proven line out on the board and counting
the half-moves to check the distance the engine promised.

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

`qa/probe.js` accepts hash cases in the URL (`#fast`, `#hard`, `#pvp`, `#d0`,
`#d12`) to pin mode, level and look-ahead. `qa/cdp-profile/`, `qa/*.png` and
`qa/probe.html` are generated and ignored.
