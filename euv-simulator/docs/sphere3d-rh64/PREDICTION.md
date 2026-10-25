# Predictions for the isotropic R/h 64 result, recorded before it exists

Recorded 2026-10-18 11:27 UTC, while segment 1 of the run was in progress (no checkpoint or result of the
run had been read). Sources: `node scripts/gap-analysis.mjs` on the unchanged gap-study and refinement data.

| source of the prediction | assumption | 50 % | equal area |
|---|---|---|---|
| 3D error model, linear in hx and hyz (gap study, finest subset C, 12 grid families) | f = f0 + A·hx + B·hyz holds down to R/h 64 | 0.35691 | 0.35736 |
| 3D error model, p = 0.85 (same data) | f = f0 + A·hx^0.85 + B·hyz^0.85 | 0.35697 | 0.35732 |
| isotropic family, constant last slope (32 → 48: 0.335 / 0.419 R per unit h) | slope stays constant | 0.35660 | 0.35706 |
| isotropic family, slope keeps rising as from 24→32 to 32→48 (+0.045 per step) | sub-linear convergence continues | ≈ 0.3564 | ≈ 0.3568 |

Expected scatter of a single grid position (offset 0) at R/h 64: a few 1e-4 R (four-offset range 0.0012 R at R/h 32
for the 50 % detector, 0.0004 R for equal area). A value near 0.3569–0.3574 favours first-order behaviour along
the isotropic family; a value near 0.3564 or below favours continued sub-linear convergence; a value inside the
axisymmetric band (0.3485–0.3508 R) would contradict every 3D model above.
