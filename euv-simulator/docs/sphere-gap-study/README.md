# 3D–axisymmetric standoff gap: controlled grid study (Mach 2 sphere, Rusanov)

Follow-up to `docs/sphere3d-refinement/` and `docs/axisymmetric-reference.md`. At the same nominal R/h the 3D
Cartesian standoff lies 0.003–0.010 R above the axisymmetric one. This study asks whether that gap comes from the
two grids resolving the flow differently, using short controlled runs of the **unchanged** solvers (no solver code
was modified; the default flux stays Rusanov; HLLC is not used). Everything below is verification evidence, not a
validation, and neither solver is treated as ground truth.

`node scripts/gap-analysis.mjs` recomputes every number in sections 3–7 from the files in this directory and in
`docs/sphere3d-refinement/`.

## 1. Design: which hypothesis each experiment tests

| hypothesis | experiment | what would support / refute it |
|---|---|---|
| H1 the gap is a resolution effect: equal nominal R/h is not equal effective resolution | vary each grid direction **separately** in both solvers: axisymmetric radial R/h × tangential `aspect` (35 runs); 3D R/hx × R/hyz (cells longer in one direction, 70 runs) | the standoff error is controlled by spacing, with direction-dependent coefficients, and the extrapolated limits move together while the matched-R/h gap shrinks |
| H1a specifically: the 3D grid is effectively coarser *tangentially* (the earlier clue: axisymmetric tangential 2h moved the standoff +0.005 R) | axisymmetric aspect scan at fixed radial R/h; 3D lateral refinement at fixed hx | if true, coarse 3D lateral spacing should raise the 3D standoff, as coarse tangential spacing raises the axisymmetric one |
| H2 measurement: different measurement line / interpolation / detector | 3D standoff on the first grid lines off the axis (extrapolated to the axis); geometry table; all three detectors kept | a correction comparable to the gap |
| H3 iteration error | the same cases converged 6 instead of 4 residual orders | a change comparable to the gap |
| H4 grid-position (phase) noise, measured before for 3D only | axisymmetric R/h varied by ≤ 6 % around 32 and 64 | scatter comparable to the differences used for extrapolation |
| H5 wall geometry, flux, reconstruction, axisymmetric source terms | addressed only if H1–H4 leave a gap that resolution cannot explain | — |

Before any change both baselines were reproduced (section 2). The 3D runs with separate hx and hyz use a new script
that repeats `runSphereCase` line by line; with hx = hyz it reproduces the existing archive exactly.

## 2. Configuration and reproduction

Physical case, gas model, sphere, start-up, stopping rule, CFL and detector definitions exactly as in the two
archives: M∞ 2, T∞ 220 K, p∞ 2500 Pa, γ 1.4; stop at a 4-order residual drop in x < 0 together with |net mass flux|
< 10⁻³ of the intercepted flux; 150 first-order steps then MUSCL-minmod; 50 % first crossing (linear between centres),
steepest rise (parabolic sub-cell correction), equal area. Rusanov flux only.

- **Axisymmetric** (`sphereAxi.ts`, unchanged): outer radius 5R, θ ≤ 95°, CFL 0.4; radial spacing h = R/N; tangential
  spacing at the wall `aspect`·h (`aspect` is an existing option; default 1 = the reference grid).
- **3D** (`euler3d.ts`, unchanged; set-up as `sphere3d.ts runSphereCase`): reduced quarter domain 2R upstream / 0.5R
  downstream / 2R lateral (shown to change the standoff by < 1e-4 R in the refinement study), cut-cell wall with
  merging, CFL 0.8; hx = R/Nx along the flow, hy = hz = R/Nyz across it; grid offset in x in units of hx.
- **Reproduction checks** (`reproduction/`): axisymmetric R/h 16 and 32 (aspect 1) profiles byte-identical to
  `docs/axisym-data/`; R/h 128 (aspect 1, in `axi-aspect/`) byte-identical to the archive; the new 3D script at
  hx = hyz = R/12, offsets 0 and 0.25: profile rows byte-identical to `docs/sphere3d-refinement/`, same step count,
  all detectors equal to 1e-16.

