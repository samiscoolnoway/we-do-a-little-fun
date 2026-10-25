import { AxiEuler, polarGrid } from './axisym';
import { freestream, normalShock, pitotPressure, stagnationTemperature } from './gas';

/**
 * RESEARCH PROTOTYPE — steady inviscid supersonic flow around a sphere with the axisymmetric solver (axisym.ts), as an
 * independent reference for the Cartesian 3D sphere case (sphere3d.ts). See docs/axisymmetric-reference.md.
 *
 * Grid: body-fitted spherical-polar, ρ ∈ [R, outer·R], θ ∈ [0, thetaMax] from the upstream stagnation line, uniform
 * radial spacing h = R / radiusCells and angular spacing chosen so that the tangential spacing at the wall, R Δθ,
 * is `aspect`·h. Boundaries: slip wall on the sphere (iMin), freestream on the outer arc (iMax; valid while the bow
 * shock stays inside, which is checked), symmetry axis (jMin, θ = 0), extrapolation outflow at θ = thetaMax (jMax;
 * valid while the flow leaving there is supersonic, which is checked). Same freestream, gas, start-up and convergence
 * criteria as the 3D case.
 */
export interface AxiSphereOptions {
  mach: number;
  /** R / h with h the radial spacing (uniform) */
  radiusCells: number;
  /** outer radius of the domain in sphere radii (default 5: the bow shock stays inside up to thetaMax = 95°) */
  outer?: number;
  /** angular extent from the stagnation line, degrees (default 95) */
  thetaMaxDeg?: number;
  /** tangential / radial spacing at the wall (default 1) */
  aspect?: number;
  flux?: 'rusanov' | 'hllc';
  /** CFL number of the local time steps (default 0.4: at 0.8 the second-order scheme stalls in a limit cycle near
   *  the outer bow shock (residual stuck about 2 orders down) with the same standoff as the converged CFL 0.4 run) */
  cfl?: number;
  startupSteps?: number;
  maxSteps?: number;
  /** stop when the residual in x < 0 has dropped this many orders … */
  residualDrop?: number;
  /** … and |net boundary mass flux| is below this fraction of the intercepted mass flux ρ∞V∞R²/2 (per radian) */
  massBalanceTol?: number;
  Tinf?: number;
  pinf?: number;
}

export interface AxiShockDetectors {
  /** distance of the sphere surface from the centre (= R) and the polar angle of the measurement ray (centroids of
   *  the first row of cells next to the axis) */
  R: number;
  rayAngleDeg: number;
  rho2OverRhoInf: number;
  /** stagnation-line cells from the outer boundary down to the wall: distance d = ρ_c − R from the sphere surface,
   *  ρ/ρ∞, φ = (ρ − ρ∞)/(ρ₂ − ρ∞) */
  profile: { d: number; rho: number; phi: number }[];
  /** first crossing of φ = level coming from upstream, linear in d between consecutive centroids */
  crossings: { level: number; k: number; standoff: number }[];
  /** steepest density rise between consecutive centroids, parabolic refinement (≤ half a cell) */
  maxGradient: { k: number; standoff: number; rise: number };
  /** equal-area position of a step from φ = 0 to 1 holding the same integrated jump (φ capped at 1, summed from
   *  upstream to the first cell with φ ≥ 1) */
  equalArea: number;
}

export interface AxiSphereResult {
  grid: { ni: number; nj: number; cells: number; hRadial: number; tangentialAtWall: number; tangentialAtShock: number; outer: number; thetaMaxDeg: number };
  steps: number;
  converged: boolean;
  dropFront: number;
  massImbalance: number;
  /** mass flux through the sphere surface / intercepted (exactly 0 by construction) */
  bodyFluxFraction: number;
  ms: number;
  failure: string | null;
  minRho: number;
  minP: number;
  reconstructionFallbacks: number;
  hllcFallbacks: number;
  hllcFallbackFraction: number;
  /** nose cell (first cell on the stagnation line): p / pitot, T / T0, local total pressure / pitot, Mach */
  nose: { pRatio: number; TRatio: number; p0Ratio: number; mach: number; d: number };
  /** front-wall cells (x < 0), weighted by wall area: local total pressure / pitot and |T0,loc/T0 − 1| */
  wall: { cells: number; p0Mean: number; p0Min: number; p0Max: number; T0MaxError: number };
  /** largest relative density deviation from the freestream in the outermost ring (bow shock inside the domain) */
  outerRingDeviation: number;
  /** smallest Mach number and smallest outward normal Mach number of the cells at the outflow boundary */
  outflowMinMach: number;
  outflowMinNormalMach: number;
  shock: AxiShockDetectors;
  standoff: number;
  billig: number;
  history: number[];
}

