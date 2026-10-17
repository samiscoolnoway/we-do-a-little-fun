/**
 * Structured quadrilateral meshes for the finite-volume solver.
 *
 * Cells are indexed (i, j), i = 0…ni−1, j = 0…nj−1. Nodes are indexed (i, j), i = 0…ni, j = 0…nj; cell (i, j) has
 * corners (i,j), (i+1,j), (i+1,j+1), (i,j+1).
 *
 * "i-faces" separate cell (i−1, j) from cell (i, j); "j-faces" separate (i, j−1) from (i, j). Each face stores its
 * normal vector scaled by the face length, oriented towards increasing i (or j). The solver only needs these face
 * vectors, the cell areas and the cell centres: that is what makes the method a finite-volume method on an
 * arbitrary (body-fitted) quadrilateral mesh.
 */
export interface Mesh {
  kind: 'ogrid' | 'rect';
  ni: number;
  nj: number;
  /** i wraps around (O-grid): cell −1 is cell ni−1 */
  periodicI: boolean;
  /** node coordinates, index j·(ni+1) + i, m */
  x: Float64Array;
  y: Float64Array;
  /** cell centroids and areas (area per unit depth, m²), index j·ni + i */
  xc: Float64Array;
  yc: Float64Array;
  area: Float64Array;
  /** i-face normals × length, index j·(ni+1) + i */
  inx: Float64Array;
  iny: Float64Array;
  /** j-face normals × length, index j·ni + i */
  jnx: Float64Array;
  jny: Float64Array;
  /** face lengths (m per unit depth), same indexing as the face vectors */
  ilen: Float64Array;
  jlen: Float64Array;
  /** body outline (closed polygon) for O-grids */
  body?: { x: Float64Array; y: Float64Array };
  /** geometric description used to build the mesh */
  info: Record<string, number | string>;
}

export const nodeIndex = (m: Mesh, i: number, j: number) => j * (m.ni + 1) + i;
export const cellIndex = (m: Mesh, i: number, j: number) => j * m.ni + i;

/** Compute cell areas, centroids and oriented face normals from the node coordinates. */
export function computeMetrics(m: Omit<Mesh, 'xc' | 'yc' | 'area' | 'inx' | 'iny' | 'jnx' | 'jny' | 'ilen' | 'jlen'>): Mesh {
  const { ni, nj, x, y } = m;
  const N = (i: number, j: number) => j * (ni + 1) + i;
  const xc = new Float64Array(ni * nj);
  const yc = new Float64Array(ni * nj);
  const area = new Float64Array(ni * nj);
  for (let j = 0; j < nj; j++)
    for (let i = 0; i < ni; i++) {
      const a = N(i, j);
      const b = N(i + 1, j);
      const c = N(i + 1, j + 1);
      const d = N(i, j + 1);
      // polygon area and centroid (shoelace), counter-clockwise or clockwise: take the absolute area
      const px = [x[a], x[b], x[c], x[d]];
      const py = [y[a], y[b], y[c], y[d]];
      let A = 0;
      let cx = 0;
      let cy = 0;
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) % 4;
        const cr = px[k] * py[k2] - px[k2] * py[k];
        A += cr;
        cx += (px[k] + px[k2]) * cr;
        cy += (py[k] + py[k2]) * cr;
      }
      A *= 0.5;
      const id = j * ni + i;
      xc[id] = cx / (6 * A);
      yc[id] = cy / (6 * A);
      area[id] = Math.abs(A);
      if (!(area[id] > 0)) throw new Error(`degenerate cell (${i}, ${j})`);
    }
  const C = (i: number, j: number) => {
    const ii = m.periodicI ? (i + ni) % ni : i;
    return j * ni + ii;
  };
  const inx = new Float64Array((ni + 1) * nj);
  const iny = new Float64Array((ni + 1) * nj);
  for (let j = 0; j < nj; j++)
    for (let i = 0; i <= ni; i++) {
      const a = N(i, j);
      const b = N(i, j + 1);
      let nx = y[b] - y[a];
      let ny = -(x[b] - x[a]);
      // orient towards increasing i: from the left cell to the right cell (or into / out of the domain at an edge)
      const mx = 0.5 * (x[a] + x[b]);
      const my = 0.5 * (y[a] + y[b]);
      let dx: number;
      let dy: number;
      if (m.periodicI) {
        const l = C(i - 1, j);
        const r = C(i, j);
        dx = xc[r] - xc[l];
        dy = yc[r] - yc[l];
      } else if (i === 0) {
        dx = xc[C(0, j)] - mx;
        dy = yc[C(0, j)] - my;
      } else if (i === ni) {
        dx = mx - xc[C(ni - 1, j)];
        dy = my - yc[C(ni - 1, j)];
      } else {
        dx = xc[C(i, j)] - xc[C(i - 1, j)];
        dy = yc[C(i, j)] - yc[C(i - 1, j)];
      }
      if (nx * dx + ny * dy < 0) {
        nx = -nx;
        ny = -ny;
      }
      inx[j * (ni + 1) + i] = nx;
      iny[j * (ni + 1) + i] = ny;
    }
  const jnx = new Float64Array(ni * (nj + 1));
  const jny = new Float64Array(ni * (nj + 1));
  for (let j = 0; j <= nj; j++)
    for (let i = 0; i < ni; i++) {
      const a = N(i, j);
      const b = N(i + 1, j);
      let nx = y[b] - y[a];
      let ny = -(x[b] - x[a]);
      const mx = 0.5 * (x[a] + x[b]);
      const my = 0.5 * (y[a] + y[b]);
      let dx: number;
      let dy: number;
      if (j < nj) {
        const r = C(i, j);
        dx = xc[r] - mx;
        dy = yc[r] - my;
      } else {
        const l = C(i, j - 1);
        dx = mx - xc[l];
        dy = my - yc[l];
      }
      if (nx * dx + ny * dy < 0) {
        nx = -nx;
        ny = -ny;
      }
      jnx[j * ni + i] = nx;
      jny[j * ni + i] = ny;
    }
  const ilen = new Float64Array(inx.length);
  for (let f = 0; f < ilen.length; f++) ilen[f] = Math.hypot(inx[f], iny[f]);
  const jlen = new Float64Array(jnx.length);
  for (let f = 0; f < jlen.length; f++) jlen[f] = Math.hypot(jnx[f], jny[f]);
  return { ...m, xc, yc, area, inx, iny, jnx, jny, ilen, jlen };
}

