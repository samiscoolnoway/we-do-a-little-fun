# Axisymmetric Euler reference (research prototype)

`src/lab/core/axisym.ts` (solver) and `src/lab/core/sphereAxi.ts` (Mach 2 sphere case) form an independent
axisymmetric (x–r) compressible Euler solver, written to cross-check the bow-shock standoff of the Cartesian 3D
prototype (`euler3d.ts`, `sphere3d.ts`). They share no solver code with it; only the gas relations of `gas.ts`
(freestream state, normal-shock and pitot relations) are reused, so both use the same gas model. Nothing here is used
by the application. It is a research reference, not validated ground truth.

Audit status: governing equations, geometry, fluxes, boundary conditions, detectors, raw data and the convergence
calculation were re-checked independently (code review, quadrature check of the geometry, byte-identical reruns,
recomputation of every quoted number from the raw profiles). Corrections from that audit are marked *(audit)*.

---

## 1. Governing equations and numerical method

**Coordinates.** Cylindrical (x, r, ϑ), x along the symmetry axis (the freestream direction), r ≥ 0. Axisymmetric
without swirl: nothing depends on ϑ, the azimuthal velocity is zero. Velocities u (axial), v (radial).

**Variables and closure.** U = (ρ, ρu, ρv, E), E = p/(γ − 1) + ½ρ(u² + v²); calorically perfect air, p = ρ R_gas T,
γ = 1.4 (`GAS` in `gas.ts`, as in the 3D solver).

**Equations** (3D Euler in cylindrical coordinates with ∂/∂ϑ = 0, no swirl):

    ∂U/∂t + ∂F/∂x + (1/r) ∂(r G)/∂r = S
    F = (ρu, ρu² + p, ρuv, u(E + p)),   G = (ρv, ρuv, ρv² + p, v(E + p)),   S = (0, 0, p/r, 0)

S is the radial pressure force on the two non-parallel ϑ = const faces of an annular sector. Since
(1/r)∂(r(ρv² + p))/∂r − p/r = (1/r)∂(rρv²)/∂r + ∂p/∂r, a uniform pressure exerts no net radial force.

**Finite-volume form** over a meridional cell Ω rotated by one radian (dV = r dx dr):

    d/dt ∫_Ω U r dA + ∮_∂Ω (F n_x + G n_r) r ds = (0, 0, ∫_Ω p dA, 0)

**Grid.** Structured, straight-edged quadrilaterals in the meridional half-plane: a rectangular x–r grid
(verification) or a body-fitted spherical-polar grid (x = −ρ cos θ, r = ρ sin θ, θ = 0 on the upstream stagnation
line, uniform in ρ and θ; axis vertices are set to r = 0 exactly).

**Geometry (exact for straight edges).** Cell: planar area A (shoelace), planar centroid (x_c, r_c), ring volume
V = ∫ r dA = A r_c (Pappus). Face of length L: ring area A_f = ∫ r ds = L r_mid (r linear along the edge). Hence, for
every cell, Σ n_r A_f = ∮ r n_r ds = A and Σ n_x A_f = 0. *(audit: both formulas checked against 8×8 Gauss
quadrature on two polar cells, one touching the axis: agreement to 2e-15 and 9e-15; `node scripts/axisym-analysis.mjs`
section 3.)*

**Update.** V dU_c/dt = −Σ_f F̂_f A_f + (0, 0, p_c A, 0). The source uses the planar area, so a uniform pressure is
balanced exactly (p Σ n_r A_f = p A). p_c comes from the r-weighted cell state, whereas the source integral needs the
area-weighted mean of p; the difference is O(h²) in smooth flow and vanishes at the axis, where ∂p/∂r = 0.

**Numerical flux.** Rusanov (default) or HLLC (Toro–Spruce–Speares star states, Batten et al. form, Einfeldt wave
speeds S_L = min(u_n,L − a_L, ũ_n − ã), S_R = max(u_n,R + a_R, ũ_n + ã) from Roe averages), both in the face-normal
frame u_n = u n_x + v n_r, u_t = −u n_r + v n_x and rotated back with F_x = f_n n_x − f_t n_r, F_r = f_n n_r + f_t n_x.
HLLC falls back to Rusanov on the same face states, counted, when ã² ≤ 0, the mass-flux denominator vanishes,
S* ∉ (S_L, S_R), p* ≤ 0, ρ* ≤ 0 or a result is not finite.

