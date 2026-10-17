import { type SimConfig, buildMesh, buildSolver, cloneConfig, configWarnings, effectiveCriterion, effectiveScheme, freestreamOf } from './config';
import type { EulerSolver, Failure } from './euler';
import { CV } from './gas';
import type { Mesh } from './mesh';

/**
 * Drives one flow simulation from a fixed configuration: the first-order start-up phase, steady-state
 * convergence monitoring or time-accurate marching to an end time, and the diagnostics the workbench shows.
 * It has no knowledge of the UI or the worker; the worker calls `advance()` in slices and posts snapshots.
 */
export type RunStatus =
  | 'ready' // initialised, no steps yet
  | 'running'
  | 'converged' // steady: residual dropped by the requested number of orders
  | 'levelled' // steady: residual stopped falling (practically steady, but not converged to the requested level)
  | 'finished' // transient: reached the end time
  | 'max-steps' // stopped at the step limit without meeting the criterion
  | 'failed'; // non-physical state; last valid state kept

export interface Diagnostics {
  status: RunStatus;
  mode: 'steady' | 'transient';
  ni: number;
  nj: number;
  cells: number;
  steps: number;
  /** physical time reached (transient mode; in steady mode local time steps have no common time) */
  time: number;
  endTime: number;
  /** last global Δt (transient) or smallest local Δt (steady), s */
  dt: number;
  /** CFL number used in the last step (the implicit scheme ramps it up) */
  cfl: number;
  scheme: 'implicit' | 'explicit';
  /** implicit scheme: cells whose update was scaled down by the update limiter in the last step */
  limitedCells: number;
  /** order used in the last step (steady mode starts at first order) */
  order: 1 | 2;
  startupSteps: number;
  residual: number;
  /** reference residual: largest of the first 5 steps */
  residualRef: number;
  /** residual over the windward region (cells upstream of the body centre) and its reference */
  residualWindward: number;
  residualWindwardRef: number;
  /** orders of magnitude the residual used for convergence has dropped below its reference */
  drop: number;
  dropDomain: number;
  dropWindward: number;
  /** residual that decides convergence (steady mode) */
  criterion: 'domain' | 'windward';
  targetDrop: number;
  /** faces that fell back to first-order reconstruction in the last step */
  fallbacks: number;
  failure: Failure | null;
  /** wall-clock milliseconds per step, averaged over the last slice */
  msPerStep: number;
  /** relative change of total mass, momentum and energy since the start (diagnostic only; boundaries are open) */
  massChange: number;
  /** net mass flow out through the far-field boundary relative to the freestream mass flow through the body height
   *  (approximate: evaluated from the outermost cell states); → 0 for a steady solution */
  massImbalance: number;
  /**
   * Total-enthalpy error h + V²/2 relative to the freestream value. In steady, adiabatic, inviscid flow total
   * enthalpy is the same everywhere, so any deviation is numerical error (or an unconverged transient).
   * `front` = cells upstream of the body's centre (x < 0, where the heating is evaluated), excluding the cells
   * inside the captured shock; `shock` = the largest error inside the captured shock, whose 2–3 cells hold
   * intermediate, non-physical states of the smeared discontinuity; `max` = whole domain.
   */
  enthalpyError: { front: number; shock: number; max: number; maxX: number; maxY: number; mean: number };
  warnings: string[];
}

export class Simulation {
  readonly config: SimConfig;
  readonly mesh: Mesh;
  readonly solver: EulerSolver;
  status: RunStatus = 'ready';
  residualRef = 0;
  windRef = 0;
  /** full residual history (RMS ∂ρ/∂t, kg/(m³·s)), whole domain and windward region */
  readonly history: number[] = [];
  readonly windHistory: number[] = [];
  readonly criterion: 'domain' | 'windward';
  readonly scheme: 'implicit' | 'explicit';
  cflNow = 0;
  msPerStep = 0;
  private mass0: number;

