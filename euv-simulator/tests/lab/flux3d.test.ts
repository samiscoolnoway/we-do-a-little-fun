import { type BC3D, EulerSolver3D, type Primitive3D, makeBoxGrid } from '../../src/lab/core/euler3d';
import { normalShock } from '../../src/lab/core/gas';
import { sampleRiemann, starState } from '../../src/lab/core/riemann';

// Experimental HLLC flux of the 3D prototype against the default Rusanov flux: consistency, contacts and shocks
// (where the two differ by design), admissibility near vacuum with the counted Rusanov fallback, conservation and
// symmetry. Exact references only: uniform states, the exact Riemann solution, Rankine–Hugoniot states.
const all = (b: BC3D) => ({ xmin: b, xmax: b, ymin: b, ymax: b, zmin: b, zmax: b });
type Flux = 'rusanov' | 'hllc';
type State = { rho: number; u: number; p: number };

/** 1D problem along `axis` (extrapolated ends, 2 periodic cells across), CFL 0.5, to time tEnd */
function tube(flux: Flux, n: number, order: 1 | 2, L: State, R: State, tEnd: number, axis: 0 | 1 | 2 = 0) {
  const dims = [2, 2, 2];
  dims[axis] = n;
  const ext = [0.1, 0.1, 0.1];
  ext[axis] = 1;
  const bc = { ...all('periodic') } as Record<string, BC3D>;
  const [lo, hi] = [['xmin', 'xmax'], ['ymin', 'ymax'], ['zmin', 'zmax']][axis];
  bc[lo] = 'extrapolate';
  bc[hi] = 'extrapolate';
  const s = new EulerSolver3D(makeBoxGrid(0, ext[0], 0, ext[1], 0, ext[2], dims[0], dims[1], dims[2]), { cfl: 0.5, order, flux, bc: bc as never });
  const vel = (st: State) => [st.u, 0, 0].map((_, d) => (d === axis ? st.u : 0));
  s.init((x, y, z) => {
    const st = [x, y, z][axis] < 0.5 ? L : R;
    const [u, v, w] = vel(st);
    return { rho: st.rho, u, v, w, p: st.p };
  });
  let ok = true;
  while (s.time < tEnd - 1e-14) if (!s.stepTo(tEnd).ok) ok = false;
  const profile: { rho: number; p: number }[] = [];
  for (let m = 0; m < n; m++) {
    const idx = [0, 0, 0];
    idx[axis] = m;
    const c = s.cell(idx[0], idx[1], idx[2]);
    profile.push({ rho: c.rho, p: c.p });
  }
  const l1 = () => {
    const star = starState(L, R);
    return profile.reduce((e, c, m) => e + Math.abs(c.rho - sampleRiemann(L, R, ((m + 0.5) / n - 0.5) / tEnd, 1.4, star).rho) / n, 0);
  };
  return { s, ok, profile, l1 };
}

describe('HLLC flux: consistency and exact properties', () => {
  it('a uniform flow in an arbitrary direction stays uniform to round-off, with no fallback', () => {
    const s = new EulerSolver3D(makeBoxGrid(0, 1, 0, 0.8, 0, 0.6, 10, 8, 6), { cfl: 0.8, order: 2, flux: 'hllc', bc: all('periodic') });
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
    expect(s.hllcFallbacksTotal).toBe(0);
    expect(s.hllcCalls).toBeGreaterThan(0);
  });

  it('a stationary contact is kept exactly along x, y and z (Rusanov smears it)', () => {
    for (const axis of [0, 1, 2] as const)
      for (const order of [1, 2] as const) {
        const h = tube('hllc', 60, order, { rho: 1, u: 0, p: 1 }, { rho: 0.1, u: 0, p: 1 }, 0.5, axis);
        expect(h.profile.every((c, m) => c.rho === (m < 30 ? 1 : 0.1) && Math.abs(c.p - 1) < 1e-14)).toBe(true);
      }
    const r = tube('rusanov', 60, 2, { rho: 1, u: 0, p: 1 }, { rho: 0.1, u: 0, p: 1 }, 0.5);
    expect(r.profile.filter((c) => c.rho > 0.11 && c.rho < 0.99).length).toBeGreaterThan(4);
  });

  it('a stationary Mach 2 normal shock is kept exactly (no intermediate cell, no drift); Rusanov smears and shifts it', () => {
    const ns = normalShock(2);
    const a1 = Math.sqrt(1.4);
    const up = { rho: 1, u: 2 * a1, v: 0, w: 0, p: 1 };
    const down = { rho: ns.r21, u: (2 * a1) / ns.r21, v: 0, w: 0, p: ns.p21 };
    const run = (flux: Flux) => {
      const s = new EulerSolver3D(makeBoxGrid(0, 1, 0, 0.05, 0, 0.05, 40, 2, 2), { cfl: 0.5, order: 2, flux, freestream: up, bc: { ...all('periodic'), xmin: 'inflow', xmax: 'extrapolate' } });
      s.init((x) => (x < 0.5 ? up : down));
      for (let k = 0; k < 400; k++) expect(s.step().ok).toBe(true);
      return Array.from({ length: 40 }, (_, i) => s.cell(i, 0, 0).rho);
    };
    const hllc = run('hllc');
    expect(hllc.every((r, i) => Math.abs(r - (i < 20 ? 1 : ns.r21)) < 1e-12)).toBe(true);
    // measured: Rusanov leaves 6 cells inside the jump and moves its mid-density point 0.4 cells upstream
    const rus = run('rusanov');
    expect(rus.filter((r) => r > 1.03 && r < ns.r21 - 0.03).length).toBeGreaterThan(3);
  });
});