**Reconstruction.** First order, or MUSCL-minmod on (ρ, u_n, u_t, p) along each grid index direction (velocity in the
frame of the face being computed, so a mirror ghost state stays an exact mirror after limiting); first order on a
face whose reconstructed ρ or p would be ≤ 0 (counted). Two ghost layers per side.

**Time stepping.** Two-stage SSP Runge–Kutta (Heun). Δt_c = CFL · 2V / Σ_f (|u·n_f| + a) A_f per cell (local, steady
states) or its minimum (global); for a Cartesian cell this is Δt = CFL / Σ_d (|u_d| + a)/Δx_d. Density and pressure
are checked after each stage; an invalid state restores the last valid state and records the cell.

**Boundary conditions.**

| Boundary | Treatment |
|---|---|
| symmetry axis (r = 0) | faces on the axis have A_f = L·0 = 0: no flux, by construction; ghost cells mirror the interior (v → −v) for the stencil |
| slip wall (sphere surface) | ghost cells mirror the interior across the face (normal velocity reversed, both layers with the boundary-face normal); with the face-frame reconstruction both fluxes carry exactly zero mass and energy, only pressure |
| supersonic inflow | prescribed state, evaluated at each ghost layer's position (the interior centroid mirrored across the face) |
| supersonic outflow | zero-gradient extrapolation; valid only where the outflow is supersonic (checked by the sphere case) |

**Conservation limits.** Closed domain: mass and energy conserved to round-off. Axial momentum changes only through
wall pressure forces; radial momentum is not a conserved total (the p/r source is physical). Open domain: the change of
the totals equals the time-integrated boundary flux, which the solver accumulates (`boundaryMassIntegral`, exact with
the RK2 weights for **global** time steps only; it has no meaning with local time steps). The body is mass- and
energy-tight; the polygonal body differs from the sphere by at most R Δθ²/8 (chord sag).

---

## 2. Verification (reproducible)

`npx vitest run tests/lab/axisym.test.ts` (17 tests) — values below re-measured with the current code:

| Check | Result |
|---|---|
| Σ n_r A_f = A, Σ n_x A_f = 0 (rectangular and polar grids) | 2e-15 relative |
| uniform axial flow on the polar grid incl. the axis (both fluxes) | preserved to 2e-15 |
| gas at rest around the sphere, walls + axis (fails if the p/r source is wrong) | preserved to 4e-12 |
| closed domain: mass, energy (both fluxes) | 1e-15 |
| open domain: ΔM vs. ∫ boundary mass flux (global Δt) | 7e-16 |
| slip wall: mass flux through the sphere surface (sphere case) | ≤ 3e-17 of the intercepted flux |
| Sod along the axis, L1(ρ) at 100 / 200 / 400 cells | Rusanov 1st 0.0268 / 0.0183 / 0.0120, 2nd 0.0096 / 0.0053 / 0.0030; HLLC 1st 0.0209 / 0.0133 / 0.0084, 2nd 0.0077 / 0.0042 / 0.0024 (identical to the independent 3D solver); radial rows identical to 4e-14, v ≤ 3e-13 |
| 123 problem (two strong rarefactions) | positive states; HLLC falls back on 24 of 4.3e5 faces |
| exact supersonic spherical source flow, M 2.5 → 4.1 (exercises p/r and the axis with v ≠ 0), CFL 0.4 | L1(ρ) at N = 16 / 32 / 64: Rusanov 4.45e-4 / 1.20e-4 / 3.24e-5 (order 1.90, 1.88), HLLC 2.86e-4 / 7.27e-5 / 1.83e-5 (1.98, 1.99); spread across θ 8.3e-6 / 1.6e-6 / 2.4e-7 |

