# Checkpoint/restart for the 3D Euler sphere case: design

Written before any code change. Scope: the 3D Cartesian solver (`src/lab/core/euler3d.ts`, `EulerSolver3D`) and the
sphere-case driver (`src/lab/core/sphere3d.ts`, `runSphereCase`). Goal: a run interrupted at step n and resumed
continues **bit for bit** as the uninterrupted run would have, so long runs can be split into segments shorter than
the 2 h job limit. Neither module is imported by the application bundle (checked: only the lab's own modules and
tests use them), so the ASML UI cannot change.

## 1. Audit: what determines the next step

`EulerSolver3D.step()` (SSP-RK2, local or global time steps):

1. copies `U` to `Ubackup` (only read by `abort()` within the same step);
2. `toPrimitive(0)`: ρ, u, v, w, p of every fluid interior cell **from `U`**;
3. `fillGhosts()`: domain ghost layers from the interior primitives and the boundary types; immersed-body ghost
   cells interpolated from **fluid** cells only (`buildSphere` skips solid sources), and, with cut cells, the stencil
   arrays `sr/sq/sp` are first overwritten with a full copy of the primitives, then patched;
4. `computeDt()`: `dtCell` for every fluid cell from the primitives (and the static cut-cell geometry);
5. `computeResidual()`: `res` zeroed then accumulated; body and boundary mass fluxes recomputed;
6. `U0 ← U`, two RK stages writing `U` at the interior fluid cells (merged groups from their members).

So the state carried from one step to the next is **only `U`** plus scalars, and everything else is either
recomputed before it is read within the step or is static geometry built in the constructor from
(grid, sphere, bc, options). There is no random state; iteration order is fixed.

Carried state of the solver:

| item | role | saved |
|---|---|---|
| `U[0..4]` (padded arrays, (nx+4)(ny+4)(nz+4) each) | conservative variables. Ghost entries of `U` are never written (zero); solid cells keep their initial values | yes, the full padded arrays (exactness without relying on which entries are read) |
| `opts.order` | 1 during start-up, 2 after `setOrder(2)` | yes |
| `steps`, `time`, `lastDt` | counters (`time` only advances in global mode) | yes |
| `hllcFallbacksTotal`, `hllcCalls` | cumulative diagnostics reported by the driver | yes |
| `failure` | a failed solver refuses to step; checkpoints are only written after successful steps | no (must be null) |
| `U0`, `Ubackup`, `r`, `q`, `p`, `sr/sq/sp`, `res`, `dtCell`, `fallbacks`, `hllcFallbacks`, `bodyMassFlux`, `boundaryMassFlux`, private flux accumulators | rebuilt within each step before being read | no |
| `solid`, `alpha`, `beta`, wall faces, merge groups, ghost stencils, residual region | static, rebuilt by the constructor from the configuration | no, but a fingerprint of the geometry (fluid-cell count and a CRC-32 of the solid mask, the volume fractions and the merge membership) is stored and compared |

Carried state of the driver (`runSphereCase` loop):

| item | role |
|---|---|
| loop index n (= `solver.steps`) | `setOrder(2)` at n = startup; the convergence test needs n > startup + 20 |
| `refFront`, `refAll` | max residual over the first 5 steps, the reference of the residual drop |
| `history` | residual per step (returned to callers) |
| `dropFront`, `dropAll`, `imbalance` | last values (recomputed every step; saved for an interrupted-run report) |
| elapsed wall time | reporting only, never affects the trajectory |

**Conclusion: saving only the conservative variables would not be sufficient** (the order switch, the residual
reference and the step count change the trajectory or the stopping decision), but the complete carried state is
small and explicit, so a faithful restart needs no solver rewrite.

## 2. Checkpoint format (version 1)

One binary file, little-endian, written and read with `DataView` (no dependencies):

```
offset  size      field
0       8         magic "E3DCKPT1"
8       4         format version (uint32) = 1
12      4         header length H (uint32)
16      H         header: UTF-8 JSON (schema below)
16+H    8·L       payload: float64 arrays in header order (U0…U4, history)
…       4         CRC-32 (IEEE) of bytes [0, 16+H+8·L)
…       8         end marker "E3DCKEND"
```

