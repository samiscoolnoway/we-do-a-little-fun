import { DEFAULT_CONFIG, billigStandoffCylinder, cloneConfig, freestreamOf, type SimConfig } from '../src/core/config';
import { normalShock, pitotPressure, stagnationTemperature } from '../src/core/gas';
import { Simulation, computeFields, surfaceData } from '../src/core/simulation';
import { buildLocator, interpolate, nodeAverage, traceStreamline } from '../src/viz/locate';

// Blunt-body flow on the coarse 96 × 48 O-grid, steady mode (local time stepping), residual drop 5 orders.
// Reference values are analytic (Rayleigh pitot formula, energy equation T0 = T(1 + 0.2 M²)) or an empirical
// correlation (Billig 1967 standoff). These are consistency checks against theory and correlation, not a
// validation against experiment.
//
// Tolerances, recorded from a coarse/medium grid study before writing these tests:
//   stagnation pressure / pitot:  M = 3 coarse 0.993, medium 0.995;  M = 6 coarse 0.987        → |1 − ratio| < 0.02
//   stagnation T / T0:            M = 3 coarse 1.008, medium 1.005;  M = 6 coarse 1.010        → |1 − ratio| < 0.015
//   M = 0.5 stagnation p / isentropic p0: coarse 1.0115, medium 1.0073 (Rusanov low-Mach error) → < 0.015
//   standoff / Billig:            M = 3 coarse 0.714 vs 0.649 (+10 %), medium 0.710;  M = 6 0.458 vs 0.439 (+4 %)
//                                 → within 15 % of the correlation (its own scatter is several per cent)
const run = (mutate: (c: SimConfig) => void) => {
  const c = cloneConfig(DEFAULT_CONFIG);
  mutate(c);
  const sim = new Simulation(c);
  while (!sim.done) sim.advance(1000);
  return sim;
};

const standoff = (sim: Simulation) => {
  const m = sim.mesh;
  const s = sim.solver;
  const fs = freestreamOf(sim.config);
  const mid = 0.5 * fs.rho * (1 + normalShock(fs.mach).r21);
  for (let j = m.nj - 1; j > 0; j--) {
    const a = s.cell(0, j).rho;
    const b = s.cell(0, j - 1).rho;
    if (a < mid && b >= mid) {
      const xa = m.xc[j * m.ni];
      const xb = m.xc[(j - 1) * m.ni];
      const xsh = xa + ((mid - a) / (b - a)) * (xb - xa);
      return (-sim.config.body.radius - xsh) / sim.config.body.radius;
    }
  }
  return NaN;
};

