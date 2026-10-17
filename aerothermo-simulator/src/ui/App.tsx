import { useState } from 'react';
import { FIELD_INFO, type FieldName } from '../core/simulation';
import { FlowControls, RunBar } from './Controls';
import { FlowView } from './FlowView';
import { store, useStore } from './store';
import { ProbePanel, Workbench } from './Workbench';
import { Toggle } from './widgets';

type Tab = 'workbench' | 'probe';
const TABS: { id: Tab; label: string }[] = [
  { id: 'workbench', label: 'Workbench' },
  { id: 'probe', label: 'Probe' },
];

export function App() {
  const [tab, setTab] = useState<Tab>('workbench');
  const probe = useStore((s) => s.probe);
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true" />
          <div>
            <h1>AeroThermo Lab</h1>
            <p>Compressible flow around a blunt body · surface heating · heat-shield conduction</p>
          </div>
        </div>
        <div className="model-tags" aria-label="Model summary">
          <span>2D planar</span>
          <span>Inviscid Euler (no viscosity in the flow solver)</span>
          <span>Calorically perfect air, γ = 1.4</span>
        </div>
      </header>
      <aside className="left">
        <RunBar />
        <FlowControls />
      </aside>
      <main className="center">
        <ViewToolbar />
        <FlowView />
      </main>
      <aside className="right">
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} data-testid={`tab-${t.id}`} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === 'probe' && probe ? ' •' : ''}
            </button>
          ))}
        </nav>
        <div className="tab-body">{tab === 'workbench' ? <Workbench /> : <ProbePanel />}</div>
      </aside>
    </div>
  );
}

function ViewToolbar() {
  const view = useStore((s) => s.view);
  return (
    <div className="viewbar" data-testid="viewbar">
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
