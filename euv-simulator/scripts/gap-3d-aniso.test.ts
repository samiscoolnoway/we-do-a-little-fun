// Gap study (docs/sphere-gap-study): the 3D Cartesian Mach 2 sphere case with separate spacing along the flow (hx)
// and across it (hy = hz). The solver (euler3d.ts) is used unchanged; this file repeats the set-up, stopping rule and
// stagnation-line measurement of sphere3d.ts runSphereCase line by line, with h replaced by hx along x and by hyz in
// y and z. With hx = hyz it must reproduce runSphereCase exactly (checked against docs/sphere3d-refinement). Not part
// of `npm test`.
//
//   cd euv-simulator
//   GRIDS=32:16,16:32 OFF=0 EXTRA='{"downstream":0.5,"lateral":2}' OUT=docs/sphere-gap-study/3d-aniso \
//     npx vitest run --root . --config /dev/null --testTimeout 14400000 scripts/gap-3d-aniso.test.ts
//
// GRIDS: list of R/hx:R/hyz pairs; OFF: grid shift in x in units of hx (list allowed); EXTRA: JSON with upstream,
// downstream, lateral (defaults 2, 1.5, 2.5 as runSphereCase). Rusanov flux, cut-cell wall.
import { it } from 'vitest';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { EulerSolver3D, makeBoxGrid } from '../src/lab/core/euler3d';
import { freestream, normalShock, pitotPressure, stagnationTemperature } from '../src/lab/core/gas';

