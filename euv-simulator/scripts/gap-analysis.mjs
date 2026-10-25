// Analysis of the 3D–axisymmetric standoff gap study (docs/sphere-gap-study). Plain Node.
//
//   node scripts/gap-analysis.mjs            (from euv-simulator/)
//
// Inputs: docs/sphere-gap-study/axi-aspect/summary.jsonl (axisymmetric, radial R/h × tangential aspect),
// docs/sphere-gap-study/3d-aniso/summary.jsonl (3D, R/hx × R/hyz, several grid offsets), and the isotropic 3D runs of
// docs/sphere3d-refinement/summary.jsonl (reduced domain, Rusanov, cut cell), which are the hx = hyz members of the
// same 3D family. All detectors are the solvers' own values as stored in the summaries.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const docs = path.join(here, '..', 'docs');
const jsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const out = [];
const log = (s = '') => out.push(s);
const KEYS = ['mid', 'maxGradient', 'equalArea'];
const f5 = (v) => (Number.isFinite(v) ? v.toFixed(5) : '   —   ');

// ── least squares y = X·c with standard errors ──
function lsq(X, y) {
  const n = X.length;
  const m = X[0].length;
  const A = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0)));
  const b = Array.from({ length: m }, (_, i) => X.reduce((s, r, k) => s + r[i] * y[k], 0));
  // invert A (Gauss–Jordan)
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
  const dof = Math.max(1, n - m);
  const s2 = res.reduce((s, r) => s + r * r, 0) / dof;
  return { coef, se: inv.map((r, i) => Math.sqrt(s2 * r[i])), rms: Math.sqrt(res.reduce((s, r) => s + r * r, 0) / n), n, maxRes: Math.max(...res.map(Math.abs)) };
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
  for (let it = 0; it < 200; it++) {
    const pn = Math.abs(Math.log(Math.abs(e32 / e21)) + Math.log((r21 ** p - 1) / (r32 ** p - 1))) / Math.log(r21);
    if (!Number.isFinite(pn)) return { note: 'no solution for p' };
    if (Math.abs(pn - p) < 1e-10) {
      p = pn;
      break;
    }
    p = pn;
  }
  return { p, fext: (r21 ** p * f1 - f2) / (r21 ** p - 1), gci: (1.25 * Math.abs(e21)) / (r21 ** p - 1) };
}

// ── 1. axisymmetric matrix ──
const axi = jsonl(path.join(docs, 'sphere-gap-study', 'axi-aspect', 'summary.jsonl'));
const AS = [...new Set(axi.map((r) => r.options.aspect))].sort((a, b) => a - b);
const NS = [...new Set(axi.map((r) => r.options.radiusCells))].sort((a, b) => a - b);
const ax = (N, a) => axi.find((r) => r.options.radiusCells === N && r.options.aspect === a);
log('1. Axisymmetric solver, radial R/h × tangential aspect (aspect = tangential/radial spacing at the wall; at the shock on the axis the ratio is ≈ 1.35 × aspect)');
log(`   ${axi.length} runs, all converged: ${axi.every((r) => r.converged)}; max |body mass flux| ${Math.max(...axi.map((r) => Math.abs(r.bodyFluxFraction))).toExponential(1)}; reconstruction fallbacks ${Math.max(...axi.map((r) => r.reconstructionFallbacks))}; outer-ring deviation ≤ ${Math.max(...axi.map((r) => r.outerRingDeviation)).toExponential(1)}; outflow normal Mach ≥ ${Math.min(...axi.map((r) => r.outflowMinNormalMach)).toFixed(2)}`);
for (const k of KEYS) {
  log(`   ${k}:   R/h \\ aspect ${AS.map((a) => String(a).padStart(7)).join(' ')}`);
  for (const N of NS) log(`        ${String(N).padStart(14)} ${AS.map((a) => f5(ax(N, a)?.standoff[k])).join(' ')}`);
}
log('   Extrapolation along each aspect column (Celik; constant aspect = both spacings refined together):');
for (const k of KEYS)
  for (const a of AS) {
    const parts = [];
    for (const tri of [[16, 32, 64], [24, 32, 48], [32, 48, 64], [32, 64, 128], [48, 64, 96], [64, 96, 128]]) {
      const v = tri.map((N) => ax(N, a)?.standoff[k]);
      if (v.some((x) => x === undefined)) continue;
      const c = celik([1 / tri[2], 1 / tri[1], 1 / tri[0]], [v[2], v[1], v[0]]);
      parts.push(`${tri.join('/')}: ${c.note ?? `p ${c.p.toFixed(2)} f_ext ${c.fext.toFixed(5)} GCI ±${c.gci.toFixed(5)}`}`);
    }
    log(`     ${k.padEnd(11)} aspect ${String(a).padEnd(4)} ${parts.join(' | ')}`);
  }

