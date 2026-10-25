# 3D Cartesian sphere: independent refinement study (Mach 2)

Raw data and findings of the numerical review of the 3D Cartesian cut-cell sphere case (`src/lab/core/sphere3d.ts`,
`runSphereCase`, unchanged) against the refined axisymmetric reference (`docs/axisymmetric-reference.md`). This is
**verification evidence** (solver against solver, solver against itself under refinement). It is not a validation, and
the axisymmetric value is a reference estimate, not ground truth.

`node scripts/sphere3d-analysis.mjs` recomputes every number in sections 3–6 from the files in this directory and in
`docs/axisym-data/`.

## 1. Configuration (identical in every run unless listed in the run table)

| item | value |
|---|---|
| flow | M∞ = 2, T∞ = 220 K, p∞ = 2500 Pa, γ = 1.4 (`gas.ts`, same as the axisymmetric case) |
| geometry | sphere R = 1 centred at the origin; quarter domain y ≥ 0, z ≥ 0 |
| domain | x ∈ [−2R − offset·h, …]: **base** 2R upstream / 1.5R downstream / 2.5R lateral (the `runSphereCase` default); **reduced** 2R / 0.5R / 2R (used for R/h ≥ 24 and all offset sweeps; justified in section 5) |
| grid | uniform cubes h = R/N; nx = round((up + down)·N), ny = nz = round(lat·N) |
| boundaries | xmin supersonic inflow, xmax / ymax / zmax extrapolation, ymin / zmin symmetry walls |
| body | conservative cut-cell wall with small-cell merging (α < 0.5), second-order wall state, stencil reflections (`wall: 'cutcell'`; *not* the library default `ghost`) |
| scheme | MUSCL-minmod, SSP-RK2, CFL 0.8, local time steps; 150 first-order steps, then second order |
| flux | Rusanov (default, baseline); HLLC (experimental option, separate experiment) |
| stop | residual in x < 0 dropped ≥ 4 orders **and** \|net mass flux\| < 10⁻³ of ρ∞V∞πR²/4 (maxSteps 20 000 here, 4000 in `runSphereCase` by default; no run came close) |
| measurement | stagnation line j = k = 0 (cell centres at y = z = h/2), distance from the true sphere surface on that line, x_nose = −√(R² − h²/2) |

Grid offset ("offset" in the table): the whole grid is shifted by offset·h in x (`gridOffset`), so the sphere surface
cuts the cells at a different place. It changes nothing else.

**Grid spacing compared with the axisymmetric solver.** Cartesian: h in all three directions everywhere; the shock and
the wall are cut obliquely by the grid away from the axis. Axisymmetric: radial spacing h along body-normal rays,
tangential spacing ≈ h at the wall, 1.36h at the shock on the axis, 5h at the outer boundary; the shock and the wall are
grid-aligned. Same R/h therefore means the same normal spacing at the nose, not the same number of cells (the
axisymmetric case needs 2D cells only: 1 728 cells at R/h = 16 against 40 960–89 600 here).

## 2. Files

- `s3d_<flux>_<wall>_Rh<N>_off<offset>[_<extra options>].csv` — one per configuration, written by
  `scripts/sphere3d-measure.test.ts`. Two comment lines, a `# meta {…}` line with the full run summary (the same JSON
  as in `summary.jsonl`), then columns `i,x,d,rho_over_rhoInf,phi,alpha`: cell index, centre x (R), d = x_nose − x
  (R), ρ/ρ∞, φ = (ρ − ρ∞)/(ρ₂ − ρ∞) with ρ₂/ρ∞ = 8/3, fluid fraction α. All cells of the stagnation line from the inflow
  to the last fluid cell (a merged sliver cell can appear as the last row, with α < 0.5).
- `summary.jsonl` — one JSON line per run, appended in run order (a repeated configuration appears twice; the
  analysis uses the last line). Fields: options, grid, steps, converged, dropFront, massImbalance, seconds, failure,
  bodyFluxFraction, boundaryFluxFraction, symmetryError (max \|ρ(i,j,k) − ρ(i,k,j)\|/ρ∞), upstreamDeviation,
  xNose, standoff {foot (10 %), mid (50 %), tail (90 %), maxGradient, equalArea}, shockWidthCells, nose (last
  stagnation-line cell: p/pitot, p0/pitot, Mach, α), noseP (wall stagnation pressure / pitot), noseT (stagnation
  temperature / T0), wall (front-wall p0 statistics and max \|T0 error\|), merge, hllcFallbacks.
- `axi-matched/axi_rusanov_Rh{12,24,48}.csv`, `axi-matched/summary.txt` — axisymmetric runs at the intermediate
  resolutions, made with the unchanged `scripts/axisym-measure.test.ts` and default `sphereAxi.ts` settings (same
  format as `docs/axisym-data/`). SHA-256 prefixes: Rh12 `47fda3c52f4debbb`, Rh24 `6f02c792f4d86d33`, Rh48
  `23778943de43e13e`.

