import { crc32 } from './crc32';
import { GAS } from './gas';

/**
 * PROTOTYPE — three-dimensional compressible Euler equations on a uniform Cartesian box.
 *
 *   ∂/∂t ∫_cell U dV + ∮_∂cell F(U)·n dA = 0,   U = (ρ, ρu, ρv, ρw, E),   p = (γ − 1)(E − ½ρ|V|²)
 *
 * This is the first, deliberately small step towards a 3D aerothermodynamic solver. It uses the same numerical
 * choices as the 2D solver in euler.ts, so the two can be compared directly:
 *  - finite volumes: each cell stores the average of U; whatever leaves one cell through a face enters its
 *    neighbour, so mass, momentum and energy are conserved to round-off except through the domain boundaries;
 *  - Rusanov (local Lax–Friedrichs) flux on every face;
 *  - first order, or second-order MUSCL reconstruction of (ρ, u, v, w, p) with the minmod limiter along each
 *    axis; a face whose reconstructed state would have ρ ≤ 0 or p ≤ 0 falls back to first order (counted);
 *  - two-stage SSP Runge–Kutta (Heun) with the CFL time step Δt = CFL / max_cells Σ_d (|u_d| + a)/Δx_d;
 *  - two ghost layers per side: periodic, zero-gradient extrapolation, or slip wall (normal velocity mirrored);
 *  - density and pressure are checked after every stage: a non-physical value stops the solver, restores the
 *    state from before the step and records where it happened. Nothing is clipped.
 *
 * Optional, for steady flow around a body:
 *  - an immersed sphere, represented with the ghost-cell (reflection) immersed-boundary method: cells whose
 *    centre lies inside the sphere are solid; the solid cells that the flux stencils of fluid cells reach get a
 *    ghost state each stage, mirrored across the true sphere surface: ρ and p are interpolated (trilinearly, from
 *    fluid cells only) at the image point x_I = x_c + 2d·n, and the normal velocity component is reversed. The
 *    unchanged Cartesian fluxes then see a slip wall with the right orientation. This is not exactly conservative:
 *    the net mass flux through the body faces is measured every step (bodyMassFlux) and should be judged against
 *    the mass flux the body intercepts. It neglects the wall-normal pressure gradient from surface curvature;
 *  - or, experimentally, the same sphere as conservative cut cells (no mass crosses the body; see ImmersedSphere);
 *  - a supersonic-inflow boundary ('inflow': the freestream state in the ghost cells, valid only where the flow
 *    entering the domain is supersonic);
 *  - local time stepping (each cell its own CFL step; only the converged steady state is meaningful).
 *
 * Not included (yet): other bodies, subsonic far-field (characteristic) boundaries, implicit time
 * stepping, viscosity, turbulence, heat transfer, a Web Worker or any visualisation. It is not used by the app.
 */
export type BC3D = 'periodic' | 'extrapolate' | 'wall' | 'inflow';

/**
 * sphere immersed in the Cartesian grid: centre and radius, m, and the wall treatment:
 *  - 'ghost' (default): ghost-cell reflection method (not exactly conservative; see bodyMassFlux);
 *  - 'cutcell': conservative cut cells. Cells cut by the surface keep only their fluid part (volume fraction α,
 *    face apertures β, sampled from the exact sphere); each cut cell gets one wall face whose area vector closes
 *    the cell, A_w n_w = −Σ β A e_out, so a uniform state at rest is preserved exactly. The wall flux carries
 *    only the pressure from the exact wall Riemann problem (shock if the gas moves towards the wall, rarefaction
 *    if away): no mass and no energy cross the body, by construction. Faces whose second-order stencil reaches
 *    into the body read the ghost-cell reflection states inside the solid (reconstruction 'ghost', default) or
 *    drop to first order ('firstorder'); either way the faces into the body have aperture 0 and carry no flux.
 *    With 'ghost' reconstruction the wall pressure also uses a second-order wall state: the wall-normal velocity
 *    is extrapolated to the wall with the minmod of the slope from the cell behind and the slope to the mirror
 *    state, as the ghost method's MUSCL step does (a cell-centre velocity fed to the wall Riemann problem would
 *    add a first-order impact pressure ρ a u_n). Cells with α < 0.01 are dropped. Cut cells with α < 0.5 are
 *    merged with the neighbour(s) facing away from the wall (merge, default true; see buildMergeGroups), which
 *    removes slivers as independent unknowns; unmerged small cells keep small stable time steps, so a global time
 *    step becomes tiny: use local time stepping for steady states. EXPERIMENTAL: exactly conservative, with
 *    near-wall errors comparable to 'ghost' on coarse grids; see docs/engineering-lab.md.
 */
export interface ImmersedSphere {
  cx: number;
  cy: number;
  cz: number;
  r: number;
  wall?: 'ghost' | 'cutcell';
  /** cut cells: second-order reconstruction next to the body using ghost reflection states in the stencil
   *  ('ghost', default) or first order on faces whose stencil reaches into the body ('firstorder') */
  reconstruction?: 'ghost' | 'firstorder';
  /** cut cells: merge every small cut cell (α < 0.5) with the neighbour(s) that face away from the wall
   *  (default true; false keeps every cut cell independent) */
  merge?: boolean;
}

export interface Grid3D {
  nx: number;
  ny: number;
  nz: number;
  /** lower corner of the box, m */
  x0: number;
  y0: number;
  z0: number;
  /** cell sizes, m */
  dx: number;
  dy: number;
  dz: number;
}

export function makeBoxGrid(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, nx: number, ny: number, nz: number): Grid3D {
  if (nx < 2 || ny < 2 || nz < 2) throw new Error('the 3D solver needs at least 2 cells in each direction');
  return { nx, ny, nz, x0, y0, z0, dx: (x1 - x0) / nx, dy: (y1 - y0) / ny, dz: (z1 - z0) / nz };
}

export interface Primitive3D {
  rho: number;
  u: number;
  v: number;
  w: number;
  p: number;
}

export interface Solver3DOptions {
  gamma?: number;
  cfl: number;
  order: 1 | 2;
  bc: { xmin: BC3D; xmax: BC3D; ymin: BC3D; ymax: BC3D; zmin: BC3D; zmax: BC3D };
  /** state imposed by 'inflow' boundaries */
  freestream?: Primitive3D;
  /** 'global' (default): one time-accurate Δt; 'local': each cell its own Δt (steady states only) */
  timeMode?: 'global' | 'local';
  /** optional immersed sphere (ghost-cell immersed boundary) */
  sphere?: ImmersedSphere;
  /** optional sub-region for a second residual (e.g. the flow ahead of a body), evaluated at cell centres */
  residualRegion?: (x: number, y: number, z: number) => boolean;
  /** numerical flux: 'rusanov' (default) or 'hllc' (EXPERIMENTAL; falls back to Rusanov on the same face states
   *  whenever its intermediate states are inadmissible, counted in hllcFallbacks) */
  flux?: 'rusanov' | 'hllc';
}

export interface Failure3D {
  step: number;
  stage: number;
  i: number;
  j: number;
  k: number;
  rho: number;
  p: number;
  reason: string;
}

export interface Step3DResult {
  ok: boolean;
  dt: number;
  /** RMS over fluid cells of ∂ρ/∂t at the start of the step, kg/(m³·s) */
  residual: number;
  /** the same RMS over the fluid cells of `residualRegion` (NaN without one) */
  residualRegion: number;
}

const NV = 5;
/** cut cells with a fluid volume fraction below this are merged with a neighbour (merge option) */
const MERGE_ALPHA = 0.5;
/** cut cells with a smaller fluid volume fraction are dropped (made solid): 5 of the 512 volume samples */
const DROP_ALPHA = 0.01;
/** most neighbours kept in a wall-state stencil (tied axes and tied mirror members) */
const WALL_NB = 6;

/**
 * Revision of the solver's numerical trajectory, stored in checkpoints (checkpoint3d.ts). Bump it whenever a change
 * makes the same inputs produce a different sequence of states, so old checkpoints are refused instead of being
 * continued by different numerics.
 */
export const SOLVER3D_STATE_REVISION = 1;

/**
 * Everything a solver carries from one step to the next (see docs/checkpoint-restart/DESIGN.md): the conservative
 * variables (padded arrays, ghost entries included) and the counters. All other work arrays are rebuilt within
 * each step before they are read, and the geometry is rebuilt by the constructor.
 */
export interface Solver3DState {
  revision: number;
  U: Float64Array[];
  steps: number;
  time: number;
  lastDt: number;
  order: 1 | 2;
  hllcFallbacksTotal: number;
  hllcCalls: number;
}