log('   Local slope of the 50 % standoff per unit h along each aspect column (Δf/Δh between neighbouring R/h; constant if first order):');
for (const a of AS) {
  const col = NS.map((N) => ax(N, a)).filter(Boolean);
  log(`     aspect ${String(a).padEnd(4)} ${col.slice(1).map((r, i) => `${col[i].options.radiusCells}→${r.options.radiusCells} ${((col[i].standoff.mid - r.standoff.mid) / (1 / col[i].options.radiusCells - 1 / r.options.radiusCells)).toFixed(3)}`).join(', ')}`);
}

// ── 1b. axisymmetric grid-phase scatter: R/h varied by a few per cent around 32 and 64 (aspect 1) ──
{
  const ph = jsonl(path.join(docs, 'sphere-gap-study', 'axi-phase', 'summary.jsonl'));
  log('   Grid-phase scatter of the axisymmetric detectors (aspect 1, R/h varied by up to 6 % so that the shock sits at a');
  log('   different place within its cell; the grid trend over that range, ≈ 0.25·Δh ≤ 2e-4, is removed with slope 0.25):');
  for (const N0 of [32, 64]) {
    const g = [ax(N0, 1), ...ph.filter((r) => r.options.radiusCells > N0 && r.options.radiusCells <= N0 + 4)].filter(Boolean);
    const parts = KEYS.map((k) => {
      const v = g.map((r) => r.standoff[k] - 0.25 * (1 / r.options.radiusCells - 1 / N0));
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      return `${k} ${v.map((x) => x.toFixed(5)).join('/')} → mean ${mean.toFixed(5)}, range ${(Math.max(...v) - Math.min(...v)).toFixed(5)}`;
    });
    log(`     R/h ${g.map((r) => r.options.radiusCells).join(', ')} (referred to R/h ${N0}):`);
    for (const t of parts) log(`       ${t}`);
  }
}

