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
 * Not included (yet): bodies or curved boundaries, far-field characteristic boundaries, implicit time stepping,
 * viscosity, turbulence, heat transfer, a Web Worker or any visualisation. It is not used by the app.
 */
export type BC3D = 'periodic' | 'extrapolate' | 'wall';

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
  /** RMS over cells of ∂ρ/∂t at the start of the step, kg/(m³·s) */
  residual: number;
}

const NV = 5;

export class EulerSolver3D {
  readonly grid: Grid3D;
  readonly opts: Solver3DOptions;
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
  time = 0;
  steps = 0;
  lastDt = 0;
  /** faces that fell back to first order during the last step */
  fallbacks = 0;
  failure: Failure3D | null = null;

  constructor(grid: Grid3D, opts: Solver3DOptions) {
    const { nx, ny, nz } = grid;
    if (nx < 2 || ny < 2 || nz < 2) throw new Error('the 3D solver needs at least 2 cells in each direction');
    for (const [a, b] of [
      [opts.bc.xmin, opts.bc.xmax],
      [opts.bc.ymin, opts.bc.ymax],
      [opts.bc.zmin, opts.bc.zmax],
    ])
      if ((a === 'periodic') !== (b === 'periodic')) throw new Error('periodic boundaries must be set on both sides of an axis');
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
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++) {
        let c = this.P(0, j, k);
        for (let i = 0; i < nx; i++, c++) {
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
        } else {
          this.copyCell(cell(0), cell(-1));
          this.copyCell(cell(0), cell(-2));
        }
        if (hi === 'wall') {
          this.copyCell(cell(n - 1), cell(n), axis);
          this.copyCell(cell(n - 2), cell(n + 1), axis);
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
    if (this.opts.order === 2) {
      const mm = EulerSolver3D.minmod;
      const left = (a: Float64Array) => a[l] + 0.5 * mm(a[l] - a[ll], a[r] - a[l]);
      const right = (a: Float64Array) => a[r] - 0.5 * mm(a[r] - a[l], a[rr] - a[r]);
      const r2L = left(R);
      const r2R = right(R);
      const p2L = left(Pp);
      const p2R = right(Pp);
      if (r2L > 0 && r2R > 0 && p2L > 0 && p2R > 0) {
        rL = r2L;
        rR = r2R;
        pL = p2L;
        pR = p2R;
        uL = left(U);
        uR = right(U);
        vL = left(V);
        vR = right(V);
        wL = left(W);
        wR = right(W);
      } else this.fallbacks++;
    }
    const unL = axis === 0 ? uL : axis === 1 ? vL : wL;
    const unR = axis === 0 ? uR : axis === 1 ? vR : wR;
    const EL = pL / (g - 1) + 0.5 * rL * (uL * uL + vL * vL + wL * wL);
    const ER = pR / (g - 1) + 0.5 * rR * (uR * uR + vR * vR + wR * wR);
    const lam = Math.max(Math.abs(unL) + Math.sqrt((g * pL) / rL), Math.abs(unR) + Math.sqrt((g * pR) / rR));
    const f = this.f;
    f[0] = 0.5 * (rL * unL + rR * unR - lam * (rR - rL)) * area;
    f[1] = 0.5 * (rL * uL * unL + rR * uR * unR + (axis === 0 ? pL + pR : 0) - lam * (rR * uR - rL * uL)) * area;
    f[2] = 0.5 * (rL * vL * unL + rR * vR * unR + (axis === 1 ? pL + pR : 0) - lam * (rR * vR - rL * vL)) * area;
    f[3] = 0.5 * (rL * wL * unL + rR * wR * unR + (axis === 2 ? pL + pR : 0) - lam * (rR * wR - rL * wL)) * area;
    f[4] = 0.5 * ((EL + pL) * unL + (ER + pR) * unR - lam * (ER - EL)) * area;
  }

  /** residual R(U) = −Σ F·n A over the faces of every interior cell */
  private computeResidual() {
    const { nx, ny, nz, dx, dy, dz } = this.grid;
    const res = this.res;
    for (let v = 0; v < NV; v++) res[v].fill(0);
    const f = this.f;
    const dims = [nx, ny, nz];
    const strides = [1, this.sy, this.sz];
    const areas = [dy * dz, dx * dz, dx * dy];
    for (let axis = 0; axis < 3; axis++) {
      const s = strides[axis];
      const n = dims[axis];
      for (let k = 0; k < nz; k++)
        for (let j = 0; j < ny; j++)
          for (let i = 0; i < nx; i++) {
            // the face on the low side of cell (i, j, k) along this axis; the last cell also owns its high face
            const m = axis === 0 ? i : axis === 1 ? j : k;
            const c = (k * ny + j) * nx + i;
            const pc = this.P(i, j, k);
            this.faceFlux(axis, pc - 2 * s, pc - s, pc, pc + s, areas[axis]);
            for (let v = 0; v < NV; v++) res[v][c] += f[v];
            if (m > 0) {
              const cl = c - (axis === 0 ? 1 : axis === 1 ? nx : nx * ny);
              for (let v = 0; v < NV; v++) res[v][cl] -= f[v];
            }
            if (m === n - 1) {
              this.faceFlux(axis, pc - s, pc, pc + s, pc + 2 * s, areas[axis]);
              for (let v = 0; v < NV; v++) res[v][c] -= f[v];
            }
          }
    }
  }

  /** global CFL time step from the current primitive arrays */
  private computeDt(): number {
    const { nx, ny, nz, dx, dy, dz } = this.grid;
    const g = this.gamma;
    const [U, V, W] = this.q;
    let smax = 0;
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++) {
        let c = this.P(0, j, k);
        for (let i = 0; i < nx; i++, c++) {
          const a = Math.sqrt((g * this.p[c]) / this.r[c]);
          const s = (Math.abs(U[c]) + a) / dx + (Math.abs(V[c]) + a) / dy + (Math.abs(W[c]) + a) / dz;
          if (s > smax) smax = s;
        }
      }
    return this.opts.cfl / smax;
  }

