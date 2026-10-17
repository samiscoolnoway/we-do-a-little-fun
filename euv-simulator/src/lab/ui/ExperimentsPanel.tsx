import { cloneConfig } from '../core/config';
import { EXPERIMENTS, ROW_COLUMNS, SCENARIOS, rowsToCsv, rowsToJson } from '../core/experiments';
import { computeHeating } from '../core/heating';
import { FIELD_INFO, type FieldName } from '../core/simulation';
import { fmt } from '../viz/colormap';
import { store, useStore } from './store';

/** save text as a file in the browser */
export function download(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const cell = (v: unknown) => (typeof v === 'number' ? (Number.isFinite(v) ? fmt(v, 4) : '–') : String(v));

export function ExperimentsPanel() {
  const rows = useStore((s) => s.rows);
  const ex = useStore((s) => s.experiment);
  const snap = useStore((s) => s.snap);
  const running = useStore((s) => s.running);
  const busy = !!ex;

  const loadScenario = (apply: (c: ReturnType<typeof cloneConfig>) => void, run: boolean) => {
    const c = cloneConfig(store.state.edited);
    apply(c);
    store.setEdited(c);
    if (run) {
      store.restart();
      store.runSim();
    }
  };

  const exportSurface = () => {
    const { snap: sn, run } = store.state;
    if (!sn) return;
    const h = computeHeating(sn.surface, run, run.thermal.T0);
    const qByCell = new Map(h.points.map((p) => [p.i, p]));
    const lines = ['i,s_from_cell0 [m],x [m],y [m],p [Pa],rho [kg/m3],T [K],u_e [m/s],windward,phi [deg],q at T0 [W/m2],H [W/(m2 K)],T_aw [K]'];
    for (let i = 0; i < sn.surface.p.length; i++) {
      const p = qByCell.get(i);
      lines.push(
        [i, sn.surface.s[i], sn.surface.x[i], sn.surface.y[i], sn.surface.p[i], sn.surface.rho[i], sn.surface.T[i], sn.surface.ue[i], p ? 1 : 0, p?.phi ?? '', p?.q ?? '', p?.H ?? '', p?.Taw ?? ''].join(','),
      );
    }
    download('aerothermo-surface.csv', lines.join('\n') + '\n', 'text/csv');
  };

  const exportFields = () => {
    const { snap: sn, mesh } = store.state;
    if (!sn || !mesh) return;
    const names = Object.keys(FIELD_INFO) as FieldName[];
    const lines = [['i', 'j', 'x [m]', 'y [m]', 'area [m2]', ...names.map((f) => `${f} [${FIELD_INFO[f].unit}]`)].join(',')];
    for (let j = 0; j < mesh.nj; j++)
      for (let i = 0; i < mesh.ni; i++) {
        const c = j * mesh.ni + i;
        lines.push([i, j, mesh.xc[c], mesh.yc[c], mesh.area[c], ...names.map((f) => sn.fields[f][c])].join(','));
      }
    download('aerothermo-fields.csv', lines.join('\n') + '\n', 'text/csv');
  };

  const exportRun = () => {
    const { snap: sn, run } = store.state;
    if (!sn) return;
    download('aerothermo-run.json', JSON.stringify({ generator: 'AeroThermo Lab', config: run, diagnostics: sn.diag }, null, 2), 'application/json');
  };

  return (
    <div className="experiments" data-testid="experiments">
      <div className="atl-card">
        <h3>Scenarios</h3>
        <p className="atl-hint">Load a scenario into the controls. &quot;Load &amp; run&quot; also restarts the solver with it.</p>
        <div className="scenario-list">
          {SCENARIOS.map((sc) => (
            <div key={sc.id} className="scenario" data-testid={`scenario-${sc.id}`}>
              <div>
                <strong>{sc.title}</strong>
                <div className="atl-hint">{sc.description}</div>
              </div>
              <div className="scenario-buttons">
                <button disabled={busy} onClick={() => loadScenario(sc.apply, false)}>
                  Load
                </button>
                <button disabled={busy} data-testid={`run-scenario-${sc.id}`} onClick={() => loadScenario(sc.apply, true)}>
                  Load &amp; run
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="atl-card">
        <h3>Experiments</h3>
        <p className="atl-hint">
          Each experiment runs its cases one after another from the default settings (only the named parameter changes) and adds one row per case to the table below.
          Cases that differ only in the heat shield reuse the same converged flow.
        </p>
        {ex && (
          <div className="banner info small" data-testid="experiment-progress">
            Running “{ex.title}”: case {ex.index + 1} of {ex.queue.length} ({ex.queue[ex.index]?.name}) · step {snap?.diag.steps ?? 0}
            {snap?.diag.mode === 'steady' ? ` · residual drop ${snap.diag.drop.toFixed(2)}` : ''}{' '}
            <button className="quiet" onClick={() => store.cancelExperiment()}>
              Cancel
            </button>
          </div>
        )}
        {EXPERIMENTS.map((e) => (
          <details key={e.id} className="experiment" data-testid={`experiment-${e.id}`}>
            <summary>{e.title}</summary>
            <p>
              <strong>Question.</strong> {e.question}
            </p>
            <p>
              <strong>Cases.</strong> {e.items.map((i) => i.name).join(' · ')}
            </p>
            <p className="atl-hint">
              <strong>What to look for.</strong> {e.lookFor}
            </p>
            <button className="primary" disabled={busy || running} data-testid={`run-experiment-${e.id}`} onClick={() => store.runExperiment(e)}>
              Run experiment
            </button>
          </details>
        ))}
      </div>

      <div className="atl-card">
        <h3>Comparison table</h3>
        <div className="runbar-row">
          <button disabled={!snap || snap.diag.steps === 0 || busy} data-testid="btn-record" onClick={() => store.record()}>
            Add current result
          </button>
          <button disabled={!rows.length} data-testid="btn-export-csv" onClick={() => download('aerothermo-comparison.csv', rowsToCsv(rows), 'text/csv')}>
            Export CSV
          </button>
          <button disabled={!rows.length} data-testid="btn-export-json" onClick={() => download('aerothermo-comparison.json', rowsToJson(rows, { exported: new Date().toISOString() }), 'application/json')}>
            Export JSON
          </button>
          <button className="quiet" disabled={!rows.length || busy} onClick={() => store.clearRows()}>
            Clear
          </button>
        </div>
        {rows.length ? (
          <div className="table-scroll">
            <table className="data compare" data-testid="comparison-table">
              <thead>
                <tr>
                  <th />
                  {ROW_COLUMNS.map((c) => (
                    <th key={c.key}>
                      {c.label}
                      {c.unit && c.unit !== '-' ? <span className="unit"> [{c.unit}]</span> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <button className="quiet tiny" aria-label={`Remove ${r.name}`} onClick={() => store.removeRow(r.id)}>
                        ×
                      </button>
                    </td>
                    {ROW_COLUMNS.map((c) => (
                      <td key={c.key} className={typeof r[c.key] === 'number' ? 'num' : ''}>
                        {c.key === 'status' && r.status !== 'converged' && r.status !== 'finished' ? <span className="tag warn">{r.status}</span> : cell(r[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="panel-empty">No rows yet. Run an experiment, or add the current result.</div>
        )}
        <p className="atl-hint">
          Reference columns: p_stag / pitot compares with analytic theory (Rayleigh pitot formula; isentropic below M = 1); Billig is an empirical correlation for
          cylinders. They are consistency checks of the model, not a validation against experiments. Rows whose status is not “converged” are flagged.
        </p>
      </div>

      <div className="atl-card">
        <h3>Export the current run</h3>
        <div className="runbar-row">
          <button disabled={!snap} data-testid="btn-export-surface" onClick={exportSurface}>
            Surface data (CSV)
          </button>
          <button disabled={!snap} data-testid="btn-export-fields" onClick={exportFields}>
            All cell fields (CSV)
          </button>
          <button disabled={!snap} data-testid="btn-export-run" onClick={exportRun}>
            Configuration + diagnostics (JSON)
          </button>
        </div>
      </div>
    </div>
  );
}