// ── 2. 3D family R/hx × R/hyz ──
const ani = jsonl(path.join(docs, 'sphere-gap-study', '3d-aniso', 'summary.jsonl'));
const iso = jsonl(path.join(docs, 'sphere3d-refinement', 'summary.jsonl')).filter(
  (r) => r.options.flux === 'rusanov' && r.options.wall === 'cutcell' && r.options.downstream === 0.5 && r.options.lateral === 2,
);
const runs3 = new Map(); // key Nx:Nyz:offset → run (last wins)
for (const r of iso) runs3.set(`${r.options.radiusCells}:${r.options.radiusCells}:${r.options.gridOffset ?? 0}`, { Nx: r.options.radiusCells, Nyz: r.options.radiusCells, off: r.options.gridOffset ?? 0, standoff: r.standoff, converged: r.converged, steps: r.steps, seconds: r.seconds, cells: r.grid.cells, sym: r.symmetryError, body: r.bodyFluxFraction, width: r.shockWidthCells, src: 'refinement' });
for (const r of ani) runs3.set(`${r.options.Nx}:${r.options.Nyz}:${r.options.gridOffset}`, { Nx: r.options.Nx, Nyz: r.options.Nyz, off: r.options.gridOffset, standoff: r.standoff, converged: r.converged, steps: r.steps, seconds: r.seconds, cells: r.grid.cells, sym: r.symmetryError, body: r.bodyFluxFraction, width: r.shockWidthCells, offAxis: r.offAxisLines, r0: r.lineR0, src: 'aniso' });
const groups = new Map();
for (const r of runs3.values()) {
  const key = `${r.Nx}:${r.Nyz}`;
  groups.set(key, [...(groups.get(key) ?? []), r]);
}
const g3 = [...groups.entries()]
  .map(([key, rs]) => {
    const [Nx, Nyz] = key.split(':').map(Number);
    const st = {};
    for (const k of KEYS) {
      const v = rs.map((r) => r.standoff[k]);
      st[k] = { mean: v.reduce((a, b) => a + b, 0) / v.length, range: Math.max(...v) - Math.min(...v) };
    }
    return { Nx, Nyz, n: rs.length, offs: rs.map((r) => r.off).sort(), st, conv: rs.every((r) => r.converged), steps: Math.max(...rs.map((r) => r.steps)), cells: rs[0].cells, seconds: Math.max(...rs.map((r) => r.seconds)), sym: Math.max(...rs.map((r) => r.sym)), body: Math.max(...rs.map((r) => Math.abs(r.body))), width: rs.map((r) => r.width) };
  })
  .sort((a, b) => a.Nx - b.Nx || a.Nyz - b.Nyz);
log('');
log('2. 3D Cartesian solver, R/hx (along the flow) × R/hyz (across), mean over grid offsets in x (range in brackets)');
log('   R/hx R/hyz  offsets          cells   steps conv   50 %               steepest rise      equal area         width (x cells)  max sym   body');
for (const g of g3)
  log(
    `   ${String(g.Nx).padStart(4)} ${String(g.Nyz).padStart(5)}  ${g.offs.join(',').padEnd(16)} ${String(g.cells).padStart(7)} ${String(g.steps).padStart(6)} ${g.conv ? 'yes ' : 'NO  '}` +
      KEYS.map((k) => ` ${f5(g.st[k].mean)} (${g.st[k].range.toFixed(4)})`).join('') +
      `  ${Math.min(...g.width).toFixed(2)}–${Math.max(...g.width).toFixed(2)}     ${g.sym.toExponential(0)}  ${g.body}`,
  );
const at = (Nx, Nyz) => g3.find((g) => g.Nx === Nx && g.Nyz === Nyz);
log('   Effect of refining one direction only (50 % / equal area, offset means):');
for (const g of g3) {
  const sx = at(2 * g.Nx, g.Nyz);
  const sy = at(g.Nx, 2 * g.Nyz);
  if (sx) log(`     x refined ×2 at R/hyz ${g.Nyz}: (${g.Nx}→${2 * g.Nx}) Δ50% ${(sx.st.mid.mean - g.st.mid.mean).toFixed(5)}  ΔEA ${(sx.st.equalArea.mean - g.st.equalArea.mean).toFixed(5)}`);
  if (sy) log(`     lateral refined ×2 at R/hx ${g.Nx}: (${g.Nyz}→${2 * g.Nyz}) Δ50% ${(sy.st.mid.mean - g.st.mid.mean).toFixed(5)}  ΔEA ${(sy.st.equalArea.mean - g.st.equalArea.mean).toFixed(5)}`);
}

