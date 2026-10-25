import { AxiEuler, type AxiPrimitive, polarGrid, rectGrid } from '../../src/lab/core/axisym';
import { sampleRiemann, starState } from '../../src/lab/core/riemann';

// Verification of the axisymmetric (x–r) Euler solver (axisym.ts; derivation in docs/axisymmetric-reference.md):
// exact geometric identities, preservation of uniform states including the axis, conservation and boundary-flux
// accounting, the Sod shock tube (exact Riemann solution), positivity, and a smooth exact solution that exercises the
// radial geometric source term (supersonic spherical source flow) under grid refinement.

const g = 1.4;
type Flux = 'rusanov' | 'hllc';
const fluxes: Flux[] = ['rusanov', 'hllc'];

/** isentropic area–Mach relation A/A*(M) */
const areaRatio = (M: number) => (1 / M) * Math.pow((2 / (g + 1)) * (1 + 0.5 * (g - 1) * M * M), (g + 1) / (2 * (g - 1)));
/** supersonic Mach number for a given A/A* (Newton) */
function supersonicMach(ar: number) {
  let M = 2.5;
  for (let k = 0; k < 60; k++) {
    const d = (areaRatio(M * (1 + 1e-7)) - areaRatio(M)) / (M * 1e-7);
    M = Math.max(1 + 1e-9, M - (areaRatio(M) - ar) / d);
  }
  return M;
}
/** exact steady spherical source flow centred at the origin: M = 2.5 at distance 1, stagnation ρ0 = p0 = 1 */
const AR1 = areaRatio(2.5);
function sourceFlow(x: number, r: number): AxiPrimitive {
  const d = Math.hypot(x, r);
  const M = supersonicMach(Math.max(1 + 1e-9, AR1 * d * d));
  const t = 1 + 0.5 * (g - 1) * M * M;
  const p = Math.pow(t, -g / (g - 1));
  const rho = Math.pow(t, -1 / (g - 1));
  const q = M * Math.sqrt((g * p) / rho);
  return { rho, u: (q * x) / d, v: (q * r) / d, p };
}

const sphereGrid = () => polarGrid(1, 3.2, 0, (95 * Math.PI) / 180, 22, 17);

describe('axisymmetric solver: geometry and exact invariants', () => {
  it('Σ n_r A_f = A and Σ n_x A_f = 0 hold to round-off on every cell (rectangular and body-fitted polar grids)', () => {
    const bc = { iMin: { type: 'wall' }, iMax: { type: 'wall' }, jMin: { type: 'axis' }, jMax: { type: 'wall' } } as const;
    expect(new AxiEuler(sphereGrid(), { cfl: 0.5, order: 2, bc }).geometryResidual()).toBeLessThan(1e-13);
    expect(new AxiEuler(rectGrid(-1, 1, 0, 0.7, 13, 9), { cfl: 0.5, order: 2, bc }).geometryResidual()).toBeLessThan(1e-13);
  });

  it('a declared axis must lie on r = 0, and the grid must stay in r ≥ 0', () => {
    expect(() => new AxiEuler(rectGrid(0, 1, 0.1, 1, 4, 4), { cfl: 0.5, order: 1, bc: { iMin: { type: 'wall' }, iMax: { type: 'wall' }, jMin: { type: 'axis' }, jMax: { type: 'wall' } } })).toThrow();
    expect(() => rectGrid(0, 1, -0.1, 1, 4, 4)).toThrow();
  });

  it.each(fluxes)('uniform axial flow on the polar grid, including the axis, stays uniform to round-off (%s)', (flux) => {
    const w0 = { rho: 1.2, u: 300, v: 0, p: 1e5 };
    const s = new AxiEuler(sphereGrid(), { cfl: 0.8, order: 2, flux, timeMode: 'local', bc: { iMin: { type: 'inflow', state: () => w0 }, iMax: { type: 'inflow', state: () => w0 }, jMin: { type: 'axis' }, jMax: { type: 'outflow' } } });
    s.init(() => w0);
    for (let k = 0; k < 50; k++) expect(s.step().ok).toBe(true);
    let worst = 0;
    for (let j = 0; j < 17; j++)
      for (let i = 0; i < 22; i++) {
        const c = s.cell(i, j);
        worst = Math.max(worst, Math.abs(c.rho / 1.2 - 1), Math.abs(c.p / 1e5 - 1), Math.abs(c.u - 300) / 300, Math.abs(c.v) / 300);
      }
    expect(worst).toBeLessThan(1e-12);
  });

  it.each(fluxes)('gas at rest around the sphere stays at rest: the p/r source balances the radial flux exactly (%s)', (flux) => {
    const r0 = { rho: 1.2, u: 0, v: 0, p: 1e5 };
    const s = new AxiEuler(sphereGrid(), { cfl: 0.8, order: 2, flux, timeMode: 'local', bc: { iMin: { type: 'wall' }, iMax: { type: 'wall' }, jMin: { type: 'axis' }, jMax: { type: 'wall' } } });
    s.init(() => r0);
    for (let k = 0; k < 50; k++) expect(s.step().ok).toBe(true);
    let worst = 0;
    for (let j = 0; j < 17; j++)
      for (let i = 0; i < 22; i++) {
        const c = s.cell(i, j);
        worst = Math.max(worst, (Math.abs(c.u) + Math.abs(c.v)) / 300, Math.abs(c.p / 1e5 - 1));
      }
    expect(worst).toBeLessThan(1e-12);
  });
});

