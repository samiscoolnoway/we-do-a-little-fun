import { EulerSolver, type SolverOptions } from '../src/core/euler';
import { freestream, type Primitive } from '../src/core/gas';
import { makeOGrid, makeRectMesh } from '../src/core/mesh';
import { sampleRiemann, starState } from '../src/core/riemann';

const base = (over: Partial<SolverOptions>): SolverOptions => ({
  cfl: 0.5,
  order: 2,
  limiter: 'minmod',
  timeMode: 'global',
  bc: { imin: 'extrapolate', imax: 'extrapolate', jmin: 'wall', jmax: 'wall' },
  freestream: { rho: 1, u: 0, v: 0, p: 1 },
  ...over,
});

describe('mesh geometry', () => {
  it('rectangular mesh: areas and face vectors are exact', () => {
    const m = makeRectMesh(0, 2, 0, 1, 20, 10);
    for (let c = 0; c < m.area.length; c++) expect(m.area[c]).toBeCloseTo(0.01, 14);
    expect(m.inx[5]).toBeCloseTo(0.1, 14);
    expect(m.iny[5]).toBeCloseTo(0, 14);
    expect(m.jny[5]).toBeCloseTo(0.1, 14);
  });

  it('O-grid: every cell is closed (Σ face vectors = 0) and the total area equals annulus area', () => {
    const m = makeOGrid({ body: { kind: 'cylinder', radius: 0.5, aspect: 1 }, ni: 96, nj: 48, outer: 12, firstSpacing: 0.01 });
    let worst = 0;
    let total = 0;
    for (let j = 0; j < m.nj; j++)
      for (let i = 0; i < m.ni; i++) {
        const sx = m.inx[j * (m.ni + 1) + i + 1] - m.inx[j * (m.ni + 1) + i] + m.jnx[(j + 1) * m.ni + i] - m.jnx[j * m.ni + i];
        const sy = m.iny[j * (m.ni + 1) + i + 1] - m.iny[j * (m.ni + 1) + i] + m.jny[(j + 1) * m.ni + i] - m.jny[j * m.ni + i];
        worst = Math.max(worst, Math.hypot(sx, sy) / Math.sqrt(m.area[j * m.ni + i]));
        total += m.area[j * m.ni + i];
      }
    expect(worst).toBeLessThan(1e-12);
    // polygonal annulus: area of the 96-gon on the outer circle minus that on the body
    const poly = (r: number) => 0.5 * 96 * r * r * Math.sin((2 * Math.PI) / 96);
    expect(Math.abs(total - (poly(6) - poly(0.5))) / total).toBeLessThan(1e-12);
    // cell 0 is centred on the stagnation line (θ = π, upstream side)
    expect(m.yc[0]).toBeCloseTo(0, 12);
    expect(m.xc[0]).toBeLessThan(-0.5);
  });

  it('O-grid wall-normal spacing follows the requested first-cell size', () => {
    const m = makeOGrid({ body: { kind: 'ellipse', radius: 0.5, aspect: 0.6 }, ni: 64, nj: 40, outer: 10, firstSpacing: 0.004 });
    // node (0,0) → (0,1) along the first radial line, relative to body half-height 0.5
    const d = Math.hypot(m.x[m.ni + 1] - m.x[0], m.y[m.ni + 1] - m.y[0]);
    expect(Math.abs(d / 0.5 - 0.004) / 0.004).toBeLessThan(0.05);
  });
});

describe('uniform freestream is preserved (free-stream preservation / geometric conservation)', () => {
  // Tolerance: maximum relative deviation of any primitive variable after 50 steps ≤ 1e-11.
  // A uniform state must remain uniform to round-off on any closed-cell mesh; errors above round-off indicate a
  // metric (face vector) or boundary-condition bug.
  const check = (order: 1 | 2, fs: Primitive & { mach: number }) => {
    const m = makeOGrid({ body: { kind: 'cylinder', radius: 0.5, aspect: 1 }, ni: 64, nj: 32, outer: 8, firstSpacing: 0.01 });
    const s = new EulerSolver(m, base({ order, bc: { imin: 'periodic', imax: 'periodic', jmin: 'farfield', jmax: 'farfield' }, freestream: fs }));
    s.init(() => fs);
    for (let k = 0; k < 50; k++) expect(s.step().ok).toBe(true);
    let worst = 0;
    const V = Math.hypot(fs.u, fs.v);
    for (let j = 0; j < m.nj; j++)
      for (let i = 0; i < m.ni; i++) {
        const c = s.cell(i, j);
        worst = Math.max(worst, Math.abs(c.rho - fs.rho) / fs.rho, Math.abs(c.p - fs.p) / fs.p, Math.abs(c.u - fs.u) / V, Math.abs(c.v - fs.v) / V);
      }
    return worst;
  };
  it('subsonic M = 0.5, first order', () => expect(check(1, freestream(0.5, 288.15, 101325, 0))).toBeLessThan(1e-11));
  it('supersonic M = 3, 7° incidence, second order', () => expect(check(2, freestream(3, 220, 2500, 7))).toBeLessThan(1e-11));
});

