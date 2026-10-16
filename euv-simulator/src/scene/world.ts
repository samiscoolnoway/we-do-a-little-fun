import * as THREE from 'three';
import { ZONES } from '../data/layout';
import { STAGES } from '../data/stages';
import { COLOR, backdropTexture, edgeBox, glass } from './gfx';
import { FrameCtx, SimModule } from './timing';

/** Backdrop, zone enclosures (scanner vs downstream tools) and lighting. */
export class WorldModule implements SimModule {
  group = new THREE.Group();
  private scannerEdges: THREE.LineSegments;
  private downEdges: THREE.LineSegments;
  private scannerFace: THREE.Mesh;
  private downFace: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    const g = this.group;
    // lights
    scene.add(new THREE.HemisphereLight(0xb9c8f0, 0x161d2e, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(14, 28, 24);
    const fill = new THREE.DirectionalLight(0x86a6ff, 0.6);
    fill.position.set(-26, 6, 16);
    const under = new THREE.DirectionalLight(0xbfd2ff, 0.45);
    under.position.set(6, -14, 14);
    scene.add(key, fill, under);

    // blueprint backdrop
    const tex = backdropTexture();
    const back = new THREE.Mesh(new THREE.PlaneGeometry(210, 140), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    back.position.set(6.5, -2.6, -8);
    back.userData.nopick = true;
    g.add(back);

    const mkZone = (z: { x0: number; x1: number; y0: number; y1: number; z: number }, color: number) => {
      const w = z.x1 - z.x0;
      const h = z.y1 - z.y0;
      const edges = edgeBox(w, h, z.z * 2, color, 0.5);
      edges.position.set((z.x0 + z.x1) / 2, (z.y0 + z.y1) / 2, 0);
      const face = new THREE.Mesh(new THREE.BoxGeometry(w, h, z.z * 2), glass(color, 0.018));
      face.position.copy(edges.position);
      face.raycast = () => {};
      g.add(edges, face);
      return { edges, face };
    };
    const a = mkZone(ZONES.scanner, COLOR.euv);
    const b = mkZone(ZONES.down, 0xe0b050);
    this.scannerEdges = a.edges;
    this.scannerFace = a.face;
    this.downEdges = b.edges;
    this.downFace = b.face;
  }

  private first = true;

  update(c: FrameCtx) {
    const inScanner = STAGES[c.stage].inScanner;
    // frame-rate independent easing; the first frame starts at the target so the closed machine never flashes the frames
    const k = this.first ? 1 : 1 - Math.exp(-c.dt * 6);
    this.first = false;
    // the zone frames explain the interior; on the closed machine they would just look like bounding boxes
    const show = c.casingOpen ? 1 : 0;
    const se = this.scannerEdges.material as THREE.LineBasicMaterial;
    const de = this.downEdges.material as THREE.LineBasicMaterial;
    se.opacity += ((inScanner ? 0.6 : 0.22) * show - se.opacity) * k;
    de.opacity += ((inScanner ? 0.22 : 0.75) * show - de.opacity) * k;
    (this.scannerFace.material as THREE.MeshPhysicalMaterial).opacity += ((inScanner ? 0.024 : 0.008) * show - (this.scannerFace.material as THREE.MeshPhysicalMaterial).opacity) * k;
    (this.downFace.material as THREE.MeshPhysicalMaterial).opacity += ((inScanner ? 0.006 : 0.03) * show - (this.downFace.material as THREE.MeshPhysicalMaterial).opacity) * k;
  }
}