## 3. Measured effective grid spacing at the same nominal R/h

| quantity | axisymmetric (aspect 1) | 3D Cartesian (isotropic) |
|---|---|---|
| spacing along the stagnation line (normal to the shock and wall on the axis) | h (radial) | h (= hx) |
| tangential / lateral spacing next to the axis | 0.99h at the wall, 1.35h at the shock (ρΔθ) | h at the wall and at the shock |
| spacing along the body normal away from the axis | h at every θ (body-fitted) | the cube width along the normal, h(\|nx\|+\|ny\|+\|nz\|): √2·h at 45° in a symmetry plane, up to √3·h |
| wall | body-fitted, exact sphere | one planar facet per cut cell; volume error < 1e-3 (existing test) |
| measurement line | ray at Δθ/2 from the axis: 0.68h off the axis at the shock | axis-parallel line 0.71h off the axis |
| last cell before the wall | centroid 0.50h from the wall | centre −0.24h … +0.52h from the wall depending on the grid offset (a merged cut cell can have its centre inside the body) |
| shock thickness (10–90 %), in cells along the line | 2.6–3.0 | 2.4–2.9 |

The shock is spread over the same number of cells in both solvers; the difference is where it sits, not how thick
it is.

## 4. Axisymmetric radial × tangential study (`axi-aspect/`)

50 % standoff (R); rows radial R/h, columns aspect (tangential/radial spacing at the wall; at the shock × 1.35):

| R/h | 0.5 | 0.75 | 1 | 1.5 | 2 | 3 |
|---|---|---|---|---|---|---|
| 16 | 0.35952 | 0.36117 | 0.36265 | 0.36685 | 0.37171 | 0.37490 |
| 24 | 0.35630 | 0.35708 | 0.35818 | 0.36192 | 0.36624 | 0.37321 |
| 32 | 0.35531 | 0.35587 | 0.35668 | 0.35897 | 0.36157 | 0.36815 |
| 48 | 0.35400 | 0.35443 | 0.35500 | 0.35660 | 0.35837 | 0.36215 |
| 64 | 0.35233 | 0.35269 | 0.35339 | 0.35503 | 0.35660 | 0.35987 |
| 96 | 0.35181 | | 0.35237 | | 0.35415 | |
| 128 | | | 0.35156 | | 0.35288 | |

All 35 runs converged (zero reconstruction fallbacks, body mass flux ≤ 2e-17, bow shock inside the domain, supersonic
outflow). The steepest-rise and equal-area tables are in the analysis output. Runtimes: 0.4 s (R/h 16, aspect 3) to
1058 s (R/h 128, aspect 1).

**Measured.** The axisymmetric standoff error is dominated by the **tangential** spacing: at R/h 24, aspect 0.5 → 3
moves the 50 % standoff from 0.3563 to 0.3732 R, while radial refinement at fixed tangential spacing (e.g. h_t = R/32:
R/h 16 aspect 0.5, 24/0.75, 32/1, 48/1.5, 64/2 → 0.3595, 0.3571, 0.3567, 0.3566, 0.3566) changes it much less. Linear
fits (three data subsets): ∂f/∂h_r ≈ 0.04–0.11, ∂f/∂h_t ≈ 0.15–0.17 (R per unit h/R, 50 %).

**Matching the nominal 3D tangential spacing** at the shock (aspect ≈ 0.75, i.e. 1.0h at the shock) *lowers* the
axisymmetric standoff (R/h 24: 0.3571 instead of 0.3582) and so **widens** the gap. The axisymmetric grid reproduces
the isotropic 3D value at the same R/h only with aspect 1.75–2.04 (50 %), 1.76–1.98 (equal area), consistently from
R/h 16 to 48.

## 5. 3D study with separate spacing along and across the flow (`3d-aniso/`)

50 % standoff, mean over grid offsets in x (4 offsets 0/0.25/0.5/0.75 where listed as ×4, otherwise 0 and 0.5):

