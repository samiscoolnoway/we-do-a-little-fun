import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Atmosphere, CasingState, ChipLevel, ChipState, InspectPreset, Level, PanelTab, ToneMode, ViewMode } from '../data/types';
import { DIES, FLOORPLAN, TRANSISTORS } from '../data/chip';
import { isInspectable, isSubsystem } from '../data/hierarchy';
import { N_STAGES, STAGES, STAGE_START, T_TOTAL, stageAt, stageProgress } from '../data/stages';

const STAGE_DURATION = STAGES.map((s) => s.duration);

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
  /** outer machine enclosure: closed = exterior view, open = interior visible */
  casing: CasingState;
  /** component or subsystem shown in the isolated inspection view (null = normal machine view) */
  inspect: string | null;
  /** slow automatic rotation in inspection mode, and its direction */
  spin: boolean;
  spinDir: 1 | -1;
  /** camera angle requested in inspection mode; camNonce changes on every request (also re-applies the same preset) */
  camPreset: InspectPreset;
  camNonce: number;
  /** finished wafer and chip explorer (null = the machine) */
  chip: ChipState | null;
}

const initial: SimState = {
  playing: false,
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
  casing: 'closed',
  inspect: null,
  spin: true,
  spinDir: 1,
  camPreset: 'default',
  camNonce: 0,
  chip: null,
};

/** scale levels from the outside in */
export const CHIP_ORDER: ChipLevel[] = ['wafer', 'die', 'block', 'cell', 'transistor'];
/** layers hidden by default at each level (the insulating fill would veil the dense region view) */
const CHIP_HIDDEN: Record<ChipLevel, string[]> = { wafer: [], die: [], block: ['diel', 'top'], cell: ['pass'], transistor: [] };
/** the circuit region opens slightly exploded so the cells show under the wiring; the transistor opens cut along its channel */
const CHIP_EXPLODE: Record<ChipLevel, number> = { wafer: 0, die: 0, block: 0.55, cell: 0, transistor: 0 };
const CHIP_SEL: Record<ChipLevel, string> = { wafer: 'wafer', die: 'die', block: 'block', cell: 'nand2', transistor: 'nfet' };
/** a die near the centre of the wafer, selected when the explorer opens */
const centreDie = () => DIES.filter((d) => d.full).sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))[0].i;
function chipAt(level: ChipLevel, prev: ChipState | null, patch: Partial<ChipState> = {}): ChipState {
  const base: ChipState = prev ?? { level, die: null, region: null, device: null, sel: null, selBox: null, view: 'top', explode: 0, hidden: [], iso: false, on: false, nonce: 0 };
  const device = level === 'transistor' ? (patch.device ?? base.device ?? 'nA') : level === 'cell' ? null : base.device;
  const sel = level === 'transistor' ? (TRANSISTORS.find((t) => t.id === device)?.info ?? 'nfet') : level === 'die' && base.die !== null && !DIES[base.die].full ? 'die-edge' : CHIP_SEL[level];
  return { ...base, level, sel, selBox: null, view: level === 'transistor' ? 'channel' : 'top', explode: CHIP_EXPLODE[level], hidden: CHIP_HIDDEN[level], iso: false, on: false, device, ...patch };
}
/** where the explorer goes back to */
let chipReturn: { view: ViewMode; focusId: string | null; casing: CasingState } | null = null;

let state: SimState = initial;
/**
 * Items that only exist at certain moments of the timeline: inspecting one outside that range moves the
 * (paused) timeline to where it can be seen. [first, last] stage index.
 */
