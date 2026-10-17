import { useDeferredValue, useMemo } from 'react';
import { computeHeating, type HeatingResult } from '../core/heating';
import { solveConduction, type ThermalResult } from '../core/thermal';
import { useStore } from './store';

/**
 * Heating evaluated from the latest flow snapshot and the configuration that flow was computed with. The wall
 * reference temperature and emissivity come from the heat-shield settings, which do not affect the flow.
 */
export function useHeating(): { heating: HeatingResult | null; converged: boolean; step: number } {
  const snap = useStore((s) => s.snap);
  const run = useStore((s) => s.run);
  const T0 = useStore((s) => s.edited.thermal.T0);
  const eps = useStore((s) => s.edited.thermal.emissivity);
  return useMemo(() => {
    if (!snap || snap.diag.steps === 0 || snap.diag.failure) return { heating: null, converged: false, step: snap?.diag.steps ?? 0 };
    const d = snap.diag;
    const converged = d.status === 'converged' || d.status === 'levelled' || (d.mode === 'transient' && d.status === 'finished');
    return { heating: computeHeating(snap.surface, run, T0, eps), converged, step: d.steps };
  }, [snap, run, T0, eps]);
}

export interface Station {
  name: string;
  phi: number;
  H: number;
  Taw: number;
  Te: number;
  result: ThermalResult;
}

/**
 * Heat-shield response at three stations (stagnation point, 30° and 60° on the upper surface) and, for the
 * quasi-2D map, at every windward wall point. Each is an independent 1D conduction column; recomputed whenever
 * the flow snapshot or the heat-shield parameters change, so it always matches what is shown.
 */
export function useThermal() {
  const { heating, converged, step } = useHeating();
  const thermal = useStore((s) => s.edited.thermal);
  const deferred = useDeferredValue(thermal);
  const stations = useMemo<Station[] | null>(() => {
    if (!heating) return null;
    const upper = heating.points.filter((p) => p.s >= 0);
    const pick = (deg: number) => upper.reduce((b, p) => (Math.abs(p.phi - deg) < Math.abs(b.phi - deg) ? p : b));
    const out: Station[] = [];
    const st = heating.stag;
    out.push({ name: 'Stagnation point', phi: 0, H: st.H, Taw: st.Taw, Te: st.Te, result: solveConduction(deferred, { H: st.H, Taw: st.Taw }, 1500) });
    for (const deg of [30, 60]) {
      const p = pick(deg);
      if (Math.abs(p.phi - deg) > 6) continue;
      out.push({ name: `${deg}° station`, phi: p.phi, H: p.H, Taw: p.Taw, Te: p.Te, result: solveConduction(deferred, { H: p.H, Taw: p.Taw }, 1500) });
    }
    return out;
  }, [heating, deferred]);
  const columns = useMemo(() => {
    if (!heating) return null;
    const pts = heating.points;
    return pts.map((p) => ({ phi: p.s < 0 ? -p.phi : p.phi, T: solveConduction(deferred, { H: p.H, Taw: p.Taw }, 500).profile }));
  }, [heating, deferred]);
  return { heating, converged, step, stations, columns, thermal: deferred, stale: deferred !== thermal };
}
