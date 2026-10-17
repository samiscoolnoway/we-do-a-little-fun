import { GAS, type Primitive } from './gas';
import type { Mesh } from './mesh';

/**
 * Two-dimensional compressible Euler equations, conservative finite-volume form:
 *
 *   ∂/∂t ∫_cell U dA + ∮_∂cell F(U)·n ds = 0,   U = (ρ, ρu, ρv, E)
 *   F·n = (ρ uₙ, ρ u uₙ + p nₓ, ρ v uₙ + p n_y, (E + p) uₙ),   uₙ = u nₓ + v n_y
 *
 * Each cell stores the average of U over its area. Every step, a numerical flux is computed on every face from
 * the states on its two sides and the cell averages are updated with what flows in and out. Whatever leaves one
 * cell enters its neighbour, so mass, momentum and energy are conserved exactly (to round-off) except through the
 * domain boundaries.
 *
 *  - Numerical flux: Rusanov (local Lax–Friedrichs) — the average of the two physical fluxes plus a dissipation
 *    term scaled by the fastest local wave speed |uₙ| + a. Robust at strong shocks; somewhat diffusive.
 *  - Reconstruction: first order (piecewise constant) or second order MUSCL on primitive variables (ρ, u, v, p)
 *    with a slope limiter (minmod or van Albada) in each mesh direction, which keeps shocks free of oscillations.
 *    If a reconstructed face state would have ρ ≤ 0 or p ≤ 0, that face falls back to first order; such faces
 *    are counted and reported.
 *  - Time integration: two-stage strong-stability-preserving Runge–Kutta (SSP-RK2, Heun).
 *  - Time step: CFL condition per cell, Δt = CFL · A / (½ Σ_faces (|uₙ| + a) ℓ), the global minimum in
 *    time-accurate mode, or each cell's own value in local-time-stepping (steady-state only) mode.
 *  - Boundary conditions through two layers of ghost cells: slip wall (reflected normal velocity), characteristic
 *    far field (Riemann invariants), zero-gradient extrapolation, and periodic wrap-around for the O-grid.
 *  - After every stage each cell's density and pressure are checked. A non-positive or non-finite value stops the
 *    solver, restores the last valid state and reports where it happened. Nothing is clipped or hidden.
 */
export type BC = 'wall' | 'farfield' | 'extrapolate' | 'periodic';

export interface SolverOptions {
  gamma?: number;
  R?: number;
  cfl: number;
  order: 1 | 2;
  limiter: 'minmod' | 'vanalbada';
  /** 'global' = time-accurate (one Δt for all cells); 'local' = each cell its own Δt (only valid for steady states) */
  timeMode: 'global' | 'local';
  bc: { imin: BC; imax: BC; jmin: BC; jmax: BC };
  /** reference state imposed by far-field boundaries */
  freestream: Primitive;
}

export interface Failure {
  step: number;
  stage: number;
  i: number;
  j: number;
  x: number;
  y: number;
  rho: number;
  p: number;
  reason: string;
}

export interface StepResult {
  ok: boolean;
  dt: number;
  /** RMS over cells of ∂ρ/∂t at the start of the step, kg/(m³·s) */
  residual: number;
}

const NV = 4;

export class EulerSolver {
  readonly mesh: Mesh;
  opts: SolverOptions;
  readonly gamma: number;
  readonly R: number;
  /** padded width / height (two ghost layers on each side) */
  readonly W: number;
  readonly H: number;
  /** conservative state, padded layout: U[v][P(i, j)] */
  U: Float64Array[];
  private U0: Float64Array[];
  private Ubackup: Float64Array[];
  /** primitive work arrays, padded */
  private rho: Float64Array;
  private vu: Float64Array;
  private vv: Float64Array;
  private pr: Float64Array;
  private res: Float64Array[];
  private dtCell: Float64Array;
  private f = new Float64Array(NV);
  time = 0;
  steps = 0;
  lastDt = 0;
  /** faces that fell back to first order during the last step */
  fallbacks = 0;
  /** residual history (one value per step) */
  readonly residuals: number[] = [];
  firstResidual = 0;
  failure: Failure | null = null;

