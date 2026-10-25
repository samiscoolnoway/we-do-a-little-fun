// Analysis of the checkpointed isotropic 3D R/h 64 run (docs/sphere3d-rh64) together with the existing isotropic
// refinement series (docs/sphere3d-refinement, reduced domain, Rusanov, cut cell) and the axisymmetric reference
// (docs/axi-reference-refinement, docs/sphere-gap-study/axi-aspect). Plain Node.
//
//   node scripts/rh64-analysis.mjs            (from euv-simulator/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const docs = path.join(here, '..', 'docs');
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const out = [];
const log = (s = '') => out.push(s);
const KEYS = ['mid', 'maxGradient', 'equalArea'];
const f5 = (v) => (Number.isFinite(v) ? v.toFixed(5) : '   —   ');
const AXI = [0.3485, 0.3508];

// isotropic reduced-domain Rusanov cut-cell runs (last line per configuration wins)
const ref = new Map();
for (const r of jsonl(path.join(docs, 'sphere3d-refinement', 'summary.jsonl')))
  if (r.options.flux === 'rusanov' && r.options.wall === 'cutcell' && r.options.downstream === 0.5 && r.options.lateral === 2 && !r.options.residualDrop) ref.set(r.name, r);
const rh64 = jsonl(path.join(docs, 'sphere3d-rh64', 'summary.jsonl')).at(-1);
if (rh64) ref.set(rh64.name, { ...rh64, src: 'rh64' });
const runs = [...ref.values()];
const Ns = [...new Set(runs.map((r) => r.options.radiusCells))].sort((a, b) => a - b);
const at = (N, off = 0) => runs.find((r) => r.options.radiusCells === N && (r.options.gridOffset ?? 0) === off);

