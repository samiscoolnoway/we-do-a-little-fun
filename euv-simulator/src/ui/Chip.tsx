import { useEffect, useState, type ReactNode } from 'react';
import { CHIP_INFO, CHIP_LAYERS, CHIP_LEVELS, CHIP_MATS, DIE, DIES, DIELECTRIC_LAYER, FLOORPLAN, TRANSISTORS, WAFER, dieName, type ChipInfo, type ChipMat } from '../data/chip';
import type { ChipLevel, ChipState, ChipView, InspectPreset } from '../data/types';
import { CHIP_ORDER, sim, useSim } from '../store/sim';
import { TypedLevels } from './Explore';

// ═══════════════════════════ what the card shows for the current selection ═══════════════════════════
interface Resolved extends ChipInfo {
  key: string;
}

function resolve(c: ChipState): Resolved {
  const sel = c.sel ?? 'wafer';
  if (sel.startsWith('layer:')) {
    const id = sel.slice(6);
    const l = CHIP_LAYERS.find((x) => x.id === id) ?? (id === 'diel' ? { ...DIELECTRIC_LAYER } : null);
    const base = CHIP_INFO[l?.info ?? 'ild'];
    return { ...base, key: sel, name: l?.name ?? base.name, category: 'Layer stack' };
  }
  const base = CHIP_INFO[sel] ?? CHIP_INFO.wafer;
  if ((sel === 'die' || sel === 'die-edge') && c.die !== null) {
    const d = DIES[c.die];
    return { ...base, key: `${sel}:${c.die}`, name: `${sel === 'die' ? 'Die' : 'Partial edge die'} ${dieName(d)}`, category: d.full ? `Wafer › die · ${DIE.w} × ${DIE.h} mm (example)` : 'Wafer › edge die (not usable)' };
  }
  if ((sel === 'nfet' || sel === 'pfet') && c.device) {
    const t = TRANSISTORS.find((x) => x.id === c.device);
    if (t) return { ...base, key: `${sel}:${t.id}`, name: t.name, category: `NAND2 cell › transistor · ${t.role}` };
  }
  if (sel.startsWith('fp-') && c.region && c.region !== 'io') {
    const r = FLOORPLAN.find((f) => f.id === c.region);
    if (r) return { ...base, key: `${sel}:${r.id}`, name: r.name, category: `${base.category} · ${(r.x1 - r.x0).toFixed(1)} × ${(r.y1 - r.y0).toFixed(1)} mm` };
  }
  return { ...base, key: `${sel}:${c.selBox ?? ''}` };
}

/** breadcrumb: Machine › Finished wafer › Die › Region › Cell › Transistor */
function crumbs(c: ChipState): { label: string; go: () => void; here: boolean }[] {
  const out: { label: string; go: () => void; here: boolean }[] = [{ label: 'Machine', go: () => sim.exitChip(), here: false }];
  const k = CHIP_ORDER.indexOf(c.level);
  out.push({ label: 'Finished wafer', go: () => sim.chipGo('wafer'), here: k === 0 });
  if (k >= 1 && c.die !== null) out.push({ label: `Die ${dieName(DIES[c.die])}`, go: () => sim.chipGo('die'), here: k === 1 });
  if (k >= 2) {
    const r = FLOORPLAN.find((f) => f.id === c.region);
    out.push({ label: r ? `${r.kind === 'sram' ? 'SRAM' : 'Logic'} region` : 'Circuit region', go: () => sim.chipGo('block'), here: k === 2 });
  }
  if (k >= 3) out.push({ label: 'NAND2 cell', go: () => sim.chipGo('cell'), here: k === 3 });
  if (k >= 4) out.push({ label: TRANSISTORS.find((t) => t.id === c.device)?.name ?? 'Transistor', go: () => {}, here: true });
  return out;
}

