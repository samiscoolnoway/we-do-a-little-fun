import { useEffect, useMemo, useRef, useState } from 'react';
import { COMPONENT_LIST, COMPONENTS } from '../data/components';
import { CONCEPTS } from '../data/concepts';
import { QUIZ } from '../data/quiz';
import { STAGES } from '../data/stages';
import type { Level, PanelTab, Zone } from '../data/types';
import { sim, useSim } from '../store/sim';
import { Seg, ZONE_COLOR, ZONE_NAME } from './controls';
import { IconClose, IconExpand, IconFlask, IconTarget } from './icons';
import { EquationCard, Rich } from './Rich';
import { WidgetFor } from './widgets';

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'inspect', label: 'Inspect' },
  { id: 'concepts', label: 'Concepts' },
  { id: 'quiz', label: 'Quiz' },
  { id: 'about', label: 'About' },
];

function closeUp(id: string) {
  // the cross-section only exists from the exposure stage onwards
  if (id === 'resist' && sim.state.stage < 7) sim.goStage(7);
  sim.focusComponent(id);
}
function showStage(i: number) {
  sim.goStage(i);
  sim.setView('stage');
}

export function Panel({ tall, onTall }: { tall: boolean; onTall: (v: boolean) => void }) {
  const tab = useSim((s) => s.panelTab);
  const open = useSim((s) => s.panelOpen);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [tab]);
  return (
    <aside className={`panel${tall ? ' tall' : ''}`} hidden={!open} aria-label="Science panel" data-testid="panel">
      <div className="panel-head">
        <div className="tabs" role="tablist" aria-label="Science panel sections">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`pane-${t.id}`} className="tab-btn" onClick={() => sim.setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" className="icon-btn panel-expand" aria-label={tall ? 'Shrink panel' : 'Expand panel'} onClick={() => onTall(!tall)}>
          <IconExpand size={16} />
        </button>
        <button type="button" className="icon-btn" aria-label="Close panel" onClick={() => sim.togglePanel(false)} data-testid="panel-close">
          <IconClose size={16} />
        </button>
      </div>
      <div className="panel-body" ref={scroller}>
        {TABS.map((t) => (
          <div key={t.id} role="tabpanel" id={`pane-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={tab !== t.id}>
            {t.id === 'inspect' && <InspectView />}
            {t.id === 'concepts' && <ConceptsView />}
            {t.id === 'quiz' && <QuizView />}
            {t.id === 'about' && <AboutView />}
          </div>
        ))}
      </div>
    </aside>
  );
}

// ═══════════════════════════ inspect ═══════════════════════════
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function ComponentButton({ id }: { id: string }) {
  const c = COMPONENTS[id];
  if (!c) return null;
  return (
    <button type="button" className="list-item" style={{ ['--zc' as string]: ZONE_COLOR[c.zone] }} onClick={() => sim.select(id)} data-comp={id}>
      <i />
      <span>{c.name}</span>
      <small>stage {c.stage + 1}</small>
    </button>
  );
}

function StageGuide() {
  const stage = useSim((s) => s.stage);
  const st = STAGES[stage];
  const zones: Zone[] = ['source', 'scanner', 'track', 'etch'];
  return (
    <div data-testid="stage-guide">
      <p className="muted" style={{ marginBottom: 6, fontSize: 13 }}>
        Click any part of the machine or any floating label to inspect it.
      </p>
      <h2>
        Stage {st.n}: {st.title}
      </h2>
      <p style={{ marginTop: 8 }}>{st.caption}</p>
      <p>
        <b style={{ color: 'var(--accent)' }}>Watch for. </b>
        {st.watch}
      </p>
      <Section title="Inspect in this stage">
        <div className="list-grid">
          {st.focus.map((id) => (
            <ComponentButton key={id} id={id} />
          ))}
        </div>
      </Section>
      <Section title="All components">
        {zones.map((z) => {
          const items = COMPONENT_LIST.filter((c) => c.zone === z);
          if (!items.length) return null;
          return (
            <div key={z}>
              <div className="sub-h" style={{ color: ZONE_COLOR[z] }}>
                {ZONE_NAME[z]}
              </div>
              <div className="list-grid">
                {items.map((c) => (
                  <ComponentButton key={c.id} id={c.id} />
                ))}
              </div>
            </div>
          );
        })}
      </Section>
    </div>
  );
}

function InspectView() {
  const id = useSim((s) => s.selectedId);
  const deep = useSim((s) => s.deep);
  const comp = id ? COMPONENTS[id] : null;
  if (!comp) return <StageGuide />;
  const concept = CONCEPTS.find((c) => c.id === STAGES[comp.stage].concept);
  return (
    <article data-testid="inspector" data-comp={comp.id}>
      <h2 data-testid="inspector-title">{comp.name}</h2>
      <div className="insp-meta">
        <span className="pill" style={{ ['--zc' as string]: ZONE_COLOR[comp.zone] }}>
          <i />
          {ZONE_NAME[comp.zone]}
        </span>
        <span className="pill">{comp.span ? `Stages ${comp.span[0] + 1}–${comp.span[1] + 1}` : `Stage ${comp.stage + 1}`}</span>
      </div>
      <div className="insp-actions">
        <button type="button" className="btn btn-sm" onClick={() => closeUp(comp.id)} data-testid="btn-closeup">
          <IconTarget size={14} /> Close-up
        </button>
        <button type="button" className="btn btn-sm" onClick={() => showStage(comp.stage)}>
          Go to stage {comp.stage + 1}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => sim.select(null)}>
          Stage guide
        </button>
      </div>

      <Section title="What it is">
        <p>{comp.what}</p>
      </Section>
      <Section title="What it does">
        <p>{comp.does}</p>
      </Section>
      <Section title="Physics">
        <p>{comp.physics}</p>
      </Section>
      <Section title="Chemistry">
        <p>{comp.chemistry}</p>
      </Section>
      <Section title="Equation">
        {comp.equations.length ? comp.equations.map((e, i) => <EquationCard key={i} eq={e} />) : <p className="muted">No single governing equation for this item.</p>}
      </Section>
      <Section title="What you see">
        <p>{comp.see}</p>
      </Section>

      {comp.widgets?.map((w) => (
        <WidgetFor key={w} id={w} />
      ))}

      {deep ? (
        <div className="deep-box" data-testid="deep-content">
          <h3>
            <IconFlask size={14} /> Deep Science
          </h3>
          <div className="sub-h">Going further</div>
          <ul>
            {comp.deep.notes.map((n, i) => (
              <li key={i}>
                <Rich text={n} />
              </li>
            ))}
          </ul>
          {comp.deep.equations?.map((e, i) => <EquationCard key={i} eq={e} />)}
          <div className="sub-h">Assumptions and limits of this model</div>
          <ul>
            {comp.deep.limits.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="deep-off">
          <span>Advanced notes, extra equations and the limits of this model are hidden.</span>
          <button type="button" className="btn btn-sm btn-deep" onClick={() => sim.toggleDeep()} data-testid="reveal-deep">
            <IconFlask size={14} /> Reveal Deep Science
          </button>
        </div>
      )}

      {concept && (
        <div style={{ marginTop: 16 }}>
          <button
            type="button"
            className="chip-link"
            onClick={() => {
              sim.setConceptOpen(concept.id);
              sim.setTab('concepts');
            }}
          >
            Related concept: {concept.title} →
          </button>
        </div>
      )}
    </article>
  );
}

// ═══════════════════════════ concepts ═══════════════════════════
const LEVELS: { value: Level; label: string }[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];

function ConceptsView() {
  const level = useSim((s) => s.conceptLevel);
  const target = useSim((s) => s.conceptOpen);
  const refs = useRef<Record<string, HTMLDetailsElement | null>>({});
  useEffect(() => {
    if (target) {
      const el = refs.current[target];
      if (el) {
        el.open = true;
        el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    }
  }, [target]);
  return (
    <div data-testid="concepts">
      <h2>Concepts at three levels</h2>
      <p className="muted" style={{ marginTop: 6 }}>
        Pick a level; every concept below follows it. Deep Science switches to Advanced.
      </p>
      <Seg wide label="Explanation level" value={level} options={LEVELS} onChange={(l) => sim.setConceptLevel(l)} testId="level-seg" />
      {CONCEPTS.map((c) => (
        <details key={c.id} className="card" ref={(el) => {
            refs.current[c.id] = el;
          }} data-concept={c.id}>
          <summary>{c.title}</summary>
          <div className="card-body">
            <span className={`level-tag ${level}`}>{LEVELS.find((l) => l.value === level)!.label}</span>
            <p>{c[level]}</p>
            {level !== 'beginner' && c.equation && <EquationCard eq={c.equation} />}
            <details className="card" style={{ background: 'var(--bg-2)' }}>
              <summary style={{ fontSize: 13 }}>Show all three levels</summary>
              <div className="card-body">
                {LEVELS.filter((l) => l.value !== level).map((l) => (
                  <div key={l.value}>
                    <span className={`level-tag ${l.value}`}>{l.label}</span>
                    <p>{c[l.value]}</p>
                  </div>
                ))}
              </div>
            </details>
            <div className="insp-actions" style={{ marginTop: 6 }}>
              <button type="button" className="btn btn-sm" onClick={() => (c.focus ? (showStage(c.stage), sim.select(c.focus)) : showStage(c.stage))}>
                Show in the simulation
              </button>
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}

// ═══════════════════════════ quiz ═══════════════════════════
function QuizView() {
  const [i, setI] = useState(0);
  const [picks, setPicks] = useState<(number | null)[]>(() => QUIZ.map(() => null));
  const [done, setDone] = useState(false);
  const q = QUIZ[i];
  const picked = picks[i];
  const score = picks.reduce<number>((a, p, k) => a + (p === QUIZ[k].answer ? 1 : 0), 0);
  const answered = picks.filter((p) => p !== null).length;
  const reset = () => {
    setPicks(QUIZ.map(() => null));
    setI(0);
    setDone(false);
  };
  if (done) {
    return (
      <div data-testid="quiz-result">
        <h2>Quiz complete</h2>
        <div className="score-big" style={{ margin: '10px 0' }}>
          {score} / {QUIZ.length}
        </div>
        <p>{score >= 13 ? 'Excellent: you could explain this machine to a friend.' : score >= 9 ? 'Good grasp. Revisit the questions you missed in the Concepts tab.' : 'A solid start. Play the stages again and read the Concepts tab, then retry.'}</p>
        <h3>Review</h3>
        <ul>
          {QUIZ.map((qq, k) => (
            <li key={qq.id}>
              {picks[k] === qq.answer ? '✓' : '✗'} {qq.q}{' '}
              <button type="button" className="chip-link" onClick={() => showStage(qq.stage)}>
                stage {qq.stage + 1}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn" onClick={reset}>
          Retake the quiz
        </button>
      </div>
    );
  }
  return (
    <div data-testid="quiz">
      <h2>Check your understanding</h2>
      <div className="quiz-progress" aria-hidden="true">
        <i style={{ width: `${(answered / QUIZ.length) * 100}%` }} />
      </div>
      <p className="muted" style={{ fontSize: 12.5, margin: '0 0 6px' }}>
        Question {i + 1} of {QUIZ.length} · score {score}
      </p>
      <p style={{ fontSize: 15.5, fontWeight: 500 }}>{q.q}</p>
      <div role="group" aria-label="Answers">
        {q.options.map((o, k) => {
          const state = picked === null ? '' : k === q.answer ? 'right' : k === picked ? 'wrong' : '';
          return (
            <button key={k} type="button" className={`opt ${state}`} disabled={picked !== null} onClick={() => setPicks((p) => p.map((v, j) => (j === i ? k : v)))} data-testid={`opt-${k}`}>
              <b>{'ABCD'[k]}</b>
              <span>{o}</span>
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <div data-testid="quiz-why">
          <div className="why">
            <b>{picked === q.answer ? 'Correct. ' : 'Not quite. '}</b>
            {q.why}
          </div>
          <div className="insp-actions">
            <button type="button" className="btn btn-sm" onClick={() => showStage(q.stage)}>
              Show it in the simulation
            </button>
            {i < QUIZ.length - 1 ? (
              <button type="button" className="btn btn-sm" style={{ borderColor: 'var(--accent-2)' }} onClick={() => setI(i + 1)} data-testid="quiz-next">
                Next question →
              </button>
            ) : (
              <button type="button" className="btn btn-sm" style={{ borderColor: 'var(--accent-2)' }} onClick={() => setDone(true)} data-testid="quiz-finish">
                See my score
              </button>
            )}
          </div>
        </div>
      )}
      <div className="insp-actions" style={{ marginTop: 16 }}>
        <button type="button" className="btn btn-sm btn-ghost" disabled={i === 0} onClick={() => setI(i - 1)}>
          ← Previous
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={reset}>
          Restart quiz
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════ about ═══════════════════════════
const KEYS: [string, string, string][] = [
  ['var(--c-laser)', 'CO₂ drive laser, 10.6 µm', 'infrared, invisible to the eye'],
  ['var(--c-plasma)', 'Tin plasma and photoacid', 'hot plasma; acid molecules in the resist'],
  ['var(--c-euv)', 'EUV radiation, 13.5 nm', 'invisible to the eye'],
  ['var(--c-mask)', 'Reflective mask', 'multilayer mirror + absorber'],
  ['var(--c-silicon)', 'Silicon wafer', ''],
  ['var(--c-resist)', 'Photoresist', ''],
  ['var(--c-track)', 'Track tools', 'bake, develop (outside the scanner)'],
  ['var(--c-etch)', 'Etch tool', 'plasma etch (outside the scanner)'],
];

function AboutView() {
  return (
    <div data-testid="about">
      <h2>About this model</h2>
      <p style={{ marginTop: 8 }}>
        An interactive educational model of an extreme-ultraviolet (13.5 nm) lithography scanner and the wafer-processing steps that follow it. It is inspired by publicly documented EUV systems, including those made by ASML, and is independent of them: it is not made, endorsed or approved by ASML or any equipment maker.
      </p>
      <p>
        It is not an exact reproduction of a commercial machine. Layouts, sizes and the optical design are simplified teaching models, and no proprietary dimensions, optical prescriptions or operating parameters are used. Typical numbers come from public sources and are rounded.
      </p>

      <Section title="Visualization key">
        {KEYS.map(([c, a, b]) => (
          <div className="about-key" key={a} style={{ ['--k' as string]: c }}>
            <i />
            <span>
              <b style={{ fontWeight: 600 }}>{a}</b>
              {b && <span className="muted"> · {b}</span>}
            </span>
          </div>
        ))}
        <p style={{ marginTop: 10 }}>
          <b>EUV radiation (13.5 nm) and the CO₂ laser light (10.6 µm) are not visible to the human eye.</b> Cyan and red are visualization aids chosen to tell the layers apart.
        </p>
      </Section>

      <Section title="Inside the scanner vs downstream">
        <p>
          <b style={{ color: 'var(--c-euv)' }}>Inside the EUV scanner system</b> (cyan frame): tin droplet generator, CO₂ laser and plasma, collector, illumination optics, reflective mask, projection optics, wafer stage. Stages 1 to 8.
        </p>
        <p>
          <b style={{ color: 'var(--c-track)' }}>Downstream, in separate machines</b> (amber frame): post-exposure bake and development in the track, plasma etch in an etch tool. Stages 9 to 11. The scanner only exposes the wafer; the pattern becomes physical later.
        </p>
      </Section>

      <Section title="Keep these straight">
        <ul>
          <li>The CO₂ laser makes the plasma. It is not the beam that exposes the wafer.</li>
          <li>The EUV path uses specialised mirrors and vacuum, not lenses.</li>
          <li>The mask is reflective, not a transparent slide.</li>
          <li>Photoresist chemistry depends on the formulation. The model shows one simplified example.</li>
          <li>Development and etching are separate manufacturing processes, not part of the scanner.</li>
        </ul>
      </Section>

      <Section title="Scale and time">
        <ul>
          <li>Nothing is to scale. Droplets, spacing and fields are exaggerated by orders of magnitude so you can see them.</li>
          <li>Time is slowed by a factor of about 50,000. A real source fires about 50,000 shots a second; here one shot takes one second of timeline.</li>
          <li>Pulse brightness fades by a milder factor per mirror than the real 0.65 to 0.70 so the beam stays visible.</li>
          <li>The resist model is one-dimensional and not calibrated to any real resist.</li>
        </ul>
      </Section>

      <Section title="Controls">
        <ul>
          <li>
            <kbd>Space</kbd> play or pause · <kbd>←</kbd> <kbd>→</kbd> previous or next stage · <kbd>R</kbd> restart
          </li>
          <li>
            <kbd>L</kbd> labels · <kbd>P</kbd> optical path · <kbd>M</kbd> whole machine or close-up · <kbd>D</kbd> Deep Science · <kbd>Esc</kbd> close panel
          </li>
          <li>Drag to orbit, scroll or pinch to zoom, right-drag or two fingers to pan. Click a part or a floating label to inspect it.</li>
        </ul>
      </Section>

      <Section title="Reference values used (public, rounded)">
        <ul>
          <li>Tin melts at 232 °C · droplets ≈ 25 µm, ≈ 50,000 per second</li>
          <li>CO₂ laser 10.6 µm, tens of kW average · conversion efficiency ≈ 5–6%</li>
          <li>Mo/Si multilayer: 40–50 pairs, period ≈ 6.9 nm, ≈ 65–70% reflectivity</li>
          <li>About a dozen reflections from plasma to wafer (collector, illuminator, mask, six projection mirrors) · only about 1% of the light the collector gathers reaches the wafer</li>
          <li>0.33 NA, 4× reduction, 26 × 33 mm field · 300 mm wafer · High-NA 0.55 is anamorphic 4×/8×</li>
          <li>Post-exposure bake ≈ 90–130 °C · developer for positive-tone CAR: 2.38 wt% TMAH</li>
        </ul>
      </Section>

      <Section title="Further reading">
        <ul>
          <li>C. A. Mack, Fundamental Principles of Optical Lithography</li>
          <li>V. Bakshi (ed.), EUV Lithography, SPIE Press</li>
          <li>D. Attwood and A. Sakdinawat, X-Rays and Extreme Ultraviolet Radiation</li>
          <li>CXRO X-ray database for optical constants at 13.5 nm</li>
          <li>Public technology pages of ASML and Carl Zeiss SMT on EUV sources and optics</li>
        </ul>
      </Section>
    </div>
  );
}
