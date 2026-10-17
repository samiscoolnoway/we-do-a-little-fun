# Engineering & Computational Science Lab

The third section of the EUV Lithography Simulator (top bar → **Engineering Lab**, or open the app at `#lab`).
It integrates AeroThermo Lab: a 2D compressible-flow solver, a surface-heating model and a heat-shield
conduction solver, with their visualisation, probe, experiments, exports and teaching material.

> **A separate educational experiment.** The compressible-flow case is an aerothermodynamics problem: a blunt
> heat shield in a supersonic or hypersonic air stream. An EUV scanner does not operate like a high-speed
> vehicle, and nothing in the lab models, reproduces or quantifies ASML equipment or its performance. The lab's
> *About* tab explains which engineering ideas the two share (heat transfer, temperature and dimensional
> stability, fluid flow and cooling, numerical methods and validation).

## Where it lives in the app

| | |
|---|---|
| `src/nav.ts` | the three sections (machine, explorer, lab) and the URL hash (`#machine`, `#explorer`, `#lab`) |
| `src/lab/core/` | physics and numerics, no UI: gas, mesh, Euler solver, exact Riemann solver, configuration, simulation runner, heating, conduction, materials, experiments, probe interpretation |
| `src/lab/worker/` | the flow solver's Web Worker (inlined into the bundle with Vite's `?worker&inline`, so the single-file build works from disk) and its message protocol |
| `src/lab/viz/` | WebGL field renderer (Canvas 2D fallback), overlays, colour maps, camera, point location and streamlines |
| `src/lab/ui/` | the lab's React interface; its own store (no state shared with the machine or explorer); styles scoped under `.atl` and mapped onto the simulator's design tokens |
| `tests/lab/` | unit and verification tests (`npm test`) |
| `tests/lab-e2e.mjs` | end-to-end checks of the unified app (`npm run test:lab-e2e`, after `npm run build`) |

The worker starts the first time the lab is opened and keeps its results while the other sections are
visited. While the lab is open the 3-D scene stays loaded but hidden and does not render; the machine's
timeline is paused and its keyboard shortcuts are inactive.

## What it computes

| Part | Model | Where |
|---|---|---|
| Gas | Calorically perfect air: R = 287.05 J/(kg·K), γ = 1.4, c_p = 1004.7 J/(kg·K); Sutherland viscosity (for heating only) | `src/lab/core/gas.ts` |
| Mesh | Body-fitted O-grid around a circle or ellipse, geometric wall-normal stretching, far field 8–25 half-heights away | `src/lab/core/mesh.ts` |
| Flow | 2D Euler equations, conservative finite volumes, Rusanov flux, MUSCL (minmod / van Albada), SSP-RK2 or implicit LU-SGS | `src/lab/core/euler.ts` |
| Boundaries | Slip wall (mirror state after reconstruction), characteristic far field (Riemann invariants), periodic seam | `src/lab/core/euler.ts` |
| Heating | Laminar stagnation-line correlation for a 2D cylinder with solver edge conditions; Lees distribution on the windward face | `src/lab/core/heating.ts` |
| Conduction | 1D transient conduction through the thickness, implicit, energy-conserving; convective heating minus re-radiation | `src/lab/core/thermal.ts` |

### Flow solver

- **Finite-volume form:** each cell stores mass, momentum and energy, and fluxes through faces are exchanged between neighbours, so conservation holds to round-off.
- **Shock capturing:** the Rusanov flux is used, and second-order reconstruction falls back to first order on any face where it would give non-positive density or pressure. Those faces are counted and shown.
- **Time marching:**
  - *time-accurate*: one global CFL time step, so every snapshot is a physical moment;
  - *steady state*: local time steps. Supersonic steady runs use a matrix-free implicit LU-SGS step (Yoon & Jameson) at CFL ≈ 8; subsonic runs keep the explicit scheme, which preserves the flow's symmetry exactly.
