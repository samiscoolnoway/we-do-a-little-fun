# Uncertainty audit of the 3D sphere refinement at R/h 48 and 64

Scope: the two finest isotropic 3D results (`docs/sphere3d-rh64/`, `docs/sphere3d-refinement/`). No solver, flux,
scheme, stopping rule, checkpoint format, UI or archived data was changed. Every new number below comes from
diagnostics that only **read** existing checkpoints (copies are advanced in memory) or from small R/h 24/32 runs
written to the scratch directory; the outputs are copied to `data/` here (`SHA256SUMS`). No R/h 48 or R/h 64 case
was rerun. The diagnostic script is `scripts/sphere3d-probe.test.ts` (not part of `npm test`).

Labels used throughout: **verified** (measured here or reproduced exactly), **estimated** (from a validated model or a
measured analogue, with the assumption stated), **unknown** (no measurement exists; no number is given).

## 1. Reproduction of the archived measurements and extrapolations

| check | result |
|---|---|
| archive checksums | `docs/sphere3d-rh64/SHA256SUMS` all OK; all 218 files changed or added before this audit (including `docs/sphere3d-refinement/`, which has no SHA256SUMS of its own) match the checksums recorded in the pre-audit inventory |
| `node scripts/rh64-analysis.mjs` | byte-identical to `docs/sphere3d-rh64/analysis.txt` |
| detectors recomputed from the archived profiles by an independent Python implementation (R/h 8–64) | identical to the stored values to the printed 5 decimals |
| Celik/Roache triplets recomputed independently | identical p, f_ext, GCI |
| probe detectors vs driver (R/h 12, step 400) | bit-identical |
| R/h 64 checkpoint (step 4 000) → detectors | 50 % 0.356794, steepest 0.356714, equal area 0.357227 (final step 4 042: 0.35680 / 0.35672 / 0.35723) |
| R/h 64 checkpoint advanced in memory to step 4 042 (direct solver steps, not the driver) | **bit-identical** to the archived final result: residual 6.0704e-3, drop 4.0007, all three detectors, symmetry error 1.6270974949e-4 |

Equal-area triplets (offset-0 values, the R/h ≥ 48 points have one grid position):

| triplet | p | f_ext | GCI (Fs 1.25) | asymptotic ratio |
|---|---|---|---|---|
| 32/48/64 | 1.12 | 0.35195 | ±0.0066 | 0.994 |
| 24/48/64 | 1.09 | 0.35180 | ±0.0068 | 0.994 |
| 24/32/64 | 1.06 | 0.35153 | ±0.0071 | 0.983 |
| 24/32/48 | 1.04 | 0.35128 | ±0.0099 | 0.989 |

**Assumptions behind these numbers, checked:**

- *Monotone convergence*: holds for equal area over 16 → 64 (local slopes 0.317, 0.406, 0.401, 0.385). It does
  **not** hold cleanly for the 50 % and steepest-rise detectors: their offset-0 local slopes oscillate (50 %: 0.214,
  0.405, 0.275, 0.298; steepest: 0.046, 0.437, 0.066, 0.189) and their triplet orders range 0.77–2.2 and 1.5–6.9 from R/h 24 up (0.13–2.2
  and 0.77–9.5 when R/h 16 is included).
  Those GCIs are not meaningful; only equal area is used for the formal estimate.
- *Asymptotic range*: the asymptotic ratio is ≈ 1 **by construction** for a single triplet whose p is solved from the
  same three points; it is not independent evidence. The real evidence is that the equal-area order is stable,
  1.04 → 1.12 as the triplet moves to finer grids (verified), drifting slightly upward.
- *Grid-position independence*: **violated at the measured levels** (section 2). The formal GCI does not contain
  grid-position scatter; it is reported separately.
- *Iteration error negligible*: verified (section 3), ≈ +5e-5 R, almost the same at every R/h.

## 2. Grid-position sensitivity (the dominant remaining uncertainty)

The grid offset shifts the grid in x by a fraction of a cell (`gridOffset`). Measured ranges over four offsets
(0, 0.25, 0.5, 0.75; all archived, verified):

