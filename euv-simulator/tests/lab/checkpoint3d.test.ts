import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from '../../src/lab/core/crc32';
import { Checkpoint3DError, decodeCheckpoint3D, encodeCheckpoint3D } from '../../src/lab/core/checkpoint3d';
import { EulerSolver3D, makeBoxGrid, SOLVER3D_STATE_REVISION } from '../../src/lab/core/euler3d';
import { runSphereCase, type SphereCaseOptions, type SphereCaseResult } from '../../src/lab/core/sphere3d';
import { readCheckpointFile, writeCheckpointAtomic } from '../../scripts/checkpoint3d-file';

// Checkpoint/restart of the 3D sphere case (docs/checkpoint-restart/DESIGN.md). A small cut-cell case (R/h 6,
// reduced domain: 2 160 cells, converges in 460 steps) is interrupted at chosen steps and resumed; the resumed run
// must reproduce the uninterrupted run exactly (bit for bit), and every invalid or incompatible checkpoint must be
// refused with an error instead of starting afresh.

const base: SphereCaseOptions = { mach: 2, radiusCells: 6, wall: 'cutcell', upstream: 2, downstream: 0.5, lateral: 2, maxSteps: 3000 };
const CK_KEYS = new Set(['ms', 'resumedFromStep', 'interrupted', 'checkpointsWritten', 'lineage']);

/** paths of every value that differs (numbers compared with Object.is, i.e. bit for bit apart from NaN payloads) */
function differences(a: unknown, b: unknown, path = ''): string[] {
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b) ? [] : [`${path}: ${a} vs ${b}`];
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b ? [] : [`${path}: ${String(a)} vs ${String(b)}`];
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)].filter((k) => !(path === '' && CK_KEYS.has(k))));
  return [...keys].flatMap((k) => differences((a as any)[k], (b as any)[k], `${path}.${k}`));
}

/** run up to `stopAtStep` and return the checkpoint written there */
function checkpointAt(stopAtStep: number, opts: SphereCaseOptions = base, resume?: Uint8Array) {
  let bytes: Uint8Array | undefined;
  const r = runSphereCase({ ...opts, checkpoint: { stopAtStep, resume, write: (b) => (bytes = b) } });
  expect(r.interrupted).toBe(true);
  expect(r.steps).toBe(stopAtStep);
  return { bytes: bytes!, result: r };
}

/** rebuild a checkpoint with a modified header (and a valid CRC), to test semantic validation behind the CRC */
function withHeader(bytes: Uint8Array, mutate: (h: any) => void) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const H = dv.getUint32(12, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(16, 16 + H)));
  mutate(header);
  const h = new TextEncoder().encode(JSON.stringify(header));
  const payload = bytes.subarray(16 + H, bytes.length - 12);
  const out = new Uint8Array(16 + h.length + payload.length + 12);
  const ov = new DataView(out.buffer);
  out.set(bytes.subarray(0, 12), 0);
  ov.setUint32(12, h.length, true);
  out.set(h, 16);
  out.set(payload, 16 + h.length);
  const off = 16 + h.length + payload.length;
  ov.setUint32(off, crc32(out.subarray(0, off)), true);
  out.set(bytes.subarray(bytes.length - 8), off + 4);
  return out;
}

let plain: SphereCaseResult;
let cp100: Uint8Array;
beforeAll(() => {
  plain = runSphereCase(base);
  cp100 = checkpointAt(100).bytes;
});

