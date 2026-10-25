# Checkpoint/restart for the 3D sphere case: implementation and validation

Design and audit: `DESIGN.md` (written before the code). Status: **implemented, optional and off by default**;
validated on small cases only. No long refinement run was started.

## What was changed

| file | change |
|---|---|
| `src/lab/core/euler3d.ts` | additive only (89 lines, none removed): `SOLVER3D_STATE_REVISION`, `Solver3DState`, `exportState()`, `importState()` (validates revision, array count and lengths, finite values, ρ > 0 and p > 0 at every fluid cell), `geometryFingerprint()` |
| `src/lab/core/sphere3d.ts` | optional `checkpoint` option (`every`, `write`, `resume`, `stopAtStep`, `stopWhen`) and, only when it is given, the result fields `resumedFromStep`, `interrupted`, `checkpointsWritten`, `lineage`. Two existing lines changed: the loop starts at `start` (0 for a fresh run) and the reported time adds the time of earlier segments (0 for a fresh run) |
| `src/lab/core/checkpoint3d.ts` (new) | binary format v1: encode, decode with validation, configuration comparison |
| `src/lab/core/crc32.ts` (new) | CRC-32 |
| `scripts/checkpoint3d-file.ts` (new, Node only) | atomic write (temporary file, fsync, rename, directory fsync) and read |
| `scripts/sphere3d-resumable.test.ts` (new, not in `npm test`) | resumable run harness with a wall-clock budget |
| `tests/lab/checkpoint3d.test.ts` (new) | 29 tests |

None of these modules is imported by the application, so the ASML UI bundle is unchanged (`index-DWf5Fgmd.js`).
The default flux, the 2D solver and all data archives are untouched.

## State saved and restored

Solver: the five conservative arrays over the padded grid ((nx+4)(ny+4)(nz+4) values each, ghost entries included),
the reconstruction order, the step count, time, last time step, and the cumulative HLLC fallback and call counters.
Driver: the residual references (`refFront`, `refAll`, the maxima over the first five steps), the last residual drops
and mass imbalance, the residual history, the elapsed time of earlier segments and the segment lineage.
Configuration and geometry: every trajectory- or stopping-relevant option (defaults resolved), the grid, γ, time
mode, boundary types, freestream, the solver revision and a CRC-32 fingerprint of the solid mask, the cut-cell volume
fractions and the merge membership; all are compared on resume, and any difference is refused with the list of
differing fields (`maxSteps` may be raised).

Not saved, because each step rebuilds it before reading it: primitives, stencil copies, `U0`, `Ubackup`, residuals,
local time steps, per-step counters and flux balances. Static geometry is rebuilt by the constructor and checked
through the fingerprint.

## Validation

All in `tests/lab/checkpoint3d.test.ts` (R/h 6 cut-cell case, reduced domain, 2 160 cells, converges in 460 steps;
R/h 8 for the archive check):

| requirement | test | result |
|---|---|---|
| fresh uninterrupted run | reference run, plus "enabling checkpoints leaves the run unchanged" (every 50 steps) | every result field identical (numbers compared with `Object.is`) |
| interrupted and resumed | stops after steps 3 (inside the 5-step residual-reference window), 100 (first order), 150 (the step after which the order switches), 151, 300; a 3-segment run (60, 200, end); a `stopWhen` split at 77 | **bit-identical** to the uninterrupted run in every field: conservative-state-derived results, residual history, steps, convergence decision, all detectors, profile, wall data |
| conservative state, residuals, shock measurement at a fixed step | step 250 reached directly vs via a resume at 120 | the five conservative arrays and the residual history byte-identical; solver counters and driver values identical; all measurements identical |
| other configurations | HLLC flux and ghost-cell wall resumed after the order switch; solver-level resume of a global-time-step run | bit-identical (HLLC counters included; `time` identical) |
| corrupted / truncated checkpoints | flipped payload byte, flipped header byte, truncation by 1 byte, by half, to 20 bytes, empty file, one appended byte, a truncated file ending in a copied trailer, bad magic | all refused with an error (CRC mismatch / truncated / end marker / magic); `runSphereCase` throws instead of starting afresh |
| incompatible settings | R/h, CFL, flux, wall treatment, grid offset, Mach number, domain size, stopping drop, start-up length; `maxSteps` below the checkpointed step | refused, the error names the differing fields (e.g. `config.radiusCells … grid.nx …`); raising `maxSteps` is allowed and gives the identical result |
| version handling | format version 2, unknown schema, missing driver field, inconsistent step count, inconsistent array table, solver revision + 1 | refused with a specific message |
| invalid values | NaN in a conservative array; negative density at a fluid cell; state for a different grid size | refused (`non-finite`, `non-physical state at fluid cell (0, 5, 5)`, `entries, expected …`) |
| last valid checkpoint survives a failed write | simulated crash after a partial write and before the rename | the previous checkpoint still loads and resumes exactly; the partial `.tmp` is left and never read; a later successful write replaces the file atomically |
| checkpointing disabled unchanged | plain R/h 8 run against the archived `docs/sphere3d-refinement/s3d_rusanov_cutcell_Rh8_off0_downstream0.5_lateral2.csv` | 564 steps, every profile row identical |