| R/hx \ R/hyz | 12 | 16 | 24 | 32 | 48 |
|---|---|---|---|---|---|
| 12 | 0.37340 ×4 | 0.37672 ×4 | 0.37941 ×4 | | |
| 16 | 0.36698 ×4 | 0.36929 ×4 | 0.37251 ×4 | 0.37379 ×4 | |
| 24 | 0.35923 ×4 | 0.36199 ×4 | 0.36486 ×4 | 0.36642 | |
| 32 | 0.35434 ×4 | 0.35742 ×4 | 0.36040 | 0.36184 ×4 | |
| 36 | | | 0.35903 | | |
| 48 | not converged (see below) | | 0.35551 | 0.35710 | 0.35835 (offset 0) |
| 64 | | | | not obtained (stopped after 2 h, see below) | |

(The isotropic diagonal comes from `docs/sphere3d-refinement/`.) All listed runs converged, body mass flux exactly 0,
symmetry error ≤ 5e-5. **R/hx 48 × R/hyz 12 (cells four times longer across than along the flow) did not converge**
in 20 000 steps and lost y ↔ z symmetry (4e-3); its file is kept as a record and excluded from all fits. The cell
aspect ratio was then limited to ≤ 2 (one family at 2.67); the symmetry error grows with the aspect ratio (1e-8
isotropic, 3e-6 at 2.67, 5e-5 at 2 for R/hx 48), so strongly stretched cut cells are a limitation of this experiment.

**Measured.**
- The 3D standoff error is dominated by the spacing **along the flow** (hx): doubling R/hx lowers the 50 % standoff by
  0.0094–0.0147 R; doubling R/hyz **raises** it by 0.0028–0.0061 R. Linear fit on the finer families
  (R/hx ≥ 24): ∂f/∂hx ≈ +0.45, ∂f/∂hyz ≈ −0.14 (50 %), rms residual 1e-4 R.
- So refining the 3D grid across the flow moves the standoff *away* from the axisymmetric value, the opposite sign
  of the axisymmetric tangential dependence. **H1a (the 3D grid is effectively too coarse tangentially) is not
  supported**: the empirical "3D ≈ axisymmetric with aspect ≈ 2" match is a coincidence of two different error
  structures, not a matched resolution.
- The convergence in hx looks **sub-linear** at these resolutions: the local slope Δf/Δhx at fixed hyz rises under
  refinement (R/hyz 24: 0.33 between R/hx 12 and 16, 0.40–0.51 between 32 and 48); the x-triplet 12/24/48 at
  R/hyz 24 gives an observed order 0.64 (50 %), 0.78 (equal area). Refining x at fixed hyz also stretches the cells,
  so families of constant cell shape were compared: the slope rises for hyz/hx = 1 (0.21, 0.29, 0.34) and 1.5
  (0.21, 0.28) but is flat for hyz/hx = 2 (0.174, 0.184). Sub-linear behaviour in two of three families: probably
  genuine at these resolutions, not only a cell-shape effect, but not proven.

**Out-of-sample checks.** Fitting the finer families without one of the R/hx = 48 families and predicting it: the
linear model misses 48:24 by −1.4e-4, 48:32 by +0.4e-4 and 48:48 (one offset) by −2.5e-4 R (50 %); the p = 0.85 model
by +0.7e-4, +1.3e-4, −4.2e-4. Both describe the data within the grid-offset scatter, so they cannot be told apart
here. A finer test, R/hx:R/hyz = 64:32, was set up with its prediction written down beforehand
(`prediction/PREDICTION.md`: 0.3546 linear, 0.3543 p = 0.85; an x-order of 0.64 would give ≈ 0.354 and an order of
1 ≈ 0.356). **Both 64:32 runs were stopped after 2 h** (estimated 46 min; from the per-step cost about 8 000 steps
against the ≈ 3 000 a converged run of this size needs) without writing a result, so the test was not completed and
it is unknown whether that grid converges.

## 6. Checks on measurement, iteration and grid phase

- **Off-axis measurement line (H2, 3D).** From the 50 % standoff on the lines j = 0 and 1, d(r) ≈ d0 + c·r² gives an
  on-axis correction of −9.5e-4 R at R/hyz 12, −5e-4 at 16, −2.1e-4 at 24 and −1.1e-4 at 32 (∝ hyz², measured in every
  3D run of this study). The axisymmetric ray (Δθ/2) has a correction of the same sign estimated at ≈ −1e-4 R at R/h 24 from
  the same shock curvature (estimate, not measured). Net effect on the gap: ≈ −1e-4 R, a few per cent of it.
