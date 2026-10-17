import type { ThermalConfig } from './config';
import { SIGMA_SB } from './gas';

/**
 * TRANSIENT CONDUCTION THROUGH THE HEAT SHIELD (one-dimensional, through the thickness)
 *
 *   ρ_s c_p ∂T/∂t = k ∂²T/∂x²,   0 < x < L   (x = 0: heated outer surface, x = L: back face)
 *
 *   outer surface:  −k ∂T/∂x = q_in(T_s) = H (T_aw − T_s) − ε σ T_s⁴     (convection from the gas − re-radiation)
 *   back face:      adiabatic (−k ∂T/∂x = 0) or fixed temperature T_rear
 *
 * Constant properties, no ablation, pyrolysis or surface chemistry: the shield is a passive conductor.
 *
 * Discretisation: N equally spaced nodes with control volumes of width Δx (half width at the two faces), so the
 * discrete energy balance is exact: the stored energy changes by exactly the heat that crosses the boundaries.
 * Time integration: implicit (backward) Euler — unconditionally stable for any Δt — with the radiation term
 * linearised about the latest iterate and iterated to convergence (Newton) every step. Each step solves one
 * tridiagonal system with the Thomas algorithm.
 *
 * Coupling with the flow is quasi-steady: H and T_aw come from the steady flow solution and are held fixed during
 * the exposure. That is justified when the flow adjusts much faster than the shield heats up (flow time 2H/V∞ of
 * milliseconds against a conduction time L²/α of seconds to hours); both are reported.
 */
export interface ThermalInput {
  /** heat-transfer coefficient, W/(m²·K) */
  H: number;
  /** adiabatic-wall temperature, K */
  Taw: number;
}

export interface ThermalResult {
  /** node positions from the outer surface, m */
  x: Float64Array;
  /** output times, s */
  t: Float64Array;
  /** surface and back-face temperature at the output times, K */
  Tsurf: Float64Array;
  Tback: Float64Array;
  /** net heat flux into the surface at the output times, W/m² (convective minus radiated) */
  qNet: Float64Array;
  qConv: Float64Array;
  qRad: Float64Array;
  /** temperature profile at the end, K */
  profile: Float64Array;
  /** profiles at a few intermediate times */
  profiles: { t: number; T: Float64Array }[];
  /** energy check: heat absorbed through the surface (and back face) vs change of stored energy, J/m² */
  absorbed: number;
  stored: number;
  /** thermal diffusivity α = k/(ρ c_p), m²/s, and conduction time L²/α, s */
  alpha: number;
  tCond: number;
  maxNewton: number;
}

/** solve a tridiagonal system in place (Thomas algorithm): a = sub-, b = main, c = super-diagonal, d = rhs → solution */
export function thomas(a: Float64Array, b: Float64Array, c: Float64Array, d: Float64Array): Float64Array<ArrayBufferLike> {
  const n = b.length;
  const cp = new Float64Array(n);
  const dp = new Float64Array(n);
  cp[0] = c[0] / b[0];
  dp[0] = d[0] / b[0];
  for (let i = 1; i < n; i++) {
    const m = b[i] - a[i] * cp[i - 1];
    cp[i] = c[i] / m;
    dp[i] = (d[i] - a[i] * dp[i - 1]) / m;
  }
  const x = new Float64Array(n);
  x[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i--) x[i] = dp[i] - cp[i] * x[i + 1];
  return x;
}

/**
 * Integrate the conduction problem for `cfg.duration` seconds with `steps` implicit steps. `heat` gives the
 * surface heating; a custom `surfaceFlux(T, t)` can replace it (used by the verification tests).
 */
