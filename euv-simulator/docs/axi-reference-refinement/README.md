# Axisymmetric reference: higher-resolution refinement (Mach 2 sphere, Rusanov)

Follow-up to `docs/axisymmetric-reference.md` and `docs/sphere-gap-study/`. Goal: narrow the uncertainty of the
axisymmetric limiting standoff before deciding on further 3D work. Solver, case and harness are unchanged
(`sphereAxi.ts` `runAxiSphereCase` through `scripts/gap-axi-measure.test.ts`); only the grid parameters R/h (radial
spacing h = R/N) and `aspect` (tangential/radial spacing at the wall) and, for the iteration check, the stopping drop
were varied. Everything is verification evidence; the axisymmetric value is a reference estimate, not ground truth.

`node scripts/axi-refine-analysis.mjs` recomputes every number below from the files here and in
`docs/sphere-gap-study/` (`axi-aspect/`, `axi-phase/`, `axi-iteration/`). `analysis_before_new_runs.txt` is its output
before any run of this study; `PLAN.md` holds the cost estimates written before launching.

## 1. Configuration (verified before the runs)

M∞ 2, T∞ 220 K, p∞ 2500 Pa, γ 1.4, ideal gas, inviscid. Body-fitted polar grid ρ ∈ [R, 5R], θ ∈ [0, 95°], ni = 4N
radial cells, nj = round(1.658·N/aspect) tangential cells; slip wall, freestream outer arc, symmetry axis,
extrapolation outflow. Rusanov flux, MUSCL-minmod after 150 first-order steps, CFL 0.4, local time steps; stop at a
4-order residual drop in x < 0 together with |net boundary mass flux| < 10⁻³ of ρ∞V∞R²/2 (6 orders in `iteration/`).
Detectors on the row of cells next to the axis (ray at Δθ/2): first 50 % crossing of φ = (ρ − ρ∞)/(ρ₂ − ρ∞), linear
between centroids; steepest density rise with parabolic sub-cell correction; equal-area position. These match the
archived reference exactly (the harness reproduces R/h 16, 32 and 128 profiles byte for byte; gap study).

## 2. Runs of this study

