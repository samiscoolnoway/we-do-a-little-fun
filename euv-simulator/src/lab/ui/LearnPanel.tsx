import { useState } from 'react';
import { DEFAULT_CONFIG, type SimConfig, cloneConfig } from '../core/config';
import type { ComparisonRow, Experiment } from '../core/experiments';
import { fmt } from '../viz/colormap';
import { LEVELS, type Level, TOPICS } from './content';
import { store, useStore } from './store';

/** Predict → run → compare activities: the prediction is recorded before the run; the comparison uses the computed rows. */
interface Activity {
  id: string;
  title: string;
  question: string;
  options: { id: string; label: string }[];
  experiment: Experiment;
  /** computed outcome from the two rows (a, b) */
  outcome: (a: ComparisonRow, b: ComparisonRow) => { value: number; text: string; answer: string };
  explain: string;
}

const exp = (id: string, title: string, items: [string, (c: SimConfig) => void][]): Experiment => ({
  id,
  title,
  question: '',
  lookFor: '',
  items: items.map(([name, f]) => ({
    name,
    apply: (c: SimConfig) => {
      const d = cloneConfig(DEFAULT_CONFIG);
      Object.assign(c, d);
      f(c);
    },
  })),
});

const ACTIVITIES: Activity[] = [
  {
    id: 'mach',
    title: 'Double the speed',
    question: 'The freestream Mach number goes from 3 to 6 (same altitude, wall at 300 K). By what factor does the stagnation-point heat flux grow?',
    options: [
      { id: '2', label: 'About 2× (proportional to speed)' },
      { id: '4', label: 'About 4×' },
      { id: '8', label: 'About 8× (speed cubed)' },
      { id: 'more', label: 'More than 8×' },
    ],
    experiment: exp('pr-mach', 'Predict: double the speed', [
      ['M = 3 (activity)', (c) => (c.flow.mach = 3)],
      ['M = 6 (activity)', (c) => (c.flow.mach = 6)],
    ]),
    outcome: (a, b) => {
      const r = b.qStag / a.qStag;
      return { value: r, text: `q_stag grew ${fmt(r, 3)}× (${fmt(a.qStag / 1000, 3)} → ${fmt(b.qStag / 1000, 3)} kW/m²)`, answer: r > 8.5 ? 'more' : r > 6 ? '8' : r > 3 ? '4' : '2' };
    },
    explain:
      'A cold wall would see roughly the cube of the speed (Sutton–Graves: q ∝ V³). Here the wall is at 300 K: at M = 3 the gas total temperature (616 K) is only about twice the wall temperature, so the driving difference T_aw − T_wall is small; at M = 6 (1 804 K) it is much larger. The hot-wall factor pushes the ratio above 8.',
  },
  {
    id: 'thickness',
    title: 'Triple the thickness',
    question: 'The heat shield goes from 15 mm to 45 mm, same material and heating, 60 s exposure. What happens to the temperature of the back face?',
    options: [
      { id: 'third', label: 'Its temperature rise drops to about one third' },
      { id: 'much', label: 'It stays very close to the initial temperature' },
      { id: 'same', label: 'Almost no change' },
    ],
    experiment: exp('pr-thick', 'Predict: triple the thickness', [
      ['L = 15 mm (activity)', (c) => (c.thermal.thickness = 0.015)],
      ['L = 45 mm (activity)', (c) => (c.thermal.thickness = 0.045)],
    ]),
    outcome: (a, b) => {
      const ra = a.TbackEnd - 300;
      const rb = b.TbackEnd - 300;
      return {
        value: rb / ra,
        text: `back-face temperature rise: ${fmt(ra, 3)} K (15 mm) → ${fmt(rb, 3)} K (45 mm)`,
        answer: rb < 0.1 * ra ? 'much' : rb < 0.6 * ra ? 'third' : 'same',
      };
    },
    explain:
      'Heat penetrates about √(αt) ≈ 8 mm in 60 s. A 15 mm shield is partly soaked through; at 45 mm the heat never reaches the back face during the exposure, so its temperature hardly moves. Diffusion is not linear in thickness: the time to soak through grows with L².',
  },
  {
    id: 'conductivity',
    title: 'Ten times the conductivity',
    question: 'The shield conducts heat ten times better (k: 0.1 → 1.0 W/(m·K)). What happens to the surface temperature after 60 s?',
    options: [
      { id: 'cooler', label: 'The surface gets cooler' },
      { id: 'same', label: 'No change' },
      { id: 'hotter', label: 'The surface gets hotter' },
    ],
    experiment: exp('pr-k', 'Predict: ten times the conductivity', [
      ['k = 0.1 (activity)', (c) => (c.thermal.k = 0.1)],
      ['k = 1.0 (activity)', (c) => (c.thermal.k = 1.0)],
    ]),
    outcome: (a, b) => {
      const d = b.TsurfEnd - a.TsurfEnd;
      return { value: d, text: `surface: ${fmt(a.TsurfEnd, 4)} K → ${fmt(b.TsurfEnd, 4)} K; back face: ${fmt(a.TbackEnd, 4)} K → ${fmt(b.TbackEnd, 4)} K`, answer: d < -1 ? 'cooler' : d > 1 ? 'hotter' : 'same' };
    },
    explain:
      'A better conductor draws heat away from the surface into the material, so the surface is cooler, but the heat now reaches the structure behind it. Heat shields are insulators: they keep the heat at the surface, where re-radiation can remove it.',
  },
];

