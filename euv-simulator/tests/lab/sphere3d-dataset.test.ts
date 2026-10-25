import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalShock } from '../../src/lab/core/gas';
import {
  billigSphere,
  celik,
  DATASET_SCHEMA,
  DATASET_VERSION,
  DEFAULT_OUT,
  DOCS,
  dequantU8,
  f64BytesToPlane,
  F64_FIELDS,
  fileSha256,
  jsonl,
  machOf,
  PROFILE_D_MAX,
  PROJECT,
  readProfileCsv,
  runConfigOf,
  sha256,
  stableJson,
  U8_FIELDS,
} from '../../scripts/sphere3d-dataset';

// Checks of the 3D sphere browser dataset (docs/sphere3d-browser-dataset-v1) against the archived research data.
// No checkpoint is needed: the checkpoint-dependent checks (re-export, byte-identical output) are in
// scripts/verify-sphere3d-dataset.test.ts.
const DIR = path.resolve(process.env.DATASET_DIR ?? DEFAULT_OUT);
const read = (f: string) => readFileSync(path.join(DIR, f));
const manifest = JSON.parse(read('manifest.json').toString('utf8'));
const results = JSON.parse(read('results.json').toString('utf8'));
const profiles = JSON.parse(read('profiles.json').toString('utf8'));
const R21 = normalShock(2).r21;

/** detectors from a normalized stagnation-line row, with the definitions of sphere3d.ts (φ = (ρ/ρ∞ − 1)/(ρ₂/ρ∞ − 1)) */
function rowDetectors(x: number[], rho: number[], alpha: number[], h: number) {
  const xNose = -Math.sqrt(1 - 2 * (0.5 * h) ** 2);
  const phi = rho.map((r) => (r - 1) / (R21 - 1));
  const cross = (lv: number) => {
    for (let i = 1; i < x.length; i++) if (phi[i - 1] < lv && phi[i] >= lv) return xNose - (x[i - 1] + (h * (lv - phi[i - 1])) / (phi[i] - phi[i - 1]));
    return NaN;
  };
  let k = -1;
  const rise = (i: number) => (i >= 1 && i < x.length && alpha[i] === 1 && alpha[i - 1] === 1 ? rho[i] - rho[i - 1] : -Infinity);
  for (let i = 1; i < x.length; i++) if (rise(i) > -Infinity && (k < 0 || rise(i) > rise(k))) k = i;
  const [dm, d0, dp] = [rise(k - 1), rise(k), rise(k + 1)];
  let o = 0;
  if (Number.isFinite(dm) && Number.isFinite(dp) && dm - 2 * d0 + dp < 0) o = Math.max(-0.5, Math.min(0.5, (0.5 * (dm - dp)) / (dm - 2 * d0 + dp)));
  let S = 0;
  let last = 0;
  for (let i = 0; i < x.length; i++) {
    S += Math.min(Math.max(phi[i], 0), 1);
    last = i;
    if (phi[i] >= 1) break;
  }
  return { xNose, foot: cross(0.1), mid: cross(0.5), tail: cross(0.9), maxGradient: xNose - (0.5 * (x[k - 1] + x[k]) + o * h), equalArea: xNose - (x[last] + 0.5 * h - h * S) };
}

