# Raw stagnation-line profiles: manifest

Raw data behind `docs/axisymmetric-reference.md`. The files themselves are left exactly as exported; this manifest
adds the run settings and status that the files do not carry. SHA-256 prefixes identify the audited versions.

## Axisymmetric solver (`axi_<flux>_Rh<N>.csv`)

Columns: `d` (distance of the cell centroid from the sphere surface along its ray, in sphere radii R),
`rho_over_rhoInf` (ρ/ρ∞), `phi` = (ρ − ρ∞)/(ρ₂ − ρ∞) with ρ₂/ρ∞ = 8/3 (Mach 2 normal shock, γ = 1.4). Rows run from
the outermost cell (upstream) to the cell at the wall; one row per cell of the stagnation-line row (cells next to the
axis, centroids at polar angle Δθ/2), 4·N rows.

Common settings (`sphereAxi.ts` defaults): M∞ = 2, T∞ = 220 K, p∞ = 2500 Pa, γ = 1.4; body-fitted polar grid
ρ ∈ [R, 5R], θ ∈ [0, 95°], radial spacing h = R/N, tangential spacing ≈ h at the wall; CFL 0.4, local time steps,
150 first-order steps then second-order minmod MUSCL; stop at a 4-order drop of the residual in x < 0 together with
|net boundary mass flux| < 10⁻³ of ρ∞V∞R²/2.

| file | flux | R/h | cells | steps | converged | residual drop | mass imbalance | SHA-256 (prefix) |
|---|---|---|---|---|---|---|---|---|
| axi_rusanov_Rh8.csv | Rusanov | 8 | 416 | 721 | yes | 4.13 | 1.0e-3 | b45f86b23ed1c2b7 |
| axi_rusanov_Rh16.csv | Rusanov | 16 | 1 728 | 1347 | yes | 4.13 | 1.0e-3 | fd5c2076c5412ee4 |
| axi_rusanov_Rh32.csv | Rusanov | 32 | 6 784 | 2571 | yes | 4.16 | 1.0e-3 | 859a202c41accee9 |
| axi_rusanov_Rh64.csv | Rusanov | 64 | 27 136 | 5034 | yes | 4.16 | 1.0e-3 | 0df900fc465e49a6 |
| axi_rusanov_Rh128.csv | Rusanov | 128 | 108 544 | 9937 | yes | 4.14 | 1.0e-3 | 7b0e0e7a471a036c |
| axi_hllc_Rh8.csv | HLLC | 8 | 416 | 622 | yes | 4.00 | 7.4e-4 | 0c4a75f29a04d81d |
| axi_hllc_Rh16.csv | HLLC | 16 | 1 728 | 1316 | yes | 4.00 | 6.6e-4 | 4d84de050736d169 |
| **axi_hllc_Rh32.csv** | HLLC | 32 | 6 784 | 40 000 (limit) | **no** | 3.64 | 4.2e-6 | 672297a13e7b2241 |

`axi_hllc_Rh32.csv` is a snapshot of a run that did **not** converge (see "HLLC" in the reference document); it is
kept for the record and must not be used as a result.

Not exported (no profile exists): the axisymmetric R/h = 12 runs (both fluxes) and all sensitivity runs at R/h = 32
(outer radius 7R, θmax 110°, CFL 0.3, tangential spacing ½h and 2h). Their scalar results are in the reference
document only.

Reproducibility (audited): rerunning Rusanov R/h = 8, 16, 32, 64 and HLLC R/h = 8, 16 with
`scripts/axisym-measure.test.ts` gives byte-identical files. R/h = 128 and HLLC R/h = 32 were not rerun (cost).
`node scripts/axisym-analysis.mjs` recomputes every detector value quoted in the reference from these files.

## Cartesian 3D solver (`3d/prof_<flux>_<R>_<offset>.txt`)

Text exports from the 3D cut-cell sphere case (`sphere3d.ts`, uncommitted HLLC/detector work): header with flux,
R/h, grid offset (fraction of a cell), steps, convergence flag, residual drop and mass imbalance; the surface position
x_nose on the measurement line y = z = h/2; the 10 / 50 / 90 % crossings and the steepest-rise detector with their
bracketing cells; then a **partial** profile: only the cells from about four cells ahead of the 10 % crossing to the
last fluid cell before the body (columns: cell index i, x of the centre, ρ/ρ∞, φ, fluid fraction α), and the range of
φ over the cells upstream of those. Set-up: M∞ = 2, T∞ = 220 K, p∞ = 2500 Pa; Cartesian quarter domain (2R upstream,
1.5R downstream, 2.5R laterally), cut-cell wall with merging, CFL 0.8, local time steps, same stopping criterion.
The listed crossings reproduce from the listed cells to the printed precision (≤ 5e-5).

| file | flux | R/h | offset | steps | converged | SHA-256 (prefix) |
|---|---|---|---|---|---|---|
| 3d/prof_rusanov_8_0.txt | Rusanov | 8 | 0 | 687 | yes | 25b2ddea91ec195e |
| 3d/prof_rusanov_12_0.txt | Rusanov | 12 | 0 | 1083 | yes | f3a0b6412308aa22 |
| 3d/prof_rusanov_16_0.txt | Rusanov | 16 | 0 | 1339 | yes | 18cccd4c4d1a6207 |
| 3d/prof_rusanov_16_0.5.txt | Rusanov | 16 | 0.5 | 1334 | yes | 1050049401e3693a |
| 3d/prof_hllc_8_0.txt | HLLC | 8 | 0 | 702 | yes | 149edd20c9084fb7 |
| 3d/prof_hllc_12_0.txt | HLLC | 12 | 0 | 954 | yes | a0374dd2dcb5c7b8 |
| 3d/prof_hllc_16_0.txt | HLLC | 16 | 0 | 1194 | yes | 35b13b0487462d6c |
| 3d/prof_hllc_16_0.5.txt | HLLC | 16 | 0.5 | 1802 | yes | 459b687665a7bb2b |