export class EulerSolver3D {
  readonly grid: Grid3D;
  opts: Solver3DOptions;
  readonly gamma: number;
  /** padded sizes (two ghost layers on each side) and strides */
  private readonly px: number;
  private readonly py: number;
  private readonly pz: number;
  private readonly sy: number;
  private readonly sz: number;
  /** conservative state, padded layout: U[v][P(i, j, k)] */
  U: Float64Array[];
  private U0: Float64Array[];
  private Ubackup: Float64Array[];
  /** primitive work arrays, padded */
  private r: Float64Array;
  private q: Float64Array[]; // velocity components u, v, w
  private p: Float64Array;
  private res: Float64Array[];
  private f = new Float64Array(NV);

  /**
   * HLLC flux (Toro, Spruce & Speares 1994; star states as in Batten et al. 1997) × area into this.f, with the
   * Einfeldt wave-speed estimates S_L = min(u_L − a_L, ũ − ã), S_R = max(u_R + a_R, ũ + ã) (Roe averages). Returns
   * false (this.f then holds garbage and is overwritten by the caller) when the result would not be admissible: Roe-averaged sound speed² ≤ 0, a
   * vanishing mass-flux denominator (near vacuum), S* outside (S_L, S_R), a star density or star pressure ≤ 0, or
   * a non-finite value. The caller then uses the Rusanov flux of the same states.
   */
  private hllc(axis: number, rL: number, uL: number, vL: number, wL: number, pL: number, EL: number, rR: number, uR: number, vR: number, wR: number, pR: number, ER: number, area: number): boolean {
    const g = this.gamma;
    const unL = axis === 0 ? uL : axis === 1 ? vL : wL;
    const unR = axis === 0 ? uR : axis === 1 ? vR : wR;
    const aL = Math.sqrt((g * pL) / rL);
    const aR = Math.sqrt((g * pR) / rR);
    const sl = Math.sqrt(rL);
    const sr = Math.sqrt(rR);
    const wl = sl / (sl + sr);
    const wr = 1 - wl;
    const ut = wl * uL + wr * uR;
    const vt = wl * vL + wr * vR;
    const wt = wl * wL + wr * wR;
    const Ht = (wl * (EL + pL)) / rL + (wr * (ER + pR)) / rR;
    const a2 = (g - 1) * (Ht - 0.5 * (ut * ut + vt * vt + wt * wt));
    if (!(a2 > 0)) return false;
    const at = Math.sqrt(a2);
    const unt = axis === 0 ? ut : axis === 1 ? vt : wt;
    const SL = Math.min(unL - aL, unt - at);
    const SR = Math.max(unR + aR, unt + at);
    const mL = rL * (SL - unL); // < 0
    const mR = rR * (SR - unR); // > 0
    const den = mL - mR;
    if (!(den < -1e-12 * (Math.abs(mL) + Math.abs(mR)))) return false;
    const Ss = (pR - pL + mL * unL - mR * unR) / den;
    if (!(Ss > SL && Ss < SR)) return false;
    const pStar = pL + mL * (Ss - unL);
    if (!(pStar > 0)) return false;
    const f = this.f;
    // the side whose fan contains x/t = 0: its physical flux, plus S_K (U*_K − U_K) inside the star region
    const left = Ss >= 0;
    const r = left ? rL : rR;
    const u = left ? uL : uR;
    const v = left ? vL : vR;
    const w = left ? wL : wR;
    const p = left ? pL : pR;
    const E = left ? EL : ER;
    const un = left ? unL : unR;
    const S = left ? SL : SR;
    const m = left ? mL : mR;
    f[0] = r * un;
    f[1] = r * u * un + (axis === 0 ? p : 0);
    f[2] = r * v * un + (axis === 1 ? p : 0);
    f[3] = r * w * un + (axis === 2 ? p : 0);
    f[4] = (E + p) * un;
    if ((left && SL < 0) || (!left && SR > 0)) {
      const rs = m / (S - Ss);
      if (!(rs > 0)) return false;
      const Es = rs * (E / r + (Ss - un) * (Ss + p / m));
      const mom = [rs * u, rs * v, rs * w];
      mom[axis] = rs * Ss;
      f[0] += S * (rs - r);
      f[1] += S * (mom[0] - r * u);
      f[2] += S * (mom[1] - r * v);
      f[3] += S * (mom[2] - r * w);
      f[4] += S * (Es - E);
    }
    for (let q = 0; q < NV; q++) {
      f[q] *= area;
      if (!Number.isFinite(f[q])) return false;
    }
    return true;
  }
  time = 0;
  steps = 0;
  lastDt = 0;
  /** faces that fell back to first order during the last step */
  fallbacks = 0;
  /** HLLC faces that fell back to the Rusanov flux during the last step, and in total since construction, and the
   *  total number of HLLC flux evaluations */
  hllcFallbacks = 0;
  hllcFallbacksTotal = 0;
  hllcCalls = 0;
  failure: Failure3D | null = null;
  /** 1 for cells inside the immersed body (interior index (k·ny + j)·nx + i) */
  readonly solid: Uint8Array;
  readonly fluidCells: number;
  /** net mass flux into the fluid through the immersed-body faces at the start of the last step, kg/s
   *  (zero for an exactly conservative wall; a measure of the immersed boundary's conservation error) */
  bodyMassFlux = 0;
  private dtCell: Float64Array;
  private region: Uint8Array | null = null;
  /** ghost cells of the immersed body: padded index, 8 interpolation sources (padded index, weight, velocity
   *  sign flips for symmetry-plane images) and the outward surface normal */
  private ghostPad = new Int32Array(0);
  private srcPad = new Int32Array(0);
  private srcW = new Float64Array(0);
  private srcFlip = new Uint8Array(0);
  private ghostN = new Float64Array(0);
  /** cut cells: ghost entries g ≥ ghostSolid are fluid cut cells whose centre lies inside the body; their
   *  reflection states go to the stencil arrays (sr, sq, sp), read only as the outer points of MUSCL stencils */
  private ghostSolid = 0;
  private sr: Float64Array | null = null;
  private sq: Float64Array[] = [];
  private sp: Float64Array | null = null;
  /** cut-cell geometry (wall: 'cutcell'): fluid volume fractions, face apertures per axis, wall faces */
  private cut = false;
  private alpha: Float64Array | null = null;
  private beta: Float64Array[] = [];
  private wallCell = new Int32Array(0);
  private wallPad = new Int32Array(0);
  private wallA = new Float64Array(0);
  private padInactive: Uint8Array | null = null;
  /** merged cut-cell groups: the members (interior indices) of each group; merged[c] = 1 for members */
  private groups: Int32Array[] = [];
  private merged: Uint8Array | null = null;
  /** small cut cells that found no target to merge with (kept independent) */
  private unmergedSmall = 0;
  /** wall-state reconstruction per wall face: up to WALL_NB padded indices of the neighbours behind the cell (or
   *  group) along the wall normal (−1: unused), their distances D from the cell (or group) centre along n_w, and
   *  the distance d of that centre from the wall (0: no reconstruction) */
  private wallNb = new Int32Array(0);
  private wallD = new Float64Array(0);
  private wallDist = new Float64Array(0);
  /** net mass flux into the domain through its outer boundaries at the start of the last step, kg/s */
  boundaryMassFlux = 0;
  private lastBoundaryFlux = 0;

  constructor(grid: Grid3D, opts: Solver3DOptions) {
    const { nx, ny, nz } = grid;
    if (nx < 2 || ny < 2 || nz < 2) throw new Error('the 3D solver needs at least 2 cells in each direction');
    for (const [a, b] of [
      [opts.bc.xmin, opts.bc.xmax],
      [opts.bc.ymin, opts.bc.ymax],
      [opts.bc.zmin, opts.bc.zmax],
    ])
      if ((a === 'periodic') !== (b === 'periodic')) throw new Error('periodic boundaries must be set on both sides of an axis');
    if (Object.values(opts.bc).includes('inflow') && !opts.freestream) throw new Error("'inflow' boundaries need a freestream state");
    this.grid = grid;
    this.opts = opts;
    this.gamma = opts.gamma ?? GAS.gamma;
    this.px = nx + 4;
    this.py = ny + 4;
    this.pz = nz + 4;
    this.sy = this.px;
    this.sz = this.px * this.py;
    const n = this.px * this.py * this.pz;
    const mk = (m: number, len: number) => Array.from({ length: m }, () => new Float64Array(len));
    this.U = mk(NV, n);
    this.U0 = mk(NV, n);
    this.Ubackup = mk(NV, n);
    this.r = new Float64Array(n);
    this.q = mk(3, n);
    this.p = new Float64Array(n);
    this.res = mk(NV, nx * ny * nz);
    this.solid = new Uint8Array(nx * ny * nz);
    this.dtCell = new Float64Array(nx * ny * nz);
    if (opts.sphere?.wall === 'cutcell') this.buildCutCells(opts.sphere);
    else if (opts.sphere) this.buildSphere(opts.sphere);
    let fluid = 0;
    for (let c = 0; c < this.solid.length; c++) if (!this.solid[c]) fluid++;
    this.fluidCells = fluid;
    if (opts.residualRegion) {
      this.region = new Uint8Array(nx * ny * nz);
      for (let k = 0; k < nz; k++)
        for (let j = 0; j < ny; j++)
          for (let i = 0; i < nx; i++) {
            const [x, y, z] = this.centre(i, j, k);
            this.region[(k * ny + j) * nx + i] = opts.residualRegion(x, y, z) ? 1 : 0;
          }
    }
  }

