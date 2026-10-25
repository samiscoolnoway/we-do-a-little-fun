// Analysis of the high-resolution axisymmetric reference study (docs/axi-reference-refinement). Plain Node.
//
//   node scripts/axi-refine-analysis.mjs            (from euv-simulator/)
//
// Combines the new runs (docs/axi-reference-refinement/runs, …/phase) with the existing axisymmetric data of the gap
// study (docs/sphere-gap-study/axi-aspect, axi-phase, axi-iteration). Every run used the unchanged sphereAxi.ts case
// (Rusanov, outer radius 5R, θ ≤ 95°, CFL 0.4, 4-order stopping criterion unless stated) through
// scripts/gap-axi-measure.test.ts; detector values are the solver's own.
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

const sources = {
  'gap-study matrix': jsonl(path.join(docs, 'sphere-gap-study', 'axi-aspect', 'summary.jsonl')),
  'gap-study phase': jsonl(path.join(docs, 'sphere-gap-study', 'axi-phase', 'summary.jsonl')),
  'this study': jsonl(path.join(docs, 'axi-reference-refinement', 'runs', 'summary.jsonl')),
  'this study, phase': jsonl(path.join(docs, 'axi-reference-refinement', 'phase', 'summary.jsonl')),
};
const iter = [...jsonl(path.join(docs, 'sphere-gap-study', 'axi-iteration', 'summary.jsonl')), ...jsonl(path.join(docs, 'axi-reference-refinement', 'iteration', 'summary.jsonl'))];
// standard-criterion runs, one per (N, aspect); later sources win (none overlap in practice)
const runs = new Map();
for (const [src, rs] of Object.entries(sources)) for (const r of rs) if (!r.options.residualDrop) runs.set(`${r.options.radiusCells}:${r.options.aspect}`, { ...r, src });
const get = (N, a) => runs.get(`${N}:${a}`);
const col = (a) => [...runs.values()].filter((r) => r.options.aspect === a).sort((p, q) => p.options.radiusCells - q.options.radiusCells);
const BASE = (a) => col(a).filter((r) => [16, 24, 32, 48, 64, 96, 128, 192, 256].includes(r.options.radiusCells));

// ── 1. run table for the two aspect columns ──
log('1. Axisymmetric reference columns (aspect = tangential/radial spacing at the wall; ×1.35 at the shock on the axis)');
log('   aspect R/h   grid        cells   steps   drop  imbalance  time (s)  h_r       h_t wall  h_t shock  50 %     steepest equal area width  nose p0/pitot  wall max|T0 err|  source');
for (const a of [1, 2])
  for (const r of BASE(a)) {
    const g = r.grid;
    log(
      `   ${String(a).padEnd(6)} ${String(r.options.radiusCells).padStart(4)}  ${`${g.ni}×${g.nj}`.padEnd(10)} ${String(g.cells).padStart(7)} ${String(r.steps).padStart(6)}  ${r.dropFront.toFixed(2)}  ${r.massImbalance.toExponential(1)}    ${r.seconds.toFixed(0).padStart(6)}  ${g.hRadial.toExponential(3)} ${g.tangentialAtWall.toExponential(3)} ${g.tangentialAtShock.toExponential(3)}  ` +
        `${KEYS.map((k) => f5(r.standoff[k])).join(' ')}  ${r.shockWidthCells.toFixed(2)}  ${r.nose.p0Ratio.toFixed(5)}      ${(r.wall.T0MaxError * 100).toFixed(2)} %   ${r.src}${r.converged ? '' : '  NOT CONVERGED'}`,
    );
  }
log('   Conservation: body mass flux ' + Math.max(...[...runs.values()].map((r) => Math.abs(r.bodyFluxFraction))).toExponential(1) + ' (max over all runs, exactly closed wall faces); net boundary mass flux ≤ the 1e-3 stopping tolerance;');
log('   energy: the case has no boundary energy-flux bookkeeping, so energy is checked through total-enthalpy preservation (wall max |T0/T0∞ − 1| above, nose T/T0).');