- **Iteration error (H3).** 6 instead of 4 residual orders: axisymmetric R/h 64 +1.4e-4 (50 %), +1.2e-4 (equal area);
  R/h 96 +1.0e-4; 3D R/h 24 +0.6e-4. Same sign in both, an order of magnitude below the gap.
- **Grid phase (H4).** Axisymmetric R/h 32–36 and 64–68 (aspect 1): 50 % scatter 0.0010 R near R/h 32 and 0.0003 R
  near 64, steepest rise 0.0022 / 0.0009, equal area 0.0003 / 0.0003 — the same size as the 3D offset scatter
  (50 %: 0.0012 at R/h 32). The archived R/h 32 and 64 reference values sit at the low end of their phase groups
  (by 0.0005 and 0.0002 R, 50 %). Phase noise therefore affects both reference series and explains part of the
  triplet-to-triplet variation of the extrapolations.

## 7. Extrapolated limits (formal estimates and model-form spread kept apart)

**Axisymmetric reference revisited.** Along the aspect-1 column, Celik triplets now available give f_ext (50 %)
0.3494 (16/32/64), 0.3497 (24/32/48), 0.3500 (32/48/64), 0.3493 (32/64/128, the archived estimate), 0.3517 (48/64/96)
and 0.3463 (64/96/128); equal area 0.3442–0.3508 (24/32/48 gives p = 0.03 and no usable value). With grid-phase noise of 3e-4 – 1e-3 R on each value and observed
orders 0.5–2.4, single-triplet extrapolation is not robust. Two-dimensional fits over the whole radial × tangential
matrix (four model forms, three data subsets) give f0 = 0.3488–0.3506 (50 %) and 0.3483–0.3499 (equal area).

**3D.** Fits over the R/hx × R/hyz families give f0 = 0.3497–0.3540 (50 %) and 0.3493–0.3526 (equal area),
depending on the model form and subset (finest subset C: 0.3508–0.3521 and 0.3495–0.3512). The linear model predicts
left-out families to ≤ 2.5e-4 R, but the rising local slope in hx means the linear form is probably not the
asymptotic one, and a sub-linear form puts the 3D limit lower.

**First-order two-point extrapolations** from the two finest members of each family (an assumption): axisymmetric
aspect 1 and 2 (R/h 96, 128) 0.3490–0.3492 for all three detectors; 3D constant-shape families 0.3513–0.3517 (50 %),
0.3505–0.3510 (equal area). If the 3D x-convergence is sub-linear, as two of three families suggest, these 3D values
are biased high.

## 8. What is established and what is not

**Demonstrated by the measurements.**
1. *The matched-R/h gap is mostly a difference in discretisation error.* Changing one grid direction moves each
   solver's standoff by as much as the gap (axisymmetric tangential aspect 0.5 → 3 at R/h 24: +0.017 R; 3D R/hx
   doubled: −0.009 to −0.015 R), and the two solvers' extrapolated limits lie much closer together than their
   matched-R/h values: on the finest subset the fitted limits differ by +0.0008 to +0.0025 R (50 %) and +0.0007 to
   +0.0020 R (equal area) depending on the model form, against 0.0034–0.0097 R at matched R/h 12–48.
2. *Equal nominal R/h is not equal effective resolution, and no axisymmetric grid reproduces the 3D error
   structure.* The 3D error is dominated by the spacing along the flow and **decreases** when the lateral spacing is
   coarsened; the axisymmetric error is dominated by the tangential spacing and **increases** when it is coarsened.
   Matching the nominal tangential spacing at the shock widens the gap (R/h 24: 0.0078 instead of 0.0067 R). The
   observation that the isotropic 3D grid behaves like an axisymmetric grid with tangential spacing ≈ 2h is
   descriptive, not a matched resolution.
3. *The leading hypothesis in its specific form (the 3D grid is effectively too coarse tangentially) is not
   supported.*