describe('axisymmetric solver: conservation and boundary fluxes', () => {
  const blob = (x: number, r: number) => {
    const e = Math.exp(-((x - 0.1) ** 2 + (r - 0.3) ** 2) / 0.02);
    return { rho: 1 + 0.5 * e, u: 0.3, v: -0.2 * e, p: 1 + 2 * e };
  };

  it.each(fluxes)('closed domain (walls and axis): mass and energy conserved to round-off (%s)', (flux) => {
    const s = new AxiEuler(rectGrid(-1, 1, 0, 1, 20, 12), { cfl: 0.6, order: 2, flux, bc: { iMin: { type: 'wall' }, iMax: { type: 'wall' }, jMin: { type: 'axis' }, jMax: { type: 'wall' } } });
    s.init(blob);
    const a = s.totals();
    for (let k = 0; k < 40; k++) expect(s.step().ok).toBe(true);
    const b = s.totals();
    expect(Math.abs(b.mass / a.mass - 1)).toBeLessThan(1e-13);
    expect(Math.abs(b.energy / a.energy - 1)).toBeLessThan(1e-13);
  });

  it.each(fluxes)('open domain: the change of the total mass equals the time-integrated boundary mass flux (%s)', (flux) => {
    const s = new AxiEuler(rectGrid(-1, 1, 0, 1, 20, 12), { cfl: 0.6, order: 2, flux, bc: { iMin: { type: 'inflow', state: () => ({ rho: 1, u: 0.3, v: 0, p: 1 }) }, iMax: { type: 'outflow' }, jMin: { type: 'axis' }, jMax: { type: 'outflow' } } });
    s.init(blob);
    const a = s.totals();
    for (let k = 0; k < 40; k++) expect(s.step().ok).toBe(true);
    const b = s.totals();
    expect(Math.abs(b.mass - a.mass)).toBeGreaterThan(1e-3);
    expect(Math.abs(b.mass - a.mass - s.boundaryMassIntegral) / a.mass).toBeLessThan(1e-13);
    // the axis carries no flux at all
    expect(s.boundaryMassFlux.jMin).toBe(0);
  });

  it('a slip wall is exactly mass-tight: zero mass flux through the sphere surface in supersonic flow', () => {
    const w = { rho: 1, u: 2 * Math.sqrt(1.4), v: 0, p: 1 };
    const s = new AxiEuler(sphereGrid(), { cfl: 0.4, order: 2, flux: 'hllc', timeMode: 'local', bc: { iMin: { type: 'wall' }, iMax: { type: 'inflow', state: () => w }, jMin: { type: 'axis' }, jMax: { type: 'outflow' } } });
    s.init(() => w);
    for (let k = 0; k < 200; k++) {
      expect(s.step().ok).toBe(true);
      expect(Math.abs(s.boundaryMassFlux.iMin)).toBeLessThan(1e-14);
    }
  });
});

