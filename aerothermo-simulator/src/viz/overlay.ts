import { type Camera, toScreen, toWorld } from './camera';
import { fmt } from './colormap';
import type { GridLike, Locator } from './locate';

/** Vector overlays drawn on a 2D canvas above the field: body, mesh lines, velocity arrows, streamlines, probe. */
export interface OverlayTheme {
  body: string;
  bodyEdge: string;
  mesh: string;
  arrow: string;
  stream: string;
  probe: string;
  text: string;
  halo: string;
}

export function clear(ctx: CanvasRenderingContext2D, cam: Camera) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(cam.width * dpr));
  const h = Math.max(1, Math.round(cam.height * dpr));
  if (ctx.canvas.width !== w || ctx.canvas.height !== h) {
    ctx.canvas.width = w;
    ctx.canvas.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cam.width, cam.height);
}

export function drawBody(ctx: CanvasRenderingContext2D, cam: Camera, bx: Float64Array, by: Float64Array, t: OverlayTheme) {
  ctx.beginPath();
  for (let k = 0; k < bx.length; k++) {
    const [px, py] = toScreen(cam, bx[k], by[k]);
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = t.body;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = t.bodyEdge;
  ctx.stroke();
}

/** grid lines of constant j (around the body) and constant i (radial); `stride` skips lines on fine meshes */
export function drawMesh(ctx: CanvasRenderingContext2D, cam: Camera, m: GridLike, t: OverlayTheme, stride = 1) {
  const { ni, nj, x, y } = m;
  const W = ni + 1;
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = t.mesh;
  ctx.beginPath();
  for (let j = 0; j <= nj; j += stride) {
    for (let i = 0; i <= ni; i++) {
      const [px, py] = toScreen(cam, x[j * W + i], y[j * W + i]);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
  }
  for (let i = 0; i < ni; i += stride) {
    for (let j = 0; j <= nj; j++) {
      const [px, py] = toScreen(cam, x[j * W + i], y[j * W + i]);
      if (j === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
  }
  ctx.stroke();
}

/**
 * Velocity arrows on a regular screen-space lattice (every `spacing` px): each arrow shows the velocity of the
 * cell under its tail (the computed cell value, not interpolated). Length ∝ |V| / vmax.
 */
export function drawVectors(ctx: CanvasRenderingContext2D, cam: Camera, loc: Locator, u: Float32Array, v: Float32Array, vmax: number, t: OverlayTheme, spacing = 34) {
  ctx.strokeStyle = t.arrow;
  ctx.fillStyle = t.arrow;
  ctx.lineWidth = 1.2;
  const L = spacing * 0.85;
  for (let sy = spacing / 2; sy < cam.height; sy += spacing)
    for (let sx = spacing / 2; sx < cam.width; sx += spacing) {
      const [wx, wy] = toWorld(cam, sx, sy);
      const h = loc.locate(wx, wy);
      if (!h) continue;
      const vx = u[h.cell];
      const vy = v[h.cell];
      const sp = Math.hypot(vx, vy);
      if (sp < 1e-9 * vmax) continue;
      const len = (L * sp) / vmax;
      const dx = (vx / sp) * len;
      const dy = (-vy / sp) * len;
      const x0 = sx - dx / 2;
      const y0 = sy - dy / 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + dx, y0 + dy);
      ctx.stroke();
      const hl = Math.min(6, 0.35 * len);
      if (hl > 1.5) {
        const ux = dx / len;
        const uy = dy / len;
        ctx.beginPath();
        ctx.moveTo(x0 + dx, y0 + dy);
        ctx.lineTo(x0 + dx - hl * ux - 0.5 * hl * uy, y0 + dy - hl * uy + 0.5 * hl * ux);
        ctx.lineTo(x0 + dx - hl * ux + 0.5 * hl * uy, y0 + dy - hl * uy - 0.5 * hl * ux);
        ctx.closePath();
        ctx.fill();
      }
    }
}

export function drawStreamlines(ctx: CanvasRenderingContext2D, cam: Camera, lines: Float32Array[], t: OverlayTheme) {
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = t.stream;
  for (const pts of lines) {
    if (pts.length < 4) continue;
    ctx.beginPath();
    for (let k = 0; k < pts.length; k += 2) {
      const [px, py] = toScreen(cam, pts[k], pts[k + 1]);
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
}

export function drawProbe(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, t: OverlayTheme, cell?: { x: Float64Array; y: Float64Array; corners: number[] }) {
  if (cell) {
    ctx.beginPath();
    cell.corners.forEach((n, k) => {
      const [px, py] = toScreen(cam, cell.x[n], cell.y[n]);
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = t.probe;
    ctx.stroke();
  }
  const [px, py] = toScreen(cam, x, y);
  ctx.lineWidth = 3;
  ctx.strokeStyle = t.halo;
  ctx.beginPath();
  ctx.arc(px, py, 7, 0, 2 * Math.PI);
  ctx.moveTo(px - 12, py);
  ctx.lineTo(px + 12, py);
  ctx.moveTo(px, py - 12);
  ctx.lineTo(px, py + 12);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = t.probe;
  ctx.stroke();
}

/** scale bar (bottom left) with a round length in metres */
export function drawScaleBar(ctx: CanvasRenderingContext2D, cam: Camera, t: OverlayTheme) {
  const target = 120 / cam.scale;
  const mag = Math.pow(10, Math.floor(Math.log10(target)));
  const len = [1, 2, 5, 10].map((k) => k * mag).filter((v) => v <= target).pop() ?? mag;
  const px = len * cam.scale;
  const x0 = 16;
  const y0 = cam.height - 18;
  ctx.lineWidth = 4;
  ctx.strokeStyle = t.halo;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0 + px, y0);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = t.text;
  ctx.beginPath();
  ctx.moveTo(x0, y0 - 5);
  ctx.lineTo(x0, y0);
  ctx.lineTo(x0 + px, y0);
  ctx.lineTo(x0 + px, y0 - 5);
  ctx.stroke();
  label(ctx, `${fmt(len, 2)} m`, x0 + px / 2, y0 - 8, t, 'center');
}

export function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, t: OverlayTheme, align: CanvasTextAlign = 'left') {
  ctx.font = '600 12px "IBM Plex Sans", system-ui, sans-serif';
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 3;
  ctx.strokeStyle = t.halo;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = t.text;
  ctx.fillText(text, x, y);
}

/** freestream arrow with its Mach number and angle, drawn at the upstream side of the view */
export function drawFreestream(ctx: CanvasRenderingContext2D, mach: number, angleDeg: number, t: OverlayTheme) {
  const a = (angleDeg * Math.PI) / 180;
  const x0 = 24;
  const y0 = 34;
  const L = 46;
  const x1 = x0 + L * Math.cos(a);
  const y1 = y0 - L * Math.sin(a);
  for (const [w, c] of [
    [5, t.halo],
    [2, t.text],
  ] as const) {
    ctx.lineWidth = w;
    ctx.strokeStyle = c;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1 - 9 * Math.cos(a - 0.45), y1 + 9 * Math.sin(a - 0.45));
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - 9 * Math.cos(a + 0.45), y1 + 9 * Math.sin(a + 0.45));
    ctx.stroke();
  }
  label(ctx, `M∞ = ${fmt(mach, 3)}${angleDeg ? `, α = ${fmt(angleDeg, 3)}°` : ''}`, x0, y0 + 22, t);
}
