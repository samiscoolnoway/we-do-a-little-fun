import { crc32 } from './crc32';
import { SOLVER3D_STATE_REVISION, type BC3D, type Grid3D, type Primitive3D, type Solver3DState } from './euler3d';

/**
 * Checkpoint format for the 3D sphere case (version 1; docs/checkpoint-restart/DESIGN.md). Pure functions, no I/O:
 * the driver (sphere3d.ts) produces and consumes bytes; scripts/checkpoint3d-file.ts writes them atomically.
 *
 *   "E3DCKPT1" | version u32 | header length u32 | header JSON | float64 payload | CRC-32 u32 | "E3DCKEND"
 *
 * Little-endian throughout. The CRC covers everything before it. Decoding checks magic, version, end marker and CRC
 * before interpreting anything, then structure, lengths and value types, and throws Checkpoint3DError on any problem; compatibility with a requested run is checked separately
 * (checkpointMismatches), so a failed resume never turns into a silent fresh start.
 */
export const CHECKPOINT3D_FORMAT_VERSION = 1;
export const CHECKPOINT3D_SCHEMA = 'euler3d-sphere-checkpoint';
const MAGIC = 'E3DCKPT1';
const END = 'E3DCKEND';
const NV = 5;

export class Checkpoint3DError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Checkpoint3DError';
  }
}

/** every sphere-case option that affects the trajectory or the stopping test, defaults resolved */
export interface SphereRunConfig {
  mach: number;
  radiusCells: number;
  upstream: number;
  downstream: number;
  lateral: number;
  gridOffset: number;
  cfl: number;
  wall: 'ghost' | 'cutcell';
  reconstruction: 'ghost' | 'firstorder' | null;
  merge: boolean | null;
  flux: 'rusanov' | 'hllc';
  Tinf: number;
  pinf: number;
  startupSteps: number;
  residualDrop: number;
  massBalanceTol: number;
  /** recorded, but may be raised on resume (it only limits the run length) */
  maxSteps: number;
}

export interface SolverSetup3D {
  grid: Grid3D;
  gamma: number;
  timeMode: 'global' | 'local';
  bc: { xmin: BC3D; xmax: BC3D; ymin: BC3D; ymax: BC3D; zmin: BC3D; zmax: BC3D };
  freestream: Primitive3D;
}

export interface Checkpoint3D {
  config: SphereRunConfig;
  setup: SolverSetup3D;
  geometry: { fluidCells: number; crc: number };
  solver: Solver3DState;
  driver: { refFront: number; refAll: number; dropFront: number; dropAll: number; imbalance: number; elapsedMs: number; history: Float64Array };
  /** the segments this state was computed in, oldest first (one entry for a run that was never resumed) */
  lineage: { fromStep: number; toStep: number }[];
}

const LITTLE_ENDIAN = new Uint8Array(new Float64Array([1]).buffer)[7] === 0x3f;
const ascii = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));
const fail = (msg: string): never => {
  throw new Checkpoint3DError(msg);
};

function putF64(out: Uint8Array, off: number, a: Float64Array) {
  if (LITTLE_ENDIAN) out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), off);
  else {
    const dv = new DataView(out.buffer, out.byteOffset);
    for (let i = 0; i < a.length; i++) dv.setFloat64(off + 8 * i, a[i], true);
  }
}

function getF64(bytes: Uint8Array, off: number, len: number): Float64Array {
  if (LITTLE_ENDIAN) return new Float64Array(bytes.slice(off, off + 8 * len).buffer);
  const dv = new DataView(bytes.buffer, bytes.byteOffset);
  const a = new Float64Array(len);
  for (let i = 0; i < len; i++) a[i] = dv.getFloat64(off + 8 * i, true);
  return a;
}

