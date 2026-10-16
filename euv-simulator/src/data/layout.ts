import * as THREE from 'three';

/**
 * Scene layout and optical geometry. One scene unit is an arbitrary length; the
 * model is NOT to scale (droplets are ~10^4 times smaller than the collector).
 *
 * Coordinates: x right, y up, z towards the viewer. The optical chain lives in
 * the z = 0 plane so every mirror normal follows from the law of reflection.
 */
export const DEG = Math.PI / 180;
export const v3 = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

// ───────────── Source module ─────────────
export const F1 = v3(-7, 3); // plasma (first focus of the collector ellipse)
export const IF = v3(-2, 3); // intermediate focus (second focus)
export const ELL = { a: 5, c: 2.5, e: 0.5, ell: 3.75 }; // |F1F2| = 2c, semi-latus rectum ell = a(1-e²)
export const COLLECTOR = { thetaHole: 11.5 * DEG, thetaMax: 68 * DEG, vertexX: -9.5 };

/** Distance from F1 to the collector surface at polar angle θ (measured from the −x axis). */
export const collectorR = (theta: number) => ELL.ell / (1 + ELL.e * Math.cos(theta));

/** Point on the ellipsoidal collector: θ from the axis, ψ azimuth around the axis. */
export function collectorPoint(theta: number, psi: number, out = new THREE.Vector3()) {
  const r = collectorR(theta);
  const rho = r * Math.sin(theta);
  return out.set(F1.x - r * Math.cos(theta), F1.y + rho * Math.cos(psi), F1.z + rho * Math.sin(psi));
}

export const SRC = {
  vessel: { x0: -12, x1: -0.6, cy: 3, r: 4.1 },
  nozzleY: 6.4,
  catcherY: -0.1,
  dropV: 1.5, // units/s
  dropR: 0.17,
  sMain: 3.4, // nozzle → main focus distance
  sPre: 2.65, // nozzle → pre-pulse focus distance
  sCatch: 6.5,
  Td: 1.0, // one shot per second of timeline (real source: ~50 000 per second)
  tShot: 0.6, // phase of main-pulse arrival inside each cycle
  laserOut: v3(-13.4, 3),
  hole: v3(-9.7, 3),
  prePt: v3(-7, 3.75),
  laserBox: { x0: -18.8, x1: -13.4, y0: 1.5, y1: 4.5, hz: 1.3 },
  v_euv: 22, // visual speed of EUV pulses (units/s)
  v_laser: 14,
};
export const PRE_DELAY = (SRC.sMain - SRC.sPre) / SRC.dropV; // 0.5 s between pre-pulse and main pulse

// ───────────── Optical path (plasma → collector → IF → illuminator → mask → projection → wafer) ─────────────
export type NodeKind = 'source' | 'collector' | 'if' | 'mirror' | 'reticle' | 'wafer';
export interface PathNode {
  id: string;
  kind: NodeKind;
  p: THREE.Vector3;
  w: number; // beam half-width at the node (visual)
  radius?: number; // mirror radius
}

export const NODES: PathNode[] = [
  { id: 'plasma', kind: 'source', p: F1.clone(), w: 0 },
  { id: 'collector', kind: 'collector', p: collectorPoint(45 * DEG, 0), w: 1.4 },
  { id: 'if', kind: 'if', p: IF.clone(), w: 0.05 },
  { id: 'ffm', kind: 'mirror', p: v3(3.17, 4.88), w: 0.9, radius: 1.3 },
  { id: 'pfm', kind: 'mirror', p: v3(9.08, 3.84), w: 0.55, radius: 1.15 },
  { id: 'relay', kind: 'mirror', p: v3(14.595, 5.6), w: 0.5, radius: 0.8 },
  { id: 'reticle', kind: 'reticle', p: v3(16, 13.5), w: 0.95 },
  { id: 'm1', kind: 'mirror', p: v3(17.6, 4.5), w: 1.0, radius: 1.12 },
  { id: 'm2', kind: 'mirror', p: v3(19.2, 11), w: 0.85, radius: 0.92 },
  { id: 'm3', kind: 'mirror', p: v3(20.8, 4.5), w: 0.75, radius: 0.88 },
  { id: 'm4', kind: 'mirror', p: v3(22.4, 11), w: 0.55, radius: 0.68 },
  { id: 'm5', kind: 'mirror', p: v3(24.0, 4.5), w: 0.45, radius: 0.64 },
  { id: 'm6', kind: 'mirror', p: v3(25.6, 11), w: 0.55, radius: 0.78 },
  { id: 'wafer', kind: 'wafer', p: v3(27.0, -2.5), w: 0.24 },
];
export const N_IDX = Object.fromEntries(NODES.map((n, i) => [n.id, i])) as Record<string, number>;
export const RETICLE_I = N_IDX.reticle;

export interface Segment {
  a: THREE.Vector3;
  b: THREE.Vector3;
  dir: THREE.Vector3;
  len: number;
  s0: number; // cumulative distance at a
}
export const SEGS: Segment[] = [];
export const S_AT: number[] = [0];
for (let i = 0; i < NODES.length - 1; i++) {
  const a = NODES[i].p;
  const b = NODES[i + 1].p;
  const d = b.clone().sub(a);
  const len = d.length();
  SEGS.push({ a, b, dir: d.clone().normalize(), len, s0: S_AT[i] });
  S_AT.push(S_AT[i] + len);
}
export const S_TOTAL = S_AT[S_AT.length - 1];
export const S_RETICLE = S_AT[RETICLE_I];