/** Uniform rectangular mesh (used for the shock-tube benchmark and conservation tests). */
export function makeRectMesh(x0: number, x1: number, y0: number, y1: number, ni: number, nj: number): Mesh {
  const x = new Float64Array((ni + 1) * (nj + 1));
  const y = new Float64Array((ni + 1) * (nj + 1));
  for (let j = 0; j <= nj; j++)
    for (let i = 0; i <= ni; i++) {
      x[j * (ni + 1) + i] = x0 + ((x1 - x0) * i) / ni;
      y[j * (ni + 1) + i] = y0 + ((y1 - y0) * j) / nj;
    }
  return computeMetrics({ kind: 'rect', ni, nj, periodicI: false, x, y, info: { x0, x1, y0, y1 } });
}

// ───────────────────────────── blunt bodies ─────────────────────────────
export type BodyKind = 'cylinder' | 'ellipse';
export interface BodySpec {
  kind: BodyKind;
  /** circle radius, or the ellipse semi-axis across the flow (half height), m */
  radius: number;
  /** ellipse semi-axis along the flow divided by the half height (< 1 = blunter face); ignored for the cylinder */
  aspect: number;
}

/** point on the body surface for parameter θ (θ = π is the front, facing the oncoming flow) */
export function bodyPoint(b: BodySpec, t: number): [number, number] {
  const ry = b.radius;
  const rx = b.kind === 'cylinder' ? b.radius : b.radius * b.aspect;
  return [rx * Math.cos(t), ry * Math.sin(t)];
}

/** radius of curvature of the body at the front stagnation point, m (circle: R; ellipse: b²/a) */
export function noseRadius(b: BodySpec): number {
  if (b.kind === 'cylinder') return b.radius;
  const a = b.radius * b.aspect;
  return (b.radius * b.radius) / a;
}

export interface OGridSpec {
  body: BodySpec;
  /** cells around the body */
  ni: number;
  /** cells from the wall to the outer boundary */
  nj: number;
  /** outer boundary radius divided by the body half height */
  outer: number;
  /** wall-normal size of the first cell divided by the body half height */
  firstSpacing: number;
}

/** ratio q of a geometric progression with n intervals spanning length 1 whose first interval is d1 */
function stretchRatio(n: number, d1: number): number {
  if (d1 * n >= 1) return 1;
  let lo = 1 + 1e-9;
  let hi = 2;
  while ((hi - 1) / (Math.pow(hi, n) - 1) > d1) hi *= 1.5;
  for (let k = 0; k < 200; k++) {
    const mid = 0.5 * (lo + hi);
    const f = (mid - 1) / (Math.pow(mid, n) - 1);
    if (f > d1) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * Body-fitted O-grid: radial lines from the body surface to a circular outer boundary, geometrically stretched so
 * that cells are small near the wall (where the flow changes fastest) and large far away. Cell 0 in i is centred
 * on the front stagnation line (θ = π); i increases anticlockwise; j = 0 touches the wall.
 */
export function makeOGrid(s: OGridSpec): Mesh {
  const { ni, nj } = s;
  const H = s.body.radius;
  const Rout = s.outer * H;
  const x = new Float64Array((ni + 1) * (nj + 1));
  const y = new Float64Array((ni + 1) * (nj + 1));
  const [fx] = bodyPoint(s.body, Math.PI);
  const q = stretchRatio(nj, (s.firstSpacing * H) / (Rout + fx));
  const eta = (j: number) => (q === 1 ? j / nj : (Math.pow(q, j) - 1) / (Math.pow(q, nj) - 1));
  for (let i = 0; i <= ni; i++) {
    const t = Math.PI + (2 * Math.PI * (i - 0.5)) / ni;
    const [bx, by] = bodyPoint(s.body, t);
    const ox = Rout * Math.cos(t);
    const oy = Rout * Math.sin(t);
    for (let j = 0; j <= nj; j++) {
      const e = eta(j);
      x[j * (ni + 1) + i] = bx + (ox - bx) * e;
      y[j * (ni + 1) + i] = by + (oy - by) * e;
    }
  }
  const bxs = new Float64Array(ni);
  const bys = new Float64Array(ni);
  for (let i = 0; i < ni; i++) {
    bxs[i] = x[i];
    bys[i] = y[i];
  }
  return computeMetrics({
    kind: 'ogrid',
    ni,
    nj,
    periodicI: true,
    x,
    y,
    body: { x: bxs, y: bys },
    info: { body: s.body.kind, radius: H, aspect: s.body.aspect, outer: s.outer, stretch: q, firstSpacing: s.firstSpacing },
  });
}
