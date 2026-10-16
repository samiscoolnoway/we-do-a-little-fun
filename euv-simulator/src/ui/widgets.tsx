import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { buildResistModel } from '../scene/resistModel';
import { sim, useSim } from '../store/sim';

export function Lab({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="lab">
      <div className="lab-h">
        {title}
        {hint && <small>{hint}</small>}
      </div>
      <div className="lab-b">{children}</div>
    </div>
  );
}

const sci = (x: number, d = 2) => {
  if (!isFinite(x) || x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  const m = x / Math.pow(10, e);
  const sup = String(e).replace('-', '⁻').replace(/[0-9]/g, (c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c]);
  return `${m.toFixed(d)}×10${sup}`;
};

// ═══════════════════════════ photon energy ═══════════════════════════
const PHOTON_PRESETS = [
  { name: 'EUV', nm: 13.5 },
  { name: 'ArF (DUV)', nm: 193 },
  { name: 'Green', nm: 532 },
  { name: 'CO₂ laser', nm: 10600 },
];
const posToNm = (v: number) => Math.pow(10, (v / 1000) * Math.log10(20000));
const nmToPos = (nm: number) => Math.round((Math.log10(nm) / Math.log10(20000)) * 1000);
const band = (nm: number) => (nm < 10 ? 'X-ray' : nm < 121 ? 'Extreme UV' : nm < 300 ? 'Deep UV' : nm < 400 ? 'Near UV' : nm < 700 ? 'Visible' : nm < 3000 ? 'Near infrared' : 'Infrared');

export function PhotonLab() {
  const id = useId();
  const [v, setV] = useState(nmToPos(13.5));
  const nm = posToNm(v);
  const eV = 1239.84 / nm;
  const perMJ = 1e-3 / (eV * 1.602176634e-19);
  return (
    <Lab title="Photon energy lab" hint="E = hc/λ">
      <div className="seg wide" role="group" aria-label="Presets" style={{ marginBottom: 8 }}>
        {PHOTON_PRESETS.map((p) => (
          <button key={p.name} type="button" aria-checked={Math.abs(nm - p.nm) / p.nm < 0.02} role="radio" onClick={() => setV(nmToPos(p.nm))}>
            {p.name}
          </button>
        ))}
      </div>
      <div className="ctrl" style={{ gridTemplateColumns: '78px 1fr 84px' }}>
        <label htmlFor={`${id}-l`}>Wavelength</label>
        <input id={`${id}-l`} type="range" min={0} max={1000} step={1} value={v} onChange={(e) => setV(+e.target.value)} style={{ ['--pp' as string]: `${v / 10}%` }} />
        <output>{nm >= 1000 ? `${(nm / 1000).toFixed(2)} µm` : `${nm < 100 ? nm.toFixed(1) : nm.toFixed(0)} nm`}</output>
      </div>
      <div className="readout">
        <span>
          Region <b>{band(nm)}</b>
        </span>
        <span>
          Photon energy <b>{eV >= 10 ? eV.toFixed(1) : eV >= 1 ? eV.toFixed(2) : eV.toFixed(3)} eV</b>
        </span>
        <span>
          Photons in 1 mJ <b>{sci(perMJ, 2)}</b>
        </span>
        <span>
          vs. EUV photon <b>{(eV / 91.84).toPrecision(2)}×</b>
        </span>
      </div>
    </Lab>
  );
}

// ═══════════════════════════ diffraction & numerical aperture ═══════════════════════════
const LAMBDA = 13.5;
const C0 = 0.5;
const C1 = 1 / Math.PI;
const NORM = (C0 + 2 * C1) ** 2;

export function ResolutionLab() {
  const id = useId();
  const [na, setNa] = useState(0.33);
  const [hp, setHp] = useState(16);
  const [illum, setIllum] = useState<'axis' | 'dipole'>('dipole');
  const pitch = 2 * hp;
  const s1 = LAMBDA / pitch; // sine of the first diffraction order angle (wafer side)
  const evan = s1 >= 1;
  const sill = illum === 'dipole' ? s1 / 2 : 0;
  const capture = illum === 'axis' ? !evan && s1 <= na : !evan && s1 / 2 <= na;
  const k1 = (hp * na) / LAMBDA;
  const kLimit = illum === 'axis' ? 0.5 : 0.25;

  // intensity over two pitches
  const prof = useMemo(() => {
    const pts: number[] = [];
    for (let i = 0; i <= 120; i++) {
      const ph = (2 * Math.PI * 2 * i) / 120;
      let I: number;
      if (!capture) I = C0 * C0;
      else if (illum === 'axis') I = (C0 + 2 * C1 * Math.cos(ph)) ** 2;
      else I = C0 * C0 + C1 * C1 + 2 * C0 * C1 * Math.cos(ph);
      pts.push(I / NORM);
    }
    return pts;
  }, [capture, illum]);
  const imax = Math.max(...prof);
  const imin = Math.min(...prof);
  const contrast = (imax - imin) / (imax + imin);

  const yc = 78;
  const K = 64 / 0.6;
  const yOf = (s: number) => yc - Math.max(-70, Math.min(70, K * s));
  const px0 = 22;
  const px1 = 168;
  const px2 = 300;
  const orders: { s: number; label: string }[] =
    illum === 'axis'
      ? [
          { s: 0, label: '0' },
          { s: s1, label: '+1' },
          { s: -s1, label: '−1' },
        ]
      : [
          { s: s1 / 2, label: '0' },
          { s: -s1 / 2, label: '−1' },
        ];
  const inside = (s: number) => !evan && Math.abs(s) <= na + 1e-9;
  const px = (x: number) => 40 + (x / 120) * 292;
  const py = (v: number) => 252 - v * 58;
  const path = prof.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(' ');

  return (
    <Lab title="Diffraction & numerical aperture lab" hint="λ = 13.5 nm, 4× reduction">
      <svg viewBox="0 0 360 290" role="img" aria-label={`Diffraction orders ${capture ? 'captured' : 'not captured'} by the projection optics`}>
        {/* mask grating */}
        <text className="svg-t strong" x={px0 - 8} y={14}>Mask pattern</text>
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x={px0 - 4} y={yc - 36 + i * 16} width={8} height={8} rx={1} fill="var(--fg-3)" />
        ))}
        {/* pupil */}
        <text className="svg-t strong" x={px1 - 22} y={14}>Pupil of the optics</text>
        <line x1={px1} y1={20} x2={px1} y2={yc - K * na} className="svg-axis" strokeWidth={3} stroke="var(--fg-3)" />
        <line x1={px1} y1={yc + K * na} x2={px1} y2={136} className="svg-axis" strokeWidth={3} stroke="var(--fg-3)" />
        <rect x={px1 - 4} y={yc - K * na} width={8} height={2 * K * na} rx={3} fill="var(--s1)" opacity={0.2} />
        <text className="svg-t" x={px1 + 8} y={yc - K * na + 4}>NA {na.toFixed(2)}</text>
        {/* wafer */}
        <text className="svg-t strong" x={px2 - 24} y={14}>Wafer image</text>
        <line x1={px2} y1={yc - 40} x2={px2} y2={yc + 40} stroke="var(--fg-3)" strokeWidth={3} />
        {orders.map((o) => {
          const y = yOf(o.s);
          const ok = inside(o.s);
          return (
            <g key={o.label}>
              <line x1={px0 + 4} y1={yc} x2={px1} y2={y} stroke={ok ? 'var(--s1)' : 'var(--fg-3)'} strokeWidth={ok ? 2 : 1.4} strokeDasharray={ok ? undefined : '4 3'} strokeLinecap="round" />
              {ok ? (
                <line x1={px1} y1={y} x2={px2} y2={yc} stroke="var(--s1)" strokeWidth={2} strokeLinecap="round" />
              ) : (
                <g stroke="#ff8587" strokeWidth={2} strokeLinecap="round">
                  <path d={`M${px1 - 4} ${y - 4}l8 8M${px1 + 4} ${y - 4}l-8 8`} />
                </g>
              )}
              <circle cx={px1} cy={y} r={4} fill={ok ? 'var(--s1)' : 'var(--bg-1)'} stroke={ok ? 'var(--bg-1)' : 'var(--fg-3)'} strokeWidth={2} />
              <text className="svg-t strong" x={px1 - 26} y={y + (y < yc ? -6 : 14)}>{o.label}</text>
            </g>
          );
        })}
        {evan && <text className="svg-t" x={px0 - 8} y={150} fill="#ff8587" style={{ fill: '#ff8587' }}>pitch &lt; λ: no propagating ±1 order</text>}
        {/* intensity plot */}
        <text className="svg-t strong" x={10} y={166}>Image intensity across two pitches</text>
        <line x1={40} y1={252} x2={332} y2={252} className="svg-axis" />
        <line x1={40} y1={172} x2={40} y2={252} className="svg-axis" />
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={40} y1={py(t)} x2={332} y2={py(t)} className="svg-grid" />
            <text className="svg-t faint" x={34} y={py(t) + 3} textAnchor="end">{t}</text>
          </g>
        ))}
        <path d={path} fill="none" stroke="var(--s1)" strokeWidth={2} strokeLinejoin="round" />
        <text className="svg-t faint" x={186} y={274} textAnchor="middle">position (pitch = {pitch.toFixed(1)} nm)</text>
      </svg>
      <div className="ctrl">
        <label htmlFor={`${id}-na`}>NA</label>
        <input id={`${id}-na`} type="range" min={0.2} max={0.6} step={0.01} value={na} onChange={(e) => setNa(+e.target.value)} style={{ ['--pp' as string]: `${((na - 0.2) / 0.4) * 100}%` }} />
        <output>{na.toFixed(2)}</output>
      </div>
      <div className="ctrl">
        <label htmlFor={`${id}-hp`}>Half-pitch</label>
        <input id={`${id}-hp`} type="range" min={6} max={30} step={0.5} value={hp} onChange={(e) => setHp(+e.target.value)} style={{ ['--pp' as string]: `${((hp - 6) / 24) * 100}%` }} />
        <output>{hp.toFixed(1)} nm</output>
      </div>
      <div className="ctrl" style={{ gridTemplateColumns: '92px 1fr' }}>
        <span>Illumination</span>
        <div className="seg" role="radiogroup" aria-label="Illumination">
          <button type="button" role="radio" aria-checked={illum === 'axis'} onClick={() => setIllum('axis')}>On-axis</button>
          <button type="button" role="radio" aria-checked={illum === 'dipole'} onClick={() => setIllum('dipole')}>Dipole</button>
        </div>
      </div>
      <div className="readout">
        <span className={`verdict ${capture ? 'ok' : 'bad'}`}>{capture ? 'Image forms' : 'No image'}</span>
        <span>
          k₁ = HP·NA/λ = <b>{k1.toFixed(2)}</b> (needs ≥ {kLimit})
        </span>
        <span>
          Contrast <b>{capture ? contrast.toFixed(2) : '0.00'}</b>
        </span>
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
        On-axis light needs the ±1 orders inside the NA: pitch ≥ λ/NA. A dipole tuned to the pitch only needs the 0 and one first order: pitch ≥ λ/(2NA). Idealised scalar model with a perfect binary grating.
      </p>
    </Lab>
  );
}

