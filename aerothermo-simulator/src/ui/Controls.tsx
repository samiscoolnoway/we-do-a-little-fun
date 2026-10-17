import { MESH_PRESETS, type MeshPreset, configWarnings, effectiveScheme } from '../core/config';
import type { RunStatus } from '../core/simulation';
import { store, useStore } from './store';
import { NumberField, Section, SelectField } from './widgets';

export const STATUS_TEXT: Record<RunStatus, string> = {
  ready: 'Ready (initial state)',
  running: 'Running',
  converged: 'Converged',
  levelled: 'Residual levelled off',
  finished: 'Reached end time',
  'max-steps': 'Stopped at step limit',
  failed: 'Stopped: invalid state',
};

export function RunBar() {
  const running = useStore((s) => s.running);
  const snap = useStore((s) => s.snap);
  useStore((s) => s.edited);
  useStore((s) => s.run);
  const status = snap?.diag.status ?? 'ready';
  const steps = snap?.diag.steps ?? 0;
  const needsRestart = store.needsRestart();
  const failed = status === 'failed';
  const atLimit = status === 'max-steps';
  const done = status === 'converged' || status === 'levelled' || status === 'finished';
  const runLabel = steps === 0 ? 'Run' : done ? 'Continue iterating' : 'Resume';
  return (
    <div className="runbar" data-testid="runbar">
      <div className="runbar-row">
        {running ? (
          <button className="primary" data-testid="btn-pause" onClick={() => store.pause()}>
            Pause
          </button>
        ) : (
          <button className="primary" data-testid="btn-run" disabled={!snap || failed || atLimit} onClick={() => store.runSim()}>
            {runLabel}
          </button>
        )}
        <button data-testid="btn-step" disabled={!snap || running || failed || atLimit} onClick={() => store.step(1)} title="Advance exactly one time step">
          Step
        </button>
        <button data-testid="btn-step10" disabled={!snap || running || failed || atLimit} onClick={() => store.step(10)} title="Advance ten time steps">
          Step ×10
        </button>
      </div>
      <div className="runbar-row">
        <button data-testid="btn-reset" onClick={() => store.reset()} title="Back to the initial state, same parameters as the current results">
          Reset
        </button>
        <button className={needsRestart ? 'attention' : ''} data-testid="btn-restart" onClick={() => store.restart()} title="Build a new mesh and solver from the parameters shown below">
          Restart with current parameters
        </button>
      </div>
      <div className="runbar-row">
        <button className="quiet" data-testid="btn-defaults" onClick={() => store.restoreDefaults()} title="Set all controls back to the default values (press Restart to apply)">
          Restore defaults
        </button>
        <span className={`status-chip s-${status}`} data-testid="run-status">
          {running ? 'Running' : STATUS_TEXT[status]}
        </span>
      </div>
      {needsRestart && (
        <div className="banner warn" role="status" data-testid="restart-banner">
          <strong>Restart needed.</strong> The parameters below have changed. The results on screen were computed with the previous parameters and are
          unchanged; press <em>Restart with current parameters</em> to compute new ones.
        </div>
      )}
    </div>
  );
}

