import { runSphereCase } from '../../src/lab/core/sphere3d';

// Audit of the bow-shock detector of the Mach 2 sphere case (sphere3d.ts): the exported stagnation-line profile,
// the normal-shock reference, the 10 / 50 / 90 % crossings and an independent steepest-rise detector. These check
// that the measurement does what it says; they do not compare it with the Billig correlation.

const M = 2;
const g = 1.4;

describe.each(['rusanov', 'hllc'] as const)('shock detector, Mach 2 sphere, cut cells, R/h = 8, %s flux', (flux) => {
  const r = runSphereCase({ mach: M, radiusCells: 8, wall: 'cutcell', flux });
  const sh = r.shock;
  const h = 1 / 8;

  it('the reference density is the normal-shock value and the surface is the true sphere on the measurement line', () => {
    expect(r.converged).toBe(true);
    expect(sh.rho2OverRhoInf).toBeCloseTo(((g + 1) * M * M) / ((g - 1) * M * M + 2), 12);
    expect(sh.xNose).toBeCloseTo(-Math.sqrt(1 - 2 * (h / 2) ** 2), 12);
    // the profile runs downstream in +x, one cell apart, up to the last fluid cell before the body
    for (let i = 1; i < sh.profile.length; i++) expect(sh.profile[i].x - sh.profile[i - 1].x).toBeCloseTo(h, 12);
    expect(sh.profile.at(-1)!.x).toBeLessThan(sh.xNose + h);
  });

  it('crossings: linear interpolation between full cells, ordered foot < mid < tail, and consistent with the reported standoffs', () => {
    let prevX = -Infinity;
    for (const c of sh.crossings) {
      const a = sh.profile[c.i - 1];
      const b = sh.profile[c.i];
      expect(a.phi).toBeLessThan(c.level);
      expect(b.phi).toBeGreaterThanOrEqual(c.level);
      expect(a.alpha).toBe(1);
      expect(b.alpha).toBe(1);
      expect(c.x).toBeCloseTo(a.x + (h * (c.level - a.phi)) / (b.phi - a.phi), 12);
      expect(c.standoff).toBeCloseTo(sh.xNose - c.x, 12);
      expect(c.x).toBeGreaterThan(prevX);
      prevX = c.x;
      // no earlier pair crosses the same level (first crossing from upstream)
      for (let i = 1; i < c.i; i++) expect(sh.profile[i - 1].phi < c.level && sh.profile[i].phi >= c.level).toBe(false);
    }
    expect(r.standoffFoot).toBeCloseTo(sh.crossings[0].standoff, 12);
    expect(r.standoff).toBeCloseTo(sh.crossings[1].standoff, 12);
    expect(r.standoffTail).toBeCloseTo(sh.crossings[2].standoff, 12);
    expect(r.shockWidthCells).toBeCloseTo((sh.crossings[2].x - sh.crossings[0].x) / h, 9);
  });

  it('the detected transition is the bow shock: freestream ahead, the normal-shock jump, compression behind it', () => {
    // Rusanov's diffusive precursor reaches 3 cells ahead of the 10 % crossing (measured φ = 0.017 two cells and
    // 0.0035 three cells ahead); HLLC has none (φ = 0 exactly)
    const foot = sh.crossings[0].i;
    for (let i = 0; i < foot - 3; i++) expect(Math.abs(sh.profile[i].phi)).toBeLessThan(1e-3);
    // just behind the 90 % crossing the density sits between the normal-shock value and the stagnation value
    // (φ = 1 and 1.28: isentropic compression of the M2 = 0.577 post-shock flow)
    const behind = sh.profile[sh.crossings[2].i];
    expect(behind.phi).toBeGreaterThan(0.9);
    expect(behind.phi).toBeLessThan(1.28);
    // the steepest rise lies between the foot and the tail (an independent detector of the same transition)
    expect(sh.maxGradient.x).toBeGreaterThanOrEqual(sh.crossings[0].x - 1e-12);
    expect(sh.maxGradient.x).toBeLessThanOrEqual(sh.crossings[2].x + 1e-12);
  });
});

describe('shock detector: Rusanov and HLLC place the bow shock alike, HLLC much sharper (R/h = 8)', () => {
  it('50 % standoffs within 0.01 R; HLLC width below 1.5 cells, Rusanov above 2', () => {
    // measured: standoff 0.3650 / 0.3629, width 2.48 / 1.16 cells; HLLC 0 fallbacks, symmetry 4e-15
    const rus = runSphereCase({ mach: M, radiusCells: 8, wall: 'cutcell', flux: 'rusanov' });
    const hllc = runSphereCase({ mach: M, radiusCells: 8, wall: 'cutcell', flux: 'hllc' });
    expect(Math.abs(rus.standoff - hllc.standoff)).toBeLessThan(0.01);
    expect(hllc.shockWidthCells).toBeLessThan(1.5);
    expect(rus.shockWidthCells).toBeGreaterThan(2);
    expect(hllc.hllcFallbacks).toBe(0);
    expect(hllc.bodyFluxFraction).toBe(0);
    expect(hllc.symmetryError).toBeLessThan(1e-8);
    expect(hllc.massImbalance).toBeLessThan(1e-3);
  });
});