describe('axisymmetric solver: shock tube along the axis', () => {
  // Measured L1(ρ) at 100 / 200 / 400 cells — Rusanov 1st 0.0268 / 0.0183 / 0.0120, 2nd 0.0096 / 0.0053 / 0.0030;
  // HLLC 1st 0.0209 / 0.0133 / 0.0084, 2nd 0.0077 / 0.0042 / 0.0024 (the same values as the independent 3D solver)
  const L = { rho: 1, u: 0, p: 1 };
  const R = { rho: 0.125, u: 0, p: 0.1 };
  const star = starState(L, R);
  const sod = (flux: Flux, n: number, order: 1 | 2) => {
    const s = new AxiEuler(rectGrid(0, 1, 0, 0.05, n, 3), { cfl: 0.5, order, flux, bc: { iMin: { type: 'outflow' }, iMax: { type: 'outflow' }, jMin: { type: 'axis' }, jMax: { type: 'wall' } } });
    s.init((x) => (x < 0.5 ? { rho: 1, u: 0, v: 0, p: 1 } : { rho: 0.125, u: 0, v: 0, p: 0.1 }));
    while (s.time < 0.2 - 1e-14) expect(s.stepTo(0.2).ok).toBe(true);
    let err = 0;
    let rowDiff = 0;
    let vmax = 0;
    for (let i = 0; i < n; i++) {
      const c = s.cell(i, 0);
      err += Math.abs(c.rho - sampleRiemann(L, R, ((i + 0.5) / n - 0.5) / 0.2, g, star).rho) / n;
      for (let j = 0; j < 3; j++) {
        rowDiff = Math.max(rowDiff, Math.abs(s.cell(i, j).rho - c.rho));
        vmax = Math.max(vmax, Math.abs(s.cell(i, j).v));
      }
    }
    return { err, rowDiff, vmax };
  };

  it.each(fluxes)('Sod: converges to the exact solution; every radial row identical and v = 0 to round-off (%s)', (flux) => {
    for (const order of [1, 2] as const) {
      const a = sod(flux, 200, order);
      const b = sod(flux, 400, order);
      expect(a.err).toBeLessThan(order === 1 ? 0.019 : 0.0055);
      expect(a.err / b.err).toBeGreaterThan(1.45);
      expect(a.rowDiff).toBeLessThan(1e-12);
      expect(a.vmax).toBeLessThan(1e-11);
    }
  });

  it.each(fluxes)('two strong rarefactions (123 problem): density and pressure stay positive (%s)', (flux) => {
    const s = new AxiEuler(rectGrid(0, 1, 0, 0.05, 200, 3), { cfl: 0.5, order: 2, flux, bc: { iMin: { type: 'outflow' }, iMax: { type: 'outflow' }, jMin: { type: 'axis' }, jMax: { type: 'wall' } } });
    s.init((x) => (x < 0.5 ? { rho: 1, u: -2, v: 0, p: 0.4 } : { rho: 1, u: 2, v: 0, p: 0.4 }));
    while (s.time < 0.15 - 1e-14) expect(s.stepTo(0.15).ok).toBe(true);
    expect(s.minRho).toBeGreaterThan(0.01);
    expect(s.minP).toBeGreaterThan(0.001);
    if (flux === 'hllc') expect(s.hllcFallbacksTotal / s.hllcCalls).toBeLessThan(1e-3);
  });
});

describe('axisymmetric solver: exact spherical source flow (geometric source term, grid refinement)', () => {
  // Steady supersonic source flow between distances 1 and 2 from the origin, θ ∈ [0, 90°] on the polar grid: exact
  // inflow state, extrapolated outflow, axis at θ = 0, slip wall on the plane x = 0 (the flow is tangent to it).
  // The flow is radial (v ≠ 0 off the axis), so the p/r source and the axis treatment both matter.
  const run = (flux: Flux, N: number, steps: number) => {
    const nth = Math.round(1.5 * (Math.PI / 2) * N);
    const s = new AxiEuler(polarGrid(1, 2, 0, Math.PI / 2, N, nth), { cfl: 0.4, order: 2, flux, timeMode: 'local', bc: { iMin: { type: 'inflow', state: sourceFlow }, iMax: { type: 'outflow' }, jMin: { type: 'axis' }, jMax: { type: 'wall' } } });
    s.init((x, r) => {
      const e = sourceFlow(x, r);
      return { ...e, rho: e.rho * 1.05 };
    });
    for (let k = 0; k < steps; k++) expect(s.step().ok).toBe(true);
    let err = 0;
    let vol = 0;
    let spread = 0;
    for (let j = 0; j < nth; j++)
      for (let i = 0; i < N; i++) {
        const c = j * N + i;
        err += s.vol[c] * Math.abs(s.cell(i, j).rho - sourceFlow(s.xc[c], s.rc[c]).rho);
        vol += s.vol[c];
      }
    for (let i = 0; i < N; i++) {
      const col = Array.from({ length: nth }, (_, j) => s.cell(i, j).rho);
      spread = Math.max(spread, Math.max(...col) - Math.min(...col));
    }
    return { l1: err / vol, spread };
  };

  it.each(fluxes)('second-order convergence to the exact solution and spherical symmetry across the axis (%s)', (flux) => {
    // measured (Rusanov): L1(ρ) 4.5e-4 / 1.2e-4 / 3.2e-5 at N = 16 / 32 / 64, observed order 1.9
    const a = run(flux, 16, 800);
    const b = run(flux, 32, 1600);
    expect(b.l1).toBeLessThan(2e-4);
    expect(Math.log2(a.l1 / b.l1)).toBeGreaterThan(1.7);
    expect(b.spread).toBeLessThan(a.spread);
    expect(b.spread).toBeLessThan(5e-5);
  });
});
