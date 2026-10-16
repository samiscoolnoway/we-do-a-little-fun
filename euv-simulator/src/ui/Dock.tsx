import { useRef, useState } from 'react';
import { STAGES, STAGE_START, T_TOTAL, fmtTime, stageAt } from '../data/stages';
import { sim, useSim, useTimeListener } from '../store/sim';
import { Seg, ZONE_COLOR } from './controls';
import { IconGear, IconLabels, IconNext, IconPath, IconPause, IconPlay, IconPrev, IconRestart } from './icons';

const SPEEDS = [0.25, 0.5, 1, 2, 4];

export function Dock() {
  const playing = useSim((s) => s.playing);
  const speed = useSim((s) => s.speed);
  const stage = useSim((s) => s.stage);
  const labels = useSim((s) => s.labels);
  const path = useSim((s) => s.path);
  const view = useSim((s) => s.view);
  const focusId = useSim((s) => s.focusId);
  const tone = useSim((s) => s.tone);
  const dose = useSim((s) => s.dose);
  const atm = useSim((s) => s.atmosphere);
  const casing = useSim((s) => s.casing);
  const [more, setMore] = useState(false);

  const range = useRef<HTMLInputElement>(null);
  const clock = useRef<HTMLDivElement>(null);
  const chips = useRef<(HTMLButtonElement | null)[]>([]);
  const dragging = useRef(false);
  const wasPlaying = useRef(false);

  useTimeListener((t) => {
    const r = range.current;
    if (r && !dragging.current) r.value = String(t);
    r?.style.setProperty('--pp', `${(t / T_TOTAL) * 100}%`);
    if (clock.current) {
      clock.current.firstChild!.textContent = fmtTime(t);
      (clock.current.lastChild as HTMLElement).textContent = `/ ${fmtTime(T_TOTAL)}`;
    }
    const i = stageAt(t);
    const p = (t - STAGE_START[i]) / STAGES[i].duration;
    chips.current[i]?.style.setProperty('--cp', `${Math.min(100, Math.max(0, p * 100))}%`);
  });

  const goStage = (i: number) => {
    sim.goStage(i);
    if (sim.state.view === 'component') sim.setView('stage');
  };

  return (
    <footer className="dock" aria-label="Playback and view controls" data-testid="dock">
      <div className="dock-main">
        <div className="transport" role="group" aria-label="Transport">
          <button type="button" className="tbtn" aria-label="Previous stage" title="Previous stage (←)" onClick={() => sim.prev()} data-testid="btn-prev">
            <IconPrev />
          </button>
          <button type="button" className="tbtn primary" aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={() => sim.toggle()} data-testid="btn-play" data-playing={playing}>
            {playing ? <IconPause /> : <IconPlay />}
          </button>
          <button type="button" className="tbtn" aria-label="Next stage" title="Next stage (→)" onClick={() => sim.next()} data-testid="btn-next">
            <IconNext />
          </button>
          <button type="button" className="tbtn" aria-label="Restart from the beginning" title="Restart (R)" onClick={() => sim.restart()} data-testid="btn-restart">
            <IconRestart />
          </button>
        </div>
        <div className="timeline">
          <ol className="chips" aria-label="Stages" data-testid="chips">
            {STAGES.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  ref={(el) => {
                    chips.current[i] = el;
                  }}
                  className={`chip${i < stage ? ' past' : ''}`}
                  style={{ ['--zc' as string]: ZONE_COLOR[s.zone] }}
                  aria-current={i === stage ? 'step' : undefined}
                  title={`Stage ${s.n}: ${s.title}`}
                  onClick={() => goStage(i)}
                  data-stage={i}
                >
                  <b>{s.n}</b>
                  <span>{s.short}</span>
                </button>
              </li>
            ))}
          </ol>
          <input
            ref={range}
            className="scrub"
            type="range"
            min={0}
            max={T_TOTAL}
            step={0.01}
            defaultValue={0}
            aria-label="Timeline position"
            aria-valuetext={`Stage ${stage + 1}: ${STAGES[stage].title}`}
            data-testid="scrub"
            onPointerDown={() => {
              dragging.current = true;
              wasPlaying.current = sim.state.playing;
              sim.pause();
            }}
            onPointerUp={() => {
              dragging.current = false;
              if (wasPlaying.current && sim.getTime() < T_TOTAL - 0.05) sim.play();
            }}
            onPointerCancel={() => {
              dragging.current = false;
            }}
            onChange={(e) => sim.setTime(parseFloat(e.currentTarget.value))}
          />
        </div>
        <div className="clock" ref={clock} aria-hidden="true">
          <span>0:00</span>
          <small>/ 0:00</small>
        </div>
      </div>

      <div className={`dock-opts${more ? '' : ' closed'}`}>
        <div className="grp" role="group" aria-label="Machine casing">
          <span className="glabel">Machine</span>
          <Seg
            label="Machine casing"
            value={casing}
            onChange={(v) => (v === 'closed' ? sim.closeCasing() : sim.openCasing())}
            options={[
              { value: 'closed', label: 'Exterior', title: 'Close the casing and show the outside of the machine (O)' },
              { value: 'open', label: 'Interior', title: 'Open the casing and show the parts inside (O)' },
            ]}
            testId="seg-casing"
          />
        </div>
        <div className="grp keep" role="group" aria-label="View">
          <span className="glabel">View</span>
          <Seg
            label="Camera view"
            value={view}
            onChange={(v) => sim.setView(v)}
            options={[
              { value: 'machine', label: 'Whole machine', title: 'Show the entire machine (M)' },
              { value: 'stage', label: 'Close-up', title: 'Zoom to the current stage (M)' },
            ]}
            testId="seg-view"
          />
          {view === 'component' && focusId && (
            <button type="button" className="btn btn-sm" aria-pressed="true" onClick={() => sim.setView('stage')} title="Leave the component close-up">
              Component ✕
            </button>
          )}
        </div>
        <div className="grp keep" role="group" aria-label="Overlays">
          <button type="button" className="btn btn-sm" aria-pressed={labels} onClick={() => sim.toggleLabels()} title="Show or hide floating labels (L)" data-testid="btn-labels">
            <IconLabels size={15} /> Labels
          </button>
          <button type="button" className="btn btn-sm" aria-pressed={path} onClick={() => sim.togglePath()} title="Show or hide the laser and EUV light paths (P)" data-testid="btn-path">
            <IconPath size={15} /> Optical path
          </button>
          <button type="button" className="btn btn-sm more-btn" aria-expanded={more} aria-label="More options" onClick={() => setMore(!more)}>
            <IconGear size={15} /> {more ? 'Less' : 'More'}
          </button>
        </div>
        <div className="grp" role="group" aria-label="Speed">
          <span className="glabel">Speed</span>
          <Seg label="Animation speed" value={speed} onChange={(v) => sim.setSpeed(v)} options={SPEEDS.map((v) => ({ value: v, label: `${v}×` }))} testId="seg-speed" />
        </div>
        <div className="grp" role="group" aria-label="Chamber atmosphere">
          <span className="glabel">Chamber</span>
          <Seg
            label="Chamber atmosphere"
            value={atm}
            onChange={(v) => sim.setAtmosphere(v)}
            options={[
              { value: 'vacuum', label: 'Vacuum', title: 'EUV travels freely in vacuum' },
              { value: 'air', label: 'Air', title: 'Show how air would absorb EUV (illustrative)' },
            ]}
            testId="seg-atm"
          />
        </div>
        <div className="grp" role="group" aria-label="Resist">
          <span className="glabel">Resist</span>
          <Seg
            label="Resist tone"
            value={tone}
            onChange={(v) => sim.setTone(v)}
            options={[
              { value: 'positive', label: 'Positive', title: 'Exposed resist dissolves' },
              { value: 'negative', label: 'Negative', title: 'Exposed resist stays' },
              { value: 'compare', label: 'Compare', title: 'Show both side by side' },
            ]}
            testId="seg-tone"
          />
          <label className="dose" title="Exposure dose relative to nominal">
            Dose
            <input type="range" min={0.6} max={1.6} step={0.05} value={dose} aria-label="Exposure dose" onChange={(e) => sim.setDose(parseFloat(e.target.value))} style={{ ['--pp' as string]: `${((dose - 0.6) / 1.0) * 100}%` }} data-testid="dose" />
            <output>{dose.toFixed(2)}×</output>
          </label>
        </div>
      </div>
    </footer>
  );
}