/** the "zoom in" step offered for the current selection */
function diveAction(c: ChipState): { label: string; ok: boolean; why?: string } | null {
  if (c.level === 'wafer') {
    if (c.die === null) return null;
    return DIES[c.die].full ? { label: 'Zoom into this die', ok: true } : { label: 'Zoom into this die', ok: false, why: 'Edge dies are cut by the wafer edge and cannot work; pick a complete die.' };
  }
  if (c.level === 'die') {
    const r = FLOORPLAN.find((f) => f.id === c.region);
    if (!r) return { label: 'Zoom into a region', ok: false, why: 'Click a logic or memory block of the die first.' };
    if (r.kind === 'logic' || r.kind === 'sram') return { label: `Zoom into the ${r.kind === 'sram' ? 'memory array' : 'logic'}`, ok: true };
    return { label: 'Zoom in', ok: false, why: 'Analog and I/O blocks are not modelled at transistor level here.' };
  }
  if (c.level === 'block') return c.sel === 'std-cell' || c.sel === 'blk-cells' ? { label: 'Show the transistor layout', ok: true } : { label: 'Show the transistor layout', ok: false, why: 'Click a logic cell first.' };
  if (c.level === 'cell') return c.device ? { label: 'Isolate this transistor', ok: true } : { label: 'Isolate a transistor', ok: false, why: 'Pick one of the four transistors below.' };
  return null;
}

const BLOCK_PARTS: [string, string][] = [
  ['blk-cells', 'Standard-cell rows'],
  ['blk-sram', 'SRAM array'],
  ['blk-signal', 'Signal routing'],
  ['blk-power', 'Power grid'],
  ['blk-clock', 'Clock tree'],
];

const DEVICE_PARTS: [string, string][] = [
  ['gate', 'Gate'],
  ['hk', 'Gate dielectric'],
  ['sheet', 'Nanosheets'],
  ['sd-n', 'n source/drain'],
  ['sd-p', 'p source/drain'],
  ['spacer', 'Spacers'],
  ['cap', 'Gate cap'],
  ['tcn', 'Contact'],
  ['mesa', 'Active region'],
  ['sti', 'Isolation'],
  ['well-p', 'p-well'],
  ['well-n', 'n-well'],
];
const CELL_PARTS: [string, string][] = [...DEVICE_PARTS.filter(([id]) => id !== 'mesa'), ['gcn', 'Gate contact'], ['dummy', 'Dummy gate'], ['v0', 'Vias'], ['m0', 'M0'], ['rail', 'Power rails'], ['m1', 'M1'], ['m2', 'M2'], ['m3', 'M3'], ['top', 'Upper metal'], ['ild', 'Dielectric'], ['substrate', 'Substrate']];

// ═══════════════════════════ entry points ═══════════════════════════
export function FinishedWaferButton({ compact }: { compact?: boolean }) {
  return (
    <button type="button" className={`btn btn-wafer${compact ? ' btn-sm' : ''}`} onClick={() => sim.openChip()} data-testid="btn-finished-wafer">
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M7 8h4v3H7zM13 8h4v3h-4zM7 13h4v3H7zM13 13h4v3h-4z" fill="currentColor" opacity="0.7" />
      </svg>
      Inspect finished wafer
    </button>
  );
}