| file | R/h | aspect | stop (orders) | grid ni × nj | cells | h_r (R) | h_t wall / shock (R) | steps | drop | imbalance | time (min) | 50 % | steepest | equal area | width (cells) | nose p0/pitot | wall max \|T0 err\| |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| runs/axi_rusanov_Rh192_aspect2.csv | 192 | 2 | 4 | 768 × 159 | 122 112 | 5.208e-3 | 1.043e-2 / 1.409e-2 | 11487 | 4.16 | 1.0e-3 | 22.1 | 0.35156 | 0.35135 | 0.35171 | 3.13 | 0.99891 | 0.83 % |
| runs/axi_rusanov_Rh192_aspect1.csv | 192 | 1 | 4 | 768 × 318 | 244 224 | 5.208e-3 | 5.214e-3 / 7.042e-3 | 14872 | 4.15 | 1.0e-3 | 37.6 | 0.35067 | 0.35066 | 0.35077 | 3.05 | 0.99831 | 0.82 % |
| runs/axi_rusanov_Rh256_aspect2.csv | 256 | 2 | 4 | 1024 × 212 | 217 088 | 3.906e-3 | 7.821e-3 / 1.057e-2 | 15252 | 4.16 | 1.0e-3 | 52.6 | 0.35114 | 0.35121 | 0.35114 | 3.02 | 0.99902 | 0.73 % |
| runs/axi_rusanov_Rh256_aspect1.csv | 256 | 1 | 4 | 1024 × 424 | 434 176 | 3.906e-3 | 3.911e-3 / 5.281e-3 | 19785 | 4.16 | 1.0e-3 | 91.7 | 0.35044 | 0.35049 | 0.35045 | 3.12 | 0.99888 | 0.73 % |
| phase/axi_rusanov_Rh130_aspect2.csv | 130 | 2 | 4 | 520 × 108 | 56 160 | 7.692e-3 | 1.535e-2 / 2.077e-2 | 7854 | 4.14 | 1.0e-3 | 4.4 | 0.35294 | 0.35302 | 0.35303 | 2.97 | 0.99814 | 0.97 % |
| phase/axi_rusanov_Rh133_aspect2.csv | 133 | 2 | 4 | 532 × 110 | 58 520 | 7.519e-3 | 1.507e-2 / 2.039e-2 | 8010 | 4.20 | 1.0e-3 | 4.6 | 0.35288 | 0.35294 | 0.35297 | 2.92 | 0.99811 | 0.96 % |
| phase/axi_rusanov_Rh136_aspect2.csv | 136 | 2 | 4 | 544 × 113 | 61 472 | 7.353e-3 | 1.467e-2 / 1.985e-2 | 8200 | 4.18 | 1.0e-3 | 4.8 | 0.35276 | 0.35281 | 0.35285 | 2.92 | 0.99811 | 0.96 % |
| phase/axi_rusanov_Rh131_aspect1.csv | 131 | 1 | 4 | 524 × 217 | 113 708 | 7.634e-3 | 7.641e-3 / 1.033e-2 | 10164 | 4.15 | 1.0e-3 | 18.3 | 0.35148 | 0.35149 | 0.35162 | 2.91 | 0.99736 | 0.98 % |
| phase/axi_rusanov_Rh134_aspect1.csv | 134 | 1 | 4 | 536 × 222 | 118 992 | 7.463e-3 | 7.469e-3 / 1.009e-2 | 10400 | 4.16 | 1.0e-3 | 19.3 | 0.35141 | 0.35140 | 0.35155 | 2.90 | 0.99738 | 0.96 % |
| iteration/axi_rusanov_Rh128_aspect2_residualDrop6.csv | 128 | 2 | 6 | 512 × 106 | 54 272 | 7.813e-3 | 1.564e-2 / 2.116e-2 | 11985 | 6.00 | 1.5e-5 | 10.2 | 0.35299 | 0.35295 | 0.35316 | 2.96 | 0.99791 | 0.99 % |
| iteration/axi_rusanov_Rh192_aspect2_residualDrop6.csv | 192 | 2 | 6 | 768 × 159 | 122 112 | 5.208e-3 | 1.043e-2 / 1.410e-2 | 18318 | 6.00 | 1.5e-5 | 36.6 | 0.35168 | 0.35145 | 0.35182 | 3.13 | 0.99890 | 0.85 % |
| iteration/axi_rusanov_Rh256_aspect2_residualDrop6.csv | 256 | 2 | 6 | 1024 × 212 | 217 088 | 3.906e-3 | 7.821e-3 / 1.057e-2 | 23957 | 6.00 | 1.6e-5 | 85.8 | 0.35125 | 0.35132 | 0.35125 | 3.00 | 0.99895 | 0.74 % |

Conservation and sanity, every run: converged by the criterion; body mass flux ≤ 9e-19 (closed wall faces); net
boundary mass flux at the 1e-3 tolerance; outer ring at the freestream to ≤ 4e-15 (bow shock inside); outflow normal
Mach ≥ 1.39; zero reconstruction fallbacks. Energy: the case keeps no boundary energy-flux account, so energy is
checked through total-enthalpy preservation: front-wall max |T0/T0∞ − 1| = 0.83 / 0.82 / 0.73 / 0.73 % (R/h 192 a2,
192 a1, 256 a2, 256 a1), decreasing with refinement (1.0 % at R/h 128); nose-cell T/T0 1.0011–1.0014.

Cost: 0.62–0.64 µs per cell-step for the aspect-1 runs, 0.95 µs for the aspect-2 runs (which shared the machine
with two other runs); steps 77.3–77.5·N (aspect 1) and 59.6–59.8·N (aspect 2), as estimated in `PLAN.md`. R/h 256
aspect 1 was run alone and took 92 min of the 2 h job limit.

## 3. Results

All values in R. "aspect 1" is the reference grid of `docs/axisymmetric-reference.md`; R/h ≤ 128 values come from
`docs/sphere-gap-study/axi-aspect/` (same harness and settings), R/h 192 and 256 are new.

### 3.1 Standoff by grid (4-order runs)

