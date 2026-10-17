import { useEffect, useMemo, useRef, useState } from 'react';
import { freestreamOf } from '../core/config';
import { FIELD_INFO, type FieldName } from '../core/simulation';
import { type Camera, fit, panBy, toWorld, zoomAt } from '../viz/camera';
import { type ColormapName, colormapCss, fmt, niceTicks } from '../viz/colormap';
import { FieldRenderer } from '../viz/fieldRenderer';
import { type GridLike, buildLocator, nodeAverage, traceStreamline } from '../viz/locate';
import { type OverlayTheme, clear, drawBody, drawFreestream, drawMesh, drawProbe, drawScaleBar, drawStreamlines, drawVectors, label } from '../viz/overlay';
import { store, useStore } from './store';

export const DIVERGING_FIELDS: FieldName[] = ['v', 'cp'];
export const colormapFor = (f: FieldName): ColormapName => (DIVERGING_FIELDS.includes(f) ? 'diverging' : 'viridis');

/** display range of a cell field: min…max, or symmetric about zero for signed fields */
export function fieldRange(f: FieldName, vals: Float32Array): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < vals.length; k++) {
    if (vals[k] < lo) lo = vals[k];
    if (vals[k] > hi) hi = vals[k];
  }
  if (colormapFor(f) === 'diverging') {
    const a = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    return [-a, a];
  }
  if (!(hi > lo)) return [lo - 0.5 * (Math.abs(lo) || 1), hi + 0.5 * (Math.abs(hi) || 1)];
  return [lo, hi];
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function FlowView() {
  const mesh = useStore((s) => s.mesh);
  const snap = useStore((s) => s.snap);
  const view = useStore((s) => s.view);
  const probe = useStore((s) => s.probe);
  const run = useStore((s) => s.run);
  const wrapRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const ovRef = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<FieldRenderer | null>(null);
  const [cam, setCam] = useState<Camera | null>(null);
  const [size, setSize] = useState<[number, number]>([0, 0]);
  const [themeTick, setThemeTick] = useState(0);
  const fittedFor = useRef<string>('');

  const grid: GridLike | null = useMemo(() => (mesh ? { ni: mesh.ni, nj: mesh.nj, x: mesh.x, y: mesh.y, area: mesh.area, periodicI: true } : null), [mesh]);
  const loc = useMemo(() => (grid ? buildLocator(grid) : null), [grid]);
  const values = snap?.fields[view.field] ?? null;
  const range = useMemo(() => (values ? fieldRange(view.field, values) : ([0, 1] as [number, number])), [values, view.field]);
  const nodes = useMemo(() => (grid && values && view.smooth ? nodeAverage(grid, values) : null), [grid, values, view.smooth]);
  const H = run.body.radius;
  const fs = useMemo(() => freestreamOf(run), [run]);

  const streamlines = useMemo(() => {
    if (!view.streamlines || !grid || !loc || !snap) return [];
    const nu = nodeAverage(grid, snap.fields.u);
    const nv = nodeAverage(grid, snap.fields.v);
    const a = (run.flow.angle * Math.PI) / 180;
    const out: Float32Array[] = [];
    const n = 23;
    for (let k = 0; k < n; k++) {
      const t = (k / (n - 1) - 0.5) * 6 * H;
      const x0 = -4 * H * Math.cos(a) - t * Math.sin(a);
      const y0 = -4 * H * Math.sin(a) + t * Math.cos(a);
      out.push(traceStreamline(grid, loc, nu, nv, x0, y0, fs.V, 3000));
    }
    return out;
  }, [view.streamlines, grid, loc, snap, run.flow.angle, H, fs.V]);

  // renderer
  useEffect(() => {
    if (glRef.current && !renderer.current) renderer.current = new FieldRenderer(glRef.current);
  }, []);
  useEffect(() => {
    if (mesh && renderer.current) renderer.current.setMesh(mesh.ni, mesh.nj, mesh.x, mesh.y);
  }, [mesh]);
  useEffect(() => {
    renderer.current?.setColormap(colormapFor(view.field));
  }, [view.field]);
  useEffect(() => {
    if (values && renderer.current) renderer.current.setValues(values, nodes);
  }, [values, nodes, mesh]);

  // size tracking and theme changes
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize([el.clientWidth, el.clientHeight]));
    ro.observe(el);
    setSize([el.clientWidth, el.clientHeight]);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onTheme = () => setThemeTick((t) => t + 1);
    mq.addEventListener('change', onTheme);
    return () => {
      ro.disconnect();
      mq.removeEventListener('change', onTheme);
    };
  }, []);

  // fit the view to the body when the geometry changes; keep user pan/zoom otherwise
  useEffect(() => {
    const [w, h] = size;
    if (!w || !h) return;
    const key = `${run.body.kind}:${H}:${run.body.aspect}`;
    setCam((c) => {
      if (!c || fittedFor.current !== key) {
        fittedFor.current = key;
        return fit(w, h, -3.2 * H, 4.8 * H, -2.6 * H, 2.6 * H);
      }
      return { ...c, width: w, height: h };
    });
  }, [size, H, run.body.kind, run.body.aspect]);

  // draw
  useEffect(() => {
    if (!cam || !renderer.current || !ovRef.current) return;
    const r = renderer.current;
    r.draw(cam, range[0], range[1], css('--field-bg') || '#1b2229');
    const ctx = ovRef.current.getContext('2d')!;
    clear(ctx, cam);
    const t: OverlayTheme = {
      body: css('--body-fill'),
      bodyEdge: css('--body-edge'),
      mesh: css('--mesh-line'),
      arrow: css('--arrow'),
      stream: css('--stream'),
      probe: css('--probe'),
      text: css('--overlay-text'),
      halo: css('--overlay-halo'),
    };
    if (grid && view.mesh) drawMesh(ctx, cam, grid, t, grid.ni > 200 ? 2 : 1);
    if (streamlines.length) drawStreamlines(ctx, cam, streamlines, t);
    if (snap && loc && view.vectors) drawVectors(ctx, cam, loc, snap.fields.u, snap.fields.v, Math.max(fs.V, 1e-9), t);
    if (mesh) drawBody(ctx, cam, mesh.bodyX, mesh.bodyY, t);
    if (probe && loc && mesh) {
      const h = loc.locate(probe.x, probe.y);
      const W = mesh.ni + 1;
      drawProbe(ctx, cam, probe.x, probe.y, t, h ? { x: mesh.x, y: mesh.y, corners: [h.j * W + h.i, h.j * W + h.i + 1, (h.j + 1) * W + h.i + 1, (h.j + 1) * W + h.i] } : undefined);
    }
    drawFreestream(ctx, run.flow.mach, run.flow.angle, t);
    drawScaleBar(ctx, cam, t);
    if (!r.webgl) label(ctx, 'WebGL unavailable: flat cells drawn with Canvas 2D', cam.width - 12, 20, t, 'right');
  }, [cam, range, values, nodes, grid, loc, view.mesh, view.vectors, streamlines, snap, mesh, probe, run, fs.V, themeTick]);

  // interaction: drag = pan, wheel / pinch = zoom, click = probe
  const drag = useRef<{ x: number; y: number; moved: number; id: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number>(0);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const [x, y] = local(e);
    pointers.current.set(e.pointerId, { x, y });
    if (pointers.current.size === 1) drag.current = { x, y, moved: 0, id: e.pointerId };
    else {
      drag.current = null;
      const [a, b] = [...pointers.current.values()];
      pinch.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const [x, y] = local(e);
    pointers.current.set(e.pointerId, { x, y });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current > 0) setCam((c) => (c ? zoomAt(c, (a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch.current) : c));
      pinch.current = d;
      return;
    }
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = x - d.x;
    const dy = y - d.y;
    d.moved += Math.abs(dx) + Math.abs(dy);
    d.x = x;
    d.y = y;
    if (d.moved > 4) setCam((c) => (c ? panBy(c, dx, dy) : c));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    pointers.current.delete(e.pointerId);
    if (d && d.id === e.pointerId && d.moved <= 4 && cam) {
      const [x, y] = local(e);
      const [wx, wy] = toWorld(cam, x, y);
      store.setProbe({ x: wx, y: wy });
    }
    if (pointers.current.size < 2) pinch.current = 0;
    drag.current = null;
  };
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setCam((c) => (c ? zoomAt(c, e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015)) : c));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const fitBody = () => size[0] && setCam(fit(size[0], size[1], -3.2 * H, 4.8 * H, -2.6 * H, 2.6 * H));
  const fitDomain = () => {
    if (!size[0] || !loc) return;
    const [x0, y0, x1, y1] = loc.bbox;
    setCam(fit(size[0], size[1], x0, x1, y0, y1));
  };
  const zoom = (f: number) => setCam((c) => (c ? zoomAt(c, c.width / 2, c.height / 2, f) : c));

  const info = FIELD_INFO[view.field];
  return (
    <div className="flowview">
      <div
        className="canvas-wrap"
        ref={wrapRef}
        data-testid="flow-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="img"
        aria-label={`${info.label} around the body, computed by the 2D Euler solver. Click to place the probe.`}
      >
        <canvas ref={glRef} className="layer" />
        <canvas ref={ovRef} className="layer" />
        <div className="view-badges">
          <span className="badge">2D planar flow</span>
          <span className="badge">Inviscid Euler</span>
          <span className="badge subtle">{view.smooth ? 'smoothed for display' : 'cell values'}</span>
        </div>
        <div className="view-buttons">
          <button onClick={() => zoom(1.25)} aria-label="Zoom in" title="Zoom in">+</button>
          <button onClick={() => zoom(0.8)} aria-label="Zoom out" title="Zoom out">−</button>
          <button onClick={fitBody} title="Fit the body">Body</button>
          <button onClick={fitDomain} title="Show the whole computational domain">Domain</button>
        </div>
        {!snap && <div className="canvas-msg">Building mesh…</div>}
      </div>
      <Legend field={view.field} range={range} values={values} />
    </div>
  );
}

function Legend({ field, range, values }: { field: FieldName; range: [number, number]; values: Float32Array | null }) {
  const info = FIELD_INFO[field];
  const ticks = niceTicks(range[0], range[1], 7);
  let lo = Infinity;
  let hi = -Infinity;
  if (values) for (let k = 0; k < values.length; k++) (lo = Math.min(lo, values[k])), (hi = Math.max(hi, values[k]));
  return (
    <div className="legend" data-testid="legend">
      <div className="legend-title">
        {info.label} <span className="unit">[{info.unit}]</span>
      </div>
      <div className="legend-bar" style={{ background: colormapCss(colormapFor(field)) }} />
      <div className="legend-ticks">
        {ticks.map((t) => (
          <span key={t} style={{ left: `${((t - range[0]) / (range[1] - range[0])) * 100}%` }}>
            {fmt(t, 3)}
          </span>
        ))}
      </div>
      {values && (
        <div className="legend-minmax">
          computed range {fmt(lo, 4)} … {fmt(hi, 4)} {info.unit !== '–' ? info.unit : ''}
        </div>
      )}
    </div>
  );
}