// ═══════════════════════════ zoom path (where you are, at every scale) ═══════════════════════════
function ZoomPath({ c }: { c: ChipState }) {
  const k = CHIP_ORDER.indexOf(c.level);
  const die = c.die !== null ? DIES[c.die] : null;
  const R = WAFER.diameter / 2;
  const reg = FLOORPLAN.find((f) => f.id === c.region);
  const panels: { level: ChipLevel; title: string; body: ReactNode; ok: boolean }[] = [
    {
      level: 'wafer',
      title: '300 mm wafer',
      ok: true,
      body: (
        <>
          <circle cx="24" cy="20" r="17" className="zp-wafer" />
          {die && <rect x={24 + (die.x / R) * 17 - 1.4} y={20 - (die.y / R) * 17 - 1.2} width="2.8" height="2.4" className="zp-hot" />}
        </>
      ),
    },
    {
      level: 'die',
      title: `die ${DIE.w}×${DIE.h} mm`,
      ok: !!die?.full,
      body: (
        <>
          <rect x="6" y="5" width="36" height="30" className="zp-die" />
          {FLOORPLAN.map((f) => (
            <rect key={f.id} x={6 + (f.x0 / DIE.w) * 36} y={5 + ((DIE.h - f.y1) / DIE.h) * 30} width={((f.x1 - f.x0) / DIE.w) * 36} height={((f.y1 - f.y0) / DIE.h) * 30} className={f.id === c.region && k >= 1 ? 'zp-hot' : `zp-${f.kind}`} />
          ))}
        </>
      ),
    },
    {
      level: 'block',
      title: 'region 4×2.6 µm',
      ok: !!reg && (reg.kind === 'logic' || reg.kind === 'sram') && k >= 2,
      body: (
        <>
          <rect x="4" y="7" width="40" height="26" className="zp-die" />
          {Array.from({ length: 8 }, (_, i) => (
            <rect key={i} x="5" y={8 + i * 3.1} width="24" height="2.2" className={`zp-logic${reg?.kind === 'logic' && k >= 2 ? ' zp-on' : ''}`} />
          ))}
          <rect x="31" y="8" width="12" height="24" className={`zp-sram${reg?.kind === 'sram' && k >= 2 ? ' zp-on' : ''}`} />
          {k >= 3 && <rect x="14" y="17.3" width="3.5" height="2.2" className="zp-hot" />}
        </>
      ),
    },
    {
      level: 'cell',
      title: 'NAND2 cell 0.14 µm',
      ok: k >= 3,
      body: (
        <>
          <rect x="10" y="5" width="28" height="30" className="zp-die" />
          {[17, 31].map((x) => (
            <rect key={x} x={x - 1} y="7" width="2" height="26" className="zp-gate" />
          ))}
          <rect x="11" y="10" width="26" height="6" className="zp-sram" />
          <rect x="11" y="24" width="26" height="6" className="zp-logic" />
          {k >= 4 && c.device && <rect x={(c.device.endsWith('A') ? 17 : 31) - 4} y={c.device.startsWith('p') ? 9 : 23} width="8" height="8" className="zp-hot" />}
        </>
      ),
    },
  ];
  return (
    <div className="zoompath" aria-label="Where you are, from the wafer down" data-testid="zoompath">
      {panels.map((p, i) => (
        <button key={p.level} type="button" className={`zp${i === k || (k === 4 && i === 3) ? ' here' : ''}`} disabled={!p.ok || i > k} onClick={() => sim.chipGo(p.level)} title={p.title}>
          <svg viewBox="0 0 48 40" aria-hidden="true">
            {p.body}
          </svg>
          <small>{p.title}</small>
        </button>
      ))}
    </div>
  );
}

