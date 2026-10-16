/**
 * A deliberately simple 1-D model of a chemically amplified resist, shared by the
 * 3-D cross-section and by the charts in the inspector so both always agree.
 *
 *  aerial image  I(x)   = ½ (1 − γ cos(2πx/P))          dark at the absorber lines (x = kP)
 *  acid          A(x)   = 1 − exp(−c · dose · I)          then blurred by secondary-electron range σ_e
 *  after the PEB A_d(x) = A ⊗ G(σ_d)                      acid diffusion during the bake
 *  amplification f(x)   = A_d^q / (A_d^q + K^q)           catalytic chain + quencher → sharp threshold
 *  solubility           positive: f > ½ dissolves, negative: f < ½ dissolves
 */
export interface ResistModel {
  N: number;
  W: number;
  P: number;
  x: Float32Array;
  aerial: Float32Array;
  acid: Float32Array;
  acidDiff: Float32Array;
  deprot: Float32Array;
  solPos: Float32Array;
  solNeg: Float32Array;
  dose: number;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function blur(src: Float32Array, sigmaCols: number): Float32Array {
  const N = src.length;
  const R = Math.max(1, Math.ceil(sigmaCols * 3));
  const k: number[] = [];
  let sum = 0;
  for (let d = -R; d <= R; d++) {
    const w = Math.exp(-(d * d) / (2 * sigmaCols * sigmaCols));
    k.push(w);
    sum += w;
  }
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let acc = 0;
    for (let d = -R; d <= R; d++) acc += src[(i + d + N * 4) % N] * k[d + R];
    out[i] = acc / sum;
  }
  return out;
}

const cache = new Map<string, ResistModel>();

export function buildResistModel(N = 108, W = 5.4, nPeriods = 3, dose = 1, gamma = 0.8): ResistModel {
  const key = `${N}|${W}|${nPeriods}|${dose.toFixed(3)}|${gamma}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const P = W / nPeriods;
  const x = new Float32Array(N);
  const aerial = new Float32Array(N);
  const a0 = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    x[i] = -W / 2 + ((i + 0.5) / N) * W;
    aerial[i] = 0.5 * (1 - gamma * Math.cos((2 * Math.PI * x[i]) / P));
    a0[i] = 1 - Math.exp(-1.2 * dose * aerial[i]);
  }
  const colsPerUnit = N / W;
  const acid = blur(a0, 0.055 * colsPerUnit);
  const acidDiff = blur(acid, 0.09 * colsPerUnit);
  const deprot = new Float32Array(N);
  const solPos = new Float32Array(N);
  const solNeg = new Float32Array(N);
  const q = 4;
  const K = 0.45;
  for (let i = 0; i < N; i++) {
    const a = Math.pow(acidDiff[i], q);
    deprot[i] = a / (a + Math.pow(K, q));
    solPos[i] = smooth(0.4, 0.6, deprot[i]);
    solNeg[i] = 1 - solPos[i];
  }
  const m = { N, W, P, x, aerial, acid, acidDiff, deprot, solPos, solNeg, dose };
  if (cache.size > 40) cache.clear();
  cache.set(key, m);
  return m;
}

/** Cumulative distribution of a non-negative weight array, for importance-sampling x positions. */
export function cdfOf(w: Float32Array): Float32Array {
  const c = new Float32Array(w.length);
  let s = 0;
  for (let i = 0; i < w.length; i++) {
    s += Math.max(w[i], 1e-4);
    c[i] = s;
  }
  for (let i = 0; i < w.length; i++) c[i] /= s;
  return c;
}
export function sampleCdf(c: Float32Array, u: number): number {
  let lo = 0;
  let hi = c.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c[mid] < u) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Fraction of the printed line width relative to the pitch for a given tone (for the chart read-out). */
export function lineFraction(m: ResistModel, tone: 'positive' | 'negative') {
  const sol = tone === 'positive' ? m.solPos : m.solNeg;
  let kept = 0;
  for (let i = 0; i < m.N; i++) kept += 1 - sol[i];
  return kept / m.N;
}
