import * as THREE from 'three';
import {
  BEAMLET_U,
  N_BEAMLETS,
  NODES,
  NORMALS,
  N_IDX,
  PATTERN_BITS,
  RETICLE_I,
  SEGS,
  S_AT,
  S_RETICLE,
  S_TOTAL,
  beamletPoint,
  pointAtS,
  reflectionsAt,
  v3,
} from '../data/layout';
import { COLOR, SegPool, beamFrustum, circuitTexture, darkSteel, edgeBox, glass, glowMat, glowSprite, rod, steel } from './gfx';
import { Registry } from './registry';
import { FrameCtx, SimModule, airAtt, scanState, visBrightness } from './timing';
import { clamp, hash, smoothstep } from './util';
import { SRC } from '../data/layout';

const CYAN = new THREE.Color(COLOR.euv);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

const mirrorMaterial = () =>
  new THREE.MeshPhysicalMaterial({
    color: 0xc9d6ee,
    metalness: 1,
    roughness: 0.08,
    iridescence: 1,
    iridescenceIOR: 1.7,
    iridescenceThicknessRange: [140, 420],
    envMapIntensity: 1.7,
    side: THREE.DoubleSide,
  });

type MirrorShape = 'flat' | 'concave' | 'convex';

/** Mirror whose local +Z axis is the reflecting normal. */
function buildMirror(radius: number, shape: MirrorShape, sag = 0.14, thick = 0.2): THREE.Group {
  const g = new THREE.Group();
  const sub = darkSteel(0x2e3646, 0.5, 0.75);
  const frontZ = shape === 'concave' ? -sag - 0.005 : -0.005;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.04, radius * 1.06, thick, 48).rotateX(Math.PI / 2), sub);
  body.position.z = frontZ - thick / 2;
  g.add(body);
  if (shape === 'flat') {
    const face = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.98, 56), mirrorMaterial());
    face.position.z = 0.002;
    g.add(face);
  } else {
    const Rc = (radius * radius + sag * sag) / (2 * sag);
    const alpha = Math.asin(radius / Rc);
    const cap = new THREE.SphereGeometry(Rc, 56, 14, 0, Math.PI * 2, 0, alpha);
    if (shape === 'convex') {
      cap.rotateX(Math.PI / 2);
      cap.translate(0, 0, -Rc * Math.cos(alpha));
    } else {
      cap.rotateX(-Math.PI / 2);
      cap.translate(0, 0, Rc * Math.cos(alpha));
      const lip = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.04, radius * 1.04, sag, 48, 1, true).rotateX(Math.PI / 2), sub);
      lip.material.side = THREE.DoubleSide;
      lip.position.z = -sag / 2;
      g.add(lip);
    }
    g.add(new THREE.Mesh(cap, mirrorMaterial()));
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.03, 0.035, 8, 56), steel(0x9aa6b8, 0.3, 0.95));
  g.add(ring);
  return g;
}

function orient(g: THREE.Object3D, p: THREE.Vector3, n: THREE.Vector3) {
  g.position.copy(p);
  g.quaternion.setFromUnitVectors(Z, n);
}

export class OpticsModule implements SimModule {
  group = new THREE.Group();
  private tubes: { mesh: THREE.Mesh; i: number; base: number }[] = [];
  private pool = new SegPool(260, 6);
  private beamPool = new SegPool(120, 5);
  private glints: THREE.Sprite[] = [];
  private pfmLit: THREE.InstancedMesh;
  private pfmLitPos: THREE.Vector3[] = [];
  private reticleMove = new THREE.Group();
  private slit: THREE.Mesh;
  private ifGlow: THREE.Sprite;
  private reg: Registry;
  private dummy = new THREE.Object3D();
  private beamletColor = new THREE.Color();

