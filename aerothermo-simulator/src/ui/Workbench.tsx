import { freestreamOf } from '../core/config';
import { FIELD_INFO, type FieldName } from '../core/simulation';
import { fmt } from '../viz/colormap';
import { buildLocator, pointInPolygon } from '../viz/locate';
import { useMemo } from 'react';
import { STATUS_TEXT } from './Controls';
import { useStore } from './store';
import { Stat } from './widgets';

/** Diagnostics of the running solver: every number here is read from the solver, none is estimated. */
export function Workbench() {
  const snap = useStore((s) => s.snap);
  const running = useStore((s) => s.running);
  const error = useStore((s) => s.error);
  const run = useStore((s) => s.run);
  if (!snap) return <div className="panel-empty">Waiting for the solver…</div>;
  const d = snap.diag;
  const steady = d.mode === 'steady';
  const pct = steady ? Math.max(0, Math.min(1, d.drop / d.targetDrop)) : Math.min(1, d.time / d.endTime);
  return (
    <div className="workbench" data-testid="workbench">
      {error && <div className="banner bad">{error}</div>}
      {d.failure && (
        <div className="banner bad" data-testid="failure">
          <strong>The solver stopped: {d.failure.reason}</strong> in cell (i = {d.failure.i}, j = {d.failure.j}) at x = {fmt(d.failure.x)} m, y = {fmt(d.failure.y)} m, step{' '}
          {d.failure.step + 1}, stage {d.failure.stage} (ρ = {fmt(d.failure.rho)} kg/m³, p = {fmt(d.failure.p)} Pa). The last valid state is kept on screen; nothing was
          clipped. Try a lower CFL number, first-order reconstruction or a coarser mesh, then press <em>Restart</em>.
        </div>
      )}
      <div className="progress" aria-label="Progress">
        <div className="progress-bar" style={{ width: `${pct * 100}%` }} />
        <span>
          {steady
            ? `${d.criterion === 'windward' ? 'Windward' : 'Whole-domain'} residual drop ${d.drop.toFixed(2)} of ${d.targetDrop} orders`
            : `t = ${fmt(d.time, 4)} s of ${fmt(d.endTime, 3)} s`}
        </span>
      </div>
      <div className="stats">
        <Stat
          label="Status"
          value={running ? 'Running' : `${STATUS_TEXT[d.status]}${steady && d.status === 'converged' ? (d.criterion === 'windward' ? ' (windward region)' : ' (whole domain)') : ''}`} testid="diag-status" tone={d.status === 'failed' ? 'bad' : d.status === 'converged' || d.status === 'finished' ? 'ok' : d.status === 'levelled' || d.status === 'max-steps' ? 'warn' : undefined} />
        <Stat label="Mesh" value={`${d.ni} × ${d.nj}`} unit={`= ${d.cells.toLocaleString('en')} cells`} testid="diag-cells" />
        <Stat label="Steps" value={d.steps.toLocaleString('en')} testid="diag-steps" />
        <Stat label={steady ? 'Smallest local Δt' : 'Time step Δt'} value={fmt(d.dt, 3)} unit="s" testid="diag-dt" />
        <Stat label={steady ? 'Pseudo-time' : 'Simulated time t'} value={steady ? 'n/a (local Δt)' : fmt(d.time, 4)} unit={steady ? '' : 's'} testid="diag-time" />
        <Stat label="Time integration" value={d.mode === 'transient' ? 'SSP-RK2, global Δt' : d.scheme === 'implicit' ? 'Implicit LU-SGS' : 'SSP-RK2, local Δt'} testid="diag-scheme" />
        <Stat label="CFL number" value={fmt(d.cfl, 3)} unit={d.scheme === 'implicit' ? `(target ${fmt(run.numerics.cflImplicit, 3)})` : ''} testid="diag-cfl" />
        <Stat label="Order in last step" value={d.order === 1 ? '1st' : '2nd'} unit={steady && d.steps < d.startupSteps ? `(1st-order start-up until step ${d.startupSteps})` : ''} />
        <Stat label="Residual RMS ∂ρ/∂t, whole domain" value={fmt(d.residual, 3)} unit={`kg/(m³·s) · drop ${d.dropDomain.toFixed(2)}`} testid="diag-residual" />
        <Stat label="Residual RMS ∂ρ/∂t, windward" value={fmt(d.residualWindward, 3)} unit={`kg/(m³·s) · drop ${d.dropWindward.toFixed(2)}`} testid="diag-residual-wind" />
        <Stat label="Far-field mass imbalance" value={`${fmt(d.massImbalance * 100, 2)} %`} tone={Math.abs(d.massImbalance) < 0.01 ? 'ok' : undefined} testid="diag-imbalance" />
        <Stat
          label="Total-enthalpy error, windward"
          value={`${fmt(d.enthalpyError.front * 100, 2)} %`}
          unit={`(inside the smeared shock: ${fmt(d.enthalpyError.shock * 100, 2)} %)`}
          tone={Math.abs(d.enthalpyError.front) < 0.02 ? 'ok' : 'warn'}
          testid="diag-h-front"
        />
        <Stat
          label="Total-enthalpy error, worst cell"
          value={`${fmt(d.enthalpyError.max * 100, 2)} %`}
          unit={`at (${fmt(d.enthalpyError.maxX, 2)}, ${fmt(d.enthalpyError.maxY, 2)}) m`}
          tone={Math.abs(d.enthalpyError.max) < 0.02 ? 'ok' : 'warn'}
          testid="diag-h-max"
        />
        <Stat label="1st-order fallback faces" value={d.fallbacks} testid="diag-fallbacks" tone={d.fallbacks > 0 ? 'warn' : undefined} />
        {d.scheme === 'implicit' && <Stat label="Implicit updates limited" value={d.limitedCells} unit="cells (ρ or p change capped at 30 %)" testid="diag-limited" tone={d.limitedCells > 0 ? 'warn' : undefined} />}
        <Stat label="Solver speed" value={d.msPerStep ? fmt(d.msPerStep, 3) : '–'} unit="ms / step" />
        <Stat label="Invalid states" value={d.failure ? 'detected (stopped)' : 'none'} tone={d.failure ? 'bad' : 'ok'} testid="diag-invalid" />
      </div>
      <ResidualPlot
        history={snap.history}
        wind={snap.windHistory}
        steps={snap.historySteps}
        target={steady ? (d.criterion === 'windward' ? d.residualWindwardRef : d.residualRef) * Math.pow(10, -d.targetDrop) : 0}
        criterion={d.criterion}
      />
      <div className="explain small">
        <strong>Total-enthalpy check.</strong> In a steady flow without viscosity or heat conduction, h + V²/2 must equal its freestream value everywhere, so its
        deviation is a direct measure of numerical error (mean over the domain: {fmt(d.enthalpyError.mean * 100, 2)} %). Errors are largest in the wake behind the body,
        where the inviscid model lets the flow expand to almost vacuum instead of separating as a real, viscous flow would: treat the wake as qualitative. The windward
        side, where the heating is evaluated, is the reliable part of the solution.
      </div>
      <div className="explain small">
        {steady ? (
          <>
            <strong>Steady-state mode.</strong> Each cell advances with its own largest stable time step, which reaches the final steady flow quickly but makes the
            intermediate states unphysical (different cells are at different "times"). Only the converged result is meaningful. Convergence is judged by how far the
            residual (the average rate of change of density) has fallen below its value at the start.
          </>
        ) : (
          <>
            <strong>Time-accurate mode.</strong> All cells advance with the same Δt (the smallest stable one), so every snapshot is a physical moment of an impulsively
            started flow. Use it to watch the bow shock form; it is slower than steady mode.
          </>
        )}
      </div>
    </div>
  );
}