export function encodeCheckpoint3D(cp: Checkpoint3D): Uint8Array {
  const arrays: [string, Float64Array][] = [...cp.solver.U.map((a, v) => [`U${v}`, a] as [string, Float64Array]), ['history', cp.driver.history]];
  const { history: _h, ...driver } = cp.driver;
  for (const [k, v] of Object.entries(driver)) if (!Number.isFinite(v)) fail(`driver value ${k} = ${v} is not finite and cannot be checkpointed`);
  const header = {
    schema: CHECKPOINT3D_SCHEMA,
    version: CHECKPOINT3D_FORMAT_VERSION,
    solverRevision: cp.solver.revision,
    config: cp.config,
    setup: cp.setup,
    geometry: cp.geometry,
    solver: { steps: cp.solver.steps, time: cp.solver.time, lastDt: cp.solver.lastDt, order: cp.solver.order, hllcFallbacksTotal: cp.solver.hllcFallbacksTotal, hllcCalls: cp.solver.hllcCalls },
    driver,
    lineage: cp.lineage,
    arrays: arrays.map(([name, a]) => ({ name, length: a.length })),
  };
  const h = new TextEncoder().encode(JSON.stringify(header));
  const L = arrays.reduce((s, [, a]) => s + a.length, 0);
  const out = new Uint8Array(16 + h.length + 8 * L + 12);
  const dv = new DataView(out.buffer);
  out.set(ascii(MAGIC), 0);
  dv.setUint32(8, CHECKPOINT3D_FORMAT_VERSION, true);
  dv.setUint32(12, h.length, true);
  out.set(h, 16);
  let off = 16 + h.length;
  for (const [, a] of arrays) {
    putF64(out, off, a);
    off += 8 * a.length;
  }
  dv.setUint32(off, crc32(out.subarray(0, off)), true);
  out.set(ascii(END), off + 4);
  return out;
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isInt = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0;

export function decodeCheckpoint3D(bytes: Uint8Array): Checkpoint3D {
  if (!(bytes instanceof Uint8Array)) fail('checkpoint data must be a Uint8Array');
  if (bytes.length < 28) fail(`checkpoint truncated: ${bytes.length} bytes`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (off: number, n: number) => String.fromCharCode(...bytes.subarray(off, off + n));
  if (str(0, 8) !== MAGIC) fail('not a 3D-solver checkpoint (bad magic)');
  const version = dv.getUint32(8, true);
  if (version !== CHECKPOINT3D_FORMAT_VERSION) fail(`unsupported checkpoint format version ${version} (supported: ${CHECKPOINT3D_FORMAT_VERSION})`);
  const H = dv.getUint32(12, true);
  if (16 + H + 12 > bytes.length) fail('checkpoint truncated inside the header');
  // integrity before interpretation: end marker and CRC over everything before the CRC field
  const off = bytes.length - 12;
  if (str(off + 4, 8) !== END) fail('checkpoint truncated, extended or corrupted (end marker missing)');
  if (crc32(bytes.subarray(0, off)) !== dv.getUint32(off, true)) fail('checkpoint CRC mismatch (corrupted file)');
  let header: Record<string, any>;
  try {
    header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(16, 16 + H)));
  } catch {
    return fail('checkpoint header is not valid JSON');
  }
  if (header === null || typeof header !== 'object') fail('checkpoint header is not an object');
  if (header.schema !== CHECKPOINT3D_SCHEMA) fail(`unknown checkpoint schema ${JSON.stringify(header.schema)}`);
  if (header.version !== version) fail('header version differs from the file version');
  const arrays = header.arrays;
  const names = [...Array.from({ length: NV }, (_, v) => `U${v}`), 'history'];
  if (!Array.isArray(arrays) || arrays.length !== names.length || arrays.some((a: any, i: number) => !a || a.name !== names[i] || !isInt(a.length))) fail('checkpoint array table is invalid');
  const L = arrays.reduce((s: number, a: any) => s + a.length, 0);
  const expected = 16 + H + 8 * L + 12;
  if (bytes.length !== expected) fail(`checkpoint length ${bytes.length} bytes, expected ${expected} from its array table (truncated or extended file)`);

  const { config, setup, geometry, solver, driver, lineage } = header;
  if (!isInt(header.solverRevision)) fail('solver revision missing');
  if (!config || typeof config !== 'object') fail('config missing');
  if (!setup || !setup.grid || !setup.bc || !setup.freestream || !isNum(setup.gamma)) fail('solver setup missing');
  if (!geometry || !isInt(geometry.fluidCells) || !isInt(geometry.crc)) fail('geometry fingerprint missing');
  if (!solver || !isInt(solver.steps) || !isNum(solver.time) || !isNum(solver.lastDt) || (solver.order !== 1 && solver.order !== 2) || !isInt(solver.hllcFallbacksTotal) || !isInt(solver.hllcCalls)) fail('solver counters missing or invalid');
  if (!driver || !['refFront', 'refAll', 'dropFront', 'dropAll', 'imbalance', 'elapsedMs'].every((k) => isNum(driver[k]))) fail('driver state missing or invalid');
  if (!Array.isArray(lineage) || lineage.length < 1 || lineage.some((s: any) => !s || !isInt(s.fromStep) || !isInt(s.toStep) || s.toStep < s.fromStep)) fail('lineage missing or invalid');
  if (lineage[lineage.length - 1].toStep !== solver.steps) fail('lineage does not end at the checkpointed step');

  let p = 16 + H;
  const U: Float64Array[] = [];
  for (let v = 0; v < NV; v++) {
    U.push(getF64(bytes, p, arrays[v].length));
    p += 8 * arrays[v].length;
  }
  const history = getF64(bytes, p, arrays[NV].length);
  if (history.length !== solver.steps) fail(`residual history has ${history.length} entries for ${solver.steps} steps`);
  for (let i = 0; i < history.length; i++) if (!Number.isFinite(history[i])) fail(`residual history entry ${i} is not finite`);
  for (let v = 0; v < NV; v++) for (let c = 0; c < U[v].length; c++) if (!Number.isFinite(U[v][c])) fail(`conservative array ${v} has a non-finite value at padded index ${c}`);
  return {
    config,
    setup,
    geometry,
    solver: { revision: header.solverRevision, U, steps: solver.steps, time: solver.time, lastDt: solver.lastDt, order: solver.order, hllcFallbacksTotal: solver.hllcFallbacksTotal, hllcCalls: solver.hllcCalls },
    driver: { ...driver, history },
    lineage,
  };
}

