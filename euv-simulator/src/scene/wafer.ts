import * as THREE from 'three';
import { N_IDX, S_AT, S_TOTAL, W0, WAFER_R, v3 } from '../data/layout';
import { COLOR, circuitCanvasDraw, darkSteel, edgeBox, glowMat, glowSprite, steel } from './gfx';
import { Registry } from './registry';
import { FrameCtx, SimModule, airAtt, scanState } from './timing';
import { waferPose } from './transport';
import { clamp, smoothstep } from './util';

const FIELD = 0.625; // 26 × 33 mm field ≈ 0.625 scene units here (¼ of the 2.5-unit mask pattern)

function waferTopTexture() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(S / 2, S / 2, 20, S / 2, S / 2, S / 2);
  gr.addColorStop(0, '#6f7fa8');
  gr.addColorStop(0.75, '#52618a');
  gr.addColorStop(1, '#3f4b6e');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  // die grid: one cell equals the exposure field so the central cell is the field that is being scanned
  const cell = (S * FIELD) / (2 * WAFER_R);
  g.strokeStyle = 'rgba(190,205,245,0.3)';
  g.lineWidth = 1.2;
  for (let k = -8; k <= 8; k++) {
    const p = S / 2 + (k - 0.5) * cell;
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, S);
    g.stroke();
    g.beginPath();
    g.moveTo(0, p);
    g.lineTo(S, p);
    g.stroke();
  }
  g.fillStyle = '#161c2e';
  g.beginPath();
  g.arc(S / 2, S - 4, 9, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function fieldTexture() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  circuitCanvasDraw(g, S, '#7fe7ff', '#0a1220', true);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class WaferModule implements SimModule {
  group = new THREE.Group();
  private root = new THREE.Group(); // moves with transport
  private spin = new THREE.Group();
  private field: THREE.Mesh;
  private fieldMat: THREE.MeshBasicMaterial;
  private clip = { value: -9 };
  private carrier: THREE.Mesh;
  private next: THREE.Group;
  private cone: THREE.Mesh;
  private coneRing: THREE.Mesh;
  private spot: THREE.Sprite;
  private slitLine: THREE.Mesh;
  private pose = waferPose(0);
  private tint = new THREE.Color();

  constructor(reg: Registry) {
    const g = this.group;
    // ── wafer stage hardware (stays in the scanner) ──
    const hw = new THREE.Group();
    const block = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.7, 3.8), darkSteel(0x273043));
    block.position.set(W0.x, W0.y - 0.6, 0);
    const chuck = new THREE.Mesh(new THREE.CylinderGeometry(WAFER_R + 0.2, WAFER_R + 0.25, 0.12, 64), steel(0x7e8aa2, 0.3, 0.95));
    chuck.position.set(W0.x, W0.y - 0.095, 0);
    const base = new THREE.Mesh(new THREE.BoxGeometry(12.5, 0.3, 4.6), darkSteel(0x1d2330));
    base.position.set(W0.x - 0.8, W0.y - 1.25, 0);
    hw.add(block, chuck, base);
    for (const z of [-1.5, 1.5]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 11.4, 14).rotateZ(Math.PI / 2), steel(0xaab5ca, 0.25, 1));
      rail.position.set(W0.x - 0.8, W0.y - 1.0, z);
      hw.add(rail);
    }
    const metro = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 1.2), steel(0x59647a, 0.4, 0.85));
    metro.position.set(W0.x + 2.9, W0.y - 0.45, 0);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: COLOR.laser, toneMapped: false }));
    dot.position.set(W0.x + 3.17, W0.y - 0.45, 0);
    dot.userData.nopick = true;
    hw.add(metro, dot);
    g.add(hw);

    // ── next wafer waiting on the chuck once the first one has left ──
    this.next = new THREE.Group();
    const nd = new THREE.Mesh(new THREE.CylinderGeometry(WAFER_R, WAFER_R, 0.07, 64), [steel(0x8b97ad, 0.3, 0.9), new THREE.MeshStandardMaterial({ map: waferTopTexture(), metalness: 0.7, roughness: 0.3 }), steel(0x2a3142)]);
    this.next.add(nd);
    this.next.position.copy(W0);
    g.add(this.next);

    // ── the wafer being processed ──
    const topTex = waferTopTexture();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(WAFER_R, WAFER_R, 0.07, 72), [steel(0x8b97ad, 0.3, 0.9), new THREE.MeshStandardMaterial({ map: topTex, metalness: 0.7, roughness: 0.28, envMapIntensity: 1.2 }), steel(0x2a3142)]);
    // thin resist film tint
    const film = new THREE.Mesh(new THREE.CircleGeometry(WAFER_R * 0.995, 72).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: COLOR.resist, transparent: true, opacity: 0.16, depthWrite: false, toneMapped: false }));
    film.position.y = 0.037;
    film.userData.nopick = true;
    this.fieldMat = new THREE.MeshBasicMaterial({ map: fieldTexture(), transparent: true, opacity: 1, toneMapped: false, depthWrite: false, side: THREE.DoubleSide });
    this.fieldMat.onBeforeCompile = (sh) => {
      sh.uniforms.uClip = this.clip;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vLz;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLz = position.z;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vLz;\nuniform float uClip;').replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vLz < uClip) discard;');
    };
    this.field = new THREE.Mesh(new THREE.PlaneGeometry(FIELD, FIELD).rotateX(-Math.PI / 2), this.fieldMat);
    this.field.position.y = 0.05;
    this.field.userData.nopick = true;
    this.slitLine = new THREE.Mesh(new THREE.PlaneGeometry(FIELD * 1.15, 0.045).rotateX(-Math.PI / 2), glowMat(0xbff4ff, 0));
    this.slitLine.position.y = 0.055;
    this.slitLine.userData.nopick = true;
    this.spin.add(disc, film, this.field);
    this.root.add(this.spin, this.slitLine);
    // wafer carrier blade used while the wafer travels between tools
    this.carrier = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 2.2), steel(0xe0b050, 0.35, 0.9));
    this.carrier.position.y = -0.07;
    this.root.add(this.carrier);
    g.add(this.root);

    // numerical-aperture cone: light converges onto the wafer from all directions within the cone
    const h = 1.7;
    const half = Math.asin(0.33);
    const cg = new THREE.ConeGeometry(Math.tan(half) * h, h, 48, 1, true);
    cg.rotateX(Math.PI);
    cg.translate(0, h / 2, 0);
    this.cone = new THREE.Mesh(cg, glowMat(COLOR.euv, 0.1));
    (this.cone.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
    this.cone.position.set(W0.x, W0.y + 0.04, 0);
    this.cone.userData.nopick = true;
    this.coneRing = new THREE.Mesh(new THREE.TorusGeometry(Math.tan(half) * h, 0.012, 6, 64).rotateX(Math.PI / 2), glowMat(COLOR.euv, 0.7));
    this.coneRing.position.set(W0.x, W0.y + 0.04 + h, 0);
    this.coneRing.userData.nopick = true;
    this.spot = glowSprite(0xbff4ff, 1.1, 0);
    this.spot.position.set(W0.x, W0.y + 0.07, 0);
    g.add(this.cone, this.coneRing, this.spot);

    const bounds = () => {
      const p = this.root.position;
      return new THREE.Box3(v3(p.x - WAFER_R - 0.2, p.y - 1.0, -2.2), v3(p.x + WAFER_R + 0.2, p.y + 0.5, 2.2));
    };
    reg.register('wafer', g, { priority: 1, bounds });
  }

  update(c: FrameCtx) {
    const T = c.T;
    const pose = waferPose(T, this.pose);
    this.root.position.copy(pose.pos);
    const atScanner = pose.at === 'scanner';
    const lightOn = smoothstep(S_TOTAL - 7, S_TOTAL, c.reach) * (c.showPath ? 1 : 0) * airAtt(c.atmosphere, 60);
    const sc = scanState(T);
    const dim = c.stage >= 8 ? 0.4 : 1;

    // scanning motion of the wafer stage (opposite to the reticle, ¼ of the distance)
    const scanAmt = atScanner ? smoothstep(S_TOTAL - 7, S_TOTAL, c.reach) : 0;
    this.root.position.z = atScanner ? -sc.zField * scanAmt : 0;

    // exposure field: revealed by the scanning slit, then stays visible once the wafer leaves
    const processed = c.stage >= 8 || !atScanner;
    const fieldAmt = processed ? 1 : smoothstep(S_TOTAL - 4, S_TOTAL, c.reach);
    this.field.visible = fieldAmt > 0.01;
    this.clip.value = processed ? -9 : sc.zField;
    this.fieldMat.opacity = fieldAmt * (processed ? 1 : sc.fade);
    const target = c.stage >= 10 ? 0x9be8a8 : c.stage === 9 ? 0xe9f4ff : c.stage === 8 ? 0xffc27a : 0xffffff;
    this.fieldMat.color.lerp(this.tint.setHex(target), 0.12);
    const slitOn = atScanner && !processed ? lightOn * (sc.slit < 0.999 ? 1 : 0) : 0;
    (this.slitLine.material as THREE.MeshBasicMaterial).opacity = slitOn * 0.95;
    this.slitLine.visible = slitOn > 0.02;
    this.slitLine.position.z = sc.zField;

    // spin during development
    const dev = pose.at === 'develop' && c.stage === 9 ? Math.max(0, (c.p - 0.3) / 0.7) : 0;
    this.spin.rotation.y = pose.at === 'develop' ? T * (dev > 0.55 ? 14 : 6) * (dev > 0 ? 1 : 0) : 0;

    // blade only while moving
    this.carrier.visible = pose.at === 'transit';

    // next wafer waits on the stage once the processed one is gone
    const away = pose.at !== 'scanner';
    this.next.visible = away;
    this.next.scale.setScalar(away ? smoothstep(0, 1.6, pose.sinceArrival + (pose.at === 'transit' ? 3 * pose.u : 1.6)) : 0.001);

    // NA cone and spot at the focus on the chuck
    const coneOn = atScanner && !processed ? lightOn : 0;
    (this.cone.material as THREE.MeshBasicMaterial).opacity = 0.12 * coneOn * dim;
    this.cone.visible = this.coneRing.visible = coneOn > 0.02;
    (this.coneRing.material as THREE.MeshBasicMaterial).opacity = 0.7 * coneOn;
    const beat = 0.55 + 0.45 * Math.sin(T * 9) ** 2;
    (this.spot.material as THREE.SpriteMaterial).opacity = coneOn * beat;
    this.spot.visible = coneOn > 0.02;
    this.spot.position.z = 0;
  }
}
