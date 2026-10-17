import { EulerSolver3D, makeBoxGrid, type ImmersedSphere } from '../../src/lab/core/euler3d';
import { runSphereCase } from '../../src/lab/core/sphere3d';

// Experimental conservative cut-cell wall for the immersed sphere, measured against the ghost-cell wall (the
// default). Checks: mass crossing the body, conservation in a closed box, the rest state, small-cell merging,
// y ↔ z symmetry, the near-wall state when the nose cell is a sliver, and the Mach 2 case under refinement.
// These verify the implementation; they are not a validation.

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
    expect(s.mergeInfo().groups).toBeGreaterThan(0);
  });

  it('closed box, moving gas, global time step: cut cells conserve mass and energy to round-off; the ghost wall does not', () => {
    const n = 14;
    const vol = (2 / n) ** 3;
    const run = (wall: ImmersedSphere['wall'], merge?: boolean) => {
      const s = new EulerSolver3D(makeBoxGrid(-1, 1, -1, 1, -1, 1, n, n, n), {
        cfl: 0.6,
        order: 2,
        sphere: { cx: 0.05, cy: -0.07, cz: 0.04, r: 0.4, wall, merge },
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
      return { dm: Math.abs(after.m / before.m - 1), de: Math.abs(after.e / before.e - 1), maxBody, groups: wall === 'cutcell' ? s.mergeInfo().groups : 0 };
    };
    const cut = run('cutcell');
    const unmerged = run('cutcell', false);
    const ghost = run('ghost');
    expect(cut.groups).toBeGreaterThan(0);
    expect(unmerged.groups).toBe(0);
    for (const r of [cut, unmerged]) {
      expect(r.maxBody).toBe(0);
      expect(r.dm).toBeLessThan(1e-13);
      expect(r.de).toBeLessThan(1e-13);
    }
    // the ghost wall's error, for contrast (measured after 60 steps: mass +1.3e-3, energy +1.6e-3; cut cells 2e-15, 2e-14)
    expect(ghost.maxBody).toBeGreaterThan(0);
    expect(ghost.dm).toBeGreaterThan(1e3 * Math.max(cut.dm, 1e-16));
  });
});

describe('cut-cell sphere: small cut cells', () => {
  it('every cut cell with α < 0.5 is merged, groups stay small, and merging is mirror-symmetric (sphere-case grids)', () => {
    for (const rc of [8, 12, 16])
      for (const off of [0, 0.5]) {
        const h = 1 / rc;
        const nx = Math.round(3.5 * rc);
        const n = Math.round(2.5 * rc);
        const x0 = -2 - off * h;
        const s = new EulerSolver3D(makeBoxGrid(x0, x0 + nx * h, 0, n * h, 0, n * h, nx, n, n), {
          cfl: 0.8,
          order: 1,
          timeMode: 'local',
          freestream: { rho: 1, u: 1, v: 0, w: 0, p: 1 },
          sphere: { cx: 0, cy: 0, cz: 0, r: 1, wall: 'cutcell' },
          bc: { xmin: 'inflow', xmax: 'extrapolate', ymin: 'wall', ymax: 'extrapolate', zmin: 'wall', zmax: 'extrapolate' },
        });
        const info = s.mergeInfo();
        expect(info.unmergedSmall).toBe(0);
        expect(info.minUnmergedAlpha).toBeGreaterThanOrEqual(0.5);
        expect(info.maxSize).toBeLessThanOrEqual(4);
        // the y ↔ z mirror of a merged cell is merged too, with a mirror group of the same size
        for (let k = 0; k < n; k++)
          for (let j = 0; j < n; j++)
            for (let i = 0; i < nx; i++) expect(s.fluidFraction(i, j, k)).toBe(s.fluidFraction(i, k, j));
      }
  });
});

