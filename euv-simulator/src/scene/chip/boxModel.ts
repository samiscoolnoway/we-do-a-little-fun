import * as THREE from 'three';
import { CHIP_MATS, type ChipMat } from '../../data/chip';

/**
 * Microscopic structures are drawn as axis-aligned boxes: one shared unit cube, one InstancedMesh per material.
 * Because every part is a box, a cross-section is exact (each box is trimmed at the cut plane, so the cut faces
 * are real faces), and exploding layers, hiding layers, isolating a part and highlighting are all per-instance
 * updates of the same few draw calls.
 */
export interface Box {
  min: [number, number, number];
  max: [number, number, number];
  mat: ChipMat;
  /** what this box is (CHIP_INFO key, or a key mapped to one) */
  part: string;
  /** stack layer (CHIP_LAYERS id): exploded view and layer visibility */
  layer: string;
  /** insulating fill: shown or hidden with the dielectric toggle */
  diel?: boolean;
  /** transistors this box belongs to */
  devs?: string[];
  /** structure group in the circuit-region model (blk-*) */
  group?: string;
  /** cell index in the circuit-region model */
  cell?: number;
  /** nesting depth: at a cut, inner parts sit a hair in front of the part around them (no z-fighting) */
  nest?: number;
  /** label shown for this box (a few representative ones) */
  label?: string;
}

export interface LayoutOpts {
  explode: number;
  /** distance between exploded layers (model units) */
  gap: number;
  hidden: Set<string>;
  /** keep only one half: x ≥ at (gate cut, seen from -x) or z ≤ at (channel cut, seen from +z) */
  section: { axis: 'x' | 'z'; at: number } | null;
  /** trim everything to this region (isolated transistor) */
  crop?: THREE.Box3 | null;
  keep?: ((b: Box, i: number) => boolean) | null;
}

const UNIT = new THREE.BoxGeometry(1, 1, 1);
const mats = new Map<ChipMat, THREE.Material>();
const LAYER_ORDER: Record<string, number> = { sub: 0, iso: 1, fe: 2, ct: 3, m0: 4, m1: 5, m2: 6, m3: 7, top: 8, pass: 9 };