export function runAxiSphereCase(o: AxiSphereOptions): AxiSphereResult {
  const R = 1;
  const N = o.radiusCells;
  const h = R / N;
  const outer = o.outer ?? 5;
  const thetaMaxDeg = o.thetaMaxDeg ?? 95;
  const thMax = (thetaMaxDeg * Math.PI) / 180;
  const ni = Math.round((outer - 1) * N);
  const nj = Math.round((thMax * N) / (o.aspect ?? 1));
  if (o.mach <= 1) throw new Error('the sphere case uses a supersonic-inflow boundary: Mach must exceed 1');
  const fs = freestream(o.mach, o.Tinf ?? 220, o.pinf ?? 2500, 0);
  const fsAxi = { rho: fs.rho, u: fs.u, v: 0, p: fs.p };
  const s = new AxiEuler(polarGrid(R, outer * R, 0, thMax, ni, nj), {
    cfl: o.cfl ?? 0.4,
    order: 1,
    flux: o.flux,
    timeMode: 'local',
    bc: { iMin: { type: 'wall' }, iMax: { type: 'inflow', state: () => fsAxi }, jMin: { type: 'axis' }, jMax: { type: 'outflow' } },
    residualRegion: (x) => x < 0,
  });
  s.init(() => fsAxi);
  const startup = o.startupSteps ?? 150;
  const maxSteps = o.maxSteps ?? 40000;
  const target = o.residualDrop ?? 4;
  const tol = o.massBalanceTol ?? 1e-3;
  const intercepted = 0.5 * fs.rho * fs.V * R * R;
  let ref = 0;
  let drop = 0;
  let imbalance = Infinity;
  let converged = false;
  let minRho = Infinity;
  let minP = Infinity;
  let fallbacks = 0;
  const history: number[] = [];
  const t0 = performance.now();
  for (let n = 0; n < maxSteps; n++) {
    if (n === startup) s.setOrder(2);
    const r = s.step();
    if (!r.ok) break;
    fallbacks += s.fallbacks;
    minRho = Math.min(minRho, s.minRho);
    minP = Math.min(minP, s.minP);
    history.push(r.residualRegion);
    if (n < 5) ref = Math.max(ref, r.residualRegion);
    drop = Math.log10(ref / r.residualRegion);
    const b = s.boundaryMassFlux;
    imbalance = Math.abs(b.iMin + b.iMax + b.jMin + b.jMax) / intercepted;
    if (n > startup + 20 && drop >= target && imbalance < tol) {
      converged = true;
      break;
    }
  }
  const ms = performance.now() - t0;
  const g = s.gamma;
  const pit = pitotPressure(fs.p, o.mach);
  const T0 = stagnationTemperature(fs.T, o.mach);
  const rho2 = fs.rho * normalShock(o.mach).r21;
  const local = (i: number, j: number) => {
    const c = s.cell(i, j);
    const f = 1 + 0.5 * (g - 1) * c.mach * c.mach;
    return { ...c, p0: (c.p * Math.pow(f, g / (g - 1))) / pit, T0: (c.T * f) / T0 };
  };

  // stagnation line: row j = 0, from the outer boundary (upstream) to the wall
  const profile: { d: number; rho: number; phi: number }[] = [];
  for (let i = ni - 1; i >= 0; i--) {
    const c = i;
    const rho = s.cell(i, 0).rho;
    profile.push({ d: Math.hypot(s.xc[c], s.rc[c]) - R, rho: rho / fs.rho, phi: (rho - fs.rho) / (rho2 - fs.rho) });
  }
  const crossings = [0.1, 0.5, 0.9].map((level) => {
    for (let k = 1; k < profile.length; k++) {
      const a = profile[k - 1];
      const b = profile[k];
      if (a.phi < level && b.phi >= level) return { level, k, standoff: a.d + ((b.d - a.d) * (level - a.phi)) / (b.phi - a.phi) };
    }
    return { level, k: -1, standoff: NaN };
  });
  const rise = (k: number) => (k >= 1 && k < profile.length ? profile[k].rho - profile[k - 1].rho : -Infinity);
  let kMax = 1;
  for (let k = 2; k < profile.length; k++) if (rise(k) > rise(kMax)) kMax = k;
  const [dm, d0, dp] = [rise(kMax - 1), rise(kMax), rise(kMax + 1)];
  let off = 0;
  if (Number.isFinite(dm) && Number.isFinite(dp) && dm - 2 * d0 + dp < 0) off = Math.max(-0.5, Math.min(0.5, (0.5 * (dm - dp)) / (dm - 2 * d0 + dp)));
  // face between k − 1 and k, moved by `off` cells downstream (towards the wall: d decreases)
  const gradStandoff = 0.5 * (profile[kMax - 1].d + profile[kMax].d) - off * h;
  let sum = 0;
  let last = 0;
  for (let k = 0; k < profile.length; k++) {
    sum += Math.min(Math.max(profile[k].phi, 0), 1);
    last = k;
    if (profile[k].phi >= 1) break;
  }
  const equalArea = profile[last].d - 0.5 * h + h * sum;
  const rayAngleDeg = (Math.atan2(s.rc[0], -s.xc[0]) * 180) / Math.PI;

  // nose cell and front wall
  const nose = local(0, 0);
  let wa = 0;
  let p0w = 0;
  let p0Min = Infinity;
  let p0Max = 0;
  let T0Max = 0;
  let wallCells = 0;
  for (let j = 0; j < nj; j++) {
    if (s.xc[j * ni] >= 0) continue;
    const a = s.boundaryFace('iMin', j).area;
    const c = local(0, j);
    wa += a;
    p0w += a * c.p0;
    p0Min = Math.min(p0Min, c.p0);
    p0Max = Math.max(p0Max, c.p0);
    T0Max = Math.max(T0Max, Math.abs(c.T0 - 1));
    wallCells++;
  }
  let outerDev = 0;
  for (let j = 0; j < nj; j++) outerDev = Math.max(outerDev, Math.abs(s.cell(ni - 1, j).rho / fs.rho - 1));
  let outMin = Infinity;
  let outMinN = Infinity;
  for (let i = 0; i < ni; i++) {
    const c = s.cell(i, nj - 1);
    const f = s.boundaryFace('jMax', i);
    const a = Math.sqrt((g * c.p) / c.rho);
    outMin = Math.min(outMin, c.mach);
    outMinN = Math.min(outMinN, (c.u * f.nx + c.v * f.nr) / a);
  }
  const billig = 0.143 * Math.exp(3.24 / (o.mach * o.mach));
  return {
    grid: { ni, nj, cells: ni * nj, hRadial: h, tangentialAtWall: (R * thMax) / nj, tangentialAtShock: ((R + (crossings[1].standoff || 0)) * thMax) / nj, outer, thetaMaxDeg },
    steps: s.steps,
    converged,
    dropFront: drop,
    massImbalance: imbalance,
    bodyFluxFraction: s.boundaryMassFlux.iMin / intercepted,
    ms,
    failure: s.failure ? `${s.failure.reason} at (${s.failure.i}, ${s.failure.j})` : null,
    minRho,
    minP,
    reconstructionFallbacks: fallbacks,
    hllcFallbacks: s.hllcFallbacksTotal,
    hllcFallbackFraction: s.hllcCalls ? s.hllcFallbacksTotal / s.hllcCalls : 0,
    nose: { pRatio: nose.p / pit, TRatio: nose.T / T0, p0Ratio: nose.p0, mach: nose.mach, d: profile[profile.length - 1].d },
    wall: { cells: wallCells, p0Mean: p0w / wa, p0Min, p0Max, T0MaxError: T0Max },
    outerRingDeviation: outerDev,
    outflowMinMach: outMin,
    outflowMinNormalMach: outMinN,
    shock: {
      R,
      rayAngleDeg,
      rho2OverRhoInf: rho2 / fs.rho,
      profile,
      crossings,
      maxGradient: { k: kMax, standoff: gradStandoff, rise: d0 },
      equalArea,
    },
    standoff: crossings[1].standoff,
    billig,
    history,
  };
}
