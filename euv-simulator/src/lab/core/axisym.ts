import { GAS } from './gas';

/**
 * RESEARCH PROTOTYPE — axisymmetric (x–r) compressible Euler equations, finite volumes on a structured grid of
 * straight-edged quadrilaterals in the meridional half-plane (r ≥ 0). Independent of the Cartesian 3D solver
 * (euler3d.ts); derivation, discretization and boundary conditions are documented in docs/axisymmetric-reference.md.
 *
 *   d/dt (V U_c) = −Σ_f F̂_f A_f + (0, 0, p_c A, 0),   U = (ρ, ρu, ρv, E),  u axial, v radial
 *
 * V = A r_c (ring volume per radian), A_f = L r_mid (ring face area per radian), A = planar cell area. With these the
 * identities Σ n_r A_f = A and Σ n_x A_f = 0 hold exactly for every cell, so a uniform pressure is balanced to
 * round-off. Not used by the application.
 */

export interface AxiPrimitive {
  rho: number;
  u: number;
  v: number;
  p: number;
}

/** structured grid: (ni + 1) × (nj + 1) vertices, vertex (i, j) at index j (ni + 1) + i */
export interface AxiGrid {
  ni: number;
  nj: number;
  x: Float64Array;
  r: Float64Array;
}

/** rectangular grid on [x0, x1] × [r0, r1], uniform spacing; i along x, j along r */
export function rectGrid(x0: number, x1: number, r0: number, r1: number, ni: number, nj: number): AxiGrid {
  if (r0 < 0) throw new Error('the meridional half-plane needs r ≥ 0');
  const x = new Float64Array((ni + 1) * (nj + 1));
  const r = new Float64Array((ni + 1) * (nj + 1));
  for (let j = 0; j <= nj; j++)
    for (let i = 0; i <= ni; i++) {
      x[j * (ni + 1) + i] = x0 + ((x1 - x0) * i) / ni;
      r[j * (ni + 1) + i] = r0 + ((r1 - r0) * j) / nj;
    }
  return { ni, nj, x, r };
}

/**
 * spherical-polar grid around the origin: i along the distance ρ ∈ [rho0, rho1], j along the polar angle
 * θ ∈ [theta0, theta1] (radians) measured from the negative x axis, x = −ρ cos θ, r = ρ sin θ; uniform in ρ and θ.
 * With rho0 = R this is the body-fitted grid of a sphere of radius R centred at the origin, θ = 0 being the
 * upstream stagnation line.
 */
export function polarGrid(rho0: number, rho1: number, theta0: number, theta1: number, ni: number, nj: number): AxiGrid {
  if (theta0 < 0 || theta1 > Math.PI) throw new Error('polar angles must lie in [0, π]');
  const x = new Float64Array((ni + 1) * (nj + 1));
  const r = new Float64Array((ni + 1) * (nj + 1));
  for (let j = 0; j <= nj; j++)
    for (let i = 0; i <= ni; i++) {
      const rho = rho0 + ((rho1 - rho0) * i) / ni;
      const th = theta0 + ((theta1 - theta0) * j) / nj;
      x[j * (ni + 1) + i] = -rho * Math.cos(th);
      // sin(π) is not exactly 0 in floating point: snap the axis
      r[j * (ni + 1) + i] = th === 0 || th === Math.PI ? 0 : rho * Math.sin(th);
    }
  return { ni, nj, x, r };
}

export type AxiBC = { type: 'wall' } | { type: 'axis' } | { type: 'outflow' } | { type: 'inflow'; state: (x: number, r: number) => AxiPrimitive };
export type AxiSide = 'iMin' | 'iMax' | 'jMin' | 'jMax';

export interface AxiOptions {
  gamma?: number;
  cfl: number;
  order: 1 | 2;
  /** numerical flux: 'rusanov' (default) or 'hllc' (with a counted Rusanov fallback) */
  flux?: 'rusanov' | 'hllc';
  /** 'global' (default, time-accurate) or 'local' (each cell its own Δt; steady states only) */
  timeMode?: 'global' | 'local';
  bc: Record<AxiSide, AxiBC>;
  /** optional sub-region for a second residual, evaluated at cell centroids */
  residualRegion?: (x: number, r: number) => boolean;
}

