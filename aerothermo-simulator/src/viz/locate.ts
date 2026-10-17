import type { Mesh } from '../core/mesh';

/**
 * Point location on the structured mesh: which cell contains (x, y), and where inside it. Used by the probe
 * (which reports the containing cell's own computed values) and by streamline integration (which interpolates
 * node-averaged velocities bilinearly inside the cell).
 */
export interface Hit {
  i: number;
  j: number;
  /** cell index j·ni + i */
  cell: number;
  /** local coordinates in the cell, 0…1 along i and j */
  xi: number;
  eta: number;
}

export interface Locator {
  locate(x: number, y: number): Hit | null;
  /** bounding box of the mesh */
  bbox: [number, number, number, number];
}

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

export function buildLocator(m: Mesh): Locator {
  const { ni, nj, x, y } = m;
  const N = (i: number, j: number) => j * (ni + 1) + i;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (let k = 0; k < x.length; k++) {
    x0 = Math.min(x0, x[k]);
    x1 = Math.max(x1, x[k]);
    y0 = Math.min(y0, y[k]);
    y1 = Math.max(y1, y[k]);
  }
  // uniform bins over the bounding box; each bin lists the cells whose bounding box overlaps it
  const nb = Math.max(16, Math.round(Math.sqrt(ni * nj) * 1.5));
  const bw = (x1 - x0) / nb;
  const bh = (y1 - y0) / nb;
  const bins: number[][] = Array.from({ length: nb * nb }, () => []);
  for (let j = 0; j < nj; j++)
    for (let i = 0; i < ni; i++) {
      const ids = [N(i, j), N(i + 1, j), N(i + 1, j + 1), N(i, j + 1)];
      let cx0 = Infinity,
        cy0 = Infinity,
        cx1 = -Infinity,
        cy1 = -Infinity;
      for (const k of ids) {
        cx0 = Math.min(cx0, x[k]);
        cx1 = Math.max(cx1, x[k]);
        cy0 = Math.min(cy0, y[k]);
        cy1 = Math.max(cy1, y[k]);
      }
      const bi0 = Math.max(0, Math.floor((cx0 - x0) / bw));
      const bi1 = Math.min(nb - 1, Math.floor((cx1 - x0) / bw));
      const bj0 = Math.max(0, Math.floor((cy0 - y0) / bh));
      const bj1 = Math.min(nb - 1, Math.floor((cy1 - y0) / bh));
      for (let bj = bj0; bj <= bj1; bj++) for (let bi = bi0; bi <= bi1; bi++) bins[bj * nb + bi].push(j * ni + i);
    }

  const inside = (i: number, j: number, px: number, py: number): boolean => {
    const a = N(i, j),
      b = N(i + 1, j),
      c = N(i + 1, j + 1),
      d = N(i, j + 1);
    const q = [a, b, c, d];
    let sign = 0;
    for (let k = 0; k < 4; k++) {
      const p0 = q[k];
      const p1 = q[(k + 1) % 4];
      const cr = cross(x[p1] - x[p0], y[p1] - y[p0], px - x[p0], py - y[p0]);
      if (cr === 0) continue;
      const s = cr > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return true;
  };

  /** inverse bilinear map by Newton iteration */
  const local = (i: number, j: number, px: number, py: number): [number, number] => {
    const a = N(i, j),
      b = N(i + 1, j),
      c = N(i + 1, j + 1),
      d = N(i, j + 1);
    let s = 0.5,
      t = 0.5;
    for (let it = 0; it < 20; it++) {
      const fx = (1 - s) * (1 - t) * x[a] + s * (1 - t) * x[b] + s * t * x[c] + (1 - s) * t * x[d] - px;
      const fy = (1 - s) * (1 - t) * y[a] + s * (1 - t) * y[b] + s * t * y[c] + (1 - s) * t * y[d] - py;
      const dxs = (1 - t) * (x[b] - x[a]) + t * (x[c] - x[d]);
      const dys = (1 - t) * (y[b] - y[a]) + t * (y[c] - y[d]);
      const dxt = (1 - s) * (x[d] - x[a]) + s * (x[c] - x[b]);
      const dyt = (1 - s) * (y[d] - y[a]) + s * (y[c] - y[b]);
      const det = dxs * dyt - dxt * dys;
      if (det === 0) break;
      const ds = (fx * dyt - fy * dxt) / det;
      const dt = (dxs * fy - dys * fx) / det;
      s -= ds;
      t -= dt;
      if (Math.abs(ds) + Math.abs(dt) < 1e-12) break;
    }
    return [Math.min(1, Math.max(0, s)), Math.min(1, Math.max(0, t))];
  };

  return {
    bbox: [x0, y0, x1, y1],
    locate(px, py) {
      if (px < x0 || px > x1 || py < y0 || py > y1) return null;
      const bi = Math.min(nb - 1, Math.floor((px - x0) / bw));
      const bj = Math.min(nb - 1, Math.floor((py - y0) / bh));
      for (const cell of bins[bj * nb + bi]) {
        const i = cell % ni;
        const j = (cell - i) / ni;
        if (inside(i, j, px, py)) {
          const [xi, eta] = local(i, j, px, py);
          return { i, j, cell, xi, eta };
        }
      }
      return null;
    },
  };
}

/**
 * Node values from cell values: each node takes the average of the (up to four) cells that share it. On a
 * periodic O-grid node i = ni is node i = 0. Used for smooth display and interpolation only; the probe and all
 * diagnostics use cell values.
 */
export function nodeAverage(m: Mesh, f: ArrayLike<number>): Float32Array {
  const { ni, nj } = m;
  const out = new Float32Array((ni + 1) * (nj + 1));
  for (let j = 0; j <= nj; j++)
    for (let i = 0; i <= ni; i++) {
      let s = 0;
      let n = 0;
      for (const dj of [-1, 0]) {
        const jj = j + dj;
        if (jj < 0 || jj >= nj) continue;
        for (const di of [-1, 0]) {
          let ii = i + di;
          if (m.periodicI) ii = (ii + ni) % ni;
          else if (ii < 0 || ii >= ni) continue;
          s += f[jj * ni + ii];
          n++;
        }
      }
      out[j * (ni + 1) + i] = s / n;
    }
  return out;
}

/** bilinear interpolation of node values inside a located cell */
export function interpolate(m: Mesh, nodes: ArrayLike<number>, h: Hit): number {
  const W = m.ni + 1;
  const a = h.j * W + h.i;
  const s = h.xi;
  const t = h.eta;
  return (1 - s) * (1 - t) * nodes[a] + s * (1 - t) * nodes[a + 1] + s * t * nodes[a + W + 1] + (1 - s) * t * nodes[a + W];
}

/**
 * Streamline through (x0, y0) in the computed velocity field: second-order (midpoint) integration along the
 * velocity direction with a step of `stepFactor` × the local cell size, until the line leaves the domain, enters
 * a stagnation region (|V| < 0.2 % of `vref`), or reaches `maxPoints`.
 */
export function traceStreamline(
  m: Mesh,
  loc: Locator,
  nu: ArrayLike<number>,
  nv: ArrayLike<number>,
  x0: number,
  y0: number,
  vref: number,
  maxPoints = 2000,
  stepFactor = 0.4,
): Float32Array {
  const pts: number[] = [x0, y0];
  let px = x0;
  let py = y0;
  const vel = (qx: number, qy: number): [number, number, number] | null => {
    const h = loc.locate(qx, qy);
    if (!h) return null;
    return [interpolate(m, nu, h), interpolate(m, nv, h), Math.sqrt(m.area[h.cell])];
  };
  for (let k = 0; k < maxPoints; k++) {
    const v0 = vel(px, py);
    if (!v0) break;
    const sp0 = Math.hypot(v0[0], v0[1]);
    if (sp0 < 2e-3 * vref) break;
    const h = stepFactor * v0[2];
    const mx = px + (0.5 * h * v0[0]) / sp0;
    const my = py + (0.5 * h * v0[1]) / sp0;
    const v1 = vel(mx, my);
    if (!v1) break;
    const sp1 = Math.hypot(v1[0], v1[1]);
    if (sp1 < 2e-3 * vref) break;
    px += (h * v1[0]) / sp1;
    py += (h * v1[1]) / sp1;
    pts.push(px, py);
  }
  return new Float32Array(pts);
}