export function solveConduction(
  cfg: ThermalConfig,
  heat: ThermalInput,
  steps = 2000,
  surfaceFlux?: (Ts: number, t: number) => { q: number; dqdT: number },
): ThermalResult {
  const N = Math.max(3, Math.round(cfg.nodes));
  const L = cfg.thickness;
  const dx = L / (N - 1);
  const rc = cfg.rho * cfg.cp;
  const k = cfg.k;
  const dt = cfg.duration / steps;
  const eps = cfg.emissivity;
  const fixed = cfg.rear === 'fixed';
  const x = new Float64Array(N);
  for (let i = 0; i < N; i++) x[i] = i * dx;
  // control-volume widths
  const w = new Float64Array(N).fill(dx);
  w[0] = dx / 2;
  w[N - 1] = dx / 2;
  let T: Float64Array = new Float64Array(N).fill(cfg.T0);
  if (fixed) T[N - 1] = cfg.Trear;
  const flux =
    surfaceFlux ??
    ((Ts: number) => ({
      q: heat.H * (heat.Taw - Ts) - eps * SIGMA_SB * Ts ** 4,
      dqdT: -heat.H - 4 * eps * SIGMA_SB * Ts ** 3,
    }));
  const nOut = Math.min(steps, 400);
  const every = Math.max(1, Math.floor(steps / nOut));
  const tOut: number[] = [0];
  const Ts: number[] = [T[0]];
  const Tb: number[] = [T[N - 1]];
  const qN: number[] = [];
  const qC: number[] = [];
  const qR: number[] = [];
  const pushFlux = (Tsurf: number, t: number) => {
    const f = flux(Tsurf, t);
    const qr = surfaceFlux ? 0 : eps * SIGMA_SB * Tsurf ** 4;
    qN.push(f.q);
    qR.push(qr);
    qC.push(f.q + qr);
  };
  pushFlux(T[0], 0);
  const profiles: { t: number; T: Float64Array }[] = [{ t: 0, T: T.slice() }];
  const profileAt = [0.1, 0.25, 0.5].map((f) => Math.max(1, Math.round(f * steps)));
  const energy = (arr: Float64Array) => {
    let e = 0;
    for (let i = 0; i < N; i++) e += rc * w[i] * arr[i];
    return e;
  };
  const E0 = energy(T);
  let absorbed = 0;
  let maxNewton = 0;
  const a = new Float64Array(N);
  const b = new Float64Array(N);
  const c = new Float64Array(N);
  const d = new Float64Array(N);
  const G = k / dx;
  for (let n = 1; n <= steps; n++) {
    const t = n * dt;
    const Told = T;
    let Tn: Float64Array = Told.slice();
    let qSurf = 0;
    for (let it = 0; it < 30; it++) {
      // linearise the surface flux about the current iterate: q ≈ q* + q'·(T − T*)
      const f = flux(Tn[0], t);
      for (let i = 0; i < N; i++) {
        const cap = (rc * w[i]) / dt;
        a[i] = i > 0 ? -G : 0;
        c[i] = i < N - 1 ? -G : 0;
        b[i] = cap + (i > 0 ? G : 0) + (i < N - 1 ? G : 0);
        d[i] = cap * Told[i];
      }
      b[0] -= f.dqdT;
      d[0] += f.q - f.dqdT * Tn[0];
      if (fixed) {
        a[N - 1] = 0;
        b[N - 1] = 1;
        d[N - 1] = cfg.Trear;
      }
      const next = thomas(a, b, c, d);
      let change = 0;
      for (let i = 0; i < N; i++) change = Math.max(change, Math.abs(next[i] - Tn[i]));
      Tn = next;
      maxNewton = Math.max(maxNewton, it + 1);
      if (change < 1e-10 * Math.max(1, Tn[0])) break;
    }
    qSurf = flux(Tn[0], t).q;
    absorbed += qSurf * dt;
    if (fixed) {
      // heat leaving through the fixed-temperature back face (energy balance of the last control volume)
      const qBack = G * (Tn[N - 2] - Tn[N - 1]) - ((rc * w[N - 1]) / dt) * (Tn[N - 1] - Told[N - 1]);
      absorbed -= qBack * dt;
    }
    T = Tn;
    if (profileAt.includes(n)) profiles.push({ t, T: T.slice() });
    if (n % every === 0 || n === steps) {
      tOut.push(t);
      Ts.push(T[0]);
      Tb.push(T[N - 1]);
      pushFlux(T[0], t);
    }
  }
  const alpha = k / rc;
  return {
    x,
    t: Float64Array.from(tOut),
    Tsurf: Float64Array.from(Ts),
    Tback: Float64Array.from(Tb),
    qNet: Float64Array.from(qN),
    qConv: Float64Array.from(qC),
    qRad: Float64Array.from(qR),
    profile: T,
    profiles: [...profiles, { t: cfg.duration, T: T.slice() }],
    absorbed,
    stored: energy(T) - E0,
    alpha,
    tCond: (L * L) / alpha,
    maxNewton,
  };
}

/** semi-infinite solid with constant surface flux q from t = 0: T(0, t) = T₀ + 2q √(t / (π k ρ c_p)) */
export function semiInfiniteConstantFlux(q: number, t: number, k: number, rho: number, cp: number, T0: number, x = 0): number {
  const alpha = k / (rho * cp);
  if (x === 0) return T0 + 2 * q * Math.sqrt(t / (Math.PI * k * rho * cp));
  const eta = x / (2 * Math.sqrt(alpha * t));
  return T0 + ((2 * q * Math.sqrt((alpha * t) / Math.PI)) / k) * Math.exp(-eta * eta) - ((q * x) / k) * erfc(eta);
}

/** complementary error function (Chebyshev fit "erfcc" from Numerical Recipes, fractional error < 1.2e-7) */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}
