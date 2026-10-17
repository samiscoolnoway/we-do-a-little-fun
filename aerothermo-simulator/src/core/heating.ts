import { type SimConfig, freestreamOf } from './config';
import { CP, GAS, sutherland, SIGMA_SB } from './gas';
import { noseRadius } from './mesh';
import type { SurfaceData } from './simulation';

/**
 * SURFACE HEATING — a boundary-layer correlation evaluated with the inviscid solution as its outer edge.
 *
 * The Euler solver has no viscosity and no heat conduction, so it cannot compute wall heat flux itself. Heating is
 * estimated afterwards with laminar boundary-layer theory, using the solver's wall-adjacent values as the
 * conditions at the edge of the (not modelled) boundary layer:
 *
 * 1. Stagnation line (2D cylinder), laminar, calorically perfect gas
 *    (J. D. Anderson, Hypersonic and High-Temperature Gas Dynamics, 2nd ed., AIAA 2006, §6.6, eq. for a cylinder,
 *    which follows from the stagnation-point similarity solutions of Fay & Riddell / Cohen & Reshotko):
 *        q₀ = 0.57 · Pr^−0.6 · √(ρₑ μₑ · duₑ/ds) · (h_aw − h_w)
 *    The axisymmetric (sphere) constant is 0.763; the 2D value is used because this simulator is planar.
 *    duₑ/ds, the edge-velocity gradient at the stagnation point, is fitted to the computed wall velocities; the
 *    Newtonian estimate (1/Rₙ)√(2(pₑ − p∞)/ρₑ) is shown as a cross-check.
 *    Omitted: Fay–Riddell's (ρ_w μ_w / ρₑ μₑ)^0.1 factor and dissociation terms (several per cent to ~10 %).
 *
 * 2. Distribution along the windward face (Lees 1956, local similarity, laminar, j = 0 for planar flow):
 *        q(s)/q₀ = [ρₑ μₑ uₑ / √(2ξ)] / √(ρₑ₀ μₑ₀ (duₑ/ds)₀),   ξ(s) = ∫₀ˢ ρₑ μₑ uₑ ds
 *    applied to the heat-transfer coefficient, with the local adiabatic-wall temperature
 *    T_aw = Tₑ + r uₑ²/(2c_p), laminar recovery factor r = √Pr. Valid on the windward face only (favourable
 *    pressure gradient, attached flow); beyond the shoulder (surface turned away from the flow) it is reported as
 *    not applicable.
 *
 * 3. Comparison: Sutton–Graves (NASA TR R-376, 1971), q = k √(ρ∞/Rₙ) V∞³, k = 1.7415e-4 kg^0.5/m, a sphere
 *    stagnation-point fit for hypersonic re-entry in equilibrium air with a cold wall. Converted to 2D by 1/√2
 *    (the ratio of planar to axisymmetric stagnation heating at equal nose radius). At the moderate speeds of this
 *    simulator it is an order-of-magnitude comparison, not a check.
 *
 * Because q is linear in (h_aw − h_w) with everything else independent of the wall, the result is expressed as a
 * heat-transfer coefficient H (W/(m²·K)) and an adiabatic-wall temperature: q(T_w) = H (T_aw − T_w). That is what
 * the conduction model needs, with the wall temperature changing in time. All quantities SI.
 */
export const PRANDTL = 0.71;
export const RECOVERY = Math.sqrt(PRANDTL);
export const SUTTON_GRAVES_K = 1.7415e-4;
export const C_CYLINDER = 0.57;
export const C_SPHERE = 0.763;

export interface HeatingPoint {
  /** wall-cell index on the mesh */
  i: number;
  /** arc length from the stagnation point, m (positive towards increasing i) */
  s: number;
  x: number;
  y: number;
  /** angle between the outward surface normal and the direction the flow comes from, degrees (0 = facing it) */
  phi: number;
  pe: number;
  Te: number;
  ue: number;
  /** Lees ratio q/q₀ (for equal wall temperature) */
  ratio: number;
  /** heat-transfer coefficient, W/(m²·K) */
  H: number;
  /** adiabatic-wall temperature, K */
  Taw: number;
  /** heat flux into a wall at the reference temperature, W/m² */
  q: number;
}

