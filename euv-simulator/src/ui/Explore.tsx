import { useEffect, useRef, useState } from 'react';
import { COMPONENTS } from '../data/components';
import { SUBSYSTEMS, SUBSYSTEM_BY_ID, inspectInfo, type InspectInfo } from '../data/hierarchy';
import type { InspectPreset } from '../data/types';
import { sim, useSim } from '../store/sim';

// ═══════════════════════════ helpers ═══════════════════════════
function useReducedMotion() {
  const q = '(prefers-reduced-motion: reduce)';
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}

const nameOf = (id: string) => SUBSYSTEM_BY_ID[id as keyof typeof SUBSYSTEM_BY_ID]?.name ?? COMPONENTS[id]?.name ?? id;

// ═══════════════════════════ exterior card ═══════════════════════════
/** Shown while the machine is closed: what you are looking at, and the two ways in. */
export function ExteriorCard() {
  return (
    <section className="stage-card ext-card" aria-label="Machine exterior" data-testid="exterior-card">
      <div className="stage-eyebrow">
        <i />
        <span>Machine exterior</span>
      </div>
      <h1 className="stage-title">EUV lithography scanner</h1>
      <p className="stage-lead">
        Cabinets for the drive laser, the light source, the illuminator, the mask stage, the projection optics and the wafer stage, with the track and etch tools beside it. Hover a cabinet to see what is inside; click it to explore that part.
      </p>
      <div className="ext-actions">
        <button type="button" className="btn" onClick={() => sim.openCasing()} data-testid="btn-open-machine">
          Open the machine
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => sim.setTab('explore')} data-testid="btn-explore">
          Component explorer
        </button>
      </div>
      <p className="ext-note">Stylised educational model built from public descriptions. It is not ASML CAD data and is not to scale.</p>
    </section>
  );
}

// ═══════════════════════════ typewriter ═══════════════════════════
const LEVELS = [
  { key: 'overview', label: 'Overview' },
  { key: 'engineering', label: 'Engineering' },
  { key: 'deep', label: 'Deep science' },
] as const;
type LevelKey = (typeof LEVELS)[number]['key'];

const CPS = 55; // characters per second while typing
const readPause = (n: number) => Math.min(9000, 2500 + n * 12); // time to finish reading before the next level starts

/**
 * Types the three explanation levels in order. Each level has its own text and its own progress, so switching
 * levels never mixes text, and the whole component is remounted (key = id) when the inspected item changes,
 * which cancels any typing in progress.
 */