// one-direction refinement triplets with ratio 2 (Celik): x at fixed hyz, lateral at fixed hx
log('   One-direction refinement triplets (ratio 2, offset means; converged families only):');
for (const g of g3) {
  for (const [dir, nxt] of [['x', (q) => at(2 * q.Nx, q.Nyz)], ['lateral', (q) => at(q.Nx, 2 * q.Nyz)]]) {
    const g2 = nxt(g);
    const g4 = g2 && nxt(g2);
    if (!g4 || !g.conv || !g2.conv || !g4.conv) continue;
    const parts = KEYS.map((k) => {
      const c = celik([1, 2, 4], [g4.st[k].mean, g2.st[k].mean, g.st[k].mean]);
      return `${k} ${c.note ?? `p ${c.p.toFixed(2)} f_ext ${c.fext.toFixed(5)}`}`;
    });
    log(`     ${dir.padEnd(7)} ${g.Nx}:${g.Nyz} → ${g2.Nx}:${g2.Nyz} → ${g4.Nx}:${g4.Nyz}: ${parts.join(' | ')}`);
  }
}
log('   Local slope of the 50 % standoff per unit hx at fixed hyz (Δf/Δhx between neighbouring R/hx; constant if first order):');
for (const Nyz of [...new Set(g3.map((g) => g.Nyz))].sort((a, b) => a - b)) {
  const row = g3.filter((g) => g.Nyz === Nyz && g.conv).sort((a, b) => a.Nx - b.Nx);
  if (row.length < 3) continue;
  log(`     R/hyz ${Nyz}: ${row.slice(1).map((g, i) => `${row[i].Nx}→${g.Nx} ${((row[i].st.mid.mean - g.st.mid.mean) / (1 / row[i].Nx - 1 / g.Nx)).toFixed(3)}`).join(', ')}`);
}

// families of constant cell shape (hyz/hx fixed): local slopes and a first-order two-point extrapolation from the
// finest pair. Refining one direction at fixed other spacing also changes the cell aspect ratio; these families do not.
log('   Families of constant cell shape (hyz/hx = 0.5, 1, 1.5, 2): local slope per unit hx and first-order (p = 1) two-point');
log('   extrapolation from the two finest members (an assumption, shown because the slopes are nearly constant):');
for (const ratio of [0.5, 1, 1.5, 2]) {
  const fam = g3.filter((g) => g.conv && Math.abs(g.Nx / g.Nyz - ratio) < 1e-9 && g.Nx >= 16).sort((a, b) => a.Nx - b.Nx);
  if (fam.length < 2) continue;
  const parts = KEYS.map((k) => {
    const sl = fam.slice(1).map((g, i) => ((fam[i].st[k].mean - g.st[k].mean) / (1 / fam[i].Nx - 1 / g.Nx)).toFixed(3));
    const [a, b] = fam.slice(-2);
    const f0 = b.st[k].mean - ((a.st[k].mean - b.st[k].mean) * (1 / b.Nx)) / (1 / a.Nx - 1 / b.Nx);
    return `${k}: slopes ${sl.join(', ')}; p = 1 from ${a.Nx}:${a.Nyz}, ${b.Nx}:${b.Nyz} → ${f0.toFixed(5)}`;
  });
  log(`     hyz/hx ${ratio} (${fam.map((g) => `${g.Nx}:${g.Nyz}${g.n < 4 ? `[${g.n}]` : ''}`).join(', ')}):`);
  for (const t of parts) log(`       ${t}`);
}
log('   The same first-order two-point extrapolation for the axisymmetric columns (finest pair):');
for (const a of AS) {
  const col = NS.map((N) => ax(N, a)).filter(Boolean);
  if (col.length < 2) continue;
  const [p1, p2] = col.slice(-2);
  const parts = KEYS.map((k) => `${k} ${(p2.standoff[k] - ((p1.standoff[k] - p2.standoff[k]) * (1 / p2.options.radiusCells)) / (1 / p1.options.radiusCells - 1 / p2.options.radiusCells)).toFixed(5)}`);
  log(`     aspect ${String(a).padEnd(4)} from R/h ${p1.options.radiusCells}, ${p2.options.radiusCells}: ${parts.join(', ')}`);
}

