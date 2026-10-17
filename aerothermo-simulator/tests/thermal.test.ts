import { DEFAULT_CONFIG, cloneConfig, type ThermalConfig } from '../src/core/config';
import { radiativeEquilibrium } from '../src/core/heating';
import { erfc, semiInfiniteConstantFlux, solveConduction, thomas } from '../src/core/thermal';

const cfg = (over: Partial<ThermalConfig>): ThermalConfig => ({ ...cloneConfig(DEFAULT_CONFIG).thermal, ...over });
const constFlux = (q: number) => () => ({ q, dqdT: 0 });

describe('numerical building blocks', () => {
  it('Thomas algorithm solves a tridiagonal system exactly', () => {
    const a = Float64Array.from([0, -1, -2, -1]);
    const b = Float64Array.from([4, 5, 6, 3]);
    const c = Float64Array.from([-1, -2, -1, 0]);
    const xTrue = [1, -2, 3, 0.5];
    const d = new Float64Array(4);
    for (let i = 0; i < 4; i++) d[i] = b[i] * xTrue[i] + (i > 0 ? a[i] * xTrue[i - 1] : 0) + (i < 3 ? c[i] * xTrue[i + 1] : 0);
    const x = thomas(a, b, c, d);
    for (let i = 0; i < 4; i++) expect(x[i]).toBeCloseTo(xTrue[i], 12);
  });
  it('erfc matches reference values', () => {
    expect(erfc(0)).toBeCloseTo(1, 7);
    expect(erfc(0.5)).toBeCloseTo(0.4795001222, 6);
    expect(erfc(1.5)).toBeCloseTo(0.0338948535, 6);
    expect(erfc(-1)).toBeCloseTo(1.8427007929, 6);
  });
});

describe('verification against analytical solutions', () => {
  // Semi-infinite solid, constant surface flux (Carslaw & Jaeger; Incropera eq. 5.59):
  //   T(x,t) = T0 + (2q/k)√(αt/π) exp(−x²/4αt) − (qx/k) erfc(x/2√(αt))
  // A slab of 0.1 m with α = 1.19e-6 m²/s heated for 20 s: penetration depth √(αt) ≈ 4.9 mm ≪ L, so the back face
  // never feels the heating and the slab behaves as semi-infinite.
  // Refinement study (relative error of the surface temperature rise at t = 20 s, exact rise 275.3 K):
  //   N = 801:  500 steps −2.9e-4,  1000 −1.7e-4,  2000 −1.0e-4,  4000 −7.2e-5   (first order in time)
  //   4000 steps:  N = 201 −6.9e-4,  N = 401 −2.0e-4,  N = 801 −7.2e-5           (second order in space)
  // Tolerances: 2e-4 on the surface and at 3 mm depth (N = 801, 4000 steps), 1e-3 along the history.
  const mat = { rho: 280, cp: 1200, k: 0.4, T0: 300 };
  const q = 2e4;
  const tEnd = 20;
  const run = (nodes: number, steps: number) => solveConduction(cfg({ ...mat, thickness: 0.1, duration: tEnd, nodes, rear: 'adiabatic', emissivity: 0 }), { H: 0, Taw: 0 }, steps, constFlux(q));

  it('surface temperature of a semi-infinite solid under constant flux', () => {
    const r = run(801, 4000);
    const exact = semiInfiniteConstantFlux(q, tEnd, mat.k, mat.rho, mat.cp, mat.T0);
    const rise = exact - mat.T0;
    expect(Math.abs(r.Tsurf[r.Tsurf.length - 1] - exact) / rise).toBeLessThan(2e-4);
    // interior point 3 mm deep
    const i3 = Math.round(0.003 / (0.1 / 800));
    const ex3 = semiInfiniteConstantFlux(q, tEnd, mat.k, mat.rho, mat.cp, mat.T0, 0.003);
    expect(Math.abs(r.profile[i3] - ex3) / rise).toBeLessThan(2e-4);
    // the whole surface history follows the √t law
    for (let k = Math.floor(r.t.length / 4); k < r.t.length; k += 50) {
      const e = semiInfiniteConstantFlux(q, r.t[k], mat.k, mat.rho, mat.cp, mat.T0);
      expect(Math.abs(r.Tsurf[k] - e) / (e - mat.T0)).toBeLessThan(1e-3);
    }
  });

  it('error decreases under refinement (first order in time for backward Euler)', () => {
    const exact = semiInfiniteConstantFlux(q, tEnd, mat.k, mat.rho, mat.cp, mat.T0);
    const e1 = Math.abs(run(801, 500).Tsurf.at(-1)! - exact);
    const e2 = Math.abs(run(801, 1000).Tsurf.at(-1)! - exact);
    const e3 = Math.abs(run(801, 2000).Tsurf.at(-1)! - exact);
    expect(e1 / e2).toBeGreaterThan(1.6);
    expect(e2 / e3).toBeGreaterThan(1.5);
    // space: second order (≈ 3.5× per halving of Δx at fine Δt)
    const s1 = Math.abs(run(201, 4000).Tsurf.at(-1)! - exact);
    const s2 = Math.abs(run(401, 4000).Tsurf.at(-1)! - exact);
    expect(s1 / s2).toBeGreaterThan(3);
  });

  it('steady state with a fixed back-face temperature is the linear profile T = T_rear + q (L − x) / k', () => {
    const L = 0.01;
    const k = 15;
    const r = solveConduction(cfg({ rho: 7900, cp: 477, k, thickness: L, nodes: 41, rear: 'fixed', Trear: 300, T0: 300, duration: 200, emissivity: 0 }), { H: 0, Taw: 0 }, 400, constFlux(1e5));
    // L²/α = 0.0001 / 3.98e-6 ≈ 25 s ≪ 200 s
    for (let i = 0; i < r.x.length; i++) expect(Math.abs(r.profile[i] - (300 + (1e5 * (L - r.x[i])) / k))).toBeLessThan(1e-6);
  });

  it('adiabatic back face, long exposure: the surface tends to radiative equilibrium H(T_aw − T) = εσT⁴', () => {
    const H = 60;
    const Taw = 1500;
    const r = solveConduction(cfg({ rho: 2700, cp: 900, k: 200, thickness: 0.002, nodes: 11, rear: 'adiabatic', T0: 300, emissivity: 0.8, duration: 4000 }), { H, Taw }, 4000);
    expect(Math.abs(r.Tsurf.at(-1)! - radiativeEquilibrium(H, Taw, 0.8))).toBeLessThan(0.05);
  });
});