describe('HLLC flux: accuracy and admissibility', () => {
  // Measured L1(ρ) at 100 / 200 / 400 cells: Rusanov 1st 0.0268 / 0.0183 / 0.0120, 2nd 0.0096 / 0.0053 / 0.0030;
  // HLLC 1st 0.0209 / 0.0133 / 0.0084, 2nd 0.0077 / 0.0042 / 0.0024
  const sodL = { rho: 1, u: 0, p: 1 };
  const sodR = { rho: 0.125, u: 0, p: 0.1 };

  it('Sod shock tube: lower error than Rusanov at first and second order, converging, the same along every axis', () => {
    for (const order of [1, 2] as const) {
      const h200 = tube('hllc', 200, order, sodL, sodR, 0.2);
      expect(h200.ok).toBe(true);
      expect(h200.s.hllcFallbacksTotal).toBe(0);
      expect(h200.l1()).toBeLessThan(tube('rusanov', 200, order, sodL, sodR, 0.2).l1());
      expect(h200.l1() / tube('hllc', 400, order, sodL, sodR, 0.2).l1()).toBeGreaterThan(1.4);
      for (const axis of [1, 2] as const) {
        const o = tube('hllc', 200, order, sodL, sodR, 0.2, axis);
        for (let m = 0; m < 200; m++) expect(Math.abs(o.profile[m].rho - h200.profile[m].rho)).toBeLessThan(1e-12);
      }
    }
  });

  it('two strong rarefactions (123 problem) and a near-vacuum pair: positive states, the rare inadmissible faces fall back and are counted', () => {
    // measured: 32 of 1.1e6 HLLC evaluations fall back (the star pressure estimate turns negative between the fans)
    for (const [L, R, t] of [
      [{ rho: 1, u: -2, p: 0.4 }, { rho: 1, u: 2, p: 0.4 }, 0.15],
      [{ rho: 1, u: -3.5, p: 0.4 }, { rho: 1, u: 3.5, p: 0.4 }, 0.1],
    ] as [State, State, number][]) {
      const h = tube('hllc', 200, 2, L, R, t);
      expect(h.ok).toBe(true);
      expect(Math.min(...h.profile.map((c) => c.rho))).toBeGreaterThan(0);
      expect(Math.min(...h.profile.map((c) => c.p))).toBeGreaterThan(0);
      expect(h.s.hllcFallbacksTotal).toBeGreaterThan(0);
      expect(h.s.hllcFallbacksTotal / h.s.hllcCalls).toBeLessThan(1e-3);
      // the solution is still accurate: within 15 % of Rusanov's error on the same grid
      expect(h.l1()).toBeLessThan(1.15 * tube('rusanov', 200, 2, L, R, t).l1());
    }
  });

  it('Woodward–Colella blast (pressure ratio 1e5): stable, no fallback, positive density', () => {
    const h = tube('hllc', 200, 2, { rho: 1, u: 0, p: 1000 }, { rho: 1, u: 0, p: 0.01 }, 0.012);
    expect(h.ok).toBe(true);
    expect(h.s.hllcFallbacksTotal).toBe(0);
    expect(Math.min(...h.profile.map((c) => c.rho))).toBeGreaterThan(0);
  });
});