export interface AxiFailure {
  step: number;
  stage: number;
  i: number;
  j: number;
  rho: number;
  p: number;
  reason: string;
}

export interface AxiStepResult {
  ok: boolean;
  dt: number;
  /** RMS over cells of ∂ρ/∂t at the start of the step */
  residual: number;
  /** the same over `residualRegion` (NaN without one) */
  residualRegion: number;
}

const NV = 4;

export class AxiEuler {
  readonly grid: AxiGrid;
  readonly gamma: number;
  opts: AxiOptions;
  readonly ni: number;
  readonly nj: number;
  /** padded width (two ghost layers per side) */
  private readonly pw: number;
  // cell geometry (interior index c = j ni + i)
  readonly area: Float64Array;
  readonly xc: Float64Array;
  readonly rc: Float64Array;
  readonly vol: Float64Array;
  // faces: i-faces (between cells i − 1 and i), index j (ni + 1) + i; j-faces, index j ni + i; unit normals point
  // towards increasing index; A = ring area per radian
  private readonly fiNx: Float64Array;
  private readonly fiNr: Float64Array;
  private readonly fiA: Float64Array;
  private readonly fjNx: Float64Array;
  private readonly fjNr: Float64Array;
  private readonly fjA: Float64Array;
  // state
  private U: Float64Array[];
  private U0: Float64Array[];
  private Ubackup: Float64Array[];
  private res: Float64Array[];
  private rho: Float64Array;
  private uu: Float64Array;
  private vv: Float64Array;
  private pp: Float64Array;
  private dtCell: Float64Array;
  private region: Uint8Array | null = null;
  private f = new Float64Array(NV);
  time = 0;
  steps = 0;
  failure: AxiFailure | null = null;
  /** faces reconstructed at first order because the second-order states were not positive (last step) */
  fallbacks = 0;
  /** HLLC faces that fell back to Rusanov: last step, total, and total HLLC evaluations */
  hllcFallbacks = 0;
  hllcFallbacksTotal = 0;
  hllcCalls = 0;
  /** mass flux into the domain through each boundary side at the last residual evaluation, kg/s per radian */
  readonly boundaryMassFlux: Record<AxiSide, number> = { iMin: 0, iMax: 0, jMin: 0, jMax: 0 };
  /** time integral of the total boundary mass inflow (global time stepping: exact with the RK2 weights) */
  boundaryMassIntegral = 0;
  /** smallest density and pressure over the cells after the last step */
  minRho = Infinity;
  minP = Infinity;

