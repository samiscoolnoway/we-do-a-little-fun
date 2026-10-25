// Browser dataset of the 3D Mach 2 sphere results (milestone M0 of the integration plan): format definitions, the
// reconstruction of a checkpointed run exactly as sphere3d.ts runSphereCase builds it, the advance to the archived
// convergence step under the run's own stopping rule, the extraction of the plane next to the z = 0 symmetry plane,
// measured 8-bit quantization, and readers of the archived research data. Used by scripts/export-sphere3d-dataset.test.ts,
// scripts/verify-sphere3d-dataset.test.ts and tests/lab/sphere3d-dataset.test.ts. Node only (fs, crypto, zlib).
//
// Nothing here changes a checkpoint or an archive; everything that is missing or inconsistent is an error.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { checkpointMismatches, decodeCheckpoint3D, type Checkpoint3D, type SphereRunConfig } from '../src/lab/core/checkpoint3d';
import { EulerSolver3D, makeBoxGrid, SOLVER3D_STATE_REVISION } from '../src/lab/core/euler3d';
import { freestream, normalShock } from '../src/lab/core/gas';
import { billigSphere } from '../src/lab/core/sphere3d';

export const DATASET_SCHEMA = 'euv-sphere3d-browser-dataset';
export const DATASET_VERSION = 1;
export const PROJECT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const DOCS = path.join(PROJECT, 'docs');
export const DEFAULT_OUT = path.join(DOCS, 'sphere3d-browser-dataset-v1');
/** stagnation-line profiles keep the rows within this distance of the sphere surface (in R); the full rows are in the archives */
export const PROFILE_D_MAX = 0.6;

/** full-precision plane: six Float64 arrays, little-endian, each nx·ny values, index j·nx + i */
export const F64_FIELDS = [
  { name: 'rho', definition: 'ρ / ρ∞', unit: '1' },
  { name: 'u', definition: 'u / V∞ (x, the freestream direction)', unit: '1' },
  { name: 'v', definition: 'v / V∞ (y)', unit: '1' },
  { name: 'w', definition: 'w / V∞ (z, normal to the plane; small next to the symmetry plane)', unit: '1' },
  { name: 'p', definition: 'p / p∞', unit: '1' },
  { name: 'alpha', definition: 'fluid volume fraction of the cell (0 = inside the sphere, 1 = full fluid cell, between: cut cell)', unit: '1' },
] as const;
/** browser plane: six Uint8 arrays, each nx·ny values, index j·nx + i; value = lo + code·(hi − lo)/255 for fluid cells */
export const U8_FIELDS = [
  { name: 'rho', definition: 'ρ / ρ∞', unit: '1' },
  { name: 'p', definition: 'p / p∞', unit: '1' },
  { name: 'mach', definition: '|V| / a, a = √(γ p / ρ), from the full-precision state', unit: '1' },
  { name: 'u', definition: 'u / V∞', unit: '1' },
  { name: 'v', definition: 'v / V∞', unit: '1' },
  { name: 'alpha', definition: 'fluid volume fraction: code 0 = solid, otherwise max(1, round(255·α))', unit: '1' },
] as const;

export interface PlaneSource {
  /** identifier used in file names, e.g. rh48-off0.5 */
  id: string;
  radiusCells: number;
  gridOffset: number;
  checkpoint: string;
  /** archived summary of the converged run this checkpoint belongs to (its last line is used) */
  archivedSummary: string;
  /** write the 8-bit browser plane for this source too */
  browser: boolean;
}

export const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
export const fileSha256 = (f: string) => sha256(readFileSync(f));
export const rel = (f: string) => path.relative(PROJECT, f).split(path.sep).join('/');
export const gzipBytes = (b: Uint8Array | string) => gzipSync(b, { level: 9 }).length;

/** deterministic JSON: insertion-ordered keys, shortest round-trip numbers, final newline */
export const stableJson = (v: unknown, indent?: number) => JSON.stringify(v, null, indent) + '\n';