| R/h | aspect 1: 50 % | steepest | equal area | aspect 2: 50 % | steepest | equal area |
|---|---|---|---|---|---|---|
| 64 | 0.35339 | 0.35257 | 0.35408 | 0.35660 | 0.35647 | 0.35709 |
| 96 | 0.35237 | 0.35239 | 0.35257 | 0.35415 | 0.35413 | 0.35440 |
| 128 | 0.35156 | 0.35158 | 0.35169 | 0.35288 | 0.35285 | 0.35305 |
| **192** | **0.35067** | **0.35066** | **0.35077** | **0.35156** | **0.35135** | **0.35171** |
| **256** | **0.35044** | **0.35049** | **0.35045** | **0.35114** | **0.35121** | **0.35114** |

- **Detector disagreement** has collapsed: at R/h 256 the three detectors agree to 5e-5 (aspect 1) and 7e-5
  (aspect 2), against up to 2e-3 at R/h 32. The shock is 3.0–3.1 cells wide at R/h 192–256.
- **The two tangential spacings converge together:** aspect 2 − aspect 1 (50 %) = 0.0032 (R/h 64), 0.0013 (128),
  0.0009 (192), 0.0007 (256), roughly ∝ h, so both columns head for one limit.

### 3.2 Grid-phase noise

R/h varied by a few per cent at fixed aspect (trend removed with 0.3 R per unit h, an upper estimate):

| near R/h | aspect | R/h used | 50 % range | steepest range | equal-area range | base value − phase mean (50 %) |
|---|---|---|---|---|---|---|
| 32 | 1 | 32–36 (gap study) | 0.00116 | 0.00237 | 0.00026 | −0.00060 |
| 64 | 1 | 64–68 (gap study) | 0.00035 | 0.00095 | 0.00029 | −0.00021 |
| 128 | 1 | 128, 131, 134 | **0.00004** | 0.00008 | 0.00003 | +0.00002 |
| 128 | 2 | 128, 130, 133, 136 | **0.00010** | 0.00021 | 0.00008 | −0.00005 |

Phase noise falls much faster than h; from R/h 128 on it is ≤ 1e-4 R and no longer limits the comparison of
neighbouring grids. The archived R/h 32 and 64 values sit low in their phase groups (by 6e-4 and 2e-4), which
biased the earlier 32/64/128 extrapolation slightly downwards.

### 3.3 Iteration error

6 instead of 4 residual orders raises the standoff by +1.4e-4 (R/h 64 a1), +1.0e-4 (96 a1), +1.1e-4 (128 a2),
+1.2e-4 (192 a2), +1.1e-4 (256 a2) (50 %; the other detectors within ±3e-5 of that, except steepest rise +2.0e-4 at
R/h 64). It is a near-constant offset: every 4-order value, and every limit extrapolated from them, is ≈ 1.1e-4 low.
It does not change the refinement trends (section 3.4 holds for the 6-order values too).

### 3.4 Refinement trend

Local slope Δf/Δh between neighbouring grids (R per unit h/R; constant for first-order convergence):

| | 64→96 | 96→128 | 128→192 | 192→256 |
|---|---|---|---|---|
| aspect 1, 50 % | 0.196 | 0.312 | 0.340 | 0.181 |
| aspect 1, equal area | 0.290 | 0.339 | 0.351 | 0.248 |
| aspect 2, 50 % | 0.469 | 0.490 | 0.505 | 0.326 |
| aspect 2, equal area | 0.516 | 0.518 | 0.516 | 0.438 |
| aspect 2, 50 %, 6-order values | | | 0.500 | 0.332 |

From R/h 64 to 192 the slopes are nearly constant (first-order behaviour, observed orders 0.9–1.1 in the
equal-area triplets). **The last step, 192 → 256, is flatter in both columns and all detectors**, and the 6-order
runs show the same, so it is not iteration error, and phase noise (≤ 1e-4) is too small to cause it. Taken at face
value the convergence is accelerating at the finest grids (finest-triplet observed order 1.5–2.8). With one
refinement step showing it, this is not yet a trend.

### 3.5 Extrapolated limit (formal estimates, assumed-order estimates and fits kept apart)