  /** switch reconstruction order (e.g. after a first-order start-up phase) */
  setOrder(order: 1 | 2) {
    this.opts = { ...this.opts, order };
  }

  /** fluid volume fraction of a cell (1 without cut cells, 0 for solid cells) */
  fluidFraction(i: number, j: number, k: number) {
    const c = (k * this.grid.ny + j) * this.grid.nx + i;
    return this.solid[c] ? 0 : this.alpha ? this.alpha[c] : 1;
  }

  isSolid(i: number, j: number, k: number) {
    return this.solid[(k * this.grid.ny + j) * this.grid.nx + i] === 1;
  }

  // ───────── immersed sphere (ghost-cell method) ─────────
  /**
   * Map a cell index that may lie outside the box back into it: across a slip wall (symmetry plane) by mirroring,
   * flipping that velocity component; periodic by wrapping; otherwise by clamping (zero-gradient).
   */
  private virtualIndex(m: number, n: number, lo: BC3D, hi: BC3D): [number, boolean] {
    let flip = false;
    for (let it = 0; it < 4 && (m < 0 || m >= n); it++) {
      if (m < 0) {
        if (lo === 'wall') (m = -1 - m), (flip = !flip);
        else if (lo === 'periodic') m += n;
        else m = 0;
      } else if (hi === 'wall') (m = 2 * n - 1 - m), (flip = !flip);
      else if (hi === 'periodic') m -= n;
      else m = n - 1;
    }
    return [Math.min(n - 1, Math.max(0, m)), flip];
  }

