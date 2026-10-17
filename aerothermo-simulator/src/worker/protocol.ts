import type { SimConfig } from '../core/config';
import type { Diagnostics, Fields, SurfaceData } from '../core/simulation';

/** Messages between the UI thread and the flow-solver worker. Every result carries the runId it belongs to, so a
 *  late message from a superseded run can never be shown as the result of the current one. */
export type ToWorker =
  | { type: 'init'; runId: number; config: SimConfig }
  | { type: 'run' }
  | { type: 'pause' }
  | { type: 'step'; n: number }
  /** keep iterating past a converged / levelled / finished state (up to the step limit) */
  | { type: 'continue' };

export interface MeshMessage {
  type: 'mesh';
  runId: number;
  ni: number;
  nj: number;
  x: Float64Array;
  y: Float64Array;
  xc: Float64Array;
  yc: Float64Array;
  area: Float64Array;
  bodyX: Float64Array;
  bodyY: Float64Array;
  info: Record<string, number | string>;
}

export interface SnapshotMessage {
  type: 'snapshot';
  runId: number;
  /** true while the worker keeps iterating */
  running: boolean;
  fields: Fields;
  surface: SurfaceData;
  diag: Diagnostics;
  /** residual history, at most ~1000 points (down-sampled evenly by step) */
  history: Float32Array;
  historySteps: Float32Array;
}

export type FromWorker = MeshMessage | SnapshotMessage | { type: 'error'; runId: number; message: string };