describe('checkpoint/restart of the 3D sphere case: reproducibility', () => {
  it('the reference run converges (so the resumed runs below cover start-up, order switch and convergence)', () => {
    expect(plain.converged).toBe(true);
    expect(plain.steps).toBeGreaterThan(200);
    expect('resumedFromStep' in plain).toBe(false); // no checkpoint option: no checkpoint fields at all
  });

  it('enabling checkpoints leaves the run unchanged', () => {
    let writes = 0;
    const r = runSphereCase({ ...base, checkpoint: { every: 50, write: () => writes++ } });
    expect(differences(r, plain)).toEqual([]);
    expect(writes).toBe(Math.floor((plain.steps - 1) / 50)); // no checkpoint after the converged step
    expect(r.resumedFromStep).toBeNull();
    expect(r.lineage).toEqual([{ fromStep: 0, toStep: plain.steps }]);
  });

  it.each([3, 100, 150, 151, 300])('interrupted after step %i and resumed: identical to the uninterrupted run', (k) => {
    const { bytes } = checkpointAt(k);
    const r = runSphereCase({ ...base, checkpoint: { resume: bytes } });
    expect(differences(r, plain)).toEqual([]);
    expect(r.resumedFromStep).toBe(k);
    expect(r.lineage).toEqual([
      { fromStep: 0, toStep: k },
      { fromStep: k, toStep: plain.steps },
    ]);
  });

  it('three segments (60, 200, to convergence): identical, lineage records every segment', () => {
    const a = checkpointAt(60).bytes;
    const b = checkpointAt(200, base, a).bytes;
    const r = runSphereCase({ ...base, checkpoint: { resume: b } });
    expect(differences(r, plain)).toEqual([]);
    expect(r.lineage).toEqual([
      { fromStep: 0, toStep: 60 },
      { fromStep: 60, toStep: 200 },
      { fromStep: 200, toStep: plain.steps },
    ]);
  });

  it('a stopWhen condition (e.g. a wall-clock budget) splits the run without changing it', () => {
    let bytes: Uint8Array | undefined;
    const first = runSphereCase({ ...base, checkpoint: { stopWhen: (n) => n === 77, write: (b) => (bytes = b) } });
    expect(first.interrupted).toBe(true);
    expect(first.steps).toBe(77);
    expect(differences(runSphereCase({ ...base, checkpoint: { resume: bytes } }), plain)).toEqual([]);
  });

  it('conservative state, residual history, counters and shock measurement at a fixed step agree exactly', () => {
    const direct = checkpointAt(250);
    const resumed = checkpointAt(250, base, checkpointAt(120).bytes);
    const A = decodeCheckpoint3D(direct.bytes);
    const B = decodeCheckpoint3D(resumed.bytes);
    for (let v = 0; v < 5; v++) expect(Buffer.from(B.solver.U[v].buffer).equals(Buffer.from(A.solver.U[v].buffer))).toBe(true);
    expect(Buffer.from(B.driver.history.buffer).equals(Buffer.from(A.driver.history.buffer))).toBe(true);
    const { elapsedMs: _a, history: _ha, ...dA } = A.driver;
    const { elapsedMs: _b, history: _hb, ...dB } = B.driver;
    expect(dB).toEqual(dA);
    const { U: _ua, ...sA } = A.solver;
    const { U: _ub, ...sB } = B.solver;
    expect(sB).toEqual(sA);
    expect(differences(resumed.result, direct.result)).toEqual([]); // standoffs, profile, wall data, residual drops
  });

  it.each([
    ['HLLC flux', { flux: 'hllc' as const }],
    ['ghost-cell wall', { wall: 'ghost' as const }],
  ])('%s: resumed after the order switch, identical (incl. HLLC counters)', (_n, extra) => {
    const opts = { ...base, ...extra };
    const ref = runSphereCase(opts);
    const r = runSphereCase({ ...opts, checkpoint: { resume: checkpointAt(170, opts).bytes } });
    expect(differences(r, ref)).toEqual([]);
  });

  it('solver level: exportState/importState continue a global-time-step run exactly', () => {
    const make = () => {
      const s = new EulerSolver3D(makeBoxGrid(0, 1, 0, 1, 0, 1, 10, 8, 6), { cfl: 0.5, order: 2, bc: { xmin: 'wall', xmax: 'wall', ymin: 'periodic', ymax: 'periodic', zmin: 'wall', zmax: 'wall' } });
      s.init((x, y, z) => ({ rho: 1 + 0.2 * Math.exp(-40 * ((x - 0.5) ** 2 + (y - 0.4) ** 2 + (z - 0.5) ** 2)), u: 30, v: -20, w: 10, p: 1e5 }));
      return s;
    };
    const a = make();
    for (let n = 0; n < 40; n++) a.step();
    const b = make();
    for (let n = 0; n < 15; n++) b.step();
    const c = make();
    c.importState(b.exportState());
    for (let n = 15; n < 40; n++) c.step();
    expect(c.time).toBe(a.time);
    expect(c.steps).toBe(40);
    for (let v = 0; v < 5; v++) expect(Buffer.from(c.exportState().U[v].buffer).equals(Buffer.from(a.exportState().U[v].buffer))).toBe(true);
  });
});