| R/h | 50 % range | equal-area range | 50 % offset-0 − mean | equal-area offset-0 − mean |
|---|---|---|---|---|
| 16 | 1.80e-3 | 1.67e-3 | +5.9e-4 | −1.2e-4 |
| 24 | 1.19e-3 | 4.1e-4 | +5.7e-4 | +0.9e-4 |
| 32 | 1.16e-3 | 3.7e-4 | −6.3e-4 | −1.9e-4 |
| 48 | **unknown** (one position) | **unknown** | unknown | unknown |
| 64 | **unknown** (one position) | **unknown** | unknown | unknown |

The scatter did **not** shrink from R/h 24 to 32 (in units of R); in cell units it grew (50 %: 0.029 h → 0.037 h).
Two points cannot fix a scaling law, so nothing is extrapolated to R/h 48 or 64. The offset-0 50 % value switches
from the top of the range at R/h 24 to the bottom at 32, which is consistent with the oscillating 50 % slopes in
section 1.

**Nearest measured analogue (not a measurement of the isotropic case):** the anisotropic gap-study runs at
streamwise R/hx 48 with coarser lateral cells (`docs/sphere-gap-study/3d-aniso/`), two offsets each: 50 % range
6.3e-4 / 3.0e-4 and equal-area range 3.1e-4 / 1.5e-4 for lateral R/h 24 / 32. A two-offset range underestimates a
four-offset range.

**Sensitivity of the extrapolation to the single-position values (verified, exact recomputation):**

| triplet | perturbation | Δp | Δf_ext |
|---|---|---|---|
| equal area 32/48/64 | R/h 64 ± 1e-4 | +0.14 / −0.14 | +1.0e-3 / −1.3e-3 |
| equal area 32/48/64 | R/h 48 ± 1e-4 | −0.21 / +0.21 | −1.7e-3 / +1.2e-3 |
| equal area 24/48/64 | R/h 64 ± 1e-4 | +0.10 / −0.09 | +0.9e-3 / −1.0e-3 |
| equal area 24/48/64 | R/h 48 ± 1e-4 | −0.12 / +0.12 | −1.1e-3 / +0.9e-3 |
| 50 % 32/48/64 | R/h 48 ± 1e-4 | −0.28 / +0.29 | −4.7e-3 / +2.2e-3 |

A 1e-4 R shift at one grid moves f_ext by 1–2e-3 R, i.e. an amplification of 9–17. Replacing the R/h 32 offset-0
value by its four-offset mean (a measured change of 1.9e-4) already moves the equal-area 32/48/64 result from
p 1.12, f_ext 0.35195 to p 1.24, f_ext 0.35255 (verified). Over all triplets, using the 4-offset means at
R/h ≤ 32 instead of the offset-0 values changes f_ext by 1.3e-4 (24/48/64), 6.0e-4 (32/48/64) and 2.3e-3 (24/32/64:
p 1.06 → 0.85, f_ext 0.35153 → 0.34926) — a measured indication of how much the grid position matters. The R/h 48 value
is the more influential one (1.05–1.3× the leverage of R/h 64 per unit shift).

**Conditional illustration, not an estimate:** *if* the offset-0 deviation at R/h 48 and 64 were as large as the
largest one measured at R/h 32 (1.9e-4 for equal area) with unfavourable signs, f_ext would move by up to ≈ 5e-3,
comparable to the formal GCI of ±6.6e-3. Whether the real deviations are that large, or much smaller, is unknown.

## 3. Iteration error at the finest grid

Estimator: f∞ − f(n) ≈ K·res(n), K = Δf/Δres between two late states (validated, then applied).

| validation (drop 4 → 6, R/h 24 and 32, scratch runs) | 50 % | steepest | equal area |
|---|---|---|---|
| R/h 24: actual / predicted change | +5.68e-5 / +5.78e-5 | +6.35e-5 / +6.46e-5 | +5.48e-5 / +5.58e-5 |
| R/h 32: actual / predicted change | +5.31e-5 / +5.33e-5 | +4.55e-5 / +4.56e-5 | +4.95e-5 / +4.97e-5 |
| ratio | 0.983 / 0.995 | 0.983 / 0.996 | 0.983 / 0.995 |