describe('Sod shock tube vs the exact Riemann solution', () => {
  // Domain [0, 1], diaphragm at x = 0.5, t = 0.2, γ = 1.4, CFL 0.5, nj = 2 with slip walls in y (exactly 1D).
  //
  // Tolerance history (kept honest): the first tolerances (L1(ρ) ≤ 0.012 first order, ≤ 0.0045 second order at 200
  // cells) were guesses based on Godunov/Roe-type fluxes and were never met. A grid-convergence study then gave, for
  // this Rusanov scheme, L1(ρ) at 100/200/400/800 cells:
  //   first order          0.0268  0.0183  0.0120  0.0077   (≈1.5× per halving)
  //   second order minmod  0.0097  0.0053  0.0030  0.0017   (≈1.75× per halving)
  //   second order v.Alb.  0.0078  0.0041  0.0023  0.0013
  // with the star-region plateau converging to Toro's p* = 0.30313, u* = 0.92745. Rusanov is known to smear the
  // contact discontinuity more than Godunov-type fluxes, which explains the gap. The tolerances below sit ≈10 %
  // above those measurements, and convergence plus plateau accuracy are checked in addition.
  const L = { rho: 1, u: 0, p: 1 };
  const R = { rho: 0.125, u: 0, p: 0.1 };
  const star = starState(L, R);
  const run = (n: number, order: 1 | 2, limiter: 'minmod' | 'vanalbada' = 'minmod') => {
    const m = makeRectMesh(0, 1, 0, 0.1, n, 2);
    const s = new EulerSolver(m, base({ order, limiter }));
    s.init((x) => (x < 0.5 ? { ...L, v: 0 } : { ...R, v: 0 }));
    const tEnd = 0.2;
    while (s.time < tEnd - 1e-14) expect(s.stepTo(tEnd).ok).toBe(true);
    let err = 0;
    let errP = 0;
    let errU = 0;
    for (let i = 0; i < n; i++) {
      const c = s.cell(i, 0);
      const ex = sampleRiemann(L, R, (m.xc[i] - 0.5) / tEnd, 1.4, star);
      err += Math.abs(c.rho - ex.rho) / n;
      errP += Math.abs(c.p - ex.p) / n;
      errU += Math.abs(c.u - ex.u) / n;
      // exactly one-dimensional: both rows identical
      expect(Math.abs(s.cell(i, 1).rho - c.rho)).toBeLessThan(1e-13);
    }
    // a cell inside the star region between the contact (x ≈ 0.685) and the shock (x ≈ 0.850)
    const plateau = s.cell(Math.floor(0.78 * n), 0);
    return { err, errP, errU, time: s.time, plateau };
  };

  it('first order: error level and convergence under refinement', () => {
    const r200 = run(200, 1);
    const r400 = run(400, 1);
    expect(r200.time).toBeCloseTo(0.2, 13);
    expect(r200.err).toBeLessThan(0.020);
    expect(r400.err).toBeLessThan(0.0132);
    expect(r200.err / r400.err).toBeGreaterThan(1.4);
  });
  it('second order (minmod): error level, convergence and star-state plateau', () => {
    const r200 = run(200, 2);
    const r400 = run(400, 2);
    expect(r200.err).toBeLessThan(0.0058);
    expect(r400.err).toBeLessThan(0.0033);
    expect(r200.err / r400.err).toBeGreaterThan(1.6);
    expect(r200.errP).toBeLessThan(0.004);
    expect(r200.errU).toBeLessThan(0.012);
    expect(Math.abs(r400.plateau.p - star.p) / star.p).toBeLessThan(1e-3);
    expect(Math.abs(r400.plateau.u - star.u) / star.u).toBeLessThan(1e-3);
  });
  it('second order (van Albada) is at least as accurate as minmod', () => {
    const va = run(200, 2, 'vanalbada');
    expect(va.err).toBeLessThan(0.0046);
    expect(va.err).toBeLessThan(run(200, 2, 'minmod').err);
  });
});