describe('energy conservation', () => {
  it('adiabatic back: heat absorbed through the surface equals the change in stored energy (to Newton tolerance)', () => {
    const r = solveConduction(cfg({ duration: 120, nodes: 61, rear: 'adiabatic', emissivity: 0.85 }), { H: 55, Taw: 1600 }, 1500);
    expect(r.stored).toBeGreaterThan(0);
    expect(Math.abs(r.absorbed - r.stored) / r.stored).toBeLessThan(1e-8);
  });
  it('fixed back face: absorbed − conducted out = stored', () => {
    const r = solveConduction(cfg({ duration: 120, nodes: 61, rear: 'fixed', Trear: 300, emissivity: 0.85, thickness: 0.005 }), { H: 55, Taw: 1600 }, 1500);
    expect(Math.abs(r.absorbed - r.stored) / Math.max(1, Math.abs(r.stored))).toBeLessThan(1e-6);
  });
});

describe('property sensitivity (physical trends)', () => {
  const heat = { H: 55, Taw: 1600 };
  const base = cfg({ duration: 60, nodes: 61, rear: 'adiabatic', emissivity: 0.85, thickness: 0.03 });
  const final = (over: Partial<ThermalConfig>) => {
    const r = solveConduction({ ...base, ...over }, heat, 1500);
    return { surf: r.Tsurf.at(-1)!, back: r.Tback.at(-1)! };
  };
  const ref = final({});
  it('higher conductivity: cooler surface, warmer back face', () => {
    const hi = final({ k: 4 });
    expect(hi.surf).toBeLessThan(ref.surf);
    expect(hi.back).toBeGreaterThan(ref.back);
  });
  it('larger heat capacity ρc_p: slower heating everywhere', () => {
    const hi = final({ rho: 1000 });
    expect(hi.surf).toBeLessThan(ref.surf);
    expect(hi.back).toBeLessThanOrEqual(ref.back + 1e-9);
  });
  it('thicker shield: back face stays cooler', () => {
    const thin = final({ thickness: 0.01 });
    const thick = final({ thickness: 0.05 });
    expect(thick.back).toBeLessThan(thin.back);
  });
  it('higher emissivity: cooler surface', () => {
    expect(final({ emissivity: 0.95 }).surf).toBeLessThan(final({ emissivity: 0.3 }).surf);
  });
  it('the surface never exceeds the adiabatic-wall temperature', () => {
    const r = solveConduction({ ...base, duration: 5000 }, heat, 2000);
    for (const T of r.Tsurf) expect(T).toBeLessThanOrEqual(heat.Taw + 1e-9);
  });
});