  constructor(config: SimConfig) {
    this.config = cloneConfig(config);
    this.mesh = buildMesh(this.config);
    this.solver = buildSolver(this.config, this.mesh);
    this.criterion = effectiveCriterion(this.config);
    this.scheme = effectiveScheme(this.config);
    this.cflNow = this.scheme === 'implicit' ? 1 : this.config.numerics.cfl;
    this.mass0 = this.solver.totals().mass;
  }

  get done() {
    return this.status !== 'ready' && this.status !== 'running';
  }

  /** orders of magnitude the convergence residual has fallen below its reference */
  drop(): number {
    return this.criterion === 'windward' ? this.dropOf(this.windHistory, this.windRef) : this.dropOf(this.history, this.residualRef);
  }

  private dropOf(h: number[], ref: number): number {
    const r = h[h.length - 1];
    if (!(ref > 0) || !(r > 0)) return 0;
    return Math.log10(ref / r);
  }

  /**
   * Advance up to `maxSteps` steps or until `budgetMs` of wall-clock time has passed or the run ends.
   * `force` lets the user continue past a converged / levelled / finished state (up to the step limit).
   * Returns the number of steps taken.
   */
  advance(maxSteps: number, budgetMs = Infinity, force = false): number {
    if (this.status === 'failed') return 0;
    if (this.done && !force) return 0;
    const n = this.config.numerics;
    const s = this.solver;
    if (s.steps >= n.maxSteps) {
      this.status = 'max-steps';
      return 0;
    }
    this.status = 'running';
    const t0 = performance.now();
    let k = 0;
    while (k < maxSteps) {
      if (n.mode === 'steady' && s.steps === n.startupSteps && s.opts.order !== n.order) s.setOrder(n.order);
      let r;
      if (n.mode === 'transient') r = s.stepTo(n.endTime);
      else if (this.scheme === 'implicit') {
        this.cflNow = Math.min(n.cflImplicit, Math.pow(1.1, s.steps));
        r = s.stepImplicit(this.cflNow);
      } else r = s.step();
      k++;
      if (!r.ok) {
        this.status = 'failed';
        break;
      }
      this.history.push(r.residual);
      this.windHistory.push(r.residualMasked);
      if (s.steps <= 5) {
        this.residualRef = Math.max(this.residualRef, r.residual);
        this.windRef = Math.max(this.windRef, r.residualMasked);
      }
      if (n.mode === 'transient' && s.time >= n.endTime * (1 - 1e-12)) {
        this.status = 'finished';
        break;
      }
      if (n.mode === 'steady' && s.steps > n.startupSteps + 20) {
        if (this.drop() >= n.residualDrop && !force) {
          this.status = 'converged';
          break;
        }
        if (!force && this.levelledOff()) {
          this.status = 'levelled';
          break;
        }
      }
      if (s.steps >= n.maxSteps) {
        this.status = 'max-steps';
        break;
      }
      if (performance.now() - t0 > budgetMs) break;
    }
    if (k > 0) this.msPerStep = (performance.now() - t0) / k;
    return k;
  }

  /**
   * Steady mode: the residual has stopped decreasing. Compares the minimum residual over the last 800 steps with
   * the minimum over the 800 before; if it improved by less than 5 % and the residual is at least 2.5 orders below
   * the reference, the flow is practically steady (typically a limiter or a shock crossing the far-field boundary
   * keeps a small residual alive). Reported separately from "converged".
   */
  private levelledOff(): boolean {
    const n = this.config.numerics;
    const h = this.criterion === 'windward' ? this.windHistory : this.history;
    const W = 800;
    if (h.length < n.startupSteps + 2 * W) return false;
    if (this.drop() < 2.5) return false;
    let a = Infinity;
    let b = Infinity;
    for (let i = h.length - 2 * W; i < h.length - W; i++) a = Math.min(a, h[i]);
    for (let i = h.length - W; i < h.length; i++) b = Math.min(b, h[i]);
    return b > 0.95 * a;
  }

