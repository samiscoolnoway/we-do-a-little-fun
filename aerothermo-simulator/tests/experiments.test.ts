import { DEFAULT_CONFIG, cloneConfig } from '../src/core/config';
import { EXPERIMENTS, SCENARIOS, experimentConfigs, rowsToCsv, rowsToJson, shockStandoff, summarize } from '../src/core/experiments';
import { computeHeating } from '../src/core/heating';
import { Simulation, computeFields, surfaceData } from '../src/core/simulation';
import { solveConduction } from '../src/core/thermal';
import { flowKey } from '../src/ui/store';

describe('comparison rows from a computed run', () => {
  const c = cloneConfig(DEFAULT_CONFIG);
  const sim = new Simulation(c);
  while (!sim.done) sim.advance(1000);
  const f = computeFields(sim);
  const row = summarize('M = 3 coarse', c, sim.diagnostics(), surfaceData(sim), f.rho, sim.mesh.xc, 'illustrative');

  it('records the solver results, not estimates', () => {
    expect(row.status).toBe('converged');
    expect(row.cells).toBe(96 * 48);
    expect(Math.abs(row.pStagRatio - 1)).toBeLessThan(0.02);
    expect(Math.abs(row.standoff / row.billig - 1)).toBeLessThan(0.15);
    // identical to computing heating and conduction directly
    const h = computeHeating(surfaceData(sim), c, c.thermal.T0);
    expect(row.qStag).toBe(h.stag.q);
    const th = solveConduction(c.thermal, { H: h.stag.H, Taw: h.stag.Taw }, 1500);
    expect(row.TsurfEnd).toBe(th.Tsurf[th.Tsurf.length - 1]);
  });

  it('CSV has a header with units, one line per row, and quotes fields containing commas', () => {
    const e = cloneConfig(c);
    e.body = { kind: 'ellipse', radius: 0.5, aspect: 0.6 };
    const r2 = { ...row, id: 99, body: 'ellipse H = 0.5 m, a/H = 0.6' };
    const csv = rowsToCsv([row, r2]);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('q_stag at T0 [W/m2]');
    expect(lines[0]).toContain('T_back (end) [K]');
    expect(lines[2]).toContain('"ellipse H = 0.5 m, a/H = 0.6"');
    const json = JSON.parse(rowsToJson([row]));
    expect(json.rows[0].qStag).toBe(row.qStag);
    expect(json.columns.length).toBeGreaterThan(10);
  });

  it('standoff is undefined (NaN) for subsonic flow or at incidence', () => {
    const sub = cloneConfig(c);
    sub.flow.mach = 0.5;
    expect(shockStandoff(sim.mesh.xc, 96, 48, f.rho, sub)).toBeNaN();
    const inc = cloneConfig(c);
    inc.flow.angle = 5;
    expect(shockStandoff(sim.mesh.xc, 96, 48, f.rho, inc)).toBeNaN();
  });
});

describe('experiment definitions', () => {
  it('thermal-only experiments share one flow (so the flow is computed once) and differ in the named parameter', () => {
    for (const id of ['thickness', 'conductivity']) {
      const items = experimentConfigs(EXPERIMENTS.find((e) => e.id === id)!);
      expect(items).toHaveLength(2);
      expect(flowKey(items[0].config)).toBe(flowKey(items[1].config));
      expect(JSON.stringify(items[0].config.thermal)).not.toBe(JSON.stringify(items[1].config.thermal));
    }
  });
  it('the grid experiment changes only the mesh', () => {
    const items = experimentConfigs(EXPERIMENTS.find((e) => e.id === 'grid')!);
    expect(items.map((i) => i.config.numerics.mesh)).toEqual(['coarse', 'medium', 'fine']);
    expect(items[0].config.flow).toEqual(items[2].config.flow);
  });
  it('scenarios produce valid configurations', () => {
    for (const sc of SCENARIOS) {
      const c = cloneConfig(DEFAULT_CONFIG);
      sc.apply(c);
      expect(c.flow.mach).toBeGreaterThan(0);
      expect(() => new Simulation(c)).not.toThrow();
    }
  });
});