Detectors: 10/50/90 % = first crossing of φ, linear between cell centres. Steepest rise = face of the largest density
rise among α = 1 cells, parabolic sub-cell correction (as in `sphere3d.ts`). Equal area (computed by the measurement
script from the profile, the same formula as the axisymmetric analysis): S = Σ clamp(φ, 0, 1) up to the first cell with
φ ≥ 1, x_EA = x_last + h/2 − h·S.

**Timings are not comparable across all runs.** Up to four runs shared the 4-core machine at a time (R/h 48, the offset
sweeps and the HLLC runs overlapped); the times are wall-clock per run.

## 3. Run table

Every run: no invalid state, no HLLC fallback, body mass flux exactly 0, no unmerged small cell, symmetry error ≤ 1e-6.
All runs converged by the criterion **except HLLC at R/h 24** (section 7), which reached the 20 000-step limit. A
further HLLC run at R/h 32 (reduced domain) was stopped by the 2-hour limit of the background job before it finished
and left no file.

| file | flux | R/h | offset | domain up/down/lat (R) | cells | steps | converged | drop | imbalance | time (s) | 50 % | steepest | equal area | width (cells) | nose p/pitot | nose p0/pitot | nose T/T0 | wall max \|T0 err\| | symmetry | SHA-256 (prefix) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| s3d_hllc_cutcell_Rh8_off0.csv | hllc | 8 | 0 | 2/1.5/2.5 | 11200 | 702 | yes | 4.82 | 9.9e-4 | 18 | 0.36288 | 0.36012 | 0.35339 | 1.16 | 0.9232 | 0.9438 | 0.9995 | 1.9 % | 3.7e-15 | 07032bf1e6b44a4e |
| s3d_rusanov_cutcell_Rh12_off0_downstream0.5_lateral2.csv | rusanov | 12 | 0 | 2/0.5/2 | 17280 | 798 | yes | 4.00 | 7.0e-4 | 20 ×2 | 0.37317 | 0.36051 | 0.38028 | 2.55 | 0.9500 | 0.9627 | 1.0121 | 2.9 % | 6.3e-12 | 3e7ea6659fe7fac6 |
| s3d_rusanov_cutcell_Rh12_off0.csv | rusanov | 12 | 0 | 2/1.5/2.5 | 37800 | 1083 | yes | 5.14 | 1.0e-3 | 70 | 0.37323 | 0.36058 | 0.38032 | 2.55 | 0.9500 | 0.9627 | 1.0121 | 2.9 % | 7.9e-10 | b2722c151d357888 |
| s3d_hllc_cutcell_Rh12_off0.csv | hllc | 12 | 0 | 2/1.5/2.5 | 37800 | 954 | yes | 4.00 | 3.7e-4 | 75 | 0.35596 | 0.34515 | 0.36151 | 1.48 | 0.9433 | 0.9595 | 1.0057 | 1.4 % | 3.4e-13 | 93c66c4d357cc760 |
| s3d_hllc_cutcell_Rh16_off0.csv | hllc | 16 | 0 | 2/1.5/2.5 | 89600 | 1194 | yes | 4.31 | 1.0e-3 | 248 | 0.36193 | 0.36481 | 0.35659 | 1.43 | 0.9630 | 0.9690 | 1.0057 | 1.6 % | 1.6e-14 | c3990452bd01f7ca |
| s3d_rusanov_cutcell_Rh12_off0_upstream3_downstream3_lateral4.csv | rusanov | 12 | 0 | 3/3/4 | 165888 | 2186 | yes | 6.66 | 1.0e-3 | 675 | 0.37323 | 0.36058 | 0.38033 | 2.55 | 0.9500 | 0.9627 | 1.0121 | 2.9 % | 8.9e-8 | bc34e17b0824b508 |
| s3d_rusanov_cutcell_Rh8_off0_downstream0.5_lateral2.csv | rusanov | 8 | 0 | 2/0.5/2 | 5120 | 564 | yes | 4.00 | 6.1e-4 | 4 | 0.36491 | 0.31071 | 0.37960 | 2.48 | 0.9273 | 0.9539 | 1.0141 | 3.3 % | 4.7e-15 | 0c0d206ffee9c057 |
| s3d_rusanov_cutcell_Rh16_off0_downstream0.5_lateral2.csv | rusanov | 16 | 0 | 2/0.5/2 | 40960 | 1060 | yes | 4.00 | 6.4e-4 | 67 | 0.36988 | 0.36389 | 0.37424 | 2.71 | 0.9654 | 0.9725 | 1.0123 | 3.0 % | 2.1e-9 | 1fb50fb4cf18f932 |
| s3d_rusanov_cutcell_Rh12_off0.25_downstream0.5_lateral2.csv | rusanov | 12 | 0.25 | 2/0.5/2 | 17280 | 794 | yes | 4.00 | 7.0e-4 | 20 | 0.37554 | 0.36332 | 0.38376 | 2.59 | 0.9273 | 0.9412 | 1.0101 | 2.4 % | 1.4e-12 | f1194761c8255262 |
| s3d_rusanov_cutcell_Rh12_off0.5_downstream0.5_lateral2.csv | rusanov | 12 | 0.5 | 2/0.5/2 | 17280 | 800 | yes | 4.00 | 6.5e-4 | 21 | 0.37274 | 0.36237 | 0.38011 | 2.63 | 0.9778 | 0.9819 | 1.0188 | 2.9 % | 4.0e-13 | 96fe13a30d5f72d0 |
| s3d_rusanov_cutcell_Rh12_off0.75_downstream0.5_lateral2.csv | rusanov | 12 | 0.75 | 2/0.5/2 | 17280 | 798 | yes | 4.00 | 6.6e-4 | 19 | 0.37214 | 0.35867 | 0.37888 | 2.61 | 0.9651 | 0.9727 | 1.0150 | 2.5 % | 4.1e-12 | fc928875dea0f870 |
| s3d_rusanov_cutcell_Rh16_off0.25_downstream0.5_lateral2.csv | rusanov | 16 | 0.25 | 2/0.5/2 | 40960 | 1049 | yes | 4.00 | 6.9e-4 | 61 | 0.36968 | 0.35929 | 0.37466 | 2.65 | 0.9484 | 0.9568 | 1.0085 | 2.6 % | 3.9e-10 | 6886534a52a98b87 |
| s3d_rusanov_cutcell_Rh24_off0_downstream0.5_lateral2.csv | rusanov | 24 | 0 | 2/0.5/2 | 138240 | 1546 | yes | 4.00 | 7.0e-4 | 345 | 0.36543 | 0.36294 | 0.36764 | 2.77 | 0.9815 | 0.9847 | 1.0087 | 2.3 % | 6.9e-9 | 4f499f709b499ba0 |
| s3d_rusanov_cutcell_Rh16_off0.5_downstream0.5_lateral2.csv | rusanov | 16 | 0.5 | 2/0.5/2 | 40960 | 1042 | yes | 4.00 | 7.0e-4 | 66 | 0.36808 | 0.36081 | 0.37343 | 2.68 | 0.9851 | 0.9873 | 1.0131 | 2.6 % | 8.8e-10 | d3f92b1a5786b11e |
| s3d_rusanov_cutcell_Rh16_off0.75_downstream0.5_lateral2.csv | rusanov | 16 | 0.75 | 2/0.5/2 | 40960 | 1049 | yes | 4.00 | 6.6e-4 | 64 | 0.36954 | 0.36293 | 0.37509 | 2.66 | 0.9759 | 0.9798 | 1.0126 | 2.8 % | 1.1e-9 | 50408dd608ce4717 |
| s3d_rusanov_cutcell_Rh8_off0.25_downstream0.5_lateral2.csv | rusanov | 8 | 0.25 | 2/0.5/2 | 5120 | 539 | yes | 4.00 | 7.4e-4 | 4 | 0.37249 | 0.32788 | 0.39104 | 2.44 | 0.8967 | 0.9273 | 1.0063 | 3.0 % | 4.6e-15 | 246e65f44e756372 |
| s3d_rusanov_cutcell_Rh8_off0.5_downstream0.5_lateral2.csv | rusanov | 8 | 0.5 | 2/0.5/2 | 5120 | 555 | yes | 4.00 | 6.4e-4 | 4 | 0.37185 | 0.34414 | 0.38506 | 2.43 | 0.9609 | 0.9695 | 1.0235 | 2.8 % | 6.0e-15 | 9ad4a093b351bb52 |
| s3d_rusanov_cutcell_Rh8_off0.75_downstream0.5_lateral2.csv | rusanov | 8 | 0.75 | 2/0.5/2 | 5120 | 553 | yes | 4.00 | 6.3e-4 | 5 | 0.37350 | 0.34303 | 0.38604 | 2.46 | 0.9449 | 0.9602 | 1.0211 | 3.8 % | 1.6e-14 | 6eae727f70249c92 |
| s3d_rusanov_cutcell_Rh24_off0.25_downstream0.5_lateral2.csv | rusanov | 24 | 0.25 | 2/0.5/2 | 138240 | 1542 | yes | 4.00 | 7.0e-4 | 332 | 0.36424 | 0.36040 | 0.36745 | 2.83 | 0.9708 | 0.9744 | 1.0062 | 2.1 % | 9.9e-9 | e560cbb2440e35e0 |
| s3d_rusanov_cutcell_Rh24_off0.5_downstream0.5_lateral2.csv | rusanov | 24 | 0.5 | 2/0.5/2 | 138240 | 1542 | yes | 4.00 | 6.9e-4 | 333 | 0.36441 | 0.36136 | 0.36735 | 2.79 | 0.9914 | 0.9924 | 1.0093 | 2.3 % | 3.1e-9 | 048253a009fdd8dd |
| s3d_rusanov_cutcell_Rh32_off0_downstream0.5_lateral2.csv | rusanov | 32 | 0 | 2/0.5/2 | 327680 | 2045 | yes | 4.00 | 6.9e-4 | 1079 | 0.36121 | 0.35839 | 0.36341 | 2.90 | 0.9876 | 0.9894 | 1.0058 | 2.2 % | 1.2e-8 | e631f07f07e5bf5a |
| s3d_rusanov_cutcell_Rh24_off0.75_downstream0.5_lateral2.csv | rusanov | 24 | 0.75 | 2/0.5/2 | 138240 | 1539 | yes | 4.00 | 6.8e-4 | 343 | 0.36536 | 0.36287 | 0.36775 | 2.77 | 0.9866 | 0.9882 | 1.0091 | 2.4 % | 3.2e-9 | 9be8cb9b42608d8d |
| s3d_hllc_cutcell_Rh12_off0_downstream0.5_lateral2.csv | hllc | 12 | 0 | 2/0.5/2 | 17280 | 953 | yes | 4.00 | 4.6e-5 | 35 | 0.35596 | 0.34515 | 0.36151 | 1.48 | 0.9433 | 0.9595 | 1.0057 | 1.4 % | 2.7e-13 | e477762d6c95718c |
| s3d_hllc_cutcell_Rh12_off0.25_downstream0.5_lateral2.csv | hllc | 12 | 0.25 | 2/0.5/2 | 17280 | 808 | yes | 4.00 | 4.6e-4 | 29 | 0.35658 | 0.35367 | 0.35590 | 0.79 | 0.9455 | 0.9575 | 1.0014 | 1.5 % | 3.5e-15 | ab39c005153dac04 |
| s3d_hllc_cutcell_Rh12_off0.5_downstream0.5_lateral2.csv | hllc | 12 | 0.5 | 2/0.5/2 | 17280 | 806 | yes | 4.00 | 4.9e-4 | 28 | 0.36377 | 0.36559 | 0.35696 | 1.30 | 0.9704 | 0.9736 | 1.0092 | 1.8 % | 3.2e-15 | fdbe6c1e25f8dff1 |
| s3d_hllc_cutcell_Rh12_off0.75_downstream0.5_lateral2.csv | hllc | 12 | 0.75 | 2/0.5/2 | 17280 | 820 | yes | 4.00 | 4.4e-4 | 27 | 0.36033 | 0.35588 | 0.35824 | 1.51 | 0.9536 | 0.9598 | 1.0069 | 1.6 % | 3.5e-15 | 7208507de1421214 |
| s3d_hllc_cutcell_Rh16_off0_downstream0.5_lateral2.csv | hllc | 16 | 0 | 2/0.5/2 | 40960 | 1082 | yes | 4.00 | 4.5e-4 | 90 | 0.36191 | 0.36479 | 0.35657 | 1.43 | 0.9630 | 0.9690 | 1.0057 | 1.6 % | 4.7e-15 | ad76de82bcd11155 |
| s3d_hllc_cutcell_Rh16_off0.25_downstream0.5_lateral2.csv | hllc | 16 | 0.25 | 2/0.5/2 | 40960 | 1105 | yes | 4.00 | 3.5e-4 | 98 | 0.35754 | 0.35152 | 0.35879 | 1.55 | 0.9451 | 0.9520 | 1.0014 | 1.6 % | 5.3e-15 | cddb395fcedecfd8 |
| s3d_hllc_cutcell_Rh16_off0.5_downstream0.5_lateral2.csv | hllc | 16 | 0.5 | 2/0.5/2 | 40960 | 1802 | yes | 4.00 | 2.3e-5 | 171 | 0.35699 | 0.35015 | 0.36114 | 1.44 | 0.9878 | 0.9968 | 1.0171 | 2.0 % | 1.3e-14 | e410e25069c4677f |
| s3d_hllc_cutcell_Rh16_off0.75_downstream0.5_lateral2.csv | hllc | 16 | 0.75 | 2/0.5/2 | 40960 | 1077 | yes | 4.00 | 4.5e-4 | 91 | 0.35717 | 0.35701 | 0.35458 | 0.88 | 0.9787 | 0.9821 | 1.0048 | 1.1 % | 4.4e-15 | 224cf064ed92f854 |
| s3d_rusanov_cutcell_Rh24_off0.csv | rusanov | 24 | 0 | 2/1.5/2.5 | 302400 | 1713 | yes | 4.29 | 1.0e-3 | 923 | 0.36547 | 0.36297 | 0.36767 | 2.77 | 0.9815 | 0.9847 | 1.0087 | 2.3 % | 4.9e-8 | 6528f8ecab7448eb |
| s3d_rusanov_cutcell_Rh48_off0_downstream0.5_lateral2.csv | rusanov | 48 | 0 | 2/0.5/2 | 1105920 | 3040 | yes | 4.00 | 6.9e-4 | 5319 | 0.35835 | 0.35770 | 0.35924 | 2.89 | 0.9920 | 0.9928 | 1.0037 | 1.9 % | 9.5e-7 | 6e4f580469640d38 |
| s3d_rusanov_cutcell_Rh32_off0.75_downstream0.5_lateral2.csv | rusanov | 32 | 0.75 | 2/0.5/2 | 327680 | 2042 | yes | 4.00 | 6.8e-4 | 1022 | 0.36238 | 0.36129 | 0.36378 | 2.82 | 0.9910 | 0.9919 | 1.0069 | 2.5 % | 1.7e-8 | eed0ba7ccaacf2d6 |
| s3d_rusanov_cutcell_Rh32_off0.5_downstream0.5_lateral2.csv | rusanov | 32 | 0.5 | 2/0.5/2 | 327680 | 2039 | yes | 4.00 | 6.9e-4 | 1029 | 0.36188 | 0.36047 | 0.36346 | 2.80 | 0.9935 | 0.9940 | 1.0071 | 2.2 % | 6.9e-9 | 2768ac9a0948b4c7 |
| s3d_rusanov_cutcell_Rh32_off0.25_downstream0.5_lateral2.csv | rusanov | 32 | 0.25 | 2/0.5/2 | 327680 | 2024 | yes | 4.00 | 7.1e-4 | 1036 | 0.36189 | 0.36027 | 0.36372 | 2.85 | 0.9798 | 0.9820 | 1.0048 | 2.2 % | 6.6e-9 | 5229f421bd046ea7 |
| s3d_hllc_cutcell_Rh24_off0_downstream0.5_lateral2.csv | hllc | 24 | 0 | 2/0.5/2 | 138240 | 20000 | **no** (step limit) | 3.44 | 2.8e-5 | 5085 | 0.35497 | 0.35311 | 0.35479 | 1.56 | 0.9744 | 0.9773 | 1.0028 | 1.4 % | 7.9e-15 | 78835c869221e06f |

