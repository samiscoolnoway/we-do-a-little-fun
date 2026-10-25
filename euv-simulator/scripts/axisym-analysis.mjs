// Independent analysis of the archived axisymmetric Mach 2 sphere profiles (docs/axisym-data/*.csv).
// Plain Node, no solver code: recomputes the shock detectors from the raw profiles, then the grid-convergence
// analysis (observed order, Richardson extrapolation, GCI) for every grid triplet and detector, and checks the
// ring-volume / face-area formulas of the axisymmetric finite-volume method by numerical quadrature.
//
//   node scripts/axisym-analysis.mjs            (from euv-simulator/)
//
// Detector definitions (as in sphereAxi.ts / sphere3d.ts): profile = stagnation-line cells from upstream to the
// wall, d = distance of the cell centroid from the sphere surface, φ = (ρ − ρ∞)/(ρ₂ − ρ∞).
//   crossing(L): first k with φ[k−1] < L ≤ φ[k]; d = d[k−1] + (d[k] − d[k−1])(L − φ[k−1])/(φ[k] − φ[k−1])
//   max gradient: face with the largest rise ρ[k] − ρ[k−1]; parabola through the rises at k−1, k, k+1 moves it by
//                 δ = ½(r₋ − r₊)/(r₋ − 2r₀ + r₊) cells (|δ| ≤ ½) downstream
//   equal area:   S = Σ min(max(φ,0),1) from upstream to the first cell with φ ≥ 1 (inclusive);
//                 d = d[last] − h/2 + h·S
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', 'docs', 'axisym-data');
const out = [];
const log = (s = '') => out.push(s);

function readProfile(file) {
  const rows = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('d,'))
    .map((l) => l.split(',').map(Number));
  return rows.map(([d, rho, phi]) => ({ d, rho, phi }));
}

function detectors(p, h) {
  const crossing = (L) => {
    for (let k = 1; k < p.length; k++) if (p[k - 1].phi < L && p[k].phi >= L) return p[k - 1].d + ((p[k].d - p[k - 1].d) * (L - p[k - 1].phi)) / (p[k].phi - p[k - 1].phi);
    return NaN;
  };
  const rise = (k) => (k >= 1 && k < p.length ? p[k].rho - p[k - 1].rho : -Infinity);
  let km = 1;
  for (let k = 2; k < p.length; k++) if (rise(k) > rise(km)) km = k;
  const [a, b, c] = [rise(km - 1), rise(km), rise(km + 1)];
  let off = 0;
  if (Number.isFinite(a) && Number.isFinite(c) && a - 2 * b + c < 0) off = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / (a - 2 * b + c)));
  const grad = 0.5 * (p[km - 1].d + p[km].d) - off * h;
  let S = 0;
  let last = 0;
  for (let k = 0; k < p.length; k++) {
    S += Math.min(Math.max(p[k].phi, 0), 1);
    last = k;
    if (p[k].phi >= 1) break;
  }
  return { foot: crossing(0.1), mid: crossing(0.5), tail: crossing(0.9), grad, ea: p[last].d - 0.5 * h + h * S };
}

// ── 1. profile audit ──
log('1. Raw profile audit (docs/axisym-data/axi_*.csv)');
const files = fs.readdirSync(dataDir).filter((f) => /^axi_\w+_Rh\d+\.csv$/.test(f));
const det = {};
for (const f of files.sort()) {
  const [, flux, N] = f.match(/^axi_(\w+)_Rh(\d+)\.csv$/);
  const h = 1 / Number(N);
  const p = readProfile(path.join(dataDir, f));
  const spacing = p.slice(1).map((q, k) => p[k].d - q.d);
  const devH = Math.max(...spacing.map((s) => Math.abs(s - h))) / h;
  const monotoneD = spacing.every((s) => s > 0);
  const upstream = p.slice(0, 5).every((q) => Math.abs(q.phi) < 1e-6);
  const phiCheck = Math.max(...p.map((q) => Math.abs(q.phi - (q.rho - 1) / (8 / 3 - 1))));
  const D = detectors(p, h);
  det[`${flux}_${N}`] = D;
  log(`  ${f.padEnd(22)} rows ${String(p.length).padStart(4)} (expected ${4 * N}) | d from ${p[0].d.toFixed(4)} to ${p[p.length - 1].d.toFixed(6)} | spacing dev ≤ ${(devH * 100).toFixed(2)} % of h, decreasing: ${monotoneD} | freestream ahead: ${upstream} | max |φ − (ρ/ρ∞ − 1)/(ρ₂/ρ∞ − 1)| = ${phiCheck.toExponential(1)}`);
  log(`  ${''.padEnd(22)} foot ${D.foot.toFixed(5)}  mid ${D.mid.toFixed(5)}  tail ${D.tail.toFixed(5)}  grad ${D.grad.toFixed(5)}  equal-area ${D.ea.toFixed(5)}  width ${((D.foot - D.tail) / h).toFixed(2)} cells`);
}