  constructor(grid: AxiGrid, opts: AxiOptions) {
    const { ni, nj } = grid;
    if (ni < 2 || nj < 2) throw new Error('at least 2 cells per direction');
    this.grid = grid;
    this.opts = opts;
    this.gamma = opts.gamma ?? GAS.gamma;
    this.ni = ni;
    this.nj = nj;
    this.pw = ni + 4;
    const nc = ni * nj;
    const np = (ni + 4) * (nj + 4);
    this.area = new Float64Array(nc);
    this.xc = new Float64Array(nc);
    this.rc = new Float64Array(nc);
    this.vol = new Float64Array(nc);
    const X = (i: number, j: number) => grid.x[j * (ni + 1) + i];
    const R = (i: number, j: number) => grid.r[j * (ni + 1) + i];
    for (let j = 0; j < nj; j++)
      for (let i = 0; i < ni; i++) {
        // shoelace over (i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)
        const px = [X(i, j), X(i + 1, j), X(i + 1, j + 1), X(i, j + 1)];
        const pr = [R(i, j), R(i + 1, j), R(i + 1, j + 1), R(i, j + 1)];
        let a2 = 0;
        let cx = 0;
        let cr = 0;
        for (let k = 0; k < 4; k++) {
          const k1 = (k + 1) % 4;
          const cross = px[k] * pr[k1] - px[k1] * pr[k];
          a2 += cross;
          cx += (px[k] + px[k1]) * cross;
          cr += (pr[k] + pr[k1]) * cross;
        }
        const c = j * ni + i;
        const a = 0.5 * a2;
        if (!(Math.abs(a) > 0)) throw new Error(`degenerate cell (${i}, ${j})`);
        this.area[c] = Math.abs(a);
        this.xc[c] = cx / (6 * a);
        this.rc[c] = cr / (6 * a);
        if (this.rc[c] < 0) throw new Error('the grid must lie in r ≥ 0');
        this.vol[c] = this.area[c] * this.rc[c];
        if (!(this.vol[c] > 0)) throw new Error(`cell (${i}, ${j}) has zero ring volume (a cell on the axis must have positive area off it)`);
      }
    // faces
    this.fiNx = new Float64Array((ni + 1) * nj);
    this.fiNr = new Float64Array((ni + 1) * nj);
    this.fiA = new Float64Array((ni + 1) * nj);
    this.fjNx = new Float64Array(ni * (nj + 1));
    this.fjNr = new Float64Array(ni * (nj + 1));
    this.fjA = new Float64Array(ni * (nj + 1));
    const setFace = (ax: number, ar: number, bx: number, br: number, refX: number, refR: number, sign: number, nx: Float64Array, nr: Float64Array, A: Float64Array, k: number) => {
      const L = Math.hypot(bx - ax, br - ar);
      let mx = (br - ar) / L;
      let mr = -(bx - ax) / L;
      // orient towards increasing index: (reference centroid − face midpoint) · n has the given sign
      const d = (refX - 0.5 * (ax + bx)) * mx + (refR - 0.5 * (ar + br)) * mr;
      if (d * sign < 0) {
        mx = -mx;
        mr = -mr;
      }
      nx[k] = mx;
      nr[k] = mr;
      A[k] = L * 0.5 * (ar + br);
    };
    for (let j = 0; j < nj; j++)
      for (let i = 0; i <= ni; i++) {
        const ref = i < ni ? j * ni + i : j * ni + i - 1;
        setFace(X(i, j), R(i, j), X(i, j + 1), R(i, j + 1), this.xc[ref], this.rc[ref], i < ni ? 1 : -1, this.fiNx, this.fiNr, this.fiA, j * (ni + 1) + i);
      }
    for (let j = 0; j <= nj; j++)
      for (let i = 0; i < ni; i++) {
        const ref = j < nj ? j * ni + i : (j - 1) * ni + i;
        setFace(X(i, j), R(i, j), X(i + 1, j), R(i + 1, j), this.xc[ref], this.rc[ref], j < nj ? 1 : -1, this.fjNx, this.fjNr, this.fjA, j * ni + i);
      }
    // an axis boundary must lie on r = 0
    for (const side of ['iMin', 'iMax', 'jMin', 'jMax'] as AxiSide[]) {
      if (opts.bc[side].type !== 'axis') continue;
      const onAxis = side === 'iMin' || side === 'iMax' ? Array.from({ length: nj + 1 }, (_, j) => R(side === 'iMin' ? 0 : ni, j)) : Array.from({ length: ni + 1 }, (_, i) => R(i, side === 'jMin' ? 0 : nj));
      if (onAxis.some((v) => Math.abs(v) > 1e-14)) throw new Error(`the ${side} boundary is declared 'axis' but does not lie on r = 0`);
    }
    const mk = (m: number, len: number) => Array.from({ length: m }, () => new Float64Array(len));
    this.U = mk(NV, np);
    this.U0 = mk(NV, np);
    this.Ubackup = mk(NV, np);
    this.res = mk(NV, nc);
    this.rho = new Float64Array(np);
    this.uu = new Float64Array(np);
    this.vv = new Float64Array(np);
    this.pp = new Float64Array(np);
    this.dtCell = new Float64Array(nc);
    if (opts.residualRegion) {
      this.region = new Uint8Array(nc);
      for (let c = 0; c < nc; c++) this.region[c] = opts.residualRegion(this.xc[c], this.rc[c]) ? 1 : 0;
    }
  }

  /** padded index of cell (i, j); i ∈ −2 … ni + 1, j ∈ −2 … nj + 1 */
  P(i: number, j: number) {
    return (j + 2) * this.pw + i + 2;
  }