## 4. Refinement (Rusanov, cut cell, reduced domain)

| R/h | cells | 50 % (offset 0) | 50 % (4-offset mean, range) | steepest rise (mean, range) | equal area (mean, range) |
|---|---|---|---|---|---|
| 8 | 5 120 | 0.36491 | 0.37069 (0.00860) | 0.33144 (0.03343) | 0.38543 (0.01144) |
| 12 | 17 280 | 0.37317 | 0.37340 (0.00340) | 0.36122 (0.00465) | 0.38076 (0.00488) |
| 16 | 40 960 | 0.36988 | 0.36929 (0.00180) | 0.36173 (0.00460) | 0.37436 (0.00167) |
| 24 | 138 240 | 0.36543 | 0.36486 (0.00119) | 0.36189 (0.00254) | 0.36755 (0.00041) |
| 32 | 327 680 | 0.36121 | 0.36184 (0.00116) | 0.36010 (0.00291) | 0.36360 (0.00037) |
| 48 | 1 105 920 | 0.35835 | — (offset 0 only: steepest 0.35770, equal area 0.35924) | | |

**Grid-alignment scatter.** Shifting the grid by a fraction of a cell moves the measured standoff by up to 0.0086 R
at R/h 8, 0.0034 at 12, 0.0018 at 16 and 0.0012 at 24 and 32 (50 %). The steepest-rise detector is the most sensitive
(0.003–0.033 R) and the equal-area detector the least at fine grids (0.0004 R at R/h 24 and 32). The archived R/h 8
value (0.3650) was the lowest of four alignments; the apparent non-monotone 8 → 12 → 16 sequence of the earlier work is
an alignment effect, not a grid trend: the 4-offset means are 0.3707, 0.3734, 0.3693.

