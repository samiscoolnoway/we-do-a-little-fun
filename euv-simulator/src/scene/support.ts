import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { IF, SRC, W0 } from '../data/layout';
import { darkSteel, steel } from './gfx';
import { Registry } from './registry';
import { FrameCtx, SimModule } from './timing';

/**
 * Supporting systems inside the enclosure: structural frame with vibration isolation, vacuum pumps and valves,
 * cooling loops, and cabling with sensors. Simplified educational representations: positions, sizes and counts
 * are illustrative; real arrangements are proprietary.
 */

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const at = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);
function merged(geos: THREE.BufferGeometry[], mat: THREE.Material) {
  const clean = geos.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
    return n;
  });
  return new THREE.Mesh(mergeGeometries(clean, false)!, mat);
}
/** Pipe through corner points with short rounded bends, like real piping (straight runs, right-angle turns). */
function tube(pts: THREE.Vector3[], r: number, mat: THREE.Material, seg = 120) {
  const path = new THREE.CurvePath<THREE.Vector3>();
  const bend = 0.35;
  let cur = pts[0].clone();
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const next = pts[i + 1];
    const dir = b.clone().sub(a);
    const len = dir.length();
    dir.normalize();
    const cut = next ? Math.min(bend, len / 2, next.distanceTo(b) / 2) : 0;
    const end = b.clone().addScaledVector(dir, -cut);
    if (end.distanceTo(cur) > 1e-4) path.add(new THREE.LineCurve3(cur.clone(), end));
    if (next) {
      const out = b.clone().addScaledVector(next.clone().sub(b).normalize(), cut);
      path.add(new THREE.QuadraticBezierCurve3(end, b.clone(), out));
      cur = out;
    } else cur = end;
  }
  return new THREE.Mesh(new THREE.TubeGeometry(path, seg, r, 10, false), mat);
}

const PLINTH = { x0: -20.4, x1: 33.8, y0: -6.6, y1: -5.6, zd: 4.4 };
const FLOOR_Y = -21.0;

export class SupportModule implements SimModule {
  group = new THREE.Group();
  private leds: THREE.InstancedMesh | null = null;
  private ledPhase: number[] = [];
  private col = new THREE.Color();

  constructor(reg: Registry) {
    const frame = this.buildFrame();
    const vac = this.buildVacuum();
    const cool = this.buildCooling();
    const cab = this.buildCabling();
    this.group.add(frame, vac, cool, cab);
    // framing leaves out the long pedestal legs so the isolators and metrology frame stay large on screen
    reg.register('frame', frame, { priority: 0.6, bounds: () => new THREE.Box3(v(PLINTH.x0, PLINTH.y0, -PLINTH.zd), v(PLINTH.x1, 2.4, PLINTH.zd)) });
    reg.register('vacuumPumps', vac, { priority: 1.2 });
    reg.register('cooling', cool, { priority: 1.1 });
    reg.register('cabling', cab, { priority: 1.1 });
  }

