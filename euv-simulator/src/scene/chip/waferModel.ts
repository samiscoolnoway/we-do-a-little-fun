import * as THREE from 'three';
import { DIE, DIES, FLOORPLAN, IO_RING, WAFER, type DieDef, type RegionDef } from '../../data/chip';

/**
 * The finished wafer at true proportions, 1 unit = 1 mm. The wafer lies in the x–z plane with its patterned face
 * up (+y); wafer coordinates (x right, y towards the notch-free side) map to world (x, ·, -y).
 * Complete dies are instanced planes carrying a high-resolution floorplan texture; the dies cut by the edge are
 * painted into the wafer texture itself, clipped by the circle.
 */
export const W_TOP = WAFER.thickness / 2;
export const toWorld = (x: number, y: number, h = W_TOP) => new THREE.Vector3(x, h, -y);

// ── the die pattern, drawn from the floorplan (used both for the die texture and for edge dies) ──
const KIND_COLOR: Record<string, string> = { logic: '#4a4c45', sram: '#3b4459', analog: '#4b4250', io: '#3c3f47' };

function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return (s & 0xffff) / 0xffff;
  };
}

/** Paint one die into a 2-D context, in die millimetres scaled by `k` pixels per mm, origin at its lower-left. */
function paintDie(g: CanvasRenderingContext2D, ox: number, oy: number, k: number, detail: number) {
  const X = (u: number) => ox + u * k;
  const Yp = (v: number) => oy + (DIE.h - v) * k;
  const r = rand(7);
  g.fillStyle = '#34363d';
  g.fillRect(X(0), Yp(DIE.h), DIE.w * k, DIE.h * k);
  // I/O ring with pads
  g.fillStyle = '#2f3138';
  g.fillRect(X(0), Yp(DIE.h), DIE.w * k, DIE.h * k);
  g.fillStyle = '#3d4049';
  g.fillRect(X(IO_RING), Yp(DIE.h - IO_RING), (DIE.w - 2 * IO_RING) * k, (DIE.h - 2 * IO_RING) * k);
  if (detail > 0.5) {
    g.fillStyle = '#7d756a';
    for (let u = 0.3; u < DIE.w - 0.2; u += 0.32) {
      g.fillRect(X(u) - 0.06 * k, Yp(0.32) - 0.06 * k, 0.12 * k, 0.12 * k);
      g.fillRect(X(u) - 0.06 * k, Yp(DIE.h - 0.32) - 0.06 * k, 0.12 * k, 0.12 * k);
    }
    for (let v = 0.6; v < DIE.h - 0.4; v += 0.32) {
      g.fillRect(X(0.32) - 0.06 * k, Yp(v) - 0.06 * k, 0.12 * k, 0.12 * k);
      g.fillRect(X(DIE.w - 0.32) - 0.06 * k, Yp(v) - 0.06 * k, 0.12 * k, 0.12 * k);
    }
  }
  for (const f of FLOORPLAN) {
    const x0 = X(f.x0);
    const y0 = Yp(f.y1);
    const w = (f.x1 - f.x0) * k;
    const h = (f.y1 - f.y0) * k;
    g.fillStyle = KIND_COLOR[f.kind];
    g.fillRect(x0, y0, w, h);
    if (detail < 0.5) continue;
    if (f.kind === 'logic') {
      // standard-cell rows show as a fine horizontal grain; macros (register files, small SRAMs) as darker blocks
      g.globalAlpha = 0.28;
      g.fillStyle = '#6a6a5c';
      for (let yy = 0; yy < h; yy += Math.max(1.2, 0.035 * k)) g.fillRect(x0, y0 + yy, w, Math.max(0.5, 0.012 * k));
      g.globalAlpha = 1;
      const isGpu = f.id === 'gpu';
      if (isGpu) {
        // repeated identical compute units
        const nx = 6;
        const ny = 4;
        for (let a = 0; a < nx; a++)
          for (let b = 0; b < ny; b++) {
            const cx = x0 + (a + 0.08) * (w / nx);
            const cy = y0 + (b + 0.08) * (h / ny);
            g.strokeStyle = 'rgba(150,150,130,0.35)';
            g.lineWidth = Math.max(0.5, 0.02 * k);
            g.strokeRect(cx, cy, (w / nx) * 0.84, (h / ny) * 0.84);
            g.fillStyle = '#3a4255';
            g.fillRect(cx + (w / nx) * 0.56, cy + (h / ny) * 0.1, (w / nx) * 0.22, (h / ny) * 0.64);
          }
      } else {
        // core: an L1/L2 SRAM strip and a register-file macro
        g.fillStyle = '#3a4357';
        g.fillRect(x0 + w * 0.7, y0 + h * 0.08, w * 0.24, h * 0.84);
        g.fillStyle = '#41444a';
        g.fillRect(x0 + w * 0.1, y0 + h * 0.62, w * 0.28, h * 0.22);
      }
    } else if (f.kind === 'sram') {
      // banks of arrays with decoders and sense amplifiers between them
      const nb = Math.max(4, Math.round((f.x1 - f.x0) / 0.62));
      const nr = Math.max(2, Math.round((f.y1 - f.y0) / 0.75));
      for (let a = 0; a < nb; a++)
        for (let b = 0; b < nr; b++) {
          const bx = x0 + (a + 0.06) * (w / nb);
          const by = y0 + (b + 0.08) * (h / nr);
          const bw = (w / nb) * 0.88;
          const bh = (h / nr) * 0.8;
          g.fillStyle = '#4a5878';
          g.fillRect(bx, by, bw, bh);
          g.globalAlpha = 0.35;
          g.fillStyle = '#2c3346';
          for (let yy = 0; yy < bh; yy += Math.max(1, 0.03 * k)) g.fillRect(bx, by + yy, bw, Math.max(0.4, 0.008 * k));
          g.globalAlpha = 1;
        }
    } else {
      // analog: irregular blocks, a few inductor coils
      for (let n = 0; n < 9; n++) {
        g.fillStyle = r() < 0.5 ? '#564a58' : '#3f3846';
        g.fillRect(x0 + r() * w * 0.8, y0 + r() * h * 0.7, w * (0.06 + r() * 0.16), h * (0.1 + r() * 0.3));
      }
      g.strokeStyle = 'rgba(190,150,110,0.6)';
      g.lineWidth = Math.max(0.6, 0.025 * k);
      for (let n = 0; n < 3; n++) {
        const cx = x0 + w * (0.2 + 0.3 * n);
        const cy = y0 + h * 0.5;
        for (let s = 1; s <= 3; s++) g.strokeRect(cx - s * 0.06 * k, cy - s * 0.06 * k, s * 0.12 * k, s * 0.12 * k);
      }
    }
  }
  if (detail > 0.5) {
    // top-metal power straps across the whole die
    g.globalAlpha = 0.16;
    g.fillStyle = '#b9895c';
    for (let u = 0.9; u < DIE.w - 0.6; u += 0.6) g.fillRect(X(u), Yp(DIE.h - 0.6), 0.05 * k, (DIE.h - 1.2) * k);
    g.globalAlpha = 1;
  }
}