describe('supersonic cylinder, M = 3', () => {
  let sim: Simulation;
  beforeAll(() => {
    sim = run(() => {});
  });

  it('converges: residual drops 5 orders, far-field mass balance closes, no invalid states', () => {
    const d = sim.diagnostics();
    expect(d.status).toBe('converged');
    expect(d.drop).toBeGreaterThanOrEqual(5);
    expect(Math.abs(d.massImbalance)).toBeLessThan(5e-3);
    expect(d.failure).toBeNull();
  });

  it('stagnation pressure matches the Rayleigh pitot formula and stagnation temperature matches T0', () => {
    const fs = freestreamOf(sim.config);
    const st = sim.solver.cell(0, 0);
    expect(Math.abs(st.p / pitotPressure(fs.p, 3) - 1)).toBeLessThan(0.02);
    expect(Math.abs(st.T / stagnationTemperature(fs.T, 3) - 1)).toBeLessThan(0.015);
    expect(st.mach).toBeLessThan(0.1);
  });

  // Measured: windward 0.96 % (stagnation-point cells), inside the captured shock up to −4.2 %, worst cell in the
  // wake −12 %, area mean 0.36 % (0.26 % on the medium mesh).
  it('total enthalpy is conserved on the windward side (< 1.2 % outside the captured shock); the wake error is reported', () => {
    const h = sim.diagnostics().enthalpyError;
    expect(Math.abs(h.front)).toBeLessThan(0.012);
    expect(Math.abs(h.shock)).toBeGreaterThan(Math.abs(h.front));
    expect(h.mean).toBeLessThan(0.006);
    // the worst cell lies downstream, in the wake (x > 0), where the inviscid model is least trustworthy
    expect(h.maxX).toBeGreaterThan(0);
  });

  it('bow-shock standoff is within 15 % of the Billig correlation', () => {
    const d = standoff(sim);
    expect(Math.abs(d / billigStandoffCylinder(3) - 1)).toBeLessThan(0.15);
  });

  it('the flow ahead of the shock is undisturbed (supersonic: no upstream influence)', () => {
    const fs = freestreamOf(sim.config);
    const loc = buildLocator(sim.mesh);
    const h = loc.locate(-3 * sim.config.body.radius, 0)!;
    const c = sim.solver.cell(h.i, h.j);
    expect(Math.abs(c.p / fs.p - 1)).toBeLessThan(1e-6);
    expect(Math.abs(c.mach - 3)).toBeLessThan(1e-6);
  });

  // Symmetry at zero incidence. The explicit scheme treats both halves identically (measured asymmetry ≈ 2e-7 p∞);
  // the implicit LU-SGS sweeps run in cell order, so the converged solution carries an asymmetry at the level of
  // the convergence tolerance (measured 3.1e-4 p∞ = 2.6e-5 of the stagnation pressure).
  it('symmetric flow at zero incidence gives a symmetric solution (to convergence level)', () => {
    const m = sim.mesh;
    let worst = 0;
    for (let j = 0; j < m.nj; j++) for (let i = 1; i < m.ni / 2; i++) worst = Math.max(worst, Math.abs(sim.solver.cell(i, j).p - sim.solver.cell(m.ni - i, j).p));
    expect(worst / sim.solver.cell(0, 0).p).toBeLessThan(1e-4);
  });

  it('surface pressure falls monotonically from the stagnation point to the shoulder', () => {
    const sd = surfaceData(sim);
    const m = sim.mesh;
    // upper surface: i = ni−1, ni−2, … ni/2+... up to θ = 90°: s from 0 to πR/2
    let prev = sd.p[0];
    for (let i = m.ni - 1; i > (3 * m.ni) / 4; i--) {
      expect(sd.p[i]).toBeLessThan(prev);
      prev = sd.p[i];
    }
    expect(sd.s[m.ni - 1]).toBeGreaterThan(0);
    expect(sd.s[1]).toBeLessThan(0);
  });

  it('display fields: Cp at the stagnation point equals the pitot value; Δs ≈ 0 upstream, > 0 behind the shock', () => {
    const f = computeFields(sim);
    const fs = freestreamOf(sim.config);
    const cpStag = (pitotPressure(fs.p, 3) - fs.p) / (0.5 * fs.rho * fs.V * fs.V);
    expect(Math.abs(f.cp[0] / cpStag - 1)).toBeLessThan(0.02);
    const loc = buildLocator(sim.mesh);
    const up = loc.locate(-3 * sim.config.body.radius, 0)!;
    expect(Math.abs(f.ds[up.cell])).toBeLessThan(1e-3);
    // normal-shock entropy jump at M = 3: Δs = cv ln(p21 / r21^γ)
    const ns = normalShock(3);
    const dsShock = 717.6 * Math.log(ns.p21 / Math.pow(ns.r21, 1.4));
    expect(Math.abs(f.ds[0] / dsShock - 1)).toBeLessThan(0.05);
  });

  it('a streamline from upstream passes around the body and never enters it', () => {
    const m = sim.mesh;
    const f = computeFields(sim);
    const nu = nodeAverage(m, f.u);
    const nv = nodeAverage(m, f.v);
    const loc = buildLocator(m);
    const R = sim.config.body.radius;
    const pts = traceStreamline(m, loc, nu, nv, -3 * R, 0.3 * R, freestreamOf(sim.config).V);
    expect(pts.length / 2).toBeGreaterThan(20);
    let minR = Infinity;
    let maxX = -Infinity;
    for (let k = 0; k < pts.length; k += 2) {
      minR = Math.min(minR, Math.hypot(pts[k], pts[k + 1]));
      maxX = Math.max(maxX, pts[k]);
    }
    expect(minR).toBeGreaterThan(R);
    expect(maxX).toBeGreaterThan(R); // it gets past the body
  });
});

describe('implicit and explicit solvers reach the same discrete steady state (M = 3)', () => {
  // The two time integrators differ only in how they march; the converged solution of the same spatial
  // discretisation must agree. Measured: stagnation pressure identical to 4 digits, standoff within 0.1 %.
  it('stagnation pressure and standoff agree; the implicit run takes far fewer steps', () => {
    const imp = run(() => {});
    const exp = run((c) => {
      c.numerics.scheme = 'explicit';
    });
    expect(imp.scheme).toBe('implicit');
    expect(exp.scheme).toBe('explicit');
    expect(imp.diagnostics().status).toBe('converged');
    expect(exp.diagnostics().status).toBe('converged');
    const pi = imp.solver.cell(0, 0).p;
    const pe = exp.solver.cell(0, 0).p;
    expect(Math.abs(pi / pe - 1)).toBeLessThan(1e-3);
    expect(Math.abs(standoff(imp) / standoff(exp) - 1)).toBeLessThan(5e-3);
    expect(imp.solver.steps).toBeLessThan(0.6 * exp.solver.steps);
    // explicit: exact mirror symmetry up to round-off
    const m = exp.mesh;
    let worst = 0;
    for (let j = 0; j < m.nj; j++) for (let i = 1; i < m.ni / 2; i++) worst = Math.max(worst, Math.abs(exp.solver.cell(i, j).p - exp.solver.cell(m.ni - i, j).p));
    expect(worst / freestreamOf(exp.config).p).toBeLessThan(1e-5);
  });

  it('subsonic steady runs always use the explicit scheme', () => {
    const c = cloneConfig(DEFAULT_CONFIG);
    c.flow.mach = 0.6;
    expect(new Simulation(c).scheme).toBe('explicit');
  });
});