**Convergence trend.** From R/h 12 onward the 50 % and equal-area standoffs decrease monotonically under refinement.
The decrease does **not** yet slow down the way an asymptotic series does: successive differences of the offset means
(50 %) are 0.0041 (12 → 16), 0.0044 (16 → 24), 0.0030 (24 → 32), and at offset 0 0.0029 (32 → 48). Observed orders
from the Celik iteration scatter between triplets (50 %: 0.1–2.2; equal area: 0.2–3.4, 1.04 for 24/32/48) and the
steepest-rise series is non-monotone. The finest triplet (24/32/48, offset 0) gives f_ext = 0.3563 (50 %, p = 2.16),
0.3513 (equal area, p = 1.04) and 0.3577 (steepest rise, p = 6.9, not credible). **No credible asymptotic range is
established, and no 3D extrapolated value is claimed.** The R/h 48 value is a single offset; its alignment scatter is
estimated (not measured) at ≲ 0.001 R from the trend of the coarser grids.

## 5. Checks

- **Iteration error.** Continuing past the stopping criterion by 3000 steps (residual drop 7.2–8.0 orders) moved the
  R/h 16 50 % standoff by 1e-5 R (Rusanov, 0.36992 → 0.36993) and 1e-5 R (HLLC, 0.36193 → 0.36194). The base (5.1
  orders) and enlarged (6.7 orders) R/h 12 domains stop at different drops and agree to 1e-5 R.