  // ── structural frame, pedestals, isolators, metrology frame, columns ──
  private buildFrame(): THREE.Group {
    const g = new THREE.Group();
    const steelM = darkSteel(0x3a4252, 0.5, 0.8);
    const deck = darkSteel(0x262c37, 0.55, 0.75);
    const P = PLINTH;
    const w = P.x1 - P.x0;
    const cx = (P.x0 + P.x1) / 2;
    // base frame: perimeter beams and cross members (the plinth the machine stands on)
    const beams: THREE.BufferGeometry[] = [];
    for (const z of [-P.zd + 0.3, P.zd - 0.3]) beams.push(at(new THREE.BoxGeometry(w, 0.9, 0.5), cx, (P.y0 + P.y1) / 2, z));
    for (let x = P.x0 + 0.25; x <= P.x1; x += (w - 0.5) / 9) beams.push(at(new THREE.BoxGeometry(0.5, 0.9, P.zd * 2 - 0.6), x, (P.y0 + P.y1) / 2, 0));
    g.add(merged(beams, steelM));
    const plate = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, P.zd * 2), deck);
    plate.position.set(cx, P.y1 - 0.04, 0);
    g.add(plate);
    // pedestal legs down to the fab floor, with levelling feet
    const legs: THREE.BufferGeometry[] = [];
    const feet: THREE.BufferGeometry[] = [];
    for (const x of [P.x0 + 0.6, P.x1 - 0.6])
      for (const z of [-P.zd + 0.6, P.zd - 0.6]) {
        legs.push(at(new THREE.BoxGeometry(0.6, P.y0 - FLOOR_Y, 0.6), x, (P.y0 + FLOOR_Y) / 2, z));
        feet.push(at(new THREE.CylinderGeometry(0.42, 0.5, 0.18, 16), x, FLOOR_Y + 0.09, z));
      }
    g.add(merged(legs, steelM), merged(feet, steel(0x8c97aa, 0.35, 0.9)));
    // stands under the source vessel and the drive laser
    const stands: THREE.BufferGeometry[] = [];
    for (const x of [-10.6, -2.0]) stands.push(at(new THREE.BoxGeometry(0.7, 2.1, 0.7), x, -4.55, 0));
    stands.push(at(new THREE.BoxGeometry(3.6, SRC.laserBox.y0 - P.y1, 1.6), (SRC.laserBox.x0 + SRC.laserBox.x1) / 2, (SRC.laserBox.y0 + P.y1) / 2, 0));
    g.add(merged(stands, steelM));
    // vibration isolators carrying the metrology frame
    const bellowsProfile: THREE.Vector2[] = [];
    for (let i = 0; i <= 16; i++) bellowsProfile.push(new THREE.Vector2(0.34 + (i % 2 ? 0.06 : 0), (i / 16) * 0.62));
    const bellows = new THREE.LatheGeometry(bellowsProfile, 24);
    const isoBase: THREE.BufferGeometry[] = [];
    const isoBellows: THREE.BufferGeometry[] = [];
    for (const x of [16.6, 24.4, 32.2])
      for (const z of [-2.7, 2.7]) {
        isoBase.push(at(new THREE.CylinderGeometry(0.46, 0.5, 0.22, 24), x, P.y1 + 0.11, z), at(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 24), x, -4.66, z));
        isoBellows.push(at(bellows.clone(), x, P.y1 + 0.22, z));
      }
    g.add(merged(isoBase, steel(0x7d889c, 0.35, 0.9)), merged(isoBellows, new THREE.MeshStandardMaterial({ color: 0x1b1f26, roughness: 0.8, metalness: 0.1 })));
    // metrology frame: a stiff, dark plate under the optics and the wafer stage
    const metro = new THREE.Mesh(new THREE.BoxGeometry(18.8, 0.56, 6.0), new THREE.MeshStandardMaterial({ color: 0x343841, roughness: 0.82, metalness: 0.15 }));
    metro.position.set(24.1, -4.32, 0);
    g.add(metro);
    // columns from the metrology frame to the projection optics box
    const cols: THREE.BufferGeometry[] = [];
    for (const x of [16.4, 26.6]) for (const z of [-2.5, 2.5]) cols.push(at(new THREE.BoxGeometry(0.36, 6.2, 0.36), x, -0.9, z));
    g.add(merged(cols, steelM));
    return g;
  }

  // ── turbomolecular pumps, gate valve, foreline manifold ──
  private buildVacuum(): THREE.Group {
    const g = new THREE.Group();
    const body = steel(0xc3cad6, 0.28, 0.9);
    const dark = darkSteel(0x2f3644, 0.45, 0.8);
    const turbo = (x: number, y: number, z: number, axis: 'y' | 'z') => {
      const p = new THREE.Group();
      const parts: THREE.BufferGeometry[] = [];
      parts.push(new THREE.CylinderGeometry(0.46, 0.46, 1.1, 28));
      for (let i = 0; i < 6; i++) parts.push(at(new THREE.CylinderGeometry(0.52, 0.52, 0.05, 28), 0, -0.4 + i * 0.16, 0));
      parts.push(at(new THREE.CylinderGeometry(0.66, 0.66, 0.1, 28), 0, 0.6, 0));
      const housing = merged(parts, body);
      const ctrl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.36), dark);
      ctrl.position.set(0.52, -0.25, 0);
      const outlet = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 12).rotateZ(Math.PI / 2), body);
      outlet.position.set(-0.6, -0.35, 0);
      p.add(housing, ctrl, outlet);
      if (axis === 'z') p.rotation.x = Math.PI / 2;
      p.position.set(x, y, z);
      g.add(p);
      return p;
    };
    // under the source vessel (neck up into the vessel), behind the projection optics box, beside the wafer stage
    turbo(-6.4, -1.9, -2.6, 'y');
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 16), body);
    neck.position.set(-6.4, -0.9, -2.6);
    g.add(neck);
    turbo(19.4, 6.0, -2.95, 'z');
    turbo(23.6, 9.6, -2.95, 'z');
    turbo(31.4, -2.6, -2.9, 'y');
    // gate valve where the source meets the illuminator (the beam passes through the open bore)
    const valve = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.15, 12, 32).rotateY(Math.PI / 2), body);
    ring.position.set(0.75, IF.y, 0);
    const bonnet = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.3, 1.5), dark);
    bonnet.position.set(0.75, IF.y + 1.35, 0);
    const actuator = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.1, 16), body);
    actuator.position.set(0.75, IF.y + 2.55, 0);
    valve.add(ring, bonnet, actuator);
    g.add(valve);
    // foreline manifold and pipes to the pump outlets
    const man = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.7, 0.8), dark);
    man.position.set(5.4, -4.9, -3.4);
    g.add(man);
    const pipeM = steel(0x8f9aae, 0.35, 0.85);
    g.add(
      tube([v(-7.0, -2.25, -2.6), v(-7.0, -4.9, -2.6), v(-7.0, -4.9, -3.4), v(3.7, -4.9, -3.4)], 0.08, pipeM),
      tube([v(19.4, 5.65, -3.75), v(19.4, 5.65, -4.05), v(19.4, -4.75, -4.05), v(7.1, -4.75, -4.05), v(7.1, -4.75, -3.8)], 0.08, pipeM),
      tube([v(23.6, 9.25, -3.75), v(23.6, 9.25, -4.25), v(23.6, -4.95, -4.25), v(7.1, -4.95, -4.25), v(7.1, -4.95, -3.8)], 0.08, pipeM),
      tube([v(30.8, -2.95, -2.9), v(30.8, -5.1, -2.9), v(30.8, -5.1, -3.55), v(7.1, -5.1, -3.55)], 0.08, pipeM),
    );
    return g;
  }

  // ── chiller manifold and paired supply/return lines to the heat sources ──
  private buildCooling(): THREE.Group {
    const g = new THREE.Group();
    const man = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.9, 0.8), darkSteel(0x2a3140, 0.45, 0.8));
    man.position.set(-2.4, -4.85, -3.45);
    g.add(man);
    const supply = new THREE.MeshStandardMaterial({ color: 0x2f7fe0, roughness: 0.4, metalness: 0.3 });
    const ret = new THREE.MeshStandardMaterial({ color: 0xd9534f, roughness: 0.4, metalness: 0.3 });
    // straight runs along the floor at the back, then risers up to each heat source
    const dests: THREE.Vector3[][] = [
      // collector (back of the source vessel)
      [v(-3.0, -4.4, -3.45), v(-3.0, -4.4, -4.5), v(-9.8, -4.4, -4.5), v(-9.8, 3.0, -4.5), v(-9.8, 3.0, -4.15)],
      // drive laser
      [v(-3.4, -4.4, -3.45), v(-3.4, -4.4, -3.9), v(-16.1, -4.4, -3.9), v(-16.1, 2.6, -3.9), v(-16.1, 2.6, -1.4)],
      // projection optics box
      [v(-1.6, -4.4, -3.45), v(-1.6, -4.4, -4.6), v(17.4, -4.4, -4.6), v(17.4, 7.5, -4.6), v(17.4, 7.5, -2.3)],
      // wafer stage
      [v(-1.2, -4.4, -3.45), v(-1.2, -4.4, -3.1), v(21.0, -4.4, -3.1), v(21.0, -3.2, -3.1), v(21.0, -3.2, -2.0)],
      // reticle stage
      [v(-2.0, -4.4, -3.45), v(-2.0, -4.4, -4.8), v(14.9, -4.4, -4.8), v(14.9, 14.1, -4.8), v(14.9, 14.1, -2.0)],
    ];
    const fit = new THREE.CylinderGeometry(0.13, 0.13, 0.28, 12);
    const fitGeos: THREE.BufferGeometry[] = [];
    for (const pts of dests) {
      // the return line runs parallel to the supply line, offset sideways
      const off2 = v(0.24, 0.24, 0);
      g.add(tube(pts, 0.075, supply), tube(pts.map((p) => p.clone().add(off2)), 0.075, ret));
      const end = pts[pts.length - 1];
      fitGeos.push(at(fit.clone(), end.x, end.y, end.z), at(fit.clone(), end.x + 0.24, end.y + 0.24, end.z));
    }
    g.add(merged(fitGeos, steel(0xb8c1ce, 0.3, 0.9)));
    return g;
  }

  // ── cable trays, electronics rack, cable carrier to the wafer stage, sensor heads ──
  private buildCabling(): THREE.Group {
    const g = new THREE.Group();
    const trayM = steel(0x9aa5b8, 0.4, 0.85);
    const trays: THREE.BufferGeometry[] = [];
    const tray = (x0: number, x1: number, y: number, z: number) => {
      trays.push(at(new THREE.BoxGeometry(x1 - x0, 0.05, 0.7), (x0 + x1) / 2, y, z), at(new THREE.BoxGeometry(x1 - x0, 0.22, 0.04), (x0 + x1) / 2, y + 0.11, z - 0.35), at(new THREE.BoxGeometry(x1 - x0, 0.22, 0.04), (x0 + x1) / 2, y + 0.11, z + 0.35));
    };
    tray(-19.6, 33.0, -5.3, -4.0);
    g.add(merged(trays, trayM));
    // bundled cables in the tray
    const cableM = new THREE.MeshStandardMaterial({ color: 0x1c2029, roughness: 0.75, metalness: 0.1 });
    const bundle: THREE.BufferGeometry[] = [];
    for (const dz of [-0.18, 0, 0.18]) bundle.push(at(new THREE.CylinderGeometry(0.07, 0.07, 52.4, 8).rotateZ(Math.PI / 2), 6.7, -5.17, -4.0 + dz));
    g.add(merged(bundle, cableM));
    // electronics rack with status LEDs
    const rack = new THREE.Mesh(new THREE.BoxGeometry(2.6, 4.2, 1.0), new THREE.MeshStandardMaterial({ color: 0x151a22, roughness: 0.5, metalness: 0.5 }));
    rack.position.set(7.3, -2.9, -3.55);
    g.add(rack);
    const ledGeo = new THREE.BoxGeometry(0.1, 0.05, 0.02);
    const leds = new THREE.InstancedMesh(ledGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), 36);
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    for (let i = 0; i < 36; i++) {
      const r = Math.floor(i / 6);
      const cI = i % 6;
      leds.setMatrixAt(i, m4.makeTranslation(6.4 + cI * 0.34, -1.3 - r * 0.55, -3.04));
      leds.setColorAt(i, col.set(i % 7 === 3 ? 0xe0b050 : 0x2fd36f));
      this.ledPhase.push((i * 37) % 11);
    }
    leds.userData.nopick = false;
    this.leds = leds;
    g.add(leds);
    // riser from the tray to the rack and to the reticle-stage area
    g.add(tube([v(7.3, -5.15, -4.0), v(7.3, -4.9, -3.9), v(7.3, -4.95, -3.55)], 0.12, cableM, 16));
    g.add(tube([v(13.2, -5.1, -4.0), v(13.2, 14.4, -4.0), v(13.2, 14.4, -2.0)], 0.1, cableM, 60));
    // flexible cable carrier (energy chain) feeding the moving wafer stage
    const chainCurve = new THREE.CatmullRomCurve3([v(31.8, -5.15, -3.6), v(32.4, -4.6, -3.0), v(31.6, -4.1, -2.4), v(28.6, -3.95, -2.25), v(26.8, -3.6, -2.05)]);
    const links = 22;
    const chain = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.18, 0.36), darkSteel(0x2f3644, 0.5, 0.6), links);
    const q = new THREE.Quaternion();
    const up = v(1, 0, 0);
    for (let i = 0; i < links; i++) {
      const t = i / (links - 1);
      const p = chainCurve.getPointAt(t);
      const tan = chainCurve.getTangentAt(t);
      q.setFromUnitVectors(up, tan);
      chain.setMatrixAt(i, m4.compose(p, q, v(1, 1, 1)));
    }
    g.add(chain);
    // sensor heads beside the wafer: level sensor (two heads) and alignment sensor; encoder heads at the reticle stage
    const headM = darkSteel(0x3b4456, 0.4, 0.8);
    const lensM = new THREE.MeshStandardMaterial({ color: 0x0a1018, emissive: 0x3fd0f0, emissiveIntensity: 0.8, roughness: 0.2 });
    lensM.userData.noEmph = true;
    const heads: [number, number, number, number][] = [
      [W0.x - 2.3, W0.y + 0.85, 1.25, 0.45],
      [W0.x + 2.3, W0.y + 0.85, 1.25, -0.45],
      [W0.x + 1.3, W0.y + 0.95, -1.5, 0],
      [13.5, 14.05, 1.6, 0],
      [18.5, 14.05, 1.6, 0],
    ];
    for (const [x, y, z, rz] of heads) {
      const hd = new THREE.Group();
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.42), headM);
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 14), lensM);
      lens.position.y = -0.2;
      hd.add(b, lens);
      hd.position.set(x, y, z);
      hd.rotation.z = rz;
      g.add(hd);
    }
    return g;
  }

  update(c: FrameCtx) {
    // electronics status LEDs flicker gently (only while something is being drawn anyway)
    if (!this.leds || !this.group.visible) return;
    const t = c.T * 2;
    const col = this.col;
    for (let i = 0; i < this.ledPhase.length; i++) {
      const on = Math.sin(t + this.ledPhase[i]) > -0.6;
      this.leds.setColorAt(i, col.set(i % 7 === 3 ? 0xe0b050 : 0x2fd36f).multiplyScalar(on ? 1 : 0.25));
    }
    this.leds.instanceColor!.needsUpdate = true;
  }
}
