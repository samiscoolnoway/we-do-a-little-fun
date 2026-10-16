import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Atmosphere, Level, PanelTab, ToneMode, ViewMode } from '../data/types';
import { N_STAGES, STAGE_START, T_TOTAL, stageAt, stageProgress } from '../data/stages';

export interface SimState {
  playing: boolean;
  speed: number;
  stage: number;
  finished: boolean;
  labels: boolean;
  path: boolean;
  view: ViewMode;
  focusId: string | null;
  viewNonce: number;
  tone: ToneMode;
  atmosphere: Atmosphere;
  dose: number;
  deep: boolean;
  panelOpen: boolean;
  panelTab: PanelTab;
  selectedId: string | null;
  conceptLevel: Level;
  conceptOpen: string | null;
  hintVisible: boolean;
  webgl: 'pending' | 'ok' | 'failed';
}

const initial: SimState = {
  playing: true,
  speed: 1,
  stage: 0,
  finished: false,
  labels: true,
  path: true,
  view: 'machine',
  focusId: null,
  viewNonce: 0,
  tone: 'positive',
  atmosphere: 'vacuum',
  dose: 1,
  deep: false,
  panelOpen: false,
  panelTab: 'inspect',
  selectedId: null,
  conceptLevel: 'intermediate',
  conceptOpen: null,
  hintVisible: true,
  webgl: 'pending',
};

let state: SimState = initial;
let time = 0;
const listeners = new Set<() => void>();
const timeListeners = new Set<(t: number) => void>();

function set(patch: Partial<SimState>) {
  let changed = false;
  for (const k of Object.keys(patch) as (keyof SimState)[]) {
    if (state[k] !== patch[k]) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
const emitTime = () => timeListeners.forEach((l) => l(time));

export const sim = {
  get state() {
    return state;
  },
  getTime: () => time,
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  subscribeTime(fn: (t: number) => void): () => void {
    timeListeners.add(fn);
    return () => {
      timeListeners.delete(fn);
    };
  },

  // ── transport ──
  setTime(t: number) {
    time = Math.min(Math.max(t, 0), T_TOTAL - 1e-3);
    const st = stageAt(time);
    set({ stage: st, finished: false });
    emitTime();
  },
  tick(dt: number) {
    if (!state.playing) return;
    const t = time + dt * state.speed;
    if (t >= T_TOTAL - 1e-3) {
      time = T_TOTAL - 1e-3;
      set({ stage: N_STAGES - 1, playing: false, finished: true });
    } else {
      time = t;
      const st = stageAt(time);
      if (st !== state.stage) set({ stage: st });
    }
    emitTime();
  },
  play() {
    if (state.finished || time >= T_TOTAL - 0.01) {
      time = 0;
      set({ stage: 0, finished: false, playing: true });
      emitTime();
    } else set({ playing: true });
  },
  pause() {
    set({ playing: false });
  },
  toggle() {
    state.playing ? sim.pause() : sim.play();
  },
  restart() {
    time = 0;
    set({ stage: 0, finished: false, playing: true });
    emitTime();
  },
  goStage(i: number, opts?: { keepPlaying?: boolean }) {
    const k = Math.min(Math.max(i, 0), N_STAGES - 1);
    sim.setTime(STAGE_START[k] + 0.001);
    if (opts?.keepPlaying === false) set({ playing: false });
  },
  next() {
    sim.goStage(Math.min(state.stage + 1, N_STAGES - 1));
  },
  prev() {
    const p = stageProgress(time, state.stage);
    sim.goStage(p > 0.1 ? state.stage : Math.max(state.stage - 1, 0));
  },
  setSpeed(speed: number) {
    set({ speed });
  },

  // ── view ──
  toggleLabels() {
    set({ labels: !state.labels });
  },
  togglePath() {
    set({ path: !state.path });
  },
  setView(view: ViewMode) {
    set({ view, focusId: view === 'component' ? state.focusId : null, viewNonce: state.viewNonce + 1 });
  },
  setTone(tone: ToneMode) {
    set({ tone });
  },
  setAtmosphere(atmosphere: Atmosphere) {
    set({ atmosphere });
  },
  setDose(dose: number) {
    set({ dose });
  },
  toggleDeep() {
    const deep = !state.deep;
    set({
      deep,
      conceptLevel: deep ? 'advanced' : state.conceptLevel === 'advanced' ? 'intermediate' : state.conceptLevel,
      panelOpen: deep ? true : state.panelOpen,
    });
  },

  // ── panel / selection ──
  togglePanel(open?: boolean) {
    set({ panelOpen: open ?? !state.panelOpen });
  },
  setTab(panelTab: PanelTab) {
    set({ panelTab, panelOpen: true });
  },
  select(id: string | null) {
    if (id === null) set({ selectedId: null });
    else set({ selectedId: id, panelOpen: true, panelTab: 'inspect', hintVisible: false });
  },
  focusComponent(id: string) {
    set({ selectedId: id, view: 'component', focusId: id, viewNonce: state.viewNonce + 1, panelOpen: true, panelTab: 'inspect', hintVisible: false });
  },
  setConceptLevel(conceptLevel: Level) {
    set({ conceptLevel });
  },
  setConceptOpen(conceptOpen: string | null) {
    set({ conceptOpen });
  },
  dismissHint() {
    set({ hintVisible: false });
  },
  setWebgl(webgl: SimState['webgl']) {
    set({ webgl });
  },
};

export function useSim<T>(selector: (s: SimState) => T): T {
  return useSyncExternalStore(
    sim.subscribe,
    () => selector(state),
    () => selector(state),
  );
}

/** Subscribe to the high-frequency timeline clock without re-rendering React. */
export function useTimeListener(fn: (t: number) => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    ref.current(time);
    return sim.subscribeTime((t) => ref.current(t));
  }, []);
}
