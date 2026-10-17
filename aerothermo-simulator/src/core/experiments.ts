import { DEFAULT_CONFIG, type SimConfig, billigStandoffCylinder, cloneConfig, freestreamOf } from './config';
import { normalShock, pitotPressure } from './gas';
import { computeHeating } from './heating';
import type { Diagnostics, SurfaceData } from './simulation';
import { solveConduction } from './thermal';

/**
 * Scenarios, experiments and the comparison table. A row is computed only from a finished (or explicitly
 * recorded) run: the configuration it was computed with, its diagnostics and its fields. Reference columns name
 * their kind: analytic theory (pitot pressure) or empirical correlation (Billig standoff); neither is a
 * validation against experiment.
 */
export interface ComparisonRow {
  id: number;
  name: string;
  mach: number;
  Tinf: number;
  pinf: number;
  angle: number;
  body: string;
  mesh: string;
  cells: number;
  status: string;
  steps: number;
  residualDrop: number;
  /** stagnation pressure / Rayleigh pitot formula (analytic) */
  pStagRatio: number;
  /** bow-shock standoff / half-height, and the Billig correlation (empirical); NaN where not defined */
  standoff: number;
  billig: number;
  enthalpyErrWindward: number;
  qStag: number;
  hStag: number;
  Taw: number;
  material: string;
  k: number;
  thickness: number;
  duration: number;
  TsurfEnd: number;
  TbackEnd: number;
}

/**
 * Bow-shock standoff on the stagnation line: distance from the nose to where the density crosses halfway between
 * the freestream value and the normal-shock value, interpolated between cells. Only for supersonic, zero-incidence
 * flow on the O-grid (cell column i = 0 lies on the stagnation line). Returns Δ/H, or NaN.
 */
export function shockStandoff(xc: ArrayLike<number>, ni: number, nj: number, rho: ArrayLike<number>, c: SimConfig): number {
  if (c.flow.mach <= 1 || c.flow.angle !== 0) return NaN;
  const fs = freestreamOf(c);
  const mid = 0.5 * fs.rho * (1 + normalShock(fs.mach).r21);
  const nose = c.body.kind === 'cylinder' ? c.body.radius : c.body.radius * c.body.aspect;
  for (let j = nj - 1; j > 0; j--) {
    const a = rho[j * ni];
    const b = rho[(j - 1) * ni];
    if (a < mid && b >= mid) {
      const xa = xc[j * ni];
      const xb = xc[(j - 1) * ni];
      const xsh = xa + ((mid - a) / (b - a)) * (xb - xa);
      return (-nose - xsh) / c.body.radius;
    }
  }
  return NaN;
}

let rowId = 0;

export function summarize(
  name: string,
  c: SimConfig,
  diag: Diagnostics,
  surface: SurfaceData,
  rho: ArrayLike<number>,
  xc: ArrayLike<number>,
  materialLabel = 'custom',
): ComparisonRow {
  const fs = freestreamOf(c);
  const h = computeHeating(surface, c, c.thermal.T0);
  const th = solveConduction(c.thermal, { H: h.stag.H, Taw: h.stag.Taw }, 1500);
  const standoff = shockStandoff(xc, diag.ni, diag.nj, rho, c);
  return {
    id: ++rowId,
    name,
    mach: c.flow.mach,
    Tinf: c.flow.Tinf,
    pinf: c.flow.pinf,
    angle: c.flow.angle,
    body: c.body.kind === 'cylinder' ? `cylinder H = ${c.body.radius} m` : `ellipse H = ${c.body.radius} m, a/H = ${c.body.aspect}`,
    mesh: `${diag.ni}×${diag.nj}`,
    cells: diag.cells,
    status: diag.status,
    steps: diag.steps,
    residualDrop: diag.drop,
    pStagRatio: surface.p[h.stag.i] / pitotPressure(fs.p, fs.mach),
    standoff,
    billig: c.flow.mach > 1 && c.body.kind === 'cylinder' ? billigStandoffCylinder(c.flow.mach) : NaN,
    enthalpyErrWindward: diag.enthalpyError.front,
    qStag: h.stag.q,
    hStag: h.stag.H,
    Taw: h.stag.Taw,
    material: materialLabel,
    k: c.thermal.k,
    thickness: c.thermal.thickness,
    duration: c.thermal.duration,
    TsurfEnd: th.Tsurf[th.Tsurf.length - 1],
    TbackEnd: th.Tback[th.Tback.length - 1],
  };
}