// ── 3. error-model fits for both solvers ──
log('');
log('3. Error-model fits (least squares, equal weights; f0 = the fitted grid-converged standoff, ±1σ from the fit residuals).');
log('   Axisymmetric: h_r = R/N, h_t = aspect·h_r (wall). 3D: hx, hyz. The spread of f0 over model forms and data subsets is a');
log('   model-form uncertainty, not a statistical one.');
// [basis, terms in h1, terms in h2]: a model is fitted only when the data hold more distinct h1 (h2) values than it
// has h1 (h2) terms, so that no basis function is collinear with the others
const models = {
  'linear       f0 + a·h1 + b·h2': [(h1, h2) => [1, h1, h2], 1, 1],
  'quad-in-h2   f0 + a·h1 + b·h2 + c·h2²': [(h1, h2) => [1, h1, h2, h2 * h2], 1, 2],
  'quadratic    f0 + a·h1 + b·h2 + c·h1² + d·h2²': [(h1, h2) => [1, h1, h2, h1 * h1, h2 * h2], 2, 2],
  'p = 0.85     f0 + a·h1^0.85 + b·h2^0.85': [(h1, h2) => [1, h1 ** 0.85, h2 ** 0.85], 1, 1],
};
const fittable = (pts, t1, t2) => new Set(pts.map((p) => p[0])).size > t1 && new Set(pts.map((p) => p[1])).size > t2 && pts.length > t1 + t2 + 2;
const fits = [];
for (const k of KEYS) {
  log(`   detector ${k}:`);
  for (const [subset, axiMin, axiAspMax, d3Min, d3xMin] of [
    ['A: axi R/h ≥ 24; 3D min(R/hx, R/hyz) ≥ 12', 24, 3, 12, 12],
    ['B: axi R/h ≥ 32, aspect ≤ 2; 3D min ≥ 16', 32, 2, 16, 16],
    ['C: axi R/h ≥ 48, aspect ≤ 2; 3D R/hx ≥ 24, R/hyz ≥ 12', 48, 2, 12, 24],
  ]) {
    const ad = axi.filter((r) => r.options.radiusCells >= axiMin && r.options.aspect <= axiAspMax);
    const dd = g3.filter((g) => Math.min(g.Nx, g.Nyz) >= d3Min && g.Nx >= d3xMin && g.conv);
    for (const [mname, [fn, t1, t2]] of Object.entries(models)) {
      const pa = ad.map((r) => [1 / r.options.radiusCells, r.options.aspect / r.options.radiusCells]);
      const pd = dd.map((g) => [1 / g.Nx, 1 / g.Nyz]);
      const fa = fittable(pa, t1, t2) ? lsq(pa.map(([a, b]) => fn(a, b)), ad.map((r) => r.standoff[k])) : null;
      const fd = fittable(pd, t1, t2) ? lsq(pd.map(([a, b]) => fn(a, b)), dd.map((g) => g.st[k].mean)) : null;
      fits.push({ k, subset, mname, fa, fd });
      const show = (f, l1, l2) => (f ? `f0 ${f.coef[0].toFixed(5)} ±${f.se[0].toFixed(5)}, ${l1} ${f.coef[1].toFixed(3)}, ${l2} ${f.coef[2].toFixed(3)}, rms ${f.rms.toExponential(1)} (n ${f.n})` : 'too few points');
      log(`     [${subset}] ${mname}`);
      log(`        axisymmetric: ${show(fa, 'a(h_r)', 'b(h_t)')}`);
      log(`        3D          : ${show(fd, 'A(hx)', 'B(hyz)')}`);
    }
  }
}
log('   Summary of f0 over all model forms and subsets:');
for (const k of KEYS) {
  const fa = fits.filter((f) => f.k === k && f.fa).map((f) => f.fa.coef[0]);
  const fd = fits.filter((f) => f.k === k && f.fd).map((f) => f.fd.coef[0]);
  log(`     ${k.padEnd(11)} axisymmetric f0 ${Math.min(...fa).toFixed(5)} … ${Math.max(...fa).toFixed(5)}   3D f0 ${fd.length ? `${Math.min(...fd).toFixed(5)} … ${Math.max(...fd).toFixed(5)}` : '—'}`);
}

