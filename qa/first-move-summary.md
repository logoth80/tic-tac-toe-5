# First-move advantage - complete  (run 2026-10-27T12-21-56-341Z)

Both sides the same level and the same engine; only who moves first differs. 25x25, no forbidden moves, no swap rule, one core per side (the level worker pool belongs to the page and is not used here). Dice base 0x5eed0000, games per stratum 100.

| level | games | first wins | second wins | draws | first share of decisive | 95% CI | sign test p | median plies |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| easy | 100 | 67 | 33 | 0 | 67.0% | 57.3-75.4 | 0.0009 | 29 |
| medium | 100 | 58 | 42 | 0 | 58.0% | 48.2-67.2 | 0.1332 | 40 |
| hard | 100 | 84 | 16 | 0 | 84.0% | 75.6-89.9 | 0.0000 | 25 |

Across the strata above: first player 209, second player 91, share 69.7% (95% CI 64.2-74.6). Stratified sign-flip permutation test (10000 shuffles): p = 0.0001

Engine time measured inside the games: 13m39s across 300 games.

A share of 50% would mean no advantage. What 100 decisive games per stratum can resolve is about
±10 percentage points in one stratum; reading several strata together can see less than that,
so the interval is the result, not the share.