  constructor(mesh: Mesh, opts: SolverOptions) {
    if (mesh.ni < 2 || mesh.nj < 2) throw new Error('the solver needs at least 2 cells in each direction');
    this.mesh = mesh;
    this.opts = opts;
    this.gamma = opts.gamma ?? GAS.gamma;
    this.R = opts.R ?? GAS.R;
    if (mesh.periodicI) this.opts = { ...opts, bc: { ...opts.bc, imin: 'periodic', imax: 'periodic' } };
    this.W = mesh.ni + 4;
    this.H = mesh.nj + 4;
    const n = this.W * this.H;
    const mk = () => Array.from({ length: NV }, () => new Float64Array(n));
    this.U = mk();
    this.U0 = mk();
    this.Ubackup = mk();
    this.res = Array.from({ length: NV }, () => new Float64Array(mesh.ni * mesh.nj));
    this.rho = new Float64Array(n);
    this.vu = new Float64Array(n);
    this.vv = new Float64Array(n);
    this.pr = new Float64Array(n);
    this.dtCell = new Float64Array(mesh.ni * mesh.nj);
  }

  /** switch reconstruction order (e.g. after a first-order start-up phase) */
  setOrder(order: 1 | 2) {
    this.opts = { ...this.opts, order };
  }

  /** padded index of cell (i, j); i, j may be −2…ni+1 / −2…nj+1 */
  P(i: number, j: number) {
    return (j + 2) * this.W + (i + 2);
  }

  /** initialise every cell from a function of the cell centre */
  init(fn: (x: number, y: number) => Primitive) {
    const { ni, nj, xc, yc } = this.mesh;
    const g = this.gamma;
    for (let j = 0; j < nj; j++)
      for (let i = 0; i < ni; i++) {
        const c = j * ni + i;
        const w = fn(xc[c], yc[c]);
        const p = this.P(i, j);
        this.U[0][p] = w.rho;
        this.U[1][p] = w.rho * w.u;
        this.U[2][p] = w.rho * w.v;
        this.U[3][p] = w.p / (g - 1) + 0.5 * w.rho * (w.u * w.u + w.v * w.v);
      }
    this.time = 0;
    this.steps = 0;
    this.lastDt = 0;
    this.residuals.length = 0;
    this.firstResidual = 0;
    this.failure = null;
  }

  // ───────── primitive variables and validity ─────────
  /** U → (ρ, u, v, p) for the interior; returns false (and records the failure) at the first non-physical cell */
  private toPrimitive(U: Float64Array[], stage: number): boolean {
    const { ni, nj } = this.mesh;
    const g1 = this.gamma - 1;
    const [r, mu, mv, E] = U;
    for (let j = 0; j < nj; j++) {
      let p = this.P(0, j);
      for (let i = 0; i < ni; i++, p++) {
        const rho = r[p];
        const u = mu[p] / rho;
        const v = mv[p] / rho;
        const pres = g1 * (E[p] - 0.5 * rho * (u * u + v * v));
        if (!(rho > 0) || !(pres > 0) || !Number.isFinite(rho) || !Number.isFinite(pres)) {
          const c = j * ni + i;
          this.failure = {
            step: this.steps,
            stage,
            i,
            j,
            x: this.mesh.xc[c],
            y: this.mesh.yc[c],
            rho,
            p: pres,
            reason: !Number.isFinite(rho) || !Number.isFinite(pres) ? 'non-finite state (NaN or infinity)' : rho <= 0 ? 'non-positive density' : 'non-positive pressure',
          };
          return false;
        }
        this.rho[p] = rho;
        this.vu[p] = u;
        this.vv[p] = v;
        this.pr[p] = pres;
      }
    }
    return true;
  }