describe('checkpoint/restart: invalid checkpoints are refused (never a silent fresh start)', () => {
  const refuse = (bytes: Uint8Array, re: RegExp) => {
    expect(() => decodeCheckpoint3D(bytes)).toThrow(re);
    expect(() => runSphereCase({ ...base, checkpoint: { resume: bytes } })).toThrow(re);
  };
  it('corrupted payload or header bytes: CRC mismatch', () => {
    const p = cp100.slice();
    p[p.length - 100] ^= 0x01;
    refuse(p, /CRC mismatch/);
    const h = cp100.slice();
    h[40] ^= 0x01;
    refuse(h, /CRC mismatch/);
  });
  it('truncated, extended, empty and foreign files', () => {
    refuse(cp100.slice(0, cp100.length - 1), /truncated, extended or corrupted/);
    refuse(cp100.slice(0, cp100.length >> 1), /truncated, extended or corrupted/);
    refuse(cp100.slice(0, 20), /truncated/);
    refuse(new Uint8Array(0), /truncated/);
    const ext = new Uint8Array(cp100.length + 1);
    ext.set(cp100);
    refuse(ext, /truncated, extended or corrupted/);
    // a truncated file that happens to end in a copy of the trailer still fails its CRC
    const fake = new Uint8Array(cp100.length - 800);
    fake.set(cp100.subarray(0, fake.length - 12));
    fake.set(cp100.subarray(cp100.length - 12), fake.length - 12);
    refuse(fake, /CRC mismatch/);
    const magic = cp100.slice();
    magic[0] = 0x58;
    refuse(magic, /bad magic/);
  });
  it('format version, schema, solver revision and missing fields', () => {
    const v2 = cp100.slice();
    new DataView(v2.buffer).setUint32(8, 2, true);
    refuse(v2, /unsupported checkpoint format version 2/);
    refuse(withHeader(cp100, (h) => (h.schema = 'something-else')), /unknown checkpoint schema/);
    refuse(withHeader(cp100, (h) => delete h.driver.refFront), /driver state missing/);
    refuse(withHeader(cp100, (h) => (h.solver.steps = 99)), /history has 100 entries for 99 steps|lineage does not end/);
    refuse(withHeader(cp100, (h) => (h.arrays[0].length -= 1)), /truncated or extended/);
    const cp = decodeCheckpoint3D(cp100);
    cp.solver.revision = SOLVER3D_STATE_REVISION + 1;
    expect(() => runSphereCase({ ...base, checkpoint: { resume: encodeCheckpoint3D(cp) } })).toThrow(/solver revision/);
    expect(() => decodeCheckpoint3D(cp100.slice(0, 30))).toThrow(Checkpoint3DError);
  });
  it('non-finite or non-physical stored values', () => {
    const cp = decodeCheckpoint3D(cp100);
    const solver = new EulerSolver3D(makeBoxGrid(0, 1, 0, 1, 0, 1, 2, 2, 2), { cfl: 0.5, order: 1, bc: { xmin: 'wall', xmax: 'wall', ymin: 'wall', ymax: 'wall', zmin: 'wall', zmax: 'wall' } });
    expect(() => solver.importState(cp.solver)).toThrow(/entries, expected/); // wrong grid size at solver level
    const nan = decodeCheckpoint3D(cp100);
    nan.solver.U[4][nan.solver.U[4].length >> 1] = NaN;
    refuse(encodeCheckpoint3D(nan), /non-finite/);
    const neg = decodeCheckpoint3D(cp100);
    const P = (i: number, j: number, k: number) => (k + 2) * (15 + 4) * (12 + 4) + (j + 2) * (15 + 4) + (i + 2); // padded index, nx 15, ny = nz 12
    neg.solver.U[0][P(0, 5, 5)] = -1; // an inflow-side fluid cell
    expect(() => runSphereCase({ ...base, checkpoint: { resume: encodeCheckpoint3D(neg) } })).toThrow(/non-physical state at fluid cell \(0, 5, 5\)/);
  });
  it.each([
    ['grid resolution', { radiusCells: 7 }, /config\.radiusCells.*grid\.nx/],
    ['CFL', { cfl: 0.7 }, /config\.cfl/],
    ['flux', { flux: 'hllc' as const }, /config\.flux/],
    ['wall treatment', { wall: 'ghost' as const }, /config\.wall.*geometry\.crc/],
    ['grid offset', { gridOffset: 0.25 }, /config\.gridOffset.*grid\.x0/],
    ['Mach number', { mach: 2.5 }, /config\.mach.*freestream\.u/],
    ['domain', { lateral: 2.5 }, /config\.lateral.*grid\.ny/],
    ['stopping criterion', { residualDrop: 5 }, /config\.residualDrop/],
    ['start-up length', { startupSteps: 100 }, /config\.startupSteps/],
  ])('incompatible %s is refused and named', (_n, change, re) => {
    expect(() => runSphereCase({ ...base, ...change, checkpoint: { resume: cp100 } })).toThrow(re);
  });
  it('maxSteps: may be raised (same result), must exceed the checkpointed step', () => {
    const r = runSphereCase({ ...base, maxSteps: 5000, checkpoint: { resume: cp100 } });
    expect(differences(r, plain)).toEqual([]);
    expect(() => runSphereCase({ ...base, maxSteps: 100, checkpoint: { resume: cp100 } })).toThrow(/not below maxSteps/);
  });
});

