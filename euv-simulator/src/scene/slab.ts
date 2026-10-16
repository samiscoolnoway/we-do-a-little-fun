import * as THREE from 'three';
import { SLAB, W0 } from '../data/layout';
import { COLOR, SegPool, dotTexture, edgeBox, glowMat, steel } from './gfx';
import { Registry } from './registry';
import { buildResistModel, cdfOf, sampleCdf, ResistModel } from './resistModel';
import { FrameCtx, SimModule } from './timing';
import { waferPose } from './transport';
import { clamp, easeOut, fract, hash, lerp, smoothstep } from './util';

const N = 108;
const ROWS = 4;
const W = SLAB.w;
const Y_SI = SLAB.siH;
const Y_FILM = SLAB.siH + SLAB.filmH;
const Y_TOP = SLAB.siH + SLAB.filmH + SLAB.resH;
const ZF = 0.6; // overlay plane, just in front of the cut face
const D2 = SLAB.depth / 2;

// ───────────────────────── heightfield prism ─────────────────────────
class Prism {
  mesh: THREE.Mesh;
  hb: Float32Array;
  private pos: Float32Array;
  private nor: Float32Array;
  private col: Float32Array;
  private xs: Float32Array;
  private F: number;
  private geo = new THREE.BufferGeometry();
  constructor(private y0: number, private depth: number, mat: THREE.Material) {
    this.F = (N + 1) * (ROWS + 1);
    const V = 2 * this.F + 2 * (N + 1) + 8;
    this.pos = new Float32Array(V * 3);
    this.nor = new Float32Array(V * 3);
    this.col = new Float32Array(V * 3).fill(1);
    this.hb = new Float32Array(N + 1).fill(1);
    this.xs = new Float32Array(N + 1);
    for (let i = 0; i <= N; i++) this.xs[i] = -W / 2 + (i / N) * W;
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.writePositions();
    // indices — winding is derived from the intended normals using the nominal (h = 1) positions
    const idx: number[] = [];
    const P = (i: number) => new THREE.Vector3(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
    const quad = (a: number, b: number, c: number, d: number, n: THREE.Vector3) => {
      const pa = P(a);
      const cr = P(b).sub(pa).cross(P(c).sub(pa));
      if (cr.dot(n) > 0) idx.push(a, b, c, a, c, d);
      else idx.push(a, c, b, a, d, c);
    };
    const FI = (i: number, j: number) => i * (ROWS + 1) + j;
    const zp = new THREE.Vector3(0, 0, 1);
    const zn = new THREE.Vector3(0, 0, -1);
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < ROWS; j++) {
        quad(FI(i, j), FI(i + 1, j), FI(i + 1, j + 1), FI(i, j + 1), zp);
        quad(this.F + FI(i, j), this.F + FI(i + 1, j), this.F + FI(i + 1, j + 1), this.F + FI(i, j + 1), zn);
      }
      const t0 = 2 * this.F + 2 * i;
      const t1 = 2 * this.F + 2 * (i + 1);
      quad(t0, t1, t1 + 1, t0 + 1, up);
    }
    const c0 = 2 * this.F + 2 * (N + 1);
    quad(c0, c0 + 1, c0 + 2, c0 + 3, new THREE.Vector3(-1, 0, 0));
    quad(c0 + 4, c0 + 5, c0 + 6, c0 + 7, new THREE.Vector3(1, 0, 0));
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.5, 0), 5);
    this.geo.boundingBox = new THREE.Box3(new THREE.Vector3(-W / 2 - 0.1, -0.2, -1), new THREE.Vector3(W / 2 + 0.1, 3.5, 1));
  }
  private writePositions() {
    const { pos, nor, hb, xs, F, y0, depth } = this;
    const d2 = depth / 2;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= ROWS; j++) {
        const y = y0 + (hb[i] * j) / ROWS;
        const a = (i * (ROWS + 1) + j) * 3;
        pos[a] = xs[i];
        pos[a + 1] = y;
        pos[a + 2] = d2;
        nor[a + 2] = 1;
        const b = (F + i * (ROWS + 1) + j) * 3;
        pos[b] = xs[i];
        pos[b + 1] = y;
        pos[b + 2] = -d2;
        nor[b + 2] = -1;
      }
      const hm = hb[Math.max(0, i - 1)];
      const hp = hb[Math.min(N, i + 1)];
      const dx = xs[Math.min(N, i + 1)] - xs[Math.max(0, i - 1)];
      let nx = -(hp - hm) / dx;
      let ny = 1;
      const l = Math.hypot(nx, ny);
      nx /= l;
      ny /= l;
      for (let s = 0; s < 2; s++) {
        const t = (2 * F + 2 * i + s) * 3;
        pos[t] = xs[i];
        pos[t + 1] = y0 + hb[i];
        pos[t + 2] = s === 0 ? d2 : -d2;
        nor[t] = nx;
        nor[t + 1] = ny;
        nor[t + 2] = 0;
      }
    }
    const c0 = 2 * F + 2 * (N + 1);
    const cap = (base: number, x: number, h: number, nxs: number) => {
      const v = [
        [x, y0, d2],
        [x, y0, -d2],
        [x, y0 + h, -d2],
        [x, y0 + h, d2],
      ];
      v.forEach((p, k) => {
        const a = (base + k) * 3;
        pos[a] = p[0];
        pos[a + 1] = p[1];
        pos[a + 2] = p[2];
        nor[a] = nxs;
        nor[a + 1] = 0;
        nor[a + 2] = 0;
      });
    };
    cap(c0, xs[0], hb[0], -1);
    cap(c0 + 4, xs[N], hb[N], 1);
  }
  /** colour per (boundary, row) plus a top colour per boundary */
  update(heights: Float32Array, colorAt: (b: number, row: number, out: number[]) => void) {
    // column heights → boundary heights
    this.hb[0] = heights[0];
    this.hb[N] = heights[N - 1];
    for (let i = 1; i < N; i++) this.hb[i] = 0.5 * (heights[i - 1] + heights[i]);
    this.writePositions();
    const tmp = [0, 0, 0];
    const { col, F } = this;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= ROWS; j++) {
        colorAt(i, j / ROWS, tmp);
        const a = (i * (ROWS + 1) + j) * 3;
        col[a] = tmp[0];
        col[a + 1] = tmp[1];
        col[a + 2] = tmp[2];
        const b = (F + i * (ROWS + 1) + j) * 3;
        col[b] = tmp[0] * 0.85;
        col[b + 1] = tmp[1] * 0.85;
        col[b + 2] = tmp[2] * 0.85;
      }
      colorAt(i, 1, tmp);
      for (let s = 0; s < 2; s++) {
        const t = (2 * F + 2 * i + s) * 3;
        col[t] = tmp[0] * 1.12;
        col[t + 1] = tmp[1] * 1.12;
        col[t + 2] = tmp[2] * 1.12;
      }
    }
    const c0 = 2 * F + 2 * (N + 1);
    for (let k = 0; k < 8; k++) {
      const i = k < 4 ? 0 : N;
      colorAt(i, k % 4 < 2 ? 0 : 1, tmp);
      const a = (c0 + k) * 3;
      col[a] = tmp[0] * 0.9;
      col[a + 1] = tmp[1] * 0.9;
      col[a + 2] = tmp[2] * 0.9;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ───────────────────────── helpers ─────────────────────────
interface Pts {
  pts: THREE.Points;
  pos: THREE.BufferAttribute;
  col: THREE.BufferAttribute;
  n: number;
  alpha: boolean;
}
/** additive = glowing particles (RGB); otherwise opaque-ish dots with a per-point alpha (RGBA). */
function makePoints(n: number, size: number, additive = true): Pts {
  const geo = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const col = new THREE.BufferAttribute(new Float32Array(n * (additive ? 3 : 4)), additive ? 3 : 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', pos);
  geo.setAttribute('color', col);
  const pts = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      map: dotTexture(),
      size,
      vertexColors: true,
      transparent: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  pts.frustumCulled = false;
  pts.raycast = () => {};
  return { pts, pos, col, n, alpha: !additive };
}
const hide = (p: Pts, i: number) => {
  p.pos.setXYZ(i, 0, -50, 0);
  if (p.alpha) p.col.setXYZW(i, 0, 0, 0, 0);
  else p.col.setXYZ(i, 0, 0, 0);
};

interface SlabTimes {
  vis: number;
  expo: number;
  peb: number;
  dev: number;
  etch: number;
  strip: number;
}
export function slabTimes(stage: number, p: number): SlabTimes {
  const t: SlabTimes = { vis: 0, expo: 0, peb: 0, dev: 0, etch: 0, strip: 0 };
  if (stage >= 7) {
    t.vis = stage === 7 ? smoothstep(0, 0.08, p) : 1;
    t.expo = stage === 7 ? smoothstep(0.04, 0.9, p) : 1;
    t.peb = stage === 8 ? smoothstep(0.3, 0.92, p) : stage > 8 ? 1 : 0;
    t.dev = stage === 9 ? smoothstep(0.3, 0.88, p) : stage > 9 ? 1 : 0;
    if (stage === 10) {
      t.etch = smoothstep(0.3, 0.84, p);
      t.strip = smoothstep(0.86, 0.985, p);
    }
  }
  return t;
}

const AMBER: [number, number, number] = [0.96, 0.58, 0.1];
const VIOLET: [number, number, number] = [0.7, 0.42, 0.98];
const PALE: [number, number, number] = [0.98, 0.9, 0.66];
const DARK: [number, number, number] = [0.55, 0.17, 0.07];
const FILM: [number, number, number] = [0.3, 0.7, 0.66];
const mix = (a: number[], b: number[], t: number, out: number[]) => {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
};

const N_PH = 56;
const N_EL = 6;
const N_ACID = 320;
const N_MARK = 4;
const N_FRAG = 110;
const N_ION = 150;
const N_BYP = 70;

// ───────────────────────── one cross-section ─────────────────────────
class SlabInstance {
  group = new THREE.Group();
  resist: Prism;
  film: Prism;
  aerial: Prism;
  private model!: ResistModel;
  private modelKey = '';
  private cdfAer!: Float32Array;
  private cdfAcid!: Float32Array;
  private cdfSol!: Float32Array;
  private photons = new SegPool(N_PH, 5);
  private flash = makePoints(N_PH, 0.34);
  private electrons = makePoints(N_PH * N_EL, 0.085);
  private acid = makePoints(N_ACID, 0.2, false);
  private marks = makePoints(N_ACID * N_MARK, 0.085, false);
  private frags = makePoints(N_FRAG, 0.1);
  private ions = makePoints(N_ION, 0.1);
  private spark = makePoints(N_ION, 0.2);
  private byp = makePoints(N_BYP, 0.12);
  private liquid: THREE.Mesh;
  private plasma: THREE.Mesh;
  private frame: THREE.LineSegments;
  private acidBase: { x: number; y: number; walk: number[] }[] = [];
  private heightsRes = new Float32Array(N);
  private heightsFilm = new Float32Array(N);
  private heightsAer = new Float32Array(N);
  private rem = new Float32Array(N);
  private colTop = new Float32Array(N);
  tone: 'positive' | 'negative' = 'positive';
  private tmp = [0, 0, 0];
  private tmp2 = [0, 0, 0];
  private cPh = new THREE.Color(COLOR.euv);

  constructor() {
    const g = this.group;
    const si = new THREE.Mesh(new THREE.BoxGeometry(W, SLAB.siH, SLAB.depth), new THREE.MeshStandardMaterial({ color: 0x46547a, roughness: 0.5, metalness: 0.45 }));
    si.position.y = SLAB.siH / 2;
    si.userData.isSilicon = true;
    this.film = new Prism(Y_SI, SLAB.depth, new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x9a9a9a, roughness: 0.45, metalness: 0.25 }));
    this.resist = new Prism(Y_FILM, SLAB.depth, new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x8c8c8c, roughness: 0.6, metalness: 0.0, emissive: 0x1d1004, emissiveIntensity: 0.4 }));
    this.film.mesh.userData.nopick = false;
    // aerial image: a bar graph of light intensity hovering above the resist
    this.aerial = new Prism(Y_TOP + 0.3, 0.1, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, toneMapped: false }));
    this.aerial.mesh.position.z = 0.48;
    g.add(si, this.film.mesh, this.resist.mesh, this.aerial.mesh);
    this.frame = edgeBox(W + 0.5, 2.75, SLAB.depth + 0.5, 0xb8c8ee, 0.22);
    this.frame.position.y = 1.05;
    g.add(this.frame);
    this.liquid = new THREE.Mesh(new THREE.BoxGeometry(W, 0.5, SLAB.depth), new THREE.MeshBasicMaterial({ color: 0x59e0d4, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.liquid.position.y = Y_TOP + 0.26;
    this.liquid.raycast = () => {};
    this.plasma = new THREE.Mesh(new THREE.BoxGeometry(W + 0.2, 1.3, SLAB.depth + 0.1), new THREE.MeshBasicMaterial({ color: 0x8aff9a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.plasma.position.y = Y_TOP + 0.85;
    this.plasma.raycast = () => {};
    g.add(this.liquid, this.plasma);
    for (const p of [this.photons.mesh, this.flash.pts, this.electrons.pts, this.acid.pts, this.marks.pts, this.frags.pts, this.ions.pts, this.spark.pts, this.byp.pts]) g.add(p);
    // random-walk paths of every acid molecule during the bake
    for (let i = 0; i < N_ACID; i++) {
      const walk: number[] = [];
      let wx = 0;
      let wy = 0;
      for (let m = 0; m < N_MARK + 1; m++) {
        const a = hash(i * 7.3 + m * 2.1) * Math.PI * 2;
        const r = 0.05 + 0.11 * hash(i * 3.9 + m * 5.7);
        wx += Math.cos(a) * r;
        wy += Math.sin(a) * r * 0.8;
        walk.push(wx, wy);
      }
      this.acidBase.push({ x: 0, y: 0, walk });
    }
    this.setModel(buildResistModel(N, W, 3, 1));
  }

  setModel(m: ResistModel) {
    const key = `${m.dose.toFixed(3)}`;
    if (key === this.modelKey) return;
    this.modelKey = key;
    this.model = m;
    this.cdfAer = cdfOf(m.aerial);
    this.cdfAcid = cdfOf(m.acid.map((a) => a * a));
    // latent-image dots sit where acid is
    for (let i = 0; i < N_ACID; i++) {
      const c = sampleCdf(this.cdfAcid, hash(i * 3.1 + 1));
      const x = m.x[c] + (hash(i * 8.3) - 0.5) * (W / N) * 1.4;
      const depth = -Math.log(1 - hash(i * 5.9 + 2) * 0.93) * 0.36 * SLAB.resH;
      this.acidBase[i].x = x;
      this.acidBase[i].y = Y_TOP - Math.min(depth, SLAB.resH * 0.96) - 0.02;
    }
  }

  private solFor(tone: 'positive' | 'negative') {
    return tone === 'positive' ? this.model.solPos : this.model.solNeg;
  }

  private colIndex(x: number) {
    return clamp(Math.floor(((x + W / 2) / W) * N), 0, N - 1);
  }

  update(c: FrameCtx, t: SlabTimes, tone: 'positive' | 'negative') {
    const m = this.model;
    const T = c.T;
    const stage = c.stage;
    this.tone = tone;
    const sol = this.solFor(tone);
    this.cdfSol = cdfOf(sol);

    // ── profile heights ──
    for (let i = 0; i < N; i++) {
      const rem = 1 - Math.min(1, Math.pow(sol[i], 0.8) * t.dev * 1.06);
      this.rem[i] = rem;
      this.heightsRes[i] = Math.max(0.0005, rem * (1 - 0.22 * t.etch) * (1 - t.strip) * SLAB.resH);
      const open = 1 - smoothstep(0.02, 0.22, rem);
      this.heightsFilm[i] = Math.max(0.0005, SLAB.filmH * (1 - clamp(open * t.etch * 1.12)));
      this.colTop[i] = this.heightsRes[i] > 0.012 ? Y_FILM + this.heightsRes[i] : Y_SI + this.heightsFilm[i];
      this.heightsAer[i] = (0.04 + 0.5 * m.aerial[i]) * (stage === 7 ? 1 : 0);
    }
    const tmp = this.tmp;
    const tmp2 = this.tmp2;
    this.resist.update(this.heightsRes, (b, row, out) => {
      const ci = Math.min(b, N - 1);
      out[0] = AMBER[0];
      out[1] = AMBER[1];
      out[2] = AMBER[2];
      const tint = m.acid[ci] * t.expo * (0.4 + 0.6 * row) * (1 - 0.6 * t.peb) * 0.95;
      mix(out, VIOLET, clamp(tint), tmp);
      const dk = clamp(m.deprot[ci] * t.peb * 0.95);
      mix(tmp, tone === 'positive' ? PALE : DARK, dk, tmp2);
      const e = 1 - 0.22 * t.etch;
      out[0] = tmp2[0] * e;
      out[1] = tmp2[1] * e;
      out[2] = tmp2[2] * e;
    });
    this.film.update(this.heightsFilm, (b, row, out) => {
      const shade = 0.85 + 0.25 * row;
      out[0] = FILM[0] * shade;
      out[1] = FILM[1] * shade;
      out[2] = FILM[2] * shade;
    });
    const aerOn = stage === 7;
    this.aerial.mesh.visible = aerOn && t.vis > 0.05;
    if (this.aerial.mesh.visible) {
      this.aerial.update(this.heightsAer, (b, row, out) => {
        const ci = Math.min(b, N - 1);
        const v = 0.35 + 0.9 * m.aerial[ci];
        out[0] = 0.18 * v * (0.6 + 0.4 * row);
        out[1] = 0.85 * v * (0.6 + 0.4 * row);
        out[2] = 1.0 * v * (0.6 + 0.4 * row);
      });
    }

    // ── photons, absorption flashes, secondary electrons (exposure stage) ──
    const pool = this.photons;
    pool.begin();
    const expoActive = stage === 7 && t.vis > 0.3;
    const Tph = 1.7;
    for (let i = 0; i < N_PH; i++) {
      hide(this.flash, i);
      for (let e = 0; e < N_EL; e++) hide(this.electrons, i * N_EL + e);
      if (!expoActive) continue;
      const ph = T / Tph + hash(i * 0.77) * 3;
      const n = Math.floor(ph);
      const u = ph - n;
      const rOn = hash(i * 1.7 + n * 4.7);
      if (rOn > clamp(c.dose * 0.8, 0.3, 1) * smoothstep(0.02, 0.1, c.p) * (1 - smoothstep(0.93, 1, c.p))) continue;
      const cx = sampleCdf(this.cdfAer, hash(i * 13.1 + n * 7.7));
      const x = m.x[cx] + (hash(i * 3.7 + n) - 0.5) * 0.05;
      const absorbed = hash(i * 5.3 + n * 3.1) < 0.28;
      const depth = Math.min(-Math.log(1 - hash(i * 2.9 + n * 9.3) * 0.92) * 0.34, SLAB.resH * 0.96);
      const yAbs = Y_TOP - depth;
      const yStart = Y_TOP + 1.7;
      const yEnd = absorbed ? yAbs : Y_SI * 0.5;
      const fall = clamp(u / 0.42);
      if (fall < 1) {
        const head = lerp(yStart, yEnd, fall);
        const tail = Math.min(head + 0.7, yStart);
        const fadeEnd = absorbed ? 1 : 1 - smoothstep(0.7, 1, fall);
        pool.add(new THREE.Vector3(x, tail, ZF + 0.04), new THREE.Vector3(x, head, ZF + 0.04), 0.017, this.cPh, 2.4 * fadeEnd);
      }
      if (absorbed && u >= 0.42) {
        const uu = (u - 0.42) / 0.58;
        const f = clamp(1 - uu / 0.25);
        if (f > 0) {
          this.flash.pos.setXYZ(i, x, yAbs, ZF + 0.06);
          this.flash.col.setXYZ(i, 1.6 * f, 1.6 * f, 1.8 * f);
        }
        for (let e = 0; e < N_EL; e++) {
          const ang = hash(i * 7.1 + e * 13.3 + n) * Math.PI * 2;
          const rr = 0.36 * easeOut(clamp(uu / 0.42)) * (0.45 + 0.55 * hash(i * 2.3 + e * 5.1 + n));
          const fade = 1 - smoothstep(0.45, 0.75, uu);
          if (fade <= 0) continue;
          const ex = x + Math.cos(ang) * rr;
          const ey = clamp(yAbs + Math.sin(ang) * rr, Y_FILM + 0.02, Y_TOP);
          this.electrons.pos.setXYZ(i * N_EL + e, ex, ey, ZF + 0.05);
          this.electrons.col.setXYZ(i * N_EL + e, 1.5 * fade, 1.05 * fade, 0.25 * fade);
        }
      }
    }
    pool.end();
    this.flash.pos.needsUpdate = this.flash.col.needsUpdate = true;
    this.electrons.pos.needsUpdate = this.electrons.col.needsUpdate = true;

    // ── acid molecules and bake marks (latent image) ──
    const acidOn = stage >= 7 && t.vis > 0.05;
    for (let i = 0; i < N_ACID; i++) {
      const a = this.acidBase[i];
      let shown = 0;
      let ax = a.x;
      let ay = a.y;
      if (acidOn) {
        const appear = (i / N_ACID) * 0.92;
        shown = smoothstep(appear, appear + 0.04, t.expo);
        // random walk during the bake
        if (t.peb > 0) {
          const f = t.peb * N_MARK;
          const k = Math.min(Math.floor(f), N_MARK - 1);
          const fr = f - k;
          const w0x = k === 0 ? 0 : a.walk[(k - 1) * 2];
          const w0y = k === 0 ? 0 : a.walk[(k - 1) * 2 + 1];
          ax += lerp(w0x, a.walk[k * 2], fr);
          ay += lerp(w0y, a.walk[k * 2 + 1], fr);
        }
        ax = clamp(ax, -W / 2 + 0.02, W / 2 - 0.02);
        ay = clamp(ay, Y_FILM + 0.02, Y_TOP - 0.02);
        const ci = this.colIndex(ax);
        if (this.heightsRes[ci] < 0.02 || ay > Y_FILM + this.heightsRes[ci] - 0.01) shown = 0;
      }
      if (shown > 0.01) {
        this.acid.pos.setXYZ(i, ax, ay, ZF);
        const pulse = 0.85 + 0.15 * Math.sin(T * 5 + i);
        this.acid.col.setXYZW(i, 0.72, 0.22, 1.0, Math.min(1, shown * pulse));
      } else hide(this.acid, i);
      for (let k = 0; k < N_MARK; k++) {
        const mi = i * N_MARK + k;
        let on = 0;
        let mx = 0;
        let my = 0;
        if (acidOn && t.peb > 0) {
          on = smoothstep((k + 0.2) / (N_MARK + 1), (k + 0.9) / (N_MARK + 1), t.peb);
          mx = clamp(a.x + a.walk[k * 2] + (hash(i + k * 3.3) - 0.5) * 0.05, -W / 2 + 0.02, W / 2 - 0.02);
          my = clamp(a.y + a.walk[k * 2 + 1] + (hash(i * 2 + k * 1.3) - 0.5) * 0.05, Y_FILM + 0.02, Y_TOP - 0.02);
          const ci = this.colIndex(mx);
          if (this.heightsRes[ci] < 0.02 || my > Y_FILM + this.heightsRes[ci] - 0.01) on = 0;
        }
        if (on > 0.01) {
          this.marks.pos.setXYZ(mi, mx, my, ZF - 0.01);
          if (tone === 'positive') this.marks.col.setXYZW(mi, 0.06, 0.62, 0.34, 0.9 * on);
          else this.marks.col.setXYZW(mi, 0.78, 0.14, 0.05, 0.9 * on);
        } else hide(this.marks, mi);
      }
    }
    this.acid.pos.needsUpdate = this.acid.col.needsUpdate = true;
    this.marks.pos.needsUpdate = this.marks.col.needsUpdate = true;

    // ── developer liquid and dissolving fragments ──
    const devActive = stage === 9 && t.dev > 0.02 && t.dev < 0.985;
    const rinse = stage === 9 ? smoothstep(0.8, 0.95, c.p) : 0;
    (this.liquid.material as THREE.MeshBasicMaterial).opacity = stage === 9 ? (smoothstep(0.24, 0.34, c.p) * (1 - smoothstep(0.86, 0.97, c.p))) * 0.2 : 0;
    (this.liquid.material as THREE.MeshBasicMaterial).color.setHex(rinse > 0.5 ? 0xa8d4ff : 0x59e0d4);
    this.liquid.visible = (this.liquid.material as THREE.MeshBasicMaterial).opacity > 0.004;
    for (let i = 0; i < N_FRAG; i++) {
      if (!devActive) {
        hide(this.frags, i);
        continue;
      }
      const cx = sampleCdf(this.cdfSol, hash(i * 4.1 + 5));
      const u = fract(T * 0.5 + hash(i * 6.2));
      const x = m.x[cx] + Math.sin(T * 2 + i) * 0.05;
      const top = this.colTop[cx];
      const y = top + u * 0.95;
      const fade = Math.sin(Math.PI * u) * smoothstep(0.02, 0.1, t.dev) * (1 - smoothstep(0.9, 0.985, t.dev)) * sol[cx];
      if (fade < 0.02) {
        hide(this.frags, i);
        continue;
      }
      this.frags.pos.setXYZ(i, x, y, ZF + 0.02);
      this.frags.col.setXYZ(i, 1.0 * fade, 0.85 * fade, 0.45 * fade);
    }
    this.frags.pos.needsUpdate = this.frags.col.needsUpdate = true;

    // ── plasma etch: ions rain down, volatile products leave ──
    const etchActive = stage === 10 && c.p > 0.08 && c.p < 0.96;
    (this.plasma.material as THREE.MeshBasicMaterial).opacity = etchActive ? 0.06 + 0.03 * Math.sin(T * 14) + 0.05 * Math.sin(T * 5.3) ** 2 : 0;
    (this.plasma.material as THREE.MeshBasicMaterial).color.setHex(t.strip > 0.02 ? 0xff9b6a : 0x8aff9a);
    this.plasma.visible = etchActive;
    for (let i = 0; i < N_ION; i++) {
      hide(this.spark, i);
      if (!etchActive) {
        hide(this.ions, i);
        continue;
      }
      const speed = 2.4;
      const cyc = 2.2 / speed;
      const ph = T / cyc + hash(i * 0.91) * 5;
      const n = Math.floor(ph);
      const u = ph - n;
      const x = -W / 2 + 0.06 + (W - 0.12) * hash(i * 3.3 + n * 1.9);
      const surface = this.colTop[this.colIndex(x)] + 0.01;
      const yStart = Y_TOP + 1.55;
      const tHit = (yStart - surface) / speed / cyc;
      if (u < tHit) {
        this.ions.pos.setXYZ(i, x, yStart - u * cyc * speed, ZF + 0.03);
        this.ions.col.setXYZ(i, 0.35, 1.3, 0.55);
      } else {
        hide(this.ions, i);
        const f = 1 - (u - tHit) / 0.12;
        if (f > 0) {
          this.spark.pos.setXYZ(i, x, surface, ZF + 0.05);
          this.spark.col.setXYZ(i, 1.6 * f, 1.7 * f, 1.0 * f);
        }
      }
    }
    this.ions.pos.needsUpdate = this.ions.col.needsUpdate = true;
    this.spark.pos.needsUpdate = this.spark.col.needsUpdate = true;
    for (let i = 0; i < N_BYP; i++) {
      if (!(etchActive && t.etch > 0.05 && t.etch < 0.995)) {
        hide(this.byp, i);
        continue;
      }
      const cx = sampleCdf(this.cdfSol, hash(i * 2.2 + 70));
      const open = 1 - smoothstep(0.02, 0.22, this.rem[cx]);
      const u = fract(T * 0.45 + hash(i * 1.3));
      if (open < 0.5 || this.heightsFilm[cx] < 0.03) {
        hide(this.byp, i);
        continue;
      }
      const fade = Math.sin(Math.PI * u) * 0.6;
      this.byp.pos.setXYZ(i, m.x[cx] + Math.sin(T * 1.5 + i) * 0.06, Y_SI + this.heightsFilm[cx] + u * 1.2, ZF + 0.02);
      this.byp.col.setXYZ(i, 0.7 * fade, 0.8 * fade, 0.9 * fade);
    }
    this.byp.pos.needsUpdate = this.byp.col.needsUpdate = true;
  }
}

// ───────────────────────── module: one or two slabs that ride with the wafer ─────────────────────────
export class SlabModule implements SimModule {
  group = new THREE.Group();
  A = new SlabInstance();
  B = new SlabInstance();
  private zoom: THREE.LineSegments;
  private zoomPos: THREE.BufferAttribute;
  private pose = waferPose(0);
  private corner = new THREE.Vector3();

  constructor(reg: Registry) {
    const g = this.group;
    for (const s of [this.A, this.B]) {
      s.group.rotation.y = -0.26;
      g.add(s.group);
      reg.register('resist', s.resist.mesh, { priority: 1, emph: false, bounds: () => this.bounds() });
      reg.register('etcher', s.film.mesh, { priority: 1, emph: false });
    }
    // silicon pieces count as the wafer
    for (const s of [this.A, this.B]) s.group.traverse((o) => {
      if (o.userData.isSilicon) reg.register('wafer', o, { priority: 1, emph: false });
    });
    const geo = new THREE.BufferGeometry();
    this.zoomPos = new THREE.BufferAttribute(new Float32Array(8 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.zoomPos);
    this.zoom = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xb8c8ee, transparent: true, opacity: 0.3, toneMapped: false }));
    this.zoom.frustumCulled = false;
    this.zoom.raycast = () => {};
    g.add(this.zoom);
  }

  bounds() {
    const b = new THREE.Box3();
    for (const s of [this.A, this.B]) {
      if (!s.group.visible) continue;
      s.group.updateWorldMatrix(true, false);
      const w = new THREE.Box3(new THREE.Vector3(-W / 2 - 0.2, -0.1, -0.8), new THREE.Vector3(W / 2 + 0.2, 3.0, 0.8)).applyMatrix4(s.group.matrixWorld);
      b.union(w);
    }
    return b;
  }

  update(c: FrameCtx) {
    const t = slabTimes(c.stage, c.p);
    waferPose(c.T, this.pose);
    const compare = c.tone === 'compare';
    const model = buildResistModel(N, W, 3, c.dose);
    const visible = t.vis > 0.003;
    this.group.visible = visible;
    if (!visible) return;
    const s = compare ? 0.78 : 1;
    const dx = compare ? 2.45 : 0;
    const sy = SLAB.y;
    // slab rises into place together with the fade-in
    const lift = (1 - t.vis) * -0.8;
    this.A.group.position.set(this.pose.slabX - dx, sy + lift, 0);
    this.B.group.position.set(this.pose.slabX + dx, sy + lift, 0);
    this.A.group.scale.setScalar(s * (0.9 + 0.1 * t.vis));
    this.B.group.scale.setScalar(s * (0.9 + 0.1 * t.vis));
    this.A.group.visible = true;
    this.B.group.visible = compare;
    this.A.setModel(model);
    this.B.setModel(model);
    this.A.update(c, t, c.tone === 'negative' ? 'negative' : 'positive');
    if (compare) this.B.update(c, t, 'negative');

    // magnification lines from the wafer to the cross-section
    const wp = this.pose.pos;
    const arr = this.zoomPos;
    const slabs = compare ? [this.A, this.B] : [this.A];
    const from = new THREE.Vector3(wp.x, wp.y + 0.05, 0);
    const k = this.pose.at === 'transit' ? 0.4 : 1;
    let n = 0;
    const ends = compare ? [[-1, 0], [1, 1]] : [[-1, 0], [1, 0]];
    for (const [sx, si] of ends) {
      const sl = slabs[Math.min(si, slabs.length - 1)];
      sl.group.updateWorldMatrix(true, false);
      this.corner.set(sx * (W / 2 + 0.25), 2.9, 0).applyMatrix4(sl.group.matrixWorld);
      arr.setXYZ(n++, from.x, from.y, from.z);
      arr.setXYZ(n++, this.corner.x, this.corner.y, this.corner.z);
    }
    while (n < 8) arr.setXYZ(n++, from.x, from.y, from.z);
    arr.needsUpdate = true;
    (this.zoom.material as THREE.LineBasicMaterial).opacity = 0.3 * t.vis * k;
  }
}