// ═══════════════════════════ info card ═══════════════════════════
export function ChipCard() {
  const c = useSim((s) => s.chip);
  if (!c) return null;
  const info = resolve(c);
  const lvl = CHIP_LEVELS.find((l) => l.id === c.level)!;
  const dive = diveAction(c);
  return (
    <section className="stage-card insp-card chip-card" aria-label={`Chip explorer: ${info.name}`} data-testid="chip-card" data-level={c.level} data-sel={c.sel ?? ''}>
      <nav className="crumbs" aria-label="Scale path" data-testid="chip-crumbs">
        {crumbs(c).map((x, i) => (
          <span key={i} className="crumb-wrap">
            {i > 0 && <span aria-hidden="true">›</span>}
            {x.here ? (
              <span className="crumb here" aria-current="page">
                {x.label}
              </span>
            ) : (
              <button type="button" className="crumb" onClick={x.go}>
                {x.label}
              </button>
            )}
          </span>
        ))}
      </nav>
      <ZoomPath c={c} />
      <div className={`scale-badge ${lvl.scale}`} data-testid="scale-badge">
        <b>{lvl.scale === 'physical' ? 'Physical scale' : 'Enlarged educational model'}</b> {lvl.note}
      </div>
      <h1 className="stage-title insp-name" data-testid="chip-name">
        {info.name}
      </h1>
      <div className="insp-head">
        <span className="pill">{info.category}</span>
      </div>
      <div className="chip-actions">
        {dive && (
          <button type="button" className="btn btn-sm" disabled={!dive.ok} title={dive.why} onClick={() => sim.chipDive()} data-testid="chip-dive">
            {dive.label} ›
          </button>
        )}
        {c.level === 'block' && c.sel?.startsWith('blk-') && (
          <button type="button" className="btn btn-sm btn-ghost" aria-pressed={c.iso} onClick={() => sim.chipSet({ iso: !c.iso })} data-testid="chip-iso">
            {c.iso ? 'Show everything' : 'Show only this'}
          </button>
        )}
        {(c.level === 'cell' || c.level === 'transistor') && c.sel && !['nand2', 'nfet', 'pfet'].includes(c.sel) && (
          <button type="button" className="btn btn-sm btn-ghost" aria-pressed={c.iso} onClick={() => sim.chipSet({ iso: !c.iso })} data-testid="chip-iso">
            {c.iso ? 'Show everything' : 'Show only this'}
          </button>
        )}
      </div>
      {dive && !dive.ok && dive.why && <p className="insp-note">{dive.why}</p>}
      {c.level === 'block' && (
        <div className="insp-children" aria-label="Structures of the circuit region" data-testid="chip-structures">
          {BLOCK_PARTS.map(([id, label]) => (
            <button key={id} type="button" className={`chip-link${c.sel === id ? ' on' : ''}`} onClick={() => sim.chipSelect({ sel: id })} data-sel={id}>
              {label}
            </button>
          ))}
        </div>
      )}
      {c.level === 'cell' && (
        <div className="insp-children" aria-label="Transistors of the cell" data-testid="chip-transistors">
          {TRANSISTORS.map((t) => (
            <button key={t.id} type="button" className={`chip-link${c.device === t.id ? ' on' : ''}`} onClick={() => sim.chipSelect({ sel: t.info, device: t.id })} data-device={t.id}>
              {t.name}
            </button>
          ))}
        </div>
      )}
      {(c.level === 'cell' || c.level === 'transistor') && (
        <div className="insp-children parts" aria-label="Parts (select even when hidden behind others)" data-testid="chip-parts">
          {(c.level === 'cell' ? CELL_PARTS : DEVICE_PARTS.filter(([id]) => (c.device?.startsWith('n') ? id !== 'sd-p' && id !== 'well-n' : id !== 'sd-n' && id !== 'well-p'))).map(([id, label]) => (
            <button key={id} type="button" className={`chip-link${c.sel === id ? ' on' : ''}`} onClick={() => sim.chipSelect({ sel: id, device: c.level === 'transistor' ? (c.device ?? undefined) : undefined })} data-sel={id}>
              {label}
            </button>
          ))}
        </div>
      )}
      {c.level === 'transistor' && <OnOff c={c} />}
      <TypedLevels key={info.key} info={{ levels: { overview: info.overview, engineering: info.engineering, deep: info.deep } }} />
    </section>
  );
}