function run(Nx: number, Nyz: number, off: number, extra: { upstream?: number; downstream?: number; lateral?: number }) {
  const R = 1;
  const mach = 2;
  const hx = R / Nx;
  const hyz = R / Nyz;
  const up = extra.upstream ?? 2;
  const down = extra.downstream ?? 1.5;
  const lat = extra.lateral ?? 2.5;
  const nx = Math.round((up + down) * Nx);
  const nyz = Math.round(lat * Nyz);
  const x0 = -up * R - off * hx;
  const grid = makeBoxGrid(x0, x0 + nx * hx, 0, nyz * hyz, 0, nyz * hyz, nx, nyz, nyz);
  const fs = freestream(mach, 220, 2500, 0);
  const fs3 = { rho: fs.rho, u: fs.u, v: 0, w: 0, p: fs.p };
  const s = new EulerSolver3D(grid, {
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
  const startup = 150;
  const maxSteps = 20000;
  const intercepted = fs.rho * fs.V * Math.PI * R * R * 0.25;
  let imbalance = Infinity;
  let refFront = 0;
  let dropFront = 0;
  let converged = false;
  const t0 = performance.now();
  for (let n = 0; n < maxSteps; n++) {
    if (n === startup) s.setOrder(2);
    const r = s.step();
    if (!r.ok) break;
    if (n < 5) refFront = Math.max(refFront, r.residualRegion);
    dropFront = Math.log10(refFront / r.residualRegion);
    imbalance = Math.abs(s.boundaryMassFlux + s.bodyMassFlux) / intercepted;
    if (n > startup + 20 && dropFront >= 4 && imbalance < 1e-3) {
      converged = true;
      break;
    }
  }
  const seconds = (performance.now() - t0) / 1000;
  const pit = pitotPressure(fs.p, mach);
  const g = 1.4;
  const rho2 = fs.rho * normalShock(mach).r21;
  const T0 = stagnationTemperature(fs.T, mach);
  // one grid line (j, k) parallel to x: profile from the inflow to the last fluid cell, detectors as sphere3d.ts
  const line = (j: number, k: number) => {
    let iNose = 0;
    for (let i = 0; i < nx; i++) {
      if (s.isSolid(i, j, k)) break;
      iNose = i;
    }
    const y = (j + 0.5) * hyz;
    const z = (k + 0.5) * hyz;
    const xNose = -Math.sqrt(R * R - y * y - z * z);
    const profile = Array.from({ length: iNose + 1 }, (_, i) => {
      const r = s.cell(i, j, k).rho;
      return { x: s.centre(i, j, k)[0], rho: r / fs.rho, phi: (r - fs.rho) / (rho2 - fs.rho), alpha: s.fluidFraction(i, j, k) };
    });
    const crossings = [0.1, 0.5, 0.9].map((level) => {
      for (let i = 1; i < profile.length; i++) {
        const a = profile[i - 1].phi;
        const b = profile[i].phi;
        if (a < level && b >= level) return { i, x: profile[i - 1].x + (hx * (level - a)) / (b - a) };
      }
      return { i: -1, x: NaN };
    });
    let kMax = -1;
    const rise = (i: number) => (i >= 1 && i < profile.length && profile[i].alpha === 1 && profile[i - 1].alpha === 1 ? profile[i].rho - profile[i - 1].rho : -Infinity);
    for (let i = 1; i < profile.length; i++) if (rise(i) > -Infinity && (kMax < 0 || rise(i) > rise(kMax))) kMax = i;
    let xGrad = NaN;
    if (kMax > 0) {
      const [dm, d0, dp] = [rise(kMax - 1), rise(kMax), rise(kMax + 1)];
      let o = 0;
      if (Number.isFinite(dm) && Number.isFinite(dp) && dm - 2 * d0 + dp < 0) o = Math.max(-0.5, Math.min(0.5, (0.5 * (dm - dp)) / (dm - 2 * d0 + dp)));
      xGrad = 0.5 * (profile[kMax - 1].x + profile[kMax].x) + o * hx;
    }
    let S = 0;
    let last = 0;
    for (let i = 0; i < profile.length; i++) {
      S += Math.min(Math.max(profile[i].phi, 0), 1);
      last = i;
      if (profile[i].phi >= 1) break;
    }
    const xEA = profile[last].x + 0.5 * hx - hx * S;
    return {
      j,
      k,
      r: Math.hypot(y, z),
      iNose,
      xNose,
      profile,
      standoff: { foot: xNose - crossings[0].x, mid: xNose - crossings[1].x, tail: xNose - crossings[2].x, maxGradient: xNose - xGrad, equalArea: xNose - xEA },
      iShock: crossings[1].i,
      widthCells: (crossings[2].x - crossings[0].x) / hx,
      noseCellGap: xNose - profile[iNose].x,
    };
  };
  const stag = line(0, 0);
  const offAxis = [1, 2, 3].map((j) => line(j, 0));
  const c = s.cell(stag.iNose, 0, 0);
  let upstreamDeviation = 0;
  for (let k = 0; k < nyz; k++)
    for (let j = 0; j < nyz; j++)
      for (let i = 0; i < Math.max(0, stag.iShock - 5); i++) {
        const q = s.cell(i, j, k);
        upstreamDeviation = Math.max(upstreamDeviation, Math.abs(q.rho / fs.rho - 1), Math.abs(q.p / fs.p - 1), Math.abs(q.u / fs.u - 1));
      }
  let symmetryError = 0;
  for (let k = 0; k < nyz; k++)
    for (let j = 0; j < nyz; j++)
      for (let i = 0; i < nx; i++) {
        if (s.isSolid(i, j, k)) continue;
        symmetryError = Math.max(symmetryError, Math.abs(s.cell(i, j, k).rho - s.cell(i, k, j).rho) / fs.rho);
      }
  let wa = 0;
  let p0w = 0;
  let T0MaxError = 0;
  for (const u of s.wallUnits().filter((w) => s.centre(w.i, w.j, w.k)[0] < 0)) {
    const q = s.cell(u.i, u.j, u.k);
    wa += u.area;
    p0w += (u.area * (q.p * Math.pow(1 + 0.5 * (g - 1) * q.mach ** 2, g / (g - 1)))) / pit;
    T0MaxError = Math.max(T0MaxError, Math.abs((q.T * (1 + 0.5 * (g - 1) * q.mach ** 2)) / T0 - 1));
  }
  const mi = s.mergeInfo();
  return {
    options: { mach, Nx, Nyz, hx, hyz, gridOffset: off, upstream: up, downstream: down, lateral: lat, flux: 'rusanov', wall: 'cutcell', cfl: 0.8 },
    grid: { nx, ny: nyz, nz: nyz, cells: nx * nyz * nyz, fluidCells: s.fluidCells },
    steps: s.steps,
    converged,
    dropFront,
    massImbalance: imbalance,
    bodyFluxFraction: s.bodyMassFlux / intercepted,
    seconds,
    failure: s.failure ? `${s.failure.reason} at (${s.failure.i}, ${s.failure.j}, ${s.failure.k})` : null,
    symmetryError,
    upstreamDeviation,
    xNose: stag.xNose,
    standoff: stag.standoff,
    shockWidthCells: stag.widthCells,
    noseCell: { alpha: stag.profile[stag.iNose].alpha, gapToWall: stag.noseCellGap, pRatio: c.p / pit, p0Ratio: (c.p * Math.pow(1 + 0.5 * (g - 1) * c.mach ** 2, g / (g - 1))) / pit, TRatio: c.T / T0, mach: c.mach },
    offAxisLines: offAxis.map((l) => ({ j: l.j, k: l.k, r: l.r, standoff: l.standoff })),
    lineR0: stag.r,
    wall: { p0Mean: p0w / wa, T0MaxError },
    merge: { groups: mi.groups, maxSize: mi.maxSize, unmergedSmall: mi.unmergedSmall },
    hllcFallbacks: s.hllcFallbacksTotal,
    profile: stag.profile,
  };
}

it('3D anisotropic sphere measurement', () => {
  const dir = process.env.OUT ?? 'gap-3d-out';
  mkdirSync(dir, { recursive: true });
  const extra = process.env.EXTRA ? JSON.parse(process.env.EXTRA) : {};
  const tag = process.env.EXTRA ? '_' + Object.entries(extra).map(([k, v]) => `${k}${v}`).join('_') : '';
  for (const pair of (process.env.GRIDS ?? '12:12').split(','))
    for (const off of (process.env.OFF ?? '0').split(',').map(Number)) {
      const [Nx, Nyz] = pair.split(':').map(Number);
      const r = run(Nx, Nyz, off, extra);
      const name = `s3da_rusanov_Nx${Nx}_Nyz${Nyz}_off${off}${tag}`;
      const { profile, ...meta } = { name, ...r };
      const head = [
        `# 3D Cartesian Mach 2 sphere with hx = R/${Nx}, hy = hz = R/${Nyz} (scripts/gap-3d-aniso.test.ts), stagnation-line cells j = k = 0 (centres at y = z = hyz/2)`,
        '# x = cell-centre x (R); d = xNose - x (R); rho/rhoInf; phi = (rho-rhoInf)/(rho2-rhoInf), rho2/rhoInf = 8/3; alpha = fluid fraction',
        `# meta ${JSON.stringify(meta)}`,
        'i,x,d,rho_over_rhoInf,phi,alpha',
      ].join('\n');
      const rows = profile.map((p, i) => `${i},${p.x.toFixed(6)},${(r.xNose - p.x).toFixed(6)},${p.rho.toFixed(6)},${p.phi.toFixed(6)},${p.alpha.toFixed(4)}`);
      writeFileSync(`${dir}/${name}.csv`, head + '\n' + rows.join('\n') + '\n');
      appendFileSync(`${dir}/summary.jsonl`, JSON.stringify(meta) + '\n');
    }
});