function dieTexture(): THREE.CanvasTexture {
  const k = 96; // px per mm → 1152 × 960
  const c = document.createElement('canvas');
  c.width = DIE.w * k;
  c.height = DIE.h * k;
  paintDie(c.getContext('2d')!, 0, 0, k, 1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function waferTexture(): THREE.CanvasTexture {
  const N = 2048;
  const R = WAFER.diameter / 2;
  const k = N / WAFER.diameter;
  const c = document.createElement('canvas');
  c.width = N;
  c.height = N;
  const g = c.getContext('2d')!;
  const cx = N / 2;
  const cy = N / 2;
  // polished silicon, slightly brighter towards the centre
  const grad = g.createRadialGradient(cx, cy, 0, cx, cy, N / 2);
  grad.addColorStop(0, '#6c7584');
  grad.addColorStop(0.9, '#5e6676');
  grad.addColorStop(1, '#515866');
  g.fillStyle = grad;
  g.fillRect(0, 0, N, N);
  // patterned area: scribe lines show as a lighter grid between the dies
  g.save();
  g.beginPath();
  g.arc(cx, cy, (R - 0.6) * k, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = '#80868f';
  for (const d of DIES) {
    const x = cx + (d.x - DIE.w / 2 - DIE.scribe) * k;
    const y = cy - (d.y + DIE.h / 2 + DIE.scribe) * k;
    g.fillRect(x, y, (DIE.w + 2 * DIE.scribe) * k, (DIE.h + 2 * DIE.scribe) * k);
  }
  // partial dies at the edge: printed, then cut by the circle
  for (const d of DIES) {
    if (d.full) continue;
    paintDie(g, cx + (d.x - DIE.w / 2) * k, cy - (d.y + DIE.h / 2) * k, k, 0);
    g.fillStyle = 'rgba(70,74,84,0.35)';
    g.fillRect(cx + (d.x - DIE.w / 2) * k, cy - (d.y + DIE.h / 2) * k, DIE.w * k, DIE.h * k);
  }
  g.restore();
  // edge bevel and the orientation notch
  g.strokeStyle = 'rgba(40,44,52,0.8)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(cx, cy, R * k - 1, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#070b13';
  g.beginPath();
  g.moveTo(cx - WAFER.notch * k, N - 1);
  g.lineTo(cx, N - 1 - WAFER.notch * k);
  g.lineTo(cx + WAFER.notch * k, N - 1);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const rectLine = (w: number, h: number) => {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-w / 2, 0, -h / 2), new THREE.Vector3(w / 2, 0, -h / 2), new THREE.Vector3(w / 2, 0, h / 2), new THREE.Vector3(-w / 2, 0, h / 2)]);
  return g;
};

export class WaferModel {
  readonly group = new THREE.Group();
  /** extra relief on the selected die (pads/bumps, power straps), shown at the die level */
  readonly dieDetail = new THREE.Group();
  private dies: THREE.InstancedMesh;
  private hoverLine: THREE.LineLoop;
  private selLine: THREE.LineLoop;
  private regionHover: THREE.LineLoop;
  private regionSel: THREE.LineLoop;
  private regionFill: THREE.Mesh;
  private textures: THREE.Texture[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];

  constructor() {
    const R = WAFER.diameter / 2;
    const wt = waferTexture();
    const dt = dieTexture();
    this.textures.push(wt, dt);
    // top face (patterned), side and bottom
    const top = new THREE.CircleGeometry(R, 256);
    top.rotateX(-Math.PI / 2);
    top.translate(0, W_TOP, 0);
    const topMat = new THREE.MeshPhysicalMaterial({ map: wt, metalness: 0.75, roughness: 0.2, clearcoat: 0.3, clearcoatRoughness: 0.15, iridescence: 0.3, iridescenceIOR: 1.45, iridescenceThicknessRange: [250, 700] });
    const side = new THREE.CylinderGeometry(R, R, WAFER.thickness, 256, 1, true);
    const sideMat = new THREE.MeshStandardMaterial({ color: '#7d8794', metalness: 0.7, roughness: 0.35 });
    const bottom = new THREE.CircleGeometry(R, 128);
    bottom.rotateX(Math.PI / 2);
    bottom.translate(0, -W_TOP, 0);
    const botMat = new THREE.MeshStandardMaterial({ color: '#5f6874', metalness: 0.4, roughness: 0.55 });
    const topM = new THREE.Mesh(top, topMat);
    topM.userData.part = 'wafer';
    this.group.add(topM, new THREE.Mesh(side, sideMat), new THREE.Mesh(bottom, botMat));
    this.geos.push(top, side, bottom);
    this.mats.push(topMat, sideMat, botMat);

    // complete dies: one instanced, textured plane per die
    const full = DIES.filter((d) => d.full);
    const plane = new THREE.PlaneGeometry(DIE.w, DIE.h);
    plane.rotateX(-Math.PI / 2);
    // patterned dies: the repeating structures act like a diffraction grating, a coloured sheen that changes with the angle
    const dieMat = new THREE.MeshPhysicalMaterial({ map: dt, metalness: 0.35, roughness: 0.3, clearcoat: 0.4, clearcoatRoughness: 0.16, iridescence: 0.7, iridescenceIOR: 1.5, iridescenceThicknessRange: [220, 620], polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    this.dies = new THREE.InstancedMesh(plane, dieMat, full.length);
    const m = new THREE.Matrix4();
    full.forEach((d, k) => {
      m.makeTranslation(d.x, W_TOP + 0.002, -d.y);
      this.dies.setMatrixAt(k, m);
    });
    this.dies.raycast = () => {};
    this.group.add(this.dies);
    this.geos.push(plane);
    this.mats.push(dieMat);

    // outlines for hover and selection
    const lineMat = (c: number, o: number) => {
      const mm = new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: o, depthTest: false });
      this.mats.push(mm);
      return mm;
    };
    const dieRect = rectLine(DIE.w + 0.1, DIE.h + 0.1);
    this.geos.push(dieRect);
    this.hoverLine = new THREE.LineLoop(dieRect, lineMat(0xffffff, 0.75));
    this.selLine = new THREE.LineLoop(dieRect, lineMat(0x3fe0ff, 1));
    const unit = rectLine(1, 1);
    this.geos.push(unit);
    this.regionHover = new THREE.LineLoop(unit, lineMat(0xffffff, 0.8));
    this.regionSel = new THREE.LineLoop(unit, lineMat(0x3fe0ff, 1));
    const fillGeo = new THREE.PlaneGeometry(1, 1);
    fillGeo.rotateX(-Math.PI / 2);
    this.geos.push(fillGeo);
    const fillMat = new THREE.MeshBasicMaterial({ color: 0x3fe0ff, transparent: true, opacity: 0.12, depthWrite: false });
    this.mats.push(fillMat);
    this.regionFill = new THREE.Mesh(fillGeo, fillMat);
    for (const o of [this.hoverLine, this.selLine, this.regionHover, this.regionSel, this.regionFill]) {
      o.visible = false;
      o.renderOrder = 5;
      this.group.add(o);
    }

    // die-level relief: micro-bumps over the I/O ring and the top-metal power straps (heights to scale: ~20 µm and ~3 µm)
    const bumpGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.02, 10);
    bumpGeo.translate(0, 0.01, 0);
    const bumpMat = new THREE.MeshStandardMaterial({ color: '#c8ccd2', metalness: 0.9, roughness: 0.25 });
    const pads: [number, number][] = [];
    for (let u = 0.3; u < DIE.w - 0.2; u += 0.32) pads.push([u, 0.32], [u, DIE.h - 0.32]);
    for (let v = 0.6; v < DIE.h - 0.4; v += 0.32) pads.push([0.32, v], [DIE.w - 0.32, v]);
    const bumps = new THREE.InstancedMesh(bumpGeo, bumpMat, pads.length);
    pads.forEach(([u, v], k) => bumps.setMatrixAt(k, m.makeTranslation(u - DIE.w / 2, 0, -(v - DIE.h / 2))));
    bumps.raycast = () => {};
    const strapGeo = new THREE.BoxGeometry(0.05, 0.003, DIE.h - 1.2);
    strapGeo.translate(0, 0.0015, 0);
    const strapMat = new THREE.MeshStandardMaterial({ color: '#c08655', metalness: 0.85, roughness: 0.3, transparent: true, opacity: 0.55 });
    const straps: number[] = [];
    for (let u = 0.9; u < DIE.w - 0.6; u += 0.6) straps.push(u);
    const strapMesh = new THREE.InstancedMesh(strapGeo, strapMat, straps.length);
    straps.forEach((u, k) => strapMesh.setMatrixAt(k, m.makeTranslation(u - DIE.w / 2 + 0.025, 0, 0)));
    strapMesh.raycast = () => {};
    this.dieDetail.add(bumps, strapMesh);
    this.dieDetail.visible = false;
    this.group.add(this.dieDetail);
    this.geos.push(bumpGeo, strapGeo);
    this.mats.push(bumpMat, strapMat);
  }

  /** Die under a wafer-plane point, partial or complete; null outside the wafer or in a scribe line. */
  dieAt(x: number, y: number): DieDef | 'scribe' | null {
    if (Math.hypot(x, y) > WAFER.diameter / 2) return null;
    for (const d of DIES) if (Math.abs(x - d.x) <= DIE.w / 2 && Math.abs(y - d.y) <= DIE.h / 2) return d;
    return 'scribe';
  }

  setDieOutline(which: 'hover' | 'sel', d: DieDef | null) {
    const l = which === 'hover' ? this.hoverLine : this.selLine;
    l.visible = !!d;
    if (d) l.position.set(d.x, W_TOP + 0.01, -d.y);
  }

  setRegionOutline(which: 'hover' | 'sel', d: DieDef | null, r: RegionDef | 'io' | null) {
    const l = which === 'hover' ? this.regionHover : this.regionSel;
    const show = !!d && !!r;
    l.visible = show;
    if (which === 'sel') this.regionFill.visible = show;
    if (!d || !r) return;
    const box = r === 'io' ? { x0: 0, y0: 0, x1: DIE.w, y1: DIE.h } : r;
    const cx = d.x - DIE.w / 2 + (box.x0 + box.x1) / 2;
    const cy = d.y - DIE.h / 2 + (box.y0 + box.y1) / 2;
    for (const o of which === 'hover' ? [l] : [l, this.regionFill]) {
      o.position.set(cx, W_TOP + 0.02, -cy);
      o.scale.set(box.x1 - box.x0, 1, box.y1 - box.y0);
    }
  }

  /** Put the die-level relief on a die (or hide it). */
  showDieDetail(d: DieDef | null) {
    this.dieDetail.visible = !!d;
    if (d) this.dieDetail.position.set(d.x, W_TOP + 0.002, -d.y);
  }

  dispose() {
    this.textures.forEach((t) => t.dispose());
    this.geos.forEach((g) => g.dispose());
    this.mats.forEach((m) => m.dispose());
    this.dies.dispose();
  }
}
