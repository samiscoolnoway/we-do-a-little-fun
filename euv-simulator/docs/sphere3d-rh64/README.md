# 3D Cartesian sphere, isotropic R/h 64: checkpointed run and refinement analysis

The finest isotropic 3D grid so far, run in three resumable segments with the validated checkpoint/restart support
(`docs/checkpoint-restart/`). Solver, scheme, flux, stopping rule and settings are unchanged; nothing in the solver
or the checkpoint format was modified for this run. Everything below is verification evidence; the axisymmetric
value is a reference estimate, not ground truth.

`node scripts/rh64-analysis.mjs` recomputes sections 3–5 from `summary.jsonl` here, `docs/sphere3d-refinement/` and
the axisymmetric archives (`analysis.txt` is its output). `PREDICTION.md` was written while segment 1 was running,
before any result of the run existed.

## 1. Configuration

| item | value |
|---|---|
| case | `runSphereCase` (sphere3d.ts) through `scripts/sphere3d-resumable.test.ts`: M∞ 2, T∞ 220 K, p∞ 2500 Pa, γ 1.4, inviscid |
| domain | reduced quarter domain, 2R upstream / 0.5R downstream / 2R lateral (as every refinement case from R/h 24 up; domain effect < 1e-4 R at R/h 12 and 24) |
| grid | uniform cubes h = R/64; **160 × 128 × 128 = 2 621 440 cells** (2 395 341 fluid; 164 × 132 × 132 padded), grid offset 0 |
| scheme | Rusanov, MUSCL-minmod after 150 first-order steps, SSP-RK2, CFL 0.8, local time steps |
| wall, boundaries | cut cells with merging (5 708 merged groups, largest 9 cells, none left small); supersonic inflow, extrapolation at x_max, y_max, z_max, symmetry planes y = 0, z = 0 |
| stopping rule | residual in x < 0 down 4 orders and \|net mass flux\| < 10⁻³ of ρ∞V∞πR²/4; maxSteps 20 000 |
| checkpoints | every 500 steps and at each segment end, `<scratchpad>/rh64-run/rh64.ckpt` (outside the repository, atomic writes) |

Before the run, a dry run with the exact configuration in a separate scratch directory checked: setup + one step in
14 s, peak memory 1.5–1.7 GB, checkpoint 114.3 MB, a fresh start over an existing checkpoint refused, a resume with a
different CFL refused (`config.cfl: checkpoint 0.8, run 0.7`), and a resume continuing at the right step with the
segment recorded.

## 2. Execution

| segment | start (UTC) | end (UTC) | wall time | steps | residual drop | mass imbalance | checkpoints | exit | status |
|---|---|---|---|---|---|---|---|---|---|
| 1 (fresh) | 2026-10-18 11:26:46 | 13:06:52 | 100.1 min | 0 → 1 704 | 2.04 | 5.6e-2 | 4 | 0 | interrupted at the 100 min budget |
| 2 (resume) | 13:07:37 | 14:47:41 | 100.1 min | 1 704 → 3 576 | 3.60 | 1.7e-3 | 5 | 0 | interrupted at the 100 min budget |
| 3 (resume) | 14:48:28 | 15:13:52 | 25.4 min | 3 576 → 4 042 | **4.00** | **6.8e-4** | 1 | 0 | **converged** |

Total solver time 13 508 s (3.75 h; 3.1–3.5 s per step); checkpoint size 114.3 MB. `segments.jsonl` records each
segment's command, times, exit code, checkpoint path, size and status. That the run resumed rather than restarted is
shown by the checkpoint written at step 2 000 during segment 2 (lineage 0 → 1 704 → 2 000) and by the final lineage
0 → 1 704 → 3 576 → 4 042 in the result.

**Validation of the final result:** the last checkpoint (step 4 000) records exactly the run's configuration and
geometry fingerprint; resuming it once more (scratch directory) reproduced the archived final result bit for bit
(step 4 042, residual drop, mass imbalance, every detector, symmetry error, nose pressure, wall total temperature).
The detectors recomputed from the stored profile agree with the solver's to 5e-7 R (the 6-decimal rounding).

## 3. Result at R/h 64

| quantity | value |
|---|---|
| stopping criterion | met at step 4 042: residual drop 4.0007, mass imbalance 6.8e-4 |
| standoff, 50 % density jump | **0.35680 R** |
| standoff, steepest rise | **0.35672 R** |
| standoff, equal area | **0.35723 R** |
| 10 % / 90 % crossings, shock width | 0.38054 / 0.33471 R, 2.93 cells |
| nose cell p/pitot, p0/pitot, T/T0 | 0.9939, 0.9943, 1.0029 |
| front wall p0/pitot mean (min–max), max \|T0 error\| | 0.958 (0.884–1.001), 1.61 % |
| body mass flux | 0 (closed cut-cell wall) |
| upstream deviation (> 5 cells ahead of the shock) | 4.4e-4 (shock foot) |
| y ↔ z symmetry error | 1.6e-4 overall, located downstream at the outflow (x ≈ 0.46, r ≈ 1.8); ≤ 1.0e-5 for x < 0; 7e-13 within 0.25 R of the axis |