- **Domain.** R/h 12: base, reduced (0.5R downstream, 2R lateral) and enlarged (3R / 3R / 4R) domains give 50 % =
  0.37323 / 0.37317 / 0.37323 (all detectors within 1e-4 R). R/h 24: base 0.36547, reduced 0.36543.
- **Symmetry.** max \|ρ(i,j,k) − ρ(i,k,j)\|/ρ∞ ≤ 1e-6 in every run (it grows with the step count, from round-off level
  at R/h 8 to 1e-6 at R/h 48).
- **Mass.** Body mass flux exactly 0 (cut-cell wall faces are closed); net boundary mass flux at the stop 2e-5 – 1e-3
  of the intercepted flux (the stopping tolerance).
- **Upstream state.** Max deviation from the freestream more than five cells ahead of the shock: ≤ 1.1e-3 for Rusanov
  (the smeared shock foot; equal in the enlarged domain), ≤ 2e-16 for HLLC.
- **Reproducibility.** The R/h 12 reduced-domain case was run twice: identical steps and detector values. The R/h 8
  base-domain profile matches the archived `docs/axisym-data/3d/prof_rusanov_8_0.txt` to print precision.
- **Nose state.** The wall stagnation pressure depends strongly on how the sphere cuts the nose cell (R/h 12: p/pitot
  0.927–0.978 over the four offsets); it rises towards 1 under refinement (R/h 48: 0.992), and stays below pitot in
  every run (max 0.994, HLLC 0.997). Temperature: nose-cell T/T0 = 1.014, 1.012, 1.012, 1.009, 1.006, 1.004 and
  front-wall max \|T0 error\| 3.3, 2.9, 3.0, 2.3, 2.2, 1.9 % at R/h 8, 12, 16, 24, 32, 48 (Rusanov, offset 0) — a
  total-enthalpy error that decreases under refinement and is 1.2–1.8× the axisymmetric solver's at the same R/h
  (2.8 % at R/h 8, 1.7 % at 16, 1.4 % at 32).