function ResidualPlot({ history, wind, steps, target, criterion }: { history: Float32Array; wind: Float32Array; steps: Float32Array; target: number; criterion: 'domain' | 'windward' }) {
  const W = 320;
  const Hh = 130;
  const pad = { l: 44, r: 8, t: 8, b: 22 };
  if (history.length < 2) return <div className="plot-empty">The residual history appears once the solver has taken steps.</div>;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of history) if (v > 0) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
  for (const v of wind) if (v > 0) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
  if (target > 0) lo = Math.min(lo, target);
  const l0 = Math.floor(Math.log10(lo));
  const l1 = Math.ceil(Math.log10(hi));
  const n = steps[steps.length - 1];
  const X = (s: number) => pad.l + ((s - 1) / Math.max(1, n - 1)) * (W - pad.l - pad.r);
  const Y = (v: number) => pad.t + ((l1 - Math.log10(v)) / Math.max(1, l1 - l0)) * (Hh - pad.t - pad.b);
  const path = (h: Float32Array) => {
    let d = '';
    for (let k = 0; k < h.length; k++) if (h[k] > 0) d += `${d ? 'L' : 'M'}${X(steps[k]).toFixed(1)},${Y(h[k]).toFixed(1)}`;
    return d;
  };
  const decades = [];
  for (let e = l0; e <= l1; e++) decades.push(e);
  return (
    <figure className="plot" data-testid="residual-plot">
      <figcaption>Residual history (log scale)</figcaption>
      <svg viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label="Residual versus step number, logarithmic scale">
        {decades.map((e) => (
          <g key={e}>
            <line x1={pad.l} x2={W - pad.r} y1={Y(10 ** e)} y2={Y(10 ** e)} className="grid" />
            <text x={pad.l - 4} y={Y(10 ** e) + 3} className="tick" textAnchor="end">
              1e{e}
            </text>
          </g>
        ))}
        {target > 0 && <line x1={pad.l} x2={W - pad.r} y1={Y(target)} y2={Y(target)} className="target" />}
        <path d={path(history)} className="series" />
        <path d={path(wind)} className="series heat" />
        <text x={pad.l} y={Hh - 6} className="tick">
          1
        </text>
        <text x={W - pad.r} y={Hh - 6} className="tick" textAnchor="end">
          step {n}
        </text>
      </svg>
      <div className="plot-note">
        <span className="key cool" /> whole domain <span className="key heat" /> windward region (upstream of the body centre)
        {target > 0 && <> · dashed: target for the {criterion === 'windward' ? 'windward' : 'whole-domain'} residual</>}
      </div>
    </figure>
  );
}