function TypedLevels({ info }: { info: InspectInfo }) {
  const reduced = useReducedMotion();
  const texts = LEVELS.map((l) => info.levels[l.key as LevelKey]);
  const [level, setLevel] = useState(0);
  const [typed, setTyped] = useState<number[]>(() => texts.map((t) => (reduced ? t.length : 0)));
  const [paused, setPaused] = useState(false);
  const [manual, setManual] = useState(false);
  const [waitLeft, setWaitLeft] = useState(0); // 0..1 of the reading pause still to go (for the progress bar)
  const body = useRef<HTMLDivElement>(null);

  const full = texts[level];
  const done = typed[level] >= full.length;

  // reduced motion: everything is shown at once
  useEffect(() => {
    if (reduced) setTyped(texts.map((t) => t.length));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  // typing of the current level
  useEffect(() => {
    if (paused || done || reduced) return;
    let raf = 0;
    let last = performance.now();
    let acc = typed[level];
    const step = (now: number) => {
      // a long frame (e.g. shader compilation) must not dump half the text at once: at most a quarter second per step
      acc += (Math.min(now - last, 250) / 1000) * CPS;
      last = now;
      const n = Math.min(full.length, Math.floor(acc));
      setTyped((p) => (p[level] === n ? p : p.map((v, i) => (i === level ? n : v))));
      if (n < full.length) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, paused, done, reduced]);

  // after a level is typed, a reading pause, then the next level (unless the user picked a level themselves)
  useEffect(() => {
    if (!done || paused || manual || reduced || level >= LEVELS.length - 1) {
      setWaitLeft(0);
      return;
    }
    const total = readPause(full.length);
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const left = 1 - (now - t0) / total;
      if (left <= 0) {
        setWaitLeft(0);
        setLevel((l) => Math.min(l + 1, LEVELS.length - 1));
        return;
      }
      setWaitLeft(left);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [done, paused, manual, reduced, level, full.length]);

  // keep the typing point in view
  useEffect(() => {
    const b = body.current;
    if (b && !done) b.scrollTop = b.scrollHeight;
  }, [typed, done]);
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [level]);

  const pick = (i: number) => {
    setManual(true);
    setLevel(i);
  };
  const skip = () => {
    if (!done) setTyped((p) => p.map((v, i) => (i === level ? full.length : v)));
    else if (level < LEVELS.length - 1) setLevel(level + 1);
  };
  const total = texts.reduce((a, t) => a + t.length, 0);
  const progress = typed.reduce((a, n) => a + n, 0) / total;
  const shown = full.slice(0, typed[level]);
  const allDone = typed.every((n, i) => n >= texts[i].length);

  return (
    <div className="tw" data-testid="typewriter" data-level={LEVELS[level].key} data-done={done} data-paused={paused}>
      <div className="tw-tabs" role="tablist" aria-label="Explanation level">
        {LEVELS.map((l, i) => {
          const st = typed[i] >= texts[i].length ? 'done' : typed[i] > 0 ? 'part' : 'todo';
          return (
            <button key={l.key} type="button" role="tab" aria-selected={i === level} className={`tw-tab ${st}`} onClick={() => pick(i)} data-testid={`tw-tab-${l.key}`}>
              <i />
              {l.label}
            </button>
          );
        })}
      </div>
      <div className="tw-body" ref={body}>
        <p className="tw-text" aria-hidden="true" data-testid="tw-text">
          {shown}
          {!done && !reduced && <span className="tw-caret" />}
        </p>
        {/* screen readers get the complete text of the selected level at once */}
        <p className="sr-only">{full}</p>
      </div>
      <div className="tw-foot">
        <div className="tw-progress" role="progressbar" aria-label="Explanation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} data-testid="tw-progress">
          <span style={{ width: `${progress * 100}%` }} />
          {waitLeft > 0 && <em style={{ width: `${(1 - waitLeft) * 100}%` }} />}
        </div>
        <span className="tw-status" aria-live="polite" data-testid="tw-status">
          {waitLeft > 0 ? `Next: ${LEVELS[level + 1].label}` : paused ? 'Paused' : allDone ? 'All levels shown' : ''}
        </span>
        {!reduced && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPaused(!paused)} aria-pressed={paused} disabled={allDone && !paused} data-testid="tw-pause">
            {paused ? 'Resume text' : 'Pause text'}
          </button>
        )}
        <button type="button" className="btn btn-sm btn-ghost" onClick={skip} disabled={done && level === LEVELS.length - 1} data-testid="tw-skip">
          {done ? 'Next level' : 'Skip'}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════ inspection card ═══════════════════════════
/** The information card of the isolated inspection view: name at once, where it sits, and the typed explanation. */
export function InspectCard() {
  const id = useSim((s) => s.inspect);
  const info = id ? inspectInfo(id) : null;
  if (!info) return null;
  const sys = info.parent ? SUBSYSTEM_BY_ID[info.parent] : null;
  const siblings = sys ? sys.children.filter((c) => c !== info.id && COMPONENTS[c]?.kind !== 'zone') : [];
  return (
    <section className="stage-card insp-card" aria-label={`Inspecting ${info.name}`} data-testid="inspect-card" data-inspect={info.id}>
      <nav className="crumbs" aria-label="Location in the machine" data-testid="breadcrumb">
        <button type="button" className="crumb" onClick={() => sim.exitInspect()}>
          Machine
        </button>
        {sys && (
          <>
            <span aria-hidden="true">›</span>
            <button type="button" className="crumb" onClick={() => sim.inspect(sys.id)} data-testid="crumb-parent">
              {sys.name}
            </button>
          </>
        )}
        <span aria-hidden="true">›</span>
        <span className="crumb here" aria-current="page">
          {info.name}
        </span>
      </nav>
      <div className="insp-head">
        <span className="pill">{info.isSubsystem ? 'Assembly' : info.isProcess ? 'Process' : 'Component'}</span>
        <span className="pill">{info.category}</span>
      </div>
      <h1 className="stage-title insp-name" data-testid="inspect-name">
        {info.name}
      </h1>
      {info.isProcess && <p className="insp-note">A process, not a part: shown with the hardware around it so you can see where it happens.</p>}
      {info.isSubsystem && (
        <div className="insp-children" aria-label="Parts of this assembly" data-testid="insp-children">
          {info.children
            .filter((c) => COMPONENTS[c])
            .map((c) => (
              <button key={c} type="button" className="chip-link" onClick={() => sim.inspect(c)} data-inspect={c}>
                {nameOf(c)}
              </button>
            ))}
        </div>
      )}
      <TypedLevels key={info.id} info={info} />
      {!info.isSubsystem && siblings.length > 0 && (
        <div className="insp-sibs">
          <span>Also in {sys!.name}:</span>
          {siblings.map((c) => (
            <button key={c} type="button" className="chip-link" onClick={() => sim.inspect(c)} data-inspect={c}>
              {nameOf(c)}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// ═══════════════════════════ inspection toolbar ═══════════════════════════
const PRESETS: { id: InspectPreset; label: string; title: string }[] = [
  { id: 'front', label: 'Front', title: 'Look at the front' },
  { id: 'side', label: 'Side', title: 'Look from the side' },
  { id: 'top', label: 'Top', title: 'Look from above' },
  { id: 'iso', label: 'Iso', title: 'Isometric view' },
];

/** Camera and rotation controls of the inspection view, with an instruction line that matches them. */
export function InspectToolbar() {
  const id = useSim((s) => s.inspect);
  const spin = useSim((s) => s.spin);
  const dir = useSim((s) => s.spinDir);
  const preset = useSim((s) => s.camPreset);
  const selected = useSim((s) => s.selectedId);
  if (!id) return null;
  return (
    <div className="insp-bar" data-testid="inspect-bar">
      <p className="insp-help" data-testid="inspect-help">
        <span className="help-state">{spin ? `Rotating slowly ${dir === 1 ? 'anticlockwise' : 'clockwise'} to show every side. ` : 'Rotation paused. '}</span>
        <span className="help-mouse">Drag to rotate · scroll to zoom · right-drag to pan.</span>
        <span className="help-touch">Drag to rotate · pinch to zoom · two-finger drag to pan.</span>
        {!spin && <span className="help-state"> Press Resume rotation to start it again.</span>}
      </p>
      <div className="insp-tools" role="toolbar" aria-label="Inspection view controls">
        <button type="button" className="btn btn-sm" onClick={() => sim.exitInspect()} data-testid="insp-back" title="Back to where you were (Esc)">
          ‹ Back
        </button>
        <span className="tool-sep" />
        <button type="button" className="btn btn-sm" aria-pressed={!spin} onClick={() => sim.setSpin(!spin)} data-testid="insp-spin">
          {spin ? 'Pause rotation' : 'Resume rotation'}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => sim.reverseSpin()} data-testid="insp-reverse" title="Reverse the direction of rotation">
          Reverse
        </button>
        <button type="button" className="btn btn-sm" onClick={() => sim.setCamPreset('default')} data-testid="insp-reset" title="Re-centre the view">
          Reset view
        </button>
        <span className="tool-sep" />
        <div className="seg" role="radiogroup" aria-label="Camera angle" data-testid="insp-presets">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={preset === p.id} title={p.title} data-value={p.id} onClick={() => sim.setCamPreset(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        <span className="tool-sep" />
        {selected && COMPONENTS[selected] && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              sim.select(selected);
            }}
            data-testid="insp-details"
            title="Open the full scientific notes in the Science panel"
          >
            Full notes
          </button>
        )}
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => sim.closeCasing()} data-testid="insp-exterior" title="Close the machine and show the exterior">
          Machine exterior
        </button>
      </div>
    </div>
  );
}

/** Brief fade that hides the switch to (or between) isolated views while the camera moves. */
export function IsoVeil() {
  const id = useSim((s) => s.inspect);
  return <div key={id ?? 'none'} className="iso-veil" aria-hidden="true" />;
}

// ═══════════════════════════ explorer (panel tab) ═══════════════════════════
/** The machine as a tree: every subsystem and every part, each one opens in the isolated view. */
export function ExplorerView() {
  const inspecting = useSim((s) => s.inspect);
  const casing = useSim((s) => s.casing);
  const groups = SUBSYSTEMS.map((s) => ({ s, kids: s.children.filter((c) => COMPONENTS[c] && COMPONENTS[c].kind !== 'zone') }));
  return (
    <div data-testid="explorer">
      <p className="muted" style={{ marginBottom: 10, fontSize: 13 }}>
        Pick an assembly or a single part to see it on its own, turning slowly, with its explanation. Assemblies show all their parts together; click a part inside to isolate it.
      </p>
      <div className="insp-actions" style={{ marginTop: 0, marginBottom: 6 }}>
        <button type="button" className="btn btn-sm" onClick={() => (casing === 'closed' ? sim.openCasing() : sim.closeCasing())} data-testid="explorer-casing">
          {casing === 'closed' ? 'Open the machine' : 'Close the machine'}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => sim.inspect('enclosure')}>
          Inspect the casing
        </button>
      </div>
      <ul className="tree" data-testid="explore-tree">
        {groups.map(({ s, kids }) => (
          <li key={s.id}>
            <button type="button" className={`tree-sys${inspecting === s.id ? ' on' : ''}`} onClick={() => sim.inspect(s.id)} data-inspect={s.id} aria-current={inspecting === s.id ? 'true' : undefined}>
              <span>{s.name}</span>
              <small>{kids.length} parts</small>
            </button>
            <ul>
              {kids.map((c) => (
                <li key={c}>
                  <button type="button" className={`tree-item${inspecting === c ? ' on' : ''}`} onClick={() => sim.inspect(c)} data-inspect={c} aria-current={inspecting === c ? 'true' : undefined}>
                    <span>{COMPONENTS[c].name}</span>
                    {COMPONENTS[c].kind === 'process' && <small>process</small>}
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
