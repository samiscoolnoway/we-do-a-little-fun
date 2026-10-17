import { EulerSolver3D, makeBoxGrid } from './euler3d';
import { freestream, normalShock, pitotPressure, stagnationTemperature } from './gas';

/**
 * PROTOTYPE — steady supersonic inviscid flow around a sphere with the 3D Euler solver (euler3d.ts).
 *
 * The sphere (radius R, centre at the origin) sits in a Cartesian box; at zero incidence the flow is
 * axisymmetric, so only the quarter y ≥ 0, z ≥ 0 is computed, with the planes y = 0 and z = 0 as symmetry planes
 * (slip walls). Boundaries: supersonic inflow (freestream) at x_min, zero-gradient extrapolation at x_max, y_max,
 * z_max. Impulsive start from the freestream, first-order start-up, then second order; local time stepping.
 *
 * Comparisons that are meaningful for an inviscid, calorically perfect gas:
 *  - stagnation pressure vs the Rayleigh pitot formula (exact: normal shock + isentropic compression);
 *  - stagnation temperature vs T0 = T(1 + (γ−1)/2 M²) (exact: total enthalpy is conserved);
 *  - flow ahead of the bow shock unchanged (exact: no upstream influence in supersonic flow);
 *  - bow-shock standoff vs Billig's correlation for spheres, Δ/R = 0.143 exp(3.24/M²) (F. S. Billig,
 *    J. Spacecraft Rockets 4(6), 1967): an empirical fit to experiments, not exact theory.
 * Not meaningful here: drag, base pressure and the wake (no viscosity, so no physical separation), heat transfer.
 * Wall treatment: the ghost-cell method by default; 'cutcell' selects the experimental conservative cut cells.
 */
export interface SphereCaseOptions {
  mach: number;
  /** wall treatment: the ghost-cell reflection method (default) or experimental conservative cut cells */
  wall?: 'cutcell' | 'ghost';
  /** cut cells only: reconstruction next to the body (see ImmersedSphere.reconstruction) */
  reconstruction?: 'ghost' | 'firstorder';
  /** sphere radius in cells (the grid is uniform: h = R / radiusCells) */
  radiusCells: number;
  /** domain extents in sphere radii: upstream of the centre, downstream of it, and laterally (y and z) */
  upstream?: number;
  downstream?: number;
  lateral?: number;
  cfl?: number;
  startupSteps?: number;
  maxSteps?: number;
  /** stop when the residual ahead of the sphere centre (x < 0) has dropped this many orders of magnitude … */
  residualDrop?: number;
  /** … and the domain's mass balance has closed: |outer-boundary + body mass flux| below this fraction of the
   *  mass flux the body intercepts (a steady state has dM/dt = 0) */
  massBalanceTol?: number;
  Tinf?: number;
  pinf?: number;
}

export interface SphereCaseResult {
  grid: { nx: number; ny: number; nz: number; h: number; cells: number; fluidCells: number };
  steps: number;
  converged: boolean;
  /** |outer-boundary + body mass flux| / intercepted mass flux at the end (dM/dt; → 0 in a steady state) */
  massImbalance: number;
  /** orders of magnitude the residual (x < 0 region / whole domain) dropped below its largest early value */
  dropFront: number;
  dropAll: number;
  ms: number;
  failure: string | null;
  /** p and T in the fluid cell next to the nose on the stagnation line, and their exact references */
  pStag: number;
  pPitot: number;
  TStag: number;
  T0: number;
  /** bow-shock standoff Δ/R from the computed density on the stagnation line, and the Billig correlation */
  standoff: number;
  billig: number;
  /** width of the captured bow shock on the stagnation line (10 % → 90 % of the density rise), in cells */
  shockWidthCells: number;
  /** largest relative deviation from the freestream in cells more than 5 h upstream of the shock, and where */
  upstreamDeviation: number;
  upstreamDeviationAt: [number, number, number];
  /** net body mass flux (immersed-boundary conservation error) relative to the mass flux the quarter sphere
   *  intercepts, ρ∞ V∞ π R² / 4 */
  bodyFluxFraction: number;
  /** net mass flux into the domain through its outer boundaries, same normalisation; in a converged steady state
   *  it balances the body flux (outer + body = dM/dt ≈ 0) */
  boundaryFluxFraction: number;
  /** largest |ρ(i,j,k) − ρ(i,k,j)| / ρ∞ (y ↔ z mirror symmetry of the axisymmetric flow) */
  symmetryError: number;
  /** the last fluid cells on the stagnation line (nearest the wall last): p / pitot, local total pressure / pitot,
   *  Mach number and fluid volume fraction (a local total-pressure deficit is entropy produced near the wall) */
  stagLine: { pRatio: number; p0Ratio: number; mach: number; alpha: number }[];
  /** residual history (front region) for reporting */
  history: number[];
}