log('1. Isotropic 3D series (reduced domain 2R / 0.5R / 2R, Rusanov, cut cell, CFL 0.8, 4-order stopping rule)');
log('   R/h  cells      steps  conv  drop  imbalance  time (s)   offset 0: 50 %   steepest   equal area | 4-offset mean 50 % (range)   equal area (range) | width  sym      body  nose p/pitot p0/pitot T/T0');
const mean = {};
for (const N of Ns) {
  const r = at(N);
  const offs = runs.filter((x) => x.options.radiusCells === N);
  const m = {};
  for (const k of KEYS) {
    const v = offs.map((x) => x.standoff[k]);
    m[k] = { mean: v.reduce((a, b) => a + b, 0) / v.length, range: Math.max(...v) - Math.min(...v), n: v.length };
  }
  mean[N] = m;
  log(
    `   ${String(N).padStart(3)}  ${String(r.grid.cells).padStart(9)} ${String(r.steps).padStart(6)}  ${r.converged ? 'yes' : 'NO '}  ${r.dropFront.toFixed(2)}  ${r.massImbalance.toExponential(1)}   ${r.seconds.toFixed(0).padStart(7)}   ` +
      `${f5(r.standoff.mid)} ${f5(r.standoff.maxGradient)} ${f5(r.standoff.equalArea)} | ${m.mid.n >= 4 ? `${f5(m.mid.mean)} (${m.mid.range.toFixed(5)})` : `(${m.mid.n} offset)            `}   ${m.equalArea.n >= 4 ? `${f5(m.equalArea.mean)} (${m.equalArea.range.toFixed(5)})` : ''} | ` +
      `${r.shockWidthCells.toFixed(2)}  ${r.symmetryError.toExponential(0)}  ${r.bodyFluxFraction}  ${r.noseP.toFixed(4)} ${r.nose.p0Ratio.toFixed(4)} ${r.noseT.toFixed(4)}${r.src ? '   ← this study' : ''}`,
  );
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

log('');
log('2. Refinement trend (offset-0 values; the R/h ≥ 48 points have one grid position only)');
for (const k of KEYS) {
  const c = Ns.filter((N) => N >= 12).map((N) => [N, at(N).standoff[k]]);
  log(`   ${k}: ${c.map(([N, v]) => `${N}: ${f5(v)}`).join(', ')}`);
  log(`     local slope Δf/Δh: ${c.slice(1).map(([N, v], i) => `${c[i][0]}→${N} ${((c[i][1] - v) / (1 / c[i][0] - 1 / N)).toFixed(3)}`).join(', ')}`);
  const tri = [];
  const fine = c.filter(([N]) => N >= 16);
  for (let i = 0; i < fine.length; i++)
    for (let j = i + 1; j < fine.length; j++)
      for (let l = j + 1; l < fine.length; l++) {
        const [A, B, C] = [fine[i], fine[j], fine[l]];
        const res = celik([1 / C[0], 1 / B[0], 1 / A[0]], [C[1], B[1], A[1]]);
        tri.push(`${A[0]}/${B[0]}/${C[0]} ${res.note ?? `p ${res.p.toFixed(2)} f_ext ${res.fext.toFixed(5)} GCI ±${res.gci.toFixed(5)}`}`);
      }
  log(`     Celik triplets (R/h ≥ 16): ${tri.join(' | ')}`);
  const [x, y] = c.slice(-2);
  const two = (p) => y[1] - (x[1] - y[1]) / ((y[0] / x[0]) ** p - 1);
  log(`     two finest (${x[0]}, ${y[0]}) with an assumed order: p = 1 → ${two(1).toFixed(5)}, p = 0.85 → ${two(0.85).toFixed(5)}, p = 0.64 → ${two(0.64).toFixed(5)}, p = 2 → ${two(2).toFixed(5)}`);
}
log('   Using 4-offset means where available (R/h ≤ 32) and the single values at 48 and 64:');
for (const k of ['mid', 'equalArea']) {
  const c = [16, 24, 32, 48, 64].filter((N) => at(N)).map((N) => [N, mean[N][k].n >= 4 ? mean[N][k].mean : at(N).standoff[k]]);
  log(`     ${k}: ${c.map(([N, v]) => `${N}: ${f5(v)}`).join(', ')}; local slopes ${c.slice(1).map(([N, v], i) => `${c[i][0]}→${N} ${((c[i][1] - v) / (1 / c[i][0] - 1 / N)).toFixed(3)}`).join(', ')}`);
  for (const tri of [[16, 32, 64], [24, 32, 64], [24, 48, 64], [32, 48, 64]]) {
    const v = tri.map((N) => c.find(([M]) => M === N)?.[1]);
    if (v.some((x) => x === undefined)) continue;
    const res = celik([1 / tri[2], 1 / tri[1], 1 / tri[0]], [v[2], v[1], v[0]]);
    log(`       ${tri.join('/')}: ${res.note ?? `p ${res.p.toFixed(2)} f_ext ${res.fext.toFixed(5)} GCI ±${res.gci.toFixed(5)}`}`);
  }
}

// axisymmetric values at matched R/h
log('');
log(`3. Against the axisymmetric reference (engineering band ${AXI[0]}–${AXI[1]} R) and the axisymmetric solver at the same R/h`);
const axi = [...jsonl(path.join(docs, 'sphere-gap-study', 'axi-aspect', 'summary.jsonl')), ...jsonl(path.join(docs, 'axi-reference-refinement', 'runs', 'summary.jsonl'))].filter((r) => r.options.aspect === 1 && !r.options.residualDrop);
for (const N of [16, 24, 32, 48, 64].filter((M) => at(M))) {
  const r = at(N);
  const a = axi.find((x) => x.options.radiusCells === N);
  log(
    `   R/h ${String(N).padStart(2)}: 3D 50 % ${f5(r.standoff.mid)} (above band top by ${(r.standoff.mid - AXI[1]).toFixed(5)}), equal area ${f5(r.standoff.equalArea)} (by ${(r.standoff.equalArea - AXI[1]).toFixed(5)})` +
      (a ? `; axisymmetric R/h ${N}: ${f5(a.standoff.mid)} / ${f5(a.standoff.equalArea)} → gap ${(r.standoff.mid - a.standoff.mid).toFixed(5)} / ${(r.standoff.equalArea - a.standoff.equalArea).toFixed(5)}, gap·N ${((r.standoff.mid - a.standoff.mid) * N).toFixed(3)}` : ''),
  );
}

// predictions recorded before the result
log('');
log('4. Predictions recorded before the result (docs/sphere3d-rh64/PREDICTION.md) against the measurement');
if (rh64) {
  const pred = { mid: [['3D model, linear', 0.35691], ['3D model, p = 0.85', 0.35697], ['constant last slope', 0.3566], ['rising slope', 0.3564]], equalArea: [['3D model, linear', 0.35736], ['3D model, p = 0.85', 0.35732], ['constant last slope', 0.35706], ['rising slope', 0.3568]] };
  for (const k of ['mid', 'equalArea']) log(`   ${k}: measured ${f5(rh64.standoff[k])}; ${pred[k].map(([n, v]) => `${n} ${v.toFixed(5)} (Δ ${(rh64.standoff[k] - v).toFixed(5)})`).join(', ')}`);
}
console.log(out.join('\n'));
