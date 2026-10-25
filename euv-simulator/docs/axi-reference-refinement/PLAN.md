# Run plan and cost estimates (written 2026-10-18 06:09 UTC, before any run of this study)

Cost model from the gap-study runs of the same solver and harness (scripts/gap-axi-measure.test.ts):
0.94–0.98 µs per cell-step (runs that shared the 4-core machine; 0.68 µs for R/h 128 run alone in the original
audit), steps ≈ 78·N (aspect 1) and ≈ 60.5·N (aspect 2) to the 4-order stopping criterion. Cells = 4N × round(1.658 N / aspect).
State memory ≈ 60 doubles per cell (estimate).

| case | grid | cells | steps (est.) | time (est., 0.7–1.0 µs) | memory (est.) | decision |
|---|---|---|---|---|---|---|
| R/h 192, aspect 2 | 768 × 159 | 122 112 | ≈ 11 600 | 17–24 min | ≈ 60 MB | phase 1 |
| R/h 256, aspect 2 | 1024 × 212 | 217 088 | ≈ 15 500 | 39–56 min | ≈ 100 MB | phase 1 |
| R/h 192, aspect 1 | 768 × 318 | 244 224 | ≈ 15 000 | 43–61 min | ≈ 120 MB | phase 1 |
| R/h 256, aspect 1 | 1024 × 424 | 434 176 | ≈ 20 000 | 101–144 min | ≈ 210 MB | not in phase 1: at or beyond the 2 h limit of a background job; the harness writes its result only at the end and the solver has no checkpoint, so an overrun loses the whole run. Re-estimate from the measured R/h 192 aspect-1 cost. |

Phase 1 runs the three feasible cases in parallel (3 of 4 cores; expect ≈ 1.3× slower each). Phase 2 (grid-phase
variations, iteration-error check) is chosen only after the phase-1 results are evaluated.
The 2 h limit is treated as a hard constraint: no run is detached to outlive it.