/** Billig's empirical bow-shock standoff for spheres, Δ/R */
export const billigSphere = (mach: number) => 0.143 * Math.exp(3.24 / (mach * mach));

export function runSphereCase(o: SphereCaseOptions): SphereCaseResult {
  const R = 1;
  const h = R / o.radiusCells;
  const up = o.upstream ?? 2;
  const down = o.downstream ?? 1.5;
  const lat = o.lateral ?? 2.5;
  const nx = Math.round((up + down) * o.radiusCells);
  const nyz = Math.round(lat * o.radiusCells);
  const grid = makeBoxGrid(-up * R, -up * R + nx * h, 0, nyz * h, 0, nyz * h, nx, nyz, nyz);
  const fs = freestream(o.mach, o.Tinf ?? 220, o.pinf ?? 2500, 0);
  const fs3 = { rho: fs.rho, u: fs.u, v: 0, w: 0, p: fs.p };
  if (o.mach <= 1) throw new Error('the sphere case uses a supersonic-inflow boundary: Mach must exceed 1');
  const s = new EulerSolver3D(grid, {
    cfl: o.cfl ?? 0.8,
    order: 1,
    timeMode: 'local',
    freestream: fs3,
    sphere: { cx: 0, cy: 0, cz: 0, r: R, wall: o.wall ?? 'ghost', reconstruction: o.reconstruction },
    bc: { xmin: 'inflow', xmax: 'extrapolate', ymin: 'wall', ymax: 'extrapolate', zmin: 'wall', zmax: 'extrapolate' },
    residualRegion: (x) => x < 0,
  });
  s.init(() => fs3);
  const startup = o.startupSteps ?? 150;
  const maxSteps = o.maxSteps ?? 4000;
  const target = o.residualDrop ?? 4;
  const massTol = o.massBalanceTol ?? 1e-3;
  const intercepted = fs.rho * fs.V * Math.PI * R * R * 0.25;
  let imbalance = Infinity;
  let refFront = 0;
  let refAll = 0;
  let dropFront = 0;
  let dropAll = 0;
  const history: number[] = [];
  const t0 = performance.now();
  let converged = false;
  for (let n = 0; n < maxSteps; n++) {
    if (n === startup) s.setOrder(2);
    const r = s.step();
    if (!r.ok) break;
    history.push(r.residualRegion);
    if (n < 5) {
      refFront = Math.max(refFront, r.residualRegion);
      refAll = Math.max(refAll, r.residual);
    }
    dropFront = Math.log10(refFront / r.residualRegion);
    dropAll = Math.log10(refAll / r.residual);
    imbalance = Math.abs(s.boundaryMassFlux + s.bodyMassFlux) / intercepted;
    if (n > startup + 20 && dropFront >= target && imbalance < massTol) {
      converged = true;
      break;
    }
  }
  const ms = performance.now() - t0;

  // stagnation line: the cells j = 0, k = 0 (centres at y = z = h/2, next to the axis)
  let iNose = 0;
  for (let i = 0; i < nx; i++) {
    if (s.isSolid(i, 0, 0)) break;
    iNose = i;
  }
  const stag = s.cell(iNose, 0, 0);
  const pit = pitotPressure(fs.p, o.mach);
  const g = 1.4;
  const stagLine = [iNose - 2, iNose - 1, iNose].filter((i) => i >= 0).map((i) => {
    const c = s.cell(i, 0, 0);
    return { pRatio: c.p / pit, p0Ratio: (c.p * Math.pow(1 + 0.5 * (g - 1) * c.mach ** 2, g / (g - 1))) / pit, mach: c.mach, alpha: s.fluidFraction(i, 0, 0) };
  });
  const rho2 = fs.rho * normalShock(o.mach).r21;
  const mid = 0.5 * (fs.rho + rho2);
  let xShock = NaN;
  let iShock = 0;
  for (let i = 1; i <= iNose; i++) {
    const a = s.cell(i - 1, 0, 0).rho;
    const b = s.cell(i, 0, 0).rho;
    if (a < mid && b >= mid) {
      const xa = s.centre(i - 1, 0, 0)[0];
      xShock = xa + ((mid - a) / (b - a)) * h;
      iShock = i;
      break;
    }
  }
  // shock width: where the density passes 10 % and 90 % of the jump to the normal-shock value
  const crossing = (level: number) => {
    for (let i = 1; i <= iNose; i++) {
      const a = s.cell(i - 1, 0, 0).rho;
      const b = s.cell(i, 0, 0).rho;
      if (a < level && b >= level) return i - 1 + (level - a) / (b - a);
    }
    return NaN;
  };
  const shockWidthCells = crossing(fs.rho + 0.9 * (rho2 - fs.rho)) - crossing(fs.rho + 0.1 * (rho2 - fs.rho));
  const yNose = 0.5 * h;
  const xNose = -Math.sqrt(R * R - 2 * yNose * yNose); // the surface at y = z = h/2
  let upstreamDeviation = 0;
  let upstreamDeviationAt: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < nyz; k++)
    for (let j = 0; j < nyz; j++)
      for (let i = 0; i < Math.max(0, iShock - 5); i++) {
        const c = s.cell(i, j, k);
        const dev = Math.max(Math.abs(c.rho / fs.rho - 1), Math.abs(c.p / fs.p - 1), Math.abs(c.u / fs.u - 1));
        if (dev > upstreamDeviation) {
          upstreamDeviation = dev;
          upstreamDeviationAt = s.centre(i, j, k);
        }
      }
  let symmetryError = 0;
  for (let k = 0; k < nyz; k++)
    for (let j = 0; j < nyz; j++)
      for (let i = 0; i < nx; i++) {
        if (s.isSolid(i, j, k)) continue;
        symmetryError = Math.max(symmetryError, Math.abs(s.cell(i, j, k).rho - s.cell(i, k, j).rho) / fs.rho);
      }
  return {
    grid: { nx, ny: nyz, nz: nyz, h, cells: nx * nyz * nyz, fluidCells: s.fluidCells },
    steps: s.steps,
    converged,
    dropFront,
    dropAll,
    ms,
    failure: s.failure ? `${s.failure.reason} at (${s.failure.i}, ${s.failure.j}, ${s.failure.k})` : null,
    pStag: stag.p,
    pPitot: pitotPressure(fs.p, o.mach),
    TStag: stag.T,
    T0: stagnationTemperature(fs.T, o.mach),
    standoff: (xNose - xShock) / R,
    billig: billigSphere(o.mach),
    shockWidthCells,
    upstreamDeviation,
    upstreamDeviationAt,
    bodyFluxFraction: s.bodyMassFlux / intercepted,
    boundaryFluxFraction: s.boundaryMassFlux / intercepted,
    massImbalance: imbalance,
    symmetryError,
    stagLine,
    history,
  };
}
