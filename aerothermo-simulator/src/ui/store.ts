import { useSyncExternalStore } from 'react';
import { DEFAULT_CONFIG, type SimConfig, cloneConfig } from '../core/config';
import { type ComparisonRow, type Experiment, experimentConfigs, summarize } from '../core/experiments';
import { matchMaterial } from '../core/materials';
import type { FieldName } from '../core/simulation';
import type { FromWorker, MeshMessage, SnapshotMessage, ToWorker } from '../worker/protocol';

/**
 * Application state. Two configurations are kept apart on purpose:
 *  - `edited`: what the controls currently show;
 *  - `run`:    the configuration the displayed flow results were actually computed from.
 * If they differ in any flow-relevant field, `needsRestart()` is true and the UI says so; the results on screen are
 * never relabelled as belonging to the edited parameters.
 */
export interface ViewOptions {
  field: FieldName;
  smooth: boolean;
  mesh: boolean;
  vectors: boolean;
  streamlines: boolean;
}

export interface AppState {
  edited: SimConfig;
  run: SimConfig;
  runId: number;
  mesh: MeshMessage | null;
  snap: SnapshotMessage | null;
  /** the worker is iterating */
  running: boolean;
  error: string | null;
  view: ViewOptions;
  probe: { x: number; y: number } | null;
  /** comparison table (rows computed from finished or explicitly recorded runs) */
  rows: ComparisonRow[];
  /** automated experiment in progress */
  experiment: { id: string; title: string; queue: { name: string; config: SimConfig }[]; index: number } | null;
}

const TERMINAL = new Set(['converged', 'levelled', 'finished', 'max-steps', 'failed']);

type Listener = () => void;

/** the parts of the configuration that change the flow solution */
export function flowKey(c: SimConfig): string {
  return JSON.stringify([c.flow, c.body, c.numerics]);
}

export class Store {
  state: AppState;
  private listeners = new Set<Listener>();
  private worker: Worker | null = null;

  constructor() {
    const c = cloneConfig(DEFAULT_CONFIG);
    this.state = {
      edited: c,
      run: cloneConfig(c),
      runId: 0,
      mesh: null,
      snap: null,
      running: false,
      error: null,
      view: { field: 'mach', smooth: true, mesh: false, vectors: false, streamlines: true },
      probe: null,
      rows: [],
      experiment: null,
    };
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private set(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** start the worker and initialise the default run */
  boot(worker: Worker) {
    this.worker = worker;
    worker.onmessage = (e: MessageEvent<FromWorker>) => this.onWorker(e.data);
    worker.onerror = (e) => this.set({ error: `Worker error: ${e.message}`, running: false });
    this.init(this.state.run);
  }

  private post(m: ToWorker) {
    this.worker?.postMessage(m);
  }

  private onWorker(m: FromWorker) {
    // results of a superseded run are dropped
    if (m.runId !== this.state.runId) return;
    if (m.type === 'mesh') this.set({ mesh: m });
    else if (m.type === 'snapshot') {
      this.set({ snap: m, running: m.running });
      const ex = this.state.experiment;
      if (ex && !m.running && TERMINAL.has(m.diag.status)) {
        this.record(ex.queue[ex.index].name);
        this.nextExperimentItem();
      }
    } else if (m.type === 'error') this.set({ error: m.message, running: false, experiment: null });
  }

  // ───────── comparison table and experiments ─────────
  /** add the current result to the comparison table */
  record(name?: string) {
    const { snap, mesh, run } = this.state;
    if (!snap || !mesh || snap.diag.steps === 0) return;
    const label = name ?? `Run ${this.state.rows.length + 1}: M = ${run.flow.mach}, ${snap.diag.ni}×${snap.diag.nj}`;
    const row = summarize(label, run, snap.diag, snap.surface, snap.fields.rho, mesh.xc, matchMaterial(run.thermal)?.label ?? 'custom');
    this.set({ rows: [...this.state.rows, row] });
  }

  removeRow(id: number) {
    this.set({ rows: this.state.rows.filter((r) => r.id !== id) });
  }

  clearRows() {
    this.set({ rows: [] });
  }

  runExperiment(e: Experiment) {
    const queue = experimentConfigs(e);
    this.set({ experiment: { id: e.id, title: e.title, queue, index: -1 } });
    this.nextExperimentItem();
  }

  cancelExperiment() {
    this.set({ experiment: null });
    this.pause();
  }

  private nextExperimentItem() {
    const ex = this.state.experiment;
    if (!ex) return;
    const index = ex.index + 1;
    if (index >= ex.queue.length) {
      this.set({ experiment: null });
      return;
    }
    this.set({ experiment: { ...ex, index } });
    const item = ex.queue[index];
    const d = this.state.snap?.diag;
    // same flow as the finished current run (only heat-shield parameters differ): reuse it
    if (d && TERMINAL.has(d.status) && d.status !== 'failed' && flowKey(item.config) === flowKey(this.state.run)) {
      this.set({ run: cloneConfig({ ...this.state.run, thermal: item.config.thermal }), edited: cloneConfig(item.config) });
      this.record(item.name);
      this.nextExperimentItem();
      return;
    }
    this.set({ edited: cloneConfig(item.config) });
    this.init(item.config);
    this.post({ type: 'run' });
    this.set({ running: true });
  }

  private init(config: SimConfig) {
    const runId = this.state.runId + 1;
    const run = cloneConfig(config);
    this.set({ run, runId, snap: null, mesh: null, running: false, error: null });
    this.post({ type: 'init', runId, config: run });
  }

  // ───────── actions ─────────
  needsRestart(): boolean {
    return flowKey(this.state.edited) !== flowKey(this.state.run);
  }

  /** start iterating the current run (continues a paused run) */
  runSim() {
    const d = this.state.snap?.diag;
    if (d && d.status !== 'ready' && d.status !== 'running') this.post({ type: 'continue' });
    else this.post({ type: 'run' });
    this.set({ running: true });
  }

  pause() {
    this.post({ type: 'pause' });
    this.set({ running: false });
  }

  step(n = 1) {
    this.post({ type: 'step', n });
  }

  /** back to the initial (freestream) state with the same parameters the results were computed with */
  reset() {
    this.init(this.state.run);
  }

  /** apply the edited parameters: new mesh, new solver, initial state */
  restart() {
    this.init(this.state.edited);
  }

  /** controls back to the default parameters (the current results stay until a restart) */
  restoreDefaults() {
    this.set({ edited: cloneConfig(DEFAULT_CONFIG) });
  }

  /** set any configuration value by path, e.g. edit('flow', 'mach', 4) */
  edit<S extends keyof SimConfig, K extends keyof SimConfig[S]>(section: S, key: K, value: SimConfig[S][K]) {
    const edited = cloneConfig(this.state.edited);
    edited[section][key] = value;
    this.set({ edited });
  }

  /** replace the whole edited configuration (scenarios) */
  setEdited(c: SimConfig) {
    this.set({ edited: cloneConfig(c) });
  }

  setView(patch: Partial<ViewOptions>) {
    this.set({ view: { ...this.state.view, ...patch } });
  }

  setProbe(p: { x: number; y: number } | null) {
    this.set({ probe: p });
  }
}

export const store = new Store();

export function useStore<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => sel(store.state));
}
