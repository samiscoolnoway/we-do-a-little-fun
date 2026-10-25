// Gap study (docs/sphere-gap-study): reruns the axisymmetric Mach 2 sphere case (sphereAxi.ts, runAxiSphereCase —
// unchanged) with independent radial and tangential spacing and writes the stagnation-line profile with a metadata
// header, plus one JSON summary line per run. Not part of `npm test`.
//
//   cd euv-simulator
//   RH=32 ASPECT=0.5,1,2 OUT=docs/sphere-gap-study/axi-aspect \
//     npx vitest run --root . --config /dev/null --testTimeout 14400000 scripts/gap-axi-measure.test.ts
//
// RH: radial R/h list; ASPECT: list of tangential/radial spacing ratios at the wall (sphereAxi `aspect`, default 1);
// EXTRA: optional JSON of further runAxiSphereCase options. Every RH × ASPECT combination is run. The data rows use the
// format of docs/axisym-data/axi_<flux>_Rh<N>.csv (d, ρ/ρ∞, φ), so aspect 1 can be compared with the archive directly.
import { it } from 'vitest';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { runAxiSphereCase } from '../src/lab/core/sphereAxi';

it('axisymmetric gap-study measurement', () => {
  const dir = process.env.OUT ?? 'gap-axi-out';
  mkdirSync(dir, { recursive: true });
  const extra = process.env.EXTRA ? JSON.parse(process.env.EXTRA) : {};
  const tag = process.env.EXTRA ? '_' + Object.entries(extra).map(([k, v]) => `${k}${v}`).join('_') : '';
  for (const N of (process.env.RH ?? '16').split(',').map(Number))
    for (const aspect of (process.env.ASPECT ?? '1').split(',').map(Number)) {
      const opts = { mach: 2, radiusCells: N, flux: 'rusanov' as const, aspect, ...extra };
      const r = runAxiSphereCase(opts);
      const s = r.shock;
      const name = `axi_rusanov_Rh${N}_aspect${aspect}${tag}`;
      const meta = {
        name,
        options: opts,
        grid: r.grid,
        tangentialOverRadialAtShock: r.grid.tangentialAtShock / r.grid.hRadial,
        rayAngleDeg: s.rayAngleDeg,
        steps: r.steps,
        converged: r.converged,
        dropFront: r.dropFront,
        massImbalance: r.massImbalance,
        bodyFluxFraction: r.bodyFluxFraction,
        seconds: r.ms / 1000,
        failure: r.failure,
        reconstructionFallbacks: r.reconstructionFallbacks,
        standoff: {
          foot: s.crossings[0].standoff,
          mid: s.crossings[1].standoff,
          tail: s.crossings[2].standoff,
          maxGradient: s.maxGradient.standoff,
          equalArea: s.equalArea,
        },
        shockWidthCells: (s.crossings[0].standoff - s.crossings[2].standoff) / r.grid.hRadial,
        nose: r.nose,
        wall: r.wall,
        outerRingDeviation: r.outerRingDeviation,
        outflowMinNormalMach: r.outflowMinNormalMach,
      };
      const head = [
        '# axisymmetric Mach 2 sphere, stagnation-line row (cells next to the axis), from the outer boundary to the wall',
        '# d = distance of the cell centroid from the sphere surface along its ray (in R); rho/rhoInf; phi = (rho-rhoInf)/(rho2-rhoInf)',
        `# meta ${JSON.stringify(meta)}`,
        'd,rho_over_rhoInf,phi',
      ].join('\n');
      writeFileSync(`${dir}/${name}.csv`, head + '\n' + s.profile.map((p) => `${p.d.toFixed(6)},${p.rho.toFixed(6)},${p.phi.toFixed(6)}`).join('\n') + '\n');
      appendFileSync(`${dir}/summary.jsonl`, JSON.stringify(meta) + '\n');
    }
});
