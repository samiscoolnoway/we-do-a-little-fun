import { DEFAULT_CONFIG, cloneConfig, freestreamOf, type SimConfig } from '../src/core/config';
import { CP, GAS, SIGMA_SB, sutherland } from '../src/core/gas';
import { C_CYLINDER, PRANDTL, SUTTON_GRAVES_K, computeHeating, radiativeEquilibrium, stagnationH } from '../src/core/heating';
import { Simulation, type SurfaceData, surfaceData } from '../src/core/simulation';

/** synthetic surface data on a circle of radius R, cell 0 at θ = π, i increasing anticlockwise like the O-grid */
function circleSurface(ni: number, R: number, edge: (theta: number) => { p: number; T: number; ue: number }): SurfaceData {
  const mk = () => new Float64Array(ni);
  const sd: SurfaceData = { s: mk(), x: mk(), y: mk(), p: mk(), rho: mk(), T: mk(), ue: mk() };
  for (let i = 0; i < ni; i++) {
    const th = Math.PI + (2 * Math.PI * i) / ni;
    sd.x[i] = R * Math.cos(th);
    sd.y[i] = R * Math.sin(th);
    const dth = Math.atan2(Math.sin(th - Math.PI), Math.cos(th - Math.PI)); // angle from the stagnation point
    const e = edge(Math.abs(dth));
    sd.p[i] = e.p;
    sd.T[i] = e.T;
    sd.rho[i] = e.p / (GAS.R * e.T);
    sd.ue[i] = e.ue;
    sd.s[i] = R * dth;
  }
  return sd;
}

const config = (mut: (c: SimConfig) => void = () => {}) => {
  const c = cloneConfig(DEFAULT_CONFIG);
  mut(c);
  return c;
};

describe('heating correlation: formulas', () => {
  it('stagnation heat-transfer coefficient = 0.57 Pr^-0.6 √(ρμβ) c_p', () => {
    const H = stagnationH(0.17, 3.05e-5, 1139);
    expect(H).toBeCloseTo(0.57 * Math.pow(0.71, -0.6) * Math.sqrt(0.17 * 3.05e-5 * 1139) * CP, 10);
    expect(C_CYLINDER).toBe(0.57);
    expect(PRANDTL).toBe(0.71);
  });

  it('Sutton–Graves arithmetic: Rn = 1 m, ρ = 1e-4 kg/m³, V = 7 km/s → 5.97e5 W/m²', () => {
    const q = SUTTON_GRAVES_K * Math.sqrt(1e-4 / 1) * 7000 ** 3;
    expect(q / 5.9733e5 - 1).toBeLessThan(1e-4);
  });

  it('radiative-equilibrium temperature balances convection and re-radiation', () => {
    const T = radiativeEquilibrium(80, 2000, 0.85);
    expect(Math.abs(80 * (2000 - T) - 0.85 * SIGMA_SB * T ** 4)).toBeLessThan(1e-6 * 80 * 2000);
    expect(T).toBeLessThan(2000);
    expect(radiativeEquilibrium(80, 2000, 0)).toBe(2000);
  });
});

describe('Lees distribution: manufactured edge conditions', () => {
  it('linear edge velocity uₑ = βs with constant ρₑ, μₑ gives q/q₀ = 1 everywhere and recovers β exactly', () => {
    const c = config((c) => (c.body.radius = 0.5));
    const beta = 1200;
    const sd = circleSurface(400, 0.5, (th) => ({ p: 30000, T: 600, ue: beta * 0.5 * th }));
    const h = computeHeating(sd, c, 300);
    // the module measures arc length along the polygon of wall points: chord/arc = 1 − Δθ²/24 ≈ 1 − 1e-5 here
    expect(Math.abs(h.stag.beta / beta - 1)).toBeLessThan(5e-5);
    for (const pt of h.points) expect(Math.abs(pt.ratio - 1)).toBeLessThan(1e-3);
    // the windward face ends at the shoulder: |φ| < 90°, i.e. s up to πR/2 on each side
    const smax = Math.max(...h.points.map((p) => Math.abs(p.s)));
    expect(smax).toBeLessThan((Math.PI / 2) * 0.5);
    expect(smax).toBeGreaterThan((Math.PI / 2) * 0.5 * 0.97);
  });

  it('modified-Newtonian edge conditions on a cylinder: module agrees with an independent fine integration', () => {
    const c = config();
    const R = 0.5;
    const g = GAS.gamma;
    const p0 = 30000;
    const pinf = 2500;
    const T0 = 616;
    const edge = (th: number) => {
      const p = p0 * Math.cos(th) ** 2 + pinf * Math.sin(th) ** 2;
      const T = T0 * Math.pow(p / p0, (g - 1) / g);
      return { p, T, ue: Math.sqrt(Math.max(0, 2 * CP * (T0 - T))) };
    };
    const h = computeHeating(circleSurface(720, R, edge), c, 300);
    // velocity gradient: Newtonian value (1/R)√(2(p0 − p∞)/ρ0)
    const rho0 = p0 / (GAS.R * T0);
    expect(Math.abs(h.stag.beta / ((1 / R) * Math.sqrt((2 * (p0 - pinf)) / rho0)) - 1)).toBeLessThan(0.01);
    // independent integration of ξ = ∫ρμu ds with 200 000 trapezoids
    const F = (th: number) => {
      const e = edge(th);
      return (e.p / (GAS.R * e.T)) * sutherland(e.T) * e.ue;
    };
    const ref = (thEnd: number) => {
      const n = 200000;
      let xi = 0;
      for (let k = 0; k < n; k++) xi += 0.5 * (F((k * thEnd) / n) + F(((k + 1) * thEnd) / n)) * ((R * thEnd) / n);
      return F(thEnd) / Math.sqrt(2 * xi) / Math.sqrt(rho0 * sutherland(T0) * h.stag.beta);
    };
    for (const deg of [20, 45, 70]) {
      const pt = h.points.reduce((best, p) => (Math.abs(p.phi - deg) < Math.abs(best.phi - deg) ? p : best));
      expect(Math.abs(pt.ratio / ref((pt.phi * Math.PI) / 180) - 1)).toBeLessThan(0.01);
    }
    // heating falls monotonically from the stagnation point on both sides
    const upper = h.points.filter((p) => p.s >= 0);
    // (trapezoidal integration from the stagnation point leaves a few 1e-6 of noise in the first points)
    for (let k = 1; k < upper.length; k++) expect(upper[k].ratio).toBeLessThan(upper[k - 1].ratio + 1e-4);
  });
});