  // ───────── boundary conditions (ghost cells) ─────────
  private setGhost(dst: number, rho: number, u: number, v: number, p: number) {
    this.rho[dst] = rho;
    this.vu[dst] = u;
    this.vv[dst] = v;
    this.pr[dst] = p;
  }

  /** ghost states for a boundary face with outward unit normal (nx, ny); `a`, `b` = first and second interior cells */
  private applyBC(kind: BC, a: number, b: number, g1: number, g2: number, nx: number, ny: number) {
    const { rho, vu, vv, pr } = this;
    if (kind === 'wall') {
      // slip wall: mirror image with the normal velocity reversed (no flow through the wall)
      const una = vu[a] * nx + vv[a] * ny;
      this.setGhost(g1, rho[a], vu[a] - 2 * una * nx, vv[a] - 2 * una * ny, pr[a]);
      const unb = vu[b] * nx + vv[b] * ny;
      this.setGhost(g2, rho[b], vu[b] - 2 * unb * nx, vv[b] - 2 * unb * ny, pr[b]);
      return;
    }
    if (kind === 'extrapolate') {
      this.setGhost(g1, rho[a], vu[a], vv[a], pr[a]);
      this.setGhost(g2, rho[a], vu[a], vv[a], pr[a]);
      return;
    }
    // characteristic far field: incoming characteristics carry freestream information, outgoing ones interior information
    const gm = this.gamma;
    const fs = this.opts.freestream;
    const ci = Math.sqrt((gm * pr[a]) / rho[a]);
    const cf = Math.sqrt((gm * fs.p) / fs.rho);
    const uni = vu[a] * nx + vv[a] * ny;
    const unf = fs.u * nx + fs.v * ny;
    let rb: number, ub: number, vb: number, pb: number;
    if (uni <= -ci) {
      // supersonic inflow: everything from the freestream
      rb = fs.rho;
      ub = fs.u;
      vb = fs.v;
      pb = fs.p;
    } else if (uni >= ci) {
      // supersonic outflow: everything from the interior
      rb = rho[a];
      ub = vu[a];
      vb = vv[a];
      pb = pr[a];
    } else {
      const Rp = uni + (2 * ci) / (gm - 1); // outgoing Riemann invariant
      const Rm = unf - (2 * cf) / (gm - 1); // incoming Riemann invariant
      const unb = 0.5 * (Rp + Rm);
      const cb = 0.25 * (gm - 1) * (Rp - Rm);
      let s: number, ut: number, vt: number;
      if (unb < 0) {
        s = fs.p / Math.pow(fs.rho, gm);
        ut = fs.u - unf * nx;
        vt = fs.v - unf * ny;
      } else {
        s = pr[a] / Math.pow(rho[a], gm);
        ut = vu[a] - uni * nx;
        vt = vv[a] - uni * ny;
      }
      rb = Math.pow((cb * cb) / (gm * s), 1 / (gm - 1));
      pb = (rb * cb * cb) / gm;
      ub = ut + unb * nx;
      vb = vt + unb * ny;
    }
    this.setGhost(g1, rb, ub, vb, pb);
    this.setGhost(g2, rb, ub, vb, pb);
  }

