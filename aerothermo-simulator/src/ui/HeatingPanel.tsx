import { fmt } from '../viz/colormap';
import { useHeating } from './derived';
import { LinePlot } from './Plot';
import { useStore } from './store';

const kw = (q: number) => `${fmt(q / 1000, 4)} kW/m²`;

/** Surface heating from the boundary-layer correlation, fed with the computed inviscid edge conditions. */
export function HeatingPanel() {
  const { heating: h, converged, step } = useHeating();
  const eps = useStore((s) => s.edited.thermal.emissivity);
  if (!h)
    return <div className="panel-empty">Heating is evaluated from the computed flow. Run the flow solver first; the heating appears as soon as there is a solution.</div>;
  const st = h.stag;
  // signed surface angle: negative on the lower side (s < 0)
  const ang = h.points.map((p) => (p.s < 0 ? -p.phi : p.phi));
  const q = h.points.map((p) => p.q / 1000);
  const ratio = h.points.map((p) => p.ratio);
  return (
    <div className="heating" data-testid="heating">
      {!converged && (
        <div className="banner warn small" data-testid="heating-preliminary">
          Preliminary: the flow is not converged yet (step {step}). The heating below follows the current, still changing flow field.
        </div>
      )}
      <div className="card">
        <h3>Stagnation line</h3>
        <dl className="kv">
          <dt>Heat flux into the wall at {fmt(h.Tref, 4)} K</dt>
          <dd data-testid="q-stag">{kw(st.q)}</dd>
          <dt>Heat-transfer coefficient H</dt>
          <dd>{fmt(st.H, 4)} W/(m²·K)</dd>
          <dt>Adiabatic-wall (total) temperature T_aw</dt>
          <dd>{fmt(st.Taw, 4)} K</dd>
          <dt>Radiative-equilibrium wall temperature (ε = {fmt(eps, 2)})</dt>
          <dd data-testid="t-rad">{fmt(st.Trad, 4)} K</dd>
          <dt>Edge pressure pₑ / temperature Tₑ (solver)</dt>
          <dd>
            {fmt(st.pe, 4)} Pa / {fmt(st.Te, 4)} K
          </dd>
          <dt>Edge density ρₑ / viscosity μₑ (Sutherland)</dt>
          <dd>
            {fmt(st.rhoE, 4)} kg/m³ / {fmt(st.muE, 3)} Pa·s
          </dd>
          <dt>Velocity gradient duₑ/ds: solver / Newtonian</dt>
          <dd data-testid="beta">
            {fmt(st.beta, 4)} / {fmt(st.betaNewton, 4)} 1/s
          </dd>
        </dl>
      </div>
      <div className="card">
        <h3>Cold-wall comparison (T_w → 0)</h3>
        <dl className="kv">
          <dt>This model, computed velocity gradient</dt>
          <dd data-testid="q-cold">{kw(st.qCold)}</dd>
          <dt>This model, Newtonian velocity gradient</dt>
          <dd>{kw(st.qColdNewton)}</dd>
          <dt>Sutton–Graves, sphere (axisymmetric)</dt>
          <dd>{kw(st.qSG)}</dd>
          <dt>Sutton–Graves converted to 2D (÷√2)</dt>
          <dd data-testid="q-sg">{kw(st.qSG2D)}</dd>
        </dl>
        <div className="hint">
          Sutton–Graves is a fit for hypersonic re-entry in equilibrium air. Agreement within tens of per cent is the expected level for an order-of-magnitude
          comparison; it is not a validation.
        </div>
      </div>
      <LinePlot
        testid="heating-plot"
        title="Local heat flux along the windward face"
        xLabel="surface angle from the stagnation point φ [°] (− lower, + upper)"
        yLabel="q [kW/m²]"
        yMin={0}
        series={[{ x: ang, y: q, label: `q into a wall at ${fmt(h.Tref, 4)} K`, className: 'heat' }]}
        markers={[
          { x: -60, label: '−60°' },
          { x: -30, label: '−30°' },
          { x: 0, label: 'stag.' },
          { x: 30, label: '30°' },
          { x: 60, label: '60°' },
        ]}
      />
      <LinePlot
        title="Lees distribution q/q₀ (same wall temperature)"
        xLabel="surface angle φ [°]"
        yLabel="q / q₀ [–]"
        yMin={0}
        series={[{ x: ang, y: ratio, label: 'Lees local similarity' }]}
      />
      {h.notes.map((n) => (
        <div key={n} className="banner warn small">
          {n}
        </div>
      ))}
      <div className="card small" data-testid="heating-assumptions">
        <h3>What this heating model is</h3>
        <p>
          <span className="tag">local</span>
          <span className="tag">stagnation-line value + windward distribution</span>
          <span className="tag">not area-averaged</span>
          <span className="tag">laminar</span>
          <span className="tag">steady</span>
        </p>
        <p>
          The flow solver is inviscid and cannot compute heat flux. Heating is estimated with laminar boundary-layer theory, using the solver&apos;s wall values as the
          conditions at the boundary-layer edge: stagnation line q₀ = 0.57 Pr^−0.6 √(ρₑμₑ duₑ/ds) (h_aw − h_w) for a 2D cylinder (Anderson, <em>Hypersonic and
          High-Temperature Gas Dynamics</em>, 2nd ed., §6.6, from the similarity solutions of Fay &amp; Riddell / Cohen &amp; Reshotko), Pr = 0.71; the windward
          distribution follows Lees (1956) local similarity; T_aw uses the laminar recovery factor √Pr.
        </p>
        <p>
          Range: continuum (Knudsen number {fmt(h.knudsen, 2)} ≪ 0.01), laminar attached flow on the windward face only (beyond the shoulders: not applicable),
          calorically perfect air (no dissociation). Freestream Reynolds number on the body height: {fmt(h.reynolds, 3)}. Expected uncertainty of the correlation
          itself: of order 10–20 %, before the inviscid-solution errors.
        </p>
      </div>
    </div>
  );
}
