import { useMemo } from 'react';
import { computeHeating, type HeatingResult } from '../core/heating';
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