  private fillGhosts() {
    const { ni, nj, periodicI, inx, iny, jnx, jny } = this.mesh;
    const bc = this.opts.bc;
    const P = (i: number, j: number) => this.P(i, j);
    const copy = (src: number, dst: number) => this.setGhost(dst, this.rho[src], this.vu[src], this.vv[src], this.pr[src]);
    // i direction
    for (let j = 0; j < nj; j++) {
      if (periodicI) {
        copy(P(ni - 1, j), P(-1, j));
        copy(P(ni - 2, j), P(-2, j));
        copy(P(0, j), P(ni, j));
        copy(P(1, j), P(ni + 1, j));
      } else {
        // i-face normals point to increasing i: outward is −n at imin, +n at imax
        let f = j * (ni + 1);
        let l = this.mesh.ilen[f];
        this.applyBC(bc.imin, P(0, j), P(1, j), P(-1, j), P(-2, j), -inx[f] / l, -iny[f] / l);
        f = j * (ni + 1) + ni;
        l = this.mesh.ilen[f];
        this.applyBC(bc.imax, P(ni - 1, j), P(ni - 2, j), P(ni, j), P(ni + 1, j), inx[f] / l, iny[f] / l);
      }
    }
    // j direction
    for (let i = 0; i < ni; i++) {
      let f = i;
      let l = this.mesh.jlen[f];
      this.applyBC(bc.jmin, P(i, 0), P(i, 1), P(i, -1), P(i, -2), -jnx[f] / l, -jny[f] / l);
      f = nj * ni + i;
      l = this.mesh.jlen[f];
      this.applyBC(bc.jmax, P(i, nj - 1), P(i, nj - 2), P(i, nj), P(i, nj + 1), jnx[f] / l, jny[f] / l);
    }
  }

  // ───────── numerical flux ─────────
  /** Rusanov flux through a face with unit normal (ex, ey) and length len, written into this.f */
  private flux(rL: number, uL: number, vL: number, pL: number, rR: number, uR: number, vR: number, pR: number, ex: number, ey: number, len: number) {
    const g = this.gamma;
    const unL = uL * ex + vL * ey;
    const unR = uR * ex + vR * ey;
    const EL = pL / (g - 1) + 0.5 * rL * (uL * uL + vL * vL);
    const ER = pR / (g - 1) + 0.5 * rR * (uR * uR + vR * vR);
    const cL = Math.sqrt((g * pL) / rL);
    const cR = Math.sqrt((g * pR) / rR);
    const lam = Math.max(Math.abs(unL) + cL, Math.abs(unR) + cR);
    const f = this.f;
    f[0] = 0.5 * (rL * unL + rR * unR - lam * (rR - rL)) * len;
    f[1] = 0.5 * (rL * uL * unL + pL * ex + rR * uR * unR + pR * ex - lam * (rR * uR - rL * uL)) * len;
    f[2] = 0.5 * (rL * vL * unL + pL * ey + rR * vR * unR + pR * ey - lam * (rR * vR - rL * vL)) * len;
    f[3] = 0.5 * ((EL + pL) * unL + (ER + pR) * unR - lam * (ER - EL)) * len;
  }

  private limit(a: number, b: number): number {
    if (a * b <= 0) return 0;
    if (this.opts.limiter === 'minmod') return Math.abs(a) < Math.abs(b) ? a : b;
    // van Albada
    const e = 1e-12;
    return (a * (b * b + e) + b * (a * a + e)) / (a * a + b * b + 2 * e);
  }

  /** limited face values of one variable q from the four cells ll, l | r, rr; written to this.qL / this.qR */
  private qL = 0;
  private qR = 0;
  private recon(q: Float64Array, ll: number, l: number, r: number, rr: number) {
    const dl = q[l] - q[ll];
    const dc = q[r] - q[l];
    const dr = q[rr] - q[r];
    this.qL = q[l] + 0.5 * this.limit(dl, dc);
    this.qR = q[r] - 0.5 * this.limit(dc, dr);
  }

  /** face states between padded cells l and r, with outer neighbours ll (left of l) and rr (right of r) */
  private faceFlux(ll: number, l: number, r: number, rr: number, nx: number, ny: number, len: number) {
    const { rho, vu, vv, pr } = this;
    const ex = nx / len;
    const ey = ny / len;
    if (this.opts.order === 2) {
      this.recon(rho, ll, l, r, rr);
      const rL = this.qL;
      const rR = this.qR;
      this.recon(pr, ll, l, r, rr);
      const pL = this.qL;
      const pR = this.qR;
      if (rL > 0 && rR > 0 && pL > 0 && pR > 0) {
        this.recon(vu, ll, l, r, rr);
        const uL = this.qL;
        const uR = this.qR;
        this.recon(vv, ll, l, r, rr);
        this.flux(rL, uL, this.qL, pL, rR, uR, this.qR, pR, ex, ey, len);
        return;
      }
      this.fallbacks++;
    }
    this.flux(rho[l], vu[l], vv[l], pr[l], rho[r], vu[r], vv[r], pr[r], ex, ey, len);
  }