- **Convergence:** judged on the RMS of ∂ρ/∂t falling by a set number of orders of magnitude, measured over the whole domain or, for supersonic flow, the windward region (which the wake cannot influence).
  - A residual that stops falling is reported as *levelled off*, never as converged.
- **Invalid states:** density and pressure are checked after every stage. A non-physical state stops the solver, restores the last valid state and reports the cell, stage and values. Nothing is clipped.

### Surface heating

The inviscid solver cannot compute heat flux, so heating is estimated with laminar boundary-layer theory. The
solver's wall values serve as the boundary-layer edge conditions.

- **Stagnation line, 2D cylinder.** The formula is from Anderson, *Hypersonic and High-Temperature Gas Dynamics*, 2nd ed., §6.6, based on the Fay–Riddell / Cohen–Reshotko similarity solutions:

  q₀ = 0.57 Pr^−0.6 √(ρₑμₑ · duₑ/ds) · (h_aw − h_w),  with Pr = 0.71.

  The velocity gradient duₑ/ds is fitted to the computed wall velocities. The Newtonian estimate is shown as a cross-check.
- **Windward face.** Heating follows Lees' local-similarity distribution. It is marked *not applicable* beyond the shoulders.
- **Comparison.** Sutton–Graves (NASA TR R-376) is given for a sphere and converted to 2D (÷√2). It is an order-of-magnitude comparison only.
- **Output.** The result is a heat-transfer coefficient and an adiabatic-wall temperature. It is a local value: stagnation line plus distribution, not area-averaged.

### Heat-shield conduction

The model solves ρ c_p ∂T/∂t = k ∂²T/∂x² through the thickness. At the surface, the heating from the boundary
layer is balanced against grey-body re-radiation ε σ T⁴; the back face is insulated or held at a fixed temperature.

- **Numerics:** backward Euler with Newton linearisation of the radiation term, and a Thomas tridiagonal solver.
- **Coupling:** quasi-steady, so the heating is held constant during the exposure. The app shows the flow time and conduction time that justify this.
- **Output:** results at the stagnation point, 30° and 60°, plus a map of independent 1D columns (no sideways conduction).

## Verification

Every check below is an automated test with its tolerance and measured values recorded in the test file. The
references are analytic solutions unless marked *correlation*. Agreement with a correlation is a consistency check,
not a validation against experiment.

| Check | Reference | Result |
|---|---|---|
| Uniform flow on the curved O-grid stays uniform (incl. implicit step at CFL 20) | exact | deviation < 1e-11 |
| Mass and energy in a closed box and a curved annulus | exact conservation | < 1e-12 relative |
| Sod shock tube, L1 density error, 200 → 400 cells | exact Riemann solver (Toro) | 1st order 0.018 → 0.012; 2nd order 0.0053 → 0.0030; plateau p*, u* within 0.1 % |
| Stagnation pressure, M = 3 (coarse / medium / fine) | Rayleigh pitot formula | 0.993 / 0.995 / 0.996 |
| Stagnation pressure, M = 6 (coarse) | Rayleigh pitot formula | 0.987 |
| Stagnation temperature, M = 3 / 6 | T₀ = T(1 + 0.2 M²) | +0.8 % / +1.0 % |
| Subsonic stagnation pressure, M = 0.5 (coarse / medium) | isentropic p₀ | +1.15 % / +0.73 % (Rusanov low-Mach error, falls with refinement) |
| Bow-shock standoff, M = 3 (coarse / medium) and M = 6 | Billig, *correlation* | 0.716 / 0.710 vs 0.649; 0.458 vs 0.439 |
| Total enthalpy, windward side outside the smeared shock | exact (constant) | 0.96 % |
| Implicit and explicit steady states | each other | stagnation pressure within 0.1 %, standoff within 0.5 % |
| Stagnation velocity gradient, M = 3 / 6 | Newtonian theory (approximate) | within 1.2 % / 3.4 % |
| Cold-wall stagnation heating, M = 3 / 6 | Sutton–Graves 2D, *correlation* | 33.5 vs 24.6 kW/m² / 209 vs 197 kW/m² |
| Lees distribution, manufactured edge conditions | independent integration | within 1 % |
| Conduction, semi-infinite solid under constant flux | analytic (Carslaw & Jaeger) | 7.2e-5 of the temperature rise; 1st order in time, 2nd in space |
| Conduction, fixed back face, steady state | exact linear profile | < 1e-6 K |
| Conduction energy balance | exact | 1e-13 relative |