**R/h 64, validated at R/h 64 itself (new):** a copy of the step-4 000 checkpoint was advanced 420 steps in memory
(to step 4 420, residual drop 4.32; 20 samples, `data/extend64.json`). K taken from steps 4 000 → 4 042 predicts the
change to step 4 420 within 2.2 % (ratio 1.021–1.022 for all three detectors). The detectors drift smoothly and
monotonically (equal-area increment per 21 steps 2.27e-6 → 1.10e-6, decreasing geometrically, largest second
difference 9e-8).

**R/h 64 iteration error (estimated):** from the archived final state (step 4 042) to full convergence
**+5.4e-5 (50 %), +5.6e-5 (steepest), +5.5e-5 (equal area)** — 3.3e-5 measured up to step 4 420 plus 2.6e-5
estimated beyond it. The offset is nearly the same at every R/h (R/h 24: 5.5–6.4e-5, 32: 4.6–5.3e-5 to 6 orders), so
it shifts f_ext by about +5e-5 and changes the observed order by < 0.01. Iteration error is not a limiting
uncertainty.

## 4. Downstream asymmetry (y ↔ z symmetry error 1.6e-4 at R/h 64)

**What it is not (verified):**

- *Geometry*: cut-cell volume fractions, solid mask and merge membership are exactly mirror-symmetric at R/h 24 and
  64 (0 differences; all 5 708 merged groups at R/h 64 have an exact mirror group).
- *An outflow-boundary problem*: every fluid cell on the outflow plane is supersonic at R/h 64 (min Mach 1.31, min
  normal Mach 1.29, 0 subsonic cells of 14 007), so the extrapolation boundary is well posed there.

**Where it is (verified, R/h 64 step 4 000):** worst 1.69e-4 at x = 0.46, r ≈ 1.76, inside the steep expansion/
recompression band behind the shoulder (supersonic, M ≈ 1.7). By x-slab: 1.2e-4 at the outflow, ≈ 3e-5 for
0.1 < x < 0.4, 1.3e-5 at x ≈ 0, 2.3e-6 at x = −0.09, 6e-7 at x = −0.27, ≈ 1e-8 in the subsonic region behind the
nose shock, 7e-13 within 0.25 R of the axis, ≤ 1e-14 upstream of the shock. Maximum over x < 0: 1.0e-5, just ahead
of the shoulder.

**Grid dependence (verified, drop-6 tracks):** after the start-up transient (peaks 6.4e-5 at R/h 24, 7.0e-4 at R/h 32,
both before step 250) the asymmetry decays to ≤ 1.2e-8 (R/h 24) and ≤ 2.5e-8 (R/h 32) and stays there. At R/h 64 it
is still 1.6e-4 at convergence. Between steps 4 000 and 4 042 it fell from 1.693e-4 to 1.627e-4 (−3.9 % while the
residual fell 8 %). Continued in memory to step 4 420 (`data/extend64.json`): the asymmetry is **not a fixed floor and
not monotone** — it swings between 2.1e-5 and 1.6e-4 (1.6e-4 → 4.3e-5 at step 4 168 → 1.0e-4 at 4 273 → 2.1e-5 at
4 378 → 5.0e-5 at 4 420), with a downward trend; its maximum ahead of the shoulder (x < 0) falls from 1.0e-5 to
0.8–3e-6; within 0.25 R of the axis it stays at 4e-13 – 2.4e-12. The nose detectors show no response to these
factor-8 swings (smooth geometric drift, section 3). Whether it decays to the ≈ 1e-8 level of R/h 24/32 at deeper
convergence is unknown.

**Working hypothesis (not demonstrated):** round-off asymmetry from the fixed x–y–z sweep order, amplified at
minmod near-ties in the steep-gradient supersonic band, decaying slowly at R/h 64. No solver defect is demonstrated,
so the solver was not changed.

### 4a. Does it reach the nose? Controlled perturbation experiment (R/h 32)