function OnOff({ c }: { c: ChipState }) {
  const t = TRANSISTORS.find((x) => x.id === c.device);
  if (!t) return null;
  const vg = t.type === 'n' ? (c.on ? 'V_G = V_DD' : 'V_G = 0 V') : c.on ? 'V_G = 0 V' : 'V_G = V_DD';
  return (
    <div className="onoff" data-testid="chip-onoff">
      <div className="seg" role="radiogroup" aria-label="Illustrative transistor state">
        <button type="button" role="radio" aria-checked={!c.on} onClick={() => sim.chipSet({ on: false })} data-value="off">
          OFF
        </button>
        <button type="button" role="radio" aria-checked={c.on} onClick={() => sim.chipSet({ on: true })} data-value="on">
          ON
        </button>
      </div>
      <p>
        <b>{vg}.</b>{' '}
        {c.on
          ? t.type === 'n'
            ? 'The gate attracts electrons to the sheet surfaces: a conducting channel forms and electrons flow from source to drain.'
            : 'With the gate low, holes accumulate in the sheets and carry current from source to drain.'
          : 'No conducting channel: only a tiny leakage current flows.'}{' '}
        <em>Illustration only: the moving dots are not a device simulation and no current is calculated.</em>
      </p>
    </div>
  );
}

// ═══════════════════════════ toolbar ═══════════════════════════
const PRESETS: { id: InspectPreset; label: string }[] = [
  { id: 'front', label: 'Front' },
  { id: 'side', label: 'Side' },
  { id: 'top', label: 'Top' },
  { id: 'iso', label: 'Iso' },
];
const VIEWS: { id: ChipView; label: string; title: string }[] = [
  { id: 'top', label: 'Whole', title: 'The structure without a cut (use Top for the layout seen from above)' },
  { id: 'channel', label: 'Cut along channel', title: 'Cross-section along the nanosheet channels' },
  { id: 'gate', label: 'Cut across gate', title: 'Cross-section through a gate, across the sheets' },
];

function ScaleBar() {
  const [s, setS] = useState<{ field: string; bar: string; barPx: number; mag: number; physical: boolean } | null>(null);
  useEffect(() => {
    const on = (e: Event) => setS((e as CustomEvent).detail);
    window.addEventListener('euv-chip-scale', on);
    return () => window.removeEventListener('euv-chip-scale', on);
  }, []);
  if (!s) return null;
  const mag = s.mag < 1 ? s.mag.toFixed(2) : s.mag >= 1e6 ? `${(s.mag / 1e6).toFixed(s.mag >= 1e7 ? 0 : 1)} million` : s.mag >= 1e3 ? `${Math.round(s.mag / 1e3)},000` : `${Math.max(1, Math.round(s.mag))}`;
  return (
    <div className={`scalebar ${s.physical ? 'physical' : 'model'}`} data-testid="chip-scale">
      <span className="bar" style={{ width: `${Math.max(12, Math.min(220, s.barPx))}px` }} />
      <span>{s.bar}</span>
      <span className="sep">·</span>
      <span>
        view ≈ {s.field} wide · about ×{mag} on screen
      </span>
    </div>
  );
}