  init(fn: (x: number, r: number) => AxiPrimitive) {
    const g1 = this.gamma - 1;
    for (let j = 0; j < this.nj; j++)
      for (let i = 0; i < this.ni; i++) {
        const c = j * this.ni + i;
        const s = fn(this.xc[c], this.rc[c]);
        const k = this.P(i, j);
        this.U[0][k] = s.rho;
        this.U[1][k] = s.rho * s.u;
        this.U[2][k] = s.rho * s.v;
        this.U[3][k] = s.p / g1 + 0.5 * s.rho * (s.u * s.u + s.v * s.v);
      }
    this.time = 0;
    this.steps = 0;
    this.failure = null;
    this.boundaryMassIntegral = 0;
  }

  setOrder(order: 1 | 2) {
    this.opts = { ...this.opts, order };
  }

  /** primitive state, temperature and Mach number of cell (i, j) */
  cell(i: number, j: number) {
    const k = this.P(i, j);
    const rho = this.U[0][k];
    const u = this.U[1][k] / rho;
    const v = this.U[2][k] / rho;
    const p = (this.gamma - 1) * (this.U[3][k] - 0.5 * rho * (u * u + v * v));
    return { rho, u, v, p, T: p / (rho * GAS.R), mach: Math.hypot(u, v) / Math.sqrt((this.gamma * p) / rho) };
  }

  /** totals over the domain per radian: Σ V (ρ, ρu, E) */
  totals() {
    let mass = 0;
    let momX = 0;
    let energy = 0;
    for (let j = 0; j < this.nj; j++)
      for (let i = 0; i < this.ni; i++) {
        const V = this.vol[j * this.ni + i];
        const k = this.P(i, j);
        mass += V * this.U[0][k];
        momX += V * this.U[1][k];
        energy += V * this.U[3][k];
      }
    return { mass, momX, energy };
  }

  /** the largest relative violation over cells of Σ n_r A_f = A and Σ n_x A_f = 0 (exact up to round-off) */
  geometryResidual() {
    const { ni, nj } = this;
    let worst = 0;
    for (let j = 0; j < nj; j++)
      for (let i = 0; i < ni; i++) {
        const lo = j * (ni + 1) + i;
        const hi = lo + 1;
        const jl = j * ni + i;
        const jh = (j + 1) * ni + i;
        const sr = -this.fiNr[lo] * this.fiA[lo] + this.fiNr[hi] * this.fiA[hi] - this.fjNr[jl] * this.fjA[jl] + this.fjNr[jh] * this.fjA[jh];
        const sx = -this.fiNx[lo] * this.fiA[lo] + this.fiNx[hi] * this.fiA[hi] - this.fjNx[jl] * this.fjA[jl] + this.fjNx[jh] * this.fjA[jh];
        const a = this.area[jl];
        const scale = Math.max(a, this.fiA[lo], this.fiA[hi], this.fjA[jl], this.fjA[jh]);
        worst = Math.max(worst, Math.abs(sr - a) / scale, Math.abs(sx) / scale);
      }
    return worst;
  }

  /** ring area per radian of the face on boundary `side` at position k along it */
  boundaryFace(side: AxiSide, k: number) {
    const { ni } = this;
    if (side === 'iMin' || side === 'iMax') {
      const f = k * (ni + 1) + (side === 'iMin' ? 0 : ni);
      return { nx: this.fiNx[f], nr: this.fiNr[f], area: this.fiA[f] };
    }
    const f = (side === 'jMin' ? 0 : this.nj) * ni + k;
    return { nx: this.fjNx[f], nr: this.fjNr[f], area: this.fjA[f] };
  }

  /** midpoint (x, r) of the face on boundary `side` at position k */
  private faceMid(side: AxiSide, k: number): [number, number] {
    const { ni, nj } = this;
    const g = this.grid;
    const v = (i: number, j: number) => j * (ni + 1) + i;
    const [a, b] = side === 'iMin' ? [v(0, k), v(0, k + 1)] : side === 'iMax' ? [v(ni, k), v(ni, k + 1)] : side === 'jMin' ? [v(k, 0), v(k + 1, 0)] : [v(k, nj), v(k + 1, nj)];
    return [0.5 * (g.x[a] + g.x[b]), 0.5 * (g.r[a] + g.r[b])];
  }