## 6. Comparison with the axisymmetric reference

Same detector code applied to both solvers' profiles (the code reproduces the audited axisymmetric values exactly).
Gap = 3D − axisymmetric at the same R/h (3D: 4-offset mean where available, offset 0 otherwise).

| R/h | axi 50 % | 3D 50 % | gap | gap·N | axi equal area | 3D equal area | gap |
|---|---|---|---|---|---|---|---|
| 12 | 0.36373 | 0.37340 | 0.0097 | 0.116 | 0.37143 | 0.38076 | 0.0093 |
| 16 | 0.36265 | 0.36929 | 0.0066 | 0.106 | 0.36711 | 0.37436 | 0.0073 |
| 24 | 0.35818 | 0.36486 | 0.0067 | 0.160 | 0.36121 | 0.36755 | 0.0063 |
| 32 | 0.35668 | 0.36184 | 0.0052 | 0.165 | 0.35899 | 0.36360 | 0.0046 |
| 48 | 0.35500 | 0.35835 (offset 0) | 0.0034 | 0.161 | 0.35588 | 0.35924 (offset 0) | 0.0034 |

**Measured:** at every resolution from R/h 12 to 48 the 3D shock lies upstream of the axisymmetric one; the gap falls
from about 0.009 R to 0.0034 R, roughly in proportion to h (0.11–0.17 of a cell). The stagnation-line profiles at R/h
8 and 16 have the same shape (the same 2.4–2.7-cell shock width, the same post-shock rise); the 3D shock is displaced
upstream by about 0.1 cell. Relative to the axisymmetric best estimate 0.349–0.351 R, the finest 3D value is
0.007–0.009 R (50 %) above it, and above the engineering envelope 0.347–0.355 R.