export function FlowControls() {
  const c = useStore((s) => s.edited);
  const warnings = configWarnings(c);
  return (
    <>
      <Section title="Freestream" open testid="sec-flow">
        <NumberField label="Mach number M∞" value={c.flow.mach} min={0.2} max={8} step={0.1} testid="in-mach" onChange={(v) => store.edit('flow', 'mach', v)} />
        <NumberField label="Static temperature T∞" unit="K" value={c.flow.Tinf} min={150} max={400} step={1} testid="in-tinf" onChange={(v) => store.edit('flow', 'Tinf', v)} />
        <NumberField
          label="Static pressure p∞"
          unit="Pa"
          value={c.flow.pinf}
          min={10}
          max={200000}
          step={10}
          log
          testid="in-pinf"
          hint="101 325 Pa at sea level; ≈ 2 500 Pa near 25 km altitude."
          onChange={(v) => store.edit('flow', 'pinf', v)}
        />
        <NumberField label="Angle of attack α" unit="°" value={c.flow.angle} min={-20} max={20} step={0.5} testid="in-angle" onChange={(v) => store.edit('flow', 'angle', v)} />
        {warnings.map((w) => (
          <div key={w} className="banner info small">
            {w}
          </div>
        ))}
      </Section>
      <Section title="Body (idealised heat shield)" testid="sec-body">
        <SelectField
          label="Shape"
          value={c.body.kind}
          options={[
            { value: 'cylinder', label: 'Circular cylinder' },
            { value: 'ellipse', label: 'Elliptic (blunt face)' },
          ]}
          testid="in-shape"
          onChange={(v) => store.edit('body', 'kind', v)}
        />
        <NumberField label="Half-height H (radius)" unit="m" value={c.body.radius} min={0.05} max={5} step={0.05} testid="in-radius" onChange={(v) => store.edit('body', 'radius', v)} />
        {c.body.kind === 'ellipse' && (
          <NumberField
            label="Length / height ratio a/H"
            value={c.body.aspect}
            min={0.3}
            max={1.5}
            step={0.05}
            testid="in-aspect"
            hint="< 1: blunter face than a circle (larger nose radius H²/a)."
            onChange={(v) => store.edit('body', 'aspect', v)}
          />
        )}
        <div className="hint">2D planar: the body is infinitely long in the third direction (a cross-section), not an axisymmetric capsule.</div>
      </Section>
      <Section title="Mesh and numerics" testid="sec-numerics">
        <SelectField
          label="Mesh"
          value={c.numerics.mesh}
          options={(Object.keys(MESH_PRESETS) as MeshPreset[]).map((k) => ({ value: k, label: `${MESH_PRESETS[k].label} (${MESH_PRESETS[k].ni * MESH_PRESETS[k].nj} cells)` }))}
          testid="in-mesh"
          onChange={(v) => store.edit('numerics', 'mesh', v)}
        />
        <SelectField
          label="Time marching"
          value={c.numerics.mode}
          options={[
            { value: 'steady', label: 'Steady state (local time steps)' },
            { value: 'transient', label: 'Time accurate (one global Δt)' },
          ]}
          testid="in-mode"
          onChange={(v) => store.edit('numerics', 'mode', v)}
        />
        {c.numerics.mode === 'steady' && (
          <SelectField
            label="Steady-state solver"
            value={c.numerics.scheme}
            options={[
              { value: 'implicit', label: 'Implicit LU-SGS (supersonic only)' },
              { value: 'explicit', label: 'Explicit Runge–Kutta' },
            ]}
            testid="in-scheme"
            hint={
              c.flow.mach <= 1
                ? 'Subsonic: the explicit scheme is always used (it keeps the flow exactly symmetric; the implicit sweeps would let the wake start shedding).'
                : 'Implicit: large CFL numbers, converges several times faster, essential on the medium and fine meshes.'
            }
            onChange={(v) => store.edit('numerics', 'scheme', v)}
          />
        )}
        {effectiveScheme(c) === 'implicit' ? (
          <NumberField
            label="CFL number (implicit)"
            value={c.numerics.cflImplicit}
            min={1}
            max={30}
            step={0.5}
            testid="in-cfl-imp"
            hint="Ramped up from 1 by 10 % per step. Above ≈ 15 the iteration may stall in a limit cycle."
            onChange={(v) => store.edit('numerics', 'cflImplicit', v)}
          />
        ) : (
          <NumberField label="CFL number" value={c.numerics.cfl} min={0.05} max={1.5} step={0.05} testid="in-cfl" hint="Above ≈ 1 the explicit scheme becomes unstable." onChange={(v) => store.edit('numerics', 'cfl', v)} />
        )}
        <SelectField
          label="Spatial order"
          value={c.numerics.order}
          options={[
            { value: 1, label: '1st order (robust, diffusive)' },
            { value: 2, label: '2nd order MUSCL (sharper)' },
          ]}
          testid="in-order"
          onChange={(v) => store.edit('numerics', 'order', v)}
        />
        {c.numerics.order === 2 && (
          <SelectField
            label="Slope limiter"
            value={c.numerics.limiter}
            options={[
              { value: 'vanalbada', label: 'van Albada (smooth)' },
              { value: 'minmod', label: 'minmod (most dissipative)' },
            ]}
            onChange={(v) => store.edit('numerics', 'limiter', v)}
          />
        )}
        {c.numerics.mode === 'steady' && (
          <SelectField
            label="Convergence judged on"
            value={c.numerics.convergeOn}
            options={[
              { value: 'windward', label: 'Windward region (supersonic only)' },
              { value: 'domain', label: 'Whole domain' },
            ]}
            testid="in-converge-on"
            hint={
              c.flow.mach <= 1
                ? 'Subsonic: the wake influences the whole flow, so the whole-domain residual is always used.'
                : 'Supersonic: the wake cannot influence the windward flow, where heating is evaluated. The near-vacuum inviscid wake converges very slowly.'
            }
            onChange={(v) => store.edit('numerics', 'convergeOn', v)}
          />
        )}
        {c.numerics.mode === 'steady' ? (
          <NumberField
            label="Convergence: residual drop"
            unit="orders of 10"
            value={c.numerics.residualDrop}
            min={1}
            max={8}
            step={0.5}
            slider={false}
            testid="in-drop"
            onChange={(v) => store.edit('numerics', 'residualDrop', v)}
          />
        ) : (
          <NumberField
            label="Simulated time"
            unit="s"
            value={c.numerics.endTime}
            min={1e-5}
            max={1}
            step={0.001}
            log
            testid="in-endtime"
            hint="Physical time to march; a flow-through of the body takes ≈ 2H / V∞."
            onChange={(v) => store.edit('numerics', 'endTime', v)}
          />
        )}
        <NumberField label="Step limit" value={c.numerics.maxSteps} min={10} max={50000} step={10} slider={false} testid="in-maxsteps" onChange={(v) => store.edit('numerics', 'maxSteps', Math.round(v))} />
      </Section>
    </>
  );
}