**Numerical differences between resumed and uninterrupted runs: none** — zero in every compared value and byte for
byte in the conservative arrays, in every tested configuration.

Harness smoke test (scratch directory, not archived): R/h 8 run stopped at step 200 (2 checkpoints), resumed with
`RESUME=1`, converged at step 564; the written profile is row-identical to the archived uninterrupted run. The
harness refused a fresh start over an existing checkpoint and an output directory inside the archives.

Cost (measured): checkpoint size 2.3 MB (R/h 16) and 15.5 MB (R/h 32), write 12 / 80 ms, read + validation 18 /
252 ms. Projected for the reduced-domain R/h 64 case: ≈ 115 MB, ≈ 1 s to write and ≈ 2 s to read and validate;
every 500 steps that is negligible against ≈ 4 h of computing.

## Using it for the R/h 64 run (not started)

```
cd euv-simulator
H="npx vitest run --root . --config /dev/null --testTimeout 14400000 scripts/sphere3d-resumable.test.ts"
RH=64 EXTRA='{"downstream":0.5,"lateral":2}' CKPT=<dir>/rh64.ckpt EVERY=500 BUDGET_MIN=100 OUT=<new output dir> $H
RH=64 EXTRA='{"downstream":0.5,"lateral":2}' CKPT=<dir>/rh64.ckpt EVERY=500 BUDGET_MIN=100 OUT=<new output dir> RESUME=1 $H   # repeat
```

Each invocation stops after ≈ 100 min with a checkpoint (`<CKPT>.status.json`: interrupted / converged / maxSteps /
failed); the next one continues. At the estimated ≈ 4 h the run needs about three invocations. A job killed before
its budget loses at most the steps since the last checkpoint (≤ 500).

## Remaining failure modes and limits

- `SOLVER3D_STATE_REVISION` must be bumped by hand when a change alters the numerical trajectory; the geometry
  fingerprint catches geometry changes, and the bit-for-bit tests catch trajectory changes in the tested
  configurations, but a numerics change without a bump could let an old checkpoint continue under new numerics.
- The fingerprint uses the in-memory byte order of the volume fractions (little-endian on all current platforms);
  checkpoints moved to a big-endian machine would be refused, not misread.
- Bit-for-bit reproducibility assumes the same JavaScript engine arithmetic (IEEE double, no fused operations
  changing between processes); within one Node version this holds, and the tests run resumed segments in the same
  process as well as through files (harness smoke test, separate processes).
- Disk: each checkpoint needs its size twice during the write (temporary file plus the previous file). A full disk
  makes the write fail (the previous checkpoint survives) and the run stops with that error.
- A checkpoint written before convergence plus a raised `residualDrop` is refused (stopping criteria are part of the
  configuration); extending a converged run to a deeper criterion requires a new run.
- Only `runSphereCase` (and direct solver use via `exportState`/`importState`) is covered; the gap-study harness
  with separate x and lateral spacing is not resumable.
- Memory: checkpointing adds two transient copies of the state while writing (the exported arrays and the encoded
  bytes, ≈ 230 MB for R/h 64) on top of the solver's ≈ 0.6 GB; reading adds the file and the decoded arrays.
- The resumable harness's `stopWhen` budget is checked between steps; one step of the R/h 64 case takes ≈ 4 s, so
  the overshoot is negligible.