Smallest controlled test with the unchanged solver: take the R/h 32 state at step 2 000 (drop-6 run, checkpoint in
the scratch directory, checksum verified before and after), add a deliberate perturbation in a chosen region, converge
to a 6-order drop and compare the converged detectors with the unperturbed continuation. Perturbation: all conservative
variables of full cells scaled by (1 + A·w), w = sin(0.7i + 1.3j + 2.1k) ∈ [−1, 1].

Two shapes: *antisymmetric* (mirror cell scaled by 1 − A·w) and *one-sided* (only the j > k cell of each pair; a
symmetric plus an antisymmetric part). The one-sided shape is the stricter test: a purely antisymmetric perturbation
has a first-order response that is itself antisymmetric and therefore vanishes on the stagnation line (the y = z
plane contains it), so only the one-sided shape can show a first-order effect on the nose.

| run | region | amplitude | cells | steps | Δ50 % | Δsteepest | Δequal area | Δnose p/pitot | final symmetry |
|---|---|---|---|---|---|---|---|---|---|
| baseline | — | 0 | 0 | 3 244 | (0.361270871) | (0.358433343) | (0.363462059) | (0.9875949707) | 1.7e-8 |
| antisymmetric | x > 0 | 1e-4 | 26 280 pairs | 3 245 | +2.2e-9 | +1.9e-9 | n/r | −6e-10 | 2.2e-8 |
| antisymmetric | x > 0 | 1e-3 | 26 280 pairs | 3 244 | 0 | 0 | n/r | −9e-16 | 1.3e-8 |
| one-sided | x > 0 | 1e-3 | 26 280 | 3 244 | 0 | 0 | −2e-16 | −1e-15 | 1.6e-8 |
| one-sided | x > −0.5 | 1e-3 | 52 560 | 3 244 | +3.3e-12 | +2.8e-12 | +3.1e-12 | −1e-12 | 1.0e-8 |

n/r: not recorded in that run (equal area was added to the output afterwards). The baseline reproduces the archived
drop-6 track exactly (50 % 0.361270871). The 2e-9 of the 1e-4 run is consistent with one extra iteration (it stopped one
step later; the per-step drift at this residual is 2.3e-9).

**Result (verified for this experiment):** a transient disturbance of 1e-3 — 6× the R/h 64 outflow asymmetry and
100× its level at the shoulder — anywhere downstream of x = −0.5 changes the converged nose standoff by ≤ 4e-12 R.
The converged discrete state does not remember such a disturbance.

**What this does not show:** it tests a transient disturbance, not a *sustained* asymmetric source of the kind the
R/h 64 state carries; it is run at R/h 32, not 64; and the symmetry error measures only the antisymmetric part of
whatever round-off error the sweep order creates — a symmetric companion of similar size would be invisible to it.
The effect on the nose is therefore **bounded experimentally only for transient disturbances**; for the R/h 64 state
it is supported by (a) the measured decay from 1e-5 at the shoulder to ≈ 1e-12 on the axis, (b) the nose detectors
drifting smoothly (second differences ≤ 9e-8 per 21 steps) while the asymmetry swings by a factor of 8, and (c) the
iteration-error estimator behaving at R/h 64 as at R/h 24/32. Together these bound any asymmetry-linked fluctuation of
the R/h 64 standoff to the 1e-7 level over the sampled interval; a steady, symmetric bias of the same origin cannot be
excluded by these tests. It is not claimed to be zero.

## 5. Is another grid-position run worth its cost?

Measured costs: 1.27 µs per cell-step on one core of this 4-core, 15 GB machine (R/h 64: 13 508 s for 4 042 steps of
2.62 M cells); parallel runs are estimated to slow each other by ≈ 1.2–1.3× (memory bandwidth; the archived R/h 48 run took 5 319 s for 3 040
steps, 1.24× the per-cell rate of the R/h 64 run).