// ═══════════════════════════ resist profile chart (same model as the 3-D slab) ═══════════════════════════
const NM_PER_UNIT = 32 / 1.8; // illustrative: 32 nm pitch ↔ 1.8 scene units

export function ResistChart() {
  const tone = useSim((s) => s.tone);
  const dose = useSim((s) => s.dose);
  const m = useMemo(() => buildResistModel(108, 5.4, 3, dose), [dose]);
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const W = 360;
  const X0 = 38;
  const X1 = 350;
  const N = m.N;
  const px = (i: number) => X0 + (i / (N - 1)) * (X1 - X0);
  const py = (v: number) => 152 - v * 128;
  const line = (arr: Float32Array) => Array.from(arr).map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(' ');
  const idx = hover ?? Math.round(N * 0.5 + (m.P / (5.4 / N)) * 0.5); // default: first space centre
  const hi = Math.min(N - 1, Math.max(0, idx));

  const move = (e: PointerEvent<SVGSVGElement>) => {
    const r = ref.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.min(N - 1, Math.max(0, Math.round(((x - X0) / (X1 - X0)) * (N - 1)))));
  };
  const key = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowRight') setHover(Math.min(N - 1, hi + 2));
    else if (e.key === 'ArrowLeft') setHover(Math.max(0, hi - 2));
    else return;
    e.preventDefault();
  };
  const strips: { name: string; sol: Float32Array; on: boolean }[] = [
    { name: 'Positive tone', sol: m.solPos, on: tone !== 'negative' },
    { name: 'Negative tone', sol: m.solNeg, on: tone !== 'positive' },
  ];
  const segs = (sol: Float32Array) => {
    const out: [number, number][] = [];
    let s = -1;
    for (let i = 0; i < N; i++) {
      const keep = sol[i] < 0.5;
      if (keep && s < 0) s = i;
      if ((!keep || i === N - 1) && s >= 0) {
        out.push([s, keep && i === N - 1 ? i : i - 1]);
        s = -1;
      }
    }
    return out;
  };
  const posNm = (m.x[hi] * NM_PER_UNIT).toFixed(0);
  const ticks = [0, 0.5, 1];

  return (
    <Lab title="Resist response (same model as the 3-D cross-section)" hint={`dose ×${dose.toFixed(2)}`}>
      <div className="legend-row" aria-label="Legend">
        <span style={{ ['--k' as string]: 'var(--s1)' }}><i />Light (aerial image)</span>
        <span style={{ ['--k' as string]: 'var(--s2)' }}><i />Acid after exposure + bake</span>
        <span style={{ ['--k' as string]: 'var(--s3)' }}><i />Reaction extent</span>
      </div>
      <svg ref={ref} viewBox="0 0 360 232" role="img" tabIndex={0} aria-label="Aerial image, acid and reaction extent across three pitches, with the resist left after development for positive and negative tone" onPointerMove={move} onPointerLeave={() => setHover(null)} onKeyDown={key} style={{ touchAction: 'pan-y' }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={X0} y1={py(t)} x2={X1} y2={py(t)} className="svg-grid" />
            <text className="svg-t faint" x={X0 - 6} y={py(t) + 3} textAnchor="end">{t}</text>
          </g>
        ))}
        <line x1={X0} y1={py(0.5)} x2={X1} y2={py(0.5)} stroke="var(--fg-3)" strokeWidth={1} />
        <text className="svg-t faint" x={X1} y={py(0.5) - 4} textAnchor="end">dissolution threshold</text>
        <path d={line(m.aerial)} fill="none" stroke="var(--s1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <path d={line(m.acidDiff)} fill="none" stroke="var(--s2)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <path d={line(m.deprot)} fill="none" stroke="var(--s3)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {/* developed profile strips */}
        {strips.map((s, k) => (
          <g key={s.name} opacity={s.on ? 1 : 0.35}>
            <text className={`svg-t ${s.on ? 'strong' : ''}`} x={X0} y={176 + k * 28}>{s.name}: resist left after development</text>
            <rect x={X0} y={181 + k * 28} width={X1 - X0} height={14} rx={2} fill="var(--bg-3)" />
            {segs(s.sol).map(([a, b], j) => (
              <rect key={j} x={px(a)} y={181 + k * 28} width={Math.max(1, px(b + 1) - px(a))} height={14} rx={2} fill="var(--fg-3)" />
            ))}
          </g>
        ))}
        {/* crosshair */}
        <line x1={px(hi)} y1={py(1)} x2={px(hi)} y2={py(0)} stroke="var(--fg)" strokeWidth={1} opacity={hover === null ? 0.25 : 0.8} />
        {[
          [m.aerial[hi], 'var(--s1)'],
          [m.acidDiff[hi], 'var(--s2)'],
          [m.deprot[hi], 'var(--s3)'],
        ].map(([v, c], i) => (
          <circle key={i} cx={px(hi)} cy={py(v as number)} r={4} fill={c as string} stroke="var(--bg-1)" strokeWidth={2} />
        ))}
        <text className="svg-t faint" x={(X0 + X1) / 2} y={230} textAnchor="middle">position across 3 pitches (illustrative 32 nm pitch)</text>
      </svg>
      <div className="readout" aria-live="off">
        <span>
          x = <b>{posNm} nm</b>
        </span>
        <span>
          light <b>{m.aerial[hi].toFixed(2)}</b>
        </span>
        <span>
          acid <b>{m.acidDiff[hi].toFixed(2)}</b>
        </span>
        <span>
          reacted <b>{m.deprot[hi].toFixed(2)}</b>
        </span>
        <span>
          {tone === 'negative' ? 'negative' : 'positive'}: <b>{(tone === 'negative' ? m.solNeg : m.solPos)[hi] > 0.5 ? 'dissolves' : 'stays'}</b>
        </span>
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
        Move over the chart (or use the arrow keys). Change the dose in the controls bar: lines get narrower (positive) or wider (negative) as the dose rises.
      </p>
    </Lab>
  );
}

