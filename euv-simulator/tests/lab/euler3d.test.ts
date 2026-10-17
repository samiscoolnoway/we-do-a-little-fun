import { type BC3D, EulerSolver3D, type Primitive3D, makeBoxGrid } from '../../src/lab/core/euler3d';
import { sampleRiemann, starState } from '../../src/lab/core/riemann';

// Prototype 3D Euler solver on a Cartesian box. These checks use exact properties (preservation of a uniform
// state, conservation, mirror symmetry) and the exact Riemann solution; they verify the implementation, they do
// not validate it against experiment.
const all = (b: BC3D) => ({ xmin: b, xmax: b, ymin: b, ymax: b, zmin: b, zmax: b });

describe('3D prototype: basic invariants', () => {
  it('a uniform flow in an arbitrary direction stays uniform to round-off (periodic box, second order)', () => {
    const g = makeBoxGrid(0, 1, 0, 0.8, 0, 0.6, 10, 8, 6);
    const s = new EulerSolver3D(g, { cfl: 0.8, order: 2, bc: all('periodic') });
    const w0: Primitive3D = { rho: 1.2, u: 170, v: -90, w: 55, p: 1e5 };
    s.init(() => w0);
    for (let n = 0; n < 30; n++) expect(s.step().ok).toBe(true);
    let worst = 0;
    for (let k = 0; k < 6; k++)
      for (let j = 0; j < 8; j++)
        for (let i = 0; i < 10; i++) {
          const c = s.cell(i, j, k);
          worst = Math.max(worst, Math.abs(c.rho / w0.rho - 1), Math.abs(c.p / w0.p - 1), Math.abs(c.u - w0.u) / 200, Math.abs(c.v - w0.v) / 200, Math.abs(c.w - w0.w) / 200);
        }
    expect(worst).toBeLessThan(1e-12);
  });

  it('gas at rest in a closed box with slip walls stays at rest', () => {
    const s = new EulerSolver3D(makeBoxGrid(0, 1, 0, 1, 0, 1, 6, 6, 6), { cfl: 0.8, order: 2, bc: all('wall') });
    s.init(() => ({ rho: 1, u: 0, v: 0, w: 0, p: 1 }));
    for (let n = 0; n < 20; n++) expect(s.step().ok).toBe(true);
    const c = s.cell(0, 5, 2);
    expect(Math.abs(c.u) + Math.abs(c.v) + Math.abs(c.w)).toBeLessThan(1e-13);
    expect(Math.abs(c.p - 1)).toBeLessThan(1e-13);
  });

  it('constructor guards: at least 2 cells per axis; periodic only in pairs', () => {
    expect(() => makeBoxGrid(0, 1, 0, 1, 0, 1, 1, 4, 4)).toThrow();
    expect(() => new EulerSolver3D(makeBoxGrid(0, 1, 0, 1, 0, 1, 4, 4, 4), { cfl: 0.5, order: 1, bc: { ...all('wall'), xmin: 'periodic' } })).toThrow();
  });
});

describe('3D prototype: conservation', () => {
  // Tolerance 1e-12 relative after 40 steps: round-off only.
  const blob = (x: number, y: number, z: number): Primitive3D => {
    const d2 = ((x - 0.45) ** 2 + (y - 0.5) ** 2 + (z - 0.55) ** 2) / 0.04;
    return { rho: 1 + 0.5 * Math.exp(-d2), u: 0.3, v: -0.2, w: 0.1, p: 1 + 2 * Math.exp(-d2) };
  };
  it('periodic box: mass, all three momentum components and energy', () => {
    const s = new EulerSolver3D(makeBoxGrid(0, 1, 0, 1, 0, 1, 12, 10, 8), { cfl: 0.6, order: 2, bc: all('periodic') });
    s.init(blob);
    const a = s.totals();
    for (let n = 0; n < 40; n++) expect(s.step().ok).toBe(true);
    const b = s.totals();
    expect(Math.abs(b.mass / a.mass - 1)).toBeLessThan(1e-12);
    expect(Math.abs(b.energy / a.energy - 1)).toBeLessThan(1e-12);
    expect(Math.abs(b.momX / a.momX - 1)).toBeLessThan(1e-12);
    expect(Math.abs(b.momY / a.momY - 1)).toBeLessThan(1e-12);
    expect(Math.abs(b.momZ / a.momZ - 1)).toBeLessThan(1e-12);
  });
  it('closed box with slip walls: mass and energy (the walls push, so momentum is not conserved)', () => {
    const s = new EulerSolver3D(makeBoxGrid(0, 1, 0, 1, 0, 1, 10, 10, 10), { cfl: 0.6, order: 2, bc: all('wall') });
    s.init(blob);
    const a = s.totals();
    for (let n = 0; n < 40; n++) expect(s.step().ok).toBe(true);
    const b = s.totals();
    expect(Math.abs(b.mass / a.mass - 1)).toBeLessThan(1e-12);
    expect(Math.abs(b.energy / a.energy - 1)).toBeLessThan(1e-12);
  });
});