  /**
   * Flux through a slip-wall face. The interior state is reconstructed to the face (using the mirrored ghost cell
   * for the limiter), and the ghost-side face state is the mirror image of that face state. Mirroring after
   * reconstruction, rather than reconstructing the mirrored cells, makes the two face states exact mirror images
   * on curved walls too, so the mass and energy fluxes through the wall are exactly zero.
   * `a` = interior cell next to the wall, `b` = the one beyond it, `g` = first ghost; `wallOnLeft` = the face's
   * left (lower-index) side is the ghost.
   */
  private wallFlux(a: number, b: number, g: number, nx: number, ny: number, len: number, wallOnLeft: boolean) {
    const { rho, vu, vv, pr } = this;
    let r = rho[a],
      u = vu[a],
      v = vv[a],
      p = pr[a];
    if (this.opts.order === 2) {
      const rec = (q: Float64Array) => q[a] + 0.5 * this.limit(q[a] - q[b], q[g] - q[a]);
      const r2 = rec(rho);
      const p2 = rec(pr);
      if (r2 > 0 && p2 > 0) {
        r = r2;
        p = p2;
        u = rec(vu);
        v = rec(vv);
      } else this.fallbacks++;
    }
    const ex = nx / len;
    const ey = ny / len;
    const un = u * ex + v * ey;
    const um = u - 2 * un * ex;
    const vm = v - 2 * un * ey;
    if (wallOnLeft) this.flux(r, um, vm, p, r, u, v, p, ex, ey, len);
    else this.flux(r, u, v, p, r, um, vm, p, ex, ey, len);
  }

  /** residual R(U) = −Σ F·n over the faces of each cell (interior cells), using the current primitive arrays */
  private computeResidual() {
    const { ni, nj, inx, iny, jnx, jny, ilen, jlen } = this.mesh;
    const res = this.res;
    for (let v = 0; v < NV; v++) res[v].fill(0);
    const f = this.f;
    const P = (i: number, j: number) => this.P(i, j);
    const periodic = this.mesh.periodicI;
    const bc = this.opts.bc;
    // i-faces
    for (let j = 0; j < nj; j++)
      for (let i = 0; i <= ni; i++) {
        if (periodic && i === ni) continue; // face ni is face 0
        const fi = j * (ni + 1) + i;
        if (!periodic && i === 0 && bc.imin === 'wall') this.wallFlux(P(0, j), P(1, j), P(-1, j), inx[fi], iny[fi], ilen[fi], true);
        else if (!periodic && i === ni && bc.imax === 'wall') this.wallFlux(P(ni - 1, j), P(ni - 2, j), P(ni, j), inx[fi], iny[fi], ilen[fi], false);
        else this.faceFlux(P(i - 2, j), P(i - 1, j), P(i, j), P(i + 1, j), inx[fi], iny[fi], ilen[fi]);
        const L = i - 1 >= 0 ? j * ni + (i - 1) : periodic ? j * ni + ni - 1 : -1;
        const R = i < ni ? j * ni + i : -1;
        if (L >= 0) for (let v = 0; v < NV; v++) res[v][L] -= f[v];
        if (R >= 0) for (let v = 0; v < NV; v++) res[v][R] += f[v];
      }
    // j-faces
    for (let j = 0; j <= nj; j++)
      for (let i = 0; i < ni; i++) {
        const fj = j * ni + i;
        if (j === 0 && bc.jmin === 'wall') this.wallFlux(P(i, 0), P(i, 1), P(i, -1), jnx[fj], jny[fj], jlen[fj], true);
        else if (j === nj && bc.jmax === 'wall') this.wallFlux(P(i, nj - 1), P(i, nj - 2), P(i, nj), jnx[fj], jny[fj], jlen[fj], false);
        else this.faceFlux(P(i, j - 2), P(i, j - 1), P(i, j), P(i, j + 1), jnx[fj], jny[fj], jlen[fj]);
        if (j > 0) {
          const L = (j - 1) * ni + i;
          for (let v = 0; v < NV; v++) res[v][L] -= f[v];
        }
        if (j < nj) {
          const R = j * ni + i;
          for (let v = 0; v < NV; v++) res[v][R] += f[v];
        }
      }
  }

