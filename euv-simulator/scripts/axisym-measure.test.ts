// Reruns the axisymmetric Mach 2 sphere case and writes its stagnation-line profile in the format of
// docs/axisym-data/axi_<flux>_Rh<N>.csv, plus a one-line summary. Not part of `npm test` (outside tests/lab/).
//
//   cd euv-simulator
//   RH=32 FLUX=rusanov OUT=/tmp/axisym npx vitest run --root . --config /dev/null scripts/axisym-measure.test.ts
//
// RH: R/h (comma-separated list allowed), FLUX: rusanov | hllc, OUT: output directory, EXTRA: optional JSON of
// further runAxiSphereCase options for sensitivity runs, e.g. EXTRA='{"aspect":0.5}' (the output file name then gets
// a suffix). Default case settings
// (sphereAxi.ts): outer radius 5R, θmax 95°, CFL 0.4, 150 first-order steps, stop at a 4-order residual drop in x < 0
// with |net boundary mass flux| < 1e-3 of the intercepted flux. Runtime ≈ 0.2 s (R/h 8) … 12 min (R/h 128).
import { it } from 'vitest';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { runAxiSphereCase } from '../src/lab/core/sphereAxi';

it('axisymmetric sphere measurement', () => {
  const dir = process.env.OUT ?? 'axisym-out';
  const flux = (process.env.FLUX ?? 'rusanov') as 'rusanov' | 'hllc';
  mkdirSync(dir, { recursive: true });
  for (const N of (process.env.RH ?? '8').split(',').map(Number)) {
    const extra = process.env.EXTRA ? JSON.parse(process.env.EXTRA) : {};
    const tag = process.env.EXTRA ? '_' + Object.entries(extra).map(([k, v]) => `${k}${v}`).join('_') : '';
    const r = runAxiSphereCase({ mach: 2, radiusCells: N, flux, ...extra });
    const head =
      '# axisymmetric Mach 2 sphere, stagnation-line row (cells next to the axis), from the outer boundary to the wall\n' +
      '# d = distance of the cell centroid from the sphere surface along its ray (in R); rho/rhoInf; phi = (rho-rhoInf)/(rho2-rhoInf)\n' +
      'd,rho_over_rhoInf,phi\n';
    writeFileSync(`${dir}/axi_${flux}_Rh${N}${tag}.csv`, head + r.shock.profile.map((p) => `${p.d.toFixed(6)},${p.rho.toFixed(6)},${p.phi.toFixed(6)}`).join('\n') + '\n');
    const s = r.shock;
    appendFileSync(
      `${dir}/summary.txt`,
      `${flux} R/h=${N}${tag} converged=${r.converged} steps=${r.steps} residualDrop=${r.dropFront.toFixed(2)} massImbalance=${r.massImbalance.toExponential(2)} ` +
        `seconds=${(r.ms / 1000).toFixed(1)} cells=${r.grid.cells} mid=${s.crossings[1].standoff.toFixed(6)} foot=${s.crossings[0].standoff.toFixed(6)} ` +
        `tail=${s.crossings[2].standoff.toFixed(6)} maxGradient=${s.maxGradient.standoff.toFixed(6)} equalArea=${s.equalArea.toFixed(6)} ` +
        `noseP/pitot=${r.nose.pRatio.toFixed(5)} noseP0/pitot=${r.nose.p0Ratio.toFixed(5)} hllcFallbacks=${r.hllcFallbacks} ` +
        `bodyFlux=${r.bodyFluxFraction.toExponential(1)} outerRingDev=${r.outerRingDeviation.toExponential(1)} outflowMinNormalMach=${r.outflowMinNormalMach.toFixed(3)}\n`,
    );
  }
});