describe('3D prototype: Sod shock tube along x, y and z vs the exact Riemann solution', () => {
  // 1D problem along one axis (extrapolated ends), 2 cells with periodic boundaries across it. t = 0.2, CFL 0.5.
  // Measured L1(ρ) at 100 / 200 / 400 cells, identical along all three axes:
  //   1st order 0.0268 / 0.0183 / 0.0120;  2nd order (minmod) 0.0096 / 0.0053 / 0.0030
  // (the 2D solver's recorded study gives 0.0268 / 0.0183 / 0.0120 and 0.0097 / 0.0053 / 0.0030 for the same scheme).
  const L = { rho: 1, u: 0, p: 1 };
  const R = { rho: 0.125, u: 0, p: 0.1 };
  const star = starState(L, R);
  const run = (axis: 0 | 1 | 2, n: number, order: 1 | 2) => {
    const dims = [2, 2, 2];
    dims[axis] = n;
    const ext = [0.1, 0.1, 0.1];
    ext[axis] = 1;
    const bc = { ...all('periodic') } as Record<string, BC3D>;
    const [lo, hi] = [['xmin', 'xmax'], ['ymin', 'ymax'], ['zmin', 'zmax']][axis];
    bc[lo] = 'extrapolate';
    bc[hi] = 'extrapolate';
    const s = new EulerSolver3D(makeBoxGrid(0, ext[0], 0, ext[1], 0, ext[2], dims[0], dims[1], dims[2]), { cfl: 0.5, order, bc: bc as never });
    s.init((x, y, z) => ([x, y, z][axis] < 0.5 ? { rho: 1, u: 0, v: 0, w: 0, p: 1 } : { rho: 0.125, u: 0, v: 0, w: 0, p: 0.1 }));
    while (s.time < 0.2 - 1e-14) expect(s.stepTo(0.2).ok).toBe(true);
    let err = 0;
    const profile: number[] = [];
    for (let m = 0; m < n; m++) {
      const idx = [0, 0, 0];
      idx[axis] = m;
      const c = s.cell(idx[0], idx[1], idx[2]);
      profile.push(c.rho);
      err += Math.abs(c.rho - sampleRiemann(L, R, ((m + 0.5) / n - 0.5) / 0.2, 1.4, star).rho) / n;
    }
    return { err, profile, time: s.time };
  };

  it('first order: error level, convergence, and the same result along every axis', () => {
    const x = run(0, 200, 1);
    expect(x.time).toBeCloseTo(0.2, 13);
    expect(x.err).toBeLessThan(0.020);
    expect(x.err / run(0, 400, 1).err).toBeGreaterThan(1.4);
    for (const axis of [1, 2] as const) {
      const o = run(axis, 200, 1);
      for (let m = 0; m < 200; m++) expect(Math.abs(o.profile[m] - x.profile[m])).toBeLessThan(1e-12);
    }
  });

  it('second order (minmod): error level and convergence', () => {
    const e200 = run(2, 200, 2).err;
    expect(e200).toBeLessThan(0.0058);
    expect(e200 / run(2, 400, 2).err).toBeGreaterThan(1.6);
  });
});

describe('3D prototype: a genuinely three-dimensional flow', () => {
  it('a spherical blast in a cube stays mirror- and axis-symmetric while it spreads in all three directions', () => {
    const n = 16;
    const s = new EulerSolver3D(makeBoxGrid(-1, 1, -1, 1, -1, 1, n, n, n), { cfl: 0.6, order: 2, bc: all('wall') });
    s.init((x, y, z) => {
      const e = Math.exp(-(x * x + y * y + z * z) / 0.08);
      return { rho: 1 + e, u: 0, v: 0, w: 0, p: 1 + 9 * e };
    });
    const m0 = s.totals().mass;
    for (let k = 0; k < 25; k++) expect(s.step().ok).toBe(true);
    let asym = 0;
    let moved = 0;
    for (let k = 0; k < n; k++)
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const a = s.cell(i, j, k).rho;
          // reflection in x, and exchanges of the axes
          for (const b of [s.cell(n - 1 - i, j, k).rho, s.cell(j, i, k).rho, s.cell(k, j, i).rho, s.cell(i, k, j).rho]) asym = Math.max(asym, Math.abs(a - b));
        }
    // the blast has reached a point on the x axis, a point on the z axis and a diagonal point equally far from the centre
    const ref = 1 + Math.exp(-(0.6875 ** 2) / 0.08);
    moved = Math.min(...[s.cell(13, 8, 8), s.cell(8, 8, 13), s.cell(11, 11, 11)].map((c) => Math.abs(c.rho - ref)));
    expect(asym).toBeLessThan(1e-10);
    expect(moved).toBeGreaterThan(1e-3);
    // radial outflow: velocity points away from the centre on all three axes
    expect(s.cell(12, 8, 8).u).toBeGreaterThan(0);
    expect(s.cell(8, 3, 8).v).toBeLessThan(0);
    expect(s.cell(8, 8, 12).w).toBeGreaterThan(0);
    expect(Math.abs(s.totals().mass / m0 - 1)).toBeLessThan(1e-12);
  });
});

describe('3D prototype: invalid-state detection', () => {
  it('an unstable CFL number is caught: failure reported with its cell, state restored, further steps refused', () => {
    const s = new EulerSolver3D(makeBoxGrid(0, 1, 0, 0.2, 0, 0.2, 60, 2, 2), { cfl: 3, order: 1, bc: { ...all('periodic'), xmin: 'extrapolate', xmax: 'extrapolate' } });
    s.init((x) => (x < 0.5 ? { rho: 1, u: 0, v: 0, w: 0, p: 1000 } : { rho: 1, u: 0, v: 0, w: 0, p: 0.01 }));
    let failed = false;
    for (let n = 0; n < 50 && !failed; n++) failed = !s.step().ok;
    expect(failed).toBe(true);
    expect(s.failure?.reason).toMatch(/non-positive|non-finite/);
    expect(s.failure!.i).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 60; i++) {
      const c = s.cell(i, 0, 0);
      expect(c.rho).toBeGreaterThan(0);
      expect(c.p).toBeGreaterThan(0);
    }
    expect(s.step().ok).toBe(false);
  });
});
