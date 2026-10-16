import { useEffect, useState } from 'react';
import { COMPONENTS } from '../data/components';
import { STAGES } from '../data/stages';
import { sim, useSim } from '../store/sim';
import { ZONE_COLOR } from './controls';
import { IconChevron, IconFlask, IconPanel, Logo } from './icons';
import { InspectToolbar } from './Explore';
import { ChipToolbar, FinishedWaferButton } from './Chip';

export function TopBar() {
  const stage = useSim((s) => s.stage);
  const deep = useSim((s) => s.deep);
  const open = useSim((s) => s.panelOpen);
  const closed = useSim((s) => s.casing === 'closed');
  const inspect = useSim((s) => s.inspect);
  const chip = useSim((s) => !!s.chip);
  const st = STAGES[stage];
  const badge = chip ? 'Finished wafer · chip explorer' : inspect ? 'Isolated inspection' : closed ? 'Machine exterior' : st.inScanner ? 'Inside the EUV scanner' : st.zone === 'etch' ? 'Outside the scanner · etch tool' : 'Outside the scanner · track';
  return (
    <header className="topbar" data-testid="topbar">
      <div className="brand">
        <Logo />
        <div className="brand-name">
          EUV Lithography Simulator
          <span className="brand-sub">Educational model of a scanner and the wafer steps after it</span>
        </div>
      </div>
      <span className={`zone-badge${st.inScanner ? '' : ' out'}`} style={{ ['--zc' as string]: ZONE_COLOR[st.zone] }} data-testid="zone-badge">
        <i />
        {badge}
      </span>
      <div className="top-spacer" />
      <button type="button" className="btn btn-deep" aria-pressed={deep} aria-label="Deep Science" onClick={() => sim.toggleDeep()} title="Reveal advanced explanations (D)" data-testid="btn-deep">
        <IconFlask size={16} /> <span className="btn-label">Deep Science</span>
      </button>
      <button type="button" className="btn" aria-pressed={open} aria-label="Science panel" onClick={() => sim.togglePanel()} title="Science panel" data-testid="btn-panel">
        <IconPanel size={16} /> <span className="btn-label">Science</span>
      </button>
    </header>
  );
}

function useMedia(q: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    on();
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

export function StageCard() {
  const stage = useSim((s) => s.stage);
  const tone = useSim((s) => s.tone);
  const panelOpen = useSim((s) => s.panelOpen);
  const mobile = useMedia('(max-width: 900px)');
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(null);
  const [more, setMore] = useState(false);
  const collapsed = userCollapsed ?? (panelOpen || mobile);
  const st = STAGES[stage];
  const sentences = st.caption.split(/(?<=\.)\s+/);
  const lead = sentences[0];
  const rest = sentences.slice(1).join(' ');
  return (
    <section className={`stage-card${collapsed ? ' collapsed' : ''}`} style={{ ['--zc' as string]: ZONE_COLOR[st.zone] }} aria-label="Current stage" data-testid="stage-card">
      <div className="stage-eyebrow">
        <i />
        <span>
          Stage {st.n} of {STAGES.length} · {st.inScanner ? 'inside scanner' : 'outside scanner'}
        </span>
        <span className="grow" />
        <button type="button" className="icon-btn" aria-expanded={!collapsed} aria-label={collapsed ? 'Show stage description' : 'Hide stage description'} onClick={() => setUserCollapsed(!collapsed)} style={{ width: 24, height: 24 }} data-testid="card-toggle">
          <IconChevron size={16} up={!collapsed} />
        </button>
      </div>
      <h1 className="stage-title" data-testid="stage-title">
        {st.title}
      </h1>
      <p className="stage-lead">{lead}</p>
      {more && rest && <p className="stage-more">{rest}</p>}
      {rest && (
        <button type="button" className="link-btn" onClick={() => setMore(!more)} aria-expanded={more}>
          {more ? 'Show less' : 'Read more'}
        </button>
      )}
      <p className="stage-watch">
        <b>Watch</b>
        {st.watch}
      </p>
      {stage >= 8 && (
        <p className="stage-watch" style={{ marginTop: 6, paddingTop: 6 }}>
          <b>Colour</b>
          {tone === 'negative' ? 'dark = cross-linked, stays after development' : tone === 'compare' ? 'left positive: pale = soluble · right negative: dark = hardened' : 'pale = soluble, dissolves in the developer'}
        </p>
      )}
      {stage === STAGES.length - 1 && (
        <div className="finish-row">
          <FinishedWaferButton />
          <span>The wafer is finished: zoom from the whole wafer down to a single transistor.</span>
        </div>
      )}
      <div className="stage-where" aria-label="Inspect parts of this stage">
        {st.focus
          .filter((id) => COMPONENTS[id])
          .map((id) => (
            <button key={id} type="button" className="chip-link" onClick={() => sim.select(id)} data-comp={id}>
              {COMPONENTS[id].name}
            </button>
          ))}
      </div>
    </section>
  );
}

const KEY_ITEMS: [string, string][] = [
  ['var(--c-laser)', 'CO₂ laser'],
  ['var(--c-plasma)', 'Plasma / acid'],
  ['var(--c-euv)', 'EUV 13.5 nm'],
  ['var(--c-mask)', 'Mask'],
  ['var(--c-resist)', 'Resist'],
  ['var(--c-track)', 'Track'],
  ['var(--c-etch)', 'Etch'],
];

export function ViewportFoot() {
  const inspect = useSim((s) => s.inspect);
  const chip = useSim((s) => !!s.chip);
  return (
    <div className="viewport-foot">
      {chip ? <ChipToolbar /> : <InspectToolbar />}
      <div className="keys" aria-label="Colour key" hidden={!!inspect || chip}>
        {KEY_ITEMS.map(([c, n]) => (
          <span className="key" key={n} style={{ ['--k' as string]: c }}>
            <i />
            {n}
          </span>
        ))}
      </div>
      <p className="viewport-note" style={{ margin: 0 }} data-testid="viz-note">
        <b>EUV and the CO₂ laser are invisible to the eye;</b> colours are a visualization aid. Educational model, not to scale.
      </p>
    </div>
  );
}

export function Hint() {
  const visible = useSim((s) => s.hintVisible);
  const closed = useSim((s) => s.casing === 'closed');
  const chip = useSim((s) => !!s.chip);
  useEffect(() => {
    const t = window.setTimeout(() => sim.dismissHint(), 14000);
    return () => window.clearTimeout(t);
  }, []);
  if (!visible || chip) return null;
  return (
    <div className="hint" role="note" data-testid="hint">
      <span className="hint-long">{closed ? 'Click a cabinet to explore what is inside · drag to orbit · scroll to zoom' : 'Drag to orbit · scroll to zoom · click any part or floating label to inspect it'}</span>
      <span className="hint-short">{closed ? 'Tap a cabinet to explore it · drag to orbit' : 'Drag to orbit · pinch to zoom · tap to inspect'}</span>
    </div>
  );
}

export function Fallback() {
  return (
    <div className="fallback" role="alert" data-testid="webgl-fallback">
      <div>
        <h2>3D view unavailable</h2>
        <p>This browser could not start WebGL, so the 3D machine cannot be drawn. The timeline, the stage descriptions, the inspector, the concepts and the quiz still work: use the stage buttons below and the Science panel.</p>
      </div>
    </div>
  );
}

export function Announcer() {
  const stage = useSim((s) => s.stage);
  return (
    <div className="sr-only" aria-live="polite" role="status">
      Stage {stage + 1} of {STAGES.length}: {STAGES[stage].title}
    </div>
  );
}