// ═══════════════════════════ pattern transfer, mask → etched film ═══════════════════════════
/**
 * One line pattern followed through every step, from the same 1-D model as the 3-D cross-section.
 * Dashed guides mark the absorber lines on the mask so each later row can be compared with them.
 */
export function PatternTransfer() {
  const tone = useSim((s) => s.tone);
  const dose = useSim((s) => s.dose);
  const m = useMemo(() => buildResistModel(108, 5.4, 3, dose), [dose]);
  const N = m.N;
  const X0 = 12;
  const X1 = 348;
  const cw = (X1 - X0) / N;
  const xs = (i: number) => X0 + i * cw;
  const acidMax = Math.max(...Array.from(m.acid));
  const absorber = (i: number) => {
    const d = (((m.x[i] / m.P) % 1) + 1) % 1;
    return d < 0.25 || d > 0.75;
  };
  const tones: ('positive' | 'negative')[] = tone === 'compare' ? ['positive', 'negative'] : [tone === 'negative' ? 'negative' : 'positive'];
  const kept = (t: 'positive' | 'negative', i: number) => (t === 'positive' ? m.solPos : m.solNeg)[i] < 0.5;

  type Row = { title: string; draw: (y: number) => ReactNode };
  const cols = (y: number, h: number, fill: string, alpha: (i: number) => number) =>
    Array.from({ length: N }, (_, i) => {
      const a = alpha(i);
      return a > 0.01 ? <rect key={i} x={xs(i)} y={y} width={cw + 0.35} height={h} fill={fill} opacity={a} /> : null;
    });
  const rows: Row[] = [
    {
      title: '1 · Mask: dark absorber, bright mirror (4× larger)',
      draw: (y) => (
        <>
          <rect x={X0} y={y} width={X1 - X0} height={12} fill="var(--c-mask)" opacity={0.75} />
          {cols(y, 12, 'var(--bg-0)', (i) => (absorber(i) ? 1 : 0))}
        </>
      ),
    },
    { title: '2 · Light on the resist: edges blurred by diffraction', draw: (y) => cols(y, 12, 'var(--c-euv)', (i) => m.aerial[i]) },
    { title: '3 · Exposure (scanner): acid where light is bright', draw: (y) => cols(y, 12, 'var(--c-plasma)', (i) => m.acid[i] / acidMax) },
    { title: '4 · Bake (track): acid spreads, drives the reaction', draw: (y) => cols(y, 12, 'var(--c-resist)', (i) => m.deprot[i]) },
  ];
  for (const t of tones) {
    const name = t === 'positive' ? 'positive' : 'negative';
    rows.push({
      title: `5 · Develop (track, ${name}): ${t === 'positive' ? 'reacted resist dissolves' : 'unreacted resist dissolves'}`,
      draw: (y) => (
        <>
          <rect x={X0} y={y + 7} width={X1 - X0} height={5} fill="var(--c-etch)" opacity={0.7} />
          {cols(y, 7, 'var(--c-resist)', (i) => (kept(t, i) ? 1 : 0))}
        </>
      ),
    });
    rows.push({
      title: `6 · Etch + strip (${name}): film kept only under resist`,
      draw: (y) => (
        <>
          <rect x={X0} y={y + 9} width={X1 - X0} height={3} fill="var(--c-silicon)" opacity={0.6} />
          {cols(y + 3, 6, 'var(--c-etch)', (i) => (kept(t, i) ? 1 : 0))}
        </>
      ),
    });
  }
  const ROW_H = 31;
  const H = rows.length * ROW_H + 6;
  const guides = [-1, 0, 1].map((k) => X0 + ((k * m.P + m.W / 2) / m.W) * (X1 - X0));

  return (
    <Lab title="Pattern transfer: from mask to chip layer" hint={`${tone === 'compare' ? 'both tones' : `${tones[0]} tone`} · dose ×${dose.toFixed(2)}`}>
      <svg viewBox={`0 0 360 ${H}`} role="img" data-testid="transfer-lab" aria-label={`Six steps across three repeats of a line pattern: mask, light on the wafer, acid after exposure, reaction after bake, resist after development and film after etching, for ${tones.join(' and ')} tone.`}>
        {rows.map((r, k) => {
          const y = k * ROW_H;
          return (
            <g key={r.title}>
              <text className="svg-t" x={X0} y={y + 10}>{r.title}</text>
              {r.draw(y + 15)}
            </g>
          );
        })}
        {guides.map((x, k) => (
          <line key={k} x1={x} y1={14} x2={x} y2={H - 4} stroke="var(--fg-3)" strokeWidth={1} strokeDasharray="2 3" opacity={0.7} />
        ))}
      </svg>
      <p className="muted" style={{ fontSize: 12.5 }}>
        Dashed lines mark the absorber lines of the mask. With positive tone the film survives under them; with negative tone it survives between them. Change the Resist and Dose controls to see the result move.
      </p>
      <p className="muted" style={{ fontSize: 12.5 }}>
        Illustrative: this is the same simplified one-dimensional model as the 3-D cross-section. Real blur, thresholds and line widths depend on the scanner settings and on the resist formulation.
      </p>
    </Lab>
  );
}

