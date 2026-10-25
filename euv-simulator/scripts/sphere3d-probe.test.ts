// Diagnostics for the isotropic 3D sphere case (docs/sphere3d-uncertainty-audit). Uses the unchanged solver and
// driver; never writes to a checkpoint it reads. Not part of `npm test`.
//
//   PROBE=state RH=64 EXTRA='{"downstream":0.5,"lateral":2}' CKPT=<file> OUT=<file.json> \
//     npx vitest run --root . --config /dev/null --testTimeout 14400000 scripts/sphere3d-probe.test.ts
//     → imports the checkpointed state into a fresh solver and records the stagnation-line detectors (same definitions
//       as sphere3d.ts), the y↔z asymmetry (where, how large), outflow-plane Mach numbers and the y↔z symmetry of the
//       cut-cell geometry. With STEPS=n the solver is advanced n steps in memory (nothing written) and measured again;
//       SAMPLE=m also records residual, detectors and asymmetry every m-th of those steps.
//   PROBE=track RH=24 EXTRA=… DROP=6 MAXSTEPS=6000 EVERY=100 OUT=<file.jsonl> …
//     → runs runSphereCase (residualDrop DROP) and measures the state every EVERY steps via in-memory checkpoints:
//       step, residual drop, detectors, symmetry error.
//   PROBE=perturb RH=32 EXTRA=… CKPT=<file> AMP=1e-4 XMIN=0 [SHAPE=one] DROP=6 OUT=<file.json> …
//     → perturbs a copy of the checkpointed state for x > XMIN, resumes it to a DROP-order residual drop and records
//       the converged detectors (equal area included) and asymmetry.
import { it } from 'vitest';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { decodeCheckpoint3D, encodeCheckpoint3D } from '../src/lab/core/checkpoint3d';
import { EulerSolver3D, makeBoxGrid } from '../src/lab/core/euler3d';
import { freestream, normalShock } from '../src/lab/core/gas';
import { runSphereCase } from '../src/lab/core/sphere3d';

interface Setup {
  N: number;
  up: number;
  down: number;
  lat: number;
  off: number;
}
function build(o: Setup) {
  const R = 1;
  const h = R / o.N;
  const nx = Math.round((o.up + o.down) * o.N);
  const nyz = Math.round(o.lat * o.N);
  const x0 = -o.up * R - o.off * h;
  const fs = freestream(2, 220, 2500, 0);
  const fs3 = { rho: fs.rho, u: fs.u, v: 0, w: 0, p: fs.p };
  const s = new EulerSolver3D(makeBoxGrid(x0, x0 + nx * h, 0, nyz * h, 0, nyz * h, nx, nyz, nyz), {
    cfl: 0.8,
    order: 1,
    timeMode: 'local',
    freestream: fs3,
    sphere: { cx: 0, cy: 0, cz: 0, r: R, wall: 'cutcell' },
    bc: { xmin: 'inflow', xmax: 'extrapolate', ymin: 'wall', ymax: 'extrapolate', zmin: 'wall', zmax: 'extrapolate' },
    residualRegion: (x) => x < 0,
    flux: 'rusanov',
  });
  s.init(() => fs3);
  return { s, h, nx, nyz, fs };
}

/** stagnation-line detectors exactly as sphere3d.ts runSphereCase (line j = k = 0) */
function detectors(s: EulerSolver3D, h: number, nx: number, fsRho: number) {
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
  return { foot: cross(0.1), mid: cross(0.5), tail: cross(0.9), maxGradient: xNose - xGrad, equalArea: xNose - (prof[last].x + 0.5 * h - h * S) };
}

function symmetry(s: EulerSolver3D, nx: number, nyz: number, fsRho: number) {
  let worst = 0;
  let at: number[] = [0, 0, 0];
  let front = 0;
  let nearAxis = 0;
  const bySlab = new Float64Array(nx);
  for (let k = 0; k < nyz; k++)
    for (let j = k + 1; j < nyz; j++)
      for (let i = 0; i < nx; i++) {
        if (s.isSolid(i, j, k)) continue;
        const d = Math.abs(s.cell(i, j, k).rho - s.cell(i, k, j).rho) / fsRho;
        if (d > bySlab[i]) bySlab[i] = d;
        if (d > worst) {
          worst = d;
          at = [i, j, k];
        }
        const [x, y, z] = s.centre(i, j, k);
        if (x < 0 && d > front) front = d;
        if (x < 0 && Math.hypot(y, z) < 0.25 && d > nearAxis) nearAxis = d;
      }
  return { worst, at, centre: s.centre(at[0], at[1], at[2]), front, nearAxis, bySlab: Array.from(bySlab) };
}