  /** CFL time step of every cell from the current primitive arrays; returns the minimum */
  private computeDt(): number {
    const { ni, nj, inx, iny, jnx, jny, ilen, jlen, area } = this.mesh;
    const g = this.gamma;
    const cfl = this.opts.cfl;
    let dmin = Infinity;
    for (let j = 0; j < nj; j++)
      for (let i = 0; i < ni; i++) {
        const p = this.P(i, j);
        const u = this.vu[p];
        const v = this.vv[p];
        const c = Math.sqrt((g * this.pr[p]) / this.rho[p]);
        const f0 = j * (ni + 1) + i;
        const f1 = f0 + 1;
        const g0 = j * ni + i;
        const g1 = g0 + ni;
        const s =
          Math.abs(u * inx[f0] + v * iny[f0]) +
          Math.abs(u * inx[f1] + v * iny[f1]) +
          Math.abs(u * jnx[g0] + v * jny[g0]) +
          Math.abs(u * jnx[g1] + v * jny[g1]) +
          c * (ilen[f0] + ilen[f1] + jlen[g0] + jlen[g1]);
        const dt = (cfl * area[j * ni + i]) / (0.5 * s);
        this.dtCell[j * ni + i] = dt;
        if (dt < dmin) dmin = dt;
      }
    return dmin;
  }

  private copyState(src: Float64Array[], dst: Float64Array[]) {
    for (let v = 0; v < NV; v++) dst[v].set(src[v]);
  }

  /**
   * One SSP-RK2 step. Returns ok = false (and restores the state from before the step) when a non-physical state
   * appears; `failure` then says where. `maxDt` caps the global time step (used to land exactly on an output time).
   */
  step(maxDt = Infinity): StepResult {
    if (this.failure) return { ok: false, dt: 0, residual: NaN };
    const { ni, nj, area } = this.mesh;
    const local = this.opts.timeMode === 'local';
    this.copyState(this.U, this.Ubackup);
    this.fallbacks = 0;
    if (!this.toPrimitive(this.U, 0)) return this.abort();
    this.fillGhosts();
    const dt = Math.min(this.computeDt(), maxDt);
    if (!(dt > 0) || !Number.isFinite(dt)) {
      this.failure = { step: this.steps, stage: 0, i: -1, j: -1, x: NaN, y: NaN, rho: NaN, p: NaN, reason: 'invalid time step' };
      return this.abort();
    }
    this.computeResidual();
    // residual measure: RMS of ∂ρ/∂t
    let s2 = 0;
    for (let c = 0; c < ni * nj; c++) {
      const d = this.res[0][c] / area[c];
      s2 += d * d;
    }
    const residual = Math.sqrt(s2 / (ni * nj));
    // stage 1: U1 = Un + Δt R(Un)
    this.copyState(this.U, this.U0);
    for (let j = 0; j < nj; j++)
      for (let i = 0; i < ni; i++) {
        const c = j * ni + i;
        const p = this.P(i, j);
        const k = (local ? this.dtCell[c] : dt) / area[c];
        for (let v = 0; v < NV; v++) this.U[v][p] = this.U0[v][p] + k * this.res[v][c];
      }
    if (!this.toPrimitive(this.U, 1)) return this.abort();
    this.fillGhosts();
    this.computeResidual();
    // stage 2: Un+1 = ½ Un + ½ (U1 + Δt R(U1))
    for (let j = 0; j < nj; j++)
      for (let i = 0; i < ni; i++) {
        const c = j * ni + i;
        const p = this.P(i, j);
        const k = (local ? this.dtCell[c] : dt) / area[c];
        for (let v = 0; v < NV; v++) this.U[v][p] = 0.5 * this.U0[v][p] + 0.5 * (this.U[v][p] + k * this.res[v][c]);
      }
    if (!this.toPrimitive(this.U, 2)) return this.abort();
    this.steps++;
    if (!local) this.time += dt;
    this.lastDt = dt;
    if (this.steps === 1 || this.firstResidual === 0) this.firstResidual = residual;
    this.residuals.push(residual);
    return { ok: true, dt, residual };
  }