`npx vitest run tests/lab/sphereAxi.test.ts` (5 tests): coarse sphere case — convergence, mass-tight wall, bow shock
inside the domain, supersonic outflow, detector formulas against the exported profile, R/h 8 → 16 trend.

Convergence behaviour found during development (kept for the record): with CFL 0.8 the second-order sphere case
stalls about 2 orders down (residual near the outer bow shock, θ ≈ 80–86°); at CFL 0.4 it converges to machine zero
with the same standoff (0.36276 at R/h = 16 both ways). The sphere case therefore uses CFL 0.4.

---

## 3. Shock detectors (definitions)

All detectors act on the **stagnation-line row**: the cells next to the axis (centroids at polar angle Δθ/2: 3.7° at
R/h = 8, 0.22° at R/h = 128), ordered from the outer boundary (upstream) to the wall. For each cell: d = distance of
the centroid from the sphere surface (ρ_c − R), φ = (ρ − ρ∞)/(ρ₂ − ρ∞), ρ₂/ρ∞ = (γ+1)M²/((γ−1)M² + 2) = 8/3.

- **Crossing L (10 % "foot", 50 % "mid", 90 % "tail"):** first k with φ_{k−1} < L ≤ φ_k;
  d_L = d_{k−1} + (d_k − d_{k−1})(L − φ_{k−1})/(φ_k − φ_{k−1}). The 50 % crossing is the primary standoff.
- **Steepest rise:** the face (k−1, k) with the largest ρ_k − ρ_{k−1}; a parabola through the rises at k−1, k, k+1
  moves it by δ = ½(r₋ − r₊)/(r₋ − 2r₀ + r₊) cells towards the wall (|δ| ≤ ½).
- **Equal area:** S = Σ min(max(φ, 0), 1) from upstream to the first cell with φ ≥ 1 (inclusive); the step position is
  d = d_last − h/2 + hS (a step from φ = 0 to 1 holding the same integrated jump).
- **Width:** (d_foot − d_tail)/h, in cells.

The 3D export uses the same definitions on the line of cells j = k = 0 (centres at y = z = h/2), with d measured from
the true sphere surface on that line. The steepest-rise and equal-area formulas use the nominal radial spacing h;
actual centroid spacing differs by ≤ 0.3 % of h at R/h = 8 and ≤ 0.02 % at R/h ≥ 32 *(audit)*.

---

## 4. Mach 2 sphere: refinement results (Rusanov)

Set-up: M∞ = 2, T∞ = 220 K, p∞ = 2500 Pa, γ = 1.4; domain ρ ∈ [R, 5R], θ ∈ [0, 95°]; radial spacing h = R/N, tangential
spacing ≈ h at the wall (1.36 h at the shock on the axis, 5 h at the outer boundary); CFL 0.4, local time steps,
150 first-order steps then second order; stop when the residual in x < 0 has dropped 4 orders and |net boundary mass
flux| < 10⁻³ of ρ∞V∞R²/2. Cell counts: ni = 4N radially, nj = round(N · 95° in rad) = 13, 27, 53, 106, 212.

Values recomputed from the raw profiles *(audit; the earlier tables quoted 4-digit roundings of the same numbers)*:

| R/h | cells | steps | time | 50 % | steepest rise | equal area | 10 % | 90 % | width | nose p/pitot | nose p0/pitot | wall p0 mean | max \|T0 err\| |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 8 | 416 | 721 | 0.2 s | 0.36429 | 0.33757 | 0.37668 | 0.53807 | 0.23299 | 2.44 | 0.944 | 0.959 | 0.936 | 2.8 % |
| 16 | 1 728 | 1347 | 2.0 s | 0.36265 | 0.35569 | 0.36711 | 0.45450 | 0.28938 | 2.64 | 0.973 | 0.977 | 0.933 | 1.7 % |
| 32 | 6 784 | 2571 | 9.8 s | 0.35668 | 0.35441 | 0.35899 | 0.40327 | 0.31521 | 2.82 | 0.988 | 0.989 | 0.950 | 1.4 % |
| 64 | 27 136 | 5034 | 84 s | 0.35339 | 0.35257 | 0.35408 | 0.37785 | 0.33136 | 2.98 | 0.995 | 0.995 | 0.966 | 1.2 % |
| 128 | 108 544 | 9937 | 729 s | 0.35156 | 0.35158 | 0.35169 | 0.36290 | 0.34016 | 2.91 | 0.997 | 0.997 | 0.977 | 1.0 % |