// ═══════════════════════════ multilayer & mask diagrams ═══════════════════════════
export function MultilayerDiagram() {
  const pairs = 13;
  const y0 = 70;
  const mo = 2.4;
  const si = 3.8;
  const pitch = mo + si;
  const layers: ReactNode[] = [];
  for (let i = 0; i < pairs; i++) {
    layers.push(<rect key={`m${i}`} x={60} y={y0 + i * pitch} width={240} height={mo} fill="#8696bf" />);
    layers.push(<rect key={`s${i}`} x={60} y={y0 + i * pitch + mo} width={240} height={si} fill="#3a4768" />);
  }
  const yBottom = y0 + pairs * pitch;
  const hit = [0, 1, 2, 3, 4, 5].map((k) => ({ y: y0 + k * pitch * 1.8, a: 1 - k * 0.15 }));
  return (
    <Lab title="Why a multilayer reflects EUV" hint="angle exaggerated">
      <svg viewBox="0 0 360 200" role="img" aria-label="Incident EUV ray partially reflecting from every Mo/Si interface; the reflected rays add up in phase">
        <rect x={60} y={yBottom} width={240} height={16} fill="var(--bg-4)" />
        {layers}
        <text className="svg-t faint" x={180} y={yBottom + 12} textAnchor="middle">substrate</text>
        {/* incident ray */}
        <line x1={60} y1={14} x2={150} y2={y0 - 2} stroke="var(--s1)" strokeWidth={2} strokeLinecap="round" />
        <path d="M144 58l6 10-11 -3z" fill="var(--s1)" />
        {/* partial reflections from interfaces, drawn emerging in parallel */}
        {hit.map((h, i) => (
          <g key={i} opacity={Math.max(0.25, h.a)}>
            <line x1={150 + (h.y - y0) * 0.55} y1={h.y} x2={240 + (h.y - y0) * 0.55 - 0} y2={14 + (h.y - y0) * 0.05 - 0} stroke="var(--s1)" strokeWidth={1.6} strokeLinecap="round" strokeDasharray={i ? '1 0' : undefined} />
          </g>
        ))}
        <text className="svg-t strong" x={14} y={12}>13.5 nm in</text>
        <text className="svg-t strong" x={262} y={30}>reflected: all in phase</text>
        <g>
          <line x1={312} y1={y0} x2={312} y2={y0 + pitch} stroke="var(--fg)" strokeWidth={1.4} />
          <text className="svg-t strong" x={318} y={y0 + 7}>d ≈ 6.9 nm</text>
          <text className="svg-t" x={318} y={y0 + 19}>one Mo + Si pair</text>
        </g>
        <rect x={60} y={y0 - 5} width={240} height={3} fill="var(--c-etch)" opacity={0.8} />
        <text className="svg-t faint" x={64} y={y0 - 8}>capping layer</text>
        <text className="svg-t" x={14} y={yBottom - 6}>~40–50</text>
        <text className="svg-t" x={14} y={yBottom + 6}>pairs</text>
      </svg>
      <div className="legend-row">
        <span style={{ ['--k' as string]: '#8696bf' }}><i />Mo (n ≈ 0.92)</span>
        <span style={{ ['--k' as string]: '#3a4768' }}><i />Si (n ≈ 0.999)</span>
      </div>
      <p className="muted" style={{ fontSize: 12.5 }}>
        Each interface reflects only a fraction of a percent, but the period is chosen so the reflections from ~40–50 interfaces add up in phase (m·λ = 2·d·cosθ), giving ≈ 65–70% in total.
      </p>
    </Lab>
  );
}