describe('checkpoint files: atomic writes keep the last valid checkpoint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ckpt3d-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  it('a write that fails part-way or before the rename leaves the previous checkpoint intact', () => {
    const path = join(dir, 'run.ckpt');
    writeCheckpointAtomic(path, cp100);
    const cp200 = checkpointAt(200).bytes;
    expect(() =>
      writeCheckpointAtomic(path, cp200, {
        chunkBytes: 4096,
        afterPartialWrite: (w) => {
          if (w >= 8192) throw new Error('simulated crash during write');
        },
      }),
    ).toThrow(/simulated crash/);
    expect(existsSync(`${path}.tmp`)).toBe(true);
    expect(statSync(`${path}.tmp`).size).toBeLessThan(cp200.length);
    expect(decodeCheckpoint3D(readCheckpointFile(path)).solver.steps).toBe(100);
    expect(() => writeCheckpointAtomic(path, cp200, { beforeRename: () => { throw new Error('simulated crash before rename'); } })).toThrow(/before rename/);
    expect(decodeCheckpoint3D(readCheckpointFile(path)).solver.steps).toBe(100);
    // a run resumed from the surviving file is still exact
    expect(differences(runSphereCase({ ...base, checkpoint: { resume: readCheckpointFile(path) } }), plain)).toEqual([]);
    writeCheckpointAtomic(path, cp200);
    expect(existsSync(`${path}.tmp`)).toBe(false);
    expect(Buffer.from(readFileSync(path)).equals(Buffer.from(cp200))).toBe(true);
  });
});

describe('checkpointing disabled: existing behaviour unchanged', () => {
  it('the plain R/h 8 cut-cell run reproduces the archived refinement profile exactly', () => {
    const r = runSphereCase({ mach: 2, radiusCells: 8, wall: 'cutcell', gridOffset: 0, maxSteps: 20000, downstream: 0.5, lateral: 2 });
    const csv = readFileSync(join(__dirname, '../../docs/sphere3d-refinement/s3d_rusanov_cutcell_Rh8_off0_downstream0.5_lateral2.csv'), 'utf8');
    const archived = csv.split('\n').filter((l) => l && !l.startsWith('#') && !l.startsWith('i,'));
    const rows = r.shock.profile.map((p, i) => `${i},${p.x.toFixed(6)},${(r.shock.xNose - p.x).toFixed(6)},${p.rho.toFixed(6)},${p.phi.toFixed(6)},${p.alpha.toFixed(4)}`);
    expect(r.steps).toBe(564);
    expect(rows).toEqual(archived);
  });
});