export function LearnPanel() {
  const [level, setLevel] = useState<Level>('intuitive');
  return (
    <div className="learn" data-testid="learn">
      <div className="segmented" role="radiogroup" aria-label="Explanation level">
        {LEVELS.map((l) => (
          <button key={l.id} role="radio" aria-checked={level === l.id} data-testid={`level-${l.id}`} className={level === l.id ? 'active' : ''} onClick={() => setLevel(l.id)}>
            {l.label}
          </button>
        ))}
      </div>
      {TOPICS.map((t, k) => (
        <details key={t.id} className="atl-card topic" open={k === 0} data-testid={`topic-${t.id}`}>
          <summary>{t.title}</summary>
          {t.text[level].map((p) => (
            <p key={p}>{p}</p>
          ))}
        </details>
      ))}
      <h3 className="learn-h">Predict, run, compare</h3>
      <p className="atl-hint">Commit to a prediction first. The run then computes the answer with the full model, and the comparison uses the computed numbers.</p>
      {ACTIVITIES.map((a) => (
        <ActivityCard key={a.id} a={a} />
      ))}
      <ProbeActivity />
    </div>
  );
}

function ActivityCard({ a }: { a: Activity }) {
  const [pred, setPred] = useState<string | null>(null);
  const rows = useStore((s) => s.rows);
  const ex = useStore((s) => s.experiment);
  const running = useStore((s) => s.running);
  const names = a.experiment.items.map((i) => i.name);
  const ra = [...rows].reverse().find((r) => r.name === names[0]);
  const rb = [...rows].reverse().find((r) => r.name === names[1]);
  const result = ra && rb && rb.id > ra.id ? a.outcome(ra, rb) : null;
  const mine = ex?.id === a.experiment.id;
  return (
    <div className="atl-card activity" data-testid={`activity-${a.id}`}>
      <h3>{a.title}</h3>
      <p>{a.question}</p>
      <div className="options">
        {a.options.map((o) => (
          <label key={o.id} className="toggle">
            <input type="radio" name={`pred-${a.id}`} checked={pred === o.id} onChange={() => setPred(o.id)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      <button className="primary" disabled={!pred || !!ex || running} data-testid={`activity-run-${a.id}`} onClick={() => store.runExperiment(a.experiment)}>
        {pred ? 'Run and compare' : 'Choose a prediction first'}
      </button>
      {mine && <div className="atl-hint">Computing case {ex!.index + 1} of {ex!.queue.length}…</div>}
      {result && pred && (
        <div className={`banner small ${result.answer === pred ? 'info' : 'warn'}`} data-testid={`activity-result-${a.id}`}>
          <strong>{result.answer === pred ? 'Your prediction matches the computation.' : 'The computation disagrees with your prediction.'}</strong> Computed: {result.text}.
          <p>{a.explain}</p>
        </div>
      )}
    </div>
  );
}

function ProbeActivity() {
  return (
    <div className="atl-card activity" data-testid="activity-probe">
      <h3>Probe the flow</h3>
      <p>With the M = 3 flow converged, place the probe (click or tap the flow) at four places and compare each reading with the freestream column:</p>
      <ol>
        <li>well upstream of the shock,</li>
        <li>between the shock and the front of the body,</li>
        <li>just above the shoulder (top of the body),</li>
        <li>in the wake behind the body.</li>
      </ol>
      <p className="atl-hint">
        The Probe tab interprets each reading from the computed values: an unchanged state means no information reached that point; an entropy rise means the gas
        passed through the shock; pressure below the freestream value means expansion.
      </p>
    </div>
  );
}