const PROBE_FIELDS: FieldName[] = ['mach', 'p', 'rho', 'T', 'speed', 'u', 'v', 'cp', 'ds'];

/** Reads the computed cell under the probe: values are the solver's own cell averages, not interpolated. */
export function ProbePanel() {
  const probe = useStore((s) => s.probe);
  const mesh = useStore((s) => s.mesh);
  const snap = useStore((s) => s.snap);
  const run = useStore((s) => s.run);
  const loc = useMemo(() => (mesh ? buildLocator({ ni: mesh.ni, nj: mesh.nj, x: mesh.x, y: mesh.y, area: mesh.area, periodicI: true }) : null), [mesh]);
  if (!probe) return <div className="panel-empty">Click or tap anywhere in the flow to place the probe.</div>;
  const hit = loc?.locate(probe.x, probe.y) ?? null;
  if (!hit || !snap || !mesh)
    return (
      <div className="panel-empty" data-testid="probe-outside">
        The probe at ({fmt(probe.x)}, {fmt(probe.y)}) m is {mesh && pointInPolygon(probe.x, probe.y, mesh.bodyX, mesh.bodyY) ? 'inside the body (a solid: the flow solver has no cells there)' : 'outside the computational domain'}: there is no flow value there.
      </div>
    );
  const fs = freestreamOf(run);
  const fsVal: Partial<Record<FieldName, number>> = { mach: fs.mach, p: fs.p, rho: fs.rho, T: fs.T, speed: fs.V, u: fs.u, v: fs.v, cp: 0, ds: 0 };
  const c = hit.cell;
  return (
    <div className="probe" data-testid="probe">
      <div className="probe-head">
        Cell (i = {hit.i}, j = {hit.j}) · centre ({fmt(mesh.xc[c], 4)}, {fmt(mesh.yc[c], 4)}) m · step {snap.diag.steps}
      </div>
      <table>
        <thead>
          <tr>
            <th>Quantity</th>
            <th>Cell value</th>
            <th>Freestream</th>
            <th>Ratio</th>
          </tr>
        </thead>
        <tbody>
          {PROBE_FIELDS.map((f) => {
            const v = snap.fields[f][c];
            const r = fsVal[f];
            const ratio = r !== undefined && Math.abs(r) > 1e-12 && f !== 'u' && f !== 'v' ? v / r : null;
            return (
              <tr key={f} data-testid={`probe-${f}`}>
                <td>
                  {FIELD_INFO[f].label} <span className="unit">[{FIELD_INFO[f].unit}]</span>
                </td>
                <td className="num">{fmt(v, 5)}</td>
                <td className="num">{r !== undefined ? fmt(r, 4) : '–'}</td>
                <td className="num">{ratio !== null ? fmt(ratio, 3) : '–'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="hint">Cell values are averages over the cell computed by the finite-volume solver. Smooth colours in the view are interpolated for display only.</div>
    </div>
  );
}