export interface HeatingResult {
  /** stagnation point (sub-cell position from the computed pressure maximum) */
  stag: {
    i: number;
    x: number;
    y: number;
    pe: number;
    Te: number;
    rhoE: number;
    muE: number;
    /** edge-velocity gradient fitted to the solver, 1/s */
    beta: number;
    /** Newtonian estimate, 1/s */
    betaNewton: number;
    /** stagnation heat-transfer coefficient, W/(m²·K) */
    H: number;
    /** adiabatic-wall (= total) temperature, K */
    Taw: number;
    /** heat flux at the reference wall temperature, W/m² */
    q: number;
    /** heat flux into a cold wall (T_w → 0 K: the limit Sutton–Graves describes), W/m² */
    qCold: number;
    /** same, with the Newtonian velocity gradient instead of the computed one */
    qColdNewton: number;
    /** Sutton–Graves sphere value and its 2D conversion, cold wall, W/m² */
    qSG: number;
    qSG2D: number;
    /** radiative-equilibrium wall temperature: H (T_aw − T) = ε σ T⁴, K */
    Trad: number;
  };
  /** windward-face points, ordered by s */
  points: HeatingPoint[];
  /** reference wall temperature used for q, K */
  Tref: number;
  noseRadius: number;
  /** freestream Reynolds number based on the body height 2H, and Knudsen number based on the nose radius */
  reynolds: number;
  knudsen: number;
  notes: string[];
}

/** heat-transfer coefficient factor C·Pr^−0.6·√(ρμβ)·c_p, W/(m²·K) */
export function stagnationH(rhoE: number, muE: number, beta: number, C = C_CYLINDER): number {
  return C * Math.pow(PRANDTL, -0.6) * Math.sqrt(rhoE * muE * beta) * CP;
}

/** radiative-equilibrium temperature: solve H (Taw − T) = ε σ T⁴ by bisection */
export function radiativeEquilibrium(H: number, Taw: number, eps: number): number {
  if (eps <= 0) return Taw;
  let lo = 0;
  let hi = Taw;
  for (let k = 0; k < 100; k++) {
    const T = 0.5 * (lo + hi);
    if (H * (Taw - T) - eps * SIGMA_SB * T ** 4 > 0) lo = T;
    else hi = T;
  }
  return 0.5 * (lo + hi);
}

/**
 * Heating from a computed surface solution. `Tref` = wall temperature for the reported q (e.g. the initial
 * heat-shield temperature); the conduction model uses H and T_aw directly.
 */