  private copyState(src: Float64Array[], dst: Float64Array[]) {
    for (let v = 0; v < NV; v++) dst[v].set(src[v]);
  }

  /** U ← a·U0 + b·(U + Δt/V · R) over the interior */
  private update(dt: number, a: number, b: number) {
    const { nx, ny, nz, dx, dy, dz } = this.grid;
    const kv = dt / (dx * dy * dz);
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const c = (k * ny + j) * nx + i;
          const pc = this.P(i, j, k);
          for (let v = 0; v < NV; v++) this.U[v][pc] = a * this.U0[v][pc] + b * (this.U[v][pc] + kv * this.res[v][c]);
        }
  }

  /**
   * One SSP-RK2 step, capped at `maxDt` (to land on an output time). On a non-physical state the step is undone
   * and `failure` says where; later calls do nothing until `init` is called again.
   */
  step(maxDt = Infinity): Step3DResult {
    if (this.failure) return { ok: false, dt: 0, residual: NaN };
    const { nx, ny, nz, dx, dy, dz } = this.grid;
    this.copyState(this.U, this.Ubackup);
    this.fallbacks = 0;
    if (!this.toPrimitive(0)) return this.abort();
    this.fillGhosts();
    const dt = Math.min(this.computeDt(), maxDt);
    if (!(dt > 0) || !Number.isFinite(dt)) {
      this.failure = { step: this.steps, stage: 0, i: -1, j: -1, k: -1, rho: NaN, p: NaN, reason: 'invalid time step' };
      return this.abort();
    }
    this.computeResidual();
    const vol = dx * dy * dz;
    let s2 = 0;
    for (let c = 0; c < nx * ny * nz; c++) s2 += (this.res[0][c] / vol) ** 2;
    const residual = Math.sqrt(s2 / (nx * ny * nz));
    this.copyState(this.U, this.U0);
    this.update(dt, 0, 1); // U1 = Un + Δt R(Un)
    if (!this.toPrimitive(1)) return this.abort();
    this.fillGhosts();
    this.computeResidual();
    this.update(dt, 0.5, 0.5); // Un+1 = ½ Un + ½ (U1 + Δt R(U1))
    if (!this.toPrimitive(2)) return this.abort();
    this.steps++;
    this.time += dt;
    this.lastDt = dt;
    return { ok: true, dt, residual };
  }

  stepTo(t: number): Step3DResult {
    return this.step(t - this.time);
  }

  private abort(): Step3DResult {
    this.copyState(this.Ubackup, this.U);
    return { ok: false, dt: 0, residual: NaN };
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

  /** Σ U·V over the domain: mass kg, momentum kg·m/s, energy J */
  totals() {
    const { nx, ny, nz, dx, dy, dz } = this.grid;
    const vol = dx * dy * dz;
    const t = [0, 0, 0, 0, 0];
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const c = this.P(i, j, k);
          for (let v = 0; v < NV; v++) t[v] += this.U[v][c] * vol;
        }
    return { mass: t[0], momX: t[1], momY: t[2], momZ: t[3], energy: t[4] };
  }
}