const SHOW_AT: Record<string, [number, number, number]> = {
  // [first stage, last stage, how far into the first stage to go]
  resist: [7, 10, 0.6], // the magnified cross-section exists (fully grown) from mid-exposure on
  euvBeam: [7, 7, 0.4], // the whole light path, source to wafer, is lit during the exposure
  droplets: [0, 3, 0.4],
  laserPulses: [1, 3, 0.4],
  plasma: [2, 3, 0.4],
};
/** where to go back to when inspection ends */
let inspectReturn: { view: ViewMode; focusId: string | null; casing: CasingState; time: number | null } | null = null;
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
    // the timeline shows the inside of the machine, so playing opens the enclosure
    if (state.finished || time >= T_TOTAL - 0.01) {
      time = 0;
      set({ stage: 0, finished: false, playing: true, casing: 'open' });
      emitTime();
    } else set({ playing: true, casing: 'open' });
  },
  pause() {
    set({ playing: false });
  },
  toggle() {
    state.playing ? sim.pause() : sim.play();
  },
  restart() {
    time = 0;
    set({ stage: 0, finished: false, playing: true, casing: 'open' });
    emitTime();
  },
  goStage(i: number, opts?: { keepPlaying?: boolean }) {
    // choosing a stage on the timeline returns from the chip explorer to the machine
    if (state.chip) sim.exitChip();
    const k = Math.min(Math.max(i, 0), N_STAGES - 1);
    sim.setTime(STAGE_START[k] + 0.001);
    set({ casing: 'open' });
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
    set({ view, focusId: view === 'component' ? state.focusId : null, viewNonce: state.viewNonce + 1, casing: view === 'machine' ? state.casing : 'open' });
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
    set({ selectedId: id, view: 'component', focusId: id, viewNonce: state.viewNonce + 1, panelOpen: true, panelTab: 'inspect', hintVisible: false, casing: 'open' });
  },

  // ── machine enclosure ──
  openCasing() {
    set({ casing: 'open', hintVisible: false });
  },
  /** Back to the complete machine exterior: ends any inspection and shows the whole machine. */
  closeCasing() {
    if (inspectReturn?.time != null) sim.setTime(inspectReturn.time);
    inspectReturn = null;
    set({ inspect: null, selectedId: null, casing: 'closed', view: 'machine', focusId: null, viewNonce: state.viewNonce + 1 });
  },
  toggleCasing() {
    state.casing === 'closed' ? sim.openCasing() : sim.closeCasing();
  },

  // ── isolated component inspection ──
  /** Open the isolated inspection view for a component or subsystem; switching between items keeps the original return point. */
  inspect(id: string) {
    if (!isInspectable(id)) {
      sim.select(id);
      return;
    }
    if (!state.inspect) inspectReturn = { view: state.view, focusId: state.focusId, casing: state.casing, time: null };
    const range = SHOW_AT[id];
    if (range && (state.stage < range[0] || state.stage > range[1])) {
      // remember the original moment once, so Back returns to it
      if (inspectReturn && inspectReturn.time === null) inspectReturn.time = time;
      sim.setTime(STAGE_START[range[0]] + range[2] * STAGE_DURATION[range[0]]);
      set({ playing: false });
    }
    set({
      inspect: id,
      selectedId: isSubsystem(id) ? null : id,
      casing: id === 'enclosure' ? state.casing : 'open',
      spin: true,
      camPreset: 'default',
      camNonce: state.camNonce + 1,
      hintVisible: false,
    });
  },
  /** Back: leave inspection and restore the machine view the user came from. */
  exitInspect() {
    if (!state.inspect) return;
    const r = inspectReturn ?? { view: state.view, focusId: state.focusId, casing: state.casing, time: null };
    inspectReturn = null;
    if (r.time !== null) sim.setTime(r.time);
    set({ inspect: null, selectedId: null, view: r.view, focusId: r.focusId, casing: r.casing, viewNonce: state.viewNonce + 1 });
  },
  setSpin(spin: boolean) {
    set({ spin });
  },
  reverseSpin() {
    set({ spinDir: state.spinDir === 1 ? -1 : 1, spin: true });
  },
  /** Reset view and the Front/Side/Top/Isometric presets of the inspection camera. */
  setCamPreset(camPreset: InspectPreset) {
    set({ camPreset, camNonce: state.camNonce + 1 });
  },
  // ── finished wafer and chip explorer ──
  /** Leave the machine for the finished wafer (from the end of the process, or the explorer). */
  openChip() {
    if (state.chip) return;
    if (state.inspect) sim.exitInspect();
    chipReturn = { view: state.view, focusId: state.focusId, casing: state.casing };
    set({ chip: chipAt('wafer', null, { die: centreDie(), sel: 'wafer' }), selectedId: null, playing: false, spin: true, camPreset: 'default', camNonce: state.camNonce + 1, hintVisible: false });
  },
  /** Back to the machine, as it was. */
  exitChip() {
    if (!state.chip) return;
    const r = chipReturn ?? { view: state.view, focusId: state.focusId, casing: state.casing };
    chipReturn = null;
    set({ chip: null, view: r.view, focusId: r.focusId, casing: r.casing, viewNonce: state.viewNonce + 1, camPreset: 'default' });
  },
  /** Go to a scale level (deeper levels need their die / region / transistor). */
  chipGo(level: ChipLevel, patch: Partial<ChipState> = {}) {
    const c = state.chip;
    if (!c) return;
    set({ chip: chipAt(level, c, patch), camPreset: 'default', spin: true });
  },
  /** One scale up (from the wafer: back to the machine). */
  chipUp() {
    const c = state.chip;
    if (!c) return;
    const k = CHIP_ORDER.indexOf(c.level);
    if (k === 0) sim.exitChip();
    else sim.chipGo(CHIP_ORDER[k - 1], { device: c.level === 'transistor' ? null : c.device });
  },
  /** Select a structure at the current level (shows its explanation, highlights it). */
  chipSelect(h: { sel: string; die?: number; region?: string; box?: number; device?: string } | null) {
    const c = state.chip;
    if (!c) return;
    if (!h) {
      set({ chip: { ...c, sel: CHIP_SEL[c.level], selBox: null, iso: false } });
      return;
    }
    const patch: Partial<ChipState> = { sel: h.sel, selBox: h.box ?? null };
    if (h.die !== undefined && (c.level === 'wafer' || (c.level === 'die' && h.die !== c.die))) patch.die = h.die;
    if (c.level === 'die' && h.die !== undefined && h.die !== c.die) {
      // a neighbouring die: move over to it
      set({ chip: { ...c, ...patch, die: h.die, region: null, sel: DIES[h.die].full ? 'die' : 'die-edge' } });
      return;
    }
    if (h.region !== undefined) patch.region = h.region;
    // selecting one of the circuit-region structures isolates it (and shows its layer if it was hidden)
    if (c.level === 'block') {
      patch.iso = h.sel.startsWith('blk-') && h.box === undefined;
      if (patch.iso && (h.sel === 'blk-power' || h.sel === 'blk-clock') && c.hidden.includes('top')) patch.hidden = c.hidden.filter((x) => x !== 'top');
    }
    if (c.level === 'cell') patch.device = h.sel === 'nfet' || h.sel === 'pfet' ? (h.device ?? null) : null;
    if (c.level === 'cell' || c.level === 'transistor') patch.iso = false;
    set({ chip: { ...c, ...patch } });
  },
  /** Zoom into the selected item: die → region → cell → transistor. Returns false when there is nothing deeper. */
  chipDive(h?: { sel: string; die?: number; region?: string; box?: number; device?: string }) {
    const c = state.chip;
    if (!c) return false;
    if (h) sim.chipSelect(h);
    const s = state.chip!;
    if (s.level === 'wafer' && s.die !== null && DIES[s.die].full) {
      sim.chipGo('die', { sel: 'die' });
      return true;
    }
    if (s.level === 'die') {
      const r = FLOORPLAN.find((f) => f.id === s.region);
      if (r && (r.kind === 'logic' || r.kind === 'sram')) {
        sim.chipGo('block', { region: r.id });
        return true;
      }
      return false;
    }
    if (s.level === 'block' && (s.sel === 'std-cell' || s.sel === 'blk-cells')) {
      sim.chipGo('cell');
      return true;
    }
    if (s.level === 'cell') {
      const dev = s.device ?? (h?.device || null);
      if (dev) {
        sim.chipGo('transistor', { device: dev });
        return true;
      }
    }
    return false;
  },
  chipSet(patch: Partial<Pick<ChipState, 'view' | 'explode' | 'iso' | 'on' | 'hidden'>>) {
    const c = state.chip;
    if (!c) return;
    set({ chip: { ...c, ...patch } });
  },
  chipToggleLayer(id: string) {
    const c = state.chip;
    if (!c) return;
    set({ chip: { ...c, hidden: c.hidden.includes(id) ? c.hidden.filter((x) => x !== id) : [...c.hidden, id] } });
  },
  chipReset() {
    const c = state.chip;
    if (!c) return;
    set({ chip: { ...c, nonce: c.nonce + 1 }, camPreset: 'default', camNonce: state.camNonce + 1 });
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
