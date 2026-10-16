import * as THREE from 'three';
import { COLLECTOR, ELL, F1, IF, PRE_DELAY, SRC, collectorPoint, collectorR, v3 } from '../data/layout';
import { COLOR, SegPool, beamFrustum, darkSteel, dotTexture, emissiveSteel, glass, glowMat, glowSprite, ringTexture, rod, steel } from './gfx';
import { Registry } from './registry';
import { FrameCtx, SimModule, airAtt, lastMainTime, lastPreTime, mainOnAt, plasmaEnv, preOnAt, tMain, tPre } from './timing';
import { clamp, easeOut, fract, hash, lerp } from './util';

const N_RAYS = 26;
const N_LOST = 18;
const V = SRC.vessel;
const RED = new THREE.Color(COLOR.laser);
const CYAN = new THREE.Color(COLOR.euv);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

function polyLen(pts: THREE.Vector3[]) {
  let l = 0;
  for (let i = 0; i < pts.length - 1; i++) l += pts[i].distanceTo(pts[i + 1]);
  return l;
}
function polyAt(pts: THREE.Vector3[], d: number, out: THREE.Vector3) {
  let rest = Math.max(d, 0);
  for (let i = 0; i < pts.length - 1; i++) {
    const l = pts[i].distanceTo(pts[i + 1]);
    if (rest <= l || i === pts.length - 2) return out.copy(pts[i]).lerp(pts[i + 1], clamp(rest / l));
    rest -= l;
  }
  return out.copy(pts[pts.length - 1]);
}

export class SourceModule implements SimModule {
  group = new THREE.Group();

  private droplets: THREE.InstancedMesh;
  private pool = new SegPool(420, 6);
  private plasmaGroup = new THREE.Group();
  private core: THREE.Mesh;
  private shell: THREE.Mesh;
  private halo: THREE.Sprite;
  private halo2: THREE.Sprite;
  private ring: THREE.Sprite;
  private preFlash: THREE.Sprite;
  private plasmaLight: THREE.PointLight;
  private turb: THREE.Mesh[] = [];
  private mainCone: THREE.Mesh;
  private preCone: THREE.Mesh;
  private laserLights: THREE.Mesh[] = [];
  private indicator: THREE.Mesh;
  private heater: THREE.Mesh[] = [];

  private rayP: THREE.Vector3[] = [];
  private rayR: number[] = [];
  private lostDir: THREE.Vector3[] = [];
  private lostLen: number[] = [];
  private sparks: THREE.Points;
  private sparkCol: Float32Array;
  private debris: THREE.Points;
  private debrisCol: Float32Array;
  private debrisDir: THREE.Vector3[] = [];
  private h2: THREE.Points;
  private airV: THREE.Points;
  private airS: THREE.Points;
  private airVBase: Float32Array;
  private airSBase: Float32Array;
  private mainPath = [SRC.laserOut, SRC.hole, F1];
  private prePath = [SRC.laserOut, SRC.hole, SRC.prePt];
  private mainLen = polyLen(this.mainPath);
  private preLen = polyLen(this.prePath);
  private tmpColor = new THREE.Color();
  private matrix = new THREE.Matrix4();
  private dropCol = new THREE.Color();

