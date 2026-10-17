import { EulerSolver3D, makeBoxGrid } from '../../src/lab/core/euler3d';
import { billigSphere, runSphereCase } from '../../src/lab/core/sphere3d';

// Immersed sphere (ghost-cell reflection method, the default wall) in the 3D Euler prototype. Exact checks first (rest state,
// geometry), then the Mach 2 sphere against the exact references (pitot pressure, stagnation temperature,
// symmetry, undisturbed flow ahead of the shock) and against Billig's empirical standoff correlation.
// These verify the implementation and show its accuracy on coarse grids; they are not a validation.

describe('immersed sphere: exact properties', () => {
  it('gas at rest around a sphere in a closed box stays exactly at rest (the ghost states are consistent)', () => {
    const s = new EulerSolver3D(makeBoxGrid(-1, 1, -1, 1, -1, 1, 12, 12, 12), {
      cfl: 0.8,
      order: 2,
      sphere: { cx: 0.05, cy: -0.1, cz: 0.08, r: 0.45 },
      bc: { xmin: 'wall', xmax: 'wall', ymin: 'wall', ymax: 'wall', zmin: 'wall', zmax: 'wall' },
    });
    s.init(() => ({ rho: 1.2, u: 0, v: 0, w: 0, p: 1e5 }));
    for (let n = 0; n < 20; n++) expect(s.step().ok).toBe(true);
    let worst = 0;
    for (let k = 0; k < 12; k++)
      for (let j = 0; j < 12; j++)
        for (let i = 0; i < 12; i++) {
          if (s.isSolid(i, j, k)) continue;
          const c = s.cell(i, j, k);
          worst = Math.max(worst, Math.abs(c.u) + Math.abs(c.v) + Math.abs(c.w), Math.abs(c.p / 1e5 - 1));
        }
    expect(worst).toBeLessThan(1e-10);
    expect(Math.abs(s.bodyMassFlux)).toBeLessThan(1e-12);
  });

  it('the solid cells approximate the sphere volume (first-order staircase)', () => {
    const r = 0.6;
    const n = 30;
    const s = new EulerSolver3D(makeBoxGrid(-1, 1, -1, 1, -1, 1, n, n, n), { cfl: 0.5, order: 1, sphere: { cx: 0, cy: 0, cz: 0, r }, bc: { xmin: 'wall', xmax: 'wall', ymin: 'wall', ymax: 'wall', zmin: 'wall', zmax: 'wall' } });
    const h = 2 / n;
    const solidVolume = (n * n * n - s.fluidCells) * h ** 3;
    expect(Math.abs(solidVolume / ((4 / 3) * Math.PI * r ** 3) - 1)).toBeLessThan(0.05);
  });

  it('configuration guards: inflow needs a freestream; the sphere case needs supersonic inflow', () => {
    expect(() => new EulerSolver3D(makeBoxGrid(0, 1, 0, 1, 0, 1, 4, 4, 4), { cfl: 0.5, order: 1, bc: { xmin: 'inflow', xmax: 'extrapolate', ymin: 'wall', ymax: 'wall', zmin: 'wall', zmax: 'wall' } })).toThrow();
    expect(() => runSphereCase({ mach: 0.8, radiusCells: 4 })).toThrow();
  });
});

describe('Mach 2 sphere, ghost-cell wall (baseline), quarter domain with symmetry planes', () => {
  // Measured (Mach 2, T∞ = 220 K, p∞ = 2500 Pa, CFL 0.8, local time steps, 150 first-order start-up steps,
  // convergence = 4-order drop of the residual ahead of the sphere centre and a closed mass balance):
  //   R/h =  8: 11 200 cells,  642 steps; p/pitot 0.946, T/T0 1.019, Δ/R 0.429 (Billig 0.321), body flux 6.96 %
  //   R/h = 12: 37 800 cells, 1000 steps; p/pitot 0.965, T/T0 1.015, Δ/R 0.405, body flux 4.41 %
  //   R/h = 16: 89 600 cells, 1315 steps; p/pitot 0.976, T/T0 1.011, Δ/R 0.394, body flux 2.98 %
  // Errors fall at about first order. Tolerances below sit just outside the R/h = 8 values (regression guards),
  // and the refinement test requires every error to shrink.
  const coarse = runSphereCase({ mach: 2, radiusCells: 8, wall: 'ghost' });

  it('converges: the residual ahead of the sphere drops 4 orders; no invalid states', () => {
    expect(coarse.failure).toBeNull();
    expect(coarse.converged).toBe(true);
    expect(coarse.dropFront).toBeGreaterThanOrEqual(4);
  });

  it('the solution is symmetric under y ↔ z (the flow is axisymmetric) and the flow 5 cells ahead of the shock is the freestream', () => {
    expect(coarse.symmetryError).toBeLessThan(1e-6);
    expect(coarse.upstreamDeviation).toBeLessThan(1e-3);
  });

  it('stagnation pressure vs the Rayleigh pitot formula and temperature vs T0 (exact references; coarse-grid errors 5.4 % and 1.9 %)', () => {
    expect(Math.abs(coarse.pStag / coarse.pPitot - 1)).toBeLessThan(0.06);
    expect(Math.abs(coarse.TStag / coarse.T0 - 1)).toBeLessThan(0.025);
  });

  it('bow-shock standoff is detached and above the Billig correlation on this coarse grid (+33 %)', () => {
    expect(coarse.billig).toBeCloseTo(billigSphere(2), 12);
    expect(coarse.standoff).toBeGreaterThan(coarse.billig);
    expect(coarse.standoff).toBeLessThan(1.4 * coarse.billig);
    expect(coarse.shockWidthCells).toBeLessThan(3.5);
  });

  it('immersed-boundary conservation error is measured (6.95 % of the intercepted mass flux at R/h = 8)', () => {
    expect(Math.abs(coarse.bodyFluxFraction)).toBeLessThan(0.08);
  });

  it('refinement R/h = 8 → 10: pitot, temperature, standoff and body-flux errors all decrease', () => {
    const fine = runSphereCase({ mach: 2, radiusCells: 10, wall: 'ghost' });
    expect(fine.converged).toBe(true);
    expect(Math.abs(fine.pStag / fine.pPitot - 1)).toBeLessThan(Math.abs(coarse.pStag / coarse.pPitot - 1));
    expect(Math.abs(fine.TStag / fine.T0 - 1)).toBeLessThan(Math.abs(coarse.TStag / coarse.T0 - 1));
    expect(Math.abs(fine.standoff / fine.billig - 1)).toBeLessThan(Math.abs(coarse.standoff / coarse.billig - 1));
    expect(Math.abs(fine.bodyFluxFraction)).toBeLessThan(Math.abs(coarse.bodyFluxFraction));
  });
});
