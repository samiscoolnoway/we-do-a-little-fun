// Runs the existing 3D Cartesian Mach 2 sphere case (sphere3d.ts, runSphereCase — unchanged) and writes the full
// stagnation-line profile with a metadata header, plus one JSON summary line per run. Not part of `npm test`.
//
//   cd euv-simulator
//   RH=16 FLUX=rusanov OUT=docs/sphere3d-refinement npx vitest run --root . --config /dev/null scripts/sphere3d-measure.test.ts
//
// RH: R/h list, FLUX: rusanov | hllc, WALL: cutcell (default) | ghost, OFF: grid offset in cells (default 0),
// EXTRA: optional JSON of further runSphereCase options (upstream, downstream, lateral, cfl, maxSteps, …).
// Defaults otherwise as runSphereCase: domain 2R upstream / 1.5R downstream / 2.5R lateral (quarter domain), CFL 0.8,
// local time steps, 150 first-order steps, stop at a 4-order residual drop in x < 0 with |net mass flux| < 1e-3.
import { it } from 'vitest';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { runSphereCase } from '../src/lab/core/sphere3d';

it('3D sphere measurement', () => {
  const dir = process.env.OUT ?? 'sphere3d-out';
  mkdirSync(dir, { recursive: true });
  const flux = (process.env.FLUX ?? 'rusanov') as 'rusanov' | 'hllc';
  const wall = (process.env.WALL ?? 'cutcell') as 'cutcell' | 'ghost';
  const off = Number(process.env.OFF ?? 0);
  const extra = process.env.EXTRA ? JSON.parse(process.env.EXTRA) : {};
  const tag = process.env.EXTRA ? '_' + Object.entries(extra).map(([k, v]) => `${k}${v}`).join('_') : '';
  for (const N of (process.env.RH ?? '8').split(',').map(Number)) {
    const opts = { mach: 2, radiusCells: N, wall, flux, gridOffset: off, maxSteps: 20000, ...extra };
    const r = runSphereCase(opts);
    const sh = r.shock;
    const h = r.grid.h;
    // equal-area detector (same definition as the axisymmetric analysis), computed from the exported profile
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
      standoff: { foot: sh.crossings[0].standoff, mid: sh.crossings[1].standoff, tail: sh.crossings[2].standoff, maxGradient: sh.maxGradient.standoff, equalArea: (sh.xNose - xEA) / 1 },
      shockWidthCells: r.shockWidthCells,
      nose: r.stagLine.at(-1),
      noseP: r.pStag / r.pPitot,
      noseT: r.TStag / r.T0,
      wall: r.wall,
      merge: r.merge,
      hllcFallbacks: r.hllcFallbacks,
      hllcFallbackFraction: r.hllcFallbackFraction,
    };
    const head = [
      `# 3D Cartesian Mach 2 sphere (sphere3d.ts runSphereCase), stagnation-line cells j = k = 0 (centres at y = z = h/2), from the inflow to the last fluid cell`,
      `# x = cell-centre x (R); d = xNose - x, distance from the sphere surface on this line (R); rho/rhoInf; phi = (rho-rhoInf)/(rho2-rhoInf), rho2/rhoInf = 8/3; alpha = fluid fraction`,
      `# meta ${JSON.stringify(meta)}`,
      'i,x,d,rho_over_rhoInf,phi,alpha',
    ].join('\n');
    const rows = sh.profile.map((p, i) => `${i},${p.x.toFixed(6)},${(sh.xNose - p.x).toFixed(6)},${p.rho.toFixed(6)},${p.phi.toFixed(6)},${p.alpha.toFixed(4)}`);
    writeFileSync(`${dir}/${name}.csv`, head + '\n' + rows.join('\n') + '\n');
    appendFileSync(`${dir}/summary.jsonl`, JSON.stringify(meta) + '\n');
  }
});