describe('Mach 2 sphere, cut-cell wall (experimental), quarter domain', () => {
  // Measured with the same set-up as the ghost-cell baseline (sphere3d.test.ts), R/h = 8 (ghost wall; commit
  // e41f915 cut cells without merging):
  //   body mass flux exactly 0 (ghost 6.96 %), mass balance closed to 1e-3, Δ/R 0.365 (0.429; 0.382; Billig 0.321)
  //   nose cell: the sliver (α = 0.02) is merged with its upstream neighbour; p/pitot 0.927, T/T0 1.014
  //   (0.946, 1.019; e41f915: the sliver alone overshot to 1.054, 1.069)
  //   front-wall cells: largest local total pressure 0.972 pitot (0.964; 1.061), largest |T0 error| 3.3 % (3.3 %; 7.1 %)
  const coarse = runSphereCase({ mach: 2, radiusCells: 8, wall: 'cutcell' });

  it('converges (residual drop and closed mass balance) with no invalid states; no mass crosses the body', () => {
    expect(coarse.failure).toBeNull();
    expect(coarse.converged).toBe(true);
    expect(coarse.bodyFluxFraction).toBe(0);
    expect(coarse.massImbalance).toBeLessThan(1e-3);
    expect(Math.abs(coarse.boundaryFluxFraction)).toBeLessThan(1e-3);
    expect(coarse.merge!.unmergedSmall).toBe(0);
  });

  it('y ↔ z symmetric and undisturbed ahead of the shock', () => {
    expect(coarse.symmetryError).toBeLessThan(1e-8);
    expect(coarse.upstreamDeviation).toBeLessThan(1e-3);
  });

  it('standoff detached, within 25 % of Billig; stagnation pressure below pitot and within 8 %, temperature within 2 %', () => {
    expect(coarse.standoff).toBeGreaterThan(coarse.billig);
    expect(coarse.standoff).toBeLessThan(1.25 * coarse.billig);
    expect(coarse.shockWidthCells).toBeLessThan(3.5);
    expect(coarse.pStag / coarse.pPitot).toBeLessThan(1);
    expect(coarse.pStag / coarse.pPitot).toBeGreaterThan(0.92);
    expect(Math.abs(coarse.TStag / coarse.T0 - 1)).toBeLessThan(0.02);
  });

  it('sliver regression: the nose sliver shares its neighbour\'s state, and no wall cell overshoots pitot or T0 by the sliver error', () => {
    const [prev, nose] = coarse.stagLine.slice(-2);
    expect(nose.alpha).toBeLessThan(0.05);
    expect(nose.pRatio).toBe(prev.pRatio);
    expect(coarse.wall.p0Max).toBeLessThan(1);
    expect(coarse.wall.T0MaxError).toBeLessThan(0.04);
  });

  it('small-cell sensitivity: moving the grid by half a cell (nose sliver α 0.02 → nose cell α 0.52) changes the nose pressure by < 5 %', () => {
    // measured: p/pitot 0.927 → 0.961 (e41f915 without merging: 1.054 → 0.943); largest |T0 error| 3.3 % → 2.8 % (7.1 % → 5.6 %)
    const shifted = runSphereCase({ mach: 2, radiusCells: 8, wall: 'cutcell', gridOffset: 0.5 });
    expect(shifted.converged).toBe(true);
    expect(shifted.stagLine.at(-1)!.alpha).toBeGreaterThan(0.5);
    expect(Math.abs(shifted.pStag / shifted.pPitot - coarse.pStag / coarse.pPitot)).toBeLessThan(0.05);
    for (const r of [coarse, shifted]) {
      expect(r.pStag / r.pPitot).toBeLessThan(1);
      expect(r.wall.p0Max).toBeLessThan(1);
      expect(r.wall.T0MaxError).toBeLessThan(0.04);
    }
    expect(shifted.symmetryError).toBeLessThan(1e-8);
  });

  it('refinement R/h = 8 → 10: nose-pressure and wall total-enthalpy errors decrease, body flux stays exactly 0, symmetry kept', () => {
    // measured: p/pitot 0.927 → 0.933, largest |T0 error| 3.3 % → 2.6 %. The standoff does not converge monotonically
    // on these grids (0.365, 0.373, 0.373, 0.370 for R/h = 8, 10, 12, 16; ±0.004 with the grid offset), so only its
    // band is checked
    const fine = runSphereCase({ mach: 2, radiusCells: 10, wall: 'cutcell' });
    expect(fine.converged).toBe(true);
    expect(fine.bodyFluxFraction).toBe(0);
    expect(fine.symmetryError).toBeLessThan(1e-8);
    expect(Math.abs(fine.pStag / fine.pPitot - 1)).toBeLessThan(Math.abs(coarse.pStag / coarse.pPitot - 1));
    expect(fine.wall.T0MaxError).toBeLessThan(coarse.wall.T0MaxError);
    expect(fine.standoff).toBeGreaterThan(fine.billig);
    expect(fine.standoff).toBeLessThan(1.25 * fine.billig);
  });
});
