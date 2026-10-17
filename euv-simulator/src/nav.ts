import { useSyncExternalStore } from 'react';
import { sim, useSim } from './store/sim';

/**
 * Top-level sections of the application:
 *  - machine:  the EUV scanner (sim.state.chip === null)
 *  - explorer: the finished-wafer and transistor explorer (sim.state.chip !== null)
 *  - lab:      the Engineering & Computational Science Lab (AeroThermo Lab)
 * The machine and explorer share the 3-D scene and are told apart by the simulator store; the lab is a separate
 * view with its own store, so no state is shared between the lab and the other two sections.
 * The section is mirrored in the URL hash (#machine, #explorer, #lab) so that it can be linked to.
 */
export type Section = 'machine' | 'explorer' | 'lab';

let lab = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function writeHash(s: Section) {
  try {
    if (location.hash !== `#${s}`) history.replaceState(null, '', `#${s}`);
  } catch {
    /* sandboxed frames may refuse history changes; navigation still works */
  }
}

export const nav = {
  get lab() {
    return lab;
  },
  section(): Section {
    return lab ? 'lab' : sim.state.chip ? 'explorer' : 'machine';
  },
  go(s: Section) {
    if (s === 'lab') {
      if (!lab) {
        sim.pause();
        lab = true;
        emit();
      }
    } else {
      if (lab) {
        lab = false;
        emit();
      }
      if (s === 'explorer') sim.openChip();
      else sim.exitChip();
    }
    writeHash(s);
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useSection(): Section {
  const isLab = useSyncExternalStore(nav.subscribe, () => lab);
  const chip = useSim((s) => !!s.chip);
  return isLab ? 'lab' : chip ? 'explorer' : 'machine';
}

/** follow the URL hash on load and on back/forward (#lab, #explorer, #machine) */
export function initNavFromHash() {
  const apply = () => {
    const h = location.hash.replace('#', '');
    if (h === 'lab' || h === 'explorer' || h === 'machine') {
      if (h !== nav.section()) nav.go(h);
    }
  };
  // the explorer needs the 3-D scene; the lab and the machine can be opened straight away
  if (location.hash === '#explorer') window.addEventListener('euv-ready', apply, { once: true });
  else apply();
  window.addEventListener('hashchange', apply);
  // keep the hash in step when the section changes from inside a section (e.g. the explorer's own back button)
  let last = nav.section();
  const sync = () => {
    const now = nav.section();
    if (now !== last) {
      last = now;
      writeHash(now);
    }
  };
  sim.subscribe(sync);
  nav.subscribe(sync);
}
