# 3D Mach 2 sphere: precomputed browser dataset, version 1 (milestone M0)

Precomputed results of the 3D Cartesian cut-cell Euler solver for the planned Engineering section of the app, with
the comparison data it needs. Nothing here is used by the application yet. Every value is either **computed** by the
archived solver runs, **copied** from their archives, or **quoted** with its source; nothing is synthetic.

**Model:** steady inviscid compressible flow (Euler equations), calorically perfect air, around a sphere at Mach 2
(T∞ 220 K, p∞ 2500 Pa). These are verified numerical solutions of that model, **not** validated predictions of real
flow. The Billig value is an empirical correlation used as a comparison reference, not experimental validation; the
axisymmetric reference band lies about 8–9 % above it and the cause is not established.

## Files

| file | content | size | gzip |
|---|---|---|---|
| `manifest.json` | provenance, field definitions, grid and extraction metadata, convergence evidence, quantization errors, every file's SHA-256 | 22.0 kB | — |
| `results.json` | refinement runs, grid-position statistics, extrapolations, axisymmetric runs and reference band, Billig correlation, model statement | 20.8 kB | 6.2 kB |
| `profiles.json` | 15 stagnation-line density profiles (3D R/h 16–64, all four R/h 48 grid positions; axisymmetric R/h 16–256), rows within 0.6 R of the wall, copied exactly from the archives | 13.8 kB | 5.1 kB |
| `plane-rh48-off0.5.u8.bin` | browser plane, R/h 48 grid offset 0.5: ρ, p, Mach, u, v, fluid fraction, 8 bit | 69.1 kB | 15.3 kB |
| `plane-rh64-off0.u8.bin` | browser plane, R/h 64 grid offset 0, same fields | 122.9 kB | 21.3 kB |
| `plane-rh48-off0.25.f64.bin`, `-off0.5`, `-off0.75` | full-precision planes (float64): ρ, u, v, w, p, fluid fraction | 553.0 kB each | ≈ 246 kB each |
| `plane-rh64-off0.f64.bin` | full-precision plane, R/h 64 | 983.0 kB | 394 kB |

**Browser-facing:** `results.json` + `profiles.json` + the R/h 48 browser plane = **26.6 kB gzip** (the initial load);
the R/h 64 browser plane is a separate 21.3 kB load. Embedded as base64 in the single-file build, the planes cost
about 20–30 % more (R/h 48: 18.4 kB). The float64 planes are the preserved source precision for verification and
later re-quantization; they are not meant for the browser.

## Planes

- **Sources:** converged states of the reference configuration (reduced quarter domain 2R / 0.5R / 2R, Rusanov,
  MUSCL-minmod, SSP-RK2, CFL 0.8, cut cells with merging). Each checkpoint (R/h 48 at step 3 000; R/h 64 at step
  4 000) was continued with the driver's own loop to the step at which its archived run met the stopping rule
  (residual in x < 0 down 4 orders and |net mass flux| < 1e-3 of the intercepted flux): R/h 48 offsets 0.25 / 0.5 /
  0.75 at steps 3 015 / 3 018 / 3 020, R/h 64 at step 4 042. The advanced states reproduce the archived runs **bit
  for bit** in step, residual drop, mass imbalance, symmetry error (a whole-field check), nose position and all five
  detectors; the export refuses to continue otherwise.
- **Extraction:** the cell layer k = 0 (centres at z = h/2), next to the z = 0 symmetry plane. Cell (i, j) has its
  centre at x = x0 + (i + ½) h, y = (j + ½) h with h = R/N and x0 = −2R − offset·h; the sphere (radius R = 1) is centred at
  the origin and the flow runs in +x. Arrays are indexed j·nx + i (nx = 2.5 N along x, ny = 2 N along y). Row j = 0 is
  the stagnation line used for every standoff in the archives.
- **Fields** (nondimensional by the freestream values in `results.json`): ρ/ρ∞, u/V∞, v/V∞, w/V∞, p/p∞, fluid volume
  fraction α (0 = inside the sphere, 1 = full fluid cell, between = cut cell). Solid cells hold 0 in every field.
  Mach = |V|/a with a = √(γp/ρ), computed from the full-precision state.
- **Float64 layout:** six little-endian Float64 arrays in the order ρ, u, v, w, p, α, each nx·ny values.
- **8-bit layout:** six Uint8 arrays in the order ρ, p, Mach, u, v, α. For fluid cells value = lo + code·(hi − lo)/255
  with lo, hi per field in `manifest.json`; α code = max(1, round(255 α)) for α > 0, 0 for solid cells.

## Measured errors

| quantity | maximum error |
|---|---|
| float64 plane vs solver cells | 0 (copied; checked cell by cell for R/h 48 offset 0.5; every plane byte-identical on re-export) |
| plane stagnation row vs archived profile CSV (6 decimals) | ≤ 5e-7 |
| standoffs recomputed from the exported plane vs archive | < 1e-12 (round-off of the normalization) |
| mirror check, k = 0 layer vs j = 0 layer | ≤ 1.11e-10 (all fields), within the archived symmetry error |
| 8-bit plane, R/h 48 (R/h 64) | ρ 5.7e-3 (5.7e-3), p 1.07e-2 (1.08e-2), Mach 5.5e-3 (5.7e-3), u 2.1e-3 (2.1e-3), v 1.7e-3 (1.8e-3), α 2.0e-3 (1.8e-3) — ρ, p, Mach, u, v at 0.9996–1.0000 of half a quantization step; α within its encoding bound 1/255 (0.94–1.00 of half a step) |

The 8-bit planes are for colour maps and shapes, not for numerical readouts: readouts should use `profiles.json`,
`results.json` or the float64 planes. A 16-bit version would reduce the errors to ≈ 2e-5–4e-5 at 50 kB (R/h 48) and
86 kB (R/h 64) gzip; it was not produced.

## Not exported

- **Fields of R/h 48 at grid offset 0:** no checkpoint exists (that run predates checkpoint support). Its profile and
  results are included.
- No coarser 3D planes (no converged checkpoints of the reference configuration below R/h 48 exist) and no
  axisymmetric fields (that solver was never checkpointed; it is cheap enough to run live).

## Reproduce and verify

```
cd euv-simulator
# export (needs the checkpoints: <dir>/rh48-offsets/off{0.25,0.5,0.75}/rh48.ckpt and <dir>/rh64-run/rh64.ckpt)
CKPT_DIR=<dir> OUT=<new empty directory> npx vitest run --root . --config /dev/null --testTimeout 3600000 scripts/export-sphere3d-dataset.test.ts
# checkpoint-dependent verification: fresh export byte-identical to this directory; raw solver cells vs plane
CKPT_DIR=<dir> npx vitest run --root . --config /dev/null --testTimeout 3600000 scripts/verify-sphere3d-dataset.test.ts
# checkpoint-independent checks against the archives (part of npm test)
npx vitest run tests/lab/sphere3d-dataset.test.ts
```

Two independent exports were byte-identical, and the checkpoint-dependent verification reproduced every file. The
checkpoints are outside the repository in temporary storage (paths and SHA-256 in `manifest.json`); once they are
gone, the export cannot be repeated without rerunning the solver (R/h 48: ≈ 70 min per offset, R/h 64: ≈ 3.75 h), but
the checkpoint-independent tests keep checking this dataset against the archives.