export function jsonl(f: string): any[] {
  if (!existsSync(f)) throw new Error(`missing archive file: ${rel(f)}`);
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export function requireFile(f: string, what: string) {
  if (!f || !existsSync(f)) throw new Error(`${what} not found: ${f || '(not given)'}`);
}

// ─────────────────────────────── solver reconstruction (as sphere3d.ts runSphereCase) ───────────────────────────────

export function runConfigOf(radiusCells: number, gridOffset: number): SphereRunConfig {
  // the reference configuration of the refinement study: reduced domain, Rusanov, cut cells, 4-order stopping rule
  return {
    mach: 2,
    radiusCells,
    upstream: 2,
    downstream: 0.5,
    lateral: 2,
    gridOffset,
    cfl: 0.8,
    wall: 'cutcell',
    reconstruction: null,
    merge: null,
    flux: 'rusanov',
    Tinf: 220,
    pinf: 2500,
    startupSteps: 150,
    residualDrop: 4,
    massBalanceTol: 1e-3,
    maxSteps: 20000,
  } as SphereRunConfig;
}

export function buildSolver(cfg: SphereRunConfig) {
  const R = 1;
  const h = R / cfg.radiusCells;
  const nx = Math.round((cfg.upstream + cfg.downstream) * cfg.radiusCells);
  const nyz = Math.round(cfg.lateral * cfg.radiusCells);
  const x0 = -cfg.upstream * R - cfg.gridOffset * h;
  const grid = makeBoxGrid(x0, x0 + nx * h, 0, nyz * h, 0, nyz * h, nx, nyz, nyz);
  const fs = freestream(cfg.mach, cfg.Tinf, cfg.pinf, 0);
  const fs3 = { rho: fs.rho, u: fs.u, v: 0, w: 0, p: fs.p };
  const s = new EulerSolver3D(grid, {
    cfl: cfg.cfl,
    order: 1,
    timeMode: 'local',
    freestream: fs3,
    sphere: { cx: 0, cy: 0, cz: 0, r: R, wall: cfg.wall, reconstruction: undefined, merge: undefined },
    bc: { xmin: 'inflow', xmax: 'extrapolate', ymin: 'wall', ymax: 'extrapolate', zmin: 'wall', zmax: 'extrapolate' },
    residualRegion: (x) => x < 0,
    flux: cfg.flux,
  });
  s.init(() => fs3);
  const setup = { grid, gamma: s.gamma, timeMode: 'local' as const, bc: s.opts.bc, freestream: fs3 };
  return { s, R, h, nx, nyz, x0, fs, setup };
}

/** load a checkpoint into a freshly built solver; refuses anything that does not match the reference configuration */
export function loadCheckpoint(file: string, radiusCells: number, gridOffset: number) {
  requireFile(file, 'checkpoint');
  const bytes = new Uint8Array(readFileSync(file));
  const cp = decodeCheckpoint3D(bytes);
  const cfg = runConfigOf(radiusCells, gridOffset);
  const b = buildSolver(cfg);
  const problems = checkpointMismatches(cp, { config: cfg, setup: b.setup, geometry: b.s.geometryFingerprint() });
  if (problems.length) throw new Error(`${file}: incompatible with the reference configuration: ${problems.join('; ')}`);
  b.s.importState(cp.solver);
  return { ...b, cp, cfg, bytes: bytes.length, sha256: sha256(bytes) };
}

/**
 * Continue a loaded checkpoint with exactly the driver's loop (sphere3d.ts runSphereCase) until its stopping rule is
 * met: residual in x < 0 down `residualDrop` orders and |net mass flux| below `massBalanceTol` of the intercepted flux.
 */
export function advanceToConvergence(run: ReturnType<typeof loadCheckpoint>, limit = 2000) {
  const { s, cp, cfg, fs } = run;
  const intercepted = fs.rho * fs.V * Math.PI * 0.25;
  const refFront = cp.driver.refFront;
  const startStep = cp.solver.steps;
  let dropFront = cp.driver.dropFront;
  let imbalance = cp.driver.imbalance;
  for (let n = startStep; n < startStep + limit; n++) {
    if (n === cfg.startupSteps) s.setOrder(2);
    const r = s.step();
    if (!r.ok) throw new Error(`solver failed at step ${n + 1}: ${JSON.stringify(s.failure)}`);
    dropFront = Math.log10(refFront / r.residualRegion);
    imbalance = Math.abs(s.boundaryMassFlux + s.bodyMassFlux) / intercepted;
    if (n > cfg.startupSteps + 20 && dropFront >= cfg.residualDrop && imbalance < cfg.massBalanceTol)
      return { startStep, steps: s.steps, dropFront, imbalance };
  }
  throw new Error(`not converged within ${limit} steps after step ${startStep}`);
}

/** stagnation-line detectors exactly as sphere3d.ts runSphereCase and scripts/sphere3d-resumable.test.ts (line j = k = 0) */
export function detectors(s: EulerSolver3D, h: number, nx: number, fsRho: number) {
  const R = 1;
  let iNose = 0;
  for (let i = 0; i < nx; i++) {
    if (s.isSolid(i, 0, 0)) break;
    iNose = i;
  }
  const rho2 = fsRho * normalShock(2).r21;
  const xNose = -Math.sqrt(R * R - 2 * (0.5 * h) ** 2);
  const prof = Array.from({ length: iNose + 1 }, (_, i) => {
    const r = s.cell(i, 0, 0).rho;
    return { x: s.centre(i, 0, 0)[0], rho: r / fsRho, phi: (r - fsRho) / (rho2 - fsRho), alpha: s.fluidFraction(i, 0, 0) };
  });
  const cross = (lv: number) => {
    for (let i = 1; i < prof.length; i++) if (prof[i - 1].phi < lv && prof[i].phi >= lv) return xNose - (prof[i - 1].x + (h * (lv - prof[i - 1].phi)) / (prof[i].phi - prof[i - 1].phi));
    return NaN;
  };
  let kMax = -1;
  const rise = (i: number) => (i >= 1 && i < prof.length && prof[i].alpha === 1 && prof[i - 1].alpha === 1 ? prof[i].rho - prof[i - 1].rho : -Infinity);
  for (let i = 1; i < prof.length; i++) if (rise(i) > -Infinity && (kMax < 0 || rise(i) > rise(kMax))) kMax = i;
  const [dm, d0, dp] = [rise(kMax - 1), rise(kMax), rise(kMax + 1)];
  let o = 0;
  if (Number.isFinite(dm) && Number.isFinite(dp) && dm - 2 * d0 + dp < 0) o = Math.max(-0.5, Math.min(0.5, (0.5 * (dm - dp)) / (dm - 2 * d0 + dp)));
  const xGrad = 0.5 * (prof[kMax - 1].x + prof[kMax].x) + o * h;
  let S = 0;
  let last = 0;
  for (let i = 0; i < prof.length; i++) {
    S += Math.min(Math.max(prof[i].phi, 0), 1);
    last = i;
    if (prof[i].phi >= 1) break;
  }
  return { xNose, iNose, foot: cross(0.1), mid: cross(0.5), tail: cross(0.9), maxGradient: xNose - xGrad, equalArea: xNose - (prof[last].x + 0.5 * h - h * S) };
}

/** max over all fluid cells of |ρ(i,j,k) − ρ(i,k,j)| / ρ∞, as sphere3d.ts runSphereCase reports it */
export function symmetryError(s: EulerSolver3D, nx: number, nyz: number, fsRho: number) {
  let e = 0;
  for (let k = 0; k < nyz; k++)
    for (let j = 0; j < nyz; j++)
      for (let i = 0; i < nx; i++) {
        if (s.isSolid(i, j, k)) continue;
        e = Math.max(e, Math.abs(s.cell(i, j, k).rho - s.cell(i, k, j).rho) / fsRho);
      }
  return e;
}

// ─────────────────────────────── plane extraction and quantization ───────────────────────────────

export interface Plane {
  nx: number;
  ny: number;
  fields: Record<(typeof F64_FIELDS)[number]['name'], Float64Array>;
}

/** the cell layer k = 0 (centres at z = h/2, next to the z = 0 symmetry plane), nondimensional; solid cells hold 0 */
export function extractPlane(s: EulerSolver3D, nx: number, nyz: number, fs: { rho: number; p: number; V: number }, layer: 'k0' | 'j0' = 'k0'): Plane {
  const n = nx * nyz;
  const f = Object.fromEntries(F64_FIELDS.map((d) => [d.name, new Float64Array(n)])) as Plane['fields'];
  for (let j = 0; j < nyz; j++)
    for (let i = 0; i < nx; i++) {
      const [ci, cj, ck] = layer === 'k0' ? [i, j, 0] : [i, 0, j];
      const q = j * nx + i;
      const a = s.fluidFraction(ci, cj, ck);
      f.alpha[q] = a;
      if (a <= 0) continue;
      const c = s.cell(ci, cj, ck);
      // in the j0 layer the in-plane lateral velocity is w (mirror of v in the k0 layer)
      f.rho[q] = c.rho / fs.rho;
      f.u[q] = c.u / fs.V;
      f.v[q] = (layer === 'k0' ? c.v : c.w) / fs.V;
      f.w[q] = (layer === 'k0' ? c.w : c.v) / fs.V;
      f.p[q] = c.p / fs.p;
    }
  return { nx, ny: nyz, fields: f };
}

export function machOf(rho: number, u: number, v: number, w: number, p: number, fsRho: number, fsP: number, fsV: number, gamma = 1.4) {
  const a = Math.sqrt((gamma * p * fsP) / (rho * fsRho));
  return (Math.hypot(u, v, w) * fsV) / a;
}

export function planeToF64Bytes(pl: Plane): Uint8Array {
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw new Error('little-endian platform required');
  const n = pl.nx * pl.ny;
  const out = new Float64Array(F64_FIELDS.length * n);
  F64_FIELDS.forEach((d, k) => out.set(pl.fields[d.name], k * n));
  return new Uint8Array(out.buffer);
}

export function f64BytesToPlane(b: Uint8Array, nx: number, ny: number): Plane {
  const n = nx * ny;
  if (b.length !== F64_FIELDS.length * n * 8) throw new Error(`plane file has ${b.length} bytes, expected ${F64_FIELDS.length * n * 8}`);
  const all = new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  const fields = Object.fromEntries(F64_FIELDS.map((d, k) => [d.name, all.subarray(k * n, (k + 1) * n)])) as Plane['fields'];
  return { nx, ny, fields };
}

/** 8-bit browser plane derived from a full-precision plane; returns the bytes, the per-field ranges and the measured errors */
export function quantizeU8(pl: Plane, fs: { rho: number; p: number; V: number }) {
  const n = pl.nx * pl.ny;
  const F = pl.fields;
  const fluid = (q: number) => F.alpha[q] > 0;
  const mach = new Float64Array(n);
  for (let q = 0; q < n; q++) if (fluid(q)) mach[q] = machOf(F.rho[q], F.u[q], F.v[q], F.w[q], F.p[q], fs.rho, fs.p, fs.V);
  const src: Record<string, Float64Array> = { rho: F.rho, p: F.p, mach, u: F.u, v: F.v };
  const out = new Uint8Array(U8_FIELDS.length * n);
  const fields: Record<string, { lo: number; hi: number; step: number; maxAbsError: number; bound: number }> = {};
  U8_FIELDS.forEach((d, k) => {
    if (d.name === 'alpha') {
      let maxErr = 0;
      for (let q = 0; q < n; q++) {
        const a = F.alpha[q];
        const code = a > 0 ? Math.max(1, Math.round(255 * a)) : 0;
        out[k * n + q] = code;
        if (a > 0) maxErr = Math.max(maxErr, Math.abs(code / 255 - a));
      }
      fields.alpha = { lo: 0, hi: 1, step: 1 / 255, maxAbsError: maxErr, bound: 1 / 255 };
      return;
    }
    const a = src[d.name];
    let lo = Infinity;
    let hi = -Infinity;
    for (let q = 0; q < n; q++) if (fluid(q)) { lo = Math.min(lo, a[q]); hi = Math.max(hi, a[q]); }
    const step = (hi - lo) / 255;
    let maxErr = 0;
    for (let q = 0; q < n; q++) {
      if (!fluid(q)) continue;
      const code = Math.round((a[q] - lo) / step);
      out[k * n + q] = code;
      maxErr = Math.max(maxErr, Math.abs(lo + code * step - a[q]));
    }
    fields[d.name] = { lo, hi, step, maxAbsError: maxErr, bound: step / 2 };
  });
  return { bytes: out, fields };
}

export function dequantU8(b: Uint8Array, nx: number, ny: number, ranges: Record<string, { lo: number; step: number }>) {
  const n = nx * ny;
  return Object.fromEntries(U8_FIELDS.map((d, k) => [d.name, Float64Array.from(b.subarray(k * n, (k + 1) * n), (c) => (d.name === 'alpha' ? c / 255 : ranges[d.name].lo + c * ranges[d.name].step))]));
}

// ─────────────────────────────── archived research data ───────────────────────────────

/** stagnation-line profile CSV of the refinement archives: rows of (d = distance from the sphere surface in R, ρ/ρ∞) */
export function readProfileCsv(f: string) {
  if (!existsSync(f)) throw new Error(`missing archive file: ${rel(f)}`);
  const lines = readFileSync(f, 'utf8').split('\n');
  const header = lines.find((l) => l && !l.startsWith('#'))!.split(',');
  const id = header.indexOf('d');
  const ir = header.indexOf('rho_over_rhoInf');
  if (id < 0 || ir < 0) throw new Error(`${rel(f)}: no d / rho_over_rhoInf columns`);
  const rows = lines.filter((l) => l && !l.startsWith('#') && !l.startsWith(header[0] + ',') && l !== header.join(',')).map((l) => l.split(','));
  return { d: rows.map((r) => Number(r[id])), rho: rows.map((r) => Number(r[ir])), dText: rows.map((r) => r[id]), rhoText: rows.map((r) => r[ir]) };
}

export function celik(h: number[], f: number[]) {
  const [h1, h2, h3] = h;
  const [f1, f2, f3] = f;
  const r21 = h2 / h1;
  const r32 = h3 / h2;
  const e21 = f2 - f1;
  const e32 = f3 - f2;
  if (e21 * e32 <= 0) return { note: 'oscillatory' as const };
  let p = Math.log(Math.abs(e32 / e21)) / Math.log(r21);
  for (let it = 0; it < 500; it++) {
    const pn = Math.abs(Math.log(Math.abs(e32 / e21)) + Math.log((r21 ** p - 1) / (r32 ** p - 1))) / Math.log(r21);
    if (!Number.isFinite(pn)) return { note: 'no solution for p' as const };
    if (Math.abs(pn - p) < 1e-12) {
      p = pn;
      break;
    }
    p = pn;
  }
  return { p, fext: (r21 ** p * f1 - f2) / (r21 ** p - 1), gci: (1.25 * Math.abs(e21)) / (r21 ** p - 1) };
}

/** git provenance of the files that define the export (content hashes, so a later commit does not change them) */
export function provenance(files: string[]) {
  const git = (...a: string[]) => execFileSync('git', a, { cwd: PROJECT, encoding: 'utf8' }).trim();
  let head = 'unknown';
  try {
    head = git('rev-parse', 'HEAD');
  } catch {
    /* not a git checkout */
  }
  return {
    repositoryHead: head,
    files: files.map((f) => {
      const blob = git('hash-object', f);
      let atHead: string | null = null;
      try {
        atHead = git('rev-parse', `HEAD:${path.relative(path.join(PROJECT, '..'), f).split(path.sep).join('/')}`);
      } catch {
        atHead = null;
      }
      return { path: rel(f), gitBlob: blob, sameAsHead: atHead === blob };
    }),
    solverStateRevision: SOLVER3D_STATE_REVISION,
  };
}

export { billigSphere, type Checkpoint3D };

// ─────────────────────────────── export ───────────────────────────────

const REF_SUMMARY = path.join(DOCS, 'sphere3d-refinement', 'summary.jsonl');
const isRef = (r: any) => r.options.flux === 'rusanov' && r.options.wall === 'cutcell' && r.options.downstream === 0.5 && r.options.lateral === 2 && !r.options.residualDrop;
const csv3d = (dir: string, N: number, off: number) => path.join(DOCS, dir, `s3d_rusanov_cutcell_Rh${N}_off${off}_downstream0.5_lateral2.csv`);

/** the default plane sources: every converged reference-configuration checkpoint that exists (R/h 48 offset 0 has none) */
export function defaultSources(checkpointDir: string): PlaneSource[] {
  return [
    { id: 'rh48-off0.5', radiusCells: 48, gridOffset: 0.5, checkpoint: path.join(checkpointDir, 'rh48-offsets/off0.5/rh48.ckpt'), archivedSummary: path.join(DOCS, 'sphere3d-rh48-offsets/off0.5/summary.jsonl'), browser: true },
    { id: 'rh48-off0.25', radiusCells: 48, gridOffset: 0.25, checkpoint: path.join(checkpointDir, 'rh48-offsets/off0.25/rh48.ckpt'), archivedSummary: path.join(DOCS, 'sphere3d-rh48-offsets/off0.25/summary.jsonl'), browser: false },
    { id: 'rh48-off0.75', radiusCells: 48, gridOffset: 0.75, checkpoint: path.join(checkpointDir, 'rh48-offsets/off0.75/rh48.ckpt'), archivedSummary: path.join(DOCS, 'sphere3d-rh48-offsets/off0.75/summary.jsonl'), browser: false },
    { id: 'rh64-off0', radiusCells: 64, gridOffset: 0, checkpoint: path.join(checkpointDir, 'rh64-run/rh64.ckpt'), archivedSummary: path.join(DOCS, 'sphere3d-rh64/summary.jsonl'), browser: true },
  ];
}

export interface ExportResult {
  files: Record<string, Uint8Array>;
  log: string[];
}

/** build every dataset file in memory (the caller writes them); throws on any missing or inconsistent input */
export function buildDataset(sources: PlaneSource[]): ExportResult {
  const files: Record<string, Uint8Array> = {};
  const log: string[] = [];
  const enc = (s: string) => new TextEncoder().encode(s);
  const fsRef = freestream(2, 220, 2500, 0);
  const planes: any[] = [];

  for (const src of sources) {
    requireFile(src.checkpoint, `checkpoint for ${src.id}`);
    const archived = jsonl(src.archivedSummary).at(-1);
    if (archived.options.radiusCells !== src.radiusCells || (archived.options.gridOffset ?? 0) !== src.gridOffset) throw new Error(`${rel(src.archivedSummary)} does not describe ${src.id}`);
    const run = loadCheckpoint(src.checkpoint, src.radiusCells, src.gridOffset);
    const fromStep = run.cp.solver.steps;
    const adv = advanceToConvergence(run);
    const det = detectors(run.s, run.h, run.nx, run.fs.rho);
    const sym = symmetryError(run.s, run.nx, run.nyz, run.fs.rho);
    // the advanced state must be the archived converged state: same step, residual drop, mass imbalance, symmetry
    // error and detectors, bit for bit
    const checks: [string, number, number][] = [
      ['steps', adv.steps, archived.steps],
      ['dropFront', adv.dropFront, archived.dropFront],
      ['massImbalance', adv.imbalance, archived.massImbalance],
      ['symmetryError', sym, archived.symmetryError],
      ['xNose', det.xNose, archived.xNose],
      ...(['foot', 'mid', 'tail', 'maxGradient', 'equalArea'] as const).map((k) => [`standoff.${k}`, det[k], archived.standoff[k]] as [string, number, number]),
    ];
    const bad = checks.filter(([, a, b]) => !Object.is(a, b));
    if (bad.length) throw new Error(`${src.id}: advanced state differs from the archived converged run: ${bad.map(([k, a, b]) => `${k} ${a} vs ${b}`).join('; ')}`);
    log.push(`${src.id}: checkpoint step ${fromStep} → converged at step ${adv.steps}; ${checks.length} archived values reproduced exactly`);

    const plane = extractPlane(run.s, run.nx, run.nyz, run.fs);
    const mirror = extractPlane(run.s, run.nx, run.nyz, run.fs, 'j0');
    const symPlane: Record<string, number> = {};
    for (const d of F64_FIELDS) {
      let e = 0;
      for (let q = 0; q < plane.nx * plane.ny; q++) e = Math.max(e, Math.abs(plane.fields[d.name][q] - mirror.fields[d.name][q]));
      symPlane[d.name] = e;
    }
    const f64 = planeToF64Bytes(plane);
    const f64Name = `plane-${src.id}.f64.bin`;
    files[f64Name] = f64;
    let u8Info: any = null;
    if (src.browser) {
      const q = quantizeU8(plane, run.fs);
      const u8Name = `plane-${src.id}.u8.bin`;
      files[u8Name] = q.bytes;
      u8Info = { file: u8Name, layout: 'six Uint8 arrays in the order of fields, each nx·ny values, index j·nx + i', fields: U8_FIELDS.map((d) => ({ ...d, ...q.fields[d.name] })) };
    }
    let solid = 0;
    let cut = 0;
    for (let k = 0; k < plane.nx * plane.ny; k++) {
      if (plane.fields.alpha[k] <= 0) solid++;
      else if (plane.fields.alpha[k] < 1) cut++;
    }
    planes.push({
      id: src.id,
      source: {
        checkpoint: src.checkpoint,
        checkpointBytes: run.bytes,
        checkpointSha256: run.sha256,
        checkpointStep: fromStep,
        solverStateRevision: run.cp.solver.revision,
        geometryCrc32: run.cp.geometry.crc,
        archivedSummary: rel(src.archivedSummary),
        archivedSummarySha256: fileSha256(src.archivedSummary),
      },
      configuration: run.cfg,
      convergence: {
        rule: `residual in x < 0 down ${run.cfg.residualDrop} orders from its largest value in the first 5 steps, and |net mass flux| < ${run.cfg.massBalanceTol} of the intercepted flux ρ∞V∞πR²/4 (sphere3d.ts runSphereCase)`,
        advancedFromStep: fromStep,
        convergedAtStep: adv.steps,
        dropFront: adv.dropFront,
        massImbalance: adv.imbalance,
        reproducesArchivedRun: checks.map(([k]) => k),
      },
      grid: { nx: plane.nx, ny: plane.ny, h: run.h, x0: run.x0, cellCentres: 'x_i = x0 + (i + ½) h, y_j = (j + ½) h, z = ½ h', sphere: 'centre (0, 0, 0), radius R = 1; flow in +x; quarter domain y ≥ 0, z ≥ 0 with symmetry (slip) planes y = 0 and z = 0', cells: { total: plane.nx * plane.ny, solid, cut, full: plane.nx * plane.ny - solid - cut } },
      extraction: { plane: 'cell layer k = 0 (centres at z = h/2), the layer next to the z = 0 symmetry plane', mirrorCheck: 'max |field(i, j, k = 0) − field(i, k = 0, j)| against the j = 0 layer (v and w swapped); a subset of the archived symmetry error', mirrorMaxAbsDifference: symPlane, archivedSymmetryError: archived.symmetryError },
      detectors: { xNose: det.xNose, foot: det.foot, mid: det.mid, tail: det.tail, maxGradient: det.maxGradient, equalArea: det.equalArea },
      f64: { file: f64Name, layout: 'six Float64 arrays (little-endian) in the order of fields, each nx·ny values, index j·nx + i; solid cells (alpha = 0) hold 0', fields: F64_FIELDS },
      u8: u8Info,
    });
  }

  // stagnation-line profiles from the archives (rows with d ≤ PROFILE_D_MAX)
  const profileSpecs: { id: string; solver: string; radiusCells: number; gridOffset?: number; aspect?: number; file: string }[] = [
    ...[16, 24, 32, 48].map((N) => ({ id: `3d-rh${N}-off0`, solver: '3D Cartesian cut-cell (sphere3d.ts)', radiusCells: N, gridOffset: 0, file: csv3d('sphere3d-refinement', N, 0) })),
    ...[0.25, 0.5, 0.75].map((o) => ({ id: `3d-rh48-off${o}`, solver: '3D Cartesian cut-cell (sphere3d.ts)', radiusCells: 48, gridOffset: o, file: path.join(DOCS, 'sphere3d-rh48-offsets', `off${o}`, `s3d_rusanov_cutcell_Rh48_off${o}_downstream0.5_lateral2.csv`) })),
    { id: '3d-rh64-off0', solver: '3D Cartesian cut-cell (sphere3d.ts)', radiusCells: 64, gridOffset: 0, file: csv3d('sphere3d-rh64', 64, 0) },
    ...[16, 24, 32, 48, 64, 128].map((N) => ({ id: `axi-rh${N}-aspect1`, solver: 'axisymmetric body-fitted (sphereAxi.ts)', radiusCells: N, aspect: 1, file: path.join(DOCS, 'sphere-gap-study', 'axi-aspect', `axi_rusanov_Rh${N}_aspect1.csv`) })),
    { id: 'axi-rh256-aspect1', solver: 'axisymmetric body-fitted (sphereAxi.ts)', radiusCells: 256, aspect: 1, file: path.join(DOCS, 'axi-reference-refinement', 'runs', 'axi_rusanov_Rh256_aspect1.csv') },
  ];
  const profiles = profileSpecs.map((p) => {
    const c = readProfileCsv(p.file);
    const keep = c.d.map((d, k) => [d, k] as const).filter(([d]) => d <= PROFILE_D_MAX).map(([, k]) => k);
    if (!keep.length) throw new Error(`${rel(p.file)}: no rows within ${PROFILE_D_MAX} R of the wall`);
    return { id: p.id, solver: p.solver, radiusCells: p.radiusCells, ...(p.gridOffset !== undefined ? { gridOffset: p.gridOffset } : {}), ...(p.aspect !== undefined ? { aspect: p.aspect } : {}), source: rel(p.file), sourceSha256: fileSha256(p.file), rowsInSource: c.d.length, d: keep.map((k) => c.d[k]), rho: keep.map((k) => c.rho[k]) };
  });
  files['profiles.json'] = enc(stableJson({ schema: DATASET_SCHEMA, version: DATASET_VERSION, description: `Stagnation-line density profiles copied from the archived refinement runs (rows with d ≤ ${PROFILE_D_MAX} R; the archive keeps 6 decimals). d = distance of the cell centre from the sphere surface along the line, in sphere radii; rho = ρ/ρ∞.`, dMax: PROFILE_D_MAX, profiles }));

  // results: refinement, grid position, extrapolation, axisymmetric reference, correlation
  const ref = new Map<string, any>();
  for (const r of jsonl(REF_SUMMARY)) if (isRef(r)) ref.set(r.name, { ...r, source: rel(REF_SUMMARY) });
  for (const f of [path.join(DOCS, 'sphere3d-rh64', 'summary.jsonl'), ...[0.25, 0.5, 0.75].map((o) => path.join(DOCS, 'sphere3d-rh48-offsets', `off${o}`, 'summary.jsonl'))]) {
    const r = jsonl(f).at(-1);
    ref.set(r.name, { ...r, source: rel(f) });
  }
  const rows = [...ref.values()].sort((a, b) => a.options.radiusCells - b.options.radiusCells || (a.options.gridOffset ?? 0) - (b.options.gridOffset ?? 0));
  const refinement3d = rows.map((r) => ({ radiusCells: r.options.radiusCells, gridOffset: r.options.gridOffset ?? 0, cells: r.grid.cells, steps: r.steps, converged: r.converged, dropFront: r.dropFront, massImbalance: r.massImbalance, standoff: { foot: r.standoff.foot, mid: r.standoff.mid, tail: r.standoff.tail, maxGradient: r.standoff.maxGradient, equalArea: r.standoff.equalArea }, shockWidthCells: r.shockWidthCells, symmetryError: r.symmetryError, source: r.source }));
  const Ns = [...new Set(refinement3d.map((r) => r.radiusCells))];
  const DET = ['mid', 'maxGradient', 'equalArea'] as const;
  const positionStatistics = Ns.filter((N) => refinement3d.filter((r) => r.radiusCells === N).length >= 4).map((N) => {
    const g = refinement3d.filter((r) => r.radiusCells === N);
    return {
      radiusCells: N,
      offsets: g.map((r) => r.gridOffset),
      ...Object.fromEntries(DET.map((k) => {
        const v = g.map((r) => r.standoff[k]);
        const mean = v.reduce((a, b) => a + b, 0) / v.length;
        const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1));
        return [k, { mean, range: Math.max(...v) - Math.min(...v), sd, offset0MinusMean: g.find((r) => r.gridOffset === 0)!.standoff[k] - mean }];
      })),
    };
  });
  const value = (N: number, mode: 'offset0' | 'mean') => {
    const st = positionStatistics.find((s) => s.radiusCells === N);
    return mode === 'mean' && st ? (st as any).equalArea.mean : refinement3d.find((r) => r.radiusCells === N && r.gridOffset === 0)!.standoff.equalArea;
  };
  const extrapolation = [[24, 32, 48], [24, 48, 64], [32, 48, 64], [24, 32, 64]].map((t) => ({
    triplet: t,
    offset0: celik([1 / t[2], 1 / t[1], 1 / t[0]], [value(t[2], 'offset0'), value(t[1], 'offset0'), value(t[0], 'offset0')]),
    positionAveraged: celik([1 / t[2], 1 / t[1], 1 / t[0]], [value(t[2], 'mean'), value(t[1], 'mean'), value(t[0], 'mean')]),
  }));
  const axiFiles = [path.join(DOCS, 'sphere-gap-study', 'axi-aspect', 'summary.jsonl'), path.join(DOCS, 'axi-reference-refinement', 'runs', 'summary.jsonl')];
  const axisymmetric = axiFiles.flatMap((f) => jsonl(f).filter((r) => [1, 2].includes(r.options.aspect) && !r.options.residualDrop && (r.options.flux ?? 'rusanov') === 'rusanov').map((r) => ({ radiusCells: r.options.radiusCells, aspect: r.options.aspect, steps: r.steps, converged: r.converged, standoff: { mid: r.standoff.mid, maxGradient: r.standoff.maxGradient, equalArea: r.standoff.equalArea }, source: rel(f) }))).sort((a, b) => a.aspect - b.aspect || a.radiusCells - b.radiusCells);
  const results = {
    schema: DATASET_SCHEMA,
    version: DATASET_VERSION,
    model: 'Steady inviscid compressible flow (Euler equations), calorically perfect air, around a sphere at Mach 2. A verified numerical solution of this model, not a validated prediction of real flow.',
    freestream: { mach: 2, T: 220, p: 2500, gamma: 1.4, gasConstant: 287.05, rho: fsRef.rho, V: fsRef.V, units: 'SI (K, Pa, kg/m³, m/s)' },
    standoffDefinitions: { mid: '50 % crossing of the normalized density jump φ = (ρ − ρ∞)/(ρ₂ − ρ∞) on the stagnation line', maxGradient: 'steepest density rise between full cells, parabolic sub-cell fit', equalArea: 'position of a step holding the same integrated jump (φ capped at 1)', foot: '10 % crossing', tail: '90 % crossing', unit: 'sphere radii (distance from the sphere surface)' },
    refinement3d: { kind: 'computed (archived runs)', configuration: 'reduced quarter domain 2R / 0.5R / 2R, Rusanov, MUSCL-minmod, SSP-RK2, CFL 0.8, cut cells with merging, 4-order stopping rule', rows: refinement3d },
    positionStatistics: { kind: 'computed from the archived runs (grid offsets 0, 0.25, 0.5, 0.75 in cells along x)', rows: positionStatistics },
    extrapolation: { kind: 'formal estimate (Celik/Roache, Fs = 1.25) of the equal-area standoff; the GCI excludes the grid-position term, and R/h 64 has one grid position', rows: extrapolation },
    iterationError: { kind: 'quoted estimate', value: 'R/h 64: +5.4e-5 (50 %), +5.6e-5 (steepest rise), +5.5e-5 (equal area) from the archived final state to full convergence', source: 'docs/sphere3d-uncertainty-audit/README.md §3' },
    axisymmetric: { kind: 'computed (archived runs of the independent axisymmetric solver, 4-order stopping rule)', rows: axisymmetric },
    axisymmetricReferenceBand: { lo: 0.3485, hi: 0.3508, kind: 'quoted engineering judgement over the listed estimation methods, not a statistical interval', source: 'docs/axi-reference-refinement/README.md §3.6' },
    billigCorrelation: {
      kind: 'empirical correlation — a comparison reference, not experimental validation of this model',
      formula: 'Δ/R = 0.143 exp(3.24 / M²)',
      value: billigSphere(2),
      attribution: 'an empirical fit to experimental shock-detachment distances, attributed to Ambrosio & Wortman, quoted by Billig, J. Spacecraft Rockets 4(6), 1967; its original definition of the standoff, data set, Mach range and uncertainty have not been verified',
      observation: 'the axisymmetric reference band lies about 8–9 % above it; the cause is not established',
      source: 'docs/axisymmetric-reference.md §8; src/lab/core/sphere3d.ts billigSphere',
    },
  };
  files['results.json'] = enc(stableJson(results));

  const fileEntries = Object.keys(files).sort().map((name) => ({ name, bytes: files[name].length, gzipBytes: gzipBytes(files[name]), sha256: sha256(files[name]) }));
  const manifest = {
    schema: DATASET_SCHEMA,
    version: DATASET_VERSION,
    description: 'Precomputed 3D Mach 2 sphere results for the browser (milestone M0): planes next to the symmetry plane from converged checkpoints, archived stagnation-line profiles, refinement and uncertainty results, the axisymmetric reference band and the Billig correlation. Every value is computed by the archived solver runs, copied from their archives, or quoted with its source.',
    generator: { script: 'scripts/export-sphere3d-dataset.test.ts', library: 'scripts/sphere3d-dataset.ts', provenance: provenance([path.join(PROJECT, 'scripts/sphere3d-dataset.ts'), path.join(PROJECT, 'scripts/export-sphere3d-dataset.test.ts'), path.join(PROJECT, 'src/lab/core/euler3d.ts'), path.join(PROJECT, 'src/lab/core/sphere3d.ts'), path.join(PROJECT, 'src/lab/core/checkpoint3d.ts'), path.join(PROJECT, 'src/lab/core/gas.ts')]) },
    units: 'lengths in sphere radii (the solver uses R = 1); fields nondimensional by the freestream values in results.json',
    browserFacing: ['results.json', 'profiles.json', 'plane-rh48-off0.5.u8.bin', 'plane-rh64-off0.u8.bin'],
    sourcePrecision: Object.keys(files).filter((f) => f.endsWith('.f64.bin')).sort(),
    notExported: [{ what: 'symmetry-plane fields of R/h 48 at grid offset 0', why: 'no checkpoint exists (the archived run predates checkpoint support); its stagnation-line profile and results are included' }],
    planes,
    files: fileEntries,
  };
  files['manifest.json'] = enc(stableJson(manifest, 1));
  return { files, log };
}