The end-to-end tests cover:

- Run, Pause, Resume, Step, Reset, Restart and Restore defaults.
- The restart-needed banner; stale results from a superseded run are never shown.
- Probe readings against the solver's own cell values, and the legend and overlays.
- Heating, the heat shield, an experiment with CSV/JSON export, a predict-run-compare activity, and failure handling.
- The phone layout, with no console errors throughout.

## Performance

Measured in headless Chromium with the solver in a Web Worker (`tests/e2e/perf.mjs` of the standalone lab on branch `claude/aerothermo-simulator`), in the cloud container
the project was developed in. Absolute times depend on the machine.

| Case | Mesh | Scheme | Steps | Time | Result |
|---|---|---|---|---|---|
| M = 3 | 96 × 48 | implicit | 484 | 1.8 s | converged (5 orders) |
| M = 3 | 160 × 80 | implicit | 774 | 8 s | converged |
| M = 3 | 240 × 120 | implicit | 1 141 | 27 s | converged |
| M = 0.5 | 96 × 48 | explicit | 2 921 | 11 s | converged |
| M = 0.5 | 160 × 80 | explicit | 7 141 | 74 s | levelled off at 4.6 orders |

Before the implicit solver, the explicit scheme had not converged on the medium mesh after 12 000 steps. The slow
mode was the near-stagnant flow around the stagnation point.

These timings were measured in the standalone lab before integration. Inside the simulator the solver code and
worker are the same; the integrated end-to-end test checks that the M = 3 case converges in the same 484 steps
with the same stagnation pressure.

## Limits

- **Inviscid flow:** no boundary layer, separation or turbulence in the flow solver. The wake behind the body is unrealistic: the flow expands almost to vacuum, with total-enthalpy errors up to ~20 % there. Treat it as qualitative.
- **Planar 2D:** the body is a cross-section of an infinitely long cylinder, not a capsule. Axisymmetric stagnation heating would be about √2 higher.
- **Calorically perfect gas:** above ~2 000 K real air dissociates; the app warns when T₀ exceeds this.
- **Heating:** a laminar continuum correlation with an uncertainty of order 10–20 %, evaluated with first-cell wall values. It does not predict transition and flags high Reynolds and Knudsen numbers.
- **Heat shield:** constant properties, no ablation or pyrolysis, quasi-steady heating, independent 1D columns. The insulating material presets are illustrative values, not data for a product; the metals use Incropera Table A.1 at 300 K.
- **Numerical accuracy:** the Rusanov flux is robust but diffusive. Shocks are smeared over 2–3 cells, and subsonic stagnation pressure is about 1 % high on the coarse mesh.

## 3D solver prototype (not part of the app yet)

`src/lab/core/euler3d.ts` is the first step towards a three-dimensional solver: the 3D compressible Euler
equations, U = (ρ, ρu, ρv, ρw, E), on a uniform Cartesian box, with the same numerics as the 2D solver
(Rusanov flux, MUSCL with minmod and first-order fallback, SSP-RK2, CFL time step) and periodic, extrapolation
or slip-wall boundaries. It has no body, far field, implicit stepping, viscosity, turbulence or heat transfer,
and it is not used by the user interface or the worker.

Its tests (`tests/lab/euler3d.test.ts`) check exact properties and the exact Riemann solution:

- a uniform flow stays uniform (to 1e-12), and gas at rest in a closed box stays at rest;
- mass, momentum and energy are conserved (to 1e-12 in a periodic box; mass and energy in a closed box);
- the Sod shock tube along x, y and z converges, and gives identical profiles along every axis. L1 density error at 100 / 200 / 400 cells:

  | | 100 | 200 | 400 |
  |---|---|---|---|
  | 1st order | 0.0268 | 0.0183 | 0.0120 |
  | 2nd order | 0.0096 | 0.0053 | 0.0030 |

  These are the same levels as the 2D solver gives for the same scheme.
- a spherical blast in a cube stays mirror- and axis-symmetric while it spreads in all three directions;
- an unstable CFL number is detected and reported, and the last valid state is kept.

This verifies the implementation; it is not a validation against experiment.

### Supersonic sphere (prototype, `src/lab/core/sphere3d.ts`)

The 3D prototype can now represent a sphere with a **ghost-cell (reflection) immersed boundary**:

- **Solid cells:** cells whose centre lies inside the sphere are solid.
- **Ghost states:** each stage, the solid cells reached by the flux stencils get a state mirrored across the true sphere surface. ρ and p are interpolated at the image point, and the normal velocity is reversed. The Cartesian fluxes then see a slip wall with the correct orientation.

Its limitations:

- **Not exactly conservative:** the net mass flux through the body faces is measured every step.
- **Curvature neglected:** the wall-normal pressure gradient from curvature is ignored.
- **First-order geometry:** the surface location is only first-order accurate.

