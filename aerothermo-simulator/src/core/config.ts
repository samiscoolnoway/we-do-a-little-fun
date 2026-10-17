import { EulerSolver, type SolverOptions } from './euler';
import { freestream } from './gas';
import { makeOGrid, type BodyKind, type Mesh } from './mesh';

/**
 * Everything that defines one simulation. A run is always produced from one complete SimConfig; changing a field
 * that affects the flow (anything except display options) requires a restart, which the UI tracks by comparing the
 * edited configuration with the one the current results were computed from.
 */
export interface FlowConfig {
  /** freestream Mach number */
  mach: number;
  /** freestream static temperature, K */
  Tinf: number;
  /** freestream static pressure, Pa */
  pinf: number;
  /** flow angle (angle of attack of the body), degrees; positive = flow moving upward */
  angle: number;
}

export interface BodyConfig {
  kind: BodyKind;
  /** body half-height (circle radius), m */
  radius: number;
  /** ellipse: semi-axis along the flow / half height (< 1 = blunter face than a circle) */
  aspect: number;
}

export type MeshPreset = 'coarse' | 'medium' | 'fine';
export const MESH_PRESETS: Record<MeshPreset, { ni: number; nj: number; label: string }> = {
  coarse: { ni: 96, nj: 48, label: 'Coarse 96 × 48' },
  medium: { ni: 160, nj: 80, label: 'Medium 160 × 80' },
  fine: { ni: 240, nj: 120, label: 'Fine 240 × 120' },
};

export interface NumericsConfig {
  mesh: MeshPreset;
  cfl: number;
  order: 1 | 2;
  limiter: 'minmod' | 'vanalbada';
  /** steady = local time stepping towards the steady state; transient = one global, time-accurate Δt */
  mode: 'steady' | 'transient';
  /** steady mode: steps run at first order before switching to the selected order (robust impulsive start) */
  startupSteps: number;
  /** steady mode: stop when the residual has dropped by this many orders of magnitude */
  residualDrop: number;
  /** maximum number of steps in either mode */
  maxSteps: number;
  /** transient mode: physical time to simulate, s */
  endTime: number;
}

export interface ThermalConfig {
  /** heat-shield density, kg/m³ */
  rho: number;
  /** specific heat, J/(kg·K) */
  cp: number;
  /** thermal conductivity, W/(m·K) */
  k: number;
  /** thickness, m */
  thickness: number;
  /** initial temperature of the whole shield, K */
  T0: number;
  /** surface emissivity (re-radiation), 0…1 */
  emissivity: number;
  /** back face: insulated, or held at a fixed temperature */
  rear: 'adiabatic' | 'fixed';
  /** back-face temperature when rear = fixed, K */
  Trear: number;
  /** heating exposure time to simulate, s */
  duration: number;
  /** grid points through the thickness */
  nodes: number;
}

export interface SimConfig {
  flow: FlowConfig;
  body: BodyConfig;
  numerics: NumericsConfig;
  thermal: ThermalConfig;
}

export const DEFAULT_CONFIG: SimConfig = {
  flow: { mach: 3, Tinf: 220, pinf: 2500, angle: 0 },
  body: { kind: 'cylinder', radius: 0.5, aspect: 0.6 },
  numerics: { mesh: 'coarse', cfl: 0.8, order: 2, limiter: 'vanalbada', mode: 'steady', startupSteps: 300, residualDrop: 5, maxSteps: 8000, endTime: 0.02 },
  thermal: { rho: 280, cp: 1200, k: 0.4, thickness: 0.03, T0: 300, emissivity: 0.85, rear: 'adiabatic', Trear: 300, duration: 60, nodes: 61 },
};

export function cloneConfig(c: SimConfig): SimConfig {
  return JSON.parse(JSON.stringify(c)) as SimConfig;
}

/**
 * Empirical bow-shock standoff distance for a circular cylinder (Billig, J. Spacecraft Rockets 4(6), 1967):
 * Δ / R = 0.386 · exp(4.67 / M²). An empirical correlation for perfect-gas air, used only as a comparison.
 */
export function billigStandoffCylinder(mach: number): number {
  return 0.386 * Math.exp(4.67 / (mach * mach));
}

/**
 * Outer boundary radius, in body half-heights. Subsonic disturbances reach far upstream, so the far field sits at
 * 15 H. Supersonic: far enough to contain the bow shock (≥ 8 H, and ≥ 2.5 × the Billig standoff + 4 H near Mach 1).
 */
export function outerRadius(mach: number): number {
  if (mach < 1) return 15;
  return Math.min(25, Math.max(8, 4 + 2.5 * billigStandoffCylinder(mach)));
}

/** Validity notes the UI shows for a configuration (flow regime and model limits); never blocks a run. */
export function configWarnings(c: SimConfig): string[] {
  const w: string[] = [];
  const M = c.flow.mach;
  if (M > 0.8 && M < 1.3)
    w.push('Transonic range (0.8 < M < 1.3): the bow shock stands far ahead of the body and moves slowly; steady convergence is slow and the result depends on the outer boundary.');
  const T0 = c.flow.Tinf * (1 + 0.2 * M * M);
  if (T0 > 2000)
    w.push(`Stagnation temperature ≈ ${T0.toFixed(0)} K: real air would partly dissociate. This model keeps γ = 1.4 (calorically perfect gas), so temperatures behind the shock are overestimated.`);
  if (M < 0.3) w.push('Low Mach number: the compressible solver converges slowly here and its dissipation is relatively large.');
  return w;
}

export function buildMesh(c: SimConfig): Mesh {
  const p = MESH_PRESETS[c.numerics.mesh];
  // first-cell size scaled with the mesh so the stretching stays similar on every preset
  const first = 0.012 * (96 / p.ni);
  return makeOGrid({ body: { kind: c.body.kind, radius: c.body.radius, aspect: c.body.aspect }, ni: p.ni, nj: p.nj, outer: outerRadius(c.flow.mach), firstSpacing: first });
}

export function freestreamOf(c: SimConfig) {
  return freestream(c.flow.mach, c.flow.Tinf, c.flow.pinf, c.flow.angle);
}

export function solverOptions(c: SimConfig, order: 1 | 2 = c.numerics.order): SolverOptions {
  const fs = freestreamOf(c);
  return {
    cfl: c.numerics.cfl,
    order,
    limiter: c.numerics.limiter,
    timeMode: c.numerics.mode === 'steady' ? 'local' : 'global',
    bc: { imin: 'periodic', imax: 'periodic', jmin: 'wall', jmax: 'farfield' },
    freestream: { rho: fs.rho, u: fs.u, v: fs.v, p: fs.p },
  };
}

/** a solver initialised with the freestream everywhere (impulsive start) */
export function buildSolver(c: SimConfig, mesh = buildMesh(c)): EulerSolver {
  const steadyStartup = c.numerics.mode === 'steady' && c.numerics.startupSteps > 0;
  const s = new EulerSolver(mesh, solverOptions(c, steadyStartup ? 1 : c.numerics.order));
  const fs = freestreamOf(c);
  s.init(() => ({ rho: fs.rho, u: fs.u, v: fs.v, p: fs.p }));
  return s;
}