  /** one time-accurate step that does not go past time t */
  stepTo(t: number): StepResult {
    return this.step(t - this.time);
  }

  private abort(): StepResult {
    this.copyState(this.Ubackup, this.U);
    this.toPrimitiveUnchecked();
    return { ok: false, dt: 0, residual: NaN };
  }

  /** refresh primitives from the (restored) state without validity checks */
  private toPrimitiveUnchecked() {
    const { ni, nj } = this.mesh;
    const g1 = this.gamma - 1;
    for (let j = 0; j < nj; j++)
      for (let i = 0; i < ni; i++) {
        const p = this.P(i, j);
        const rho = this.U[0][p];
        const u = this.U[1][p] / rho;
        const v = this.U[2][p] / rho;
        this.rho[p] = rho;
        this.vu[p] = u;
        this.vv[p] = v;
        this.pr[p] = g1 * (this.U[3][p] - 0.5 * rho * (u * u + v * v));
      }
  }

  // ───────── read-out ─────────
  /** primitive state of interior cell (i, j) computed from the stored conservative values */
  cell(i: number, j: number): Primitive & { T: number; mach: number; a: number } {
    const p = this.P(i, j);
    const rho = this.U[0][p];
    const u = this.U[1][p] / rho;
    const v = this.U[2][p] / rho;
    const pres = (this.gamma - 1) * (this.U[3][p] - 0.5 * rho * (u * u + v * v));
    const a = Math.sqrt((this.gamma * pres) / rho);
    return { rho, u, v, p: pres, T: pres / (rho * this.R), a, mach: Math.hypot(u, v) / a };
  }

  /** Σ U·A over the domain (per unit depth): mass kg/m, momentum kg/s, energy J/m */
  totals() {
    const { ni, nj, area } = this.mesh;
    const t = [0, 0, 0, 0];
    for (let j = 0; j < nj; j++)
      for (let i = 0; i < ni; i++) {
        const p = this.P(i, j);
        const A = area[j * ni + i];
        for (let v = 0; v < NV; v++) t[v] += this.U[v][p] * A;
      }
    return { mass: t[0], momX: t[1], momY: t[2], energy: t[3] };
  }

  /** Flow fields at cell centres (cell order j·ni + i) for visualisation and probing. */
  fields() {
    const { ni, nj } = this.mesh;
    const n = ni * nj;
    const out = {
      rho: new Float32Array(n),
      u: new Float32Array(n),
      v: new Float32Array(n),
      p: new Float32Array(n),
      T: new Float32Array(n),
      mach: new Float32Array(n),
      speed: new Float32Array(n),
    };
    for (let j = 0; j < nj; j++)
      for (let i = 0; i < ni; i++) {
        const c = j * ni + i;
        const s = this.cell(i, j);
        out.rho[c] = s.rho;
        out.u[c] = s.u;
        out.v[c] = s.v;
        out.p[c] = s.p;
        out.T[c] = s.T;
        out.mach[c] = s.mach;
        out.speed[c] = Math.hypot(s.u, s.v);
      }
    return out;
  }
}