describe('3D sphere browser dataset: integrity and provenance', () => {
  it('every listed file exists with the recorded size and SHA-256, and nothing unlisted is present', () => {
    expect(manifest.schema).toBe(DATASET_SCHEMA);
    expect(manifest.version).toBe(DATASET_VERSION);
    for (const f of manifest.files) {
      const b = read(f.name);
      expect(b.length, f.name).toBe(f.bytes);
      expect(sha256(b), f.name).toBe(f.sha256);
    }
    const listed = new Set([...manifest.files.map((f: any) => f.name), 'manifest.json', 'README.md', 'SHA256SUMS']);
    expect(readdirSync(DIR).filter((f) => !listed.has(f))).toEqual([]);
  });

  it('JSON files are canonical (re-serialising reproduces them byte for byte)', () => {
    expect(stableJson(results)).toBe(read('results.json').toString('utf8'));
    expect(stableJson(profiles)).toBe(read('profiles.json').toString('utf8'));
    expect(stableJson(manifest, 1)).toBe(read('manifest.json').toString('utf8'));
  });

  it('each plane names its checkpoint (path, size, SHA-256, step), the reference configuration and the archived run it reproduces', () => {
    expect(manifest.planes.map((p: any) => p.id).sort()).toEqual(['rh48-off0.25', 'rh48-off0.5', 'rh48-off0.75', 'rh64-off0']);
    for (const p of manifest.planes) {
      expect(p.source.checkpointSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(p.source.checkpointBytes).toBeGreaterThan(1e6);
      expect(p.source.checkpoint).toMatch(/\.ckpt$/);
      expect(p.configuration).toEqual(runConfigOf(p.configuration.radiusCells, p.configuration.gridOffset));
      const archived = jsonl(path.join(PROJECT, p.source.archivedSummary)).at(-1);
      expect(fileSha256(path.join(PROJECT, p.source.archivedSummary))).toBe(p.source.archivedSummarySha256);
      expect(p.convergence.convergedAtStep).toBe(archived.steps);
      expect(p.convergence.advancedFromStep).toBeLessThan(archived.steps);
      expect(p.convergence.dropFront).toBe(archived.dropFront);
      expect(p.convergence.massImbalance).toBe(archived.massImbalance);
      expect(p.convergence.dropFront).toBeGreaterThanOrEqual(4);
      expect(p.convergence.massImbalance).toBeLessThan(1e-3);
      for (const k of ['foot', 'mid', 'tail', 'maxGradient', 'equalArea'] as const) expect(p.detectors[k], k).toBe(archived.standoff[k]);
    }
    for (const f of manifest.generator.provenance.files) expect(f.gitBlob).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('3D sphere browser dataset: planes', () => {
  for (const id of ['rh48-off0.25', 'rh48-off0.5', 'rh48-off0.75', 'rh64-off0']) {
    it(`${id}: dimensions, geometry and masks are consistent with the sphere and the grid`, () => {
      const p = manifest.planes.find((q: any) => q.id === id);
      const N = p.configuration.radiusCells;
      const h = 1 / N;
      expect(p.grid.nx).toBe(Math.round(2.5 * N));
      expect(p.grid.ny).toBe(2 * N);
      expect(p.grid.h).toBe(h);
      expect(p.grid.x0).toBe(-2 - p.configuration.gridOffset * h);
      expect(p.f64.fields.map((f: any) => f.name)).toEqual(F64_FIELDS.map((f) => f.name));
      const pl = f64BytesToPlane(new Uint8Array(read(p.f64.file)), p.grid.nx, p.grid.ny);
      let outside = 0;
      let inside = 0;
      for (let j = 0; j < pl.ny; j++)
        for (let i = 0; i < pl.nx; i++) {
          const q = j * pl.nx + i;
          const a = pl.fields.alpha[q];
          expect(a >= 0 && a <= 1).toBe(true);
          // the k = 0 cell spans x ± h/2, y ± h/2, z ∈ [0, h]: nearest and farthest points from the sphere centre
          const x = p.grid.x0 + (i + 0.5) * h;
          const y = (j + 0.5) * h;
          const near = Math.hypot(Math.max(0, Math.abs(x) - h / 2), Math.max(0, y - h / 2), 0);
          const far = Math.hypot(Math.abs(x) + h / 2, y + h / 2, h);
          if (near >= 1) {
            outside++;
            expect(a, `cell ${i},${j} lies outside the sphere`).toBe(1);
          }
          if (far <= 1) {
            inside++;
            expect(a, `cell ${i},${j} lies inside the sphere`).toBe(0);
          }
          if (a > 0) {
            expect(pl.fields.rho[q] > 0 && pl.fields.p[q] > 0).toBe(true);
            for (const f of F64_FIELDS) expect(Number.isFinite(pl.fields[f.name][q])).toBe(true);
          } else for (const f of F64_FIELDS) expect(pl.fields[f.name][q]).toBe(0);
        }
      expect(outside).toBeGreaterThan(0.5 * pl.nx * pl.ny);
      expect(inside).toBeGreaterThan(0);
      expect(p.grid.cells.solid + p.grid.cells.cut + p.grid.cells.full).toBe(pl.nx * pl.ny);
    });

    it(`${id}: the stagnation row of the plane is the archived stagnation-line profile, and gives the archived standoffs`, () => {
      const p = manifest.planes.find((q: any) => q.id === id);
      const { nx, ny, h, x0 } = p.grid;
      const pl = f64BytesToPlane(new Uint8Array(read(p.f64.file)), nx, ny);
      let iNose = 0;
      for (let i = 0; i < nx; i++) {
        if (pl.fields.alpha[i] === 0) break;
        iNose = i;
      }
      const x = Array.from({ length: iNose + 1 }, (_, i) => x0 + (i + 0.5) * h);
      const rho = Array.from({ length: iNose + 1 }, (_, i) => pl.fields.rho[i]);
      const alpha = Array.from({ length: iNose + 1 }, (_, i) => pl.fields.alpha[i]);
      // the archive stores the same row with 6 decimals (|error| ≤ 5e-7)
      const csvName = readdirSync(path.join(PROJECT, path.dirname(p.source.archivedSummary))).find((f) => f.endsWith('.csv'))!;
      const csv = readProfileCsv(path.join(PROJECT, path.dirname(p.source.archivedSummary), csvName));
      expect(csv.rho.length).toBe(iNose + 1);
      for (let i = 0; i <= iNose; i++) expect(Math.abs(rho[i] - csv.rho[i]), `row ${i}`).toBeLessThanOrEqual(5e-7 + 1e-12);
      // detectors from the normalized row: equal to the archived values up to the round-off of the normalization
      const d = rowDetectors(x, rho, alpha, h);
      const archived = jsonl(path.join(PROJECT, p.source.archivedSummary)).at(-1);
      for (const k of ['foot', 'mid', 'tail', 'maxGradient', 'equalArea'] as const) expect(Math.abs(d[k] - archived.standoff[k]), k).toBeLessThan(1e-12);
    });

    it(`${id}: the mirror check against the j = 0 layer is within the archived symmetry error`, () => {
      const p = manifest.planes.find((q: any) => q.id === id);
      expect(p.extraction.mirrorMaxAbsDifference.rho).toBeLessThanOrEqual(p.extraction.archivedSymmetryError);
      expect(p.extraction.mirrorMaxAbsDifference.alpha).toBe(0);
    });
  }

  for (const id of ['rh48-off0.5', 'rh64-off0']) {
    it(`${id}: the 8-bit browser plane stays within its documented quantization error of the full-precision plane`, () => {
      const p = manifest.planes.find((q: any) => q.id === id);
      const { nx, ny } = p.grid;
      const n = nx * ny;
      const pl = f64BytesToPlane(new Uint8Array(read(p.f64.file)), nx, ny);
      const u8 = new Uint8Array(read(p.u8.file));
      expect(u8.length).toBe(U8_FIELDS.length * n);
      const ranges = Object.fromEntries(p.u8.fields.map((f: any) => [f.name, f]));
      const dq = dequantU8(u8, nx, ny, ranges);
      const fs = results.freestream;
      for (const f of p.u8.fields) {
        let maxErr = 0;
        for (let q = 0; q < n; q++) {
          if (pl.fields.alpha[q] === 0) {
            expect(u8[U8_FIELDS.findIndex((u) => u.name === f.name) * n + q]).toBe(0);
            continue;
          }
          const F = pl.fields;
          const src = f.name === 'mach' ? machOf(F.rho[q], F.u[q], F.v[q], F.w[q], F.p[q], fs.rho, fs.p, fs.V) : f.name === 'alpha' ? F.alpha[q] : F[f.name as 'rho'][q];
          maxErr = Math.max(maxErr, Math.abs(dq[f.name][q] - src));
        }
        expect(maxErr, f.name).toBeLessThanOrEqual(f.bound + 1e-12);
        expect(Math.abs(maxErr - f.maxAbsError), f.name).toBeLessThan(1e-12);
      }
    });
  }
});

describe('3D sphere browser dataset: profiles and results', () => {
  it('every profile row is copied exactly from its archive (rows within PROFILE_D_MAX of the wall)', () => {
    expect(profiles.dMax).toBe(PROFILE_D_MAX);
    expect(profiles.profiles.length).toBe(15);
    for (const p of profiles.profiles) {
      const f = path.join(PROJECT, p.source);
      expect(fileSha256(f), p.id).toBe(p.sourceSha256);
      const c = readProfileCsv(f);
      const keep = c.d.map((d, k) => [d, k] as const).filter(([d]) => d <= PROFILE_D_MAX).map(([, k]) => k);
      expect(p.d).toEqual(keep.map((k) => c.d[k]));
      expect(p.rho).toEqual(keep.map((k) => c.rho[k]));
      expect(p.rowsInSource).toBe(c.d.length);
    }
  });

  it('refinement rows equal the archived summaries, and the extrapolations are recomputed from them', () => {
    const rows = results.refinement3d.rows;
    for (const r of rows) {
      const archived = jsonl(path.join(PROJECT, r.source)).filter((a: any) => a.options.radiusCells === r.radiusCells && (a.options.gridOffset ?? 0) === r.gridOffset && a.options.flux === 'rusanov' && a.options.downstream === 0.5 && !a.options.residualDrop).at(-1);
      expect(r.standoff.equalArea).toBe(archived.standoff.equalArea);
      expect(r.steps).toBe(archived.steps);
    }
    const st48 = results.positionStatistics.rows.find((s: any) => s.radiusCells === 48);
    expect(st48.offsets).toEqual([0, 0.25, 0.5, 0.75]);
    // the published values (docs/sphere3d-rh48-offsets/README.md): range 4.58e-4, offset 0 − mean −1.54e-4
    expect(st48.equalArea.range.toExponential(2)).toBe('4.58e-4');
    expect(st48.equalArea.offset0MinusMean.toExponential(2)).toBe('-1.54e-4');
    const fext = results.extrapolation.rows.map((r: any) => r.positionAveraged.fext);
    const gci = results.extrapolation.rows.map((r: any) => r.positionAveraged.gci);
    expect(Math.min(...fext).toFixed(4)).toBe('0.3487');
    expect(Math.max(...fext).toFixed(4)).toBe('0.3502');
    expect(Math.min(...gci).toFixed(4)).toBe('0.0088');
    expect(Math.max(...gci).toFixed(4)).toBe('0.0134');
    const t = results.extrapolation.rows.find((r: any) => r.triplet.join('/') === '32/48/64');
    const v = (N: number) => results.positionStatistics.rows.find((s: any) => s.radiusCells === N)?.equalArea.mean ?? rows.find((r: any) => r.radiusCells === N && r.gridOffset === 0).standoff.equalArea;
    expect(celik([1 / 64, 1 / 48, 1 / 32], [v(64), v(48), v(32)])).toEqual(t.positionAveraged);
  });

  it('quoted values carry their source, and the sources contain them', () => {
    const band = results.axisymmetricReferenceBand;
    expect([band.lo, band.hi]).toEqual([0.3485, 0.3508]);
    expect(readFileSync(path.join(DOCS, 'axi-reference-refinement', 'README.md'), 'utf8')).toContain('0.3485–0.3508');
    const b = results.billigCorrelation;
    expect(b.kind).toMatch(/empirical correlation/);
    expect(b.kind).toMatch(/not experimental validation/);
    expect(b.value).toBe(billigSphere(2));
    expect(b.value).toBeCloseTo(0.143 * Math.exp(3.24 / 4), 15);
    expect(readFileSync(path.join(DOCS, 'axisymmetric-reference.md'), 'utf8')).toContain('Ambrosio & Wortman');
    expect(readFileSync(path.join(DOCS, 'sphere3d-uncertainty-audit', 'README.md'), 'utf8')).toContain('+5.4e-5 (50 %), +5.6e-5 (steepest), +5.5e-5 (equal area)');
    expect(results.model).toMatch(/not a validated prediction/);
  });
});