All runs: converged by the criterion, no invalid state, no reconstruction fallback, wall mass flux ≤ 3e-17, outer ring
within 5e-4 of the freestream, outflow normal Mach 1.39–1.41. Runtimes: one process at a time, single core.

**Iteration error *(audit)*.** At R/h = 32 the run continued to an 11-order drop moved the 50 % standoff from 0.35668
(at the stopping criterion) to 0.35677: +0.00009 R, 3–5 % of the grid differences used below.

**Sensitivity at R/h = 32** (scalar results only; these runs were not exported): outer radius 7R 0.3567 (unchanged);
θmax 110° 0.3568; CFL 0.3 0.3567 (unchanged); tangential spacing ½h 0.3553; 2h 0.3616. The refinement series refines
the tangential spacing together with the radial one.

---

## 5. Convergence and extrapolation (transparent calculation)

**Method** (Roache's GCI; Celik et al., J. Fluids Eng. 130, 2008, procedure with constant ratio). Grids 1 (fine),
2, 3 (coarse), refinement ratio r = 2, values f₁, f₂, f₃:

    e₂₁ = f₂ − f₁,   e₃₂ = f₃ − f₂,   convergence ratio R = e₂₁/e₃₂ (monotone convergence: 0 < R < 1)
    observed order          p = ln(e₃₂/e₂₁) / ln r
    Richardson extrapolation f_ext = f₁ − e₂₁/(rᵖ − 1)
    GCI (fine grid)         GCI₂₁ = F_s |e₂₁/f₁| / (rᵖ − 1),  F_s = 1.25 (three-grid study)
    asymptotic-range check  GCI₃₂ / (rᵖ GCI₂₁) ≈ 1

r = 2 holds exactly in both directions for R/h = 32/64/128 (ni 128/256/512, nj 53/106/212); for 16/32/64 the
tangential ratio is 53/27 = 1.963 (effective ratio from cell counts 1.981), a small inconsistency.

**Results** (`node scripts/axisym-analysis.mjs`, section 2):

| detector | triplet | R | observed p | f_ext | GCI₂₁ (on f₁) | asymptotic check | f_ext with p = 1 / p = 2 |
|---|---|---|---|---|---|---|---|
| 50 % | 8/16/32 | 3.66 | — (differences grow: not asymptotic) | | | | |
| 50 % | 16/32/64 | 0.551 | 0.860 | 0.34936 | ±0.00504 (1.43 %) | 0.991 | 0.35010 / 0.35229 |
| 50 % | 32/64/128 | 0.557 | 0.843 | 0.34925 | ±0.00289 (0.82 %) | 0.995 | 0.34972 / 0.35095 |
| steepest rise | 8/16/32, 16/32/64 | — | — (oscillatory / growing) | | | | |
| steepest rise | 32/64/128 | 0.537 | 0.898 | 0.35044 | ±0.00143 (0.41 %) | 0.997 | 0.35059 / 0.35125 |
| equal area | 8/16/32 | 0.848 | 0.238 | (0.31379) | (±0.0565) | 0.978 | — |
| equal area | 16/32/64 | 0.605 | 0.726 | 0.34658 | ±0.00938 (2.65 %) | 0.986 | 0.34917 / 0.35245 |
| equal area | 32/64/128 | 0.488 | 1.035 | 0.34941 | ±0.00285 (0.81 %) | 0.993 | 0.34929 / 0.35089 |

**Numerical findings.**

1. R/h = 8–16 are outside the asymptotic range for every detector (the 50 % differences grow from 0.00163 to 0.00597
   before shrinking to 0.00329 and 0.00183).
2. The finest triplet satisfies the formal conditions for all three detectors: monotone convergence, the asymptotic
   check within 1 %, observed order 0.84–1.04. The 50 % detector also gives a consistent second triplet (16/32/64:
   p = 0.86, f_ext 0.34936); the equal-area detector does not (p = 0.73, f_ext 0.3466); the steepest-rise detector has
   only one usable triplet.
3. The observed order (≈ 0.85–1.0) is below the nominal second order of the scheme, as expected when the shock
   position is controlled by first-order shock-capturing errors; the GCI method assumes one dominant error term, which
   the asymptotic check supports for the finest triplet only.

**Three different quantities — not to be added together.**

- **Formal GCI** (a band on the fine-grid value, not on the extrapolation): the R/h = 128 values lie within
  0.35156 ± 0.00289 (50 %), 0.35158 ± 0.00143 (steepest rise), 0.35169 ± 0.00285 (equal area) of the grid-converged
  value of this discrete model, with the usual GCI meaning (≈ 95 % coverage when the asymptotic assumption holds).
- **Extrapolation spread:** finest triplet, observed p: 0.34925–0.35044 across detectors; with the order assumed
  instead (p = 1 or 2): 0.34929–0.35125. Across triplets (50 %): 0.34925 vs 0.34936; (equal area): 0.34941 vs 0.34658.
- **Engineering judgement (not a formal result):** taking the union of the three fine-grid GCI bands (0.3487–0.3545)
  and the extrapolations (observed p, every usable triplet: 0.3466–0.3504, the low end from the less reliable
  equal-area 16/32/64 triplet; assumed p = 1 or 2 on the finest triplet: 0.3493–0.3513), the inviscid
  standoff of this model is very likely between about 0.347 R and 0.355 R, with best estimates 0.349–0.351 R.
  Iteration error (≈ 1e-4 R) and the measurement-ray offset (< 1e-3 R at R/h ≥ 32) are small against this.

*(audit: the earlier report quoted "extrapolated 0.3494–0.3503 with ±0.0016–0.0029" and a combined
"Δ/R = 0.350 ± 0.003". The extrapolated values are reproduced to within 0.0002 (they had been computed from 4-digit
roundings), but the ± values are GCIs, which bound the fine-grid value, not the extrapolated value, and the combined
figure was a judgement, not a formal result. Superseded by the paragraph above.)*

---

## 6. HLLC on the axisymmetric sphere case (unresolved)

**Verified (reproduced in the audit):**

- R/h = 8 and 16 converge (622 and 1316 steps); 50 % standoff 0.36506 and 0.35864; shock width 0.94 and 1.44 cells
  (Rusanov 2.44, 2.64); front-wall mean p0/pitot 0.973 and 0.970 (Rusanov 0.936, 0.933); zero HLLC fallbacks.
- R/h = 12 converges by the criterion to a **non-physical** nose state, p0/pitot = 1.0517 (above pitot), standoff 0.3448.
- R/h = 32 does **not** converge: in 8000 steps (CFL 0.4) the residual reaches about 3.2 orders and stays there, while
  the 50 % standoff wanders between 0.3480 and 0.3503; an earlier run at CFL 0.2 behaved the same. Zero fallbacks.
- In the same R/h = 32 set-up after 8000 steps, the shock position across the first eight rows next to the axis is
  **non-monotone** in θ (0.34971, 0.34817, 0.35149, …; second differences change sign, magnitude ≈ 5e-3) and the
  nose cell has a radial velocity of −13 m/s (towards the axis). Rusanov in the identical set-up converges 11 orders,
  holds the standoff at 0.35677, has a monotone shock (second differences 4–8e-4, one sign) and v = +6.6 m/s.

**Interpretation (not established):** the symptoms (a perturbation localized at the axis behind a grid-aligned strong
shock, CFL-independent, absent with the more dissipative Rusanov flux) are consistent with the known shock instability
of HLLC-type fluxes (carbuncle type), but an interaction with the axis/mirror treatment or the polar-grid geometry has
not been excluded. HLLC is therefore not used as a reference here.

**3D context (from the HLLC experiment, `euler3d.ts` option, not re-run in this audit):** the Cartesian 3D HLLC runs
converged at R/h = 8, 12, 16 and on a shifted R/h = 16 grid with zero fallbacks; shock width 1.2–1.5 cells (Rusanov
2.5–2.7); near-wall errors lower than Rusanov; runtime 22–50 % higher.

---

## 7. Comparison with the Cartesian 3D solver

Same flow and detector definitions; 3D values from `docs/axisym-data/3d/` (cut-cell wall, CFL 0.8, Cartesian quarter
domain; see the manifest there).

| flux | R/h | 3D 50 % | axi 50 % | 3D − axi | 3D steepest rise | axi steepest rise |
|---|---|---|---|---|---|---|
| Rusanov | 8 | 0.3650 | 0.3643 | +0.0007 | 0.3107 | 0.3376 |
| Rusanov | 12 | 0.3732 | 0.3637 | +0.0095 | 0.3606 | 0.3503 |
| Rusanov | 16 | 0.3699 | 0.3627 | +0.0072 | 0.3639 | 0.3557 |
| HLLC | 8 | 0.3629 | 0.3651 | −0.0022 | 0.3601 | 0.3611 |
| HLLC | 16 | 0.3619 | 0.3586 | +0.0033 | 0.3648 | 0.3609 |

**Findings.** At equal nominal R/h the two solvers differ by −0.002 to +0.010 R. Both are pre-asymptotic at
R/h ≤ 16 (the axisymmetric 50 % standoff still falls by 0.011 R between R/h = 16 and 128).

**Interpretation.** Equal nominal R/h is not equal resolution: the 3D grid has spacing h in all three directions and a
cut-cell wall on a Cartesian grid; the axisymmetric grid is body-fitted with tangential spacing growing from h (wall)
to 1.36 h (shock). Differences of this size are plausibly finite-resolution and discretization differences, but the
3D solver has not been refined beyond R/h = 16, so it is **not shown** that both converge to the same value.

---

## 8. Comparison with the Billig correlation

0.143 exp(3.24/M²) = 0.3215 at M = 2 is an empirical fit to experimental shock-detachment distances (attributed to
Ambrosio & Wortman, quoted by Billig, J. Spacecraft Rockets 4(6), 1967). Its original definition of the standoff, data
set, Mach range and uncertainty have **not** been verified (the note could not be retrieved). It is used only as a
comparison reference.

The model's best estimates (0.349–0.351 R) lie 8.6–9.2 % above it; the engineering envelope (0.347–0.355 R) lies
7.9–10.4 % above. The discretization uncertainty of this solver is a fraction of the difference. Whether the difference
comes from the correlation (accuracy at M = 2, definition), from physics absent in the Euler model, from the
experimental conditions behind the correlation, or from an error not detected by these checks is **not established**.
Neither solver was tuned to the correlation.

---

## 9. Limitations

- Euler equations: inviscid, no boundary layer, calorically perfect air, one Mach number (2), one body.
- Minmod MUSCL is first order at shocks and extrema; the standoff converges at order ≈ 0.85–1.0.
- Formal GCI rests on one fully asymptotic triplet per detector (two for the 50 % detector).
- HLLC is unreliable on this body-fitted grid at R/h ≥ 12 (section 6); only Rusanov results are a reference.
- The measurement ray lies Δθ/2 off the axis (0.22° at R/h = 128); the 3D line lies h/√2 off the axis.
- The R/h = 12 runs and the sensitivity runs were not exported as profiles.

---

## 10. Verified, estimated, unresolved

| Verified measurement | Estimate | Unresolved |
|---|---|---|
| geometry, source balance, wall tightness, conservation (to round-off) | grid-converged standoff 0.349–0.351 R (Richardson, finest triplet) | cause of the HLLC non-convergence at R/h = 32 and the R/h = 12 nose overshoot |
| Sod and source-flow convergence (orders 1.88–1.99 in smooth flow) | engineering envelope 0.347–0.355 R | whether the 3D solver converges to the same standoff |
| refinement values R/h 8–128 (reproducible, byte-identical reruns up to R/h 64) | GCI bands on the R/h = 128 values (±0.0014–0.0029 R) | the source of the 8–10 % difference from the Billig correlation |
| R/h ≤ 16 pre-asymptotic; finest triplet asymptotic | | definition, data and uncertainty of the Billig correlation |

---

## 11. Reproduce

From `euv-simulator/`:

```sh
# verification tests (≈ 25 s)
npx vitest run tests/lab/axisym.test.ts tests/lab/sphereAxi.test.ts

# detectors and convergence analysis from the archived raw profiles, geometry quadrature check (≈ 1 s)
node scripts/axisym-analysis.mjs

# rerun the refinement study (profiles + summary into $OUT; R/h 128 ≈ 12 min)
RH=8,16,32,64,128 FLUX=rusanov OUT=/tmp/axisym npx vitest run --root . --config /dev/null scripts/axisym-measure.test.ts

# HLLC runs (R/h 32 runs to the 40 000-step limit, ≈ 4 min)
RH=8,12,16,32 FLUX=hllc OUT=/tmp/axisym npx vitest run --root . --config /dev/null scripts/axisym-measure.test.ts

# sensitivity runs, e.g. tangential spacing ½h at R/h 32 (other options: outer, thetaMaxDeg, cfl)
RH=32 FLUX=rusanov EXTRA='{"aspect":0.5}' OUT=/tmp/axisym npx vitest run --root . --config /dev/null scripts/axisym-measure.test.ts

# repository checks
npm test && npm run typecheck && npm run build
```

Raw data and its manifest: `docs/axisym-data/` (see `docs/axisym-data/README.md`).

---

## Addendum (2026-10-18): gap study

`docs/sphere-gap-study/` reran this case (unchanged solver; R/h 16, 32 and 128 reproduce the archived profiles byte
for byte) with independent radial and tangential spacing, intermediate and finer grids (R/h 24, 48, 96) and small
R/h variations. Findings that bear on this document:

- The standoff error of this solver is dominated by the **tangential** spacing (∂f/∂h_t ≈ 0.15–0.17 against
  ∂f/∂h_r ≈ 0.04–0.11 R per unit h/R, 50 %); the refinement series above refines both together.
- Varying R/h by a few per cent moves the detectors by up to 1e-3 R (50 %, near R/h 32) and 3e-4 R (near R/h 64):
  grid-phase noise of the same size as the 3D grid-offset scatter. The archived R/h 32 and 64 values sit at the low
  end of their phase groups.
- With the additional grids, single-triplet Celik estimates along the reference grid range 0.3463–0.3517 R (50 %)
  depending on the triplet; two-dimensional error-model fits give 0.3488–0.3506 R (50 %) and 0.3483–0.3499 R (equal
  area). The best estimate 0.349–0.351 R of section 5 remains central, but its uncertainty is larger than the GCI
  bands quoted there; ±0.003 R is a more defensible engineering band (judgement).
- Converging to 6 instead of 4 residual orders raises the standoff by 1.0–1.4e-4 R at R/h 64 and 96.

## Addendum 2 (2026-10-18): higher-resolution refinement

`docs/axi-reference-refinement/` added R/h 192 and 256 (tangential spacing 1× and 2× radial), grid-phase variations
near R/h 128 and 6-order iteration checks up to R/h 256 (solver and settings unchanged). Grid-phase noise is ≤ 1e-4 R
from R/h 128 on, the detectors agree to 5e-5 at R/h 256, and the iteration error is a constant +1.1e-4 R. Over the
listed extrapolation methods the limit lies in 0.3486–0.3502 R (equal area) and 0.3477–0.3508 R (50 %); the
engineering band is now **0.3485–0.3508 R (≈ 0.3496 ± 0.0012)**, replacing the ±0.003 R of Addendum 1. The reference is
still not formally converged: the last refinement step (192 → 256) is flatter than the earlier ones, so the
asymptotic order is unsettled. Details, assumptions and data in that directory.
