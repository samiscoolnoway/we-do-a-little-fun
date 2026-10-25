// Analysis of the R/h 48 grid-position study (docs/sphere3d-rh48-offsets: offsets 0.25, 0.5, 0.75) together with the
// archived offset-0 R/h 48 run and the isotropic series (docs/sphere3d-refinement), the R/h 64 run (docs/sphere3d-rh64)
// and the axisymmetric matched-resolution values. Applies the decision rule fixed in docs/sphere3d-uncertainty-audit
// (section 5) before the runs. Plain Node.
//
//   node scripts/rh48-offsets-analysis.mjs            (from euv-simulator/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const docs = path.join(here, '..', 'docs');
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const out = [];
const log = (s = '') => out.push(s);
const KEYS = ['mid', 'maxGradient', 'equalArea'];
const LABEL = { mid: '50 %', maxGradient: 'steepest rise', equalArea: 'equal area' };
const f5 = (v) => (Number.isFinite(v) ? v.toFixed(5) : '   —   ');
const e2 = (v) => (Number.isFinite(v) ? v.toExponential(2) : '—');
const AXI = [0.3485, 0.3508];

// isotropic reduced-domain Rusanov cut-cell runs, 4-order stopping rule (last line per name wins)
const ref = new Map();
const isRef = (r) => r.options.flux === 'rusanov' && r.options.wall === 'cutcell' && r.options.downstream === 0.5 && r.options.lateral === 2 && !r.options.residualDrop;
for (const r of jsonl(path.join(docs, 'sphere3d-refinement', 'summary.jsonl'))) if (isRef(r)) ref.set(r.name, { ...r, src: 'sphere3d-refinement' });
const rh64 = jsonl(path.join(docs, 'sphere3d-rh64', 'summary.jsonl')).at(-1);
if (rh64) ref.set(rh64.name, { ...rh64, src: 'sphere3d-rh64' });
const NEW = path.join(docs, 'sphere3d-rh48-offsets');
const fresh = [];
for (const o of ['0.25', '0.5', '0.75']) {
  const r = jsonl(path.join(NEW, `off${o}`, 'summary.jsonl')).at(-1);
  if (r && isRef(r)) {
    ref.set(r.name, { ...r, src: `sphere3d-rh48-offsets/off${o}` });
    fresh.push(r);
  }
}
const runs = [...ref.values()];
const at = (N, off = 0) => runs.find((r) => r.options.radiusCells === N && (r.options.gridOffset ?? 0) === off);
const offsetsOf = (N) => runs.filter((r) => r.options.radiusCells === N).sort((a, b) => (a.options.gridOffset ?? 0) - (b.options.gridOffset ?? 0));

// detectors recomputed from the stored stagnation-line profiles (same definitions as sphere3d.ts / the harness)
function fromProfile(csvPath) {
  const lines = fs.readFileSync(csvPath, 'utf8').split('\n');
  const meta = JSON.parse(lines.find((l) => l.startsWith('# meta ')).slice(7));
  const rows = lines.filter((l) => l && !l.startsWith('#') && !l.startsWith('i,')).map((l) => l.split(',').map(Number));
  const h = meta.grid.h;
  const xNose = meta.xNose;
  const prof = rows.map(([, x, , rho, phi, alpha]) => ({ x, rho, phi, alpha }));
  const cross = (lv) => {
    for (let i = 1; i < prof.length; i++) if (prof[i - 1].phi < lv && prof[i].phi >= lv) return xNose - (prof[i - 1].x + (h * (lv - prof[i - 1].phi)) / (prof[i].phi - prof[i - 1].phi));
    return NaN;
  };
  const rise = (i) => (i >= 1 && i < prof.length && prof[i].alpha === 1 && prof[i - 1].alpha === 1 ? prof[i].rho - prof[i - 1].rho : -Infinity);
  let k = -1;
  for (let i = 1; i < prof.length; i++) if (rise(i) > -Infinity && (k < 0 || rise(i) > rise(k))) k = i;
  const [dm, d0, dp] = [rise(k - 1), rise(k), rise(k + 1)];
  let o = 0;
  if (Number.isFinite(dm) && Number.isFinite(dp) && dm - 2 * d0 + dp < 0) o = Math.max(-0.5, Math.min(0.5, (0.5 * (dm - dp)) / (dm - 2 * d0 + dp)));
  let S = 0;
  let last = 0;
  for (let i = 0; i < prof.length; i++) {
    S += Math.min(Math.max(prof[i].phi, 0), 1);
    last = i;
    if (prof[i].phi >= 1) break;
  }
  return { meta, mid: cross(0.5), maxGradient: xNose - (0.5 * (prof[k - 1].x + prof[k].x) + o * h), equalArea: xNose - (prof[last].x + 0.5 * h - h * S) };
}

