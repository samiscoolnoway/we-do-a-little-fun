import * as THREE from 'three';

interface MatRef {
  m: THREE.MeshStandardMaterial;
}

export interface CompEntry {
  id: string;
  /** first registered root (kept for compatibility) */
  root: THREE.Object3D;
  /** every root registered under this id */
  roots: THREE.Object3D[];
  /** roots drawn when the component is isolated for inspection */
  isoRoots: THREE.Object3D[];
  mats: MatRef[];
  picks: THREE.Object3D[];
  priority: number;
  bounds?: () => THREE.Box3;
  value: number; // smoothed emphasis 0..1
}

const EMPH_COLOR = new THREE.Color(0x3f6fc4);
const EMPH_STRENGTH = 0.12;
const _box = new THREE.Box3();

export interface PickHit {
  id: string;
  object: THREE.Object3D;
}

/** Knows which scene objects are inspectable components: picking, hover/selection glow, bounds, isolation roots. */
export class Registry {
  entries = new Map<string, CompEntry>();
  private pickList: THREE.Object3D[] = [];
  private raycaster = new THREE.Raycaster();

  /**
   * Register `root` (and its meshes) under a component id. Calling it again with the same id adds another root.
   * `isolate: false` keeps a root out of the isolated inspection view (e.g. the magnified cross-section of the wafer);
   * `isoRoot` replaces it by a different object for isolation (e.g. the whole cross-section for the resist).
   */
  register(
    id: string,
    root: THREE.Object3D,
    opts: { priority?: number; bounds?: () => THREE.Box3; pick?: THREE.Object3D[]; emph?: boolean; isolate?: boolean; isoRoot?: THREE.Object3D } = {},
  ) {
    const entry: CompEntry = this.entries.get(id) ?? { id, root, roots: [], isoRoots: [], mats: [], picks: [], priority: opts.priority ?? 1, value: 0 };
    entry.priority = opts.priority ?? entry.priority;
    entry.roots.push(root);
    if (opts.isolate !== false) entry.isoRoots.push(opts.isoRoot ?? root);
    if (opts.bounds) entry.bounds = opts.bounds;
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!(mesh as any).isMesh && !(mesh as any).isInstancedMesh) return;
      if (!o.userData.nopick) {
        o.userData.comp = id;
        entry.picks.push(o);
      }
      if (opts.emph === false) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const cloned = mats.map((m) => {
        const sm = m as THREE.MeshStandardMaterial;
        if (!sm.isMeshStandardMaterial || sm.userData.noEmph) return m;
        const c = sm.clone();
        c.userData = { ...sm.userData };
        c.emissive.copy(EMPH_COLOR);
        c.emissiveIntensity = 0;
        entry.mats.push({ m: c });
        return c;
      });
      mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
    });
    for (const p of opts.pick ?? []) {
      p.userData.comp = id;
      entry.picks.push(p);
    }
    this.entries.set(id, entry);
    this.pickList = [];
    for (const e of this.entries.values()) this.pickList.push(...e.picks);
  }

  setEmphasis(id: string, v: number) {
    const e = this.entries.get(id);
    if (!e) return;
    e.value = v;
    const k = v * EMPH_STRENGTH;
    for (const r of e.mats) r.m.emissiveIntensity = k;
  }

  private visibleDeep(o: THREE.Object3D) {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  }

  /** Highest-priority component under the pointer. `allow` limits which ids may be hit (exterior view, isolation). */
  pickHit(ndc: THREE.Vector2 | { x: number; y: number }, camera: THREE.Camera, allow?: (id: string) => boolean): PickHit | null {
    this.raycaster.setFromCamera(ndc as THREE.Vector2, camera);
    const list = this.pickList.filter((o) => this.visibleDeep(o) && (!allow || allow(o.userData.comp)));
    const hits = this.raycaster.intersectObjects(list, false);
    let best: { id: string; pr: number; d: number; object: THREE.Object3D } | null = null;
    for (const h of hits) {
      const id = h.object.userData.comp as string | undefined;
      if (!id) continue;
      const pr = this.entries.get(id)?.priority ?? 0;
      if (!best || pr > best.pr || (pr === best.pr && h.distance < best.d)) best = { id, pr, d: h.distance, object: h.object };
    }
    return best ? { id: best.id, object: best.object } : null;
  }

  pick(ndc: THREE.Vector2 | { x: number; y: number }, camera: THREE.Camera, allow?: (id: string) => boolean): string | null {
    return this.pickHit(ndc, camera, allow)?.id ?? null;
  }

  box(id: string, out = new THREE.Box3()): THREE.Box3 | null {
    const e = this.entries.get(id);
    if (!e) return null;
    if (e.bounds) return out.copy(e.bounds());
    return this.rootsBox(e.roots, out, false);
  }

  /** Bounds of what is drawn when the component is isolated (its isolation roots, visible meshes only). */
  isoBox(id: string, out = new THREE.Box3()): THREE.Box3 | null {
    const e = this.entries.get(id);
    if (!e) return null;
    if (e.bounds) return out.copy(e.bounds());
    return this.rootsBox(e.isoRoots, out, true);
  }

  private rootsBox(roots: THREE.Object3D[], out: THREE.Box3, instanced: boolean): THREE.Box3 | null {
    out.makeEmpty();
    for (const r of roots) {
      r.updateWorldMatrix(true, true);
      r.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!(m as any).isMesh || o.userData.nobounds || !o.visible) return;
        if ((m as any).isInstancedMesh) {
          if (!instanced) return;
          (m as unknown as THREE.InstancedMesh).computeBoundingBox();
          const ib = (m as unknown as THREE.InstancedMesh).boundingBox;
          if (ib) out.union(_box.copy(ib).applyMatrix4(o.matrixWorld));
          return;
        }
        _box.setFromObject(o);
        if (!_box.isEmpty()) out.union(_box);
      });
    }
    return out.isEmpty() ? null : out;
  }
}