Header (`schema: "euler3d-sphere-checkpoint"`, `version: 1`):
- `solverRevision`: an integer constant exported by `euler3d.ts`, to be bumped whenever a change alters the
  numerical trajectory; a mismatch refuses the resume;
- `config`: every driver option that affects the trajectory or the stopping test (mach, radiusCells, upstream,
  downstream, lateral, gridOffset, cfl, wall, reconstruction, merge, flux, Tinf, pinf, startupSteps, residualDrop,
  massBalanceTol) with defaults resolved; `maxSteps` is recorded but may be raised on resume (it only limits the run);
- `grid` (nx, ny, nz, x0, y0, z0, dx, dy, dz), `gamma`, `timeMode`, `bc`, `freestream`;
- `geometry`: fluid-cell count and CRC-32 fingerprint (see above);
- `solver`: steps, time, lastDt, order, hllcFallbacksTotal, hllcCalls;
- `driver`: refFront, refAll, dropFront, dropAll, imbalance, elapsedMs;
- `lineage`: list of segments `{fromStep, toStep}`, so a resumed run is visible as such;
- `arrays`: `[{name, length}]` in payload order.

JSON numbers round-trip doubles exactly. The format is deterministic apart from `elapsedMs`.

## 3. Validation on load (any failure throws; nothing falls back to a fresh run)

1. File length ≥ fixed parts; magic present; version supported (only 1); header length within the file; end marker
   at the end of the file and CRC-32 over everything before the CRC field correct — all **before** the header is
   interpreted, so corruption is reported as corruption; then the total length must equal 16 + H + 8·L + 12 from the
   array table (detects truncation and appended bytes that happen to keep a valid trailer).
2. Header parses, schema name and version match, all required fields present with the right types; array lengths
   are non-negative integers and sum to L.
3. Compatibility with the requested run: `solverRevision` equal; every `config` field equal to the requested value
   (exact numeric equality; `maxSteps` excepted); grid, gamma, timeMode, bc and freestream equal to those the driver
   derives; after constructing the solver, its geometry fingerprint equal to the stored one. The error lists every
   mismatching field.
4. Arrays: five `U` arrays of exactly the solver's padded length; every value finite; at every fluid cell ρ > 0 and
   p > 0; `history` length equal to `steps`, finite values.

## 4. Safe writes

The driver stays free of I/O: it hands the encoded bytes to a caller-supplied `write` function. The Node helper
(`scripts/checkpoint3d-file.ts`, outside the bundled source) writes `<path>.tmp`, `fsync`s it, renames it over
`<path>` (atomic on POSIX) and `fsync`s the directory. An interruption before the rename leaves the previous
`<path>` intact; a leftover `.tmp` is never read. Checkpoints go to a directory chosen by the caller, never into the
raw-data archives.

## 5. Behaviour and interface

- Disabled by default: without the `checkpoint` option `runSphereCase` executes exactly as before (verified by
  bit-identical results against archived profiles and by an unchanged test suite).
- `checkpoint: { every, write, resume?, stopAtStep?, stopWhen? }`: write after every `every`-th completed step;
  `resume` (checkpoint bytes) continues a run; `stopAtStep` or `stopWhen(steps)` (e.g. a wall-clock budget) ends the
  run cleanly after that step with a final checkpoint. Splitting only decides where a run is cut, never the states.

*(Two refinements were made during implementation and are reflected above: the integrity checks were moved before
header interpretation after the first test run reported a corrupted header byte as an unknown schema, and
`stopWhen` was added for wall-clock budgets.)*
- Result fields added (optional for old callers): `resumedFromStep` (null for a fresh run), `interrupted`
  (true when stopped by `stopAtStep` before convergence), `checkpointsWritten`, `lineage`.
- The solver gains `exportState()`, `importState()` and `geometryFingerprint()`; existing methods are untouched.

## 6. Known limits (by design)

- Checkpoint size ≈ 40 bytes per padded cell: ≈ 115 MB for the reduced-domain R/h 64 case (2.9 M padded cells);
  writing every 500 steps (≈ 10–15 min of that run) costs < 1 s per write.
- `solverRevision` is a manual guard: a numerics change without bumping it would not be detected beyond the
  geometry fingerprint. The tests pin the trajectory of a small case so such a change shows up as a failure.
- Only `runSphereCase` (and direct solver use via `exportState/importState`) is supported, not the gap-study
  harness with separate hx/hyz.