describe('subsonic cylinder, M = 0.5', () => {
  it('converges without a shock; stagnation pressure ≈ isentropic p0; flow is decelerated upstream', () => {
    const sim = run((c) => {
      c.flow.mach = 0.5;
      c.flow.Tinf = 288.15;
      c.flow.pinf = 101325;
    });
    const d = sim.diagnostics();
    expect(['converged', 'levelled']).toContain(d.status);
    const fs = freestreamOf(sim.config);
    const st = sim.solver.cell(0, 0);
    expect(Math.abs(st.p / pitotPressure(fs.p, 0.5) - 1)).toBeLessThan(0.015);
    const f = computeFields(sim);
    // no shock: entropy stays near zero everywhere ahead of the body (numerical dissipation only)
    const loc = buildLocator(sim.mesh);
    const R = sim.config.body.radius;
    const h = loc.locate(-2 * R, 0)!;
    expect(Math.abs(f.ds[h.cell])).toBeLessThan(0.5);
    // subsonic flow feels the body upstream: slower than freestream two radii ahead
    expect(f.speed[h.cell]).toBeLessThan(0.97 * fs.V);
  });
});

describe('hypersonic cylinder, M = 6', () => {
  it('stagnation pressure, temperature and standoff', () => {
    const sim = run((c) => {
      c.flow.mach = 6;
    });
    expect(sim.diagnostics().failure).toBeNull();
    const fs = freestreamOf(sim.config);
    const st = sim.solver.cell(0, 0);
    expect(Math.abs(st.p / pitotPressure(fs.p, 6) - 1)).toBeLessThan(0.02);
    expect(Math.abs(st.T / stagnationTemperature(fs.T, 6) - 1)).toBeLessThan(0.015);
    expect(Math.abs(standoff(sim) / billigStandoffCylinder(6) - 1)).toBeLessThan(0.15);
  });
});

describe('probe and point location', () => {
  const c = cloneConfig(DEFAULT_CONFIG);
  const sim = new Simulation(c);
  sim.advance(50);
  const m = sim.mesh;
  const loc = buildLocator(m);

  it('the probe at a cell centroid returns exactly that cell and its computed values', () => {
    for (const [i, j] of [
      [0, 0],
      [17, 3],
      [50, 20],
      [95, 47],
    ]) {
      const cell = j * m.ni + i;
      const h = loc.locate(m.xc[cell], m.yc[cell])!;
      expect(h.i).toBe(i);
      expect(h.j).toBe(j);
      const f = computeFields(sim);
      expect(f.p[h.cell]).toBe(Math.fround(sim.solver.cell(i, j).p));
    }
  });

  it('points inside the body or outside the domain return nothing', () => {
    expect(loc.locate(0, 0)).toBeNull();
    expect(loc.locate(0.9 * c.body.radius, 0)).toBeNull();
    expect(loc.locate(100, 100)).toBeNull();
  });

  it('bilinear interpolation reproduces a linear field exactly', () => {
    const lin = new Float32Array((m.ni + 1) * (m.nj + 1));
    for (let k = 0; k < lin.length; k++) lin[k] = 2 * m.x[k] - 3 * m.y[k] + 1;
    for (const [px, py] of [
      [-0.8, 0.1],
      [1.3, -0.7],
      [-2.5, 2.2],
    ]) {
      const h = loc.locate(px, py)!;
      expect(interpolate(m, lin, h)).toBeCloseTo(2 * px - 3 * py + 1, 4);
    }
  });
});

describe('time-accurate mode and failure handling at the simulation level', () => {
  it('transient mode marches one global Δt and stops exactly at the requested time', () => {
    const c = cloneConfig(DEFAULT_CONFIG);
    c.numerics.mode = 'transient';
    c.numerics.endTime = 2e-4;
    const sim = new Simulation(c);
    expect(sim.scheme).toBe('explicit');
    while (!sim.done) sim.advance(500);
    const d = sim.diagnostics();
    expect(d.status).toBe('finished');
    expect(d.time).toBeCloseTo(2e-4, 15);
    // the bow shock has not yet formed far upstream: the freestream 3 radii ahead is untouched at this early time
    const loc = buildLocator(sim.mesh);
    const h = loc.locate(-3 * c.body.radius, 0)!;
    expect(Math.abs(sim.solver.cell(h.i, h.j).p / freestreamOf(c).p - 1)).toBeLessThan(1e-9);
  });

  it('an unstable CFL number is caught: status failed, location reported, last valid state kept, no further steps', () => {
    const c = cloneConfig(DEFAULT_CONFIG);
    c.numerics.scheme = 'explicit';
    c.numerics.cfl = 1.5;
    c.flow.mach = 6;
    const sim = new Simulation(c);
    while (!sim.done) sim.advance(500);
    const d = sim.diagnostics();
    expect(d.status).toBe('failed');
    expect(d.failure).not.toBeNull();
    expect(d.failure!.reason).toMatch(/non-positive|non-finite/);
    const f = computeFields(sim);
    for (let k = 0; k < f.p.length; k++) {
      expect(f.p[k]).toBeGreaterThan(0);
      expect(f.rho[k]).toBeGreaterThan(0);
    }
    expect(sim.advance(10)).toBe(0);
  });
});