function celik(h, f) {
  const [h1, h2, h3] = h;
  const [f1, f2, f3] = f;
  const r21 = h2 / h1;
  const r32 = h3 / h2;
  const e21 = f2 - f1;
  const e32 = f3 - f2;
  if (e21 * e32 <= 0) return { note: 'oscillatory' };
  let p = Math.log(Math.abs(e32 / e21)) / Math.log(r21);
  for (let it = 0; it < 500; it++) {
    const pn = Math.abs(Math.log(Math.abs(e32 / e21)) + Math.log((r21 ** p - 1) / (r32 ** p - 1))) / Math.log(r21);
    if (!Number.isFinite(pn)) return { note: 'no solution for p' };
    if (Math.abs(pn - p) < 1e-12) {
      p = pn;
      break;
    }
    p = pn;
  }
  return { p, fext: (r21 ** p * f1 - f2) / (r21 ** p - 1), gci: (1.25 * Math.abs(e21)) / (r21 ** p - 1) };
}
const tri = (Ns, val) => celik([1 / Ns[2], 1 / Ns[1], 1 / Ns[0]], [val(Ns[2]), val(Ns[1]), val(Ns[0])]);
const fmtTri = (r) => r.note ?? `p ${r.p.toFixed(2)}  f_ext ${f5(r.fext)}  GCI ±${r.gci.toFixed(5)}`;

// 1. the four R/h 48 positions
log('1. R/h 48, four grid positions (Rusanov, cut cell, reduced domain 2R / 0.5R / 2R, CFL 0.8, 4-order stopping rule)');
log('   offset  source                          steps  conv  drop    imbalance  time (s)   50 %      steepest  equal area  width  symmetry  nose p/pitot');
const r48 = offsetsOf(48);
for (const r of r48)
  log(
    `   ${String(r.options.gridOffset ?? 0).padEnd(6)}  ${r.src.padEnd(30)}  ${String(r.steps).padStart(5)}  ${r.converged ? 'yes ' : 'NO  '}  ${r.dropFront.toFixed(4)}  ${r.massImbalance.toExponential(2)}   ${r.seconds.toFixed(0).padStart(6)}   ` +
      `${f5(r.standoff.mid)}   ${f5(r.standoff.maxGradient)}   ${f5(r.standoff.equalArea)}   ${r.shockWidthCells.toFixed(2)}   ${r.symmetryError.toExponential(1)}   ${r.noseP.toFixed(5)}`,
  );
log(`   configuration identical apart from gridOffset: ${r48.every((r) => JSON.stringify({ ...r.options, gridOffset: 0 }) === JSON.stringify({ ...r48[0].options, gridOffset: 0 }))}`);
log(`   grid identical: ${r48.every((r) => r.grid.nx === r48[0].grid.nx && r.grid.ny === r48[0].grid.ny && r.grid.nz === r48[0].grid.nz && r.grid.h === r48[0].grid.h)} (${r48[0].grid.nx} × ${r48[0].grid.ny} × ${r48[0].grid.nz}); fluid cells ${r48.map((r) => r.grid.fluidCells).join(', ')}`);

log('   detectors recomputed from the stored profiles (|recomputed − stored|, R):');
for (const r of r48) {
  const dir = r.src === 'sphere3d-refinement' ? path.join(docs, 'sphere3d-refinement') : path.join(docs, r.src);
  const p = fromProfile(path.join(dir, `${r.name}.csv`));
  log(`     offset ${r.options.gridOffset ?? 0}: ${KEYS.map((k) => `${LABEL[k]} ${e2(Math.abs(p[k] - r.standoff[k]))}`).join(', ')}`);
}

// 2. statistics over the positions
log('');
log('2. Grid-position statistics (all four positions at R/h 48; R/h 16–32 from the archive for comparison)');
const stats = (N, k) => {
  const v = offsetsOf(N).map((r) => r.standoff[k]);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1));
  return { n: v.length, v, mean, range: Math.max(...v) - Math.min(...v), sd, dev0: at(N).standoff[k] - mean };
};
const S48 = {};
for (const k of KEYS) {
  const s = stats(48, k);
  S48[k] = s;
  log(`   ${LABEL[k].padEnd(13)} R/h 48: values ${s.v.map(f5).join(', ')}`);
  log(`                        mean ${f5(s.mean)}  range ${e2(s.range)}  SD ${e2(s.sd)}  offset 0 − mean ${e2(s.dev0)}  deviations ${s.v.map((x) => e2(x - s.mean)).join(', ')}`);
  log(`                        range in cells ${(s.range * 48).toFixed(4)} h`);
  for (const N of [16, 24, 32]) {
    const t = stats(N, k);
    if (t.n >= 4) log(`                 R/h ${N}: mean ${f5(t.mean)}  range ${e2(t.range)} (${(t.range * N).toFixed(4)} h)  SD ${e2(t.sd)}  offset 0 − mean ${e2(t.dev0)}`);
  }
}

