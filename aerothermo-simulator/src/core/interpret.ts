import { type SimConfig, freestreamOf } from './config';
import { pitotPressure } from './gas';

/**
 * Plain-language reading of a probe value, derived only from the computed cell values and the freestream:
 * entropy change tells whether the gas crossed a shock, the pressure ratio whether it was compressed or expanded,
 * the local Mach number whether it is subsonic. Returns a title and an explanation.
 */
export interface ProbeValues {
  p: number;
  T: number;
  mach: number;
  speed: number;
  ds: number;
}

export function interpretProbe(v: ProbeValues, c: SimConfig): { region: string; title: string; text: string } {
  const fs = freestreamOf(c);
  const pr = v.p / fs.p;
  const p0 = pitotPressure(fs.p, fs.mach);
  const shocked = v.ds > 2; // J/(kg·K); the numerical noise upstream is far below this
  if (fs.mach > 1 && !shocked && Math.abs(pr - 1) < 0.01 && Math.abs(v.mach / fs.mach - 1) < 0.01)
    return {
      region: 'freestream',
      title: 'Undisturbed freestream',
      text: 'Pressure, temperature and Mach number equal the freestream values. The flow is supersonic, so pressure waves from the body cannot travel this far upstream: the air here does not yet "know" the body exists.',
    };
  if (v.mach < 0.25 && v.p > 0.85 * p0)
    return {
      region: 'stagnation',
      title: 'Near the stagnation point',
      text: `The gas is almost at rest (M = ${v.mach.toFixed(2)}): nearly all of its kinetic energy has become enthalpy, so the temperature approaches the total temperature and the pressure approaches the pitot value. This is where the heating is highest.`,
    };
  if (pr < 0.6)
    return {
      region: 'expansion',
      title: 'Expansion region',
      text: `The pressure has fallen to ${(pr * 100).toFixed(0)} % of the freestream value (M = ${v.mach.toFixed(2)}): the flow accelerates around the shoulder and expands, cooling as it does. Behind the body the inviscid model lets this expansion go much further than in a real flow, which would separate (treat the wake as qualitative).`,
    };
  if (shocked && v.mach < 1)
    return {
      region: 'shock-layer',
      title: 'Behind the bow shock (subsonic shock layer)',
      text: `The gas has crossed the shock: its entropy rose by ${v.ds.toFixed(0)} J/(kg·K), it is ${pr.toFixed(1)}× the freestream pressure and ${(v.T / fs.T).toFixed(2)}× the temperature, and it has slowed to M = ${v.mach.toFixed(2)}.`,
    };
  if (shocked)
    return {
      region: 'post-shock-supersonic',
      title: 'Behind the shock, supersonic again',
      text: `The gas passed through the (here weaker, oblique) part of the shock, entropy +${v.ds.toFixed(0)} J/(kg·K), and has re-accelerated to M = ${v.mach.toFixed(2)} as it turns around the body.`,
    };
  if (fs.mach <= 1)
    return pr > 1
      ? {
          region: 'compression',
          title: 'Subsonic compression ahead of the body',
          text: `No shock: pressure waves travel upstream and slow the air gradually. Here it moves at ${(v.speed / fs.V).toFixed(2)}× the freestream speed and the pressure is ${((pr - 1) * 100).toFixed(1)} % above the freestream value.`,
        }
      : {
          region: 'acceleration',
          title: 'Subsonic acceleration around the body',
          text: `The air speeds up to ${(v.speed / fs.V).toFixed(2)}× the freestream speed to get around the body, and its pressure drops ${((1 - pr) * 100).toFixed(1)} % below the freestream value (Bernoulli effect).`,
        };
  return {
    region: 'disturbed',
    title: 'Disturbed flow without a shock',
    text: `The state differs from the freestream (p = ${pr.toFixed(2)} p∞, M = ${v.mach.toFixed(2)}) without an entropy rise: an isentropic compression or expansion.`,
  };
}