4. *Measurement and iteration are not the explanation:* off-axis line correction ≈ −2e-4 R (3D, R/h 24; axisymmetric
   ≈ −1e-4, estimated), iteration error +0.6e-4 to +1.4e-4 R in both solvers.
5. *The axisymmetric reference carries grid-phase noise* of 3e-4 – 1e-3 R (50 %) like the 3D offset scatter, and its
   single-triplet extrapolations range 0.3463–0.3517 R (50 %) when the intermediate grids are included. The archived
   best estimate 0.349–0.351 R is therefore less certain than its GCI bands suggest (an addendum at the end of
   `docs/axisymmetric-reference.md` points here).

**Not established.**
- Whether the two solvers converge to the same standoff. The remaining difference of the fitted limits (≤ 0.0025 R)
  is of the same size as the model-form spread of each solver's own extrapolation (50 % over all fits: axisymmetric
  0.3488–0.3506, 3D 0.3497–0.3540), and the sub-linear 3D behaviour in x could move the 3D limit below the axisymmetric
  one. Neither "same limit" nor "different limit" is demonstrated.
- The asymptotic order of the 3D solver in x, and whether the rising slopes are a resolution or a cell-shape effect.
- The mechanism. Numerical dissipation is plausible (both error structures are resolution effects of the same
  Rusanov flux on differently oriented grids), but no experiment here isolates dissipation from other discretisation
  differences (dimension-by-dimension MUSCL on a Cartesian grid against face-normal reconstruction on a body-fitted
  one, cut-cell against body-fitted wall). Wall geometry, reconstruction, flux evaluation and the axisymmetric source
  terms (H5) were not tested further: the gap that remains after extrapolation is within the discretisation-error
  uncertainty, so no residual needs those explanations yet; equally, they are not excluded.

**Engineering judgement (not a formal result).** Both solvers are consistent with a Mach 2 sphere standoff of about
0.349–0.352 R; the isotropic 3D values at R/h 32–48 are 0.006–0.013 R higher because of discretisation error that
decreases with the grid spacing along the flow, roughly in proportion to it.

## 9. Cost of the experiments and of the alternatives

Measured runtimes (single process; up to four ran at once, which slows each by up to ≈ 1.3×):

| run | cells | steps | time |
|---|---|---|---|
| axisymmetric R/h 64 / 96 / 128, aspect 1 | 27 136 / 61 056 / 108 544 | 5 034 / 7 479 / 9 937 | 79 s / 446 s / 1 058 s |
| 3D 24:24 / 32:32 / 48:48 (isotropic) | 0.14 M / 0.33 M / 1.1 M | 1 546 / 2 045 / 3 040 | 345 s / 1 079 s / 5 319 s |
| 3D 48:24 / 48:32 / 64:32 | 0.28 M / 0.49 M / 0.66 M | 2 245 / 2 519 / not converged after ≈ 8 000 (estimate) | 850 s / 1 599 s / stopped at 2 h |

Cost model for the 3D case: time ≈ 1.4 µs × cells × steps, cells = 10·Nx·Nyz², steps ≈ 50–65 × max(Nx, Nyz).

| candidate | cells | estimated time | feasible here? |
|---|---|---|---|
| 3D isotropic R/h 64 (reduced domain) | 2.6 M | 4–5 h single offset | no: exceeds the 2 h limit of a background job; the solver has no restart/checkpoint support, none was added |
| 3D 96:32 (x refinement only, aspect 3) | 0.98 M | ≈ 1.6 h | aspect ratio 3 is beyond the range where stretched cut cells behaved |
| 3D 96:48 (aspect 2) | 2.2 M | ≈ 5 h | no (same limit) |
| axisymmetric R/h 192 / 256, aspect 2 | 0.12 M / 0.22 M | ≈ 0.6 h / 1.5 h | yes |

## Files

