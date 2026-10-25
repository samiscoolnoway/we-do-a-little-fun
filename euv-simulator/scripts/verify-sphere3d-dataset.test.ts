// Checkpoint-dependent verification of the 3D sphere browser dataset. Not part of `npm test` (it needs the solver
// checkpoints, which live outside the repository).
//
//   cd euv-simulator
//   CKPT_DIR=<checkpoint directory> DATASET_DIR=docs/sphere3d-browser-dataset-v1 \
//     npx vitest run --root . --config /dev/null --testTimeout 3600000 scripts/verify-sphere3d-dataset.test.ts
//
// 1. Rebuilds the whole dataset from the checkpoints and the archives and requires every file to be byte-identical
//    to the dataset on disk (deterministic export, unchanged inputs).
// 2. Independently of the export code path for the planes: loads the R/h 48 offset-0.5 checkpoint, advances it to
//    convergence and compares raw solver cells and cell-centre coordinates with the full-precision plane.
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { advanceToConvergence, buildDataset, defaultSources, DEFAULT_OUT, f64BytesToPlane, loadCheckpoint, sha256 } from './sphere3d-dataset';

const ckptDir = process.env.CKPT_DIR;
const dir = path.resolve(process.env.DATASET_DIR ?? DEFAULT_OUT);

it('a fresh export from the checkpoints is byte-identical to the dataset on disk', () => {
  if (!ckptDir) throw new Error('CKPT_DIR is required');
  const { files } = buildDataset(defaultSources(path.resolve(ckptDir)));
  for (const [name, bytes] of Object.entries(files)) expect(sha256(bytes), name).toBe(sha256(readFileSync(path.join(dir, name))));
});

it('raw solver cells of the converged R/h 48 offset-0.5 state equal the exported plane, at the documented positions', () => {
  if (!ckptDir) throw new Error('CKPT_DIR is required');
  const src = defaultSources(path.resolve(ckptDir)).find((s) => s.id === 'rh48-off0.5')!;
  const run = loadCheckpoint(src.checkpoint, src.radiusCells, src.gridOffset);
  advanceToConvergence(run);
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const p = manifest.planes.find((q: any) => q.id === 'rh48-off0.5');
  const pl = f64BytesToPlane(new Uint8Array(readFileSync(path.join(dir, p.f64.file))), p.grid.nx, p.grid.ny);
  let compared = 0;
  for (let j = 0; j < p.grid.ny; j++)
    for (let i = 0; i < p.grid.nx; i++) {
      const q = j * p.grid.nx + i;
      const [x, y, z] = run.s.centre(i, j, 0);
      expect(x).toBeCloseTo(p.grid.x0 + (i + 0.5) * p.grid.h, 12);
      expect(y).toBeCloseTo((j + 0.5) * p.grid.h, 12);
      expect(z).toBeCloseTo(0.5 * p.grid.h, 12);
      expect(pl.fields.alpha[q]).toBe(run.s.fluidFraction(i, j, 0));
      if (pl.fields.alpha[q] <= 0) continue;
      const c = run.s.cell(i, j, 0);
      expect(pl.fields.rho[q]).toBe(c.rho / run.fs.rho);
      expect(pl.fields.u[q]).toBe(c.u / run.fs.V);
      expect(pl.fields.v[q]).toBe(c.v / run.fs.V);
      expect(pl.fields.w[q]).toBe(c.w / run.fs.V);
      expect(pl.fields.p[q]).toBe(c.p / run.fs.p);
      compared++;
    }
  // every fluid cell was compared (full and cut cells as counted in the manifest)
  expect(compared).toBe(p.grid.cells.full + p.grid.cells.cut);
});