/** columns of the comparison table with units (also the CSV header) */
export const ROW_COLUMNS: { key: keyof ComparisonRow; label: string; unit: string }[] = [
  { key: 'name', label: 'Run', unit: '' },
  { key: 'mach', label: 'M∞', unit: '-' },
  { key: 'Tinf', label: 'T∞', unit: 'K' },
  { key: 'pinf', label: 'p∞', unit: 'Pa' },
  { key: 'angle', label: 'α', unit: 'deg' },
  { key: 'body', label: 'Body', unit: '' },
  { key: 'mesh', label: 'Mesh', unit: '' },
  { key: 'status', label: 'Status', unit: '' },
  { key: 'steps', label: 'Steps', unit: '' },
  { key: 'residualDrop', label: 'Residual drop', unit: 'orders' },
  { key: 'pStagRatio', label: 'p_stag / pitot (analytic)', unit: '-' },
  { key: 'standoff', label: 'Standoff Δ/H', unit: '-' },
  { key: 'billig', label: 'Billig Δ/R (empirical)', unit: '-' },
  { key: 'enthalpyErrWindward', label: 'Total-enthalpy error (windward)', unit: '-' },
  { key: 'qStag', label: 'q_stag at T0', unit: 'W/m2' },
  { key: 'hStag', label: 'H_stag', unit: 'W/(m2 K)' },
  { key: 'Taw', label: 'T_aw', unit: 'K' },
  { key: 'material', label: 'Material', unit: '' },
  { key: 'k', label: 'k', unit: 'W/(m K)' },
  { key: 'thickness', label: 'Thickness', unit: 'm' },
  { key: 'duration', label: 'Exposure', unit: 's' },
  { key: 'TsurfEnd', label: 'T_surface (end)', unit: 'K' },
  { key: 'TbackEnd', label: 'T_back (end)', unit: 'K' },
];

const csvCell = (v: unknown) => {
  const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function rowsToCsv(rows: ComparisonRow[]): string {
  const header = ROW_COLUMNS.map((c) => csvCell(c.unit ? `${c.label} [${c.unit}]` : c.label)).join(',');
  return [header, ...rows.map((r) => ROW_COLUMNS.map((c) => csvCell(r[c.key])).join(','))].join('\n') + '\n';
}

export function rowsToJson(rows: ComparisonRow[], meta: Record<string, unknown> = {}): string {
  return JSON.stringify({ generator: 'AeroThermo Lab', model: '2D inviscid Euler + laminar stagnation heating correlation + 1D conduction', ...meta, columns: ROW_COLUMNS, rows }, null, 2);
}

// ───────── scenarios and experiments ─────────
export interface Scenario {
  id: string;
  title: string;
  description: string;
  apply: (c: SimConfig) => void;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'subsonic',
    title: 'Subsonic, sea level (M = 0.5)',
    description: 'No shock: the flow slows smoothly ahead of the body and the body is felt far upstream.',
    apply: (c) => {
      c.flow = { mach: 0.5, Tinf: 288.15, pinf: 101325, angle: 0 };
    },
  },
  {
    id: 'supersonic',
    title: 'Supersonic, 25 km (M = 3)',
    description: 'A detached bow shock stands ahead of the body; the default case.',
    apply: (c) => {
      c.flow = { mach: 3, Tinf: 220, pinf: 2500, angle: 0 };
    },
  },
  {
    id: 'hypersonic',
    title: 'Higher Mach, 25 km (M = 6)',
    description: 'The shock moves closer to the body and the stagnation temperature quadruples the M = 3 rise.',
    apply: (c) => {
      c.flow = { mach: 6, Tinf: 220, pinf: 2500, angle: 0 };
    },
  },
  {
    id: 'incidence',
    title: 'Supersonic at 10° incidence',
    description: 'The stagnation point moves towards the lower front face; heating becomes asymmetric.',
    apply: (c) => {
      c.flow = { mach: 3, Tinf: 220, pinf: 2500, angle: 10 };
    },
  },
  {
    id: 'blunt',
    title: 'Blunter elliptic face (M = 6)',
    description: 'A flatter nose (larger nose radius) lowers the stagnation heating, the classic reason heat shields are blunt.',
    apply: (c) => {
      c.flow = { mach: 6, Tinf: 220, pinf: 2500, angle: 0 };
      c.body = { kind: 'ellipse', radius: 0.5, aspect: 0.5 };
    },
  },
];