A stair-stepped (voxelised) wall would be conservative, but every step would act as a small forward-facing corner. Experimental conservative cut cells are described in [Wall treatment: where the mass leak comes from](#wall-treatment-where-the-mass-leak-comes-from).

**Case set-up:**

- **Domain:** a quarter domain, using the planes y = 0 and z = 0 as symmetry planes.
- **Boundaries:** supersonic inflow upstream; extrapolation downstream and laterally.
- **Domain size:** 2 R upstream, 1.5 R downstream and 2.5 R laterally of the centre.
- **Flow:** T∞ = 220 K, p∞ = 2500 Pa.
- **Numerics:** CFL 0.8 with local time steps; 150 first-order start-up steps, then second order (minmod).
- **Convergence criterion:** the residual ahead of the sphere centre has dropped 4 orders, and the domain's mass balance has closed (|outer-boundary + body mass flux| < 10⁻³ of the intercepted flux, i.e. dM/dt ≈ 0).

| Mach | R/h | cells | steps | p_stag / pitot | T_stag / T₀ | Δ/R (Billig) | net body mass flux | y↔z symmetry |
|---|---|---|---|---|---|---|---|---|
| 2 | 8 | 11 200 | 642 | 0.946 | 1.019 | 0.429 (0.321) | 6.96 % | 3e-13 |
| 2 | 12 | 37 800 | 1000 | 0.965 | 1.015 | 0.405 (0.321) | 4.41 % | 6e-10 |
| 2 | 16 | 89 600 | 1315 | 0.976 | 1.011 | 0.394 (0.321) | 2.98 % | 5e-9 |
| 3 | 16 | 89 600 | 732 | 0.956 | 1.017 | 0.255 (0.205) | 3.29 % | 2e-9 |

Notes on the table:

- **Body mass flux** is given relative to the mass flux the body intercepts, ρ∞V∞πR²/4.
- **Mach 3 row:** run with the earlier convergence criterion (residual drop only).
- **Convergence order:** at Mach 2 the errors fall at about first order with refinement.
- **Standoff:** linear extrapolation of the standoff gives about 0.36 R, roughly 13 % above Billig's correlation. That is a discrepancy, not an agreement. The 2D cylinder solver shows a similar +10 % against Billig's cylinder correlation.
- **Shock width:** the captured shock is 2.5–2.7 cells wide, so at Mach 3 the shock layer (0.2 R) spans only about 3 cells on this grid.
- **Exact vs empirical checks:** the pitot pressure, T₀, symmetry and undisturbed upstream flow are exact references for inviscid flow. Billig's standoff is an empirical correlation from experiments.
- **Not compared:** drag, base flow, wake and heat transfer are not meaningful for this inviscid solver.

These results verify that the method converges towards the exact references. They are not a validation, and the coarse-grid shock positions are not reliable predictions.

### Wall treatment: where the mass leak comes from

**Mechanism (ghost-cell wall).** The fluid cells touching the body exchange fluxes with ghost states through
the faces of the solid staircase. Each face flux is a Rusanov flux between a fluid state and a mirrored state;
its mass part is zero only if the face is aligned with the true surface. On a staircase it never is:

- at R/h = 8, the x-facing front stair faces remove about 0.66 of the intercepted mass flux;
- the y- and z-facing stair faces on the front return about 0.36 each;
- the gross flux through the stair faces is 0.85–0.92 of the intercepted flux, and the net 6.96 % is the small
  residual of these large, cancelling contributions;
- the outer-boundary mass balance closes against it (outer + body = dM/dt ≈ 10⁻³), so mass really is created
  at the body; it is not a measurement artefact.

The leak falls at about first order (6.96 → 4.41 → 2.98 % for R/h = 8 → 12 → 16): it is the staircase
truncation error of the wall, and only a different wall discretisation removes it.

**Options compared.**

| Option | Conservation | Accuracy near the wall | Stability / cost | Verdict |
|---|---|---|---|---|
| Subtract the measured leak from results, or rescale ghost densities to cancel the net flux | Global only, by construction | Unchanged or worse: the large cancelling face fluxes stay; a correction moves them around | Cheap | Rejected: hides the error rather than removing it |
| Conservative cut cells (volume fractions α, face apertures β, a wall face per cut cell carrying only the wall pressure) | Exact: no mass or energy crosses the body | Depends on reconstruction and small cells (below) | Small cells need local time steps or merging; ≈ 300 lines | Implemented as an experimental option |
| Cut cells with cell merging (α < 0.5 merged into a neighbour) | Exact | First attempt worse (nose p/pitot ≈ 0.79); the cause was found later and fixed (see [Sliver cells](#sliver-cells-diagnosis-and-fix)) | Robust time step | Now the cut-cell default |
| Higher-order cut-cell reconstruction (gradients at cell centroids, wall-aware limiting) | Exact | Cannot fix slivers on its own (see below) | Larger change, new stencils | Still open |

**Experimental cut cells (`wall: 'cutcell'`).** Cut cells keep only their fluid part, with α and β sampled from
the exact sphere. Each cut cell gets one wall face whose area vector closes the cell, A_w n_w = −Σ β A e_out, so
a uniform state at rest is preserved exactly. The wall flux carries only the pressure from the exact wall Riemann
problem. Faces whose MUSCL stencil reaches into the body read the ghost reflection states (only inside the
stencil; faces into the body have zero aperture, so the update stays exactly conservative). Small cells are not
merged (as of e41f915; see the next section); local time stepping handles their small stable steps.

Same Mach 2 cases, same convergence criterion, on one core. The near-wall loss is 1 − p₀,loc / pitot in the
last full cell on the stagnation line (p₀,loc = p (1 + (γ−1)/2 M²)^{γ/(γ−1)}; zero for an isentropic
compression behind the normal shock). At R/h = 8 and 12 the cut-cell nose cell is a sliver, so the loss is taken in
the full cell behind it; at R/h = 16 the nose cell itself is a full cell:

| R/h | wall | steps | time | body flux | Δ/R (Billig 0.321) | p_stag / pitot | T_stag / T₀ | near-wall loss | y↔z symmetry |
|---|---|---|---|---|---|---|---|---|---|
| 8 | ghost | 642 | 6.9 s | 6.96 % | 0.429 | 0.946 | 1.019 | 3.7 % | 3e-13 |
| 8 | cut | 631 | 8.6 s | 0 | 0.382 | 1.054 (α = 0.02) | 1.069 | 5.7 % | 2e-13 |
| 12 | ghost | 1000 | 37.1 s | 4.41 % | 0.405 | 0.965 | 1.015 | 2.7 % | 6e-10 |
| 12 | cut | 1004 | 47.8 s | 0 | 0.376 | 1.044 (α = 0.01) | 1.051 | 4.0 % | 7e-10 |
| 16 | ghost | 1315 | 122.3 s | 2.98 % | 0.394 | 0.976 | 1.011 | 1.9 % | 5e-9 |
| 16 | cut | 1326 | 150.3 s | 0 | 0.373 | 0.950 (α = 1) | 1.009 | 4.7 % | 7e-9 |

What the measurements show:

- **Conservation:** the cut-cell body flux is exactly zero at every resolution, and in a closed box with moving gas
  the total mass and energy stay constant to round-off (2e-15 and 2e-14 after 60 steps; the ghost wall drifts by
  1.3e-3 and 1.6e-3).
- **Stability:** no failures and the same number of steps to convergence (±2 %); about 25 % more time per run
  (the cut-cell time step and the wall faces).
- **Standoff:** cut cells give a smaller standoff at every resolution (closer to Billig on these grids), but linear
  extrapolation in h from R/h = 12 and 16 gives 0.361 R (ghost) and 0.364 R (cut), both 12–13 % above Billig. **The 13 % gap to Billig's correlation is not caused by the wall leak.**
  Likely contributors are the shock capturing on 2.5 cells, the coarse grids and the correlation's own scatter.
- **Near-wall entropy:** the cut-cell near-wall loss is 1.5 times the ghost wall's at R/h = 8 and 12 and 2.5 times at
  R/h = 16 (4.7 % vs 1.9 %), and it does not fall steadily with refinement. With first-order faces next to the body
  (`reconstruction: 'firstorder'`) it was 4–5 times (14.9 % at R/h = 8), so most of it is lost reconstruction
  accuracy, not the conservation itself.
- **Stagnation pressure:** the cut-cell nose value is worse than the ghost wall's at every resolution (+5.4 %,
  +4.4 %, −5.0 % against −5.4 %, −3.5 %, −2.4 %); its sign depends on whether the nose cell is a sliver.
- **Sliver cells:** when the stagnation-line cell is a sliver (α ≈ 0.01–0.02) its state overshoots the exact
  stagnation values (p/pitot up to 1.054, T/T₀ up to 1.069): a small cell driven mostly by its wall-pressure flux,
  with its value treated as if it sat at the cell centre. Making the sliver's faces first order removes the
  overshoot (p/pitot 0.965) but raises the loss in its full neighbour to 15 %; merging was worse.

Conclusion (commit e41f915): cut cells remove the conservation error but, as implemented then, did not give
better near-wall stagnation values than the ghost wall. The next section diagnoses why and fixes it.

### Sliver cells: diagnosis and fix

**Diagnosis (R/h = 8, commit e41f915).** The nose cell on the stagnation line is a sliver: α = 0.023, upstream
aperture 1, downstream aperture 0, lateral apertures 0.02–0.08, wall face ≈ one full cell face. Three candidate
causes were separated by experiment:

| Test | Sliver p/pitot | Sliver T₀,loc/T₀ | Conclusion |
|---|---|---|---|
| baseline | 1.0538 | 1.0712 | |
| CFL 0.8 → 0.4 | 1.0538 | 1.0712 | not the time step: the steady state does not depend on Δt |
| 4× finer α/β sampling (α 0.023 → 0.040) | 1.0535 | 1.0709 | not the geometry: α only scales the time step; β and A_w were already accurate |
| first-order faces next to the body | 0.9654 | 1.0534 | reconstruction changes the size, not the existence, of the error |

The mechanism: a sliver has almost no volume, so its state is not a cell average but the interface state that
makes the Rusanov mass and energy fluxes through its one open face vanish. The full cell upstream still moves
towards the wall (reconstructed face velocity ≈ 28 m/s), so the balance raises the sliver's pressure by about
ρu(a + u) (an acoustic, water-hammer rise, first order in M, where steady stagnation is second order) and its
total enthalpy by Δp/ρ: 15.3 kJ/kg predicted, 18.2 kJ/kg measured. Centroid-based reconstruction cannot remove
this; the sliver has to stop being an independent unknown.

**Fix: three pieces, each conservative.**

1. **Cell merging** (`merge`, default true): every cut cell with α < 0.5 joins the neighbour(s) across an open
   face that best face away from the wall; only cells with α ≥ 0.5 are targets and targets do not link on, so
   groups stay at 2–4 cells (the first attempt let small cells chain). Ties are all linked, so groups are
   mirror-symmetric. A group shares one state, updated with the summed residual over the summed volume; its
   steady state does not depend on the time step. Cells with α < 0.01 (≤ 5 of 512 volume samples, sampling noise
   at the 45° diagonals, which had no large neighbour to join) are dropped instead of 10⁻³ before.
2. **Second-order wall state.** Merging exposed a second error: the wall pressure came from the exact wall
   Riemann problem fed with the cell-centre velocity, which adds a first-order impact pressure ρ a u_n. The
   wall-normal velocity is now extrapolated to the wall with the minmod of the slope from the cell behind and the
   slope to the mirror state (−u_n at distance 2d): the ghost method's MUSCL step, applied at the wall face.
   Wall pressure = cell pressure (u_n = 0) was tried and rejected (the nose group kept 127 m/s towards the wall,
   T₀ errors 5 %).
3. **Reflection states in the stencil.** A merged sliver carries its group's value, so the MUSCL limiter of the
   face upstream saw a zero slope and dropped to first order. Fluid cells whose centre lies inside the body now
   supply a reflection state (as ghost cells do) when they are the outer point of a stencil; fluxes still use
   their own state.

Effect of each piece at R/h = 8 (nose = merged group; front wall = all wall cells with x < 0, area-weighted;
measured during development, the merging-only row before the symmetric tie handling was added):

| | nose p₀/pitot | front-wall mean p₀/pitot | front-wall max \|T₀ error\| |
|---|---|---|---|
| e41f915 | 1.061 (sliver) | 0.863 | 7.1 % |
| + merging | 0.806 | 0.844 | 3.2 % |
| + second-order wall state | 0.856 | 0.864 | 3.1 % |
| + reflection states in the stencil | 0.954 | 0.883 | 3.3 % |
| ghost wall, for reference | 0.963 | 0.874 | 3.3 % |

**Front-wall metric.** In inviscid flow the wall streamline is the stagnation streamline, so the exact wall values
are p₀ = pitot and T₀ everywhere on the body. The cells sit at a finite distance, so p₀ < pitot measures the
numerical entropy near the wall and |T₀,loc/T₀ − 1| the total-enthalpy error; p₀ > pitot is non-physical.

**Same Mach 2 cases, same convergence criterion** (one batch, one core; e41f915 re-run in the same session):

| R/h | wall | steps | time | body flux | Δ/R | p_stag/pitot | T_stag/T₀ | nose p₀/pitot | front-wall mean p₀ | max p₀ | max \|T₀ err\| | symmetry |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 8 | ghost | 642 | 9.1 s | 6.96 % | 0.429 | 0.946 | 1.019 | 0.963 | 0.874 | 0.964 | 3.3 % | 3e-13 |
| 8 | e41f915 | 631 | 8.3 s | 0 | 0.382 | 1.054 | 1.069 | 1.061 | 0.863 | 1.061 | 7.1 % | 2e-13 |
| 8 | new | 687 | 10.6 s | 0 | 0.365 | 0.927 | 1.014 | 0.954 | 0.883 | 0.972 | 3.3 % | 1e-13 |
| 12 | ghost | 1000 | 48.0 s | 4.41 % | 0.405 | 0.965 | 1.015 | 0.973 | 0.897 | 0.975 | 3.4 % | 6e-10 |
| 12 | e41f915 | 1004 | 46.6 s | 0 | 0.376 | 1.044 | 1.051 | 1.046 | 0.893 | 1.046 | 5.4 % | 7e-10 |
| 12 | new | 1083 | 57.8 s | 0 | 0.373 | 0.950 | 1.012 | 0.963 | 0.903 | 0.973 | 2.9 % | 8e-10 |
| 16 | ghost | 1315 | 149.2 s | 2.98 % | 0.394 | 0.976 | 1.011 | 0.981 | 0.909 | 0.981 | 3.1 % | 5e-9 |
| 16 | e41f915 | 1326 | 147.7 s | 0 | 0.373 | 0.950 | 1.009 | 0.953 | 0.909 | 0.999 | 5.4 % | 7e-9 |
| 16 | new | 1339 | 165.3 s | 0 | 0.370 | 0.965 | 1.012 | 0.972 | 0.914 | 0.973 | 3.0 % | 5e-9 |

(At R/h = 12 the e41f915 nose sliver had α = 0.006; with the new drop threshold it is solid and the nose cell is
full.)

**Sensitivity to where the surface cuts the grid** (R/h = 8, grid shifted upstream by 0, ¼, ½, ¾ cell; nose cell
α = 0.02, 0.27, 0.52, 0.77):

| | nose p/pitot | front-wall mean p₀ | max p₀ | max \|T₀ err\| |
|---|---|---|---|---|
| e41f915 | 1.054, 1.001, 0.943, 0.898 | 0.849–0.864 | 0.955–1.061 | 5.3–7.1 % |
| new | 0.927, 0.897, 0.961, 0.945 | 0.883–0.892 | 0.967–0.972 | 2.8–3.7 % |

What the measurements show:

- **Conservation unchanged:** body flux exactly 0; closed box, 60 steps: mass 2e-15, energy 2e-14 (merged and
  unmerged alike).
- **Slivers fixed:** no wall cell exceeds pitot at any resolution or grid offset (e41f915: up to 1.061); the
  largest total-enthalpy error drops from 4.6–7.1 % to 2.6–3.7 % over all runs, the level of the ghost wall; the spread of the
  nose pressure over grid offsets falls from 0.156 to 0.064.
- **Stagnation values:** the nose pressure now converges monotonically from below (−7.3 %, −5.0 %, −3.5 %); e41f915
  went +5.4 %, +4.4 %, −5.0 % depending on whether the nose cell was a sliver. The static-pressure error at R/h = 8
  and 12 is larger in magnitude than e41f915's sliver overshoot (7.3 % vs 5.4 %, 5.0 % vs 4.4 %), because the nose
  value now belongs to a cell half a cell from the wall that still moves at M ≈ 0.2; its local total pressure is
  closer to pitot at every resolution (error 4.6/3.7/2.8 % vs 6.1/4.6/4.7 %). The ghost wall is still closer
  (3.7/2.7/1.9 %).
- **Wall-wide entropy:** the front-wall mean total pressure is now slightly better than the ghost wall's at every
  resolution (0.883/0.903/0.914 vs 0.874/0.897/0.909).
- **Standoff:** 0.365, 0.373 (R/h = 10), 0.373, 0.370: no measurable trend on these grids, and ±0.004 when the grid
  is shifted. It stays 14–16 % above Billig, as before; the wall treatment does not explain that gap.
- **Cost:** 12–28 % slower than e41f915 per run (group updates, the second set of stencil states), about the same
  number of steps (+1–9 %); 11–20 % slower than the ghost wall.

The ghost wall stays the default (it is the reference the tests guard, and its nose values are still the most
accurate); cut cells remain an experimental opt-in, now without the sliver failure.