  /** interior index of the cell `layer` cells in from boundary `side` at position k */
  private interiorCell(side: AxiSide, k: number, layer: number) {
    const { ni, nj } = this;
    if (side === 'iMin') return k * ni + layer;
    if (side === 'iMax') return k * ni + ni - 1 - layer;
    if (side === 'jMin') return layer * ni + k;
    return (nj - 1 - layer) * ni + k;
  }

  // ───────── primitives and validity ─────────
  private toPrimitive(stage: number): boolean {
    const g1 = this.gamma - 1;
    const [R, MU, MV, E] = this.U;
    let minRho = Infinity;
    let minP = Infinity;
    for (let j = 0; j < this.nj; j++)
      for (let i = 0; i < this.ni; i++) {
        const k = this.P(i, j);
        const rho = R[k];
        const u = MU[k] / rho;
        const v = MV[k] / rho;
        const p = g1 * (E[k] - 0.5 * rho * (u * u + v * v));
        if (!(rho > 0) || !(p > 0) || !Number.isFinite(rho) || !Number.isFinite(p)) {
          this.failure = { step: this.steps, stage, i, j, rho, p, reason: !Number.isFinite(rho) || !Number.isFinite(p) ? 'non-finite state' : rho <= 0 ? 'non-positive density' : 'non-positive pressure' };
          return false;
        }
        this.rho[k] = rho;
        this.uu[k] = u;
        this.vv[k] = v;
        this.pp[k] = p;
        if (rho < minRho) minRho = rho;
        if (p < minP) minP = p;
      }
    this.minRho = minRho;
    this.minP = minP;
    return true;
  }

  // ───────── ghost cells ─────────
  private setGhost(dst: number, rho: number, u: number, v: number, p: number) {
    this.rho[dst] = rho;
    this.uu[dst] = u;
    this.vv[dst] = v;
    this.pp[dst] = p;
  }

  private fillGhosts() {
    const { ni, nj } = this;
    const sides: AxiSide[] = ['iMin', 'iMax', 'jMin', 'jMax'];
    for (const side of sides) {
      const bc = this.opts.bc[side];
      const along = side === 'iMin' || side === 'iMax' ? nj : ni;
      for (let k = 0; k < along; k++) {
        // interior layers 0, 1 and ghost layers 1, 2 (outwards) of this column
        const at = (layer: number) => {
          if (side === 'iMin') return this.P(layer, k);
          if (side === 'iMax') return this.P(ni - 1 - layer, k);
          if (side === 'jMin') return this.P(k, layer);
          return this.P(k, nj - 1 - layer);
        };
        const in0 = at(0);
        const in1 = at(1);
        const g1 = at(-1);
        const g2 = at(-2);
        if (bc.type === 'outflow') {
          for (const g of [g1, g2]) this.setGhost(g, this.rho[in0], this.uu[in0], this.vv[in0], this.pp[in0]);
        } else if (bc.type === 'inflow') {
          // the prescribed state at each ghost layer's position: the interior centroid mirrored across the face
          const m = this.faceMid(side, k);
          const c0 = this.interiorCell(side, k, 0);
          const c1 = this.interiorCell(side, k, 1);
          for (const [g, c] of [
            [g1, c0],
            [g2, c1],
          ]) {
            const s = bc.state(2 * m[0] - this.xc[c], Math.abs(2 * m[1] - this.rc[c]));
            this.setGhost(g, s.rho, s.u, s.v, s.p);
          }
        } else {
          // wall or axis: mirror across the boundary face (normal velocity reversed)
          const f = this.boundaryFace(side, k);
          for (const [g, src] of [
            [g1, in0],
            [g2, in1],
          ]) {
            const u = this.uu[src];
            const v = this.vv[src];
            const vn = u * f.nx + v * f.nr;
            this.setGhost(g, this.rho[src], u - 2 * vn * f.nx, v - 2 * vn * f.nr, this.pp[src]);
          }
        }
      }
    }
  }

  // ───────── numerical flux ─────────
  private static minmod(a: number, b: number) {
    if (a * b <= 0) return 0;
    return Math.abs(a) < Math.abs(b) ? a : b;
  }