| option | cells | steps | solver time | wall time | memory | checkpoint | information |
|---|---|---|---|---|---|---|---|
| A: R/h 48, offsets 0.25, 0.5, 0.75 (3 runs in parallel) | 1.11 M each | ≈ 3 040 | ≈ 71 min each | **≈ 1.5 h** (one budget-limited segment + a short resume) | ≈ 0.7–0.8 GB each, ≈ 2.4 GB total | ≈ 50 MB each | first measured scatter at R/h ≥ 48; 4-offset mean at 48, matching 16–32 |
| B: R/h 48, offset 0.5 only | 1.11 M | ≈ 3 040 | ≈ 71 min | ≈ 1.2 h | 0.7–0.8 GB | 50 MB | a two-point range (weak: underestimates a 4-point range) |
| C: R/h 64, offset 0.5 | 2.62 M | ≈ 4 040 | 3.75 h | ≈ 4 h, 3 segments | 1.5–1.7 GB peak | 114 MB | scatter at the finest grid, but a single extra point |

**Recommendation: option A first; not C.** Per unit shift, f_ext is 1.05–1.3× more sensitive to the R/h 48 value than to
R/h 64 (section 2), A costs about a third of C in wall time, and it turns the 32/48 pair of the triplet into
4-offset means like R/h 16–32, leaving R/h 64 as the only single-position point. C would only be worth running after A
if A shows a large scatter.

**Decision rule, fixed before any result:**

- If the R/h 48 equal-area 4-offset range is ≤ 4e-4 **and** the offset-0 value lies within 1e-4 of the mean: the
  position-induced change of f_ext is ≲ 1.5e-3, below the formal GCI; report f_ext from the mean-based triplet and
  stop — no R/h 64 position run.
- If the range is > 4e-4 or offset 0 deviates by more than 2e-4 from the mean: the triplet is position-dominated;
  the extrapolation should be quoted with the position term added, and option C (or a second R/h 64 position)
  becomes justified.
- In between: report both triplets (offset-0 and mean-based) and treat their difference as the position term.

**Proposed configuration (not launched):**

```
cd euv-simulator
H="npx vitest run --root . --config /dev/null --testTimeout 14400000 scripts/sphere3d-resumable.test.ts"
for OFF in 0.25 0.5 0.75; do
  RH=48 OFF=$OFF EXTRA='{"downstream":0.5,"lateral":2}' EVERY=500 BUDGET_MIN=100 \
    CKPT=<scratchpad>/rh48-off$OFF/rh48.ckpt OUT=docs/sphere3d-rh48-offsets/off$OFF $H &
done; wait            # then the same with RESUME=1 for any run whose status is "interrupted"
```

Unique output directory `docs/sphere3d-rh48-offsets/` (new; the harness refuses the existing raw-data archives);
checkpoints outside the repository. Purpose: the first grid-position scatter measurement at R/h ≥ 48.

## 6. Integration readiness

| item | status | evidence |
|---|---|---|
| equal-area order stability | **verified** for offset-0 values: p 1.04 → 1.12 as the triplet moves finer; with 4-offset means at R/h ≤ 32 the orders spread 0.85 (24/32/64) – 1.24 (32/48/64), so the stability is partly a property of the single-position values | sections 1, 2 |
| 50 %-detector grid-position sensitivity | **verified** at R/h 16–32 (range 1.2e-3 at 24 and 32, not shrinking); **unknown** at 48 and 64 | section 2 |
| 50 % and steepest-rise extrapolation | **not usable**: oscillating slopes, triplet orders 0.77–6.9 | section 1 |
| iteration error at R/h 64 | **estimated** +5.4–5.6e-5 R; estimator **verified** at R/h 24, 32 and 64 (ratios 0.983, 0.995, 1.02) | section 3 |
| detector agreement at R/h 64 | **verified**: 50 % 0.35680, steepest 0.35672, equal area 0.35723 (spread 5.1e-4, shrinking with R/h: 4.7e-3 at 24, 5.0e-3 at 32, 1.5e-3 at 48) | archive |
| equal-area extrapolated standoff | **estimated** 0.3513–0.3520 R (offset-0 triplets from R/h 24 up) or 0.3493–0.3526 R (4-offset means at R/h ≤ 32), formal GCI ±0.0066–0.0071, plus an **unknown** grid-position term at R/h 48/64 that could be of similar size | sections 1, 2 |
| discrepancy from the axisymmetric reference | at matched R/h 64: 3.4e-3 (50 %) / 3.2e-3 (equal area), essentially unchanged from R/h 48 (3.4e-3 / 3.4e-3) instead of shrinking ∝ h (expected ≈ 2.5e-3); extrapolated 3D equal area minus the axisymmetric band top (0.3508): +0.5 to +1.2e-3 (offset-0 triplets), −1.5 to +1.8e-3 (mean-based), all inside the GCI | rh64 archive analysis |
| asymmetry significance | **verified** not geometric, not an outflow-boundary problem, no effect ≥ 4e-12 of transient downstream disturbances on the nose (R/h 32); nose detectors at R/h 64 insensitive (≤ 1e-7) to its factor-8 swings; **unknown**: a steady symmetric bias of the same origin, and whether it decays to the R/h 24/32 level | section 4 |