// ── 2. local slopes and extrapolations along each column ──
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
  const fext = (r21 ** p * f1 - f2) / (r21 ** p - 1);
  const gci = (1.25 * Math.abs(e21)) / (r21 ** p - 1);
  return { p, fext, gci };
}
log('');
log('2. Refinement along each column');
for (const a of [1, 2]) {
  const c = BASE(a);
  log(`   aspect ${a}:`);
  for (const k of KEYS) {
    log(`     ${k}: ${c.map((r) => `${r.options.radiusCells}: ${f5(r.standoff[k])}`).join(', ')}`);
    log(`       local slope Δf/Δh: ${c.slice(1).map((r, i) => `${c[i].options.radiusCells}→${r.options.radiusCells} ${((c[i].standoff[k] - r.standoff[k]) / (1 / c[i].options.radiusCells - 1 / r.options.radiusCells)).toFixed(3)}`).join(', ')}`);
    const fine = c.filter((r) => r.options.radiusCells >= 48);
    const tri = [];
    for (let i = 0; i < fine.length; i++)
      for (let j = i + 1; j < fine.length; j++)
        for (let l = j + 1; l < fine.length; l++) {
          const [A, B, C] = [fine[i], fine[j], fine[l]];
          const res = celik([1 / C.options.radiusCells, 1 / B.options.radiusCells, 1 / A.options.radiusCells], [C.standoff[k], B.standoff[k], A.standoff[k]]);
          tri.push({ t: `${A.options.radiusCells}/${B.options.radiusCells}/${C.options.radiusCells}`, ...res });
        }
    log(`       Celik triplets (R/h ≥ 48): ${tri.map((t) => `${t.t} ${t.note ?? `p ${t.p.toFixed(2)} f_ext ${t.fext.toFixed(5)} GCI ±${t.gci.toFixed(5)}`}`).join(' | ')}`);
    const ok = tri.filter((t) => !t.note && t.p > 0.3 && t.p < 3);
    if (ok.length) log(`       triplets with 0.3 < p < 3: f_ext ${Math.min(...ok.map((t) => t.fext)).toFixed(5)} … ${Math.max(...ok.map((t) => t.fext)).toFixed(5)} (${ok.length} of ${tri.length})`);
    const pf = (p) => {
      const [x, y] = c.slice(-2);
      const r = x.options.radiusCells ** -1 / y.options.radiusCells ** -1;
      return y.standoff[k] - (x.standoff[k] - y.standoff[k]) / (r ** p - 1);
    };
    log(`       two finest (${c.at(-2).options.radiusCells}, ${c.at(-1).options.radiusCells}) with assumed order: p = 1 → ${pf(1).toFixed(5)}, p = 0.85 → ${pf(0.85).toFixed(5)}, p = 2 → ${pf(2).toFixed(5)}`);
  }
}

// ── 3. grid-phase noise ──
log('');
log('3. Grid-phase noise (R/h varied by a few per cent at fixed aspect; the trend over that range is removed with a slope of 0.3 R per unit h,');
log('   an upper estimate of the local slope, so the residual range is the phase effect plus at most a few 1e-5 of trend error)');
const phaseGroups = [];
for (const a of [1, 2])
  for (const N0 of [32, 64, 128, 192, 256]) {
    const g = [...runs.values()].filter((r) => r.options.aspect === a && r.options.radiusCells >= N0 && r.options.radiusCells <= N0 * 1.13);
    if (g.length < 3) continue;
    g.sort((p, q) => p.options.radiusCells - q.options.radiusCells);
    const st = {};
    for (const k of KEYS) {
      const v = g.map((r) => r.standoff[k] - 0.3 * (1 / r.options.radiusCells - 1 / N0));
      const mean = v.reduce((s, x) => s + x, 0) / v.length;
      st[k] = { v, mean, range: Math.max(...v) - Math.min(...v), sd: Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (v.length - 1)) };
    }
    phaseGroups.push({ a, N0, g, st });
    log(`   aspect ${a}, R/h ${g.map((r) => r.options.radiusCells).join(', ')} (referred to ${N0}):`);
    for (const k of KEYS) log(`     ${k.padEnd(11)} ${st[k].v.map((x) => x.toFixed(5)).join('/')} → mean ${st[k].mean.toFixed(5)}, range ${st[k].range.toFixed(5)}, s.d. ${st[k].sd.toFixed(5)}; base-grid value − mean ${(st[k].v[0] - st[k].mean).toFixed(5)}`);
  }