  /** flux through a face of unit normal (nx, nr) between padded cells l and r (outer neighbours ll, rr), per unit area, into this.f */
  private faceFlux(ll: number, l: number, r: number, rr: number, nx: number, nr: number) {
    const R = this.rho;
    const U = this.uu;
    const V = this.vv;
    const Pp = this.pp;
    let rL = R[l],
      rR = R[r],
      pL = Pp[l],
      pR = Pp[r];
    // velocities in the face-normal frame (u_n, u_t): reconstructing these (not u, v) keeps a mirror ghost state an
    // exact mirror after limiting, so wall faces carry exactly zero mass and energy flux
    let unL = U[l] * nx + V[l] * nr;
    let unR = U[r] * nx + V[r] * nr;
    let utL = -U[l] * nr + V[l] * nx;
    let utR = -U[r] * nr + V[r] * nx;
    if (this.opts.order === 2) {
      const mm = AxiEuler.minmod;
      const r2L = R[l] + 0.5 * mm(R[l] - R[ll], R[r] - R[l]);
      const r2R = R[r] - 0.5 * mm(R[r] - R[l], R[rr] - R[r]);
      const p2L = Pp[l] + 0.5 * mm(Pp[l] - Pp[ll], Pp[r] - Pp[l]);
      const p2R = Pp[r] - 0.5 * mm(Pp[r] - Pp[l], Pp[rr] - Pp[r]);
      if (r2L > 0 && r2R > 0 && p2L > 0 && p2R > 0) {
        rL = r2L;
        rR = r2R;
        pL = p2L;
        pR = p2R;
        const unLL = U[ll] * nx + V[ll] * nr;
        const unRR = U[rr] * nx + V[rr] * nr;
        const utLL = -U[ll] * nr + V[ll] * nx;
        const utRR = -U[rr] * nr + V[rr] * nx;
        const un0 = unL;
        const un1 = unR;
        const ut0 = utL;
        const ut1 = utR;
        unL = un0 + 0.5 * mm(un0 - unLL, un1 - un0);
        unR = un1 - 0.5 * mm(un1 - un0, unRR - un1);
        utL = ut0 + 0.5 * mm(ut0 - utLL, ut1 - ut0);
        utR = ut1 - 0.5 * mm(ut1 - ut0, utRR - ut1);
      } else this.fallbacks++;
    }
    const f = this.f;
    let done = false;
    if (this.opts.flux === 'hllc') {
      this.hllcCalls++;
      done = this.hllc(rL, unL, utL, pL, rR, unR, utR, pR);
      if (!done) {
        this.hllcFallbacks++;
        this.hllcFallbacksTotal++;
      }
    }
    if (!done) this.rusanov(rL, unL, utL, pL, rR, unR, utR, pR);
    // back to (x, r): f = (mass, normal momentum, tangential momentum, energy)
    const fn = f[1];
    const ft = f[2];
    f[1] = fn * nx - ft * nr;
    f[2] = fn * nr + ft * nx;
  }

  private rusanov(rL: number, unL: number, utL: number, pL: number, rR: number, unR: number, utR: number, pR: number) {
    const g = this.gamma;
    const EL = pL / (g - 1) + 0.5 * rL * (unL * unL + utL * utL);
    const ER = pR / (g - 1) + 0.5 * rR * (unR * unR + utR * utR);
    const lam = Math.max(Math.abs(unL) + Math.sqrt((g * pL) / rL), Math.abs(unR) + Math.sqrt((g * pR) / rR));
    const f = this.f;
    f[0] = 0.5 * (rL * unL + rR * unR - lam * (rR - rL));
    f[1] = 0.5 * (rL * unL * unL + pL + rR * unR * unR + pR - lam * (rR * unR - rL * unL));
    f[2] = 0.5 * (rL * unL * utL + rR * unR * utR - lam * (rR * utR - rL * utL));
    f[3] = 0.5 * ((EL + pL) * unL + (ER + pR) * unR - lam * (ER - EL));
  }