export function computeHeating(surf: SurfaceData, c: SimConfig, Tref: number, emissivity = c.thermal.emissivity): HeatingResult {
  const ni = surf.p.length;
  const fs = freestreamOf(c);
  const Rn = noseRadius({ kind: c.body.kind, radius: c.body.radius, aspect: c.body.aspect });
  const a = (c.flow.angle * Math.PI) / 180;
  const fx = Math.cos(a);
  const fy = Math.sin(a);
  const R = GAS.R;

  // stagnation point: wall cell with the highest pressure, refined by a parabola through its neighbours
  let i0 = 0;
  for (let i = 1; i < ni; i++) if (surf.p[i] > surf.p[i0]) i0 = i;
  const im = (i0 + ni - 1) % ni;
  const ip = (i0 + 1) % ni;
  const denom = surf.p[im] - 2 * surf.p[i0] + surf.p[ip];
  const shift = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (surf.p[im] - surf.p[ip])) / denom)) : 0;

  // arc length along the wall measured from cell i0 (positive towards increasing i)
  const sArc = new Float64Array(ni);
  {
    const d = (i: number, k: number) => Math.hypot(surf.x[k] - surf.x[i], surf.y[k] - surf.y[i]);
    let acc = 0;
    for (let k = 1; k <= ni / 2; k++) {
      acc += d((i0 + k - 1) % ni, (i0 + k) % ni);
      sArc[(i0 + k) % ni] = acc;
    }
    acc = 0;
    for (let k = 1; k < ni / 2; k++) {
      acc -= d((i0 - k + 1 + ni) % ni, (i0 - k + ni) % ni);
      sArc[(i0 - k + ni) % ni] = acc;
    }
  }
  const ds0 = shift >= 0 ? sArc[ip] : -sArc[im];
  const s0 = shift * Math.abs(ds0); // sub-cell stagnation position along s

  const pe0 = surf.p[i0];
  const Te0 = surf.T[i0];
  const rhoE0 = pe0 / (R * Te0);
  const muE0 = sutherland(Te0);
  // edge-velocity gradient: least-squares fit uₑ = β |s − s0| over cells within 0.2 Rₙ of the stagnation point
  let num = 0;
  let den = 0;
  for (let i = 0; i < ni; i++) {
    const ds = Math.abs(sArc[i] - s0);
    if (ds > 0.2 * Rn || ds === 0) continue;
    num += ds * surf.ue[i];
    den += ds * ds;
  }
  const beta = den > 0 ? num / den : NaN;
  const betaNewton = (1 / Rn) * Math.sqrt((2 * Math.max(0, pe0 - fs.p)) / rhoE0);
  const T0 = fs.T + (0.5 * fs.V * fs.V) / CP;
  const H0 = stagnationH(rhoE0, muE0, beta);
  const Taw0 = T0;
  const qCold = H0 * Taw0;
  const qColdNewton = stagnationH(rhoE0, muE0, betaNewton) * Taw0;
  const qSG = SUTTON_GRAVES_K * Math.sqrt(fs.rho / Rn) * fs.V ** 3;

  // windward points: walk away from the stagnation point on both sides while the surface faces the flow
  const points: HeatingPoint[] = [];
  const normalPhi = (i: number) => {
    // surface normal at wall point i from the tangent through its neighbours
    const k0 = i;
    const tx = surf.x[(i + 1) % ni] - surf.x[(i - 1 + ni) % ni];
    const ty = surf.y[(i + 1) % ni] - surf.y[(i - 1 + ni) % ni];
    let nx = ty;
    let ny = -tx;
    // orient away from the body interior (the body centre is at the origin)
    if (nx * surf.x[k0] + ny * surf.y[k0] < 0) {
      nx = -nx;
      ny = -ny;
    }
    const l = Math.hypot(nx, ny);
    // angle between the normal and the upstream direction (−V∞)
    const cosphi = -(nx * fx + ny * fy) / l;
    return (Math.acos(Math.max(-1, Math.min(1, cosphi))) * 180) / Math.PI;
  };
  const sideWalk = (dir: 1 | -1) => {
    const out: HeatingPoint[] = [];
    let xi = 0;
    let prevS = s0;
    let prevF = 0; // ρμuₑ at the stagnation point = 0
    // cell i0 itself is represented by the stagnation record (its distance to the fitted stagnation point can be
    // arbitrarily small, which would make the local-similarity ratio ill-conditioned)
    for (let k = 1; k < ni / 2; k++) {
      const i = (i0 + dir * k + ni) % ni;
      const phi = normalPhi(i);
      if (phi >= 90) break;
      const sd = sArc[i];
      if ((sd - s0) * dir <= 0) continue;
      const pe = surf.p[i];
      const Te = surf.T[i];
      const rho = pe / (R * Te);
      const mu = sutherland(Te);
      const ue = surf.ue[i];
      const F = rho * mu * ue;
      xi += 0.5 * (F + prevF) * Math.abs(sd - prevS);
      prevS = sd;
      prevF = F;
      const ratio = xi > 0 ? F / Math.sqrt(2 * xi) / Math.sqrt(rhoE0 * muE0 * beta) : 1;
      const H = H0 * ratio;
      const Taw = Te + (RECOVERY * ue * ue) / (2 * CP);
      out.push({ i, s: sd - s0, x: surf.x[i], y: surf.y[i], phi, pe, Te, ue, ratio, H, Taw, q: H * (Taw - Tref) });
    }
    return out;
  };
  const neg = sideWalk(-1).reverse();
  const pos = sideWalk(1);
  points.push(
    ...neg,
    { i: i0, s: 0, x: surf.x[i0], y: surf.y[i0], phi: normalPhi(i0), pe: pe0, Te: Te0, ue: 0, ratio: 1, H: H0, Taw: Taw0, q: H0 * (Taw0 - Tref) },
    ...pos,
  );

  const muInf = sutherland(fs.T);
  const reynolds = (fs.rho * fs.V * 2 * c.body.radius) / muInf;
  const lambda = (muInf / fs.p) * Math.sqrt((Math.PI * R * fs.T) / 2);
  const knudsen = lambda / Rn;
  const notes: string[] = [];
  if (knudsen > 0.01) notes.push(`Knudsen number ${knudsen.toExponential(1)} > 0.01: the gas is too rarefied for continuum boundary-layer theory (slip effects); the heating estimate is unreliable.`);
  if (reynolds > 1e6)
    notes.push(`Reynolds number ${reynolds.toExponential(1)}: at such values the boundary layer may become turbulent away from the stagnation point, which this laminar model cannot represent (it does not predict transition).`);
  if (fs.mach < 1) notes.push('Subsonic flow: the stagnation-point formula still applies, but aerodynamic heating is small unless the total temperature exceeds the wall temperature substantially.');
  if (T0 > 2000) notes.push('Total temperature above ~2000 K: real air dissociates; calorically perfect gas overestimates edge temperatures, and the heating constant omits chemistry.');
  if (Math.abs(beta / betaNewton - 1) > 0.3 && fs.mach > 1.5) notes.push('The computed stagnation velocity gradient differs from the Newtonian estimate by more than 30 %; check mesh resolution near the nose.');

  return {
    stag: {
      i: i0,
      x: surf.x[i0],
      y: surf.y[i0],
      pe: pe0,
      Te: Te0,
      rhoE: rhoE0,
      muE: muE0,
      beta,
      betaNewton,
      H: H0,
      Taw: Taw0,
      q: H0 * (Taw0 - Tref),
      qCold,
      qColdNewton,
      qSG,
      qSG2D: qSG / Math.SQRT2,
      Trad: radiativeEquilibrium(H0, Taw0, emissivity),
    },
    points,
    Tref,
    noseRadius: Rn,
    reynolds,
    knudsen,
    notes,
  };
}