| method | assumption | 50 % | equal area |
|---|---|---|---|
| Celik/GCI, finest triplet 128/192/256, aspect 1 | the observed order (2.76 / 1.98) is asymptotic | 0.35024, GCI ±0.00024 | 0.35003, GCI ±0.00052 |
| same, aspect 2 | observed order 2.22 / 1.47 | 0.35066, GCI ±0.00059 | 0.35005, GCI ±0.00136 |
| same, aspect 2, 6-order values | observed order 2.14 / 1.44 | 0.35074 | 0.35013 |
| Celik, triplets among R/h 64–192, aspect 2 | observed order 0.87–0.91 (50 %), 0.99–1.01 (equal area) | 0.3484–0.3486 | 0.3490–0.3491 |
| same, aspect 1 | observed order 0.35–0.90 (one triplet p = 0.05 excluded); the R/h 64 and 96 values carry 50 % phase noise up to 3.5e-4 | 0.3448–0.3482 | 0.3466–0.3487 |
| Celik on phase-averaged values (R/h 32, 64, 128 phase means; 192, 256), aspect 1 | observed order 0.6–1.0 | 0.3476–0.3492 | 0.3486–0.3493 |
| first order from the finest pair 192/256 | p = 1 | 0.34973 (a1), 0.34986 (a2) | 0.34948 (a1), 0.34943 (a2) |
| 2D fits over all grids R/h ≥ 48 / 64 / 96 (linear, quadratic, p = 0.85) | the fitted form | 0.3486–0.3495 | 0.3485–0.3494 |

The GCI values bound the fine-grid value, not the extrapolation, and here rest on an observed order that differs
from the order of the coarser triplets, so they are not a reliable uncertainty by themselves. All entries are 4-order
values and ≈ 1.1e-4 low (section 3.3).

**Spread over the methods**, iteration offset (+1.1e-4) included:
- equal area: 0.3486–0.3502 (every method above except the raw aspect-1 triplets of R/h 64–192, 0.3466–0.3487,
  which rest on R/h 64/96 values with equal-area phase noise ≈ 3e-4);
