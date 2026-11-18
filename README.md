[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/c/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mmr9759/token-radar-01-v10/rank.svg)](https://make.fun/c/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mmr9759/token-radar-01-v10/reward.svg)](https://make.fun/c/token-radar-01)

# Token Launch Radar — radar-10

Entry for make.fun `token-radar-01` ($1,325, top 10, deadline 14 Dec 2026),
built as `@mmr9759`.

## What it is

`main.ts` (Node 22, standard library only, deterministic) reads the sealed
snapshot at `/input/snapshot.json` and writes a ranked board of the **198
clean pre-token protocols** to `/output/board.json`, plus the dashboard,
three screenshots and `dossier.json`.

## The model

`log(mcap / TVL)` fitted on the 128 protocols whose token already trades:

- per-category multiple (median, shrunk K=6 toward the global median
  0.21×), log-multiples winsorised at the global 90th percentile first, so
  one wild comp (a 400× mcap/TVL) cannot set its whole category;
- a **half-strength size slope** (−0.35 per log10 TVL), fitted on residuals
  *after* the category effect and anchored at each category's mean size, so
  a protocol 10× its category's typical size keeps about 70% of its
  multiple;
- **no growth term, no age term**: both were tested blind (leave-one-out
  and walk-forward) and neither beat the model without them, so they were
  dropped instead of fitted in.

Blind check, computed by the entry itself: leave-one-out error 5.7× vs
6.1× for a flat global multiple; walk-forward (fit on protocols listed
before 2024-07-01, test on later ones) 6.0× vs 6.5×. The gain is modest
and consistent across both blind tests — the ranking is a value estimate,
not a promise.

## The board

198 rows: every protocol that records no token and passes the watchlist's
cleanliness rules (no wrapped/staked/bridged product, no versioned name,
no exchange prefix), at any TVL from $5M up. All 40 watchlist protocols
are included. Each row carries a farm plan generated from its own figures
(category, main chain, TVL tier, 7d move).
