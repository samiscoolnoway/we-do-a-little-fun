# Prediction recorded before the R/hx = 64, R/hyz = 32 runs

Recorded 2026-10-18 03:10 UTC, before launching `GRIDS=64:32 OFF=0,0.5`. Fitted on the 3D runs then
available (subset C of scripts/gap-analysis.mjs: R/hx ≥ 24, R/hyz ≥ 12, converged; 9 grid families, offset means).
The full analysis output at that moment is saved next to this file (analysis_before_64.txt).

| detector | linear model f0 + A·hx + B·hyz | p = 0.85 model f0 + A·hx^0.85 + B·hyz^0.85 |
|---|---|---|
| 50 % | f0 0.35191, A 0.453, B −0.140 → **0.35461** | f0 0.35057, A 0.321, B −0.107 → **0.35431** |
| equal area | f0 0.35102, A 0.536, B −0.136 → **0.35515** | f0 0.34921, A 0.378, B −0.104 → **0.35477** |

Expected scatter of a two-offset mean at R/hx = 64: a few 1e-4 R (the four-offset range is 0.0006–0.0012 R at
R/hx = 32, decreasing with refinement).