  /** net mass flux out through the far-field boundary (kg/(s·m)) relative to ρ∞V∞·(2H) */
  massImbalance(): number {
    const m = this.mesh;
    const s = this.solver;
    const { ni, nj, jnx, jny } = m;
    let out = 0;
    for (let i = 0; i < ni; i++) {
      const c = s.cell(i, nj - 1);
      const f = nj * ni + i;
      out += c.rho * (c.u * jnx[f] + c.v * jny[f]);
    }
    const fs = freestreamOf(this.config);
    return out / (fs.rho * fs.V * 2 * this.config.body.radius);
  }

  enthalpyError(): Diagnostics['enthalpyError'] {
    const m = this.mesh;
    const { ni, nj } = m;
    const fs = freestreamOf(this.config);
    const cp = (this.solver.gamma * this.solver.R) / (this.solver.gamma - 1);
    const H0 = cp * fs.T + 0.5 * fs.V * fs.V;
    const n = ni * nj;
    const p = new Float64Array(n);
    const err = new Float64Array(n);
    for (let j = 0; j < nj; j++)
      for (let i = 0; i < ni; i++) {
        const q = this.solver.cell(i, j);
        p[j * ni + i] = q.p;
        err[j * ni + i] = (cp * q.T + 0.5 * (q.u * q.u + q.v * q.v)) / H0 - 1;
      }
    let front = 0;
    let shock = 0;
    let max = 0;
    let maxX = 0;
    let maxY = 0;
    let sum = 0;
    let area = 0;
    for (let j = 0; j < nj; j++)
      for (let i = 0; i < ni; i++) {
        const c = j * ni + i;
        const e = err[c];
        if (Math.abs(e) > Math.abs(max)) {
          max = e;
          maxX = m.xc[c];
          maxY = m.yc[c];
        }
        sum += Math.abs(e) * m.area[c];
        area += m.area[c];
        if (m.xc[c] >= 0) continue;
        // inside the captured shock: the pressure jumps by more than 20 % to a neighbouring cell
        let jump = 0;
        for (const nb of [j * ni + ((i + 1) % ni), j * ni + ((i + ni - 1) % ni), j > 0 ? c - ni : c, j < nj - 1 ? c + ni : c])
          jump = Math.max(jump, Math.abs(p[nb] - p[c]) / Math.min(p[nb], p[c]));
        if (jump > 0.2) {
          if (Math.abs(e) > Math.abs(shock)) shock = e;
        } else if (Math.abs(e) > Math.abs(front)) front = e;
      }
    return { front, shock, max, maxX, maxY, mean: sum / area };
  }

  diagnostics(): Diagnostics {
    const s = this.solver;
    const n = this.config.numerics;
    return {
      status: this.status,
      mode: n.mode,
      ni: this.mesh.ni,
      nj: this.mesh.nj,
      cells: this.mesh.ni * this.mesh.nj,
      steps: s.steps,
      time: s.time,
      endTime: n.endTime,
      dt: s.lastDt,
      cfl: this.cflNow,
      scheme: this.scheme,
      limitedCells: s.limitedCells,
      order: s.opts.order,
      startupSteps: n.mode === 'steady' ? n.startupSteps : 0,
      residual: this.history[this.history.length - 1] ?? 0,
      residualRef: this.residualRef,
      residualWindward: this.windHistory[this.windHistory.length - 1] ?? 0,
      residualWindwardRef: this.windRef,
      drop: this.drop(),
      dropDomain: this.dropOf(this.history, this.residualRef),
      dropWindward: this.dropOf(this.windHistory, this.windRef),
      criterion: this.criterion,
      targetDrop: n.residualDrop,
      fallbacks: s.fallbacks,
      failure: s.failure,
      msPerStep: this.msPerStep,
      massChange: (s.totals().mass - this.mass0) / this.mass0,
      massImbalance: this.massImbalance(),
      enthalpyError: this.enthalpyError(),
      warnings: configWarnings(this.config),
    };
  }
}