**Do the 3D and axisymmetric solvers converge to the same value?** Not demonstrated. The extrapolated values are
consistent within the formal uncertainty, but the matched-resolution gap did not shrink from R/h 48 to 64 as a
first-order closure would require (≈ 2.5e-3 expected at R/h 64; measured 3.4e-3 / 3.2e-3). Whether single-position
values can resolve that: for the 50 % detector the R/h 32 position range (1.2e-3) exceeds the 0.9e-3 shortfall; for
equal area the shortfall (0.6e-3) is larger than the R/h 32 range (3.7e-4) but not by enough to exclude position
effects at two grids, and the axisymmetric values' own position dependence was not part of this audit. Agreement is
*possible within the uncertainty*, not shown.

**Overall:** the 3D results are suitable for display as a verified, grid-converging *trend* with an equal-area
estimate ≈ 0.352 R ± 0.007 (formal) and an explicitly unquantified grid-position term. They are not suitable as a
reference value that claims 3D–axisymmetric agreement at the 1e-3 level. The cheapest step that would most reduce the
uncertainty is option A (≈ 1.5 h), which needs approval.

## 7. Data and reproduction

| file in `data/` | content |
|---|---|
| `indep_check.py` | independent detectors from the archived profiles, Celik/GCI triplets, ±1e-4 sensitivity (`python3 data/indep_check.py .` from `euv-simulator/`) |
| `ref400.txt`, `track12.jsonl` | probe detectors vs driver at R/h 12, step 400 (bit-identical) |
| `state64.json`, `scan64.txt` | R/h 64 step 4 000: detectors, asymmetry (worst, by x slab, front, near axis), outflow Mach numbers, geometry mirror check, radial scans at four x stations |
| `state24.json` | the same at R/h 24, step 30 (geometry mirror check) |
| `track24.jsonl`, `track32.jsonl` | fresh R/h 24 / 32 runs to a 6-order drop, detectors and asymmetry every 20 steps (iteration-error validation, asymmetry history) |
| `extend64.json` | R/h 64 step-4 000 checkpoint advanced 420 steps in memory, sampled every 21 steps |
| `perturb_*.json`, `perturb2_*.json` | perturbation experiment (section 4a) |
| `*.ckpt.sha256` | checksums of the scratch checkpoints used (R/h 32 step 2 000, created for this audit; R/h 64 step 4 000, the archived run's last checkpoint, unchanged) |

Commands (from `euv-simulator/`; `H="npx vitest run --root . --config /dev/null --testTimeout 14400000 scripts/sphere3d-probe.test.ts"`,
`E='{"downstream":0.5,"lateral":2}'`):

```
PROBE=state   RH=64 EXTRA=$E CKPT=<rh64.ckpt> GEOMETRY=0 STEPS=420 SAMPLE=21 OUT=extend64.json $H
PROBE=track   RH=32 EXTRA=$E DROP=6 MAXSTEPS=6000 EVERY=20 OUT=track32.jsonl $H
PROBE=perturb RH=32 EXTRA=$E CKPT=<rh32 step-2000 ckpt> DROP=6 AMP=1e-3 XMIN=-0.5 SHAPE=one OUT=perturb2_one_xm05.json $H
```

The R/h 32 step-2 000 checkpoint is reproducible with `runSphereCase({ mach: 2, radiusCells: 32, wall: 'cutcell',
downstream: 0.5, lateral: 2, residualDrop: 6, maxSteps: 20000, checkpoint: { stopAtStep: 2000, write } })`.
