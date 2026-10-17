import { useEffect, useRef } from 'react';
import { freestreamOf } from '../core/config';
import { colormapCss, colormapTable, fmt } from '../viz/colormap';
import { useThermal } from './derived';
import { LinePlot } from './Plot';
import { useStore } from './store';

const STATION_CLASS = ['heat', 'cool', 'muted'];

/** Heat-shield response: 1D transient conduction driven by the computed surface heating. */
export function ThermalPanel() {
  const { heating, converged, step, stations, columns, thermal, stale } = useThermal();
  const run = useStore((s) => s.run);
  if (!heating || !stations || !columns)
    return <div className="panel-empty">The heat-shield response is driven by the computed surface heating. Run the flow solver first.</div>;
  const fs = freestreamOf(run);
  const tFlow = (2 * run.body.radius) / fs.V;
  const st = stations[0];
  const r0 = st.result;
  const tmin = Math.min(...stations.map((s) => Math.min(...s.result.Tsurf, ...s.result.Tback)));
  const energyErr = Math.abs(r0.absorbed - r0.stored) / Math.max(1e-30, Math.abs(r0.stored));
  return (
    <div className="thermal" data-testid="thermal">
      {!converged && (
        <div className="banner warn small">Preliminary: the flow is not converged yet (step {step}); the heating driving this response is still changing.</div>
      )}
      {stale && <div className="banner info small">Updating for the new heat-shield parameters…</div>}
      <div className="card">
        <h3>Temperatures at the stagnation point after {fmt(thermal.duration, 4)} s</h3>
        <dl className="kv" data-testid="thermal-summary">
          <dt>
            Gas at the boundary-layer edge Tₑ (flow solver)
            {st.Te > st.Taw && (
              <span className="hint">
                {' '}
                — {fmt((st.Te / st.Taw - 1) * 100, 2)} % above T_aw: this is the solver&apos;s numerical total-enthalpy error at the stagnation point (exact theory: Tₑ =
                T_aw there); see the Workbench.
              </span>
            )}
          </dt>
          <dd>{fmt(st.Te, 4)} K</dd>
          <dt>Adiabatic-wall temperature T_aw (upper limit for the surface)</dt>
          <dd>{fmt(st.Taw, 4)} K</dd>
          <dt>Outer surface of the shield</dt>
          <dd data-testid="t-surf">{fmt(r0.Tsurf[r0.Tsurf.length - 1], 4)} K</dd>
          <dt>Back face of the shield</dt>
          <dd data-testid="t-back">{fmt(r0.Tback[r0.Tback.length - 1], 4)} K</dd>
          <dt>Radiative-equilibrium limit (steady, insulated back)</dt>
          <dd>{fmt(heating.stag.Trad, 4)} K</dd>
        </dl>
        <p className="hint">
          The gas next to the wall is hot, but the shield only receives heat at the rate the boundary layer delivers it (q = H (T_aw − T_s)) and re-radiates part
          of it (ε σ T_s⁴). The surface therefore lags far behind the gas temperature, and the inside lags behind the surface, because heat must diffuse through
          a material of low conductivity.
        </p>
      </div>
      <LinePlot
        testid="thermal-history"
        title="Surface temperature (solid) and back-face temperature (dashed)"
        xLabel="time t [s]"
        yLabel="T [K]"
        yMin={tmin}
        series={[
          ...stations.map((s, k) => ({ x: s.result.t, y: s.result.Tsurf, label: `${s.name} (φ = ${fmt(s.phi, 2)}°), surface`, className: STATION_CLASS[k] })),
          ...stations.map((s, k) => ({ x: s.result.t, y: s.result.Tback, label: `${s.name}, back face`, className: STATION_CLASS[k], dashed: true })),
        ]}
      />
      <LinePlot
        testid="thermal-profile"
        title="Temperature through the thickness, stagnation point"
        xLabel="depth below the outer surface x [mm]"
        yLabel="T [K]"
        yMin={tmin}
        series={r0.profiles.map((p, k) => ({
          x: Array.from(r0.x, (v) => v * 1000),
          y: p.T,
          label: `t = ${fmt(p.t, 3)} s`,
          className: k === r0.profiles.length - 1 ? 'heat' : 'muted',
          dashed: k !== r0.profiles.length - 1,
        }))}
      />
      <LinePlot
        title="Heat flux at the stagnation surface"
        xLabel="time t [s]"
        yLabel="q [kW/m²]"
        series={[
          { x: r0.t, y: Array.from(r0.qConv, (v) => v / 1000), label: 'convected in, H (T_aw − T_s)', className: 'heat' },
          { x: r0.t, y: Array.from(r0.qRad, (v) => v / 1000), label: 're-radiated, ε σ T_s⁴', className: 'cool' },
          { x: r0.t, y: Array.from(r0.qNet, (v) => v / 1000), label: 'net into the shield', className: 'muted', dashed: true },
        ]}
      />
      <ColumnMap columns={columns} thickness={thermal.thickness} duration={thermal.duration} />
      <table className="data" data-testid="station-table">
        <thead>
          <tr>
            <th>Station</th>
            <th>H [W/(m²·K)]</th>
            <th>T_aw [K]</th>
            <th>max T_s [K]</th>
            <th>T back [K]</th>
          </tr>
        </thead>
        <tbody>
          {stations.map((s) => (
            <tr key={s.name}>
              <td>{s.name}</td>
              <td className="num">{fmt(s.H, 4)}</td>
              <td className="num">{fmt(s.Taw, 4)}</td>
              <td className="num">{fmt(Math.max(...s.result.Tsurf), 4)}</td>
              <td className="num">{fmt(s.result.Tback[s.result.Tback.length - 1], 4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="card small">
        <h3>Numerics and time scales</h3>
        <dl className="kv">
          <dt>Thermal diffusivity α = k/(ρ c_p)</dt>
          <dd>{fmt(r0.alpha, 3)} m²/s</dd>
          <dt>Conduction time through the thickness L²/α</dt>
          <dd>{fmt(r0.tCond, 3)} s</dd>
          <dt>Flow time 2H/V∞</dt>
          <dd>{fmt(tFlow, 3)} s</dd>
          <dt>Ratio (quasi-steady coupling needs ≫ 1)</dt>
          <dd>{fmt(r0.tCond / tFlow, 3)}</dd>
          <dt>Energy balance: |absorbed − stored| / stored</dt>
          <dd data-testid="energy-check">{fmt(energyErr, 2)}</dd>
          <dt>Grid / time steps / Newton iterations (max)</dt>
          <dd>
            {thermal.nodes} nodes · 1500 steps · {r0.maxNewton}
          </dd>
        </dl>
      </div>
      <div className="card small" data-testid="thermal-assumptions">
        <h3>What this conduction model is</h3>
        <p>
          One-dimensional transient heat conduction through the thickness, ρ c_p ∂T/∂t = k ∂²T/∂x², with constant properties; no ablation, pyrolysis or surface
          chemistry. Outer surface: heating from the boundary-layer correlation minus grey-body re-radiation to cold surroundings. Back face: insulated or fixed.
          Implicit (backward Euler) finite-volume scheme, verified against the analytical semi-infinite-solid solution and an exact steady state.
        </p>
        <p>
          Coupling is quasi-steady: the heating comes from the steady flow solution and is held constant for the whole exposure, as if the vehicle suddenly entered
          this flow and stayed in it. The map above is a set of independent 1D columns; heat does not flow sideways between them.
        </p>
      </div>
    </div>
  );
}

/** temperature at the end of the exposure for independent 1D columns along the windward face */
function ColumnMap({ columns, thickness, duration }: { columns: { phi: number; T: ArrayLike<number> }[]; thickness: number; duration: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of columns) for (let k = 0; k < c.T.length; k++) (lo = Math.min(lo, c.T[k])), (hi = Math.max(hi, c.T[k]));
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !columns.length) return;
    const nx = columns.length;
    const ny = columns[0].T.length;
    cv.width = nx;
    cv.height = ny;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(nx, ny);
    const table = colormapTable('viridis');
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        const t = hi > lo ? (columns[i].T[j] - lo) / (hi - lo) : 0;
        const k = Math.round(Math.max(0, Math.min(1, t)) * 255) * 4;
        const o = (j * nx + i) * 4;
        img.data[o] = table[k];
        img.data[o + 1] = table[k + 1];
        img.data[o + 2] = table[k + 2];
        img.data[o + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
  }, [columns, lo, hi]);
  if (!columns.length) return null;
  return (
    <figure className="plot" data-testid="column-map">
      <figcaption>Temperature inside the shield after {fmt(duration, 4)} s along the windward face (independent 1D columns)</figcaption>
      <div className="colmap">
        <span className="colmap-y">depth 0 → {fmt(thickness * 1000, 3)} mm</span>
        <canvas ref={ref} className="colmap-canvas" />
      </div>
      <div className="colmap-x">
        <span>φ = {fmt(columns[0].phi, 3)}°</span>
        <span>stagnation</span>
        <span>φ = {fmt(columns[columns.length - 1].phi, 3)}°</span>
      </div>
      <div className="legend-bar" style={{ background: colormapCss('viridis'), marginTop: 6 }} />
      <div className="colmap-x">
        <span>{fmt(lo, 4)} K</span>
        <span>{fmt(hi, 4)} K</span>
      </div>
    </figure>
  );
}