describe('HLLC flux: conservation and symmetry', () => {
  const blob = (x: number, y: number, z: number): Primitive3D => {
    const d2 = ((x - 0.45) ** 2 + (y - 0.5) ** 2 + (z - 0.55) ** 2) / 0.04;
    return { rho: 1 + 0.5 * Math.exp(-d2), u: 0.3, v: -0.2, w: 0.1, p: 1 + 2 * Math.exp(-d2) };
  };

  it('periodic box: mass, momentum and energy to round-off; closed box: mass and energy', () => {
    const p = new EulerSolver3D(makeBoxGrid(0, 1, 0, 1, 0, 1, 12, 10, 8), { cfl: 0.6, order: 2, flux: 'hllc', bc: all('periodic') });
    p.init(blob);
    const a = p.totals();
    for (let n = 0; n < 40; n++) expect(p.step().ok).toBe(true);
    const b = p.totals();
    for (const k of ['mass', 'energy', 'momX', 'momY', 'momZ'] as const) expect(Math.abs(b[k] / a[k] - 1)).toBeLessThan(1e-12);
    const c = new EulerSolver3D(makeBoxGrid(0, 1, 0, 1, 0, 1, 10, 10, 10), { cfl: 0.6, order: 2, flux: 'hllc', bc: all('wall') });
    c.init(blob);
    const a2 = c.totals();
    for (let n = 0; n < 40; n++) expect(c.step().ok).toBe(true);
    const b2 = c.totals();
    expect(Math.abs(b2.mass / a2.mass - 1)).toBeLessThan(1e-12);
    expect(Math.abs(b2.energy / a2.energy - 1)).toBeLessThan(1e-12);
  });

  it('a spherical blast stays mirror- and axis-symmetric', () => {
    const n = 16;
    const s = new EulerSolver3D(makeBoxGrid(-1, 1, -1, 1, -1, 1, n, n, n), { cfl: 0.6, order: 2, flux: 'hllc', bc: all('wall') });
    s.init((x, y, z) => {
      const e = Math.exp(-(x * x + y * y + z * z) / 0.08);
      return { rho: 1 + e, u: 0, v: 0, w: 0, p: 1 + 9 * e };
    });
    for (let k = 0; k < 25; k++) expect(s.step().ok).toBe(true);
    let asym = 0;
    for (let k = 0; k < n; k++)
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const a = s.cell(i, j, k).rho;
          for (const b of [s.cell(n - 1 - i, j, k).rho, s.cell(j, i, k).rho, s.cell(k, j, i).rho, s.cell(i, k, j).rho]) asym = Math.max(asym, Math.abs(a - b));
        }
    expect(asym).toBeLessThan(1e-10);
    expect(s.hllcFallbacksTotal).toBe(0);
  });

  it('cut-cell sphere in a closed box with moving gas: no mass crosses the body, mass and energy conserved to round-off', () => {
    const n = 14;
    const s = new EulerSolver3D(makeBoxGrid(-1, 1, -1, 1, -1, 1, n, n, n), { cfl: 0.6, order: 2, flux: 'hllc', sphere: { cx: 0.05, cy: -0.07, cz: 0.04, r: 0.4, wall: 'cutcell' }, bc: all('wall') });
    s.init((x, y, z) => ({ rho: 1.2 + 0.1 * Math.exp(-((x + 0.6) ** 2 + y * y + z * z) * 20), u: 150, v: 40, w: -25, p: 1e5 }));
    const vol = (2 / n) ** 3;
    const tot = () => {
      let m = 0;
      let e = 0;
      for (let k = 0; k < n; k++)
        for (let j = 0; j < n; j++)
          for (let i = 0; i < n; i++) {
            const a = s.fluidFraction(i, j, k);
            if (!a) continue;
            const c = s.cell(i, j, k);
            m += a * vol * c.rho;
            e += a * vol * (c.p / 0.4 + 0.5 * c.rho * (c.u ** 2 + c.v ** 2 + c.w ** 2));
          }
      return { m, e };
    };
    const before = tot();
    for (let k = 0; k < 60; k++) {
      expect(s.step().ok).toBe(true);
      expect(s.bodyMassFlux).toBe(0);
    }
    const after = tot();
    expect(Math.abs(after.m / before.m - 1)).toBeLessThan(1e-13);
    expect(Math.abs(after.e / before.e - 1)).toBeLessThan(1e-13);
  });
});