// ── 4. which axisymmetric aspect reproduces the isotropic 3D value at the same R/h ──
log('');
log('4. Equivalent axisymmetric aspect: the aspect at which the axisymmetric standoff at the same R/h equals the isotropic 3D');
log('   offset mean (linear interpolation along the axisymmetric row). Descriptive only.');
for (const k of KEYS) {
  const parts = [];
  for (const N of NS) {
    const g = at(N, N);
    if (!g) continue;
    const row = AS.map((a) => ax(N, a).standoff[k]);
    let kap = NaN;
    for (let i = 1; i < AS.length; i++)
      if ((row[i - 1] - g.st[k].mean) * (row[i] - g.st[k].mean) <= 0) {
        kap = AS[i - 1] + ((AS[i] - AS[i - 1]) * (g.st[k].mean - row[i - 1])) / (row[i] - row[i - 1]);
        break;
      }
    parts.push(`R/h ${N}: ${Number.isFinite(kap) ? kap.toFixed(2) : 'outside 0.5–3'}${g.n < 4 ? ` (3D: ${g.n} offset${g.n > 1 ? 's' : ''})` : ''}`);
  }
  log(`   ${k.padEnd(11)} ${parts.join(', ')}`);
}

// ── 5. measurement: off-axis line correction in the 3D runs ──
log('');
log('5. Off-axis measurement line (3D): the stagnation-line cells lie at r = hyz/√2 from the axis. With the 50 % standoff on');
log('   the lines j = 0 and j = 1 (r0, r1), d(r) ≈ d0 + c·r² gives the on-axis value d0 = d(r0) − c·r0². Correction d0 − d(r0):');
const corr = new Map();
for (const r of runs3.values()) {
  if (!r.offAxis) continue;
  const d1 = r.offAxis.find((l) => l.j === 1);
  const c = (d1.standoff.mid - r.standoff.mid) / (d1.r ** 2 - r.r0 ** 2);
  const key = `${r.Nx}:${r.Nyz}`;
  corr.set(key, [...(corr.get(key) ?? []), -c * r.r0 ** 2]);
}
for (const [key, v] of [...corr.entries()].sort()) log(`   R/hx:R/hyz ${key.padEnd(6)} ${v.map((x) => x.toExponential(1)).join(', ')}`);

// ── 5b. iteration error: the same configurations converged to a 6-order instead of a 4-order residual drop ──
log('');
log('5b. Iteration error (6-order instead of 4-order residual drop; change of the standoff):');
for (const r of jsonl(path.join(docs, 'sphere-gap-study', 'axi-iteration', 'summary.jsonl'))) {
  const ref = ax(r.options.radiusCells, r.options.aspect);
  log(`   axisymmetric R/h ${r.options.radiusCells} aspect ${r.options.aspect}: steps ${ref.steps} → ${r.steps}; ${KEYS.map((k) => `${k} ${(r.standoff[k] - ref.standoff[k]).toExponential(1)}`).join(', ')}`);
}
for (const r of jsonl(path.join(docs, 'sphere-gap-study', '3d-iteration', 'summary.jsonl'))) {
  const ref = iso.filter((x) => x.options.radiusCells === r.options.radiusCells && (x.options.gridOffset ?? 0) === (r.options.gridOffset ?? 0)).at(-1);
  log(`   3D R/h ${r.options.radiusCells} offset ${r.options.gridOffset ?? 0}: steps ${ref.steps} → ${r.steps}; ${KEYS.map((k) => `${k} ${(r.standoff[k] - ref.standoff[k]).toExponential(1)}`).join(', ')}`);
}