  constructor(reg: Registry) {
    this.reg = reg;
    const g = this.group;

    // ───────── static beam tubes (IF → illuminator → mask → projection → wafer) ─────────
    for (let i = 2; i < SEGS.length; i++) {
      const a = NODES[i].p;
      const b = NODES[i + 1].p;
      const wa = Math.max(0.05, NODES[i].w * 0.62);
      const wb = Math.max(0.05, NODES[i + 1].w * 0.62);
      const mesh = beamFrustum(a, b, wa, wb, COLOR.euv, 0.05, 20);
      mesh.userData.nopick = true;
      this.tubes.push({ mesh, i, base: i >= RETICLE_I ? 0.04 : 0.11 });
      g.add(mesh);
    }
    g.add(this.pool.mesh, this.beamPool.mesh);

    // hit glints at every optical element
    NODES.forEach((n, i) => {
      if (n.kind === 'source') return;
      const s = glowSprite(COLOR.euv, n.kind === 'if' ? 2.4 : 1.3, 0);
      s.position.copy(n.p);
      this.glints[i] = s;
      g.add(s);
    });
    this.ifGlow = this.glints[N_IDX.if];

    // ───────── illuminator ─────────
    const illum = new THREE.Group();
    const post = darkSteel(0x232a38);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(14.6, 0.34, 4.6), post);
    bench.position.set(7.6, -1.45, 0);
    illum.add(bench);
    // FFM: many small tilted facets
    {
      const node = NODES[N_IDX.ffm];
      const grp = new THREE.Group();
      const plate = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.9, 0.18), darkSteel(0x2e3646, 0.5, 0.75));
      plate.position.z = -0.1;
      grp.add(plate);
      const nx = 9;
      const ny = 5;
      const facet = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mirrorMaterial(), nx * ny);
      facet.userData.nopick = false;
      for (let iy = 0; iy < ny; iy++)
        for (let ix = 0; ix < nx; ix++) {
          const idx = iy * nx + ix;
          this.dummy.position.set((ix - (nx - 1) / 2) * 0.31, (iy - (ny - 1) / 2) * 0.33, 0.03);
          this.dummy.rotation.set((hash(idx * 1.3) - 0.5) * 0.14, (hash(idx * 2.9 + 4) - 0.5) * 0.14, 0);
          this.dummy.scale.set(0.27, 0.29, 0.06);
          this.dummy.updateMatrix();
          facet.setMatrixAt(idx, this.dummy.matrix);
        }
      grp.add(facet);
      orient(grp, node.p, NORMALS[N_IDX.ffm]!);
      illum.add(grp);
      reg.register('ffm', grp, { priority: 1 });
      illum.add(rod(_a.set(node.p.x, node.p.y - 0.9, 0).clone(), v3(node.p.x, -1.3, 0), 0.12, post, 10));
    }
    // PFM: round facets in a hexagonal pattern, a dipole subset lights up
    {
      const node = NODES[N_IDX.pfm];
      const grp = new THREE.Group();
      const R = NODES[N_IDX.pfm].radius!;
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 1.04, 0.18, 56).rotateX(Math.PI / 2), darkSteel(0x2e3646, 0.5, 0.75));
      plate.position.z = -0.1;
      grp.add(plate);
      const pts: THREE.Vector2[] = [];
      const sp = 0.34;
      for (let q = -4; q <= 4; q++)
        for (let r = -4; r <= 4; r++) {
          const x = sp * (q + r / 2);
          const y = sp * (Math.sqrt(3) / 2) * r;
          if (Math.hypot(x, y) <= R - 0.17) pts.push(new THREE.Vector2(x, y));
        }
      const fm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 16).rotateX(Math.PI / 2), mirrorMaterial(), pts.length);
      pts.forEach((p, i) => {
        this.dummy.position.set(p.x, p.y, 0.03);
        this.dummy.rotation.set((hash(i * 1.7 + 9) - 0.5) * 0.2, (hash(i * 3.1 + 3) - 0.5) * 0.2, 0);
        this.dummy.scale.set(0.29, 0.29, 0.06);
        this.dummy.updateMatrix();
        fm.setMatrixAt(i, this.dummy.matrix);
      });
      grp.add(fm);
      // dipole: two poles along the x-axis of the pupil
      const lit = pts.filter((p) => Math.abs(p.x) > 0.5 && Math.abs(p.y) < 0.46);
      this.pfmLit = new THREE.InstancedMesh(new THREE.CircleGeometry(0.17, 16), glowMat(COLOR.euv, 0.9), lit.length);
      lit.forEach((p, i) => {
        this.dummy.position.set(p.x, p.y, 0.075);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.setScalar(1);
        this.dummy.updateMatrix();
        this.pfmLit.setMatrixAt(i, this.dummy.matrix);
      });
      this.pfmLit.userData.nopick = true;
      this.pfmLit.raycast = () => {};
      grp.add(this.pfmLit);
      orient(grp, node.p, NORMALS[N_IDX.pfm]!);
      illum.add(grp);
      reg.register('pfm', grp, { priority: 1 });
      illum.add(rod(v3(node.p.x, node.p.y - 1.0, 0), v3(node.p.x, -1.3, 0), 0.12, post, 10));
    }
    // relay mirror
    {
      const node = NODES[N_IDX.relay];
      const m = buildMirror(node.radius!, 'concave', 0.1);
      orient(m, node.p, NORMALS[N_IDX.relay]!);
      illum.add(m);
      illum.add(rod(v3(node.p.x, node.p.y - 0.9, 0), v3(node.p.x, -1.3, 0), 0.12, post, 10));
      reg.register('illumination', m, { priority: 1 });
    }
    g.add(illum);

    // ───────── reticle (reflective mask) ─────────
    const reticle = new THREE.Group();
    const rp = NODES[RETICLE_I].p;
    reticle.position.copy(rp);
    const tex = circuitTexture('#8396dc', '#0d1018', 1024);
    const darkFace = new THREE.MeshStandardMaterial({ color: 0x1d2433, metalness: 0.7, roughness: 0.4 });
    const patternFace = new THREE.MeshStandardMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: 0x5766b8,
      emissiveIntensity: 0.55,
      metalness: 0.55,
      roughness: 0.3,
      envMapIntensity: 1.1,
    });
    const plate = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.16, 2.6), [darkFace, darkFace, darkFace, patternFace, darkFace, darkFace]);
    this.reticleMove.add(plate);
    const chuck = new THREE.Mesh(new THREE.BoxGeometry(2.95, 0.2, 2.95), steel(0x59647a, 0.4, 0.85));
    chuck.position.y = 0.18;
    const carriage = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.5, 3.8), darkSteel(0x2a3242));
    carriage.position.y = 0.53;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(4.42, 0.06, 0.06), new THREE.MeshStandardMaterial({ color: 0x20243a, emissive: COLOR.mask, emissiveIntensity: 0.9 }));
    stripe.userData.noEmph = true;
    stripe.position.set(0, 0.62, 1.92);
    // the moving part of the reticle stage (clamp, carriage, stripe) is its own selectable component
    const stageParts = new THREE.Group();
    stageParts.add(chuck, carriage, stripe);
    this.reticleMove.add(stageParts);
    // beam-spot slit (illuminated strip of the mask)
    this.slit = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.34).rotateX(Math.PI / 2), glowMat(COLOR.euv, 0));
    (this.slit.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
    this.slit.position.y = -0.095;
    this.slit.userData.nopick = true;
    this.reticleMove.add(this.slit);
    reticle.add(this.reticleMove);
    // fixed guide rails along the scan direction
    const rails = new THREE.Group();
    for (const x of [-2.3, 2.3]) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 6.2, 14).rotateX(Math.PI / 2), steel(0xaab5ca, 0.25, 1));
      r.position.set(x, 0.52, 0);
      rails.add(r);
    }
    reticle.add(rails);
    // magnified pattern card
    const card = new THREE.Group();
    card.position.set(20.6 - rp.x, 15.3 - rp.y, 1.3);
    const cardMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false });
    const cardMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 2.7), cardMat);
    const cardFrame = edgeBox(2.8, 2.8, 0.06, COLOR.mask, 0.9);
    card.add(cardMesh, cardFrame);
    reticle.add(card);
    const zoom = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([v3(1.3, 0.1, 1.3), v3(card.position.x - 1.35, card.position.y - 1.35, 1.3), v3(1.3, 0.1, -1.3), v3(card.position.x - 1.35, card.position.y + 1.35, 1.3)]),
      new THREE.LineBasicMaterial({ color: COLOR.mask, transparent: true, opacity: 0.35, toneMapped: false }),
    );
    zoom.raycast = () => {};
    reticle.add(zoom);
    g.add(reticle);
    const reticleBounds = () => new THREE.Box3(v3(rp.x - 2.4, rp.y - 0.3, -2), v3(rp.x + 2.4, rp.y + 1.0, 2));
    reg.register('reticle', plate, { priority: 1, bounds: reticleBounds });
    reg.register('reticle', card, { priority: 1 });
    reg.register('reticle', zoom, { priority: 1 });
    reg.register('reticle', this.slit, { priority: 1 });
    reg.register('reticleStage', stageParts, { priority: 1, bounds: () => new THREE.Box3(v3(rp.x - 2.4, rp.y + 0.05, -3.2), v3(rp.x + 2.4, rp.y + 0.85, 3.2)) });
    reg.register('reticleStage', rails, { priority: 1 });

    // ───────── projection optics ─────────
    const proj = new THREE.Group();
    const housing = new THREE.Group();
    const bw = 10.8;
    const bh = 10.5;
    const bcx = 21.5;
    const bcy = 7.5;
    const box = edgeBox(bw, bh, 4.4, 0xa9b8d6, 0.55);
    box.position.set(bcx, bcy, 0);
    const faces = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 4.4), glass(0x9fb8e8, 0.035));
    faces.position.set(bcx, bcy, 0);
    faces.userData.nopick = true;
    const plateMat = new THREE.MeshStandardMaterial({ color: 0x2a3344, roughness: 0.5, metalness: 0.8, transparent: true, opacity: 0.55 });
    // The housing plates are translucent and sit between the camera and the mask stage in the
    // mask close-up, so they must not swallow clicks meant for the reticle or the mirrors.
    const topPlate = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.26, 4.4), plateMat);
    topPlate.position.set(bcx, bcy + bh / 2, 0);
    topPlate.userData.nopick = true;
    const botPlate = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.26, 4.4), plateMat);
    botPlate.position.set(bcx, bcy - bh / 2, 0);
    botPlate.userData.nopick = true;
    housing.add(box, faces, topPlate, botPlate);
    proj.add(housing);
    const mirrors: [string, MirrorShape, number][] = [
      ['m1', 'concave', 0.18],
      ['m2', 'convex', 0.12],
      ['m3', 'concave', 0.14],
      ['m4', 'convex', 0.1],
      ['m5', 'convex', 0.08],
      ['m6', 'concave', 0.2],
    ];
    for (const [id, shape, sag] of mirrors) {
      const node = NODES[N_IDX[id]];
      const m = buildMirror(node.radius!, shape, sag);
      orient(m, node.p, NORMALS[N_IDX[id]]!);
      proj.add(m);
      const up = node.p.y > 8;
      const end = up ? bcy + bh / 2 : bcy - bh / 2;
      proj.add(rod(v3(node.p.x, node.p.y + (up ? 0.6 : -0.6), 0), v3(node.p.x, end, 0), 0.07, steel(0x6a758c, 0.4, 0.9), 8));
    }
    g.add(proj);
    reg.register('projection', proj, { priority: 1 });
  }

  private gate(s: number, reach: number) {
    return 1 - smoothstep(reach - 1.8, reach, s);
  }

  update(c: FrameCtx) {
    const { reach, showPath } = c;
    const dim = c.stage >= 8 ? 0.45 : 1; // scanner idle while the wafer is in the track
    const t = c.T;

    // ── beam tubes ──
    for (const tb of this.tubes) {
      const s0 = S_AT[tb.i];
      const s1 = S_AT[tb.i + 1];
      const lit = smoothstep(s0 - 0.5, s0 + 2.0, reach) * (reach > 0 ? 1 : 0);
      const anyEuv = c.pulses.length > 0 || reach > 0;
      const pulseMod = 0.8 + 0.2 * Math.sin(t * 6 - s0 * 0.4);
      const op = (0.012 + (tb.base - 0.012) * lit * pulseMod * dim) * (anyEuv ? 1 : 0.4);
      const att = c.atmosphere === 'air' ? 0.1 : 1;
      (tb.mesh.material as THREE.MeshBasicMaterial).opacity = showPath ? op * att : 0;
      tb.mesh.visible = showPath;
    }

    // ── reticle scan, slit ──
    const sc = scanState(t);
    const amt = smoothstep(S_RETICLE - 7, S_RETICLE, reach);
    this.reticleMove.position.z = -sc.zPlate * amt;
    const slitLit = showPath ? smoothstep(S_RETICLE - 1.5, S_RETICLE, reach) * (c.atmosphere === 'air' ? 0.05 : 1) * dim : 0;
    (this.slit.material as THREE.MeshBasicMaterial).opacity = 0.75 * slitLit;
    this.slit.position.z = sc.zPlate;
    this.slit.visible = slitLit > 0.01;

    // ── pulses: single beam up to the mask, bundle of beamlets after it ──
    const pool = this.pool;
    const bp = this.beamPool;
    pool.begin();
    bp.begin();
    const glint = new Array<number>(NODES.length).fill(0);
    if (showPath) {
      for (const pl of c.pulses) {
        const s = pl.s;
        if (s < S_AT[2] - 0.8) continue;
        const gate = this.gate(s, reach) * airAtt(c.atmosphere, s) * dim;
        if (gate < 0.01) continue;
        const bright = visBrightness(reflectionsAt(s)) * gate;
        // glints at nodes
        for (let k = 2; k < NODES.length; k++) {
          const d = (s - S_AT[k]) / 0.9;
          if (Math.abs(d) < 2.5) glint[k] = Math.max(glint[k], Math.exp(-d * d) * bright * 1.5);
        }
        if (s <= S_RETICLE + 0.3) {
          const head = Math.max(s, S_AT[2]);
          const tail = Math.max(s - 1.2, S_AT[2]);
          if (head > tail) pool.add(pointAtS(tail, _a), pointAtS(head, _b), 0.075, CYAN, 2.4 * bright);
          const tail2 = Math.max(s - 2.2, S_AT[2]);
          const head2 = Math.max(s - 1.5, S_AT[2]);
          if (head2 > tail2) pool.add(pointAtS(tail2, _a), pointAtS(head2, _b), 0.045, CYAN, 1.2 * bright);
        }
        if (s > S_RETICLE - 0.4) {
          // packet of each beamlet, carrying the mask pattern slice present when it reflected
          const tHit = pl.tk + S_RETICLE / SRC.v_euv;
          const shift = Math.floor(tHit / 1.1);
          for (let i = 0; i < N_BEAMLETS; i++) {
            const bit = PATTERN_BITS[(i + shift + 13 * 10) % PATTERN_BITS.length];
            if (s > S_RETICLE && !bit) continue;
            const head = Math.max(s, S_RETICLE);
            const tail = Math.max(s - 1.1, S_RETICLE);
            if (head <= tail) continue;
            const u = BEAMLET_U[i];
            this.beamletAt(tail, u, _a);
            this.beamletAt(head, u, _b);
            pool.add(_a, _b, 0.05, CYAN, 2.3 * bright);
          }
        }
      }
      // faint beamlet guide lines
      const guide = 0.5 * smoothstep(S_RETICLE - 1, S_RETICLE + 2, reach) * dim * (c.atmosphere === 'air' ? 0.1 : 1);
      if (guide > 0.01) {
        for (let k = RETICLE_I; k < NODES.length - 1; k++) {
          const lit = smoothstep(S_AT[k] - 0.3, S_AT[k] + 1.6, reach);
          if (lit < 0.01) continue;
          for (let i = 0; i < N_BEAMLETS; i++) {
            const u = BEAMLET_U[i];
            beamletPoint(k, u, _a);
            beamletPoint(k + 1, u, _b);
            bp.add(_a, _b, 0.014, CYAN, guide * lit);
          }
        }
      }
    }
    pool.end();
    bp.end();

    // ── glints ──
    this.glints.forEach((sp, i) => {
      if (!sp) return;
      const k = NODES[i].kind;
      const v = showPath ? Math.min(1.4, glint[i]) : 0;
      (sp.material as THREE.SpriteMaterial).opacity = k === 'collector' ? 0 : v;
      sp.visible = v > 0.02 && k !== 'collector';
    });
    // IF stays softly lit whenever light arrives there
    if (showPath) {
      const base = smoothstep(S_AT[N_IDX.if] - 1, S_AT[N_IDX.if], reach) * (c.atmosphere === 'air' ? 0 : 0.35) * dim;
      const sp = this.ifGlow;
      (sp.material as THREE.SpriteMaterial).opacity = Math.min(1.2, base + glint[N_IDX.if]);
      sp.visible = true;
    }
    // PFM lit facets pulse with the beam
    (this.pfmLit.material as THREE.MeshBasicMaterial).opacity = showPath ? 0.25 + 0.75 * Math.min(1, glint[N_IDX.pfm] + 0.25 * smoothstep(S_AT[N_IDX.pfm] - 1, S_AT[N_IDX.pfm], reach)) : 0.15;
  }

  /** Position of beamlet u at path distance s (after the mask). */
  private beamletAt(s: number, u: number, out: THREE.Vector3) {
    const cs = clamp(s, S_RETICLE, S_TOTAL);
    let k = RETICLE_I;
    while (k < NODES.length - 2 && cs > S_AT[k + 1]) k++;
    const f = (cs - S_AT[k]) / (S_AT[k + 1] - S_AT[k]);
    beamletPoint(k, u, _c);
    beamletPoint(k + 1, u, out);
    return out.lerp(_c, 1 - f);
  }
}