/** Field names the viewer can display; all computed from the cell averages. */
export const FIELD_INFO = {
  mach: { label: 'Mach number', unit: '–' },
  p: { label: 'Pressure p', unit: 'Pa' },
  rho: { label: 'Density ρ', unit: 'kg/m³' },
  T: { label: 'Temperature T', unit: 'K' },
  speed: { label: 'Speed |V|', unit: 'm/s' },
  u: { label: 'Velocity u (x)', unit: 'm/s' },
  v: { label: 'Velocity v (y)', unit: 'm/s' },
  cp: { label: 'Pressure coefficient Cp', unit: '–' },
  ds: { label: 'Entropy change Δs', unit: 'J/(kg·K)' },
} as const;
export type FieldName = keyof typeof FIELD_INFO;
export type Fields = Record<FieldName, Float32Array>;

/** all display fields from the current solution */
export function computeFields(sim: Simulation): Fields {
  const base = sim.solver.fields();
  const fs = freestreamOf(sim.config);
  const n = base.rho.length;
  const cp = new Float32Array(n);
  const ds = new Float32Array(n);
  const q = 0.5 * fs.rho * fs.V * fs.V;
  const g = sim.solver.gamma;
  for (let c = 0; c < n; c++) {
    cp[c] = (base.p[c] - fs.p) / q;
    // Δs = c_v ln[(p/p∞)(ρ∞/ρ)^γ]: zero in isentropic flow; positive across shocks (and where numerical dissipation acts)
    ds[c] = CV * Math.log((base.p[c] / fs.p) * Math.pow(fs.rho / base.rho[c], g));
  }
  return { ...base, cp, ds };
}

/**
 * Values along the body surface from the wall-adjacent cells (j = 0), ordered by surface angle. For an inviscid
 * solution these are the conditions at the outer edge of the (not modelled) boundary layer, which is exactly what
 * a boundary-layer heating correlation needs as input.
 */
export interface SurfaceData {
  /** surface arc length from the front stagnation line (cell 0), m; positive on the upper surface (y > 0) */
  s: Float64Array;
  /** surface position of the wall face centre, m */
  x: Float64Array;
  y: Float64Array;
  p: Float64Array;
  rho: Float64Array;
  T: Float64Array;
  /** velocity magnitude in the wall-adjacent cell (tangential: the wall flux allows no normal flow), m/s */
  ue: Float64Array;
}

export function surfaceData(sim: Simulation): SurfaceData {
  const m = sim.mesh;
  const ni = m.ni;
  const out: SurfaceData = {
    s: new Float64Array(ni),
    x: new Float64Array(ni),
    y: new Float64Array(ni),
    p: new Float64Array(ni),
    rho: new Float64Array(ni),
    T: new Float64Array(ni),
    ue: new Float64Array(ni),
  };
  // arc length along the wall: half of face 0, then whole faces
  const len = (i: number) => m.jlen[i];
  for (let i = 0; i < ni; i++) {
    const c = sim.solver.cell(i, 0);
    out.x[i] = 0.5 * (m.x[i] + m.x[i + 1]);
    out.y[i] = 0.5 * (m.y[i] + m.y[i + 1]);
    out.p[i] = c.p;
    out.rho[i] = c.rho;
    out.T[i] = c.T;
    out.ue[i] = Math.hypot(c.u, c.v);
  }
  // i increases anticlockwise from θ = π, i.e. first over the lower surface. s = 0 at i = 0, negative for
  // i = 1 … ni/2 (lower surface), positive for i = ni−1 … ni/2+1 (upper surface).
  let acc = 0;
  for (let i = 1; i <= ni / 2; i++) {
    acc -= 0.5 * (len(i - 1) + len(i));
    out.s[i] = acc;
  }
  acc = 0;
  for (let i = ni - 1; i > ni / 2; i--) {
    acc += 0.5 * (len((i + 1) % ni) + len(i));
    out.s[i] = acc;
  }
  return out;
}