// ── 5c. out-of-sample check of the 3D error model: refit subset C without the finest-x family and predict it ──
{
  const C = g3.filter((g) => Math.min(g.Nx, g.Nyz) >= 12 && g.Nx >= 24 && g.conv);
  log('');
  log('5c. Out-of-sample check of the 3D error model: refit subset C without one of the finest-x families (R/hx ≥ 48) and predict it');
  for (const finest of C.filter((g) => g.Nx >= 48)) {
  log(`   left out R/hx:R/hyz ${finest.Nx}:${finest.Nyz} (${finest.n} offset${finest.n > 1 ? 's' : ''})`);
  for (const k of ['mid', 'equalArea'])
    for (const [mname, [fn, t1, t2]] of Object.entries(models)) {
      const train = C.filter((g) => g !== finest);
      const pts = train.map((g) => [1 / g.Nx, 1 / g.Nyz]);
      if (!fittable(pts, t1, t2)) continue;
      const f = lsq(pts.map(([a, b]) => fn(a, b)), train.map((g) => g.st[k].mean));
      const pred = fn(1 / finest.Nx, 1 / finest.Nyz).reduce((s, x, j) => s + x * f.coef[j], 0);
      log(`     ${k.padEnd(9)} ${mname.padEnd(48)} predicted ${pred.toFixed(5)}, measured ${finest.st[k].mean.toFixed(5)} (offset range ${finest.st[k].range.toFixed(5)}), measured − predicted ${(finest.st[k].mean - pred).toFixed(5)}`);
    }
  }
}

// ── 6. actual spacings and measurement geometry at the same nominal R/h ──
log('');
log('6. Grid geometry at the same nominal R/h (axisymmetric aspect 1 = the reference grid; 3D isotropic, reduced domain)');
log('   R/h | axi: radial  tangential wall / shock  ray angle  lateral offset of ray at shock  nose-cell centroid to wall | 3D: hx = hy = hz  line offset hyz/√2  nose-cell centre to wall over the offsets (negative: a merged cut cell whose centre lies inside the body)  nose-cell α');
const refDir = path.join(docs, 'sphere3d-refinement');
for (const N of [16, 24, 32, 48]) {
  const a = ax(N, 1);
  const d3 = [...runs3.values()].filter((r) => r.Nx === N && r.Nyz === N && r.src === 'refinement');
  const gaps = [];
  const alphas = [];
  for (const r of d3) {
    const f = path.join(refDir, `s3d_rusanov_cutcell_Rh${N}_off${r.off}_downstream0.5_lateral2.csv`);
    if (!fs.existsSync(f)) continue;
    const rows = fs.readFileSync(f, 'utf8').split('\n').filter((l) => l && !l.startsWith('#') && !l.startsWith('i,')).map((l) => l.split(',').map(Number));
    const last = rows[rows.length - 1];
    gaps.push(last[2] * N);
    alphas.push(last[5]);
  }
  const h = 1 / N;
  const lat = (1 + a.standoff.mid) * Math.sin((a.rayAngleDeg * Math.PI) / 180);
  log(
    `   ${String(N).padStart(3)} | h  ${(a.grid.tangentialAtWall / h).toFixed(2)}h / ${(a.grid.tangentialAtShock / h).toFixed(2)}h  ${a.rayAngleDeg.toFixed(3)}°  ${(lat / h).toFixed(2)}h  ${(a.nose.d / h).toFixed(2)}h` +
      ` | h  ${(1 / Math.SQRT2).toFixed(2)}h  ${gaps.length ? `${Math.min(...gaps).toFixed(2)}h … ${Math.max(...gaps).toFixed(2)}h` : '—'}  ${alphas.length ? `${Math.min(...alphas).toFixed(2)} … ${Math.max(...alphas).toFixed(2)}` : ''}`,
  );
}
log('   Body-normal and tangential directions: in the axisymmetric grid the radial direction is the body normal at every θ');
log('   (spacing h) and the tangential spacing is ρΔθ. In the Cartesian grid the cell width along a unit direction n is');
log('   h(|nx| + |ny| + |nz|): h on the axis (normal = x), √2·h at 45° in a symmetry plane, up to √3·h; the shock and the wall');
log('   are cut obliquely away from the axis and the wall is one planar facet per cut cell.');

console.log(out.join('\n'));
