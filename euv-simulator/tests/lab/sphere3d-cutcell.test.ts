import { EulerSolver3D, makeBoxGrid, type ImmersedSphere } from '../../src/lab/core/euler3d';
import { runSphereCase } from '../../src/lab/core/sphere3d';

// Experimental conservative cut-cell wall for the immersed sphere, measured against the ghost-cell wall (the
// default). Checks: mass crossing the body, conservation in a closed box, the rest state, y ↔ z symmetry and the
// behaviour of the Mach 2 case under refinement. These verify the implementation; they are not a validation.

const closedBox = { xmin: 'wall', xmax: 'wall', ymin: 'wall', ymax: 'wall', zmin: 'wall', zmax: 'wall' } as const;

/** total mass and energy of the fluid, Σ α V (ρ, E) */
function totals(s: EulerSolver3D, n: number, vol: number) {
  let m = 0;
  let e = 0;
  for (let k = 0; k < n; k++)
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const a = s.fluidFraction(i, j, k);
        if (a === 0) continue;
        const c = s.cell(i, j, k);
        m += a * vol * c.rho;
        e += a * vol * (c.p / 0.4 + 0.5 * c.rho * (c.u * c.u + c.v * c.v + c.w * c.w));
      }
  return { m, e };
}

describe('cut-cell sphere: exact properties', () => {
  it('fluid volume Σ αV matches the exact box-minus-sphere volume far better than the staircase', () => {
    const n = 20;
    const r = 0.6;
    const h = 2 / n;
    const make = (wall: ImmersedSphere['wall']) =>
      new EulerSolver3D(makeBoxGrid(-1, 1, -1, 1, -1, 1, n, n, n), { cfl: 0.5, order: 1, timeMode: 'local', sphere: { cx: 0.03, cy: -0.02, cz: 0.05, r, wall }, bc: closedBox });
    const exact = 8 - (4 / 3) * Math.PI * r ** 3;
    const cut = make('cutcell');
    let v = 0;
    for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) v += cut.fluidFraction(i, j, k) * h ** 3;
    const stair = make('ghost').fluidCells * h ** 3;
    expect(Math.abs(v / exact - 1)).toBeLessThan(1e-3);
    expect(Math.abs(v / exact - 1)).toBeLessThan(0.1 * Math.abs(stair / exact - 1));
  });

  it('gas at rest stays exactly at rest (the wall faces close every cut cell) and no mass crosses the body', () => {
    const s = new EulerSolver3D(makeBoxGrid(-1, 1, -1, 1, -1, 1, 12, 12, 12), {
      cfl: 0.8,
      order: 2,
      timeMode: 'local',
      sphere: { cx: 0.05, cy: -0.1, cz: 0.08, r: 0.45, wall: 'cutcell' },
      bc: closedBox,
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
    expect(s.bodyMassFlux).toBe(0);
  });

  it('closed box, moving gas, global time step: cut cells conserve mass and energy to round-off; the ghost wall does not', () => {
    const n = 14;
    const vol = (2 / n) ** 3;
    const run = (wall: ImmersedSphere['wall']) => {
      const s = new EulerSolver3D(makeBoxGrid(-1, 1, -1, 1, -1, 1, n, n, n), {
        cfl: 0.6,
        order: 2,
        sphere: { cx: 0.05, cy: -0.07, cz: 0.04, r: 0.4, wall },
        bc: closedBox,
      });
      // a uniform stream in a closed box: it hits the sphere and the walls and sets up a strongly unsteady flow
      s.init((x, y, z) => ({ rho: 1.2 + 0.1 * Math.exp(-((x + 0.6) ** 2 + y * y + z * z) * 20), u: 150, v: 40, w: -25, p: 1e5 }));
      const before = totals(s, n, vol);
      let maxBody = 0;
      for (let k = 0; k < 60; k++) {
        expect(s.step().ok).toBe(true);
        maxBody = Math.max(maxBody, Math.abs(s.bodyMassFlux));
      }
      const after = totals(s, n, vol);
      return { dm: Math.abs(after.m / before.m - 1), de: Math.abs(after.e / before.e - 1), maxBody };
    };
    const cut = run('cutcell');
    const ghost = run('ghost');
    expect(cut.maxBody).toBe(0);
    expect(cut.dm).toBeLessThan(1e-13);
    expect(cut.de).toBeLessThan(1e-13);
    // the ghost wall's error, for contrast (measured after 60 steps: mass +1.3e-3, energy +1.6e-3; cut cells 2e-15, 2e-14)
    expect(ghost.maxBody).toBeGreaterThan(0);
    expect(ghost.dm).toBeGreaterThan(1e3 * Math.max(cut.dm, 1e-16));
  });
});

describe('Mach 2 sphere, cut-cell wall (experimental), quarter domain', () => {
  // Measured with the same set-up as the ghost-cell baseline (sphere3d.test.ts), R/h = 8:
  //   body mass flux exactly 0 (ghost: 6.95 % of the intercepted flux), mass balance closed to 1e-3, Δ/R 0.382
  //   (ghost 0.429, Billig 0.321). The nose cell on the stagnation line is a sliver (α ≈ 0.02) whose state
  //   overshoots the exact references: p/pitot 1.054, T/T0 1.069 (ghost: 0.946, 1.019). See docs/engineering-lab.md.
  const coarse = runSphereCase({ mach: 2, radiusCells: 8, wall: 'cutcell' });

  it('converges (residual drop and closed mass balance) with no invalid states; no mass crosses the body', () => {
    expect(coarse.failure).toBeNull();
    expect(coarse.converged).toBe(true);
    expect(coarse.bodyFluxFraction).toBe(0);
    expect(coarse.massImbalance).toBeLessThan(1e-3);
    expect(Math.abs(coarse.boundaryFluxFraction)).toBeLessThan(1e-3);
  });

  it('y ↔ z symmetric and undisturbed ahead of the shock', () => {
    expect(coarse.symmetryError).toBeLessThan(1e-8);
    expect(coarse.upstreamDeviation).toBeLessThan(1e-3);
  });

  it('standoff detached and closer to Billig than the ghost wall on the same grid; stagnation state within 8 %', () => {
    expect(coarse.standoff).toBeGreaterThan(coarse.billig);
    expect(coarse.standoff).toBeLessThan(1.25 * coarse.billig);
    expect(coarse.shockWidthCells).toBeLessThan(3.5);
    expect(Math.abs(coarse.pStag / coarse.pPitot - 1)).toBeLessThan(0.08);
    expect(Math.abs(coarse.TStag / coarse.T0 - 1)).toBeLessThan(0.08);
  });

  it('refinement R/h = 8 → 10: standoff error decreases, body flux stays exactly 0, symmetry kept', () => {
    const fine = runSphereCase({ mach: 2, radiusCells: 10, wall: 'cutcell' });
    expect(fine.converged).toBe(true);
    expect(fine.bodyFluxFraction).toBe(0);
    expect(fine.symmetryError).toBeLessThan(1e-8);
    expect(Math.abs(fine.standoff / fine.billig - 1)).toBeLessThan(Math.abs(coarse.standoff / coarse.billig - 1));
  });
});