describe('conservation in closed domains', () => {
  // Tolerance: |ΔM| / M and |ΔE| / E ≤ 1e-12 after 200 steps (round-off only). Momentum is not conserved because
  // the walls push on the gas.
  const blob = (x: number, y: number, cx: number, cy: number, r: number): Primitive => {
    const d2 = ((x - cx) ** 2 + (y - cy) ** 2) / (r * r);
    return { rho: 1 + 0.5 * Math.exp(-d2), u: 0.1, v: -0.05, p: 1 + 2 * Math.exp(-d2) };
  };
  it('rectangular box with four slip walls', () => {
    const m = makeRectMesh(0, 1, 0, 1, 40, 40);
    const s = new EulerSolver(m, base({ bc: { imin: 'wall', imax: 'wall', jmin: 'wall', jmax: 'wall' } }));
    s.init((x, y) => blob(x, y, 0.4, 0.55, 0.15));
    const t0 = s.totals();
    for (let k = 0; k < 200; k++) expect(s.step().ok).toBe(true);
    const t1 = s.totals();
    expect(Math.abs(t1.mass - t0.mass) / t0.mass).toBeLessThan(1e-12);
    expect(Math.abs(t1.energy - t0.energy) / t0.energy).toBeLessThan(1e-12);
  });
  it('curved annulus (O-grid with walls on the body and the outer circle), including the periodic seam', () => {
    const m = makeOGrid({ body: { kind: 'ellipse', radius: 0.5, aspect: 0.7 }, ni: 64, nj: 24, outer: 3, firstSpacing: 0.02 });
    const s = new EulerSolver(m, base({ bc: { imin: 'periodic', imax: 'periodic', jmin: 'wall', jmax: 'wall' } }));
    s.init((x, y) => blob(x, y, -0.8, 0.05, 0.25));
    const t0 = s.totals();
    for (let k = 0; k < 200; k++) expect(s.step().ok).toBe(true);
    const t1 = s.totals();
    expect(Math.abs(t1.mass - t0.mass) / t0.mass).toBeLessThan(1e-12);
    expect(Math.abs(t1.energy - t0.energy) / t0.energy).toBeLessThan(1e-12);
  });
});

describe('time step and invalid-state detection', () => {
  it('global Δt follows the CFL formula on a uniform mesh', () => {
    const m = makeRectMesh(0, 1, 0, 0.5, 20, 10);
    const w = { rho: 1.2, u: 50, v: 20, p: 1e5 };
    const s = new EulerSolver(m, base({ cfl: 0.8, bc: { imin: 'extrapolate', imax: 'extrapolate', jmin: 'extrapolate', jmax: 'extrapolate' }, freestream: w }));
    s.init(() => w);
    const r = s.step();
    const c = Math.sqrt((1.4 * w.p) / w.rho);
    expect(r.dt).toBeCloseTo(0.8 / ((50 + c) / 0.05 + (20 + c) / 0.05), 15);
  });

  it('a step that would create negative pressure is refused, reported, and the previous state is restored', () => {
    const m = makeRectMesh(0, 1, 0, 0.1, 100, 2);
    // violent blast with a far too large CFL number: the solver must not continue with garbage
    const s = new EulerSolver(m, base({ cfl: 3, order: 1 }));
    s.init((x) => (x < 0.5 ? { rho: 1, u: 0, v: 0, p: 1000 } : { rho: 1, u: 0, v: 0, p: 0.01 }));
    const before = s.totals();
    let failed = false;
    for (let k = 0; k < 50 && !failed; k++) failed = !s.step().ok;
    expect(failed).toBe(true);
    expect(s.failure).not.toBeNull();
    expect(s.failure!.reason).toMatch(/non-positive|non-finite/);
    expect(s.failure!.i).toBeGreaterThanOrEqual(0);
    // restored state is the last valid one: finite and physical everywhere
    for (let i = 0; i < 100; i++) {
      const c = s.cell(i, 0);
      expect(c.rho).toBeGreaterThan(0);
      expect(c.p).toBeGreaterThan(0);
    }
    expect(Number.isFinite(s.totals().energy)).toBe(true);
    expect(before.mass).toBeGreaterThan(0);
    // further steps are refused until the solver is re-initialised
    expect(s.step().ok).toBe(false);
  });
});