/** One material per kind, shared by every model (and matching the colours of the legend). */
export function chipMaterial(k: ChipMat): THREE.Material {
  let m = mats.get(k);
  if (m) return m;
  const d = CHIP_MATS[k];
  if (d.clear) {
    m = new THREE.MeshPhysicalMaterial({ color: d.color, transparent: true, opacity: d.clear, roughness: d.rough ?? 0.2, metalness: 0, depthWrite: false, side: THREE.DoubleSide });
  } else {
    m = new THREE.MeshStandardMaterial({ color: d.color, roughness: d.rough ?? 0.5, metalness: d.metal ? 0.8 : 0.05 });
  }
  mats.set(k, m);
  return m;
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _c = new THREE.Color();

export class BoxModel {
  readonly group = new THREE.Group();
  readonly boxes: Box[];
  /** current extents of every box after explode / section / crop (null when not drawn) */
  readonly placed: (THREE.Box3 | null)[];
  private meshes = new Map<ChipMat, { mesh: THREE.InstancedMesh; all: number[]; shown: number[] }>();
  private tintFn: ((b: Box, i: number) => number | [number, number, number]) | null = null;

  constructor(boxes: Box[]) {
    this.boxes = boxes;
    this.placed = boxes.map(() => null);
    const by = new Map<ChipMat, number[]>();
    boxes.forEach((b, i) => {
      const l = by.get(b.mat) ?? [];
      l.push(i);
      by.set(b.mat, l);
    });
    for (const [mat, all] of by) {
      const mesh = new THREE.InstancedMesh(UNIT, chipMaterial(mat), all.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let k = 0; k < all.length; k++) mesh.setColorAt(k, _c.setRGB(1, 1, 1));
      mesh.userData.mat = mat;
      // translucent insulators are drawn after the solids
      if (CHIP_MATS[mat].clear) mesh.renderOrder = 2;
      this.group.add(mesh);
      this.meshes.set(mat, { mesh, all, shown: [] });
    }
  }

  /** Recompute every instance from the layout options. Hidden instances are compacted away (not drawn, not picked). */
  layout(o: LayoutOpts) {
    const eps = 0.04;
    for (const { mesh, all, shown } of this.meshes.values()) {
      shown.length = 0;
      for (const i of all) {
        const b = this.boxes[i];
        this.placed[i] = null;
        if (o.hidden.has(b.layer) || (b.diel && o.hidden.has('diel'))) continue;
        if (o.keep && !o.keep(b, i)) continue;
        const lo = new THREE.Vector3(...b.min);
        const hi = new THREE.Vector3(...b.max);
        if (o.crop) {
          lo.max(o.crop.min);
          hi.min(o.crop.max);
        }
        if (o.section) {
          // inner parts are cut slightly in front of the parts around them, insulators slightly behind
          const off = (b.nest ?? 0) * eps - (b.diel ? eps : 0);
          if (o.section.axis === 'x') lo.x = Math.max(lo.x, o.section.at - off);
          else hi.z = Math.min(hi.z, o.section.at + off);
        }
        if (hi.x - lo.x <= 1e-4 || hi.y - lo.y <= 1e-4 || hi.z - lo.z <= 1e-4) continue;
        const dy = (LAYER_ORDER[b.layer] ?? 0) * o.explode * o.gap;
        lo.y += dy;
        hi.y += dy;
        this.placed[i] = new THREE.Box3(lo, hi);
        _p.addVectors(lo, hi).multiplyScalar(0.5);
        _s.subVectors(hi, lo);
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(shown.length, _m);
        shown.push(i);
      }
      mesh.count = shown.length;
      mesh.visible = shown.length > 0;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
    }
    this.applyTint();
  }

  /** Per-instance colour factor: 1 = normal, below 1 dims, above 1 brightens; a triple tints (illustrative ON state). */
  tint(fn: ((b: Box, i: number) => number | [number, number, number]) | null) {
    this.tintFn = fn;
    this.applyTint();
  }

  private applyTint() {
    for (const { mesh, shown } of this.meshes.values()) {
      for (let k = 0; k < shown.length; k++) {
        const f = this.tintFn ? this.tintFn(this.boxes[shown[k]], shown[k]) : 1;
        if (typeof f === 'number') mesh.setColorAt(k, _c.setRGB(f, f, f));
        else mesh.setColorAt(k, _c.setRGB(f[0], f[1], f[2]));
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** The box under the ray. Insulators and passivation are only picked when nothing solid is behind them. */
  pick(ray: THREE.Raycaster): number | null {
    const list = [...this.meshes.values()].filter((m) => m.mesh.visible).map((m) => m.mesh);
    const hits = ray.intersectObjects(list, false);
    let fallback: number | null = null;
    for (const h of hits) {
      if (h.instanceId === undefined) continue;
      const e = this.meshes.get((h.object as THREE.InstancedMesh).userData.mat as ChipMat)!;
      const i = e.shown[h.instanceId];
      if (i === undefined) continue;
      if (this.boxes[i].diel || this.boxes[i].mat === 'pass') {
        if (fallback === null) fallback = i;
        continue;
      }
      return i;
    }
    return fallback;
  }

  /** Bounds of the drawn boxes (optionally only those matching `pred`). */
  bounds(pred?: (b: Box, i: number) => boolean): THREE.Box3 {
    const out = new THREE.Box3();
    this.placed.forEach((p, i) => {
      if (p && (!pred || pred(this.boxes[i], i))) out.union(p);
    });
    return out;
  }

  /** Number of drawn instances per material (tests). */
  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, { shown }] of this.meshes) out[k] = shown.length;
    return out;
  }

  dispose() {
    for (const { mesh } of this.meshes.values()) mesh.dispose();
  }
}