/** Mach numbers on the last interior plane (i = nx − 1, the cells feeding the extrapolation outflow) */
function outflow(s: EulerSolver3D, nx: number, nyz: number) {
  let minMach = Infinity;
  let minUx = Infinity;
  let subsonic = 0;
  let subsonicNormal = 0;
  let fluid = 0;
  for (let k = 0; k < nyz; k++)
    for (let j = 0; j < nyz; j++) {
      if (s.isSolid(nx - 1, j, k)) continue;
      fluid++;
      const c = s.cell(nx - 1, j, k);
      const a = Math.sqrt((1.4 * c.p) / c.rho);
      minMach = Math.min(minMach, c.mach);
      minUx = Math.min(minUx, c.u / a);
      if (c.mach < 1) subsonic++;
      if (c.u / a < 1) subsonicNormal++;
    }
  return { fluidCells: fluid, minMach, minNormalMach: minUx, subsonicCells: subsonic, subsonicNormalCells: subsonicNormal };
}

/** y↔z mirror symmetry of the static cut-cell geometry (volume fractions, solid mask, merged-group membership) */
function geometrySymmetry(s: EulerSolver3D, nx: number, nyz: number) {
  let alphaDiff = 0;
  let solidDiff = 0;
  const merged = (s as any).merged as Uint8Array | null;
  let mergedDiff = 0;
  for (let k = 0; k < nyz; k++)
    for (let j = 0; j < nyz; j++)
      for (let i = 0; i < nx; i++) {
        alphaDiff = Math.max(alphaDiff, Math.abs(s.fluidFraction(i, j, k) - s.fluidFraction(i, k, j)));
        if (s.isSolid(i, j, k) !== s.isSolid(i, k, j)) solidDiff++;
        if (merged && merged[(k * nyz + j) * nx + i] !== merged[(j * nyz + k) * nx + i]) mergedDiff++;
      }
  // groups: is the mirror image of every group also a group?
  const groups = ((s as any).groups as Int32Array[]) ?? [];
  const key = (g: number[]) => g.slice().sort((a, b) => a - b).join(',');
  const set = new Set(groups.map((g) => key(Array.from(g))));
  let unmatched = 0;
  for (const g of groups) {
    const m = Array.from(g).map((c) => {
      const i = c % nx;
      const j = ((c - i) / nx) % nyz;
      const k = (c - i - j * nx) / (nx * nyz);
      return (j * nyz + k) * nx + i;
    });
    if (!set.has(key(m))) unmatched++;
  }
  return { maxAlphaDiff: alphaDiff, solidMismatch: solidDiff, mergedMismatch: mergedDiff, groups: groups.length, groupsWithoutMirror: unmatched };
}