**Not established:** whether the gap vanishes in the limit. A descriptive least-squares fit gap = a + b·h over R/h
12–48 gives a = 0.0021 ± 0.0009 R (50 %) and 0.0018 ± 0.0005 R (equal area) (1σ); this depends on the assumed linear
form, and both solvers are themselves pre-asymptotic or barely asymptotic, so it is not evidence of a residual
difference either.

**Hypotheses for the gap (none tested to a conclusion):** (a) different discretisation error of the same limit: the
Cartesian grid cuts the shock and the wall obliquely away from the axis, which adds numerical dissipation to the
Rusanov flux in the shock layer, and the cut-cell wall is a planar facet per cell; the gap shrinking ∝ h is consistent
with this. (b) The HLLC result points the same way: at R/h 16 the 3D HLLC offset mean (0.3584) equals the axisymmetric
HLLC value (0.3586) to within the HLLC alignment scatter, while the Rusanov gap at the same R/h is 0.0066 — the gap is
flux-dependent, i.e. a dissipation effect, not a geometry or boundary-condition offset. (c) Boundary conditions and
domain: excluded at the 1e-4 R level (section 5). (d) The measurement line: the 3D line is h/√2 off the axis, the
axisymmetric ray Δθ/2; both offsets bias the standoff by O(h²) (≈ 5e-4 R at R/h 16, 1e-4 at 32), an order of magnitude
below the gap.

## 7. HLLC (experimental flux, not the default)

Same set-up with `flux: 'hllc'` (Einfeldt wave speeds, Rusanov fallback for invalid states, never triggered here).
Neither tuned nor promoted; the default stays Rusanov.

| R/h | runs | converged | steps | 50 % (mean, range over offsets) | equal area (mean, range) | width (cells) | nose p0/pitot |
|---|---|---|---|---|---|---|---|
| 8 | offset 0 (base domain) | yes | 702 | 0.36288 | 0.35339 | 1.16 | 0.944 |
| 12 | 4 offsets | all | 806–953 | 0.35916 (0.00781) | 0.35816 (0.00561) | 0.79–1.51 | 0.958–0.974 |
| 16 | 4 offsets | all | 1077–1802 | 0.35840 (0.00492) | 0.35777 (0.00656) | 0.88–1.55 | 0.952–0.997 |
| 24 | offset 0 | **no**: 20 000 steps, residual drop 3.44 | — | 0.35497 (at the step limit) | 0.35479 | 1.56 | 0.977 |
| 32 | offset 0 | not finished (job stopped at 2 h, no data) | | | | | |

**Measured.**
- R/h ≤ 16 converges; continuing the R/h 16 base-domain run 3000 steps past the criterion reaches an 8.0-order drop
  with the standoff fixed to 1e-5 R (scratch diagnostic, base domain).
- **R/h 24 does not converge**: the residual drop reaches 3.35 by step 1500 and stays at 3.4 ± 0.05 up to step 20 000.
  Over steps 1500–6000 (scratch diagnostic, the same set-up) the 50 % standoff drifts within 0.35484–0.35502; it is
  0.35497 at step 20 000. Mass balance (2.8e-5), symmetry (8e-15), zero fallbacks and the nose state (p0/pitot 0.977,
  T/T0 1.003) stay clean.
- The 50 % shock position on the first eight grid lines next to the axis at R/h 24 (after 6000 steps) is monotone with
  second differences of one sign (5e-4 – 2.8e-3 R), as for Rusanov (6e-4 – 1.4e-3 R); the HLLC shock is flatter next to
  the axis (difference between the first two lines 8e-5 R against 7.7e-4 R). The nose cell's lateral velocity is
  v = w = +10.2 m/s (away from the axis), as with Rusanov (+10.1 m/s).
- At R/h 16 one second difference of the HLLC shock line is negative (−2.4e-3 R at the third line); the HLLC
  alignment scatter at that resolution is 0.005 R, so this is within the sub-cell measurement noise of a 1–1.5-cell
  shock and is not evidence of a flow feature.
- The stagnation-line profiles are monotone through the shock for both fluxes; at R/h 24 the HLLC shock has a single
  intermediate cell.
- Grid-alignment scatter is 2–3× Rusanov's (0.0078 / 0.0049 R at R/h 12 / 16, against 0.0034 / 0.0018), so the
  offset-0 HLLC sequence 0.3629 / 0.3560 / 0.3619 (R/h 8 / 12 / 16) is dominated by alignment, not refinement.

**Against the axisymmetric HLLC symptoms.**

