# 3D sphere, isotropic R/h 48: grid-position (offset) sensitivity study

Option A of `docs/sphere3d-uncertainty-audit/README.md` (section 5): the R/h 48 case at grid offsets 0.25, 0.5 and
0.75, added to the archived offset-0 run (`docs/sphere3d-refinement/`, not rerun). Solver, scheme, flux, stopping rule
and settings are unchanged; no archive was modified. `node scripts/rh48-offsets-analysis.mjs` recomputes every number
below from the summaries and profiles (`analysis.txt` is its output).

Labels: **measured** (from these runs or the archives), **estimated** (a calculation that rests on a stated
assumption), **unknown** (no measurement).

## 1. Configuration and checks before the runs

| item | value |
|---|---|
| case | `runSphereCase` through `scripts/sphere3d-resumable.test.ts`: M∞ 2, γ 1.4, inviscid; Rusanov, MUSCL-minmod after 150 first-order steps, SSP-RK2, CFL 0.8, local time steps; cut cells with merging |
| domain, grid | reduced quarter domain 2R / 0.5R / 2R; h = R/48, 120 × 96 × 96 = 1 105 920 cells |
| stopping rule | residual in x < 0 down 4 orders and \|net mass flux\| < 1e-3 (the refinement study's rule); maxSteps 20 000 |
| offsets | 0.25, 0.5, 0.75 (shift of the grid in x by that fraction of a cell; offset 0 from the archive) |
| checkpoints | every 500 steps and at each segment end, `<scratchpad>/rh48-offsets/off<offset>/rh48.ckpt` (outside the repository) |
| outputs | `off0.25/`, `off0.5/`, `off0.75/` (profile CSV + `summary.jsonl` each), `segments.jsonl`, `checkpoints.sha256`, `resources.txt`, `analysis.txt`, `run-segment.sh` |

Checks (all passed):

- **Configuration identity**: the harness passes `{mach 2, radiusCells 48, wall cutcell, flux rusanov, gridOffset,
  maxSteps 20000, downstream 0.5, lateral 2}` — the archived offset-0 options exactly, apart from the offset; all other
  settings are `runSphereCase` defaults, as in the archive. The harness and the archive's `sphere3d-measure` script use
  the same detector formulas, profile format and naming.
- **Reproduction with a non-zero offset**: the archived Rusanov R/h 16 offset-0.25 run, rerun through the harness with
  the current code (scratch directory), is **bit-identical** to the archive — options, grid, 1 049 steps, residual
  drop, mass imbalance, symmetry error, every detector, every profile row.
- **No overwrite possible**: new output and checkpoint directories (did not exist); the harness refuses a fresh start
  over an existing checkpoint and any output inside the raw-data archives; file names contain the offset.
- **Resources**: 4 cores, 15.6 GiB available, idle machine. Segment 1 of each run was stopped at step 200 (50
  second-order steps) to measure rate and memory before continuing (measured: 190 s, 656 MiB per worker —
  within the audit's estimate), then resumed.

## 2. Execution

| offset | segment 1 (fresh, STOP_AT 200) | segment 2 (resume) | status | steps | residual drop | mass imbalance | solver time | checkpoints |
|---|---|---|---|---|---|---|---|---|
| 0.25 | 07:54:43 – 07:57:53 | 07:58:28 – 09:05:11 | converged | 3 015 | 4.0000 | 7.12e-4 | 4 181 s | 7 |
| 0.5 | 07:54:43 – 07:57:54 | 07:58:28 – 09:06:21 | converged | 3 018 | 4.0003 | 7.12e-4 | 4 252 s | 7 |
| 0.75 | 07:54:43 – 07:57:54 | 07:58:28 – 09:06:19 | converged | 3 020 | 4.0005 | 7.06e-4 | 4 250 s | 7 |

All exit codes 0; lineage 0 → 200 → end in every result (the runs resumed, not restarted). Three runs in parallel:
**≈ 72 min wall** (audit estimate ≈ 1.5 h); 1.55 s per second-order step; peak resident memory 656 MiB (segment 1) and
940 MiB (segment 2) per worker, ≈ 2.8 GiB in total (audit estimate 0.7–0.8 GB per run; the measured 0.99 GB peak, during the
resumed segment with its checkpoint transients, is 25–40 % above it). Checkpoint size 49.6 MB. Details: `segments.jsonl`, `resources.txt`; checkpoint checksums: `checkpoints.sha256`.

## 3. Results at the four grid positions (measured)

| offset | 50 % | steepest rise | equal area | shock width (cells) | symmetry error | nose p/pitot | source |
|---|---|---|---|---|---|---|---|
| 0 | 0.35835 | 0.35770 | 0.35924 | 2.89 | 9.5e-7 | 0.99204 | archive |
| 0.25 | 0.35878 | 0.35838 | 0.35957 | 2.86 | 5.2e-7 | 0.98653 | this study |
| 0.5 | 0.35880 | 0.35831 | 0.35961 | 2.95 | 1.1e-6 | 0.99559 | this study |
| 0.75 | 0.35809 | 0.35704 | 0.35915 | 2.98 | 3.7e-6 | 0.99454 | this study |

Detectors recomputed from the stored profiles agree with the stored values to ≤ 3.5e-7 R (the profile's 6-decimal
rounding).

| detector | mean | range | SD (n = 4) | offset 0 − mean | range in cells | range at R/h 24 / 32 (archive) |
|---|---|---|---|---|---|---|
| 50 % | 0.35851 | 7.09e-4 | 3.45e-4 | −1.55e-4 | 0.034 h | 1.19e-3 / 1.16e-3 |
| steepest rise | 0.35786 | 1.35e-3 | 6.28e-4 | −1.55e-4 | 0.065 h | 2.54e-3 / 2.91e-3 |
| **equal area** | **0.35939** | **4.58e-4** | **2.32e-4** | **−1.54e-4** | 0.022 h | 4.06e-4 / 3.73e-4 |

Deviations from the mean (equal area): −1.54e-4, +1.80e-4, +2.16e-4, −2.42e-4 for offsets 0, 0.25, 0.5, 0.75.

**What the scatter does with refinement (measured):** the equal-area position range in units of R is 4.1e-4 (R/h 24),
3.7e-4 (32), **4.6e-4 (48)** — it does not decrease with refinement over this span; in cell units it grows (0.010 h →
0.012 h → 0.022 h). The 50 % and steepest-rise ranges do decrease (by ≈ 40 % and 54 % from R/h 32 to 48) but remain
larger than the equal-area range. Offset 0 is not an outlier at R/h 48 (two positions lie above and one below it).

## 4. Equal-area extrapolation with the measured R/h 48 scatter

R/h 64 has one grid position in every variant. "Mean-based": 4-offset means at R/h 24, 32 and 48.

| triplet | offset-0 values: p, f_ext, GCI | mean-based: p, f_ext, GCI | difference (position term) |
|---|---|---|---|
| 24/32/48 (no R/h 64) | 1.04, 0.35128, ±0.0099 | **0.82, 0.34868, ±0.0134** | 2.6e-3 |
| 24/48/64 | 1.09, 0.35180, ±0.0068 | **0.89, 0.34986, ±0.0092** | 1.9e-3 |
| 32/48/64 | 1.12, 0.35194, ±0.0066 | **0.93, 0.35018, ±0.0088** | 1.8e-3 |
| 24/32/64 | 1.06, 0.35153, ±0.0071 | 0.85, 0.34926, ±0.0100 | 2.3e-3 |

**Sensitivity to the R/h 48 position (measured inputs, exact recomputation):** with the R/h 48 value taken from each
single position instead of the mean, 32/48/64 gives f_ext 0.35255 / 0.34427 / 0.34210 / 0.35344 (p 1.24 / 0.58 /
0.51 / 1.42) — a spread of **1.1e-2**; 24/48/64 gives a spread of 6.7e-3. A single-position point at a fine grid moves
the extrapolation by more than the formal GCI.

**Updated estimate (estimated):**

- Position-averaged equal-area extrapolation **f_ext ≈ 0.3487–0.3502 R** (the four mean-based triplets), observed order
  **0.82–0.93** — lower than the 1.04–1.12 obtained from the single-position values, which the audit had flagged as
  partly a property of those values.
- Formal GCI (Fs 1.25) **±0.0088–0.0134**.
- Position term at R/h ≤ 48, taken as the difference between the offset-0 and the mean-based triplets (the audit's
  definition): **1.8–2.6e-3**. Not contained in the GCI.
- Position term at R/h 64: **unknown** (one position). *Conditional illustration only:* if the R/h 64 scatter had the
  R/h 48 SD (2.3e-4), the single R/h 64 value would move the 32/48/64 result by ≈ 2–3e-3 (one SD); no R/h 64 scatter
  was measured.
- Iteration error (audit, R/h 64): ≈ +5.5e-5, negligible against all of the above.

Not claimed: formal (asymptotic) convergence — the order changes with the triplet and with position averaging, and the
scatter does not shrink with h; agreement with the axisymmetric solver (section 6).

## 5. Decision rule (fixed in the audit before the runs), applied exactly

| criterion | value | result |
|---|---|---|
| equal-area 4-offset range ≤ 4e-4 (stop) / > 4e-4 (escalate) | 4.58e-4 | **> 4e-4** |
| \|offset 0 − mean\| ≤ 1e-4 (stop) / > 2e-4 (escalate) | 1.54e-4 | between the limits |

The stop condition requires both criteria and fails on both. The escalation condition ("range > 4e-4 **or** offset 0
more than 2e-4 from the mean") holds through the range. **The rule therefore says: the triplet is position-dominated,
the extrapolation is to be quoted with the position term added (section 4), and an R/h 64 position study becomes
justified.** Noted for transparency: the range exceeds the limit by 15 %, and a 4-sample range is itself uncertain;
the offset-0 criterion alone would have placed the result in the "in between" band. The rule was applied as written.

**Assessment of an R/h 64 offset study (not started; needs approval):**

- *What it would resolve:* R/h 64 is now the only single-position point in the 32/48/64 and 24/48/64 triplets, and
  section 4 shows single-position fine-grid values move f_ext by up to 1.1e-2. Offsets at R/h 64 would give a fully
  position-averaged 32/48/64 triplet and the first measured scatter at the finest grid (does the equal-area range
  stay ≈ 4–5e-4 in R?).
- *What it would not resolve:* the formal GCI (±0.009) would remain the dominant term; even with four R/h 64 positions,
  a mean with SD ≈ 1.2e-4 (if the R/h 48 scatter applied, which is not assumed here) would still leave ≈ 1–3e-3 of
  position uncertainty in f_ext. It cannot by itself establish 3D–axisymmetric agreement at the 1e-3 level.
- *Cost (estimated from the measured rates):* three offsets in parallel, 2.62 M cells each, ≈ 4 040 steps: at the
  measured 1.55 s/step for R/h 48 scaled by the cell ratio 2.37, ≈ 3.7 s/step → **≈ 4–5 h wall**, three 100-min
  segments per run; peak memory ≈ 1.5–1.8 GB per run (R/h 64 dry run) → ≈ 5.4 GB in total; checkpoints 114 MB each.
  A single extra position (offset 0.5) costs ≈ 3.75 h and gives only a two-point range.
- *Recommendation:* the rule supports **requesting approval** for an R/h 64 offset study (offsets 0.25, 0.5, 0.75 to
  match the R/h ≤ 48 practice). It is worth running if the 3D result is to be quoted as a position-averaged
  extrapolation with a measured position term; it is not needed to decide that the 3D result is, for now, a converging
  trend rather than a reference value (section 7).

## 6. Against the axisymmetric reference (measured / estimated)

| R/h | 3D equal area (4-offset mean) | axisymmetric equal area | gap | 3D 50 % (mean) | axisymmetric 50 % | gap |
|---|---|---|---|---|---|---|
| 32 | 0.36360 | 0.35899 | 4.61e-3 | 0.36184 | 0.35668 | 5.16e-3 |
| 48 | **0.35939** | 0.35588 | **3.51e-3** | **0.35851** | 0.35500 | **3.51e-3** |
| 64 | 0.35723 (one position) | 0.35408 | 3.15e-3 | 0.35680 (one position) | 0.35339 | 3.41e-3 |

The position-averaged R/h 48 gap (3.51e-3) is slightly larger than the offset-0 value (3.35e-3). From R/h 32 to 48
the equal-area gap falls by a factor 0.76 (h ratio 0.67); from 48 to 64 by 0.90 (h ratio 0.75), with R/h 64 single
position. The position-averaged equal-area extrapolation (0.3487–0.3502) lies inside the axisymmetric engineering band
(0.3485–0.3508), but with a formal GCI of ±0.009 this is **consistency within the uncertainty, not demonstrated
agreement**; the axisymmetric values' own position dependence is not part of this study.

## 7. Status for integration (unchanged hold)

| item | status |
|---|---|
| R/h 48 grid-position scatter | **measured**: equal area 4.6e-4 range, 2.3e-4 SD; 50 % 7.1e-4; steepest 1.35e-3 |
| equal-area extrapolation | **estimated** 0.3487–0.3502 R (position-averaged at R/h ≤ 48), GCI ±0.0088–0.0134, plus position term 1.8–2.6e-3, plus an **unknown** R/h 64 position term |
| decision rule | **escalation branch** (range > 4e-4) → R/h 64 offset study justified, **awaiting approval** |
| 3D–axisymmetric agreement | **not demonstrated**; consistent within the uncertainty |

The 3D result remains suitable as a verified, grid-converging trend, not as a reference value at the 1e-3 level.
Integration stays on hold as instructed.