/** Mirror/reticle normals from the law of reflection: n ∝ d_out − d_in, facing the incoming beam. */
export const NORMALS: (THREE.Vector3 | null)[] = NODES.map((node, i) => {
  if (i === 0 || i === NODES.length - 1) return null;
  const dIn = SEGS[i - 1].dir;
  const dOut = SEGS[i].dir;
  const n = dOut.clone().sub(dIn);
  if (n.lengthSq() < 1e-8) return null;
  n.normalize();
  if (n.dot(dIn) > 0) n.negate();
  return n;
});
/** The wafer faces up, the beam arrives from above. */
NORMALS[NODES.length - 1] = v3(0, 1, 0);

export function pointAtS(s: number, out = new THREE.Vector3()): THREE.Vector3 {
  const c = Math.min(Math.max(s, 0), S_TOTAL);
  let i = 0;
  while (i < SEGS.length - 1 && c > S_AT[i + 1]) i++;
  const seg = SEGS[i];
  const u = (c - seg.s0) / seg.len;
  return out.copy(seg.a).lerp(seg.b, u);
}

/** Number of mirror reflections experienced by a photon that has travelled distance s (collector counts as one). */
export function reflectionsAt(s: number): number {
  let n = 0;
  for (let i = 1; i < NODES.length - 1; i++) {
    const k = NODES[i].kind;
    if ((k === 'collector' || k === 'mirror' || k === 'reticle') && s > S_AT[i]) n++;
  }
  return n;
}

// ───────────── Beamlets after the mask: a bundle of rays carrying the pattern ─────────────
export const N_BEAMLETS = 7;
export const BEAMLET_U = Array.from({ length: N_BEAMLETS }, (_, i) => (i - (N_BEAMLETS - 1) / 2) / ((N_BEAMLETS - 1) / 2));
/** Per-node unit tangent in the xy plane used to offset beamlets along the mirror surface. */
export const TANGENTS: THREE.Vector3[] = NODES.map((node, i) => {
  const n = NORMALS[i];
  if (n && node.kind !== 'wafer') return v3(-n.y, n.x).normalize();
  return v3(1, 0);
});
/** Sign chain so beamlets never twist between consecutive nodes. */
export const SIGMA: number[] = (() => {
  const sig = new Array(NODES.length).fill(1);
  for (let k = RETICLE_I + 1; k < NODES.length; k++) {
    const d = SEGS[k - 1].dir;
    const perp = v3(-d.y, d.x);
    const a = Math.sign(TANGENTS[k - 1].dot(perp)) || 1;
    const b = Math.sign(TANGENTS[k].dot(perp)) || 1;
    sig[k] = sig[k - 1] * a * b;
  }
  return sig;
})();
export function beamletPoint(k: number, u: number, out = new THREE.Vector3()) {
  const w = NODES[k].w;
  return out.copy(NODES[k].p).addScaledVector(TANGENTS[k], SIGMA[k] * u * w);
}
/** Pattern bits (1 reflected, 0 absorbed by the mask absorber) — a simple 1-D slice of the circuit. */
export const PATTERN_BITS = [1, 1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1];

// ───────────── Wafer, track and slab placement ─────────────
export const WAFER_R = 1.75;
export const W0 = v3(27, -2.5);
export const TOOL_Y = -16;
export const WAFER_TOOL_Y = -15.45;
export const ROUTE_Y = -11.2;
export const EXIT_X = 31.8;
export const TOOLS = {
  bake: { x: 24, w: 9, name: 'Post-Exposure Bake' },
  develop: { x: 10, w: 9, name: 'Development' },
  etch: { x: -3, w: 9, name: 'Etch' },
};
export const SLAB = { w: 5.4, siH: 0.55, filmH: 0.5, resH: 0.95, depth: 1.1, y: -9.9 };

export const ZONES = {
  scanner: { x0: -19.6, x1: 32.4, y0: -5.4, y1: 17.4, z: 4.2 },
  down: { x0: -9.2, x1: 29.6, y0: -20.9, y1: -12.2, z: 3.4 },
};

/** Arc-length parametrised point on a polyline. */
export function polylineAt(pts: THREE.Vector3[], u: number, out = new THREE.Vector3()) {
  let total = 0;
  const lens: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const l = pts[i].distanceTo(pts[i + 1]);
    lens.push(l);
    total += l;
  }
  let d = Math.min(Math.max(u, 0), 1) * total;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) return out.copy(pts[i]).lerp(pts[i + 1], lens[i] > 0 ? d / lens[i] : 0);
    d -= lens[i];
  }
  return out.copy(pts[pts.length - 1]);
}

export const ROUTE_SCANNER_TO_BAKE = [W0, v3(EXIT_X, W0.y), v3(EXIT_X, ROUTE_Y), v3(TOOLS.bake.x, ROUTE_Y), v3(TOOLS.bake.x, WAFER_TOOL_Y)];
export const ROUTE_BAKE_TO_DEV = [v3(TOOLS.bake.x, WAFER_TOOL_Y), v3(TOOLS.bake.x, ROUTE_Y), v3(TOOLS.develop.x, ROUTE_Y), v3(TOOLS.develop.x, WAFER_TOOL_Y)];
export const ROUTE_DEV_TO_ETCH = [v3(TOOLS.develop.x, WAFER_TOOL_Y), v3(TOOLS.develop.x, ROUTE_Y), v3(TOOLS.etch.x, ROUTE_Y), v3(TOOLS.etch.x, WAFER_TOOL_Y)];