  /**
   * HLLC (Toro, Spruce & Speares 1994) in the face-normal frame with Einfeldt wave speeds from Roe averages; false
   * (caller uses Rusanov) when not admissible: Roe sound speed² ≤ 0, vanishing mass-flux denominator, S* outside
   * (S_L, S_R), star pressure or density ≤ 0, or a non-finite result.
   */
  private hllc(rL: number, unL: number, utL: number, pL: number, rR: number, unR: number, utR: number, pR: number): boolean {
    const g = this.gamma;
    const EL = pL / (g - 1) + 0.5 * rL * (unL * unL + utL * utL);
    const ER = pR / (g - 1) + 0.5 * rR * (unR * unR + utR * utR);
    const aL = Math.sqrt((g * pL) / rL);
    const aR = Math.sqrt((g * pR) / rR);
    const sl = Math.sqrt(rL);
    const sr = Math.sqrt(rR);
    const wl = sl / (sl + sr);
    const wr = 1 - wl;
    const unT = wl * unL + wr * unR;
    const utT = wl * utL + wr * utR;
    const HT = (wl * (EL + pL)) / rL + (wr * (ER + pR)) / rR;
    const a2 = (g - 1) * (HT - 0.5 * (unT * unT + utT * utT));
    if (!(a2 > 0)) return false;
    const aT = Math.sqrt(a2);
    const SL = Math.min(unL - aL, unT - aT);
    const SR = Math.max(unR + aR, unT + aT);
    const mL = rL * (SL - unL);
    const mR = rR * (SR - unR);
    const den = mL - mR;
    if (!(den < -1e-12 * (Math.abs(mL) + Math.abs(mR)))) return false;
    const Ss = (pR - pL + mL * unL - mR * unR) / den;
    if (!(Ss > SL && Ss < SR)) return false;
    if (!(pL + mL * (Ss - unL) > 0)) return false;
    const left = Ss >= 0;
    const r = left ? rL : rR;
    const un = left ? unL : unR;
    const ut = left ? utL : utR;
    const p = left ? pL : pR;
    const E = left ? EL : ER;
    const S = left ? SL : SR;
    const m = left ? mL : mR;
    const f = this.f;
    f[0] = r * un;
    f[1] = r * un * un + p;
    f[2] = r * un * ut;
    f[3] = (E + p) * un;
    if ((left && SL < 0) || (!left && SR > 0)) {
      const rs = m / (S - Ss);
      if (!(rs > 0)) return false;
      f[0] += S * (rs - r);
      f[1] += S * (rs * Ss - r * un);
      f[2] += S * (rs * ut - r * ut);
      f[3] += S * (rs * (E / r + (Ss - un) * (Ss + p / m)) - E);
    }
    for (let q = 0; q < NV; q++) if (!Number.isFinite(f[q])) return false;
    return true;
  }

  // ───────── residual ─────────
  private computeResidual() {
    const { ni, nj } = this;
    const res = this.res;
    for (let q = 0; q < NV; q++) res[q].fill(0);
    const f = this.f;
    const bmf = this.boundaryMassFlux;
    bmf.iMin = bmf.iMax = bmf.jMin = bmf.jMax = 0;
    // i-faces
    for (let j = 0; j < nj; j++)
      for (let i = 0; i <= ni; i++) {
        const k = j * (ni + 1) + i;
        const A = this.fiA[k];
        if (A === 0) continue;
        this.faceFlux(this.P(i - 2, j), this.P(i - 1, j), this.P(i, j), this.P(i + 1, j), this.fiNx[k], this.fiNr[k]);
        if (i > 0) for (let q = 0; q < NV; q++) res[q][j * ni + i - 1] -= f[q] * A;
        if (i < ni) for (let q = 0; q < NV; q++) res[q][j * ni + i] += f[q] * A;
        if (i === 0) bmf.iMin += f[0] * A;
        if (i === ni) bmf.iMax -= f[0] * A;
      }
    // j-faces
    for (let j = 0; j <= nj; j++)
      for (let i = 0; i < ni; i++) {
        const k = j * ni + i;
        const A = this.fjA[k];
        if (A === 0) continue;
        this.faceFlux(this.P(i, j - 2), this.P(i, j - 1), this.P(i, j), this.P(i, j + 1), this.fjNx[k], this.fjNr[k]);
        if (j > 0) for (let q = 0; q < NV; q++) res[q][(j - 1) * ni + i] -= f[q] * A;
        if (j < nj) for (let q = 0; q < NV; q++) res[q][j * ni + i] += f[q] * A;
        if (j === 0) bmf.jMin += f[0] * A;
        if (j === nj) bmf.jMax -= f[0] * A;
      }
    // geometric source: radial momentum + p A (planar area)
    for (let j = 0; j < nj; j++)
      for (let i = 0; i < ni; i++) {
        const c = j * ni + i;
        res[2][c] += this.pp[this.P(i, j)] * this.area[c];
      }
  }