Detector spread 5e-4 R (equal area highest). Only grid offset 0 was run: the grid-position scatter at R/h 64 is not
measured; extrapolating the measured offset ranges (equal area 0.0004 R at R/h 24 and 32; 50 % 0.0012 R at 24 and
32) it is a few 1e-4 R.

## 4. Refinement table (isotropic, reduced domain, offset 0; 4-offset means where measured)

| R/h | cells | steps | 50 % | steepest | equal area | 50 % 4-offset mean (range) | equal area 4-offset mean (range) |
|---|---|---|---|---|---|---|---|
| 8 | 5 120 | 564 | 0.36491 | 0.31071 | 0.37960 | 0.37069 (0.0086) | 0.38543 (0.0114) |
| 12 | 17 280 | 798 | 0.37317 | 0.36051 | 0.38028 | 0.37340 (0.0034) | 0.38076 (0.0049) |
| 16 | 40 960 | 1 060 | 0.36988 | 0.36389 | 0.37424 | 0.36929 (0.0018) | 0.37436 (0.0017) |
| 24 | 138 240 | 1 546 | 0.36543 | 0.36294 | 0.36764 | 0.36486 (0.0012) | 0.36755 (0.0004) |
| 32 | 327 680 | 2 045 | 0.36121 | 0.35839 | 0.36341 | 0.36184 (0.0012) | 0.36360 (0.0004) |
| 48 | 1 105 920 | 3 040 | 0.35835 | 0.35770 | 0.35924 | — | — |
| **64** | **2 621 440** | **4 042** | **0.35680** | **0.35672** | **0.35723** | — | — |

Local slope Δf/Δh (R per unit h/R): equal area 0.317 (16→24), 0.406 (24→32), 0.401 (32→48), **0.385 (48→64)**;
50 % (4-offset means where available) 0.213, 0.290, 0.335, **0.298**.

**What the data support.**
- *Equal-area detector (lowest grid-position noise):* the slope is nearly constant from R/h 24 to 64, and every
  overlapping triplet of R/h ≥ 24 gives the same observed order: p = 1.04 (24/32/48), 1.06 (24/32/64), 1.09
  (24/48/64), 1.12 (32/48/64), with f_ext = 0.35128, 0.35153, 0.35180, 0.35194. This is the first time the 3D series
  shows a consistent observed order across overlapping triplets. Formal GCI on the R/h 64 value: ±0.0066–0.0071 R
  (large because p ≈ 1 and the refinement ratios are only 1.33–2).
- *50 % detector:* noisier (single grid positions at 48 and 64; 4-offset range 0.0012 R at 32): offset-0 triplets
  that include R/h 64 give p = 0.76–1.81 (f_ext 0.3505–0.3550); with the 4-offset means, 24/48/64 gives p 1.09 (0.35257) and 32/48/64
  p 1.33 (0.35345). The two finest points with p = 1: 0.35214.
- *Steepest rise:* erratic triplets (p 1.5–6.9); not used for extrapolation.
- *Pre-registered predictions:* the first-order 3D error model of the gap study predicted 0.35691 (50 %) / 0.35736
  (equal area) — off by −1.1e-4 / −1.3e-4; the p = 0.85 form by −1.7e-4 / −0.9e-4; a constant last slope by +2.0e-4
  / +1.7e-4; continued sub-linear convergence by +4.0e-4 / +4.3e-4. The first-order forms are confirmed to within the
  expected single-position scatter; continued slowing of the convergence is disfavoured but not excluded by one point.

So: **an observed order of ≈ 1.0–1.1 for the equal-area detector over R/h 24–64 is supported**; an extrapolated 3D
standoff of **≈ 0.3513–0.3519 R (equal area, first-order assumption confirmed by the triplets)**, with the 50 %
detector between ≈ 0.3505 and 0.3550 depending on the triplet. This is a formal extrapolation, not a measured value.
The R/h 64 measurement itself is not converged in the sense of being independent of h: the step 48 → 64 still
lowered the standoff by 0.0016–0.0020 R.

## 5. Comparison with the axisymmetric reference

