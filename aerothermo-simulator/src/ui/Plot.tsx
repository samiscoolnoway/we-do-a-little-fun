import { fmt, niceTicks } from '../viz/colormap';

/** Small SVG line plot with labelled axes and units; every series is drawn from computed arrays. */
export interface Series {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  label: string;
  className?: string;
  dashed?: boolean;
}

export function LinePlot(props: {
  series: Series[];
  xLabel: string;
  yLabel: string;
  title: string;
  markers?: { x: number; label: string }[];
  yMin?: number;
  testid?: string;
  height?: number;
}) {
  const W = 340;
  const H = props.height ?? 180;
  const pad = { l: 52, r: 10, t: 10, b: 34 };
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = props.yMin ?? Infinity,
    y1 = -Infinity;
  for (const s of props.series)
    for (let k = 0; k < s.x.length; k++) {
      if (!Number.isFinite(s.y[k])) continue;
      x0 = Math.min(x0, s.x[k]);
      x1 = Math.max(x1, s.x[k]);
      y0 = Math.min(y0, s.y[k]);
      y1 = Math.max(y1, s.y[k]);
    }
  if (!(x1 > x0) || !(y1 >= y0)) return <div className="plot-empty">No data to plot yet.</div>;
  if (y1 === y0) y1 = y0 + 1;
  const yt = niceTicks(y0, y1, 4);
  const xt = niceTicks(x0, x1, 5);
  const X = (v: number) => pad.l + ((v - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const Y = (v: number) => pad.t + ((y1 - v) / (y1 - y0)) * (H - pad.t - pad.b);
  return (
    <figure className="plot" data-testid={props.testid}>
      <figcaption>{props.title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${props.title}: ${props.yLabel} versus ${props.xLabel}`}>
        {yt.map((t) => (
          <g key={`y${t}`}>
            <line x1={pad.l} x2={W - pad.r} y1={Y(t)} y2={Y(t)} className="grid" />
            <text x={pad.l - 4} y={Y(t) + 3} className="tick" textAnchor="end">
              {fmt(t, 3)}
            </text>
          </g>
        ))}
        {xt.map((t) => (
          <text key={`x${t}`} x={X(t)} y={H - pad.b + 13} className="tick" textAnchor="middle">
            {fmt(t, 3)}
          </text>
        ))}
        {props.markers?.map((m) => (
          <g key={m.label}>
            <line x1={X(m.x)} x2={X(m.x)} y1={pad.t} y2={H - pad.b} className="marker" />
            <text x={X(m.x) + 3} y={pad.t + 10} className="tick">
              {m.label}
            </text>
          </g>
        ))}
        {props.series.map((s) => {
          let d = '';
          for (let k = 0; k < s.x.length; k++) if (Number.isFinite(s.y[k])) d += `${d ? 'L' : 'M'}${X(s.x[k]).toFixed(1)},${Y(s.y[k]).toFixed(1)}`;
          return <path key={s.label} d={d} className={`series ${s.className ?? ''}`} strokeDasharray={s.dashed ? '5 3' : undefined} />;
        })}
        <text x={(pad.l + W - pad.r) / 2} y={H - 4} className="axis-label" textAnchor="middle">
          {props.xLabel}
        </text>
        <text x={11} y={(pad.t + H - pad.b) / 2} className="axis-label" textAnchor="middle" transform={`rotate(-90 11 ${(pad.t + H - pad.b) / 2})`}>
          {props.yLabel}
        </text>
      </svg>
      {props.series.length > 1 && (
        <div className="plot-note">
          {props.series.map((s) => (
            <span key={s.label} className="legend-item">
              <span className={`key ${s.className?.includes('heat') ? 'heat' : s.className?.includes('muted') ? 'muted' : 'cool'}${s.dashed ? ' dashed' : ''}`} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </figure>
  );
}