export function MaskDiagram() {
  const yTop = 104;
  const lines: ReactNode[] = [];
  for (let i = 0; i < 14; i++) lines.push(<rect key={i} x={30} y={yTop + 6 + i * 3.6} width={300} height={1.8} fill="#8696bf" />);
  return (
    <Lab title="Mask cross-section" hint="not to scale; angle exaggerated">
      <svg viewBox="0 0 360 210" role="img" aria-label="Reflective EUV mask: glass substrate, Mo/Si multilayer, patterned absorber. Rays that meet the multilayer reflect; rays that meet the absorber are absorbed.">
        <rect x={30} y={yTop + 56} width={300} height={26} fill="var(--bg-4)" />
        <text className="svg-t faint" x={180} y={yTop + 73} textAnchor="middle">low-thermal-expansion glass</text>
        <rect x={30} y={yTop} width={300} height={56} fill="#1d2740" />
        {lines}
        <text className="svg-t" x={180} y={yTop + 40} textAnchor="middle" style={{ fill: '#cfd9ee' }}>Mo/Si multilayer (~40 pairs)</text>
        {[[70, 56], [210, 90]].map(([x, w], i) => (
          <g key={i}>
            <rect x={x} y={yTop - 14} width={w} height={14} fill="#0e121c" stroke="var(--fg-3)" strokeWidth={1} />
          </g>
        ))}
        <text className="svg-t" x={98} y={yTop - 20} textAnchor="middle">absorber (Ta-based)</text>
        {/* ray reflecting from open multilayer */}
        <line x1={140} y1={20} x2={160} y2={yTop - 1} stroke="var(--s1)" strokeWidth={2} strokeLinecap="round" />
        <line x1={160} y1={yTop - 1} x2={184} y2={20} stroke="var(--s1)" strokeWidth={2} strokeLinecap="round" />
        <text className="svg-t strong" x={196} y={30}>reflected: bright</text>
        {/* ray absorbed by the absorber */}
        <line x1={40} y1={20} x2={86} y2={yTop - 14} stroke="var(--s3)" strokeWidth={2} strokeLinecap="round" />
        <text className="svg-t strong" x={14} y={14}>absorbed: dark</text>
        <path d="M82 84l8 6M90 84l-8 6" stroke="var(--s3)" strokeWidth={2} strokeLinecap="round" transform="translate(0,-10)" />
        {/* shadow */}
        <path d={`M214 ${yTop - 14}l-14 14`} stroke="var(--fg-3)" strokeWidth={1} />
        <text className="svg-t faint" x={318} y={yTop - 22} textAnchor="end">absorber height casts a</text>
        <text className="svg-t faint" x={318} y={yTop - 10} textAnchor="end">shadow at the 6° angle</text>
      </svg>
      <p className="muted" style={{ fontSize: 12.5 }}>
        Light is absorbed wherever the absorber sits and reflected everywhere else, so the reflected beam carries the circuit pattern.
      </p>
    </Lab>
  );
}

