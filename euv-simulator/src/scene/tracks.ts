import * as THREE from 'three';
import { EXIT_X, ROUTE_Y, TOOLS, W0, WAFER_R, WAFER_TOOL_Y, v3 } from '../data/layout';
import { COLOR, darkSteel, dotTexture, edgeBox, emissiveSteel, glass, glowMat, hotplateTexture, rod, steel } from './gfx';
import { Registry } from './registry';
import { FrameCtx, SimModule } from './timing';
import { clamp, fract, hash, smoothstep } from './util';

const FLOOR_Y = -19.5;
const TOP_Y = -12.6;

function toolFrame(x: number, w: number, color: number) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(w + 1.0, 0.4, 5.4), darkSteel(0x232a38));
  base.position.set(x, FLOOR_Y - 0.2, 0);
  const back = new THREE.Mesh(new THREE.BoxGeometry(w, TOP_Y - FLOOR_Y, 0.16), darkSteel(0x1c2230));
  back.position.set(x, (TOP_Y + FLOOR_Y) / 2, -2.4);
  const faces = new THREE.Mesh(new THREE.BoxGeometry(w, TOP_Y - FLOOR_Y, 4.8), glass(color, 0.035));
  faces.position.set(x, (TOP_Y + FLOOR_Y) / 2, 0);
  faces.userData.nopick = true;
  const edges = edgeBox(w, TOP_Y - FLOOR_Y, 4.8, color, 0.5);
  edges.position.copy(faces.position);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, 0.1), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  strip.position.set(x, TOP_Y + 0.05, 2.4);
  strip.userData.nopick = true;
  g.add(base, back, faces, edges, strip);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, TOP_Y - FLOOR_Y, 0.16), steel(0x59647a, 0.4, 0.85));
    post.position.set(x + (sx * w) / 2, (TOP_Y + FLOOR_Y) / 2, 2.4);
    g.add(post);
  }
  return g;
}

export class TracksModule implements SimModule {
  group = new THREE.Group();
  private plateMat: THREE.MeshStandardMaterial;
  private lid: THREE.Group;
  private shimmer: THREE.Points;
  private arm: THREE.Group;
  private stream: THREE.Mesh;
  private puddle: THREE.Mesh;
  private splash: THREE.Points;
  private plasma: THREE.Mesh;
  private plasmaCore: THREE.Mesh;
  private ionRain: THREE.Points;
  private lights: THREE.Mesh[] = [];
  private tmpC = new THREE.Color();