  constructor(reg: Registry) {
    const g = this.group;
    const midX = (V.x0 + V.x1) / 2;
    const vlen = V.x1 - V.x0;

    // ── vacuum vessel ──
    const vessel = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(V.r, V.r, vlen, 72, 1, true), glass(0x78a8ff, 0.07));
    shell.rotation.z = Math.PI / 2;
    shell.position.set(midX, V.cy, 0);
    vessel.add(shell);
    const flangeMat = steel(0x7f8aa0, 0.35, 0.9);
    for (const x of [V.x0, V.x1]) {
      const f = new THREE.Mesh(new THREE.TorusGeometry(V.r, 0.09, 14, 96), flangeMat);
      f.rotation.y = Math.PI / 2;
      f.position.set(x, V.cy, 0);
      vessel.add(f);
    }
    for (const t of [0.34, 0.67]) {
      const f = new THREE.Mesh(new THREE.TorusGeometry(V.r + 0.01, 0.028, 10, 96), flangeMat);
      f.rotation.y = Math.PI / 2;
      f.position.set(V.x0 + vlen * t, V.cy, 0);
      vessel.add(f);
    }
    // end plates
    const capL = new THREE.Mesh(new THREE.RingGeometry(V.r - 0.22, V.r, 64), steel(0x4a5468, 0.5, 0.85));
    capL.rotation.y = Math.PI / 2;
    capL.position.set(V.x0, V.cy, 0);
    capL.material.side = THREE.DoubleSide;
    vessel.add(capL);
    const capR = new THREE.Mesh(new THREE.RingGeometry(V.r - 0.22, V.r, 64), steel(0x4a5468, 0.5, 0.85));
    capR.rotation.y = Math.PI / 2;
    capR.position.set(V.x1, V.cy, 0);
    capR.material.side = THREE.DoubleSide;
    vessel.add(capR);
    const portL = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.95, 40), steel(0x6c7890, 0.4, 0.9));
    portL.material.side = THREE.DoubleSide;
    portL.rotation.y = Math.PI / 2;
    portL.position.set(V.x0 + 0.01, V.cy, 0);
    vessel.add(portL);
    const windowL = new THREE.Mesh(new THREE.CircleGeometry(0.5, 32), glass(0xffb070, 0.35));
    windowL.rotation.y = Math.PI / 2;
    windowL.position.set(V.x0 + 0.02, V.cy, 0);
    vessel.add(windowL);
    // exit snout towards the illuminator
    const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.9, 1.0, 32, 1, true), steel(0x6c7890, 0.4, 0.9));
    snout.material.side = THREE.DoubleSide;
    snout.rotation.z = -Math.PI / 2;
    snout.position.set(V.x1 + 0.5, V.cy, 0);
    vessel.add(snout);
    // support frame
    const baseMat = darkSteel(0x232a38);
    const base = new THREE.Mesh(new THREE.BoxGeometry(12.4, 0.34, 5.2), baseMat);
    base.position.set(midX, -3.35, 0);
    vessel.add(base);
    for (const x of [-10.6, -2.0]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 2.45, 16), baseMat);
      leg.position.set(x, -2.0, 0);
      vessel.add(leg);
      const cradle = new THREE.Mesh(new THREE.TorusGeometry(V.r + 0.02, 0.12, 8, 40, Math.PI * 0.5), flangeMat);
      cradle.rotation.set(0, Math.PI / 2, Math.PI * 1.25);
      cradle.position.set(x, V.cy, 0);
      vessel.add(cradle);
    }
    // IF aperture plate
    const ifPlate = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.75, 40), steel(0xb7c3d8, 0.25, 1));
    ifPlate.material.side = THREE.DoubleSide;
    ifPlate.rotation.y = Math.PI / 2;
    ifPlate.position.set(IF.x + 0.05, IF.y, 0);
    const ifGroup = new THREE.Group();
    ifGroup.add(ifPlate);
    const ifProxy = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    ifProxy.position.copy(IF);
    ifGroup.add(ifProxy);
    g.add(vessel, ifGroup);
    reg.register('intermediateFocus', ifGroup, { priority: 2.5, bounds: () => new THREE.Box3(v3(IF.x - 0.8, IF.y - 0.9, -0.9), v3(IF.x + 0.8, IF.y + 0.9, 0.9)) });
    reg.register('vacuum', vessel, { priority: 0, bounds: () => new THREE.Box3(v3(V.x0 - 0.3, -3.6, -4.2), v3(V.x1 + 1.2, V.cy + V.r + 0.3, 4.2)) });

    // ── collector (ellipsoidal mirror) ──
    const collector = new THREE.Group();
    const prof: THREE.Vector2[] = [];
    const back: THREE.Vector2[] = [];
    const NP = 48;
    for (let i = 0; i <= NP; i++) {
      const th = THREE.MathUtils.lerp(COLLECTOR.thetaHole, COLLECTOR.thetaMax, i / NP);
      const r = collectorR(th);
      const x = F1.x - r * Math.cos(th);
      const rho = r * Math.sin(th);
      prof.push(new THREE.Vector2(rho, x));
      back.push(new THREE.Vector2(rho, x - 0.3));
    }
    const mirrorMat = new THREE.MeshPhysicalMaterial({
      color: 0xc9d6ee,
      metalness: 1,
      roughness: 0.1,
      iridescence: 0.9,
      iridescenceIOR: 1.8,
      iridescenceThicknessRange: [160, 420],
      side: THREE.DoubleSide,
      envMapIntensity: 1.5,
    });
    const dish = new THREE.Mesh(new THREE.LatheGeometry(prof, 96), mirrorMat);
    dish.rotation.z = -Math.PI / 2;
    dish.position.set(0, F1.y, 0);
    const dishBack = new THREE.Mesh(new THREE.LatheGeometry(back, 64), darkSteel(0x2f3747, 0.5, 0.8));
    dishBack.rotation.z = -Math.PI / 2;
    dishBack.position.set(0, F1.y, 0);
    dishBack.material.side = THREE.DoubleSide;
    const rimR = prof[NP].x;
    const rimX = prof[NP].y;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(rimR, 0.1, 12, 96), steel(0x8794ad, 0.3, 0.95));
    rim.rotation.y = Math.PI / 2;
    rim.position.set(rimX, F1.y, 0);
    const hubTube = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 2.2, 28, 1, true), darkSteel(0x1d2330));
    hubTube.material.side = THREE.DoubleSide;
    hubTube.rotation.z = Math.PI / 2;
    hubTube.position.set(COLLECTOR.vertexX - 1.2, F1.y, 0);
    collector.add(dish, dishBack, rim, hubTube);
    for (let a = 0; a < 4; a++) {
      const ang = Math.PI / 4 + (a * Math.PI) / 2;
      collector.add(
        rod(v3(rimX - 0.1, F1.y + rimR * Math.cos(ang), rimR * Math.sin(ang)), v3(rimX - 0.1, F1.y + (V.r - 0.05) * Math.cos(ang), (V.r - 0.05) * Math.sin(ang)), 0.06, steel(0x6a758c, 0.4, 0.9), 8),
      );
    }
    g.add(collector);
    reg.register('collector', collector, { priority: 1 });

    // ── droplet generator ──
    const gen = new THREE.Group();
    gen.position.set(F1.x, 0, 0);
    const housingMat = darkSteel(0x2b3445, 0.4, 0.85);
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.72, 2.0, 32), housingMat);
    housing.position.y = 9.15;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.58, 0.5, 32), steel(0x8a97ad, 0.35, 0.9));
    cap.position.y = 10.4;
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.14, 40), steel(0x7f8aa0, 0.35, 0.9));
    flange.position.y = V.cy + V.r + 0.05;
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.05, 1.45, 28), steel(0xbac5d8, 0.22, 1));
    nozzle.position.y = SRC.nozzleY + 0.72;
    const piezo = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.1, 12, 40), emissiveSteel(0x2c4fa8, 0x3d6dff, 0.5, 0.4, 0.5));
    piezo.rotation.x = Math.PI / 2;
    piezo.position.y = 8.2;
    gen.add(housing, cap, flange, nozzle, piezo);
    for (let i = 0; i < 6; i++) {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.045, 10, 40), emissiveSteel(0x5a2a0c, 0xff8a2a, 0.9, 0.5, 0.4));
      coil.rotation.x = Math.PI / 2;
      coil.position.y = 8.55 + i * 0.28;
      this.heater.push(coil);
      gen.add(coil);
    }
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.9, 0.08), emissiveSteel(0x7a4a1c, 0xffa040, 1.1, 0.3, 0.2));
    sight.position.set(0, 9.2, 0.66);
    this.heater.push(sight);
    gen.add(sight);
    g.add(gen);
    reg.register('dropletGenerator', gen, { priority: 2 });

    // ── tin catcher ──
    const catcher = new THREE.Group();
    catcher.position.set(F1.x, 0, 0);
    const cprof = [new THREE.Vector2(0.7, SRC.catcherY), new THREE.Vector2(0.58, SRC.catcherY - 0.3), new THREE.Vector2(0.3, SRC.catcherY - 0.95), new THREE.Vector2(0.22, SRC.catcherY - 1.25), new THREE.Vector2(0.22, SRC.catcherY - 2.0)];
    const funnel = new THREE.Mesh(new THREE.LatheGeometry(cprof, 40), steel(0x8c97ab, 0.35, 0.9));
    funnel.material.side = THREE.DoubleSide;
    const bin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.95, 1.5), darkSteel(0x2a3242));
    bin.position.y = SRC.catcherY - 2.45;
    const pool = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.04, 24), steel(0xdfe5ef, 0.12, 1));
    pool.position.y = SRC.catcherY - 1.98;
    catcher.add(funnel, bin, pool);
    g.add(catcher);
    reg.register('catcher', catcher, { priority: 2 });

    // ── CO2 laser (drive laser) ──
    const lb = SRC.laserBox;
    const laser = new THREE.Group();
    const lw = lb.x1 - lb.x0;
    const lh = lb.y1 - lb.y0;
    const body = new THREE.Mesh(new THREE.BoxGeometry(lw, lh, lb.hz * 2), darkSteel(0x252c3a, 0.5, 0.8));
    body.position.set((lb.x0 + lb.x1) / 2, (lb.y0 + lb.y1) / 2, 0);
    laser.add(body);
    for (let i = 0; i < 3; i++) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(lw - 0.8, 0.09, 0.06), emissiveSteel(0x3a1114, COLOR.laser, 0.5, 0.4, 0.3));
      strip.position.set((lb.x0 + lb.x1) / 2, lb.y0 + 0.55 + i * 0.7, lb.hz + 0.02);
      this.laserLights.push(strip);
      laser.add(strip);
    }
    for (let i = 0; i < 12; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, lb.hz * 2 - 0.4), steel(0x59647a, 0.45, 0.8));
      fin.position.set(lb.x0 + 0.6 + i * ((lw - 1.2) / 11), lb.y1 + 0.17, 0);
      laser.add(fin);
    }
    const ap = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.1, 12, 36), steel(0xaab5ca, 0.25, 1));
    ap.rotation.y = Math.PI / 2;
    ap.position.set(lb.x1 + 0.02, F1.y, 0);
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, V.x0 - lb.x1 + 0.1, 24), steel(0x7f8aa0, 0.35, 0.9));
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set((lb.x1 + V.x0) / 2, F1.y, 0);
    this.indicator = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), new THREE.MeshBasicMaterial({ color: 0x35d07f, toneMapped: false }));
    this.indicator.position.set(lb.x0 + 0.6, lb.y1 - 0.35, lb.hz + 0.1);
    this.indicator.userData.nopick = true;
    laser.add(ap, pipe, this.indicator);
    // rails/supports
    const foot = new THREE.Mesh(new THREE.BoxGeometry(lw + 0.6, 0.3, lb.hz * 2 + 0.6), darkSteel(0x1d2330));
    foot.position.set((lb.x0 + lb.x1) / 2, lb.y0 - 0.15, 0);
    laser.add(foot);
    g.add(laser);
    reg.register('co2Laser', laser, { priority: 1 });

    // laser beam proxy for the "pulses" component
    const beamProxy = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 6.4, 10), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    beamProxy.rotation.z = Math.PI / 2;
    beamProxy.position.set(-10.2, F1.y, 0);
    const pulsesGroup = new THREE.Group();
    pulsesGroup.add(beamProxy);
    this.mainCone = beamFrustum(SRC.hole, F1, 0.36, 0.02, COLOR.laser, 0, 18);
    this.preCone = beamFrustum(SRC.hole, SRC.prePt, 0.24, 0.02, COLOR.laser, 0, 18);
    pulsesGroup.add(this.mainCone, this.preCone);
    this.mainCone.userData.nopick = true;
    this.preCone.userData.nopick = true;
    g.add(pulsesGroup);
    reg.register('laserPulses', pulsesGroup, { priority: 1, emph: false, bounds: () => new THREE.Box3(v3(-13.6, 2.4, -0.5), v3(-6.6, 4.3, 0.5)) });

    // ── droplets ──
    const dropMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.12, envMapIntensity: 1.6 });
    this.droplets = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 24, 16), dropMat, 10);
    this.droplets.frustumCulled = false;
    this.droplets.count = 0;
    this.droplets.setColorAt(0, this.dropCol.set(0xffffff));
    this.droplets.userData.nopick = true;
    const dropProxy = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, SRC.sCatch, 8), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    dropProxy.position.set(F1.x, SRC.nozzleY - SRC.sCatch / 2, 0);
    const dropGroup = new THREE.Group();
    dropGroup.add(this.droplets, dropProxy);
    g.add(dropGroup);
    reg.register('droplets', dropGroup, { priority: 2, bounds: () => new THREE.Box3(v3(F1.x - 0.8, SRC.nozzleY - 4.4, -0.8), v3(F1.x + 0.8, SRC.nozzleY + 0.3, 0.8)) });

    // ── plasma ──
    this.plasmaGroup.position.copy(F1);
    this.core = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), glowMat(0xffffff, 1));
    this.shell = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), glowMat(COLOR.plasma, 0.6));
    this.halo = glowSprite(COLOR.plasma, 4.2, 0.95);
    this.halo2 = glowSprite(0xffffff, 1.8, 1);
    this.ring = glowSprite(COLOR.euv, 1, 0.7, ringTexture());
    this.preFlash = glowSprite(0xff8a5c, 1, 0);
    this.preFlash.position.copy(SRC.prePt).sub(F1);
    this.plasmaLight = new THREE.PointLight(0xc59aff, 0, 18, 1.5);
    this.plasmaGroup.add(this.core, this.shell, this.halo, this.halo2, this.ring, this.plasmaLight);
    for (let i = 0; i < 9; i++) {
      const t = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), glowMat(0xffd8ff, 0.5));
      t.userData.nopick = true;
      this.turb.push(t);
      this.plasmaGroup.add(t);
    }
    g.add(this.plasmaGroup, this.preFlash);
    const plasmaProxy = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 10), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    plasmaProxy.position.copy(F1);
    const plasmaPick = new THREE.Group();
    plasmaPick.add(plasmaProxy);
    g.add(plasmaPick);
    reg.register('plasma', plasmaPick, { priority: 3, emph: false, bounds: () => new THREE.Box3(v3(F1.x - 0.9, F1.y - 0.9, -0.9), v3(F1.x + 0.9, F1.y + 0.9, 0.9)) });
    // the glowing plasma itself is what an isolated view of the plasma must show
    reg.register('plasma', this.plasmaGroup, { priority: 3, emph: false });

    // EUV beam proxy (collector → IF)
    const euvProxy = beamFrustum(v3(-7.5, 3), IF, 0.5, 0.08, 0xffffff, 0, 10);
    (euvProxy.material as THREE.MeshBasicMaterial).colorWrite = false;
    const euvGroup = new THREE.Group();
    euvGroup.add(euvProxy);
    euvProxy.raycast = THREE.Mesh.prototype.raycast;
    g.add(euvGroup);
    reg.register('euvBeam', euvGroup, { priority: 1.5, emph: false, bounds: () => new THREE.Box3(v3(-8.4, 1.9, -1), v3(-1.6, 4.1, 1)) });

    // ── collector rays ──
    for (let j = 0; j < N_RAYS; j++) {
      const th = THREE.MathUtils.lerp(COLLECTOR.thetaHole + 0.05, COLLECTOR.thetaMax - 0.03, (j + 0.15 + 0.7 * hash(j * 3.1)) / N_RAYS);
      const psi = Math.PI * 2 * hash(j * 7.7 + 1) + (j % 2 ? 0.3 : 0);
      const P = collectorPoint(th, psi);
      this.rayP.push(P);
      this.rayR.push(F1.distanceTo(P));
    }
    // un-collected emission
    for (let i = 0; i < N_LOST; i++) {
      let d: THREE.Vector3;
      let tries = 0;
      do {
        const cz = -1 + 2 * hash(i * 5.3 + tries * 11.1 + 2);
        const phi = Math.PI * 2 * hash(i * 9.1 + tries * 3.3 + 4);
        const sn = Math.sqrt(1 - cz * cz);
        d = v3(cz, sn * Math.cos(phi), sn * Math.sin(phi));
        tries++;
      } while (d.x < 0.25 && tries < 30); // keep rays that don't hit the dish
      this.lostDir.push(d);
      this.lostLen.push(2.4 + 2.2 * hash(i * 2.9 + 8));
    }
    g.add(this.pool.mesh);

    // collector sparks (where rays land)
    const sp = new THREE.BufferGeometry();
    const spPos = new Float32Array(N_RAYS * 3);
    this.rayP.forEach((p, i) => spPos.set([p.x, p.y, p.z], i * 3));
    sp.setAttribute('position', new THREE.BufferAttribute(spPos, 3));
    this.sparkCol = new Float32Array(N_RAYS * 3);
    sp.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3));
    this.sparks = new THREE.Points(sp, new THREE.PointsMaterial({ map: dotTexture(), size: 0.6, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.sparks.frustumCulled = false;
    this.sparks.raycast = () => {};
    g.add(this.sparks);

    // debris (tin fragments flung out of the plasma)
    const nd = 30;
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nd * 3), 3));
    this.debrisCol = new Float32Array(nd * 3);
    dg.setAttribute('color', new THREE.BufferAttribute(this.debrisCol, 3));
    for (let i = 0; i < nd; i++) {
      const cz = -1 + 2 * hash(i * 1.7 + 30);
      const phi = Math.PI * 2 * hash(i * 4.1 + 31);
      const sn = Math.sqrt(1 - cz * cz);
      this.debrisDir.push(v3(cz, sn * Math.cos(phi), sn * Math.sin(phi)).multiplyScalar(0.6 + 1.6 * hash(i * 6.3 + 32)));
    }
    this.debris = new THREE.Points(dg, new THREE.PointsMaterial({ map: dotTexture(), size: 0.16, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.debris.frustumCulled = false;
    this.debris.raycast = () => {};
    g.add(this.debris);

    // hydrogen buffer-gas flow along the collector
    const nh = 70;
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nh * 3), 3));
    this.h2 = new THREE.Points(hg, new THREE.PointsMaterial({ map: dotTexture(), size: 0.17, color: 0x8fd0ff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.h2.frustumCulled = false;
    this.h2.raycast = () => {};
    g.add(this.h2);

    // air molecules (only visible in "Air" mode)
    const mkCloud = (n: number, x0: number, x1: number, y0: number, y1: number, hz: number, circular: boolean) => {
      const base = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        let x = lerp(x0, x1, hash(i * 1.3 + 100));
        let y = lerp(y0, y1, hash(i * 2.7 + 101));
        const z = (hash(i * 5.1 + 102) * 2 - 1) * hz;
        if (circular) {
          const ang = Math.PI * 2 * hash(i * 3.3 + 103);
          const rr = (V.r - 0.15) * Math.sqrt(hash(i * 7.7 + 104));
          y = V.cy + rr * Math.cos(ang);
          base[i * 3 + 2] = rr * Math.sin(ang);
          base[i * 3] = x;
          base[i * 3 + 1] = y;
          continue;
        }
        base[i * 3] = x;
        base[i * 3 + 1] = y;
        base[i * 3 + 2] = z;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(base), 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: dotTexture(), size: 0.2, color: 0xb9c4d6, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
      pts.frustumCulled = false;
      pts.visible = false;
      pts.raycast = () => {};
      return { pts, base };
    };
    const av = mkCloud(380, V.x0 + 0.2, V.x1 - 0.1, V.cy - V.r, V.cy + V.r, 0, true);
    const as = mkCloud(520, 0.2, 31.5, -4.8, 16.2, 3.4, false);
    this.airV = av.pts;
    this.airVBase = av.base;
    this.airS = as.pts;
    this.airSBase = as.base;
    g.add(this.airV, this.airS);
  }

  private rayPoint(j: number, u: number, out: THREE.Vector3) {
    const r = this.rayR[j];
    if (u <= r) return out.copy(F1).lerp(this.rayP[j], clamp(u / r));
    return out.copy(this.rayP[j]).lerp(IF, clamp((u - r) / (2 * ELL.a - r)));
  }

  update(c: FrameCtx) {
    const { T } = c;
    const pool = this.pool;
    pool.begin();
    const air = c.atmosphere === 'air';
    const showPath = c.showPath;

    // ── droplets ──
    {
      const kBase = Math.floor(T - SRC.tShot);
      let n = 0;
      for (let dk = -4; dk <= 4; dk++) {
        const k = kBase + dk;
        const age = T - tMain(k);
        const s = SRC.sMain + SRC.dropV * age;
        if (s < 0 || s > SRC.sCatch) continue;
        const preHit = preOnAt(tPre(k)) && age > -PRE_DELAY;
        const mainHit = mainOnAt(tMain(k)) && age >= 0;
        if (mainHit) continue;
        const R = SRC.dropR;
        let sx: number, sy: number, sz: number;
        let f = 0;
        if (preHit) {
          f = 1 - Math.pow(1 - clamp((age + PRE_DELAY) / 0.55), 2);
          const rad = R * (1 + 4.6 * f);
          sx = R * (1 - 0.9 * f) + 0.012;
          sy = rad;
          sz = rad;
        } else {
          const amp = Math.exp(-s / 1.1);
          const e = 1 + 0.85 * amp * Math.cos((2 * Math.PI * s) / 0.8);
          sy = R * e;
          sx = sz = R / Math.sqrt(e);
        }
        this.matrix.compose(_a.set(F1.x, SRC.nozzleY - s, 0), new THREE.Quaternion(), _b.set(sx, sy, sz));
        this.droplets.setMatrixAt(n, this.matrix);
        this.dropCol.setRGB(0.92, 0.94, 0.98).lerp(this.tmpColor.set(0xffa860), f * 0.75);
        this.droplets.setColorAt(n, this.dropCol);
        n++;
      }
      this.droplets.count = n;
      this.droplets.instanceMatrix.needsUpdate = true;
      if (this.droplets.instanceColor) this.droplets.instanceColor.needsUpdate = true;
    }

    // heater / indicator
    const laserActive = preOnAt(T);
    const heat = 0.75 + 0.25 * Math.sin(T * 2.2);
    for (const h of this.heater) (h.material as THREE.MeshStandardMaterial).emissiveIntensity = heat * (0.8 + c.emph('dropletGenerator') * 0.6);
    (this.indicator.material as THREE.MeshBasicMaterial).color.setHex(laserActive ? COLOR.laser : 0x35d07f);
    const pulseGlow = laserActive ? 0.55 + 0.45 * Math.sin(T * 9) ** 2 : 0.18;
    for (const l of this.laserLights) (l.material as THREE.MeshStandardMaterial).emissiveIntensity = pulseGlow;

    // ── laser pulses (red packets flying to the droplet) ──
    const flashMain = (() => {
      const tm = lastMainTime(T);
      return mainOnAt(tm) ? Math.exp(-(T - tm) / 0.07) * (T - tm >= 0 ? 1 : 0) : 0;
    })();
    const flashPre = (() => {
      const tp = lastPreTime(T);
      return preOnAt(tp) ? Math.exp(-(T - tp) / 0.06) : 0;
    })();
    if (showPath) {
      const horizon = 0.7;
      for (let k = Math.floor(T - SRC.tShot - 0.2); k <= Math.floor(T - SRC.tShot + horizon + PRE_DELAY); k++) {
        const arrM = tMain(k);
        if (mainOnAt(arrM)) {
          const rem = SRC.v_laser * (arrM - T);
          if (rem > -0.1 && rem < this.mainLen) {
            const head = Math.min(this.mainLen - rem, this.mainLen);
            const tail = Math.max(head - 1.1, 0);
            if (head > tail) pool.add(polyAt(this.mainPath, tail, _a), polyAt(this.mainPath, head, _b), 0.12, RED, 2.2);
          }
        }
        const arrP = tPre(k);
        if (preOnAt(arrP)) {
          const rem = SRC.v_laser * (arrP - T);
          if (rem > -0.1 && rem < this.preLen) {
            const head = Math.min(this.preLen - rem, this.preLen);
            const tail = Math.max(head - 0.8, 0);
            if (head > tail) pool.add(polyAt(this.prePath, tail, _a), polyAt(this.prePath, head, _b), 0.07, RED, 1.7);
          }
        }
      }
    }
    (this.mainCone.material as THREE.MeshBasicMaterial).opacity = showPath ? flashMain * 0.55 : 0;
    (this.preCone.material as THREE.MeshBasicMaterial).opacity = showPath ? flashPre * 0.5 : 0;
    this.mainCone.visible = showPath && flashMain > 0.01;
    this.preCone.visible = showPath && flashPre > 0.01;

    // ── plasma ──
    {
      const tm = lastMainTime(T);
      const tau = T - tm;
      const on = mainOnAt(tm);
      // while the plasma is being inspected it is held at a steady glow instead of flashing
      const P = c.inspect === 'plasma' ? 0.5 + 0.08 * Math.sin(T * 2.4) : on ? plasmaEnv(tau) : 0;
      const flicker = 0.9 + 0.2 * hash(Math.floor(T * 40));
      const Pf = P * flicker;
      const vis = Pf > 0.004;
      this.core.visible = this.shell.visible = this.halo.visible = this.halo2.visible = vis;
      this.core.scale.setScalar(0.1 + 0.34 * Math.sqrt(Pf));
      this.shell.scale.setScalar(0.2 + 0.7 * Math.sqrt(Pf));
      (this.shell.material as THREE.MeshBasicMaterial).opacity = 0.55 * Math.min(1, Pf * 1.4);
      this.halo.scale.setScalar(1 + 5.2 * Math.sqrt(Pf));
      (this.halo.material as THREE.SpriteMaterial).opacity = 0.95 * Math.min(1, Pf * 1.6);
      this.halo2.scale.setScalar(0.5 + 2.4 * Pf);
      (this.halo2.material as THREE.SpriteMaterial).opacity = Math.min(1, Pf * 1.8);
      this.plasmaLight.intensity = 55 * Pf;
      this.turb.forEach((t, i) => {
        t.visible = vis;
        const a = hash(i * 3.1 + Math.floor(T * 14) * 0.37) * Math.PI * 2;
        const b = hash(i * 5.7 + Math.floor(T * 14) * 0.53) * Math.PI;
        const rr = (0.12 + 0.5 * hash(i + 9)) * (0.4 + Pf);
        t.position.set(rr * Math.sin(b) * Math.cos(a), rr * Math.sin(b) * Math.sin(a), rr * Math.cos(b));
        t.scale.setScalar((0.05 + 0.18 * hash(i * 2.2)) * (0.3 + Pf));
      });
      // expanding EUV shell
      const ringOn = on && showPath && tau < 0.5;
      this.ring.visible = ringOn;
      if (ringOn) {
        const rr = Math.min(7, SRC.v_euv * 0.45 * tau + 0.2);
        this.ring.scale.setScalar(rr * 2);
        (this.ring.material as THREE.SpriteMaterial).opacity = 0.6 * Math.exp(-tau / 0.16);
      }
      // pre-pulse flash
      this.preFlash.scale.setScalar(0.5 + 1.3 * flashPre);
      (this.preFlash.material as THREE.SpriteMaterial).opacity = flashPre;
      this.preFlash.visible = flashPre > 0.01;

      // debris
      const dpos = this.debris.geometry.attributes.position as THREE.BufferAttribute;
      const dfade = on && tau < 1.3 && tau > 0.02 ? Math.exp(-tau / 0.55) : 0;
      this.debris.visible = dfade > 0.01;
      if (this.debris.visible) {
        for (let i = 0; i < this.debrisDir.length; i++) {
          const d = this.debrisDir[i];
          dpos.setXYZ(i, F1.x + d.x * tau, F1.y + d.y * tau, F1.z + d.z * tau);
          this.debrisCol[i * 3] = 1.2 * dfade;
          this.debrisCol[i * 3 + 1] = 0.75 * dfade;
          this.debrisCol[i * 3 + 2] = 0.45 * dfade;
        }
        dpos.needsUpdate = true;
        (this.debris.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
      }
    }

    // ── EUV emission, collection, lost rays ──
    this.sparkCol.fill(0);
    if (showPath) {
      for (const pl of c.pulses) {
        const s = pl.s;
        if (s > 10.8) continue;
        const att = airAtt(c.atmosphere, s);
        const fadeOut = c.legs === 2 ? 1 : 1;
        for (let j = 0; j < N_RAYS; j++) {
          const r = this.rayR[j];
          const total = 2 * ELL.a;
          let head = s;
          let tail = s - 0.75;
          if (c.legs === 1) head = Math.min(head, r);
          if (tail >= (c.legs === 1 ? r : total) || head <= 0) continue;
          tail = Math.max(tail, 0);
          head = Math.min(head, total);
          // brightness of this ray: leg 2 slightly brighter as the rays converge
          const kk = 1.7 * att * fadeOut * (s > r ? 1.15 : 1);
          pool.add(this.rayPoint(j, tail, _a), this.rayPoint(j, head, _b), 0.032, CYAN, kk);
          const hit = Math.exp(-(((s - r) / 0.32) ** 2)) * att;
          if (hit > 0.01) {
            const q = hit * 1.9;
            this.sparkCol[j * 3] = 0.3 * q;
            this.sparkCol[j * 3 + 1] = 0.9 * q;
            this.sparkCol[j * 3 + 2] = 1.0 * q;
          }
        }
        // rays that miss the collector
        for (let i = 0; i < N_LOST; i++) {
          const L = this.lostLen[i];
          if (s >= L + 0.5) continue;
          const head = Math.min(s, L);
          const tail = Math.max(s - 0.6, 0);
          if (head <= tail) continue;
          const fade = Math.pow(clamp(1 - s / (L + 0.5)), 1.3) * att;
          _a.copy(this.lostDir[i]).multiplyScalar(tail).add(F1);
          _b.copy(this.lostDir[i]).multiplyScalar(head).add(F1);
          pool.add(_a, _b, 0.024, CYAN, 1.5 * fade);
        }
      }
    }
    pool.end();
    (this.sparks.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    this.sparks.visible = showPath;

    // ── hydrogen flow & air molecules ──
    {
      const hp = this.h2.geometry.attributes.position as THREE.BufferAttribute;
      const n = hp.count;
      for (let i = 0; i < n; i++) {
        const u = fract(hash(i * 1.9 + 50) + T * 0.16);
        const th = THREE.MathUtils.lerp(COLLECTOR.thetaHole, COLLECTOR.thetaMax, u);
        const psi = Math.PI * 2 * hash(i * 2.3 + 51);
        collectorPoint(th, psi, _a);
        // push slightly off the mirror, towards the focus, and fan out at the rim
        _b.copy(F1).sub(_a).normalize().multiplyScalar(0.14 + 0.2 * u * u);
        _a.add(_b);
        hp.setXYZ(i, _a.x, _a.y, _a.z);
      }
      hp.needsUpdate = true;
      this.h2.visible = !air;
      this.airV.visible = air;
      this.airS.visible = air;
      if (air) {
        for (const [pts, base, amp] of [
          [this.airV, this.airVBase, 0.1],
          [this.airS, this.airSBase, 0.16],
        ] as const) {
          const pp = pts.geometry.attributes.position as THREE.BufferAttribute;
          for (let i = 0; i < pp.count; i++) {
            const ph = T * (1.6 + hash(i) * 2.2) + i * 1.7;
            pp.setXYZ(i, base[i * 3] + amp * Math.sin(ph), base[i * 3 + 1] + amp * Math.cos(ph * 1.3), base[i * 3 + 2] + amp * Math.sin(ph * 0.7));
          }
          pp.needsUpdate = true;
        }
      }
    }
  }
}