/**
 * Every difference between a decoded checkpoint and the run that wants to continue it (empty: compatible).
 * `maxSteps` may differ (it only limits the run); everything else must be identical.
 */
export function checkpointMismatches(cp: Checkpoint3D, run: { config: SphereRunConfig; setup: SolverSetup3D; geometry: { fluidCells: number; crc: number } }): string[] {
  const out: string[] = [];
  if (cp.solver.revision !== SOLVER3D_STATE_REVISION) out.push(`solver revision: checkpoint ${cp.solver.revision}, solver ${SOLVER3D_STATE_REVISION}`);
  const cmp = (path: string, a: unknown, b: unknown) => {
    if (a !== b) out.push(`${path}: checkpoint ${JSON.stringify(a)}, run ${JSON.stringify(b)}`);
  };
  const keys = new Set([...Object.keys(cp.config), ...Object.keys(run.config)]);
  for (const k of keys) if (k !== 'maxSteps') cmp(`config.${k}`, (cp.config as any)[k], (run.config as any)[k]);
  for (const k of ['nx', 'ny', 'nz', 'x0', 'y0', 'z0', 'dx', 'dy', 'dz'] as const) cmp(`grid.${k}`, cp.setup.grid[k], run.setup.grid[k]);
  cmp('gamma', cp.setup.gamma, run.setup.gamma);
  cmp('timeMode', cp.setup.timeMode, run.setup.timeMode);
  for (const k of ['xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax'] as const) cmp(`bc.${k}`, cp.setup.bc[k], run.setup.bc[k]);
  for (const k of ['rho', 'u', 'v', 'w', 'p'] as const) cmp(`freestream.${k}`, cp.setup.freestream[k], run.setup.freestream[k]);
  cmp('geometry.fluidCells', cp.geometry.fluidCells, run.geometry.fluidCells);
  cmp('geometry.crc', cp.geometry.crc, run.geometry.crc);
  return out;
}
