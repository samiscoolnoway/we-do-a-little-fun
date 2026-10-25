// Resumable run of the 3D Cartesian Mach 2 sphere case (sphere3d.ts runSphereCase with its `checkpoint` option;
// docs/checkpoint-restart/). For runs longer than one job: each invocation continues from the checkpoint file and
// ends cleanly, with a checkpoint, before its wall-clock budget. When the run converges (or reaches maxSteps) the
// stagnation-line profile and summary are written in the format of scripts/sphere3d-measure.test.ts. Not part of
// `npm test`.
//
//   cd euv-simulator
//   RH=64 EXTRA='{"downstream":0.5,"lateral":2}' CKPT=/path/to/run.ckpt EVERY=500 BUDGET_MIN=100 OUT=/path/to/out \
//     npx vitest run --root . --config /dev/null --testTimeout 14400000 scripts/sphere3d-resumable.test.ts
//   (repeat the same command with RESUME=1 until the status file says "converged" or "maxSteps")
//
// RH: R/h (one value), FLUX, WALL (default cutcell), OFF, EXTRA as in sphere3d-measure; CKPT: checkpoint file
// (required); EVERY: steps between checkpoints (default 500); BUDGET_MIN: stop after this many minutes of this
// invocation (default: none); STOP_AT: stop after this step; RESUME=1: continue from CKPT (required if CKPT exists;
// a missing, corrupted or incompatible checkpoint is an error, never a fresh start); OUT: output directory (required;
// the existing raw-data archives are refused). Progress: <CKPT>.status.json after every invocation.
import { it } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runSphereCase } from '../src/lab/core/sphere3d';
import { readCheckpointFile, writeCheckpointAtomic } from './checkpoint3d-file';

const ARCHIVES = ['docs/sphere3d-refinement', 'docs/sphere-gap-study', 'docs/axisym-data', 'docs/axi-reference-refinement'].map((d) => resolve(d));

it('resumable 3D sphere run', () => {
  const ckpt = process.env.CKPT;
  const dir = process.env.OUT;
  if (!ckpt || !dir) throw new Error('CKPT and OUT are required');
  const outAbs = resolve(dir);
  if (ARCHIVES.some((a) => outAbs === a || outAbs.startsWith(a + '/')) || ARCHIVES.some((a) => resolve(ckpt).startsWith(a + '/'))) throw new Error('refusing to write into an existing raw-data archive');
  const resume = process.env.RESUME === '1';
  if (resume && !existsSync(ckpt)) throw new Error(`RESUME=1 but no checkpoint at ${ckpt}`);
  if (!resume && existsSync(ckpt)) throw new Error(`a checkpoint exists at ${ckpt}: set RESUME=1 to continue it or move it away to start afresh`);
  mkdirSync(dir, { recursive: true });
  const N = Number(process.env.RH ?? 8);
  const flux = (process.env.FLUX ?? 'rusanov') as 'rusanov' | 'hllc';
  const wall = (process.env.WALL ?? 'cutcell') as 'cutcell' | 'ghost';
  const off = Number(process.env.OFF ?? 0);
  const extra = process.env.EXTRA ? JSON.parse(process.env.EXTRA) : {};
  const tag = process.env.EXTRA ? '_' + Object.entries(extra).map(([k, v]) => `${k}${v}`).join('_') : '';
  const every = Number(process.env.EVERY ?? 500);
  const budgetMs = process.env.BUDGET_MIN ? Number(process.env.BUDGET_MIN) * 60000 : Infinity;
  const stopAtStep = process.env.STOP_AT ? Number(process.env.STOP_AT) : undefined;
  const t0 = Date.now();
  const opts = { mach: 2, radiusCells: N, wall, flux, gridOffset: off, maxSteps: 20000, ...extra };
  const r = runSphereCase({
    ...opts,
    checkpoint: {
      every,
      stopAtStep,
      stopWhen: () => Date.now() - t0 > budgetMs,
      resume: resume ? readCheckpointFile(ckpt) : undefined,
      write: (bytes) => writeCheckpointAtomic(ckpt, bytes),
    },
  });
  const status = r.converged ? 'converged' : r.failure ? 'failed' : r.interrupted ? 'interrupted' : 'maxSteps';
  writeFileSync(`${ckpt}.status.json`, JSON.stringify({ status, steps: r.steps, dropFront: r.dropFront, massImbalance: r.massImbalance, resumedFromStep: r.resumedFromStep, lineage: r.lineage, checkpointsWritten: r.checkpointsWritten, failure: r.failure, at: new Date().toISOString() }, null, 1) + '\n');
  if (status === 'interrupted') return;
  const sh = r.shock;
  const h = r.grid.h;
  let S = 0;
  let last = 0;
  for (let i = 0; i < sh.profile.length; i++) {
    S += Math.min(Math.max(sh.profile[i].phi, 0), 1);
    last = i;
    if (sh.profile[i].phi >= 1) break;
  }
  const xEA = sh.profile[last].x + 0.5 * h - h * S;
  const name = `s3d_${flux}_${wall}_Rh${N}_off${off}${tag}`;
  const meta = {
    name,
    options: opts,
    grid: r.grid,
    steps: r.steps,
    converged: r.converged,
    dropFront: r.dropFront,
    massImbalance: r.massImbalance,
    seconds: r.ms / 1000,
    failure: r.failure,
    bodyFluxFraction: r.bodyFluxFraction,
    boundaryFluxFraction: r.boundaryFluxFraction,
    symmetryError: r.symmetryError,
    upstreamDeviation: r.upstreamDeviation,
    xNose: sh.xNose,
    standoff: { foot: sh.crossings[0].standoff, mid: sh.crossings[1].standoff, tail: sh.crossings[2].standoff, maxGradient: sh.maxGradient.standoff, equalArea: sh.xNose - xEA },
    shockWidthCells: r.shockWidthCells,
    nose: r.stagLine.at(-1),
    noseP: r.pStag / r.pPitot,
    noseT: r.TStag / r.T0,
    wall: r.wall,
    merge: r.merge,
    hllcFallbacks: r.hllcFallbacks,
    hllcFallbackFraction: r.hllcFallbackFraction,
    resumedFromStep: r.resumedFromStep,
    lineage: r.lineage,
    checkpoint: resolve(ckpt),
  };
  const head = [
    `# 3D Cartesian Mach 2 sphere (sphere3d.ts runSphereCase, resumable harness), stagnation-line cells j = k = 0 (centres at y = z = h/2), from the inflow to the last fluid cell`,
    `# x = cell-centre x (R); d = xNose - x, distance from the sphere surface on this line (R); rho/rhoInf; phi = (rho-rhoInf)/(rho2-rhoInf), rho2/rhoInf = 8/3; alpha = fluid fraction`,
    `# meta ${JSON.stringify(meta)}`,
    'i,x,d,rho_over_rhoInf,phi,alpha',
  ].join('\n');
  const rows = sh.profile.map((p, i) => `${i},${p.x.toFixed(6)},${(sh.xNose - p.x).toFixed(6)},${p.rho.toFixed(6)},${p.phi.toFixed(6)},${p.alpha.toFixed(4)}`);
  writeFileSync(`${dir}/${name}.csv`, head + '\n' + rows.join('\n') + '\n');
  appendFileSync(`${dir}/summary.jsonl`, JSON.stringify(meta) + '\n');
});
