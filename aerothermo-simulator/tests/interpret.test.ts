import { DEFAULT_CONFIG, cloneConfig, type SimConfig } from '../src/core/config';
import { interpretProbe } from '../src/core/interpret';
import { Simulation, computeFields } from '../src/core/simulation';
import { buildLocator } from '../src/viz/locate';

const solve = (mut: (c: SimConfig) => void = () => {}) => {
  const c = cloneConfig(DEFAULT_CONFIG);
  mut(c);
  const sim = new Simulation(c);
  while (!sim.done) sim.advance(1000);
  const f = computeFields(sim);
  const loc = buildLocator(sim.mesh);
  const at = (x: number, y: number) => {
    const h = loc.locate(x, y)!;
    const k = h.cell;
    return interpretProbe({ p: f.p[k], T: f.T[k], mach: f.mach[k], speed: f.speed[k], ds: f.ds[k] }, c).region;
  };
  return { at, sim };
};

describe('probe interpretation from computed values', () => {
  it('M = 3: freestream upstream, shock layer ahead of the nose, stagnation at the nose, expansion in the wake', () => {
    const { at } = solve();
    expect(at(-2.5, 0.3)).toBe('freestream');
    expect(at(-0.68, 0.02)).toBe('shock-layer');
    expect(at(-0.505, 0)).toBe('stagnation');
    expect(at(0.7, 0.05)).toBe('expansion');
  });
  it('M = 0.5: compression ahead of the body, acceleration above it, strong expansion at the shoulder', () => {
    const { at } = solve((c) => (c.flow = { mach: 0.5, Tinf: 288.15, pinf: 101325, angle: 0 }));
    expect(at(-0.9, 0)).toBe('compression');
    expect(at(0, 1.5)).toBe('acceleration');
    // a cylinder's critical Mach number is ≈ 0.4: at M∞ = 0.5 the shoulder flow expands below 0.6 p∞
    expect(at(0, 0.55)).toBe('expansion');
  });
});
