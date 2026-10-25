import { runAxiSphereCase } from '../../src/lab/core/sphereAxi';

// Mach 2 sphere with the axisymmetric reference solver (sphereAxi.ts), coarse grids only. Checks the case set-up
// (convergence, mass-tight wall, bow shock inside the domain, supersonic outflow) and the shock detector against its
// own exported profile. Measured values from the refinement study are recorded in docs/axisymmetric-reference.md.

describe('axisymmetric Mach 2 sphere, R/h = 8 (Rusanov)', () => {
  const r = runAxiSphereCase({ mach: 2, radiusCells: 8 });
  const sh = r.shock;

  it('converges with no invalid state; the wall is exactly mass-tight; the mass balance closes', () => {
    expect(r.failure).toBeNull();
    expect(r.converged).toBe(true);
    expect(Math.abs(r.bodyFluxFraction)).toBeLessThan(1e-14);
    expect(r.massImbalance).toBeLessThan(1e-3);
    expect(r.minRho).toBeGreaterThan(0);
    expect(r.minP).toBeGreaterThan(0);
  });

  it('the bow shock stays inside the domain and the flow leaving at θ = 95° is supersonic', () => {
    expect(r.outerRingDeviation).toBeLessThan(1e-3);
    expect(r.outflowMinNormalMach).toBeGreaterThan(1);
  });

  it('shock detector: normal-shock reference, first crossings from upstream, linear interpolation, ordered foot > mid > tail', () => {
    expect(sh.rho2OverRhoInf).toBeCloseTo((2.4 * 4) / (0.4 * 4 + 2), 12);
    // the profile runs from the outer boundary to the wall: distances decrease by about one radial spacing (the
    // planar centroid of a straight-edged cell lies slightly inside the arc midpoint, an O(h²/ρ) offset: measured
    // 2.6e-4 at h = 0.125, 0.2 % of h; the detector uses the actual centroid distances)
    for (let k = 1; k < sh.profile.length; k++) expect(Math.abs(sh.profile[k - 1].d - sh.profile[k].d - r.grid.hRadial)).toBeLessThan(0.01 * r.grid.hRadial);
    let prev = Infinity;
    for (const c of sh.crossings) {
      const a = sh.profile[c.k - 1];
      const b = sh.profile[c.k];
      expect(a.phi).toBeLessThan(c.level);
      expect(b.phi).toBeGreaterThanOrEqual(c.level);
      expect(c.standoff).toBeCloseTo(a.d + ((b.d - a.d) * (c.level - a.phi)) / (b.phi - a.phi), 12);
      expect(c.standoff).toBeLessThan(prev);
      prev = c.standoff;
    }
    expect(r.standoff).toBe(sh.crossings[1].standoff);
    // freestream upstream of the shock, and the steepest rise between the foot and the tail
    for (let k = 0; k < sh.crossings[0].k - 3; k++) expect(Math.abs(sh.profile[k].phi)).toBeLessThan(1e-3);
    expect(sh.maxGradient.standoff).toBeLessThanOrEqual(sh.crossings[0].standoff);
    expect(sh.maxGradient.standoff).toBeGreaterThanOrEqual(sh.crossings[2].standoff);
  });

  it('detached bow shock, standoff within 25 % of Billig; nose pressure below pitot', () => {
    // measured: standoff 0.364 (Billig 0.3215), nose p / pitot 0.944
    expect(r.standoff).toBeGreaterThan(r.billig);
    expect(r.standoff).toBeLessThan(1.25 * r.billig);
    expect(r.nose.pRatio).toBeLessThan(1);
    expect(r.nose.pRatio).toBeGreaterThan(0.9);
  });
});

describe('axisymmetric Mach 2 sphere: refinement R/h = 8 → 16 (Rusanov)', () => {
  it('converges at both; nose pressure and front-wall total-temperature errors decrease', () => {
    // measured: standoff 0.3643 → 0.3627, nose p / pitot 0.944 → 0.973
    const a = runAxiSphereCase({ mach: 2, radiusCells: 8 });
    const b = runAxiSphereCase({ mach: 2, radiusCells: 16 });
    expect(b.converged).toBe(true);
    expect(Math.abs(b.nose.pRatio - 1)).toBeLessThan(Math.abs(a.nose.pRatio - 1));
    expect(b.wall.T0MaxError).toBeLessThan(a.wall.T0MaxError);
    expect(Math.abs(b.standoff - a.standoff)).toBeLessThan(0.01);
  });
});