// ── 2. convergence analysis ──
log('');
log('2. Grid convergence (Rusanov, constant refinement ratio r = 2)');
const Ns = [8, 16, 32, 64, 128];
const billig = 0.143 * Math.exp(3.24 / 4);
for (const key of ['mid', 'grad', 'ea']) {
  const f = Ns.map((N) => det[`rusanov_${N}`][key]);
  log(`  detector ${key}: ${Ns.map((N, i) => `R/h ${N}: ${f[i].toFixed(5)}`).join(', ')}`);
  log(`    successive differences f(h) − f(h/2): ${f.slice(1).map((v, i) => (f[i] - v).toFixed(5)).join(', ')}`);
  for (let t = 0; t + 2 < Ns.length; t++) {
    const [f3, f2, f1] = [f[t], f[t + 1], f[t + 2]]; // coarse, medium, fine
    const e32 = f3 - f2;
    const e21 = f2 - f1;
    const tri = `${Ns[t]}/${Ns[t + 1]}/${Ns[t + 2]}`;
    if (e32 * e21 <= 0) {
      log(`    triplet ${tri}: oscillatory (differences change sign) — no observed order`);
      continue;
    }
    const R = e21 / e32;
    if (R >= 1) {
      log(`    triplet ${tri}: convergence ratio e21/e32 = ${R.toFixed(2)} ≥ 1 (differences grow) — not in the asymptotic range, no order`);
      continue;
    }
    const p = Math.log(e32 / e21) / Math.log(2);
    const fx = f1 - e21 / (2 ** p - 1);
    const gci21 = (1.25 * Math.abs(e21 / f1)) / (2 ** p - 1);
    const gci32 = (1.25 * Math.abs(e32 / f2)) / (2 ** p - 1);
    const asym = gci32 / (2 ** p * gci21);
    const fx1 = f1 - e21; // assumed p = 1
    const fx2 = f1 - e21 / 3; // assumed p = 2
    log(`    triplet ${tri}: R = ${R.toFixed(3)}, observed p = ${p.toFixed(3)}, extrapolated ${fx.toFixed(5)}, GCI_fine = ${(gci21 * 100).toFixed(2)} % (${(gci21 * f1).toFixed(5)} R), asymptotic check GCI32/(2^p GCI21) = ${asym.toFixed(3)}; assumed p = 1: ${fx1.toFixed(5)}, p = 2: ${fx2.toFixed(5)}; extrapolated vs Billig ${((fx / billig - 1) * 100).toFixed(1)} %`);
  }
}

// ── 3. geometry check by quadrature ──
log('');
log('3. Ring volume and face area of a straight-edged cell vs numerical quadrature');
{
  // a polar cell next to the axis and one off it, as built by polarGrid (vertices on arcs, straight edges)
  const cells = [
    [1.0, 1.0625, 0, 0.05],
    [1.5, 1.5625, 0.6, 0.65],
  ];
  for (const [r0, r1, t0, t1] of cells) {
    const V = [
      [r0, t0],
      [r1, t0],
      [r1, t1],
      [r0, t1],
    ].map(([rr, t]) => [-rr * Math.cos(t), t === 0 ? 0 : rr * Math.sin(t)]);
    // shoelace area and centroid
    let a2 = 0;
    let cr = 0;
    for (let k = 0; k < 4; k++) {
      const [x0, y0] = V[k];
      const [x1, y1] = V[(k + 1) % 4];
      const cross = x0 * y1 - x1 * y0;
      a2 += cross;
      cr += (y0 + y1) * cross;
    }
    const A = Math.abs(a2 / 2);
    const rc = cr / (3 * a2);
    // quadrature of ∫∫ r dA over the polygon: bilinear map from the unit square, Gauss–Legendre 8×8
    const gx = [-0.9602898564975363, -0.7966664774136267, -0.525532409916329, -0.1834346424956498, 0.1834346424956498, 0.525532409916329, 0.7966664774136267, 0.9602898564975363];
    const gw = [0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.362683783378362, 0.362683783378362, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763];
    let Vq = 0;
    for (let a = 0; a < 8; a++)
      for (let b = 0; b < 8; b++) {
        const s = 0.5 * (gx[a] + 1);
        const t = 0.5 * (gx[b] + 1);
        const N = [(1 - s) * (1 - t), s * (1 - t), s * t, (1 - s) * t];
        const x = N.reduce((q, n, k) => q + n * V[k][0], 0);
        const y = N.reduce((q, n, k) => q + n * V[k][1], 0);
        const dxs = (1 - t) * (V[1][0] - V[0][0]) + t * (V[2][0] - V[3][0]);
        const dys = (1 - t) * (V[1][1] - V[0][1]) + t * (V[2][1] - V[3][1]);
        const dxt = (1 - s) * (V[3][0] - V[0][0]) + s * (V[2][0] - V[1][0]);
        const dyt = (1 - s) * (V[3][1] - V[0][1]) + s * (V[2][1] - V[1][1]);
        Vq += 0.25 * gw[a] * gw[b] * y * Math.abs(dxs * dyt - dys * dxt);
      }
    // face integral ∫ r ds along one edge by quadrature vs L·r_mid
    const [p0, p1] = [V[1], V[2]];
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    let Fq = 0;
    for (let a = 0; a < 8; a++) {
      const s = 0.5 * (gx[a] + 1);
      Fq += 0.5 * gw[a] * L * (p0[1] + s * (p1[1] - p0[1]));
    }
    log(`  cell ρ ∈ [${r0}, ${r1}], θ ∈ [${t0}, ${t1}]: A·r_c = ${(A * rc).toExponential(10)}, quadrature ∫r dA = ${Vq.toExponential(10)} (rel. diff ${Math.abs(A * rc / Vq - 1).toExponential(1)}); L·r_mid = ${(L * 0.5 * (p0[1] + p1[1])).toExponential(10)}, quadrature ∫r ds = ${Fq.toExponential(10)}`);
  }
}

console.log(out.join('\n'));