export interface ExperimentItem {
  name: string;
  apply: (c: SimConfig) => void;
}

export interface Experiment {
  id: string;
  title: string;
  question: string;
  /** what the comparison should show, and why */
  lookFor: string;
  items: ExperimentItem[];
}

const base = (c: SimConfig) => {
  const d = cloneConfig(DEFAULT_CONFIG);
  c.flow = d.flow;
  c.body = d.body;
  c.numerics = d.numerics;
  c.thermal = d.thermal;
};

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'mach',
    title: 'Subsonic vs supersonic vs higher Mach',
    question: 'How do the shock, the stagnation pressure and the heating change with Mach number?',
    lookFor:
      'p_stag/pitot stays near 1 in every case (the solver reproduces the theory), the standoff shrinks with Mach number, and the stagnation heat flux grows much faster than the speed (roughly with V³ for a cold wall).',
    items: [
      { name: 'M = 0.5 (sea level)', apply: (c) => (base(c), (c.flow = { mach: 0.5, Tinf: 288.15, pinf: 101325, angle: 0 })) },
      { name: 'M = 3', apply: (c) => (base(c), (c.flow.mach = 3)) },
      { name: 'M = 6', apply: (c) => (base(c), (c.flow.mach = 6)) },
    ],
  },
  {
    id: 'thickness',
    title: 'Two heat-shield thicknesses',
    question: 'How much does a thicker shield protect the structure behind it?',
    lookFor: 'Same flow and same surface heating; the surface temperature is nearly the same, but the back face of the thicker shield stays much cooler.',
    items: [
      { name: 'L = 15 mm', apply: (c) => (base(c), (c.thermal.thickness = 0.015)) },
      { name: 'L = 45 mm', apply: (c) => (base(c), (c.thermal.thickness = 0.045)) },
    ],
  },
  {
    id: 'conductivity',
    title: 'Two thermal conductivities',
    question: 'Should a heat shield conduct heat well or badly?',
    lookFor:
      'With ten times the conductivity the surface stays cooler (heat is drawn inside), but the back face gets much hotter: a good insulator keeps the heat at the surface, where it can be re-radiated.',
    items: [
      { name: 'k = 0.1 W/(m·K)', apply: (c) => (base(c), (c.thermal.k = 0.1)) },
      { name: 'k = 1.0 W/(m·K)', apply: (c) => (base(c), (c.thermal.k = 1.0)) },
    ],
  },
  {
    id: 'grid',
    title: 'Grid comparison (M = 3)',
    question: 'Are the results independent of the mesh?',
    lookFor:
      'Quantities that change little from medium to fine are grid-converged. The standoff and p_stag/pitot should settle; the total-enthalpy error should fall. Differences between meshes estimate the discretisation error.',
    items: [
      { name: 'Coarse 96×48', apply: (c) => (base(c), (c.numerics.mesh = 'coarse')) },
      { name: 'Medium 160×80', apply: (c) => (base(c), (c.numerics.mesh = 'medium')) },
      { name: 'Fine 240×120', apply: (c) => (base(c), (c.numerics.mesh = 'fine')) },
    ],
  },
];

export function experimentConfigs(e: Experiment): { name: string; config: SimConfig }[] {
  return e.items.map((it) => {
    const c = cloneConfig(DEFAULT_CONFIG);
    it.apply(c);
    return { name: it.name, config: c };
  });
}