// ═══════════════════════════ vacuum / Beer–Lambert ═══════════════════════════
const KB_T = 1.380649e-23 * 300;
const SIGMA = { air: 3.5e-22, h2: 4e-24 }; // order-of-magnitude photoabsorption cross-sections at 92 eV (m²)

export function BeerLab() {
  const id = useId();
  const [lp, setLp] = useState(1); // log10 pressure in Pa
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const P = Math.pow(10, lp);
  const n = P / KB_T;
  const L = (s: number) => 1 / (n * s);
  const Tfun = (s: number, x: number) => Math.exp(-n * s * x);
  const xMin = -5;
  const xMax = 2;
  const X0 = 40;
  const X1 = 344;
  const N = 100;
  const xs = Array.from({ length: N + 1 }, (_, i) => Math.pow(10, xMin + ((xMax - xMin) * i) / N));
  const px = (lx: number) => X0 + ((lx - xMin) / (xMax - xMin)) * (X1 - X0);
  const py = (t: number) => 140 - t * 120;
  const mk = (s: number) => xs.map((x, i) => `${i ? 'L' : 'M'}${px(Math.log10(x)).toFixed(1)} ${py(Tfun(s, x)).toFixed(1)}`).join(' ');
  const fmtLen = (x: number) => (x >= 1 ? `${x.toPrecision(2)} m` : x >= 1e-2 ? `${(x * 100).toPrecision(2)} cm` : x >= 1e-3 ? `${(x * 1e3).toPrecision(2)} mm` : `${(x * 1e6).toPrecision(2)} µm`);
  const hi = hover === null ? 60 : hover; // default marker near 1 m
  const hx = xs[Math.max(0, Math.min(N, hi))];
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const r = ref.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 360;
    setHover(Math.max(0, Math.min(N, Math.round(((x - X0) / (X1 - X0)) * N))));
  };
  const ticks = [-5, -4, -3, -2, -1, 0, 1, 2];
  const tl = ['10 µm', '0.1 mm', '1 mm', '1 cm', '10 cm', '1 m', '10 m', '100 m'];
  return (
    <Lab title="Beer–Lambert absorption lab" hint="order-of-magnitude cross-sections">
      <div className="legend-row">
        <span style={{ ['--k' as string]: 'var(--s3)' }}><i />Air (N₂/O₂)</span>
        <span style={{ ['--k' as string]: 'var(--s1)' }}><i />Hydrogen</span>
      </div>
      <svg ref={ref} viewBox="0 0 360 178" role="img" aria-label="Fraction of 13.5 nm light that survives versus distance for air and hydrogen" onPointerMove={move} onPointerLeave={() => setHover(null)} style={{ touchAction: 'pan-y' }}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={X0} y1={py(t)} x2={X1} y2={py(t)} className="svg-grid" />
            <text className="svg-t faint" x={X0 - 6} y={py(t) + 3} textAnchor="end">{t * 100}%</text>
          </g>
        ))}
        {ticks.map((t, i) => (
          <text key={t} className="svg-t faint" x={px(t)} y={156} textAnchor="middle">{tl[i]}</text>
        ))}
        <path d={mk(SIGMA.air)} fill="none" stroke="var(--s3)" strokeWidth={2} strokeLinecap="round" />
        <path d={mk(SIGMA.h2)} fill="none" stroke="var(--s1)" strokeWidth={2} strokeLinecap="round" />
        <line x1={px(Math.log10(hx))} y1={py(1)} x2={px(Math.log10(hx))} y2={py(0)} stroke="var(--fg)" strokeWidth={1} opacity={hover === null ? 0.2 : 0.8} />
        <circle cx={px(Math.log10(hx))} cy={py(Tfun(SIGMA.air, hx))} r={4} fill="var(--s3)" stroke="var(--bg-1)" strokeWidth={2} />
        <circle cx={px(Math.log10(hx))} cy={py(Tfun(SIGMA.h2, hx))} r={4} fill="var(--s1)" stroke="var(--bg-1)" strokeWidth={2} />
        <text className="svg-t faint" x={(X0 + X1) / 2} y={174} textAnchor="middle">distance travelled (log scale)</text>
      </svg>
      <div className="ctrl">
        <label htmlFor={`${id}-p`}>Pressure</label>
        <input id={`${id}-p`} type="range" min={-1} max={5} step={0.05} value={lp} onChange={(e) => setLp(+e.target.value)} style={{ ['--pp' as string]: `${((lp + 1) / 6) * 100}%` }} />
        <output>{P >= 1e4 ? `${(P / 101325).toFixed(2)} atm` : `${P < 1 ? P.toFixed(2) : P.toFixed(0)} Pa`}</output>
      </div>
      <div className="seg" role="group" aria-label="Pressure presets" style={{ marginBottom: 6 }}>
        <button type="button" role="radio" aria-checked={Math.abs(lp - 1) < 0.01} onClick={() => setLp(1)}>10 Pa (scanner-like)</button>
        <button type="button" role="radio" aria-checked={Math.abs(lp - Math.log10(101325)) < 0.01} onClick={() => setLp(Math.log10(101325))}>1 atm</button>
      </div>
      <div className="readout">
        <span>
          1/e length, air <b>{fmtLen(L(SIGMA.air))}</b>
        </span>
        <span>
          hydrogen <b>{fmtLen(L(SIGMA.h2))}</b>
        </span>
        <span>
          at {fmtLen(hx)}: air <b>{(Tfun(SIGMA.air, hx) * 100).toFixed(Tfun(SIGMA.air, hx) < 0.01 ? 3 : 1)}%</b>, H₂ <b>{(Tfun(SIGMA.h2, hx) * 100).toFixed(1)}%</b>
        </span>
      </div>
    </Lab>
  );
}

export function WidgetFor({ id }: { id: string }) {
  switch (id) {
    case 'photon':
      return <PhotonLab />;
    case 'resolution':
      return <ResolutionLab />;
    case 'resist':
      return <ResistChart />;
    case 'multilayer':
      return <MultilayerDiagram />;
    case 'mask':
      return <MaskDiagram />;
    case 'transfer':
      return <PatternTransfer />;
    case 'beer':
      return <BeerLab />;
    default:
      return null;
  }
}

export { sim };