export function ChipToolbar() {
  const c = useSim((s) => s.chip);
  const spin = useSim((s) => s.spin);
  const preset = useSim((s) => s.camPreset);
  const [layers, setLayers] = useState(false);
  if (!c) return null;
  const micro = c.level === 'block' || c.level === 'cell' || c.level === 'transistor';
  const spins = c.level === 'wafer' || c.level === 'transistor';
  return (
    <div className="insp-bar chip-bar" data-testid="chip-bar">
      <ScaleBar />
      <p className="insp-help" data-testid="chip-help">
        {spins && <span className="help-state">{spin ? 'Turning slowly. ' : 'Rotation paused. '}</span>}
        <span className="help-mouse">Click to select · double-click or scroll past the zoom limit to go a scale deeper · drag to rotate · right-drag to pan.</span>
        <span className="help-touch">Tap to select · drag to rotate · pinch to zoom · use the zoom button to go deeper.</span>
      </p>
      {layers && micro && <LayerPanel c={c} onClose={() => setLayers(false)} />}
      <div className="insp-tools" role="toolbar" aria-label="Chip explorer controls">
        <button type="button" className="btn btn-sm" onClick={() => sim.chipUp()} data-testid="chip-up" title="One scale up (Esc)">
          ‹ {c.level === 'wafer' ? 'Machine' : 'Up a scale'}
        </button>
        {c.level !== 'wafer' && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => sim.chipGo('wafer')} data-testid="chip-wafer">
            Whole wafer
          </button>
        )}
        <span className="tool-sep" />
        {spins && (
          <button type="button" className="btn btn-sm" aria-pressed={!spin} onClick={() => sim.setSpin(!spin)} data-testid="chip-spin">
            {spin ? 'Pause rotation' : 'Resume rotation'}
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={() => sim.chipReset()} data-testid="chip-reset">
          Reset view
        </button>
        <div className="seg" role="radiogroup" aria-label="Camera angle" data-testid="chip-presets">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={preset === p.id} data-value={p.id} onClick={() => sim.setCamPreset(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        {(c.level === 'cell' || c.level === 'transistor') && (
          <>
            <span className="tool-sep" />
            <div className="seg" role="radiogroup" aria-label="Section" data-testid="chip-views">
              {VIEWS.map((v) => (
                <button key={v.id} type="button" role="radio" aria-checked={c.view === v.id} title={v.title} data-value={v.id} onClick={() => sim.chipSet({ view: v.id })}>
                  {v.label}
                </button>
              ))}
            </div>
          </>
        )}
        {micro && (
          <>
            <label className="explode" title="Separate the layers vertically">
              Explode
              <input type="range" min={0} max={1} step={0.05} value={c.explode} onChange={(e) => sim.chipSet({ explode: parseFloat(e.target.value) })} aria-label="Explode layers" data-testid="chip-explode" />
            </label>
            <button type="button" className="btn btn-sm btn-ghost" aria-expanded={layers} onClick={() => setLayers(!layers)} data-testid="chip-layers-btn">
              Layers
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** which layers the current model has */
function layersFor(level: ChipLevel) {
  if (level === 'block') return CHIP_LAYERS.filter((l) => l.id !== 'pass');
  return CHIP_LAYERS;
}

function LayerPanel({ c, onClose }: { c: ChipState; onClose: () => void }) {
  const list = [...layersFor(c.level)].reverse();
  const mats = new Set<ChipMat>();
  for (const l of list) l.mats.forEach((m) => mats.add(m));
  mats.add('dielectric');
  return (
    <div className="layer-panel" data-testid="chip-layers" role="dialog" aria-label="Layer stack">
      <div className="lp-head">
        <b>Layer stack</b>
        <button type="button" className="icon-btn" aria-label="Close layers" onClick={onClose}>
          ✕
        </button>
      </div>
      <ul>
        {[...list, { id: DIELECTRIC_LAYER.id, name: DIELECTRIC_LAYER.name, mats: ['dielectric'] as ChipMat[] }].map((l) => (
          <li key={l.id} className={c.sel === `layer:${l.id}` ? 'on' : ''}>
            <input type="checkbox" checked={!c.hidden.includes(l.id)} onChange={() => sim.chipToggleLayer(l.id)} aria-label={`Show ${l.name}`} data-layer={l.id} />
            <span className="sw">
              {l.mats.slice(0, 4).map((m) => (
                <i key={m} style={{ background: CHIP_MATS[m].color }} />
              ))}
            </span>
            <button type="button" className="lp-name" onClick={() => sim.chipSelect({ sel: `layer:${l.id}` })} data-select-layer={l.id}>
              {l.name}
            </button>
          </li>
        ))}
      </ul>
      <div className="legend" data-testid="chip-legend">
        {[...mats].map((m) => (
          <span key={m} className="lg">
            <i style={{ background: CHIP_MATS[m].color, opacity: CHIP_MATS[m].clear ? 0.55 : 1 }} />
            <b>{CHIP_MATS[m].name}</b> {CHIP_MATS[m].material}
          </span>
        ))}
      </div>
      <p className="lp-note">Real chips have more layers (often 12–20 metal levels) and their structure varies with the process technology and the design. This model shows a representative stack.</p>
    </div>
  );
}
