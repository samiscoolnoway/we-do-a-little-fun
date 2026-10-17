import { useEffect, useState } from 'react';
import { FIELD_INFO, type FieldName } from '../core/simulation';
import FlowWorker from '../worker/flow.worker.ts?worker&inline';
import { About } from './About';
import { FlowControls, RunBar, STATUS_TEXT, ThermalControls } from './Controls';
import { ExperimentsPanel } from './ExperimentsPanel';
import { FlowView } from './FlowView';
import { HeatingPanel } from './HeatingPanel';
import { LearnPanel } from './LearnPanel';
import { store, useStore } from './store';
import { ThermalPanel } from './ThermalPanel';
import { ProbePanel, Workbench } from './Workbench';
import { Toggle } from './widgets';
import './lab.css';

/**
 * Engineering & Computational Science Lab: AeroThermo Lab inside the EUV simulator. The flow solver runs in a Web
 * Worker that is started the first time the lab is opened and kept (with its results) while the user visits the
 * other sections. The worker is inlined into the bundle so the single-file builds keep working.
 */
type Tab = 'about' | 'workbench' | 'probe' | 'heating' | 'thermal' | 'experiments' | 'learn';
const TABS: { id: Tab; label: string }[] = [
  { id: 'about', label: 'About' },
  { id: 'workbench', label: 'Workbench' },
  { id: 'probe', label: 'Probe' },
  { id: 'heating', label: 'Surface heating' },
  { id: 'thermal', label: 'Heat shield' },
  { id: 'experiments', label: 'Experiments' },
  { id: 'learn', label: 'Learn' },
];

let lastTab: Tab = 'about';

declare global {
  interface Window {
    __lab?: { store: typeof store };
  }
}

export function LabApp() {
  const [tab, setTabState] = useState<Tab>(lastTab);
  const setTab = (t: Tab) => {
    lastTab = t;
    setTabState(t);
  };
  const probe = useStore((s) => s.probe);
  useEffect(() => {
    if (!store.booted) store.boot(new FlowWorker());
    window.__lab = { store };
  }, []);
  return (
    <div className="atl" data-testid="lab">
      <div className="atl-shell">
        <header className="lab-intro">
          <div className="lab-title">
            Engineering &amp; Computational Science Lab
            <span>AeroThermo Lab · a separate aerothermodynamics experiment: compressible flow around a heat shield, surface heating, heat conduction</span>
          </div>
          <div className="model-tags" aria-label="Model summary">
            <span>2D planar</span>
            <span>Inviscid Euler (no viscosity in the flow solver)</span>
            <span>Calorically perfect air, γ = 1.4</span>
            <button type="button" className="quiet tiny-link" onClick={() => setTab('about')} data-testid="lab-about-link">
              Why is this here?
            </button>
          </div>
        </header>
        <aside className="left">
          <RunBar />
          <FlowControls />
          <ThermalControls />
        </aside>
        <main className="center">
          <ViewToolbar />
          <FlowView />
        </main>
        <aside className="right">
          <nav className="atl-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} data-testid={`tab-${t.id}`} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
                {t.label}
                {t.id === 'probe' && probe ? ' •' : ''}
              </button>
            ))}
          </nav>
          <div className="tab-body">
            {tab === 'about' ? (
              <About />
            ) : tab === 'workbench' ? (
              <Workbench />
            ) : tab === 'probe' ? (
              <ProbePanel />
            ) : tab === 'heating' ? (
              <HeatingPanel />
            ) : tab === 'thermal' ? (
              <ThermalPanel />
            ) : tab === 'experiments' ? (
              <ExperimentsPanel />
            ) : (
              <LearnPanel />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** compact run controls shown above the view on narrow screens (the full run bar is further down there) */
function MobileRun() {
  const running = useStore((s) => s.running);
  const snap = useStore((s) => s.snap);
  const st = snap?.diag.status ?? 'ready';
  const blocked = st === 'failed' || st === 'max-steps';
  return (
    <div className="mobile-only mobile-run">
      {running ? (
        <button className="primary" onClick={() => store.pause()}>
          Pause
        </button>
      ) : (
        <button className="primary" data-testid="m-run" disabled={!snap || blocked} onClick={() => store.runSim()}>
          {snap && snap.diag.steps > 0 ? 'Resume' : 'Run'}
        </button>
      )}
      <button disabled={!snap || running || blocked} onClick={() => store.step(1)}>
        Step
      </button>
      <span className={`status-chip s-${st}`}>{running ? 'Running' : STATUS_TEXT[st]}</span>
    </div>
  );
}

function ViewToolbar() {
  const view = useStore((s) => s.view);
  return (
    <div className="viewbar" data-testid="viewbar">
      <MobileRun />
      <label className="field-select">
        <span>Show</span>
        <select data-testid="sel-field" value={view.field} onChange={(e) => store.setView({ field: e.target.value as FieldName })}>
          {(Object.keys(FIELD_INFO) as FieldName[]).map((f) => (
            <option key={f} value={f}>
              {FIELD_INFO[f].label} [{FIELD_INFO[f].unit}]
            </option>
          ))}
        </select>
      </label>
      <Toggle label="Streamlines" checked={view.streamlines} testid="tg-stream" onChange={(v) => store.setView({ streamlines: v })} />
      <Toggle label="Vectors" checked={view.vectors} testid="tg-vectors" onChange={(v) => store.setView({ vectors: v })} />
      <Toggle label="Mesh" checked={view.mesh} testid="tg-mesh" onChange={(v) => store.setView({ mesh: v })} />
      <Toggle label="Smooth" checked={view.smooth} testid="tg-smooth" onChange={(v) => store.setView({ smooth: v })} />
    </div>
  );
}