| directory | contents |
|---|---|
| `reproduction/` | baseline reruns (axisymmetric R/h 16, 32; 3D 12:12 offsets 0, 0.25) |
| `axi-aspect/` | axisymmetric radial × tangential matrix (35 runs) |
| `axi-phase/` | axisymmetric R/h 33–36 and 65–68, aspect 1 |
| `axi-iteration/` | axisymmetric R/h 64 and 96 converged to 6 orders |
| `3d-aniso/` | 3D R/hx × R/hyz runs |
| `3d-iteration/` | 3D R/h 24 converged to 6 orders |
| `prediction/` | the prediction for 64:32 written before that run, and the analysis output at that moment |

Each profile file carries a `# meta {…}` line with the full run summary (options, grid, steps, convergence, residual
drop, mass imbalance, runtime, detectors, shock width, nose state, wall total pressure and total-temperature error,
symmetry error for 3D); `summary.jsonl` in each directory holds the same lines. Axisymmetric data rows use the format
of `docs/axisym-data/` (d, ρ/ρ∞, φ); 3D rows that of `docs/sphere3d-refinement/` (i, x, d, ρ/ρ∞, φ, α).

SHA-256 of every data file of this study: `SHA256SUMS` (in this directory; check with `sha256sum -c SHA256SUMS` from
here). The profile files were written once by the scripts and not edited.

## Reproduction

```
cd euv-simulator
T="npx vitest run --root . --config /dev/null --testTimeout 14400000"
# axisymmetric: every RH × ASPECT combination
RH=16,24,32,48,64 ASPECT=0.5,0.75,1,1.5,2,3 OUT=docs/sphere-gap-study/axi-aspect $T scripts/gap-axi-measure.test.ts
RH=96 ASPECT=0.5,1,2 OUT=docs/sphere-gap-study/axi-aspect $T scripts/gap-axi-measure.test.ts
RH=128 ASPECT=1,2 OUT=docs/sphere-gap-study/axi-aspect $T scripts/gap-axi-measure.test.ts
RH=33,34,35,36,65,66,67,68 ASPECT=1 OUT=docs/sphere-gap-study/axi-phase $T scripts/gap-axi-measure.test.ts
RH=64,96 ASPECT=1 EXTRA='{"residualDrop":6}' OUT=docs/sphere-gap-study/axi-iteration $T scripts/gap-axi-measure.test.ts
# 3D: R/hx:R/hyz pairs × offsets (reduced domain)
E='{"downstream":0.5,"lateral":2}'
GRIDS=12:16,12:24,16:12,16:24,16:32,24:12,24:16,32:12,32:16 OFF=0,0.25,0.5,0.75 EXTRA=$E OUT=docs/sphere-gap-study/3d-aniso $T scripts/gap-3d-aniso.test.ts
GRIDS=24:32,32:24,48:24,64:32 OFF=0,0.5 EXTRA=$E OUT=docs/sphere-gap-study/3d-aniso $T scripts/gap-3d-aniso.test.ts
GRIDS=48:12 OFF=0 EXTRA=$E OUT=docs/sphere-gap-study/3d-aniso $T scripts/gap-3d-aniso.test.ts     # does not converge
RH=24 FLUX=rusanov EXTRA='{"downstream":0.5,"lateral":2,"residualDrop":6}' OUT=docs/sphere-gap-study/3d-iteration $T scripts/sphere3d-measure.test.ts
# reproduction checks
RH=16,32 ASPECT=1 OUT=docs/sphere-gap-study/reproduction $T scripts/gap-axi-measure.test.ts
GRIDS=12:12 OFF=0,0.25 EXTRA=$E OUT=docs/sphere-gap-study/reproduction $T scripts/gap-3d-aniso.test.ts
# all tables
node scripts/gap-analysis.mjs
```

## Addendum (2026-10-18): axisymmetric reference refined

`docs/axi-reference-refinement/` extended the axisymmetric grids to R/h 192 and 256. The axisymmetric engineering band
is now 0.3485–0.3508 R (≈ 0.3496 ± 0.0012; previously ≈ ±0.003), so the axisymmetric side is no longer the limiting
uncertainty of the cross-solver comparison: the 3D extrapolated limits of section 7 (0.3497–0.3540 for the 50 %
detector) overlap the band only at their low end. That directory's README also reassesses the 64:32 experiment
proposed here (not recommended under the 2 h job limit).