| | 50 % | equal area |
|---|---|---|
| 3D R/h 64 (measured) | 0.35680 | 0.35723 |
| axisymmetric R/h 64, aspect 1 (measured; phase mean of R/h 64–68) | 0.35339 (0.35361) | 0.35408 (0.35417) |
| gap at R/h 64 | 0.0034 (0.0032 vs the phase mean) | 0.0032 (0.0031) |
| gap at R/h 48 (for comparison) | 0.0034 | 0.0034 |
| 3D R/h 64 above the top of the axisymmetric band (0.3508) | 0.0060 | 0.0064 |
| 3D extrapolated (section 4) | ≈ 0.3505–0.3550 | ≈ 0.3513–0.3519 |
| axisymmetric limit estimates (docs/axi-reference-refinement) | 0.3477–0.3508 | 0.3486–0.3502 |
| difference of the extrapolated limits | spans 0 (overlapping ranges) | **+0.0011 … +0.0033** |

**Measured:** at R/h 64 the 3D standoff is 0.006 R above the axisymmetric band, and the gap to the axisymmetric
solver at the same R/h (≈ 0.0032–0.0034 R) did not shrink from R/h 48 to 64 (it had shrunk from ≈ 0.009 at R/h 12),
although both single-position values carry a few 1e-4 R of grid-position scatter.
**Extrapolated:** with the equal-area detector, whose triplets are consistent in both solvers, the 3D limit lies
0.0005–0.0011 R above the top of the axisymmetric band and 0.0011–0.0033 R above the axisymmetric equal-area limit
estimates; with the 50 % detector the ranges overlap. Iteration error shifts both solvers by a near-constant amount
(+0.6e-4 3D at R/h 24, +1.1e-4 axisymmetric), which narrows the difference by ≈ 0.5e-4.
**Engineering judgement (not a formal result):** the two solvers agree on the Mach 2 sphere standoff to within
≈ 0.001–0.003 R (0.3–1 %) in the limit; a small residual difference of that size, possibly from the different
discretisations (Cartesian cut cells vs body-fitted grid), can neither be excluded nor confirmed with the present
data — the formal 3D GCI (±0.007 R) is far larger than the difference. Convergence of the 3D solver to the
axisymmetric value is **not** demonstrated; that the R/h 64 value is closer to the reference than R/h 48 is not
evidence of convergence by itself.

## 6. Limitations and open issues

- R/h 48 and 64 were run at one grid position only; their scatter (a few 1e-4 R) is estimated, not measured.
- The 3D y ↔ z symmetry error grew to 1.6e-4 at R/h 64 (1e-6 at R/h 48, 1e-8 at R/h 32), concentrated at the
  downstream outflow boundary in supersonic flow; ahead of the sphere it is ≤ 1e-5 and on the stagnation line
  7e-13, so the standoff is not affected. Its cause (round-off growth over 4 000 local steps at the outflow, or a
  slightly asymmetric operation order) was not investigated.
- 3D iteration error at R/h 64 was not measured (+6e-5 at R/h 24).
- The 3D extrapolation rests on four grids (24–64) and on the equal-area detector; the 50 % detector's triplets
  are not consistent enough for a formal estimate.
- A finer isotropic grid (R/h 96: ≈ 8.8 M cells, ≈ 6 000 steps at ≈ 11 s each, ≈ 19 h in ≈ 12 segments of
  100 min; ≈ 375 MB per checkpoint, ≈ 6 GB memory) would be the next refinement step; alternatively, a second grid position at R/h 48 or
  64 (≈ 1.5 h / 3.75 h) would measure the scatter of the two finest points.

## Files

| file | contents |
|---|---|
| `s3d_rusanov_cutcell_Rh64_off0_downstream0.5_lateral2.csv` | stagnation-line profile with `# meta` header (format of `docs/sphere3d-refinement/`) |
| `summary.jsonl` | run summary (as in the refinement archive, plus `resumedFromStep`, `lineage`, `checkpoint`) |
| `segments.jsonl` | one record per segment: times, exit code, checkpoint path and size, status |
| `PREDICTION.md` | predictions written before the result |
| `analysis.txt` | output of `node scripts/rh64-analysis.mjs` |
| `SHA256SUMS` | checksums of the files above |

The checkpoint (step 4 000, 114.3 MB; SHA-256 prefix 1f9a633d5d9eba71) stays in the session scratchpad
(`rh64-run/rh64.ckpt`, with an identical copy used for the validation) and is not part of the repository.

Reproduce (each invocation ≤ 100 min of computing; repeat with RESUME=1 until the status file says converged):

```
cd euv-simulator
RH=64 EXTRA='{"downstream":0.5,"lateral":2}' CKPT=<dir>/rh64.ckpt EVERY=500 BUDGET_MIN=100 OUT=<new dir> RESUME=0 \
  npx vitest run --root . --config /dev/null --testTimeout 14400000 scripts/sphere3d-resumable.test.ts
node scripts/rh64-analysis.mjs
```