// ── 4. phase-averaged extrapolation ──
log('');
log('4. Extrapolation of the phase-averaged values (where a phase group exists; otherwise the single value), aspect by aspect');
for (const a of [1, 2]) {
  const pts = [];
  for (const N of [32, 64, 128, 192, 256]) {
    const pg = phaseGroups.find((q) => q.a === a && q.N0 === N);
    const r = get(N, a);
    if (pg) pts.push({ N, st: Object.fromEntries(KEYS.map((k) => [k, pg.st[k].mean])), phase: true, sd: Object.fromEntries(KEYS.map((k) => [k, pg.st[k].sd])) });
    else if (r) pts.push({ N, st: r.standoff, phase: false });
  }
  log(`   aspect ${a}: ${pts.map((p) => `${p.N}${p.phase ? ' (phase mean)' : ''}`).join(', ')}`);
  for (const k of KEYS) {
    const parts = [];
    for (let i = 0; i + 2 < pts.length; i++)
      for (let j = i + 1; j + 1 < pts.length; j++)
        for (let l = j + 1; l < pts.length; l++) {
          const [A, B, C] = [pts[i], pts[j], pts[l]];
          const res = celik([1 / C.N, 1 / B.N, 1 / A.N], [C.st[k], B.st[k], A.st[k]]);
          parts.push(`${A.N}/${B.N}/${C.N}: ${res.note ?? `p ${res.p.toFixed(2)} f_ext ${res.fext.toFixed(5)}`}`);
        }
    log(`     ${k.padEnd(11)} ${pts.map((p) => f5(p.st[k])).join(', ')}   ${parts.join(' | ')}`);
  }
}

// ── 5. iteration error ──
log('');
log('5. Iteration error (6-order instead of 4-order stopping criterion):');
for (const r of iter) {
  const ref = get(r.options.radiusCells, r.options.aspect);
  if (!ref) continue;
  log(`   R/h ${r.options.radiusCells} aspect ${r.options.aspect}: steps ${ref.steps} → ${r.steps}; ${KEYS.map((k) => `${k} ${(r.standoff[k] - ref.standoff[k]).toExponential(1)}`).join(', ')}`);
}

{
  // the same refinement steps evaluated with the 6-order values where both ends have one
  const deep = iter.filter((r) => r.options.aspect === 2).sort((a, b) => a.options.radiusCells - b.options.radiusCells);
  if (deep.length >= 2) {
    log('   Aspect 2 with the 6-order values only:');
    for (const k of KEYS) {
      log(
        `     ${k.padEnd(11)} ${deep.map((r) => `${r.options.radiusCells}: ${f5(r.standoff[k])}`).join(', ')}; local slope ${deep
          .slice(1)
          .map((r, i) => `${deep[i].options.radiusCells}→${r.options.radiusCells} ${((deep[i].standoff[k] - r.standoff[k]) / (1 / deep[i].options.radiusCells - 1 / r.options.radiusCells)).toFixed(3)}`)
          .join(', ')}`,
      );
      if (deep.length >= 3) {
        const [A, B, C] = deep.slice(-3);
        const res = celik([1 / C.options.radiusCells, 1 / B.options.radiusCells, 1 / A.options.radiusCells], [C.standoff[k], B.standoff[k], A.standoff[k]]);
        const [x, y] = deep.slice(-2);
        const p1 = y.standoff[k] - (x.standoff[k] - y.standoff[k]) / (x.options.radiusCells ** -1 / y.options.radiusCells ** -1 - 1);
        log(`       ${A.options.radiusCells}/${B.options.radiusCells}/${C.options.radiusCells}: ${res.note ?? `p ${res.p.toFixed(2)} f_ext ${res.fext.toFixed(5)} GCI ±${res.gci.toFixed(5)}`}; p = 1 from ${x.options.radiusCells}/${y.options.radiusCells}: ${p1.toFixed(5)}`);
      }
    }
  }
}

