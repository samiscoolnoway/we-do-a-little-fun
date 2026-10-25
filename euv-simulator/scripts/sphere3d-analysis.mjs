// Analysis of the 3D Cartesian sphere refinement study (docs/sphere3d-refinement/summary.jsonl + profile CSVs).
// Plain Node. Tabulates every run, recomputes the 50 % crossing from each exported profile (check against the
// solver's own value), and evaluates observed order / Richardson extrapolation / GCI for each grid triplet with
// Celik et al. (J. Fluids Eng. 130, 2008), which allows non-constant refinement ratios.
//
//   node scripts/sphere3d-analysis.mjs            (from euv-simulator/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '..', 'docs', 'sphere3d-refinement');
const runs = fs
  .readFileSync(path.join(dir, 'summary.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const out = [];
const log = (s = '') => out.push(s);
const AXI = { best: [0.349, 0.351], envelope: [0.347, 0.355] }; // axisymmetric reference (docs/axisymmetric-reference.md)

// 1. profile check: recompute the 50 % crossing from the CSV
log('1. Runs (and 50 % crossing recomputed from the exported profile)');
for (const r of runs) {
  const rows = fs
    .readFileSync(path.join(dir, `${r.name}.csv`), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('i,'))
    .map((l) => l.split(',').map(Number));
  let mid = NaN;
  for (let k = 1; k < rows.length; k++) {
    const [, , da, , pa] = rows[k - 1];
    const [, , db, , pb] = rows[k];
    if (pa < 0.5 && pb >= 0.5) {
      mid = da + ((db - da) * (0.5 - pa)) / (pb - pa);
      break;
    }
  }
  const s = r.standoff;
  log(
    `  ${r.name.padEnd(58)} cells ${String(r.grid.cells).padStart(7)} steps ${String(r.steps).padStart(5)} conv ${r.converged} drop ${r.dropFront.toFixed(2)} ` +
      `${r.seconds.toFixed(1).padStart(7)} s | mid ${s.mid.toFixed(5)} (csv ${mid.toFixed(5)}) grad ${s.maxGradient.toFixed(5)} EA ${s.equalArea.toFixed(5)} foot ${s.foot.toFixed(5)} tail ${s.tail.toFixed(5)} ` +
      `width ${r.shockWidthCells.toFixed(2)} | sym ${r.symmetryError.toExponential(1)} body ${r.bodyFluxFraction} imb ${r.massImbalance.toExponential(1)} | noseP ${r.noseP.toFixed(4)} noseP0 ${r.nose.p0Ratio.toFixed(4)} noseT ${r.noseT.toFixed(4)} | fb ${r.hllcFallbacks}`,
  );
}

// repeated runs of the same configuration (reproducibility check): report whether the detector values are identical
log('');
log('Repeated configurations');
const byName = new Map();
for (const r of runs) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
for (const [name, rs] of byName)
  if (rs.length > 1) {
    const same = rs.every((r) => JSON.stringify(r.standoff) === JSON.stringify(rs[0].standoff) && r.steps === rs[0].steps);
    log(`  ${name}: ${rs.length} runs, ${same ? 'identical steps and detector values' : 'DIFFERENT results'}`);
  }

// 2. convergence for a series (same flux, wall, offset, domain extras)
function celik(h, f) {
  // h1 < h2 < h3 (fine → coarse), f1, f2, f3
  const [h1, h2, h3] = h;
  const [f1, f2, f3] = f;
  const r21 = h2 / h1;
  const r32 = h3 / h2;
  const e21 = f2 - f1;
  const e32 = f3 - f2;
  if (e21 * e32 <= 0) return { note: 'oscillatory (differences change sign)' };
  const s = Math.sign(e32 / e21);
  let p = Math.log(Math.abs(e32 / e21)) / Math.log(r21);
  for (let it = 0; it < 200; it++) {
    const q = Math.log((r21 ** p - s) / (r32 ** p - s));
    const pn = Math.abs(Math.log(Math.abs(e32 / e21)) + q) / Math.log(r21);
    if (!Number.isFinite(pn)) return { note: 'no solution for p' };
    if (Math.abs(pn - p) < 1e-10) {
      p = pn;
      break;
    }
    p = pn;
  }
  const fext = (r21 ** p * f1 - f2) / (r21 ** p - 1);
  const gci = (1.25 * Math.abs(e21 / f1)) / (r21 ** p - 1);
  const gci32 = (1.25 * Math.abs(e32 / f2)) / (r32 ** p - 1);
  return { p, fext, gci: gci * f1, asym: gci32 / (r21 ** p * gci) };
}

log('');
log('2. Grid convergence of the Rusanov cut-cell series (reduced domain: 0.5R downstream, 2R lateral)');
const latest = [...byName.values()].map((rs) => rs.at(-1));
const series = latest.filter((r) => r.options.flux === 'rusanov' && r.options.wall === 'cutcell' && r.options.downstream === 0.5 && r.options.lateral === 2 && (r.options.gridOffset ?? 0) === 0);
series.sort((a, b) => a.options.radiusCells - b.options.radiusCells);
const Ns = series.map((r) => r.options.radiusCells);
for (const key of ['mid', 'maxGradient', 'equalArea']) {
  const f = series.map((r) => r.standoff[key]);
  log(`  ${key}: ${Ns.map((N, i) => `${N}: ${f[i].toFixed(5)}`).join(', ')}`);
  log(`    successive differences: ${f.slice(1).map((v, i) => `${Ns[i]}→${Ns[i + 1]}: ${(f[i] - v).toFixed(5)}`).join(', ')}`);
  for (let a = 0; a < Ns.length; a++)
    for (let b = a + 1; b < Ns.length; b++)
      for (let c = b + 1; c < Ns.length; c++) {
        const res = celik([1 / Ns[c], 1 / Ns[b], 1 / Ns[a]], [f[c], f[b], f[a]]);
        const tri = `${Ns[a]}/${Ns[b]}/${Ns[c]}`;
        if (res.note) log(`    triplet ${tri}: ${res.note}`);
        else log(`    triplet ${tri}: observed p ${res.p.toFixed(2)}, f_ext ${res.fext.toFixed(5)}, GCI(fine) ±${res.gci.toFixed(5)}, asymptotic check ${res.asym.toFixed(2)} (≈ 1 by construction within one triplet; only overlapping triplets test it)`);
      }
}

// 2b. grid-alignment scatter: the same R/h with the sphere shifted by a fraction of a cell in x (gridOffset). The spread
// over offsets is a measurement/discretisation noise that a single offset per grid cannot separate from the grid trend.
log('');
log('2b. Grid-alignment scatter (same reduced-domain set-up, sphere shifted by gridOffset cells in x)');
const offStats = {}; // Rusanov, used below
const offStatsHllc = {};
for (const flux of ['rusanov', 'hllc']) {
const shifted = latest.filter((r) => r.options.flux === flux && r.options.wall === 'cutcell' && r.options.downstream === 0.5 && r.options.lateral === 2);
const stats = flux === 'rusanov' ? offStats : offStatsHllc;
if (shifted.length) log(`  ${flux}:`);
for (const N of [...new Set(shifted.map((r) => r.options.radiusCells))].sort((a, b) => a - b)) {
  const rs = shifted.filter((r) => r.options.radiusCells === N).sort((a, b) => (a.options.gridOffset ?? 0) - (b.options.gridOffset ?? 0));
  stats[N] = {};
  const parts = [];
  for (const key of ['mid', 'maxGradient', 'equalArea']) {
    const v = rs.map((r) => r.standoff[key]);
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    stats[N][key] = { mean, n: v.length, range: Math.max(...v) - Math.min(...v) };
    parts.push(`${key} ${v.map((x) => x.toFixed(5)).join('/')} → mean ${mean.toFixed(5)}, range ${(Math.max(...v) - Math.min(...v)).toFixed(5)}`);
  }
  const np = rs.map((r) => r.noseP);
  const unconverged = rs.filter((r) => !r.converged).length;
  log(`  R/h ${String(N).padStart(2)} offsets ${rs.map((r) => r.options.gridOffset ?? 0).join(', ')}:${unconverged ? ` (${unconverged} run(s) NOT converged: step limit)` : ''}`);
  for (const t of parts) log(`    ${t}`);
  log(`    nose p/pitot ${np.map((x) => x.toFixed(4)).join('/')} (range ${(Math.max(...np) - Math.min(...np)).toFixed(4)})`);
}
}
const full = Object.keys(offStats).map(Number).filter((N) => offStats[N].mid.n >= 4).sort((a, b) => a - b);
log(`  Offset-averaged series (R/h with 4 offsets: ${full.join(', ')}):`);
for (const key of ['mid', 'maxGradient', 'equalArea']) {
  const f = full.map((N) => offStats[N][key].mean);
  log(`    ${key}: ${full.map((N, i) => `${N}: ${f[i].toFixed(5)}`).join(', ')}; differences ${f.slice(1).map((v, i) => (f[i] - v).toFixed(5)).join(', ')}`);
  for (let a = 0; a + 2 < full.length; a++) {
    const res = celik([1 / full[a + 2], 1 / full[a + 1], 1 / full[a]], [f[a + 2], f[a + 1], f[a]]);
    const tri = `${full[a]}/${full[a + 1]}/${full[a + 2]}`;
    log(`      triplet ${tri}: ${res.note ?? `observed p ${res.p.toFixed(2)}, f_ext ${res.fext.toFixed(5)}, GCI(fine) ±${res.gci.toFixed(5)}`}`);
  }
}

// 3. distance to the axisymmetric reference
log('');
log(`3. Difference from the axisymmetric reference (best estimate ${AXI.best.join('–')}, envelope ${AXI.envelope.join('–')})`);
for (const r of series) {
  const m = r.standoff.mid;
  log(`  R/h ${String(r.options.radiusCells).padStart(3)}: 3D mid ${m.toFixed(5)} → ${(m - AXI.best[1]).toFixed(4)} … ${(m - AXI.best[0]).toFixed(4)} R above the best estimate (${(m - AXI.envelope[1]).toFixed(4)} … ${(m - AXI.envelope[0]).toFixed(4)} vs envelope)`);
}
// 4. matched-resolution comparison with the axisymmetric solver. Axisymmetric profiles: docs/axisym-data (R/h 8, 16, 32,
// 64, 128) and docs/sphere3d-refinement/axi-matched (R/h 12, 24, 48, same script and settings). Detectors are recomputed
// here from both kinds of profile with identical code: first 50 % crossing (linear between centres) and the equal-area
// position d = d[last] − h/2 + h·S (S = Σ clamp(φ) up to the first cell with φ ≥ 1), d measured from the sphere surface.
function detectors(rows, h) {
  // rows: [{ d, phi }] ordered from upstream to the wall
  let mid = NaN;
  for (let k = 1; k < rows.length; k++)
    if (rows[k - 1].phi < 0.5 && rows[k].phi >= 0.5) {
      mid = rows[k - 1].d + ((rows[k].d - rows[k - 1].d) * (0.5 - rows[k - 1].phi)) / (rows[k].phi - rows[k - 1].phi);
      break;
    }
  let S = 0;
  let last = 0;
  for (let k = 0; k < rows.length; k++) {
    S += Math.min(Math.max(rows[k].phi, 0), 1);
    last = k;
    if (rows[k].phi >= 1) break;
  }
  return { mid, ea: rows[last].d - h / 2 + h * S };
}
const csvRows = (file) =>
  fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && !/^[a-z]/i.test(l))
    .map((l) => l.split(',').map(Number));
const axi = {};
for (const [sub, Nset] of [[path.join(here, '..', 'docs', 'axisym-data'), [8, 16, 32, 64, 128]], [path.join(dir, 'axi-matched'), [12, 24, 48]]])
  for (const N of Nset) {
    const f = path.join(sub, `axi_rusanov_Rh${N}.csv`);
    if (fs.existsSync(f)) axi[N] = detectors(csvRows(f).map(([d, , phi]) => ({ d, phi })), 1 / N);
  }
log('');
log('4. Matched-resolution comparison, 3D Cartesian (reduced domain, Rusanov, cut cell) minus axisymmetric (Rusanov), same detector code');
log('   R/h | axi 50 %  | 3D 50 % off0 (4-offset mean) | gap off0 (mean) | gap·R/h  || axi EA   | 3D EA off0 (mean)  | gap off0 (mean)');
const gaps = [];
for (const r of series) {
  const N = r.options.radiusCells;
  if (!axi[N]) continue;
  const rows = csvRows(path.join(dir, `${r.name}.csv`)).map(([, , d, , phi]) => ({ d, phi }));
  const c = detectors(rows, 1 / N);
  const m = offStats[N]?.mid.n >= 4 ? offStats[N] : null;
  const gm = c.mid - axi[N].mid;
  const ge = c.ea - axi[N].ea;
  const gmM = m ? m.mid.mean - axi[N].mid : NaN;
  const geM = m ? m.equalArea.mean - axi[N].ea : NaN;
  gaps.push({ N, mid: m ? gmM : gm, ea: m ? geM : ge });
  log(
    `   ${String(N).padStart(3)} | ${axi[N].mid.toFixed(5)}   | ${c.mid.toFixed(5)} (${m ? m.mid.mean.toFixed(5) : '   —   '})          | ${gm.toFixed(5)} (${m ? gmM.toFixed(5) : '   —   '}) | ${(gm * N).toFixed(3)}    || ${axi[N].ea.toFixed(5)}  | ${c.ea.toFixed(5)} (${m ? m.equalArea.mean.toFixed(5) : '   —   '}) | ${ge.toFixed(5)} (${m ? geM.toFixed(5) : '   —   '})`,
  );
}
// least-squares gap = a + b·h over R/h ≥ 12 (4-offset means where available); a descriptive fit, not a convergence proof
for (const key of ['mid', 'ea']) {
  const pts = gaps.filter((g) => g.N >= 12).map((g) => [1 / g.N, g[key]]);
  if (pts.length < 3) continue;
  const n = pts.length;
  const sx = pts.reduce((a, p) => a + p[0], 0);
  const sy = pts.reduce((a, p) => a + p[1], 0);
  const sxx = pts.reduce((a, p) => a + p[0] * p[0], 0);
  const sxy = pts.reduce((a, p) => a + p[0] * p[1], 0);
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const a = (sy - b * sx) / n;
  const res = Math.sqrt(pts.reduce((acc, p) => acc + (p[1] - a - b * p[0]) ** 2, 0) / (n - 2));
  const seA = res * Math.sqrt(sxx / (n * sxx - sx * sx));
  log(`   fit gap(${key}) = a + b·h over R/h ${gaps.filter((g) => g.N >= 12).map((g) => g.N).join(', ')}: a = ${a.toFixed(5)} ± ${seA.toFixed(5)} (1σ), b = ${b.toFixed(4)} R per unit h/R, residual ${res.toExponential(1)}`);
}
console.log(out.join('\n'));