  private computeDt(): number {
    const { ni, nj } = this;
    const g = this.gamma;
    let dmin = Infinity;
    for (let j = 0; j < nj; j++)
      for (let i = 0; i < ni; i++) {
        const k = this.P(i, j);
        const a = Math.sqrt((g * this.pp[k]) / this.rho[k]);
        const u = this.uu[k];
        const v = this.vv[k];
        let s = 0;
        for (const f of [j * (ni + 1) + i, j * (ni + 1) + i + 1]) s += (Math.abs(u * this.fiNx[f] + v * this.fiNr[f]) + a) * this.fiA[f];
        for (const f of [j * ni + i, (j + 1) * ni + i]) s += (Math.abs(u * this.fjNx[f] + v * this.fjNr[f]) + a) * this.fjA[f];
        const c = j * ni + i;
        const dt = (this.opts.cfl * 2 * this.vol[c]) / s;
        this.dtCell[c] = dt;
        if (dt < dmin) dmin = dt;
      }
    return dmin;
  }

  private update(dt: number, a: number, b: number) {
    const local = this.opts.timeMode === 'local';
    for (let j = 0; j < this.nj; j++)
      for (let i = 0; i < this.ni; i++) {
        const c = j * this.ni + i;
        const k = this.P(i, j);
        const kv = (local ? this.dtCell[c] : dt) / this.vol[c];
        for (let q = 0; q < NV; q++) this.U[q][k] = a * this.U0[q][k] + b * (this.U[q][k] + kv * this.res[q][c]);
      }
  }

  private totalBoundaryMass() {
    const b = this.boundaryMassFlux;
    return b.iMin + b.iMax + b.jMin + b.jMax;
  }

  /** one SSP-RK2 step (capped at maxDt in global mode); on an invalid state the step is undone */
  step(maxDt = Infinity): AxiStepResult {
    if (this.failure) return { ok: false, dt: 0, residual: NaN, residualRegion: NaN };
    for (let q = 0; q < NV; q++) this.Ubackup[q].set(this.U[q]);
    this.fallbacks = 0;
    this.hllcFallbacks = 0;
    if (!this.toPrimitive(0)) return this.abort();
    this.fillGhosts();
    const dt = Math.min(this.computeDt(), maxDt);
    if (!(dt > 0) || !Number.isFinite(dt)) {
      this.failure = { step: this.steps, stage: 0, i: -1, j: -1, rho: NaN, p: NaN, reason: 'invalid time step' };
      return this.abort();
    }
    this.computeResidual();
    const b0 = this.totalBoundaryMass();
    let s2 = 0;
    let r2 = 0;
    let nr = 0;
    const nc = this.ni * this.nj;
    for (let c = 0; c < nc; c++) {
      const d2 = (this.res[0][c] / this.vol[c]) ** 2;
      s2 += d2;
      if (this.region && this.region[c]) {
        r2 += d2;
        nr++;
      }
    }
    for (let q = 0; q < NV; q++) this.U0[q].set(this.U[q]);
    this.update(dt, 0, 1);
    if (!this.toPrimitive(1)) return this.abort();
    this.fillGhosts();
    this.computeResidual();
    const b1 = this.totalBoundaryMass();
    this.update(dt, 0.5, 0.5);
    if (!this.toPrimitive(2)) return this.abort();
    this.boundaryMassIntegral += 0.5 * dt * (b0 + b1);
    this.steps++;
    if (this.opts.timeMode !== 'local') this.time += dt;
    return { ok: true, dt, residual: Math.sqrt(s2 / nc), residualRegion: nr ? Math.sqrt(r2 / nr) : NaN };
  }

  /** advance in global time steps to time t */
  stepTo(t: number): AxiStepResult {
    return this.step(t - this.time);
  }

  private abort(): AxiStepResult {
    for (let q = 0; q < NV; q++) this.U[q].set(this.Ubackup[q]);
    return { ok: false, dt: 0, residual: NaN, residualRegion: NaN };
  }
}