// ── 6. 2D error-model fits over the whole matrix, now with the finer grids ──
function lsq(X, y) {
  const m = X[0].length;
  const A = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0)));
  const b = Array.from({ length: m }, (_, i) => X.reduce((s, r, k) => s + r[i] * y[k], 0));
  const M = A.map((r, i) => [...r, ...Array.from({ length: m }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < m; c++) {
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    for (let j = 0; j < 2 * m; j++) M[c][j] /= d;
    for (let r = 0; r < m; r++)
      if (r !== c) {
        const f = M[r][c];
        for (let j = 0; j < 2 * m; j++) M[r][j] -= f * M[c][j];
      }
  }
  const inv = M.map((r) => r.slice(m));
  const coef = inv.map((r) => r.reduce((s, v, j) => s + v * b[j], 0));
  const res = y.map((v, k) => v - X[k].reduce((s, x, j) => s + x * coef[j], 0));
  const s2 = res.reduce((s, r) => s + r * r, 0) / Math.max(1, y.length - m);
  return { coef, se: inv.map((r, i) => Math.sqrt(s2 * r[i])), rms: Math.sqrt(res.reduce((s, r) => s + r * r, 0) / y.length), n: y.length };
}
log('');
log('6. Two-dimensional error-model fits f = f0 + terms in h_r and h_t (all standard-criterion runs, phase runs included as individual points)');
const models = {
  'linear       f0 + a·h_r + b·h_t': (r, t) => [1, r, t],
  'quadratic    + c·h_r² + d·h_t²': (r, t) => [1, r, t, r * r, t * t],
  'p = 0.85     f0 + a·h_r^.85 + b·h_t^.85': (r, t) => [1, r ** 0.85, t ** 0.85],
};
const fitSummary = {};
for (const k of KEYS) {
  log(`   ${k}:`);
  for (const [label, minN] of [['R/h ≥ 48', 48], ['R/h ≥ 64', 64], ['R/h ≥ 96', 96]]) {
    const d = [...runs.values()].filter((r) => r.options.radiusCells >= minN && r.options.aspect <= 2 && r.converged);
    const hr = new Set(d.map((r) => r.options.radiusCells)).size;
    const ht = new Set(d.map((r) => r.options.aspect / r.options.radiusCells)).size;
    for (const [mname, fn] of Object.entries(models)) {
      const nTerms = fn(1, 1).length;
      if (d.length <= nTerms + 1 || hr < (nTerms > 3 ? 3 : 2) || ht < (nTerms > 3 ? 3 : 2)) continue;
      const f = lsq(d.map((r) => fn(1 / r.options.radiusCells, r.options.aspect / r.options.radiusCells)), d.map((r) => r.standoff[k]));
      (fitSummary[k] ??= []).push(f.coef[0]);
      log(`     [${label}] ${mname.padEnd(40)} f0 ${f.coef[0].toFixed(5)} ±${f.se[0].toFixed(5)}  rms ${f.rms.toExponential(1)}  n ${f.n}`);
    }
  }
}
log('   f0 spread over model forms and subsets: ' + KEYS.map((k) => `${k} ${Math.min(...fitSummary[k]).toFixed(5)} … ${Math.max(...fitSummary[k]).toFixed(5)}`).join('; '));

// ── 7. consolidated view: the estimates side by side, each with its assumption ──
log('');
log('7. Limit estimates by method (each line states its assumption; no single number is the result)');
for (const k of KEYS) {
  const lines = [];
  for (const a of [1, 2]) {
    const c = BASE(a).filter((r) => r.options.radiusCells >= 64);
    const tri = [];
    for (let i = 0; i < c.length; i++)
      for (let j = i + 1; j < c.length; j++)
        for (let l = j + 1; l < c.length; l++) {
          const res = celik([1 / c[l].options.radiusCells, 1 / c[j].options.radiusCells, 1 / c[i].options.radiusCells], [c[l].standoff[k], c[j].standoff[k], c[i].standoff[k]]);
          if (!res.note && res.p > 0.5 && res.p < 2) tri.push(res.fext);
        }
    if (tri.length) lines.push(`aspect ${a}: Celik triplets of R/h ≥ 64 with 0.5 < p < 2 (assumes the observed order is asymptotic): ${Math.min(...tri).toFixed(5)} … ${Math.max(...tri).toFixed(5)} (${tri.length})`);
    const [x, y] = BASE(a).slice(-2);
    const p1 = y.standoff[k] - (x.standoff[k] - y.standoff[k]) / (x.options.radiusCells ** -1 / y.options.radiusCells ** -1 - 1);
    lines.push(`aspect ${a}: first order from the finest pair ${x.options.radiusCells}/${y.options.radiusCells} (assumes p = 1): ${p1.toFixed(5)}`);
  }
  log(`   ${k}:`);
  for (const l of lines) log(`     ${l}`);
}
log('   Iteration error: every value above is a 4-order run; a 6-order run raises the standoff by +1.0e-4 … +1.4e-4 R (R/h 64, 96, 128),');
log('   so converged-limit estimates should be read as ≈ 1e-4 R low (not applied to the numbers above).');

console.log(out.join('\n'));