| axisymmetric symptom | 3D Cartesian |
|---|---|
| non-physical nose state at R/h 12 (p0/pitot 1.052) | not seen: p0/pitot ≤ 0.997 in every 3D HLLC run, including R/h 12 at four offsets |
| non-convergence at R/h 32 (residual stalls at ≈ 3.2 orders, standoff wanders 0.3480–0.3503) | **seen at R/h 24** (stalls at 3.4 orders, standoff drift 2e-4 R); R/h 32 not obtained |
| non-monotone shock next to the axis, nose velocity towards the axis (−13 m/s) | not seen at R/h 24: monotone shock, outward nose velocity |

**Interpretation (not established).** The shared symptom is a residual stall on the finer grids with the sharp HLLC
shock that does not occur with Rusanov. The 3D solver has no axis singularity and no polar grid, so the stall is not
explained by the axisymmetric axis treatment alone; a flux-level cause (the low dissipation of HLLC at a strong,
locally grid-aligned shock, possibly interacting with the minmod limiter at a one-cell shock) is consistent with both,
but where the 3D residual is generated was not located. The 3D standoff values of HLLC at R/h 24 are therefore not
used as results.

## 8. Unknowns and the next experiment

- No asymptotic range for the 3D series; the extrapolated 3D standoff and its uncertainty are unknown. A 3D R/h 64
  run (≈ 2.6 M cells in the reduced domain, an estimated 4–6 h on one core) and alignment sweeps at R/h 48 would be the
  next refinement step; they were not run (cost).
- Whether the 3D–axisymmetric gap tends to zero. The most direct test is to remove the difference in dissipation
  rather than refine further: run both solvers with the same less dissipative flux on grids where it is stable, or
  run the axisymmetric solver with its tangential spacing coarsened (its own sensitivity: 2h tangential spacing moves
  the R/h 32 standoff by +0.005 R, the same sign and size as the gap).
- HLLC in 3D: where the R/h 24 residual stall is generated (a residual map over the domain; the shock near the axis,
  the shock where it crosses grid diagonals, and the cut-cell wall are the candidates), whether R/h 32 also stalls
  (needs a job longer than 2 h), and whether its alignment scatter (0.005–0.008 R) shrinks under refinement.

## Reproduction

```
cd euv-simulator
# one configuration (RH may be a list); OFF = grid offset in cells; EXTRA = further runSphereCase options as JSON
RH=24 FLUX=rusanov OFF=0.25 EXTRA='{"downstream":0.5,"lateral":2}' OUT=docs/sphere3d-refinement \
  npx vitest run --root . --config /dev/null --testTimeout 14400000 scripts/sphere3d-measure.test.ts
# axisymmetric runs at matched resolution
RH=12,24,48 FLUX=rusanov OUT=docs/sphere3d-refinement/axi-matched \
  npx vitest run --root . --config /dev/null --testTimeout 14400000 scripts/axisym-measure.test.ts
# all tables in this file
node scripts/sphere3d-analysis.mjs
```

Note `--testTimeout`: with `--config /dev/null` vitest's default 5 s limit applies and a long run is reported as
failed (its files are still written).

---

## Addendum (2026-10-18): gap study

`docs/sphere-gap-study/` investigated the 3D–axisymmetric difference of section 6 with cells of separate length along
(hx) and across (hy = hz) the flow. The 3D standoff error is dominated by hx (∂f/∂hx ≈ +0.45 R per unit h/R, 50 %),
and refining the lateral spacing *raises* the standoff (∂f/∂hyz ≈ −0.14); the matched-R/h gap is mostly a difference
in discretisation error, and the extrapolated limits of the two solvers differ by ≤ 0.0025 R, within the model-form
uncertainty of either extrapolation. Hypothesis (a) of section 6 is supported as far as the gap being a resolution
effect goes; "the same limit" is not established, and the specific reading "the Cartesian grid is effectively coarse
tangentially" is not supported. Hypothesis (b) (a
flux-dependent dissipation effect) remains plausible but untested. Converging to 6 orders changes the R/h 24 value by
+6e-5 R. See that directory's README for the data, the remaining uncertainty and the next experiment.

## Addendum 2 (2026-10-18): isotropic R/h 64

`docs/sphere3d-rh64/` adds the isotropic R/h 64 case (160 × 128 × 128 cells, same set-up, offset 0), run in three
checkpointed segments and converged by the same criterion at step 4 042: standoff 0.35680 (50 %), 0.35672 (steepest
rise), 0.35723 R (equal area). With it the equal-area series R/h 24–64 shows a consistent observed order (p 1.04–1.12
in all overlapping triplets; extrapolation ≈ 0.3513–0.3519 R), which section 4 above could not yet establish; the
50 % detector remains noisier. The R/h 64 value is still 0.006 R above the axisymmetric band (0.3485–0.3508 R).