describe('heating from the computed M = 3 flow', () => {
  const c = config();
  const sim = new Simulation(c);
  while (!sim.done) sim.advance(1000);
  const h = computeHeating(surfaceData(sim), c, 300);
  const fs = freestreamOf(c);

  it('stagnation point on the axis; computed velocity gradient close to the Newtonian estimate', () => {
    expect(Math.abs(h.stag.y)).toBeLessThan(0.02 * c.body.radius);
    expect(h.stag.x).toBeLessThan(0);
    // measured: β(solver) = 1158 1/s, β(Newtonian) = 1144 1/s (1.2 %); at M = 6, 3.4 %. Newtonian theory is approximate.
    expect(Math.abs(h.stag.beta / h.stag.betaNewton - 1)).toBeLessThan(0.2);
  });

  // measured cold-wall stagnation q: 33.5 kW/m² vs Sutton–Graves (2D) 24.6 kW/m² at M = 3; 209 vs 197 kW/m² at M = 6
  it('dimensional values are consistent: q = H (T_aw − T_w), T_aw = T0, and cold-wall q within a factor 2 of Sutton–Graves (2D)', () => {
    const T0 = fs.T * (1 + 0.2 * 9);
    expect(h.stag.Taw).toBeCloseTo(T0, 6);
    expect(h.stag.q).toBeCloseTo(h.stag.H * (T0 - 300), 6);
    expect(h.stag.q).toBeGreaterThan(0);
    const r = h.stag.qCold / h.stag.qSG2D;
    expect(r).toBeGreaterThan(0.5);
    expect(r).toBeLessThan(2);
  });

  it('heating decreases away from the stagnation point and stops at the shoulders', () => {
    expect(h.points.length).toBeGreaterThan(20);
    // no point exceeds the stagnation value (regression: a spurious spike next to the stagnation point)
    for (const p of h.points) expect(p.ratio).toBeLessThan(1.02);
    for (const p of h.points) expect(p.phi).toBeLessThan(90);
    const at = (deg: number) => h.points.filter((p) => p.s > 0).reduce((b, p) => (Math.abs(p.phi - deg) < Math.abs(b.phi - deg) ? p : b));
    expect(at(30).q).toBeLessThan(h.stag.q);
    expect(at(60).q).toBeLessThan(at(30).q);
  });

  it('a hotter wall receives less heat (q ∝ T_aw − T_w); a wall at T_aw receives none', () => {
    const hot = computeHeating(surfaceData(sim), c, 500);
    expect(hot.stag.q).toBeLessThan(h.stag.q);
    const adiabatic = computeHeating(surfaceData(sim), c, h.stag.Taw);
    expect(Math.abs(adiabatic.stag.q)).toBeLessThan(1e-9 * h.stag.q);
  });
});

describe('heating at angle of attack', () => {
  it('α = 10°: the stagnation point moves to the lower front, facing the oncoming flow', () => {
    const c = config((c) => (c.flow.angle = 10));
    const sim = new Simulation(c);
    while (!sim.done) sim.advance(1000);
    const h = computeHeating(surfaceData(sim), c, 300);
    expect(h.stag.y).toBeLessThan(0);
    const thetaStag = (Math.atan2(h.stag.y, h.stag.x) * 180) / Math.PI;
    expect(Math.abs(Math.abs(thetaStag) - 170)).toBeLessThan(4);
  });
});