  private buildSphere(sp: ImmersedSphere, markSolid = true, fluidInside = false) {
    const { nx, ny, nz, x0, y0, z0, dx, dy, dz } = this.grid;
    const bc = this.opts.bc;
    const idx = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
    if (markSolid)
      for (let k = 0; k < nz; k++)
        for (let j = 0; j < ny; j++)
          for (let i = 0; i < nx; i++) {
            const [x, y, z] = this.centre(i, j, k);
            if ((x - sp.cx) ** 2 + (y - sp.cy) ** 2 + (z - sp.cz) ** 2 < sp.r * sp.r) this.solid[idx(i, j, k)] = 1;
          }
    // ghost cells: solid cells within two cells (along an axis) of a fluid cell, i.e. reached by a flux stencil
    const ghosts: number[] = [];
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          if (!this.solid[idx(i, j, k)]) continue;
          let near = false;
          for (const [di, dj, dk] of [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
          ])
            for (const sgn of [-2, -1, 1, 2]) {
              const a = i + sgn * di;
              const b = j + sgn * dj;
              const c = k + sgn * dk;
              if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
              if (!this.solid[idx(a, b, c)]) near = true;
            }
          if (!near) continue;
          const [gx, gy, gz] = this.centre(i, j, k);
          if ((gx - sp.cx) ** 2 + (gy - sp.cy) ** 2 + (gz - sp.cz) ** 2 >= sp.r * sp.r) continue;
          ghosts.push(i, j, k);
        }
    this.ghostSolid = ghosts.length / 3;
    // cut cells only: fluid cells whose centre lies inside the body (slivers and some small cut cells) also get a
    // reflection state at their centre, for the stencils of their neighbours' faces
    if (fluidInside)
      for (let k = 0; k < nz; k++)
        for (let j = 0; j < ny; j++)
          for (let i = 0; i < nx; i++) {
            if (this.solid[idx(i, j, k)]) continue;
            const [gx, gy, gz] = this.centre(i, j, k);
            if ((gx - sp.cx) ** 2 + (gy - sp.cy) ** 2 + (gz - sp.cz) ** 2 < sp.r * sp.r) ghosts.push(i, j, k);
          }
    const G = ghosts.length / 3;
    this.ghostPad = new Int32Array(G);
    this.srcPad = new Int32Array(8 * G);
    this.srcW = new Float64Array(8 * G);
    this.srcFlip = new Uint8Array(8 * G);
    this.ghostN = new Float64Array(3 * G);
    for (let g = 0; g < G; g++) {
      const [i, j, k] = [ghosts[3 * g], ghosts[3 * g + 1], ghosts[3 * g + 2]];
      this.ghostPad[g] = this.P(i, j, k);
      const [x, y, z] = this.centre(i, j, k);
      const d = Math.hypot(x - sp.cx, y - sp.cy, z - sp.cz);
      if (!(d > 1e-12 * sp.r)) throw new Error('the sphere is too small for the grid (a ghost cell lies at its centre)');
      const n = [(x - sp.cx) / d, (y - sp.cy) / d, (z - sp.cz) / d];
      this.ghostN.set(n, 3 * g);
      // image point: the ghost centre mirrored across the surface along the normal
      const dist = 2 * (sp.r - d);
      const xi = [x + dist * n[0], y + dist * n[1], z + dist * n[2]];
      const f = [(xi[0] - x0) / dx - 0.5, (xi[1] - y0) / dy - 0.5, (xi[2] - z0) / dz - 0.5];
      const b = f.map(Math.floor);
      const t = f.map((v, a) => v - b[a]);
      let wsum = 0;
      for (let c = 0; c < 8; c++) {
        const o = [c & 1, (c >> 1) & 1, (c >> 2) & 1];
        const w = (o[0] ? t[0] : 1 - t[0]) * (o[1] ? t[1] : 1 - t[1]) * (o[2] ? t[2] : 1 - t[2]);
        const [vi, fx] = this.virtualIndex(b[0] + o[0], nx, bc.xmin, bc.xmax);
        const [vj, fy] = this.virtualIndex(b[1] + o[1], ny, bc.ymin, bc.ymax);
        const [vk, fz] = this.virtualIndex(b[2] + o[2], nz, bc.zmin, bc.zmax);
        if (this.solid[idx(vi, vj, vk)] || w <= 0) continue;
        this.srcPad[8 * g + c] = this.P(vi, vj, vk);
        this.srcW[8 * g + c] = w;
        this.srcFlip[8 * g + c] = (fx ? 1 : 0) | (fy ? 2 : 0) | (fz ? 4 : 0);
        wsum += w;
      }
      if (wsum < 1e-6) throw new Error(`no fluid cell around the image point of ghost cell (${i}, ${j}, ${k}); refine the grid`);
      for (let c = 0; c < 8; c++) this.srcW[8 * g + c] /= wsum;
    }
  }

  /** index of the face on the low side of cell (i, j, k) along `axis` (i, j or k may equal n for the last face) */
  private faceIndex(axis: number, i: number, j: number, k: number) {
    const { nx, ny } = this.grid;
    if (axis === 0) return (k * ny + j) * (nx + 1) + i;
    if (axis === 1) return (k * (ny + 1) + j) * nx + i;
    return (k * ny + j) * nx + i;
  }

  private buildCutCells(sp: ImmersedSphere) {
    const { nx, ny, nz, x0, y0, z0, dx, dy, dz } = this.grid;
    const r2 = sp.r * sp.r;
    const fluidAt = (x: number, y: number, z: number) => (x - sp.cx) ** 2 + (y - sp.cy) ** 2 + (z - sp.cz) ** 2 >= r2;
    const N3 = 8;
    const N2 = 16;
    const hd = 0.5 * Math.hypot(dx, dy, dz);
    const alpha = new Float64Array(nx * ny * nz);
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const [x, y, z] = this.centre(i, j, k);
          const d = Math.hypot(x - sp.cx, y - sp.cy, z - sp.cz);
          let a: number;
          if (d - sp.r > hd) a = 1;
          else if (sp.r - d > hd) a = 0;
          else {
            let n = 0;
            for (let c = 0; c < N3; c++)
              for (let b = 0; b < N3; b++)
                for (let q = 0; q < N3; q++) if (fluidAt(x + ((q + 0.5) / N3 - 0.5) * dx, y + ((b + 0.5) / N3 - 0.5) * dy, z + ((c + 0.5) / N3 - 0.5) * dz)) n++;
            a = n / N3 ** 3;
          }
          const ci = (k * ny + j) * nx + i;
          if (a < DROP_ALPHA) {
            this.solid[ci] = 1;
            alpha[ci] = 0;
          } else alpha[ci] = a;
        }
    // face apertures: fluid fraction of each face, sampled on the face; zero next to a dropped cell
    const sizes = [(nx + 1) * ny * nz, nx * (ny + 1) * nz, nx * ny * (nz + 1)];
    const beta = sizes.map((n) => new Float64Array(n));
    const lens = [dx, dy, dz];
    const org = [x0, y0, z0];
    const dims = [nx, ny, nz];
    for (let axis = 0; axis < 3; axis++) {
      const [a1, a2] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
      const hf = 0.5 * Math.hypot(lens[a1], lens[a2]);
      const lim = [nx, ny, nz];
      lim[axis] += 1;
      for (let k = 0; k < lim[2]; k++)
        for (let j = 0; j < lim[1]; j++)
          for (let i = 0; i < lim[0]; i++) {
            const idx = [i, j, k];
            const m = idx[axis];
            const centre = [0, 1, 2].map((d) => (d === axis ? org[d] + m * lens[d] : org[d] + (idx[d] + 0.5) * lens[d]));
            const d = Math.hypot(centre[0] - sp.cx, centre[1] - sp.cy, centre[2] - sp.cz);
            let b: number;
            if (d - sp.r > hf) b = 1;
            else if (sp.r - d > hf) b = 0;
            else {
              let n = 0;
              const pt = centre.slice();
              for (let u = 0; u < N2; u++)
                for (let v = 0; v < N2; v++) {
                  pt[a1] = centre[a1] + ((u + 0.5) / N2 - 0.5) * lens[a1];
                  pt[a2] = centre[a2] + ((v + 0.5) / N2 - 0.5) * lens[a2];
                  if (fluidAt(pt[0], pt[1], pt[2])) n++;
                }
              b = n / N2 ** 2;
            }
            // the cells on either side (outside the box: none)
            const lo = idx.slice();
            lo[axis] = m - 1;
            const hi = idx.slice();
            const inBox = (q: number[]) => q[axis] >= 0 && q[axis] < dims[axis];
            const dead = (q: number[]) => inBox(q) && this.solid[(q[2] * ny + q[1]) * nx + q[0]] === 1;
            if (dead(lo) || dead(hi)) b = 0;
            beta[axis][this.faceIndex(axis, i, j, k)] = b;
          }
    }
    // wall faces: the area vector that closes each cell, A_w n_w = −Σ_faces β A e_out (n_w points into the body)
    const areas = [dy * dz, dx * dz, dx * dy];
    const cells: number[] = [];
    const vecs: number[] = [];
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const ci = (k * ny + j) * nx + i;
          if (this.solid[ci]) continue;
          const A = [0, 0, 0];
          for (let axis = 0; axis < 3; axis++) {
            const hiIdx = [i, j, k];
            hiIdx[axis] += 1;
            const bl = beta[axis][this.faceIndex(axis, i, j, k)];
            const bh = beta[axis][this.faceIndex(axis, hiIdx[0], hiIdx[1], hiIdx[2])];
            A[axis] = -(bh - bl) * areas[axis];
          }
          if (Math.hypot(A[0], A[1], A[2]) > 1e-12 * Math.max(...areas)) {
            cells.push(ci, this.P(i, j, k));
            vecs.push(...A);
          }
        }
    this.wallCell = Int32Array.from(cells.filter((_, q) => q % 2 === 0));
    this.wallPad = Int32Array.from(cells.filter((_, q) => q % 2 === 1));
    this.wallA = Float64Array.from(vecs);
    // inactive flags on the padded grid (domain ghost layers take the flag of the cell they copy)
    const pin = new Uint8Array(this.px * this.py * this.pz);
    const bc = this.opts.bc;
    for (let k = -2; k < nz + 2; k++)
      for (let j = -2; j < ny + 2; j++)
        for (let i = -2; i < nx + 2; i++) {
          const outside = (m: number, n: number, lo: BC3D, hi: BC3D) => (m < 0 && lo === 'inflow') || (m >= n && hi === 'inflow');
          if (outside(i, nx, bc.xmin, bc.xmax) || outside(j, ny, bc.ymin, bc.ymax) || outside(k, nz, bc.zmin, bc.zmax)) continue;
          const [vi] = this.virtualIndex(i, nx, bc.xmin, bc.xmax);
          const [vj] = this.virtualIndex(j, ny, bc.ymin, bc.ymax);
          const [vk] = this.virtualIndex(k, nz, bc.zmin, bc.zmax);
          pin[this.P(i, j, k)] = this.solid[(vk * ny + vj) * nx + vi];
        }
    this.alpha = alpha;
    this.beta = beta;
    this.cut = true;
    if (sp.reconstruction !== 'firstorder') {
      // second-order reconstruction next to the body: the solid cells reached by the stencils get the ghost-cell
      // reflection states (used only inside the MUSCL stencil; faces into the body have aperture 0 and carry no
      // flux, so the update stays exactly conservative)
      this.buildSphere(sp, false, true);
      const n = this.px * this.py * this.pz;
      this.sr = new Float64Array(n);
      this.sq = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
      this.sp = new Float64Array(n);
      const ghostSet = new Set<number>(this.ghostPad);
      for (let q = 0; q < pin.length; q++) if (pin[q] && ghostSet.has(q)) pin[q] = 0;
      // domain ghost layers copy their source cell's flag again
      for (let k = -2; k < nz + 2; k++)
        for (let j = -2; j < ny + 2; j++)
          for (let i = -2; i < nx + 2; i++) {
            if (i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz) continue;
            const outside = (m: number, n: number, lo: BC3D, hi: BC3D) => (m < 0 && lo === 'inflow') || (m >= n && hi === 'inflow');
            if (outside(i, nx, bc.xmin, bc.xmax) || outside(j, ny, bc.ymin, bc.ymax) || outside(k, nz, bc.zmin, bc.zmax)) continue;
            const [vi] = this.virtualIndex(i, nx, bc.xmin, bc.xmax);
            const [vj] = this.virtualIndex(j, ny, bc.ymin, bc.ymax);
            const [vk] = this.virtualIndex(k, nz, bc.zmin, bc.zmax);
            pin[this.P(i, j, k)] = pin[this.P(vi, vj, vk)];
          }
    }
    this.padInactive = pin;
    if (sp.merge !== false) this.buildMergeGroups();
    if (sp.reconstruction !== 'firstorder') this.buildWallStencil(sp);
  }

  /**
   * Cell merging for small cut cells. Why: a sliver (α ≪ 1) whose open face nearly coincides with its wall face
   * has almost no volume, so its state is not a cell average but whatever interface state makes the Rusanov mass
   * and energy fluxes through that face vanish; with the neighbour still moving towards the wall this raises its
   * pressure by about ρu(a + u) and its total enthalpy by Δp/ρ. Merging removes the sliver as an independent
   * unknown. Each cut cell with α < MERGE_ALPHA links to the neighbour(s) across an open face that best face away
   * from the wall (largest −n_w·e; ties all linked, so mirror-symmetric geometry gives mirror-symmetric groups).
   * Only cells with α ≥ MERGE_ALPHA are targets, and targets do not link on, so no chains of small cells form.
   * A group shares one state, updated with its members' summed residual over their summed fluid volume: still
   * exactly conservative, and its steady state (summed residual = 0) does not depend on the time step.
   */
  private buildMergeGroups() {
    const { nx, ny, nz } = this.grid;
    const alpha = this.alpha!;
    const parent = new Int32Array(nx * ny * nz).map((_, q) => q);
    const find = (q: number): number => {
      while (parent[q] !== q) q = parent[q] = parent[parent[q]];
      return q;
    };
    for (let w = 0; w < this.wallCell.length; w++) {
      const c = this.wallCell[w];
      if (alpha[c] >= MERGE_ALPHA) continue;
      const i = c % nx;
      const j = ((c - i) / nx) % ny;
      const k = (c - i - j * nx) / (nx * ny);
      const A = [this.wallA[3 * w], this.wallA[3 * w + 1], this.wallA[3 * w + 2]];
      const An = Math.hypot(A[0], A[1], A[2]);
      const cand: [number, number][] = [];
      for (let axis = 0; axis < 3; axis++)
        for (const dir of [-1, 1]) {
          const q = [i, j, k];
          q[axis] += dir;
          if (q[0] < 0 || q[1] < 0 || q[2] < 0 || q[0] >= nx || q[1] >= ny || q[2] >= nz) continue;
          const nb = (q[2] * ny + q[1]) * nx + q[0];
          if (this.solid[nb] || alpha[nb] < MERGE_ALPHA) continue;
          const low = dir === 1 ? q : [i, j, k];
          if (this.beta[axis][this.faceIndex(axis, low[0], low[1], low[2])] <= 0) continue;
          cand.push([nb, (-dir * A[axis]) / An]);
        }
      if (!cand.length) {
        this.unmergedSmall++;
        continue;
      }
      const best = Math.max(...cand.map((x) => x[1]));
      for (const [nb, sc] of cand) if (sc >= best - 1e-9) parent[find(c)] = find(nb);
    }
    const members = new Map<number, number[]>();
    for (let c = 0; c < parent.length; c++) {
      if (this.solid[c]) continue;
      const r = find(c);
      if (!members.has(r)) members.set(r, []);
      members.get(r)!.push(c);
    }
    this.groups = [...members.values()].filter((m) => m.length > 1).map((m) => Int32Array.from(m));
    this.merged = new Uint8Array(nx * ny * nz);
    for (const g of this.groups) for (const c of g) this.merged[c] = 1;
  }

  /**
   * Wall-state stencil: for each wall face, the centre x_g of its cell (or of its merged group: the α-weighted
   * mean of the members' centres), its distance d from the wall, and the neighbours behind it: one step against
   * the dominant axis of the wall normal from the group's largest member. Ties (equal |n| components, mirror
   * members of equal α) keep every tied neighbour, so that mirror-symmetric geometry gives a symmetric stencil.
   */
  private buildWallStencil(sp: ImmersedSphere) {
    const { nx, ny, nz, dx, dy, dz, x0, y0, z0 } = this.grid;
    const alpha = this.alpha!;
    const groupOf = new Map<number, Int32Array>();
    for (const g of this.groups) for (const c of g) groupOf.set(c, g);
    const nW = this.wallCell.length;
    this.wallNb = new Int32Array(WALL_NB * nW).fill(-1);
    this.wallD = new Float64Array(WALL_NB * nW);
    this.wallDist = new Float64Array(nW);
    const ijk = (c: number) => {
      const i = c % nx;
      const j = ((c - i) / nx) % ny;
      return [i, j, (c - i - j * nx) / (nx * ny)];
    };
    const lens = [dx, dy, dz];
    const org = [x0, y0, z0];
    const dims = [nx, ny, nz];
    for (let w = 0; w < nW; w++) {
      const c = this.wallCell[w];
      const members = groupOf.get(c) ?? Int32Array.of(c);
      const xg = [0, 0, 0];
      let va = 0;
      let amax = 0;
      for (const m of members) {
        const xc = this.centre(ijk(m)[0], ijk(m)[1], ijk(m)[2]);
        for (let d = 0; d < 3; d++) xg[d] += alpha[m] * xc[d];
        va += alpha[m];
        amax = Math.max(amax, alpha[m]);
      }
      for (let d = 0; d < 3; d++) xg[d] /= va;
      const dist = Math.hypot(xg[0] - sp.cx, xg[1] - sp.cy, xg[2] - sp.cz) - sp.r;
      if (!(dist > 0)) continue;
      const A = [this.wallA[3 * w], this.wallA[3 * w + 1], this.wallA[3 * w + 2]];
      const An = Math.hypot(A[0], A[1], A[2]);
      const n = A.map((a) => a / An);
      const nmax = Math.max(...n.map(Math.abs));
      const found: [number, number][] = [];
      for (const m of members) {
        if (alpha[m] < amax - 1e-12) continue;
        for (let ax = 0; ax < 3; ax++) {
          if (Math.abs(n[ax]) < nmax - 1e-9) continue;
          const q = ijk(m);
          q[ax] -= Math.sign(n[ax]);
          if (q[ax] < -1 || q[ax] > dims[ax]) continue;
          const cq = (q[2] * ny + q[1]) * nx + q[0];
          if (q[ax] >= 0 && q[ax] < dims[ax] && (this.solid[cq] || members.includes(cq))) continue;
          const D = [0, 1, 2].reduce((sum, d) => sum + (xg[d] - (org[d] + (q[d] + 0.5) * lens[d])) * n[d], 0);
          if (D > 0 && found.length < WALL_NB) found.push([this.P(q[0], q[1], q[2]), D]);
        }
      }
      if (!found.length) continue;
      found.forEach(([pq, D], t) => {
        this.wallNb[WALL_NB * w + t] = pq;
        this.wallD[WALL_NB * w + t] = D;
      });
      this.wallDist[w] = dist;
    }
  }

  /**
   * the fluid cells touching the body, one entry per independent state (a merged group counts once, at its
   * largest member), with the wall area they carry: cut cells |A_w| summed over the group, ghost-cell wall the
   * stair faces shared with solid cells
   */
  wallUnits(): { i: number; j: number; k: number; area: number }[] {
    const { nx, ny, nz, dx, dy, dz } = this.grid;
    const at = (c: number) => {
      const i = c % nx;
      const j = ((c - i) / nx) % ny;
      return { i, j, k: (c - i - j * nx) / (nx * ny) };
    };
    const units = new Map<number, number>();
    if (this.cut) {
      const rep = new Map<number, number>();
      for (const g of this.groups) {
        let best = g[0];
        for (const c of g) if (this.alpha![c] > this.alpha![best]) best = c;
        for (const c of g) rep.set(c, best);
      }
      for (let w = 0; w < this.wallCell.length; w++) {
        const r = rep.get(this.wallCell[w]) ?? this.wallCell[w];
        units.set(r, (units.get(r) ?? 0) + Math.hypot(this.wallA[3 * w], this.wallA[3 * w + 1], this.wallA[3 * w + 2]));
      }
    } else {
      const areas = [dy * dz, dx * dz, dx * dy];
      for (let k = 0; k < nz; k++)
        for (let j = 0; j < ny; j++)
          for (let i = 0; i < nx; i++) {
            const c = (k * ny + j) * nx + i;
            if (this.solid[c]) continue;
            let a = 0;
            const q = [i, j, k];
            const dims = [nx, ny, nz];
            for (let axis = 0; axis < 3; axis++)
              for (const dir of [-1, 1]) {
                q[axis] += dir;
                if (q[axis] >= 0 && q[axis] < dims[axis] && this.solid[(q[2] * ny + q[1]) * nx + q[0]]) a += areas[axis];
                q[axis] -= dir;
              }
            if (a > 0) units.set(c, a);
          }
    }
    return [...units].map(([c, area]) => ({ ...at(c), area }));
  }

  /** merged cut-cell groups: count, largest group (cells), small cells left unmerged, smallest unmerged α */
  mergeInfo() {
    let maxSize = 0;
    for (const g of this.groups) maxSize = Math.max(maxSize, g.length);
    let minAlpha = Infinity;
    if (this.alpha) for (let c = 0; c < this.alpha.length; c++) if (!this.solid[c] && !(this.merged && this.merged[c])) minAlpha = Math.min(minAlpha, this.alpha[c]);
    return { groups: this.groups.length, maxSize, unmergedSmall: this.unmergedSmall, minUnmergedAlpha: minAlpha };
  }

  /** pressure at a stationary wall from the exact wall Riemann problem; un = velocity towards the wall */
  private wallPressure(rho: number, p: number, un: number) {
    const g = this.gamma;
    const a = Math.sqrt((g * p) / rho);
    if (un <= 0) {
      const b = 1 + (0.5 * (g - 1) * un) / a;
      return b > 0 ? p * Math.pow(b, (2 * g) / (g - 1)) : 0;
    }
    const q = 0.25 * (g + 1) * un;
    return p + rho * un * (q + Math.sqrt(q * q + a * a));
  }

  /** ghost states of the immersed body from the current fluid primitives (fluid sources only: order-independent) */
  private applySphereGhosts() {
    const [U, V, W] = this.q;
    const R = this.r;
    const Pp = this.p;
    for (let g = 0; g < this.ghostPad.length; g++) {
      let rho = 0;
      let p = 0;
      let u = 0;
      let v = 0;
      let w = 0;
      for (let c = 8 * g; c < 8 * g + 8; c++) {
        const wt = this.srcW[c];
        if (wt === 0) continue;
        const s = this.srcPad[c];
        const fl = this.srcFlip[c];
        rho += wt * R[s];
        p += wt * Pp[s];
        u += wt * (fl & 1 ? -U[s] : U[s]);
        v += wt * (fl & 2 ? -V[s] : V[s]);
        w += wt * (fl & 4 ? -W[s] : W[s]);
      }
      const nx = this.ghostN[3 * g];
      const ny = this.ghostN[3 * g + 1];
      const nz = this.ghostN[3 * g + 2];
      const vn = u * nx + v * ny + w * nz;
      const d = this.ghostPad[g];
      if (g < this.ghostSolid) {
        R[d] = rho;
        Pp[d] = p;
        U[d] = u - 2 * vn * nx;
        V[d] = v - 2 * vn * ny;
        W[d] = w - 2 * vn * nz;
      } else {
        this.sr![d] = rho;
        this.sp![d] = p;
        this.sq[0][d] = u - 2 * vn * nx;
        this.sq[1][d] = v - 2 * vn * ny;
        this.sq[2][d] = w - 2 * vn * nz;
      }
    }
  }

  /** padded index of cell (i, j, k); each index may range over −2 … n+1 */
  P(i: number, j: number, k: number) {
    return (k + 2) * this.sz + (j + 2) * this.sy + (i + 2);
  }

  /** cell-centre coordinates, m */
  centre(i: number, j: number, k: number): [number, number, number] {
    const g = this.grid;
    return [g.x0 + (i + 0.5) * g.dx, g.y0 + (j + 0.5) * g.dy, g.z0 + (k + 0.5) * g.dz];
  }

  init(fn: (x: number, y: number, z: number) => Primitive3D) {
    const { nx, ny, nz } = this.grid;
    const g1 = this.gamma - 1;
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const [x, y, z] = this.centre(i, j, k);
          const s = fn(x, y, z);
          const c = this.P(i, j, k);
          this.U[0][c] = s.rho;
          this.U[1][c] = s.rho * s.u;
          this.U[2][c] = s.rho * s.v;
          this.U[3][c] = s.rho * s.w;
          this.U[4][c] = s.p / g1 + 0.5 * s.rho * (s.u * s.u + s.v * s.v + s.w * s.w);
        }
    this.time = 0;
    this.steps = 0;
    this.lastDt = 0;
    this.failure = null;
  }

  // ───────── primitive variables and validity ─────────
  private toPrimitive(stage: number): boolean {
    const { nx, ny, nz } = this.grid;
    const g1 = this.gamma - 1;
    const [R, MU, MV, MW, E] = this.U;
    const [u, v, w] = this.q;
    const solid = this.solid;
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++) {
        let c = this.P(0, j, k);
        let ci = (k * ny + j) * nx;
        for (let i = 0; i < nx; i++, c++, ci++) {
          if (solid[ci]) continue;
          const rho = R[c];
          const uu = MU[c] / rho;
          const vv = MV[c] / rho;
          const ww = MW[c] / rho;
          const pres = g1 * (E[c] - 0.5 * rho * (uu * uu + vv * vv + ww * ww));
          if (!(rho > 0) || !(pres > 0) || !Number.isFinite(rho) || !Number.isFinite(pres)) {
            this.failure = {
              step: this.steps,
              stage,
              i,
              j,
              k,
              rho,
              p: pres,
              reason: !Number.isFinite(rho) || !Number.isFinite(pres) ? 'non-finite state (NaN or infinity)' : rho <= 0 ? 'non-positive density' : 'non-positive pressure',
            };
            return false;
          }
          this.r[c] = rho;
          u[c] = uu;
          v[c] = vv;
          w[c] = ww;
          this.p[c] = pres;
        }
      }
    return true;
  }

  // ───────── boundary conditions (ghost cells) ─────────
  private setFreestream(dst: number) {
    const fs = this.opts.freestream!;
    this.r[dst] = fs.rho;
    this.p[dst] = fs.p;
    this.q[0][dst] = fs.u;
    this.q[1][dst] = fs.v;
    this.q[2][dst] = fs.w;
  }

  private copyCell(src: number, dst: number, flipAxis = -1) {
    this.r[dst] = this.r[src];
    this.p[dst] = this.p[src];
    for (let d = 0; d < 3; d++) this.q[d][dst] = d === flipAxis ? -this.q[d][src] : this.q[d][src];
  }

  /** fill the two ghost layers on both sides of one axis for every interior line along it */
  private fillAxis(axis: 0 | 1 | 2, lo: BC3D, hi: BC3D) {
    const { nx, ny, nz } = this.grid;
    const n = [nx, ny, nz][axis];
    const s = [1, this.sy, this.sz][axis];
    // the two transverse axes and their interior ranges
    const [na, nb] = axis === 0 ? [ny, nz] : axis === 1 ? [nx, nz] : [nx, ny];
    for (let b = 0; b < nb; b++)
      for (let a = 0; a < na; a++) {
        const base = axis === 0 ? this.P(0, a, b) : axis === 1 ? this.P(a, 0, b) : this.P(a, b, 0);
        const cell = (m: number) => base + m * s;
        if (lo === 'periodic') {
          this.copyCell(cell(n - 1), cell(-1));
          this.copyCell(cell(n - 2), cell(-2));
          this.copyCell(cell(0), cell(n));
          this.copyCell(cell(1), cell(n + 1));
          continue;
        }
        if (lo === 'wall') {
          this.copyCell(cell(0), cell(-1), axis);
          this.copyCell(cell(1), cell(-2), axis);
        } else if (lo === 'inflow') {
          this.setFreestream(cell(-1));
          this.setFreestream(cell(-2));
        } else {
          this.copyCell(cell(0), cell(-1));
          this.copyCell(cell(0), cell(-2));
        }
        if (hi === 'wall') {
          this.copyCell(cell(n - 1), cell(n), axis);
          this.copyCell(cell(n - 2), cell(n + 1), axis);
        } else if (hi === 'inflow') {
          this.setFreestream(cell(n));
          this.setFreestream(cell(n + 1));
        } else {
          this.copyCell(cell(n - 1), cell(n));
          this.copyCell(cell(n - 1), cell(n + 1));
        }
      }
  }

  private fillGhosts() {
    const bc = this.opts.bc;
    this.fillAxis(0, bc.xmin, bc.xmax);
    this.fillAxis(1, bc.ymin, bc.ymax);
    this.fillAxis(2, bc.zmin, bc.zmax);
    if (this.ghostPad.length) {
      this.applySphereGhosts();
      // domain ghost layers next to body ghost cells (on symmetry planes) mirror the new ghost states
      this.fillAxis(0, bc.xmin, bc.xmax);
      this.fillAxis(1, bc.ymin, bc.ymax);
      this.fillAxis(2, bc.zmin, bc.zmax);
    }
    if (this.sr) {
      // stencil arrays: the primitive states, with reflection states at the fluid cells centred inside the body
      this.sr.set(this.r);
      this.sp!.set(this.p);
      for (let d = 0; d < 3; d++) this.sq[d].set(this.q[d]);
      this.applySphereGhosts();
      // their domain ghost layers mirror the stencil states (swap them in for fillAxis, then back)
      const keep = [this.r, this.p, this.q];
      this.r = this.sr;
      this.p = this.sp!;
      this.q = this.sq;
      this.fillAxis(0, bc.xmin, bc.xmax);
      this.fillAxis(1, bc.ymin, bc.ymax);
      this.fillAxis(2, bc.zmin, bc.zmax);
      [this.r, this.p, this.q] = keep as [Float64Array, Float64Array, Float64Array[]];
    }
  }

  // ───────── numerical flux ─────────
  private static minmod(a: number, b: number) {
    if (a * b <= 0) return 0;
    return Math.abs(a) < Math.abs(b) ? a : b;
  }

  /** face states on the face between padded cells l and r (outer neighbours ll, rr); Rusanov flux along `axis` × area into this.f */
  private faceFlux(axis: number, ll: number, l: number, r: number, rr: number, area: number) {
    const g = this.gamma;
    const [U, V, W] = this.q;
    const R = this.r;
    const Pp = this.p;
    let rL = R[l],
      rR = R[r],
      pL = Pp[l],
      pR = Pp[r],
      uL = U[l],
      uR = U[r],
      vL = V[l],
      vR = V[r],
      wL = W[l],
      wR = W[r];
    const pin = this.padInactive;
    if (this.opts.order === 2 && !(pin && (pin[ll] | pin[l] | pin[r] | pin[rr]))) {
      const mm = EulerSolver3D.minmod;
      // outer stencil points (ll, rr) come from the stencil arrays when there are any (cut cells)
      const left = (a: Float64Array, sa: Float64Array) => a[l] + 0.5 * mm(a[l] - sa[ll], a[r] - a[l]);
      const right = (a: Float64Array, sa: Float64Array) => a[r] - 0.5 * mm(a[r] - a[l], sa[rr] - a[r]);
      const SR = this.sr ?? R;
      const SP = this.sp ?? Pp;
      const [SU, SV, SW] = this.sr ? this.sq : this.q;
      const r2L = left(R, SR);
      const r2R = right(R, SR);
      const p2L = left(Pp, SP);
      const p2R = right(Pp, SP);
      if (r2L > 0 && r2R > 0 && p2L > 0 && p2R > 0) {
        rL = r2L;
        rR = r2R;
        pL = p2L;
        pR = p2R;
        uL = left(U, SU);
        uR = right(U, SU);
        vL = left(V, SV);
        vR = right(V, SV);
        wL = left(W, SW);
        wR = right(W, SW);
      } else this.fallbacks++;
    }
    const unL = axis === 0 ? uL : axis === 1 ? vL : wL;
    const unR = axis === 0 ? uR : axis === 1 ? vR : wR;
    const EL = pL / (g - 1) + 0.5 * rL * (uL * uL + vL * vL + wL * wL);
    const ER = pR / (g - 1) + 0.5 * rR * (uR * uR + vR * vR + wR * wR);
    if (this.opts.flux === 'hllc') {
      this.hllcCalls++;
      if (this.hllc(axis, rL, uL, vL, wL, pL, EL, rR, uR, vR, wR, pR, ER, area)) return;
      this.hllcFallbacks++;
      this.hllcFallbacksTotal++;
    }
    const lam = Math.max(Math.abs(unL) + Math.sqrt((g * pL) / rL), Math.abs(unR) + Math.sqrt((g * pR) / rR));
    const f = this.f;
    f[0] = 0.5 * (rL * unL + rR * unR - lam * (rR - rL)) * area;
    f[1] = 0.5 * (rL * uL * unL + rR * uR * unR + (axis === 0 ? pL + pR : 0) - lam * (rR * uR - rL * uL)) * area;
    f[2] = 0.5 * (rL * vL * unL + rR * vR * unR + (axis === 1 ? pL + pR : 0) - lam * (rR * vR - rL * vL)) * area;
    f[3] = 0.5 * (rL * wL * unL + rR * wR * unR + (axis === 2 ? pL + pR : 0) - lam * (rR * wR - rL * wL)) * area;
    f[4] = 0.5 * ((EL + pL) * unL + (ER + pR) * unR - lam * (ER - EL)) * area;
  }

  /**
   * residual R(U) = −Σ F·n A over the faces of every fluid cell. Faces between two solid cells are skipped; faces
   * between a fluid and a solid (ghost) cell carry the immersed-boundary flux, whose mass part is summed into
   * `lastBodyFlux` (into the fluid, kg/s).
   */
  private lastBodyFlux = 0;
  private computeResidual() {
    const { nx, ny, nz, dx, dy, dz } = this.grid;
    const res = this.res;
    const solid = this.solid;
    for (let v = 0; v < NV; v++) res[v].fill(0);
    const f = this.f;
    const dims = [nx, ny, nz];
    const strides = [1, this.sy, this.sz];
    const offsets = [1, nx, nx * ny];
    const areas = [dy * dz, dx * dz, dx * dy];
    let body = 0;
    let boundary = 0;
    const cut = this.cut;
    for (let axis = 0; axis < 3; axis++) {
      const s = strides[axis];
      const n = dims[axis];
      const off = offsets[axis];
      const beta = cut ? this.beta[axis] : null;
      for (let k = 0; k < nz; k++)
        for (let j = 0; j < ny; j++)
          for (let i = 0; i < nx; i++) {
            // the face on the low side of cell (i, j, k) along this axis; the last cell also owns its high face
            const m = axis === 0 ? i : axis === 1 ? j : k;
            const c = (k * ny + j) * nx + i;
            const pc = this.P(i, j, k);
            const sc = solid[c];
            const sl = m > 0 ? solid[c - off] : sc;
            const bLow = beta ? beta[this.faceIndex(axis, i, j, k)] : 1;
            if (!(sc && sl) && bLow > 0) {
              this.faceFlux(axis, pc - 2 * s, pc - s, pc, pc + s, areas[axis] * bLow);
              if (!sc) for (let v = 0; v < NV; v++) res[v][c] += f[v];
              if (m > 0 && !sl) for (let v = 0; v < NV; v++) res[v][c - off] -= f[v];
              if (m > 0 && sc !== sl) body += sc ? -f[0] : f[0];
              if (m === 0 && !sc) boundary += f[0];
            }
            if (m === n - 1 && !sc) {
              const hiIdx = [i, j, k];
              hiIdx[axis] += 1;
              const bHigh = beta ? beta[this.faceIndex(axis, hiIdx[0], hiIdx[1], hiIdx[2])] : 1;
              if (bHigh > 0) {
                this.faceFlux(axis, pc - s, pc, pc + s, pc + 2 * s, areas[axis] * bHigh);
                for (let v = 0; v < NV; v++) res[v][c] -= f[v];
                boundary -= f[0];
              }
            }
          }
    }
    // cut-cell wall faces: pressure only (no mass, no energy through the body)
    const [U, V, W] = this.q;
    for (let w = 0; w < this.wallCell.length; w++) {
      const c = this.wallCell[w];
      const pc = this.wallPad[w];
      const ax = this.wallA[3 * w];
      const ay = this.wallA[3 * w + 1];
      const az = this.wallA[3 * w + 2];
      const A = Math.hypot(ax, ay, az);
      let un = (U[pc] * ax + V[pc] * ay + W[pc] * az) / A;
      const d = this.wallDist.length ? this.wallDist[w] : 0;
      if (this.opts.order === 2 && d > 0) {
        // second-order wall state: the wall-normal velocity extrapolated to the wall with the minmod of the slope
        // from the neighbour(s) behind (mean over tied neighbours) and the slope to the mirror state (−u_n at
        // distance 2d), as the ghost method's MUSCL step does; ρ and p have zero mirror slope and keep their values
        let back = 0;
        let nn = 0;
        for (let t = WALL_NB * w; t < WALL_NB * w + WALL_NB; t++) {
          const nb = this.wallNb[t];
          if (nb < 0) break;
          back += (un - (U[nb] * ax + V[nb] * ay + W[nb] * az) / A) / this.wallD[t];
          nn++;
        }
        un += d * EulerSolver3D.minmod(back / nn, -un / d);
      }
      const pw = this.wallPressure(this.r[pc], this.p[pc], un);
      res[1][c] -= pw * ax;
      res[2][c] -= pw * ay;
      res[3][c] -= pw * az;
    }
    this.lastBodyFlux = body;
    this.lastBoundaryFlux = boundary;
  }

  /** global CFL time step from the current primitive arrays */
  private computeDt(): number {
    const { nx, ny, nz, dx, dy, dz } = this.grid;
    const g = this.gamma;
    const [U, V, W] = this.q;
    let smax = 0;
    const cfl = this.opts.cfl;
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++) {
        let c = this.P(0, j, k);
        let ci = (k * ny + j) * nx;
        for (let i = 0; i < nx; i++, c++, ci++) {
          if (this.solid[ci]) continue;
          const a = Math.sqrt((g * this.p[c]) / this.r[c]);
          const s = (Math.abs(U[c]) + a) / dx + (Math.abs(V[c]) + a) / dy + (Math.abs(W[c]) + a) / dz;
          this.dtCell[ci] = cfl / s;
          if (s > smax) smax = s;
        }
      }
    if (!this.cut) return cfl / smax;
    // cut cells: Δt = CFL · αV / (½ Σ_faces (|u·e| + a) β A + ½ (|u·n_w| + a) A_w)
    const areas = [dy * dz, dx * dz, dx * dy];
    const vol = dx * dy * dz;
    const alpha = this.alpha!;
    const wallIdx = new Map<number, number>();
    for (let w = 0; w < this.wallCell.length; w++) wallIdx.set(this.wallCell[w], w);
    let dmin = Infinity;
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const ci = (k * ny + j) * nx + i;
          if (this.solid[ci]) continue;
          if (alpha[ci] < 1) {
            const c = this.P(i, j, k);
            const a = Math.sqrt((g * this.p[c]) / this.r[c]);
            const vel = [U[c], V[c], W[c]];
            let s = 0;
            for (let axis = 0; axis < 3; axis++) {
              const hiIdx = [i, j, k];
              hiIdx[axis] += 1;
              const b = this.beta[axis][this.faceIndex(axis, i, j, k)] + this.beta[axis][this.faceIndex(axis, hiIdx[0], hiIdx[1], hiIdx[2])];
              s += b * areas[axis] * (Math.abs(vel[axis]) + a);
            }
            const w = wallIdx.get(ci);
            if (w !== undefined) {
              const ax = this.wallA[3 * w];
              const ay = this.wallA[3 * w + 1];
              const az = this.wallA[3 * w + 2];
              const A = Math.hypot(ax, ay, az);
              s += Math.abs(vel[0] * ax + vel[1] * ay + vel[2] * az) + a * A;
            }
            this.dtCell[ci] = (cfl * alpha[ci] * vol) / (0.5 * s);
          }
          if (this.dtCell[ci] < dmin) dmin = this.dtCell[ci];
        }
    return dmin;
  }

  private copyState(src: Float64Array[], dst: Float64Array[]) {
    for (let v = 0; v < NV; v++) dst[v].set(src[v]);
  }

  /** U ← a·U0 + b·(U + Δt/V · R) over the fluid cells (Δt = the global step, or each cell's own in local mode) */
  private update(dt: number, a: number, b: number) {
    const { nx, ny, nz, dx, dy, dz } = this.grid;
    const vol = dx * dy * dz;
    const local = this.opts.timeMode === 'local';
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const c = (k * ny + j) * nx + i;
          if (this.solid[c] || (this.merged && this.merged[c])) continue;
          const kv = (local ? this.dtCell[c] : dt) / (this.alpha ? this.alpha[c] * vol : vol);
          const pc = this.P(i, j, k);
          for (let v = 0; v < NV; v++) this.U[v][pc] = a * this.U0[v][pc] + b * (this.U[v][pc] + kv * this.res[v][c]);
        }
    // merged groups: one state from the volume-weighted member states, the summed residual and the group Δt
    const alpha = this.alpha!;
    for (const g of this.groups) {
      let va = 0;
      let invDt = 0;
      for (const c of g) {
        va += alpha[c];
        invDt += alpha[c] / this.dtCell[c];
      }
      // local steps: Δt_group = V_group / Σ (V_c / Δt_c) (the members' wave-speed sums add up)
      const kv = (local ? va / invDt : dt) / (va * vol);
      for (let v = 0; v < NV; v++) {
        let u0 = 0;
        let u1 = 0;
        let rsum = 0;
        for (const c of g) {
          const pc = this.cellPad(c);
          u0 += alpha[c] * this.U0[v][pc];
          u1 += alpha[c] * this.U[v][pc];
          rsum += this.res[v][c];
        }
        const val = a * (u0 / va) + b * (u1 / va + kv * rsum);
        for (const c of g) this.U[v][this.cellPad(c)] = val;
      }
    }
  }

  /** padded index of interior cell index c = (k·ny + j)·nx + i */
  private cellPad(c: number) {
    const { nx, ny } = this.grid;
    const i = c % nx;
    const j = ((c - i) / nx) % ny;
    return this.P(i, j, (c - i - j * nx) / (nx * ny));
  }

  /**
   * One SSP-RK2 step, capped at `maxDt` (to land on an output time). On a non-physical state the step is undone
   * and `failure` says where; later calls do nothing until `init` is called again.
   */
  step(maxDt = Infinity): Step3DResult {
    if (this.failure) return { ok: false, dt: 0, residual: NaN, residualRegion: NaN };
    const { nx, ny, nz, dx, dy, dz } = this.grid;
    this.copyState(this.U, this.Ubackup);
    this.fallbacks = 0;
    this.hllcFallbacks = 0;
    if (!this.toPrimitive(0)) return this.abort();
    this.fillGhosts();
    const dt = Math.min(this.computeDt(), maxDt);
    if (!(dt > 0) || !Number.isFinite(dt)) {
      this.failure = { step: this.steps, stage: 0, i: -1, j: -1, k: -1, rho: NaN, p: NaN, reason: 'invalid time step' };
      return this.abort();
    }
    this.computeResidual();
    this.bodyMassFlux = this.lastBodyFlux;
    this.boundaryMassFlux = this.lastBoundaryFlux;
    const vol = dx * dy * dz;
    let s2 = 0;
    let r2 = 0;
    let nr = 0;
    let counted = 0;
    for (let c = 0; c < nx * ny * nz; c++) {
      if (this.solid[c] || (this.merged && this.merged[c])) continue;
      const d2 = (this.res[0][c] / (this.alpha ? this.alpha[c] * vol : vol)) ** 2;
      s2 += d2;
      counted++;
      if (this.region && this.region[c]) {
        r2 += d2;
        nr++;
      }
    }
    // a merged group counts once, with its summed residual (its members' own residuals need not vanish)
    for (const g of this.groups) {
      let rs = 0;
      let va = 0;
      for (const c of g) {
        rs += this.res[0][c];
        va += this.alpha![c];
      }
      const d2 = (rs / (va * vol)) ** 2;
      s2 += d2;
      counted++;
      if (this.region && this.region[g[0]]) {
        r2 += d2;
        nr++;
      }
    }
    const residual = Math.sqrt(s2 / counted);
    const residualRegion = nr ? Math.sqrt(r2 / nr) : NaN;
    this.copyState(this.U, this.U0);
    this.update(dt, 0, 1); // U1 = Un + Δt R(Un)
    if (!this.toPrimitive(1)) return this.abort();
    this.fillGhosts();
    this.computeResidual();
    this.update(dt, 0.5, 0.5); // Un+1 = ½ Un + ½ (U1 + Δt R(U1))
    if (!this.toPrimitive(2)) return this.abort();
    this.steps++;
    if (this.opts.timeMode !== 'local') this.time += dt;
    this.lastDt = dt;
    return { ok: true, dt, residual, residualRegion };
  }

  stepTo(t: number): Step3DResult {
    return this.step(t - this.time);
  }

  private abort(): Step3DResult {
    this.copyState(this.Ubackup, this.U);
    return { ok: false, dt: 0, residual: NaN, residualRegion: NaN };
  }

  // ───────── read-out ─────────
  cell(i: number, j: number, k: number): Primitive3D & { T: number; mach: number } {
    const c = this.P(i, j, k);
    const rho = this.U[0][c];
    const u = this.U[1][c] / rho;
    const v = this.U[2][c] / rho;
    const w = this.U[3][c] / rho;
    const p = (this.gamma - 1) * (this.U[4][c] - 0.5 * rho * (u * u + v * v + w * w));
    return { rho, u, v, w, p, T: p / (rho * GAS.R), mach: Math.sqrt(u * u + v * v + w * w) / Math.sqrt((this.gamma * p) / rho) };
  }

  /** Σ U·V over the fluid cells: mass kg, momentum kg·m/s, energy J */
  totals() {
    const { nx, ny, nz, dx, dy, dz } = this.grid;
    const vol = dx * dy * dz;
    const t = [0, 0, 0, 0, 0];
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          if (this.solid[(k * ny + j) * nx + i]) continue;
          const c = this.P(i, j, k);
          const w = this.alpha ? this.alpha[(k * ny + j) * nx + i] * vol : vol;
          for (let v = 0; v < NV; v++) t[v] += this.U[v][c] * w;
        }
    return { mass: t[0], momX: t[1], momY: t[2], momZ: t[3], energy: t[4] };
  }

  // ───────── checkpoint support ─────────
  /** a copy of the carried state (exact; see Solver3DState) */
  exportState(): Solver3DState {
    if (this.failure) throw new Error('cannot export the state of a failed solver');
    return {
      revision: SOLVER3D_STATE_REVISION,
      U: this.U.map((a) => a.slice()),
      steps: this.steps,
      time: this.time,
      lastDt: this.lastDt,
      order: this.opts.order,
      hllcFallbacksTotal: this.hllcFallbacksTotal,
      hllcCalls: this.hllcCalls,
    };
  }

  /**
   * Continue from an exported state. The solver must have been constructed with the same grid and options; the
   * caller checks that (checkpoint3d.ts compares the configuration and `geometryFingerprint`). Here: revision,
   * array count and lengths, finite values, and positive density and pressure at every fluid cell.
   */
  importState(s: Solver3DState) {
    if (s.revision !== SOLVER3D_STATE_REVISION) throw new Error(`state revision ${s.revision} does not match solver revision ${SOLVER3D_STATE_REVISION}`);
    if (!Array.isArray(s.U) || s.U.length !== NV) throw new Error(`state has ${Array.isArray(s.U) ? s.U.length : 'no'} conservative arrays, expected ${NV}`);
    const n = this.px * this.py * this.pz;
    for (let v = 0; v < NV; v++) {
      if (s.U[v].length !== n) throw new Error(`conservative array ${v} has ${s.U[v].length} entries, expected ${n} (padded grid)`);
      for (let c = 0; c < n; c++) if (!Number.isFinite(s.U[v][c])) throw new Error(`conservative array ${v} has a non-finite value at padded index ${c}`);
    }
    if (!Number.isInteger(s.steps) || s.steps < 0) throw new Error(`invalid step count ${s.steps}`);
    if (!Number.isFinite(s.time) || !Number.isFinite(s.lastDt)) throw new Error('invalid time or last time step');
    if (s.order !== 1 && s.order !== 2) throw new Error(`invalid reconstruction order ${s.order}`);
    if (!Number.isInteger(s.hllcFallbacksTotal) || !Number.isInteger(s.hllcCalls) || s.hllcFallbacksTotal < 0 || s.hllcCalls < 0) throw new Error('invalid HLLC counters');
    const { nx, ny, nz } = this.grid;
    const g1 = this.gamma - 1;
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          if (this.solid[(k * ny + j) * nx + i]) continue;
          const c = this.P(i, j, k);
          const rho = s.U[0][c];
          const ke = (s.U[1][c] ** 2 + s.U[2][c] ** 2 + s.U[3][c] ** 2) / (2 * rho);
          if (!(rho > 0) || !(g1 * (s.U[4][c] - ke) > 0)) throw new Error(`non-physical state at fluid cell (${i}, ${j}, ${k})`);
        }
    for (let v = 0; v < NV; v++) this.U[v].set(s.U[v]);
    this.steps = s.steps;
    this.time = s.time;
    this.lastDt = s.lastDt;
    this.setOrder(s.order);
    this.hllcFallbacksTotal = s.hllcFallbacksTotal;
    this.hllcCalls = s.hllcCalls;
    this.failure = null;
  }

  /** CRC-32 of the static geometry (solid mask, cut-cell volume fractions, merge membership) and the fluid-cell
   *  count: equal for two solvers built from the same configuration by the same code */
  geometryFingerprint(): { fluidCells: number; crc: number } {
    const parts: Uint8Array[] = [this.solid];
    if (this.alpha) parts.push(new Uint8Array(this.alpha.buffer, this.alpha.byteOffset, this.alpha.byteLength));
    if (this.merged) parts.push(this.merged);
    let crc = 0;
    for (const p of parts) crc = crc32(p, crc);
    return { fluidCells: this.fluidCells, crc };
  }
}