  constructor(reg: Registry) {
    const g = this.group;

    // ───────── bake (hot plate) ─────────
    const bake = new THREE.Group();
    bake.add(toolFrame(TOOLS.bake.x, TOOLS.bake.w, COLOR.track));
    const bx = TOOLS.bake.x;
    this.plateMat = new THREE.MeshStandardMaterial({ map: hotplateTexture(), color: 0x6b5448, roughness: 0.5, metalness: 0.6, emissive: 0xff7a20, emissiveMap: hotplateTexture(), emissiveIntensity: 0 });
    this.plateMat.userData.noEmph = true;
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(2.15, 2.2, 0.34, 64), this.plateMat);
    plate.position.set(bx, -15.7, 0);
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.95, 3.6, 28), darkSteel(0x2b3446));
    pillar.position.set(bx, -17.7, 0);
    bake.add(plate, pillar);
    this.lid = new THREE.Group();
    const lidTop = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.12, 48), glass(0xffb878, 0.28));
    lidTop.position.y = 0.55;
    const lidRim = new THREE.Mesh(new THREE.CylinderGeometry(2.45, 2.45, 0.6, 48, 1, true), glass(0xffb878, 0.2));
    lidRim.position.y = 0.25;
    const lidRing = new THREE.Mesh(new THREE.TorusGeometry(2.45, 0.07, 10, 56).rotateX(Math.PI / 2), steel(0xa6b2c8, 0.3, 0.95));
    lidRing.position.y = -0.05;
    const lidHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 16), steel(0x8d99b0, 0.3, 0.95));
    lidHandle.position.y = 0.9;
    this.lid.add(lidTop, lidRim, lidRing, lidHandle);
    this.lid.position.set(bx, -12.9, 0);
    bake.add(this.lid);
    // heat shimmer
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(46 * 3), 3));
    sg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(46 * 3), 3));
    this.shimmer = new THREE.Points(sg, new THREE.PointsMaterial({ map: dotTexture(), size: 0.3, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.shimmer.frustumCulled = false;
    this.shimmer.raycast = () => {};
    bake.add(this.shimmer);
    g.add(bake);
    reg.register('bakePlate', bake, { priority: 1 });

    // ───────── develop (spin cup + dispense arm) ─────────
    const dev = new THREE.Group();
    const dx = TOOLS.develop.x;
    dev.add(toolFrame(dx, TOOLS.develop.w, COLOR.track));
    const cupProfile = [new THREE.Vector2(2.0, -17.6), new THREE.Vector2(2.25, -16.8), new THREE.Vector2(2.7, -15.9), new THREE.Vector2(2.9, -15.3)];
    const cup = new THREE.Mesh(new THREE.LatheGeometry(cupProfile, 56), new THREE.MeshPhysicalMaterial({ color: 0x9fb8e8, transparent: true, opacity: 0.2, roughness: 0.1, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false }));
    const cupRim = new THREE.Mesh(new THREE.TorusGeometry(2.9, 0.07, 10, 64).rotateX(Math.PI / 2), steel(0xa6b2c8, 0.3, 0.95));
    cupRim.position.y = -15.3;
    const cupBase = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 0.12, 48), darkSteel(0x2b3446));
    cupBase.position.y = -17.66;
    const chuck = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.3, 36), steel(0x7e8aa2, 0.3, 0.95));
    chuck.position.set(dx, -15.7, 0);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 3.6, 20), darkSteel(0x2b3446));
    shaft.position.set(dx, -17.6, 0);
    cup.position.x = dx;
    cupRim.position.x = dx;
    cupBase.position.x = dx;
    dev.add(cup, cupRim, cupBase, chuck, shaft);
    this.arm = new THREE.Group();
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 4.6, 14).rotateZ(Math.PI / 2), steel(0xaab5ca, 0.3, 0.95));
    boom.position.set(2.3, 0, 0);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.06, 0.55, 14), steel(0xd0d8e8, 0.2, 1));
    nozzle.position.set(0, -0.3, 0);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 3.4, 14), darkSteel(0x2b3446));
    column.position.set(4.6, -1.7, 0);
    this.arm.add(boom, nozzle, column);
    this.arm.position.set(dx, -13.7, 0);
    dev.add(this.arm);
    this.stream = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.04, 1, 10), glowMat(0x59e0d4, 0));
    this.stream.userData.nopick = true;
    dev.add(this.stream);
    this.puddle = new THREE.Mesh(new THREE.CylinderGeometry(WAFER_R * 0.97, WAFER_R * 0.97, 0.06, 56), glowMat(0x59e0d4, 0));
    this.puddle.position.set(dx, WAFER_TOOL_Y + 0.07, 0);
    this.puddle.userData.nopick = true;
    dev.add(this.puddle);
    const spg = new THREE.BufferGeometry();
    spg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(70 * 3), 3));
    spg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(70 * 3), 3));
    this.splash = new THREE.Points(spg, new THREE.PointsMaterial({ map: dotTexture(), size: 0.16, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.splash.frustumCulled = false;
    this.splash.raycast = () => {};
    dev.add(this.splash);
    g.add(dev);
    reg.register('developer', dev, { priority: 1 });

    // ───────── etch chamber ─────────
    const etch = new THREE.Group();
    const ex = TOOLS.etch.x;
    etch.add(toolFrame(ex, TOOLS.etch.w, COLOR.etch));
    const wallGeo = new THREE.CylinderGeometry(2.8, 2.8, 5.2, 56, 1, true);
    const wall = new THREE.Mesh(wallGeo, glass(0x9fe8b0, 0.09));
    wall.position.set(ex, -16.2, 0);
    const lidE = new THREE.Mesh(new THREE.CylinderGeometry(2.95, 2.95, 0.4, 56), steel(0x7e8aa2, 0.35, 0.9));
    lidE.position.set(ex, -13.5, 0);
    const botE = new THREE.Mesh(new THREE.CylinderGeometry(2.95, 2.95, 0.4, 56), steel(0x5c6880, 0.4, 0.9));
    botE.position.set(ex, -18.9, 0);
    const shower = new THREE.Mesh(new THREE.CylinderGeometry(1.95, 1.95, 0.25, 48), steel(0xaab5ca, 0.3, 0.95));
    shower.position.set(ex, -14.2, 0);
    const lower = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 0.3, 48), steel(0x8b97ad, 0.3, 0.95));
    lower.position.set(ex, -15.68, 0);
    const gas = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 1.2, 16), steel(0x6c7890, 0.4, 0.9));
    gas.position.set(ex, -12.9, 0);
    const pump = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.3, 20), darkSteel(0x2b3446));
    pump.position.set(ex, -19.6, 0);
    const rf = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.6, 1.8), darkSteel(0x2a3242));
    rf.position.set(ex + 3.3, -14.4, 0);
    const rfLight = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.06), emissiveSteel(0x1b3a28, COLOR.etch, 0.4, 0.4, 0.3));
    rfLight.position.set(ex + 3.3, -14.1, 0.92);
    this.lights.push(rfLight);
    const rfLead = rod(v3(ex + 2.6, -14.4, 0), v3(ex + 0.4, -13.55, 0), 0.05, steel(0xe0b050, 0.3, 0.9), 8);
    etch.add(wall, lidE, botE, shower, lower, gas, pump, rf, rfLight, rfLead);
    this.plasma = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 1.35, 40, 1, true), glowMat(0x7bd88f, 0));
    (this.plasma.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
    this.plasma.position.set(ex, -14.95, 0);
    this.plasma.userData.nopick = true;
    this.plasmaCore = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 1.2, 36), glowMat(0xc8ffd0, 0));
    this.plasmaCore.position.set(ex, -14.95, 0);
    this.plasmaCore.userData.nopick = true;
    etch.add(this.plasma, this.plasmaCore);
    const ig = new THREE.BufferGeometry();
    ig.setAttribute('position', new THREE.BufferAttribute(new Float32Array(90 * 3), 3));
    ig.setAttribute('color', new THREE.BufferAttribute(new Float32Array(90 * 3), 3));
    this.ionRain = new THREE.Points(ig, new THREE.PointsMaterial({ map: dotTexture(), size: 0.14, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.ionRain.frustumCulled = false;
    this.ionRain.raycast = () => {};
    etch.add(this.ionRain);
    g.add(etch);
    reg.register('etcher', etch, { priority: 1 });

    // ───────── wafer transfer route (rails on the back wall) ─────────
    const route = new THREE.Group();
    const rm = new THREE.MeshBasicMaterial({ color: 0xe0b050, transparent: true, opacity: 0.38, toneMapped: false });
    const pts = [v3(W0.x + 2.0, W0.y, -1.2), v3(EXIT_X, W0.y, -1.2), v3(EXIT_X, ROUTE_Y, -1.2), v3(TOOLS.etch.x, ROUTE_Y, -1.2)];
    for (let i = 0; i < pts.length - 1; i++) {
      const r = rod(pts[i], pts[i + 1], 0.05, rm, 6);
      r.userData.nopick = true;
      route.add(r);
    }
    for (const t of [TOOLS.bake.x, TOOLS.develop.x, TOOLS.etch.x]) {
      const r = rod(v3(t, ROUTE_Y, -1.2), v3(t, WAFER_TOOL_Y, -1.2), 0.05, rm, 6);
      r.userData.nopick = true;
      route.add(r);
    }
    g.add(route);
  }

  update(c: FrameCtx) {
    const T = c.T;
    const st = c.stage;
    const p = c.p;
    // ── bake plate heat + lid ──
    const heat = st === 8 ? smoothstep(0.3, 0.5, p) * (1 - smoothstep(0.94, 1, p)) : 0;
    this.plateMat.emissiveIntensity = 0.1 + 1.1 * heat;
    const close = st === 8 ? smoothstep(0.33, 0.45, p) * (1 - smoothstep(0.88, 0.97, p)) : 0;
    this.lid.position.y = -12.9 + (-15.0 + 12.9) * close;
    const sp = this.shimmer.geometry.attributes.position as THREE.BufferAttribute;
    const sc = this.shimmer.geometry.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < sp.count; i++) {
      const u = fract(T * 0.35 + hash(i * 1.7));
      const a = hash(i * 2.9) * Math.PI * 2;
      const r = 1.9 * Math.sqrt(hash(i * 4.1));
      const lidY = this.lid.position.y;
      const y = -15.4 + u * (Math.min(-13.4, lidY - 0.2) + 15.4);
      sp.setXYZ(i, TOOLS.bake.x + Math.cos(a) * r + Math.sin(T * 2 + i) * 0.05, y, Math.sin(a) * r);
      const f = Math.sin(Math.PI * u) * heat;
      sc.setXYZ(i, 1.0 * f, 0.55 * f, 0.2 * f);
    }
    sp.needsUpdate = sc.needsUpdate = true;

    // ── developer ──
    const armAmt = st === 9 ? smoothstep(0.24, 0.34, p) * (1 - smoothstep(0.86, 0.95, p)) : 0;
    this.arm.position.x = TOOLS.develop.x + 3.4 * (1 - armAmt);
    const disp = st === 9 ? smoothstep(0.3, 0.34, p) * (1 - smoothstep(0.74, 0.78, p)) : 0;
    const rinse = st === 9 ? smoothstep(0.78, 0.82, p) * (1 - smoothstep(0.9, 0.94, p)) : 0;
    const flow = Math.max(disp, rinse);
    const nozzleY = -13.7 - 0.55;
    const top = WAFER_TOOL_Y + 0.05;
    this.stream.scale.set(1, nozzleY - top, 1);
    this.stream.position.set(TOOLS.develop.x + 3.4 * (1 - armAmt), (nozzleY + top) / 2, 0);
    (this.stream.material as THREE.MeshBasicMaterial).opacity = flow * (0.55 + 0.25 * Math.sin(T * 30));
    (this.stream.material as THREE.MeshBasicMaterial).color.setHex(rinse > disp ? 0xbfe0ff : 0x59e0d4);
    this.stream.visible = flow > 0.02;
    (this.puddle.material as THREE.MeshBasicMaterial).opacity = st === 9 ? 0.2 * smoothstep(0.3, 0.4, p) * (1 - smoothstep(0.88, 0.96, p)) : 0;
    this.puddle.visible = (this.puddle.material as THREE.MeshBasicMaterial).opacity > 0.004;
    const dp = this.splash.geometry.attributes.position as THREE.BufferAttribute;
    const dc = this.splash.geometry.attributes.color as THREE.BufferAttribute;
    const spin = st === 9 ? smoothstep(0.76, 0.84, p) * (1 - smoothstep(0.95, 1, p)) : 0;
    for (let i = 0; i < dp.count; i++) {
      const u = fract(T * 0.9 + hash(i * 2.3));
      const a = hash(i * 6.7) * Math.PI * 2;
      const r = WAFER_R + u * 1.0;
      dp.setXYZ(i, TOOLS.develop.x + Math.cos(a) * r, WAFER_TOOL_Y + 0.1 - u * 0.5, Math.sin(a) * r);
      const f = (1 - u) * spin * 0.9;
      dc.setXYZ(i, 0.5 * f, 0.9 * f, 1.0 * f);
    }
    dp.needsUpdate = dc.needsUpdate = true;

    // ── etch plasma ──
    const on = st === 10 ? smoothstep(0.3, 0.38, p) * (1 - smoothstep(0.88, 0.95, p)) : 0;
    const strip = st === 10 ? smoothstep(0.86, 0.93, p) : 0;
    const flick = 0.75 + 0.25 * Math.sin(T * 17) * Math.sin(T * 5.3);
    (this.plasma.material as THREE.MeshBasicMaterial).opacity = 0.2 * on * flick;
    (this.plasmaCore.material as THREE.MeshBasicMaterial).opacity = 0.07 * on * flick;
    this.tmpC.setHex(0x7bd88f).lerp(new THREE.Color(0xff9b6a), strip);
    (this.plasma.material as THREE.MeshBasicMaterial).color.copy(this.tmpC);
    (this.plasmaCore.material as THREE.MeshBasicMaterial).color.copy(this.tmpC).lerp(new THREE.Color(0xffffff), 0.6);
    this.plasma.visible = this.plasmaCore.visible = on > 0.01;
    const ip = this.ionRain.geometry.attributes.position as THREE.BufferAttribute;
    const ic = this.ionRain.geometry.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < ip.count; i++) {
      const u = fract(T * 1.3 + hash(i * 1.9));
      const a = hash(i * 5.1) * Math.PI * 2;
      const r = 1.7 * Math.sqrt(hash(i * 3.3));
      ip.setXYZ(i, TOOLS.etch.x + Math.cos(a) * r, -14.3 - u * 1.25, Math.sin(a) * r);
      const f = on * 0.9 * Math.sin(Math.PI * Math.min(1, u * 1.1));
      ic.setXYZ(i, 0.35 * f, 1.3 * f, 0.55 * f);
    }
    ip.needsUpdate = ic.needsUpdate = true;
    for (const l of this.lights) (l.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + 1.2 * on;
  }
}