- 50 %: 0.3477–0.3508 with the aspect-1 phase-averaged triplets, 0.3485–0.3508 without the triplets that rest on
  R/h 64/96 values (the 50 % detector's phase noise there is 3.5e-4, amplified by the extrapolation); the raw
  aspect-1 triplets of R/h 64–192 (down to 0.3448) are dominated by that noise and are not used.

The equal-area detector has the smallest phase noise at every resolution and the most consistent triplets, so the
band below is anchored on it.

### 3.6 Updated assessment

| | previous | now |
|---|---|---|
| formal result | Richardson 32/64/128: 0.3493 (50 %), 0.3494 (equal area); GCI ±0.0029 on the R/h 128 value | no formal convergence: finest observed order 1.5–2.8 against 0.9–1.1 below R/h 192 |
| phase noise | not measured (now known: 1e-3 at R/h 32) | ≤ 1e-4 from R/h 128 on |
| iteration error | +1e-4 at R/h 32 (one run) | +1.0–1.4e-4, constant from R/h 64 to 256 |
| detector spread at the finest grid | 1.3e-4 (R/h 128) | 5e-5 – 7e-5 (R/h 256) |
| spread of limit estimates | 0.3463–0.3517 (50 %, single triplets incl. intermediate grids) | 0.3486–0.3502 (equal area); 0.3477–0.3508 (50 %) |
| engineering band (judgement) | 0.349–0.352, ±0.003 | **0.3485–0.3508 (≈ 0.3496 ± 0.0012)**: the equal-area range, widened to cover the 50 % estimates from grids with phase noise ≤ 1e-4 |

**What changed:** the band is about three times narrower and sits at the low-to-middle part of the previous one. It
is narrower because phase noise and detector disagreement, which dominated the earlier uncertainty, are now
measured and small at the grids that matter; the remaining width is the unsettled order of convergence (does the
192 → 256 flattening continue?). **What did not change:** the reference is still not formally converged; the band is
an engineering judgement over explicitly listed methods, not a statistical interval. If the flattening continues, the
limit lies near the top of the band (≈ 0.3501–0.3508); if it is transient, near the bottom (≈ 0.3485–0.3495). The
physical model (inviscid ideal gas, Mach 2) and the domain (outer radius 5R, θ ≤ 95°, sensitivity < 1e-4 at R/h 32)
are unchanged and not part of this uncertainty.

## 4. Is the reference sufficient for a cross-solver comparison?

Yes, at the ±0.0012 R level. The axisymmetric band (width ≈ 0.0023) is now narrower than the 3D–axisymmetric
differences under discussion: 0.003–0.010 at matched nominal R/h, and the 3D extrapolated limits 0.3493–0.3540
(gap study, all model forms). The comparison is now limited by the 3D extrapolation, not by the reference: the
lower part of the 3D range overlaps the axisymmetric band, the upper part does not, and the 3D data cannot yet tell
which applies (the 3D convergence order along the flow is unresolved).

## 5. The next 3D experiment (recommendation; nothing was launched)

- **3D 64:32 (R/hx:R/hyz):** not recommended now. Its purpose was to discriminate the 3D order along x (predicted
  0.3546 linear / 0.3543 p = 0.85 / ≈ 0.354 for order 0.64 / ≈ 0.356 for order 1). In the gap study it ran 2 h
  (estimated 46 min) and did not converge within ≈ 8 000 steps (estimate); whether it converges at all is unknown,
  and the most stretched 3D grids (4:1) did not. It cannot be completed within the 2 h job limit, the solver has no
  restart, and adding checkpointing would be a separate code change. Even if it ran, a single offset carries ≈ 3e-4
  of offset scatter against a 2e-3 discrimination, so it would answer the order question only if it converges.
- **Cheaper 3D runs that fit in 2 h** add little: extending the constant-shape families (e.g. 60:40, ≈ 1 h for two
  offsets) separates the competing predictions by only 2–3e-4, about the offset scatter; a second offset for the
  isotropic R/h 48 point (≈ 1–1.5 h) tightens that point's ≈ ±5e-4 phase scatter but not the model-form spread.
- **The decisive 3D information needs longer runs:** an isotropic R/h 64 case (≈ 2.6 M cells, ≈ 4 000 steps, ≈ 4 h
  at the measured 1.4 µs per cell-step) or 64:32 with progress logging, in an environment without the 2 h limit, or
  after a separately reviewed restart capability. Until one of these is available, **no further 3D run is
  recommended**; the defensible statement is that the 3D solver at R/h 32–48 lies 0.008–0.013 R above the
  axisymmetric band and its limit is consistent with the band only under the lower 3D extrapolation forms.

## Files and reproduction

| path | contents |
|---|---|
| `runs/` | R/h 192 and 256, aspect 1 and 2 (profiles with `# meta` header, `summary.jsonl`) |
| `phase/` | R/h 130, 133, 136 (aspect 2) and 131, 134 (aspect 1): grid-phase variations near R/h 128 |
| `iteration/` | R/h 128, 192 and 256 aspect 2 converged to 6 orders |
| `PLAN.md`, `analysis_before_new_runs.txt` | written before the runs |
| `SHA256SUMS` | checksums of every file above (`sha256sum -c SHA256SUMS` from this directory) |

```
cd euv-simulator
T="npx vitest run --root . --config /dev/null --testTimeout 14400000 scripts/gap-axi-measure.test.ts"
RH=192 ASPECT=1,2 OUT=docs/axi-reference-refinement/runs $T            # 38 min + 22 min
RH=256 ASPECT=2   OUT=docs/axi-reference-refinement/runs $T            # 53 min (shared machine)
RH=256 ASPECT=1   OUT=docs/axi-reference-refinement/runs $T            # 92 min alone; close to a 2 h job limit
RH=130,133,136 ASPECT=2 OUT=docs/axi-reference-refinement/phase $T
RH=131,134 ASPECT=1     OUT=docs/axi-reference-refinement/phase $T
RH=128,192,256 ASPECT=2 EXTRA='{"residualDrop":6}' OUT=docs/axi-reference-refinement/iteration $T
node scripts/axi-refine-analysis.mjs
```