it('3D sphere probe', () => {
  const extra = process.env.EXTRA ? JSON.parse(process.env.EXTRA) : {};
  const setup: Setup = { N: Number(process.env.RH ?? 12), up: extra.upstream ?? 2, down: extra.downstream ?? 1.5, lat: extra.lateral ?? 2.5, off: Number(process.env.OFF ?? 0) };
  const out = process.env.OUT!;
  if (process.env.PROBE === 'state') {
    const cp = decodeCheckpoint3D(new Uint8Array(readFileSync(process.env.CKPT!)));
    const { s, h, nx, nyz, fs } = build(setup);
    const fp = s.geometryFingerprint();
    if (fp.crc !== cp.geometry.crc || fp.fluidCells !== cp.geometry.fluidCells) throw new Error('geometry differs from the checkpoint');
    s.importState(cp.solver);
    const timing: Record<string, number> = {};
    const timed = <T,>(name: string, f: () => T): T => {
      const t = performance.now();
      const v = f();
      timing[name] = Math.round(performance.now() - t);
      return v;
    };
    const res: any = { step: s.steps, residualDropAtCheckpoint: cp.driver.dropFront, residualAtCheckpoint: cp.driver.history.at(-1), refFront: cp.driver.refFront };
    res.detectors = timed('detectors', () => detectors(s, h, nx, fs.rho));
    res.symmetry = timed('symmetry', () => symmetry(s, nx, nyz, fs.rho));
    res.outflow = timed('outflow', () => outflow(s, nx, nyz));
    if (process.env.GEOMETRY !== '0') res.geometry = timed('geometry', () => geometrySymmetry(s, nx, nyz));
    res.timingMs = timing;
    const steps = Number(process.env.STEPS ?? 0);
    if (steps) {
      // SAMPLE: every SAMPLE-th step also record the residual (x < 0 region), its drop and the asymmetry
      const sample = Number(process.env.SAMPLE ?? 0);
      res.history = [];
      for (let n = 1; n <= steps; n++) {
        const r = s.step();
        if (!r.ok) throw new Error('step failed');
        if (sample && n % sample === 0) {
          const sym = symmetry(s, nx, nyz, fs.rho);
          res.history.push({ step: s.steps, residual: r.residualRegion, drop: Math.log10(cp.driver.refFront / r.residualRegion), detectors: detectors(s, h, nx, fs.rho), symmetry: sym.worst, symmetryFront: sym.front, symmetryNearAxis: sym.nearAxis });
        }
      }
      res.after = { step: s.steps, detectors: detectors(s, h, nx, fs.rho) };
    }
    writeFileSync(out, JSON.stringify(res, null, 1) + '\n');
    return;
  }
  if (process.env.PROBE === 'perturb') {
    // y↔z-antisymmetric perturbation of a checkpointed state (copy in memory; the file is only read): every pair of
    // full cells (i,j,k)/(i,k,j), j > k, with x > XMIN gets all conservative variables scaled by (1 ± AMP·w), w a fixed
    // pattern in [−1, 1] (velocity and temperature unchanged, density and pressure ∓ AMP·w). Then resumed with
    // residualDrop DROP; the final detectors and asymmetry are written to OUT.
    const amp = Number(process.env.AMP ?? 0);
    const xmin = Number(process.env.XMIN ?? 0);
    // SHAPE=one: only the (i,j,k) cell of each pair (a symmetric plus an antisymmetric part, each AMP/2)
    const oneSided = process.env.SHAPE === 'one';
    const cp = decodeCheckpoint3D(new Uint8Array(readFileSync(process.env.CKPT!)));
    const { s, h, nx, nyz, fs } = build(setup);
    let count = 0;
    if (amp) {
      const U = cp.solver.U;
      const P = (i: number, j: number, k: number) => (k + 2) * (nx + 4) * (nyz + 4) + (j + 2) * (nx + 4) + (i + 2);
      for (let k = 0; k < nyz; k++)
        for (let j = k + 1; j < nyz; j++)
          for (let i = 0; i < nx; i++) {
            if (s.centre(i, j, k)[0] <= xmin || s.fluidFraction(i, j, k) !== 1 || s.fluidFraction(i, k, j) !== 1) continue;
            const w = Math.sin(0.7 * i + 1.3 * j + 2.1 * k);
            const a = P(i, j, k);
            const b = P(i, k, j);
            for (let v = 0; v < 5; v++) {
              U[v][a] *= 1 + amp * w;
              if (!oneSided) U[v][b] *= 1 - amp * w;
            }
            count++;
          }
    }
    const r = runSphereCase({ mach: 2, radiusCells: setup.N, wall: 'cutcell', flux: 'rusanov', gridOffset: setup.off, upstream: setup.up, downstream: setup.down, lateral: setup.lat, residualDrop: Number(process.env.DROP ?? 4), maxSteps: Number(process.env.MAXSTEPS ?? 20000), checkpoint: { resume: encodeCheckpoint3D(cp) } });
    // equal area from the driver's stagnation-line profile, as in detectors() (R = 1)
    const prof = r.shock.profile;
    let S = 0;
    let last = 0;
    for (let i = 0; i < prof.length; i++) {
      S += Math.min(Math.max(prof[i].phi, 0), 1);
      last = i;
      if (prof[i].phi >= 1) break;
    }
    const equalArea = r.shock.xNose - (prof[last].x + 0.5 * h - h * S);
    writeFileSync(out, JSON.stringify({ amp, xmin, shape: oneSided ? 'one' : 'anti', perturbedPairs: count, fromStep: cp.solver.steps, steps: r.steps, converged: r.converged, drop: r.dropFront, standoff: { foot: r.shock.crossings[0].standoff, mid: r.shock.crossings[1].standoff, tail: r.shock.crossings[2].standoff, maxGradient: r.shock.maxGradient.standoff, equalArea }, symmetryError: r.symmetryError, noseP: r.pStag / r.pPitot }) + '\n');
    return;
  }
  // PROBE=track
  const { s: m, h, nx, nyz, fs } = build(setup);
  const every = Number(process.env.EVERY ?? 100);
  runSphereCase({
    mach: 2,
    radiusCells: setup.N,
    wall: 'cutcell',
    flux: 'rusanov',
    gridOffset: setup.off,
    upstream: setup.up,
    downstream: setup.down,
    lateral: setup.lat,
    residualDrop: Number(process.env.DROP ?? 4),
    maxSteps: Number(process.env.MAXSTEPS ?? 20000),
    checkpoint: {
      every,
      write: (bytes, steps) => {
        const cp = decodeCheckpoint3D(bytes);
        m.importState(cp.solver);
        const sym = symmetry(m, nx, nyz, fs.rho);
        appendFileSync(out, JSON.stringify({ step: steps, drop: cp.driver.dropFront, imbalance: cp.driver.imbalance, residual: cp.driver.history.at(-1), detectors: detectors(m, h, nx, fs.rho), symmetry: sym.worst, symmetryAt: sym.centre, symmetryFront: sym.front, symmetryNearAxis: sym.nearAxis }) + '\n');
      },
    },
  });
});