// 3. extrapolation
log('');
log('3. Equal-area extrapolation (R/h 64 has one grid position in every variant)');
const val = (N, k, mode) => {
  const s = stats(N, k);
  if (mode === 'offset0' || s.n < 4) return at(N).standoff[k];
  return s.mean;
};
const TRIS = [[24, 32, 48], [24, 48, 64], [32, 48, 64], [24, 32, 64], [16, 32, 64]];
const ext = {};
for (const k of KEYS) {
  log(`   ${LABEL[k]}:`);
  for (const t of TRIS) {
    const a = tri(t, (N) => val(N, k, 'offset0'));
    const b = tri(t, (N) => val(N, k, 'mean'));
    const c = tri(t, (N) => (N === 48 ? S48[k].mean : val(N, k, 'offset0')));
    ext[`${k}:${t.join('/')}`] = { a, b, c };
    log(`     ${t.join('/').padEnd(9)} offset-0 values: ${fmtTri(a).padEnd(40)} | 4-offset means where available: ${fmtTri(b).padEnd(40)} | mean at 48 only: ${fmtTri(c)}`);
  }
}
log('   R/h 48 value replaced by each individual position (32/48/64 and 24/48/64, equal area; R/h ≤ 32 as 4-offset means):');
for (const t of [[32, 48, 64], [24, 48, 64]]) {
  const fx = offsetsOf(48).map((r) => ({ off: r.options.gridOffset ?? 0, res: tri(t, (N) => (N === 48 ? r.standoff.equalArea : val(N, 'equalArea', 'mean'))) }));
  const ok = fx.filter((x) => !x.res.note);
  const fs_ = ok.map((x) => x.res.fext);
  log(`     ${t.join('/')}: ${fx.map((x) => `off ${x.off}: ${x.res.note ?? `p ${x.res.p.toFixed(2)} f_ext ${f5(x.res.fext)}`}`).join(' | ')}${ok.length > 1 ? `  → spread ${e2(Math.max(...fs_) - Math.min(...fs_))}` : ''}`);
}

// 4. decision rule (fixed in the audit before the runs)
log('');
log('4. Decision rule (docs/sphere3d-uncertainty-audit/README.md, section 5, fixed before the runs)');
const R = S48.equalArea.range;
const D0 = Math.abs(S48.equalArea.dev0);
log(`   equal-area 4-offset range ${R.toExponential(3)} (limit 4e-4: ${R <= 4e-4 ? '≤' : '>'}), |offset 0 − mean| ${D0.toExponential(3)} (stop limit 1e-4: ${D0 <= 1e-4 ? '≤' : '>'}; escalate limit 2e-4: ${D0 > 2e-4 ? '>' : '≤'})`);
let verdict;
if (S48.equalArea.n < 4) verdict = `NOT EVALUATED: ${S48.equalArea.n} of 4 R/h 48 positions available`;
else if (R <= 4e-4 && D0 <= 1e-4) verdict = 'STOP: range ≤ 4e-4 and offset 0 within 1e-4 of the mean → report f_ext from the mean-based triplet; no R/h 64 position run';
else if (R > 4e-4 || D0 > 2e-4) verdict = 'ESCALATE: range > 4e-4 or offset 0 more than 2e-4 from the mean → position-dominated; quote with the position term; an R/h 64 position study becomes justified (needs approval)';
else verdict = 'IN BETWEEN: neither condition holds → report both triplets (offset-0 and mean-based) and treat their difference as the position term';
log(`   → ${verdict}`);

// 5. axisymmetric comparison at matched R/h
log('');
log(`5. Against the axisymmetric solver at the same R/h (band ${AXI[0]}–${AXI[1]} R)`);
const axi = [...jsonl(path.join(docs, 'sphere-gap-study', 'axi-aspect', 'summary.jsonl')), ...jsonl(path.join(docs, 'axi-reference-refinement', 'runs', 'summary.jsonl'))].filter((r) => r.options.aspect === 1 && !r.options.residualDrop);
for (const N of [32, 48, 64]) {
  const a = axi.find((x) => x.options.radiusCells === N);
  if (!a) continue;
  const m = stats(N, 'mid');
  const e = stats(N, 'equalArea');
  log(`   R/h ${N}: 3D offset 0 ${f5(at(N).standoff.mid)} / ${f5(at(N).standoff.equalArea)}${m.n >= 4 ? `, 4-offset mean ${f5(m.mean)} / ${f5(e.mean)}` : ''}; axisymmetric ${f5(a.standoff.mid)} / ${f5(a.standoff.equalArea)} → gap (offset 0) ${(at(N).standoff.mid - a.standoff.mid).toFixed(5)} / ${(at(N).standoff.equalArea - a.standoff.equalArea).toFixed(5)}${m.n >= 4 ? `, gap (mean) ${(m.mean - a.standoff.mid).toFixed(5)} / ${(e.mean - a.standoff.equalArea).toFixed(5)}` : ''}`);
}
log(`   new runs found: ${fresh.length} of 3`);
console.log(out.join('\n'));
