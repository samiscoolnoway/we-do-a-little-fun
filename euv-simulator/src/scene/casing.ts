import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Registry } from './registry';
import { FrameCtx, SimModule } from './timing';
import { clamp, smoothstep } from './util';

/**
 * Exterior enclosure of the machine: modular cabinets with doors, seams, fasteners, vents, inspection windows,
 * identification and warning plates, utilities on top and an operator console. Inspired by publicly shown EUV
 * systems; layout, proportions and markings are illustrative, not a real design.
 *
 * Each cabinet is registered as its own pickable id (`cab-…`) so hovering highlights one cabinet, and all of them
 * together form the `enclosure` component used for isolation. Opening the machine slides the panels outwards and
 * fades them; a fully open casing is hidden so it costs nothing to draw.
 */

export interface CabinetDef {
  key: string;
  /** what clicking the cabinet opens: a subsystem or a component id */
  target: string;
  name: string;
  code: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  zd: number; // half depth
  window?: { x0: number; x1: number; y0: number; y1: number };
  warn?: 'laser' | 'hv' | 'vacuum' | 'moving' | 'chem';
  vents?: boolean;
  separate?: boolean;
  console?: boolean;
}

export const CABINETS: CabinetDef[] = [
  { key: 'laser', target: 'co2Laser', name: 'DRIVE LASER', code: 'S0 · CO₂ 10.6 µm', x0: -20.2, x1: -13.0, y0: -5.6, y1: 6.2, zd: 4.6, warn: 'laser', vents: true },
  { key: 'source', target: 'sys-source', name: 'EUV SOURCE', code: 'S1 · 13.5 nm', x0: -13.0, x1: -0.2, y0: -5.6, y1: 10.4, zd: 4.6, warn: 'hv', vents: true, window: { x0: -9.6, x1: -4.4, y0: 1.2, y1: 5.2 } },
  { key: 'illum', target: 'sys-illum', name: 'ILLUMINATOR', code: 'IL · reflective', x0: -0.2, x1: 14.2, y0: -5.6, y1: 9.2, zd: 4.6, vents: true, window: { x0: 2.0, x1: 10.6, y0: 2.4, y1: 6.4 } },
  { key: 'reticle', target: 'sys-reticle', name: 'RETICLE STAGE', code: 'RS · 4× scan', x0: 14.2, x1: 28.2, y0: 12.9, y1: 17.9, zd: 4.8, warn: 'moving' },
  { key: 'po', target: 'sys-projection', name: 'PROJECTION OPTICS', code: 'PO · NA 0.33', x0: 14.2, x1: 28.2, y0: 1.5, y1: 12.9, zd: 4.8, warn: 'vacuum', window: { x0: 17.0, x1: 25.8, y0: 4.0, y1: 10.6 } },
  { key: 'wafer', target: 'sys-wafer', name: 'WAFER STAGE', code: 'WS · 300 mm', x0: 14.2, x1: 33.6, y0: -5.6, y1: 1.5, zd: 4.8, warn: 'moving', vents: true, console: true },
  { key: 'handler', target: 'sys-wafer', name: 'WAFER HANDLER', code: 'WH · load lock', x0: 30.2, x1: 33.6, y0: -12.3, y1: -5.6, zd: 3.0 },
  { key: 'track', target: 'sys-down', name: 'TRACK · BAKE / DEVELOP', code: 'separate machine', x0: 5.0, x1: 29.0, y0: -20.7, y1: -12.3, zd: 3.6, warn: 'chem', vents: true, separate: true },
  { key: 'etch', target: 'etcher', name: 'ETCH TOOL', code: 'separate machine', x0: -8.0, x1: 2.0, y0: -20.7, y1: -12.3, zd: 3.6, warn: 'hv', vents: true, separate: true },
];
export const CABINET_BY_ID: Record<string, CabinetDef> = Object.fromEntries(CABINETS.map((c) => [`cab-${c.key}`, c]));

// ───────── materials and canvas textures ─────────
const paint = () => new THREE.MeshStandardMaterial({ color: 0xd9dee6, roughness: 0.52, metalness: 0.12 });
const paintDark = () => new THREE.MeshStandardMaterial({ color: 0xb9c0cb, roughness: 0.6, metalness: 0.12 });
const graphite = () => new THREE.MeshStandardMaterial({ color: 0x2b313b, roughness: 0.62, metalness: 0.35 });
const brushed = () => new THREE.MeshStandardMaterial({ color: 0xb7c0cd, roughness: 0.3, metalness: 0.92 });

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const FONT = '"Barlow Semi Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';

function ventTexture() {
  const t = canvasTex(256, 256, (g) => {
    g.fillStyle = '#c9cfd8';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#3a414d';
    for (let y = 14; y < 250; y += 18)
      for (let x = 14; x < 250; x += 58) {
        g.beginPath();
        g.roundRect(x, y, 46, 7, 3.5);
        g.fill();
      }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function plateTexture(name: string, code: string, separate: boolean) {
  return canvasTex(768, 192, (g) => {
    g.fillStyle = '#20252e';
    g.beginPath();
    g.roundRect(0, 0, 768, 192, 18);
    g.fill();
    g.fillStyle = separate ? '#e0b050' : '#3fd0f0';
    g.fillRect(28, 34, 10, 124);
    g.fillStyle = '#eef2f7';
    g.font = `600 64px ${FONT}`;
    g.textBaseline = 'alphabetic';
    g.fillText(name, 64, 98, 680);
    g.fillStyle = '#9aa8bd';
    g.font = `500 34px ${FONT}`;
    g.fillText(code.toUpperCase(), 64, 150, 470);
    g.font = `500 22px ${FONT}`;
    g.fillStyle = '#6f7d93';
    g.textAlign = 'right';
    g.fillText('EDUCATIONAL MODEL', 740, 150);
  });
}

const WARN_TEXT: Record<NonNullable<CabinetDef['warn']>, [string, string]> = {
  laser: ['LASER RADIATION', 'invisible infrared · class 4'],
  hv: ['HIGH VOLTAGE', 'interlocked service doors'],
  vacuum: ['VACUUM SYSTEM', 'do not open under vacuum'],
  moving: ['MOVING PARTS', 'stage area · keep clear'],
  chem: ['CHEMICALS', 'developer and solvents'],
};

function warnTexture(kind: NonNullable<CabinetDef['warn']>) {
  return canvasTex(512, 160, (g) => {
    g.fillStyle = '#f2c230';
    g.beginPath();
    g.roundRect(0, 0, 512, 160, 12);
    g.fill();
    g.fillStyle = '#16181c';
    g.beginPath();
    g.roundRect(6, 6, 500, 148, 9);
    g.fill();
    g.fillStyle = '#f2c230';
    // triangle with symbol
    g.beginPath();
    g.moveTo(80, 22);
    g.lineTo(140, 132);
    g.lineTo(20, 132);
    g.closePath();
    g.fill();
    g.fillStyle = '#16181c';
    g.strokeStyle = '#16181c';
    g.lineWidth = 6;
    if (kind === 'laser') {
      g.beginPath();
      g.arc(80, 98, 9, 0, Math.PI * 2);
      g.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.beginPath();
        g.moveTo(80 + Math.cos(a) * 15, 98 + Math.sin(a) * 15);
        g.lineTo(80 + Math.cos(a) * 25, 98 + Math.sin(a) * 25);
        g.stroke();
      }
    } else if (kind === 'hv') {
      g.beginPath();
      g.moveTo(86, 56);
      g.lineTo(68, 100);
      g.lineTo(82, 100);
      g.lineTo(72, 126);
      g.lineTo(96, 88);
      g.lineTo(82, 88);
      g.closePath();
      g.fill();
    } else {
      g.fillRect(75, 60, 10, 42);
      g.fillRect(75, 110, 10, 10);
    }
    g.fillStyle = '#f2c230';
    g.font = `700 44px ${FONT}`;
    g.fillText(WARN_TEXT[kind][0], 162, 74, 330);
    g.fillStyle = '#d7dbe2';
    g.font = `500 28px ${FONT}`;
    g.fillText(WARN_TEXT[kind][1], 162, 118, 330);
  });
}

function screenTexture() {
  return canvasTex(512, 320, (g) => {
    g.fillStyle = '#0b1424';
    g.fillRect(0, 0, 512, 320);
    g.fillStyle = '#3fd0f0';
    g.font = `600 30px ${FONT}`;
    g.fillText('EXPOSURE · LOT 01', 26, 48);
    g.fillStyle = '#1d3350';
    for (let i = 0; i < 6; i++) g.fillRect(26, 74 + i * 34, 300, 20);
    g.fillStyle = '#3fd0f0';
    for (let i = 0; i < 6; i++) g.fillRect(26, 74 + i * 34, 60 + ((i * 97) % 230), 20);
    g.strokeStyle = '#7bd88f';
    g.lineWidth = 4;
    g.strokeRect(360, 74, 120, 120);
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      g.moveTo(360, 74 + i * 20);
      g.lineTo(480, 74 + i * 20);
    }
    g.stroke();
    g.fillStyle = '#7bd88f';
    g.font = `500 24px ${FONT}`;
    g.fillText('STATUS: SIMULATION', 26, 296);
  });
}

// ───────── geometry helpers ─────────
const rbox = (w: number, h: number, d: number, r = 0.05) => new RoundedBoxGeometry(Math.max(w, 0.02), Math.max(h, 0.02), Math.max(d, 0.02), 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2));
const at = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => geo.translate(x, y, z);
function mergedMesh(geos: THREE.BufferGeometry[], mat: THREE.Material) {
  const clean = geos.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
    return n;
  });
  return new THREE.Mesh(mergeGeometries(clean, false)!, mat);
}

interface AnimPart {
  obj: THREE.Object3D;
  dir: THREE.Vector3;
  base: THREE.Vector3;
  delay: number;
}

export class CasingModule implements SimModule {
  group = new THREE.Group();
  private parts: AnimPart[] = [];
  private k = 0; // 0 = closed, 1 = open
  private mats: THREE.Material[] | null = null;
  private wasTransparent = false;

  constructor(reg: Registry) {
    const g = this.group;
    const vent = ventTexture();
    const cabRoots: THREE.Group[] = [];
    CABINETS.forEach((c, idx) => {
      const root = this.buildCabinet(c, idx, vent);
      root.traverse((o) => (o.userData.cab = `cab-${c.key}`));
      g.add(root);
      cabRoots.push(root);
    });
    g.add(this.buildUtilities());
    // the whole casing is one component for isolation; each cabinet is its own pick/highlight target
    for (const r of cabRoots) reg.register('enclosure', r, { priority: 0.4, emph: false });
    reg.register('enclosure', this.utilities!, { priority: 0.4, emph: false });
    cabRoots.forEach((r, i) => reg.register(`cab-${CABINETS[i].key}`, r, { priority: 0.4 }));
  }

  private utilities: THREE.Group | null = null;

  private buildCabinet(c: CabinetDef, idx: number, vent: THREE.Texture): THREE.Group {
    const root = new THREE.Group();
    const w = c.x1 - c.x0;
    const h = c.y1 - c.y0;
    const cx = (c.x0 + c.x1) / 2;
    const zf = c.zd; // front plane
    const delay = idx * 0.045;
    const add = (obj: THREE.Object3D, dir: [number, number, number]) => {
      root.add(obj);
      this.parts.push({ obj, dir: new THREE.Vector3(...dir), base: obj.position.clone(), delay });
    };

    // ── front: doors on a grid, lower vent row, seams are the gaps between doors ──
    const skirtH = 0.5;
    const ventH = c.vents ? Math.min(1.6, h * 0.22) : 0;
    const gap = 0.07;
    const doorGeos: THREE.BufferGeometry[] = [];
    const handleGeos: THREE.BufferGeometry[] = [];
    const ventGeos: THREE.BufferGeometry[] = [];
    const glassGeos: THREE.BufferGeometry[] = [];
    const boltPos: THREE.Vector3[] = [];
    const nCols = Math.max(1, Math.round(w / 4.4));
    const rows: [number, number][] = [];
    const yTop = c.y1 - 0.25;
    const yBot = c.y0 + skirtH;
    if (ventH) rows.push([yBot, yBot + ventH]);
    const yMid = ventH ? yBot + ventH : yBot;
    if (yTop - yMid > 6.5) {
      const split = yMid + (yTop - yMid) * 0.45;
      rows.push([yMid, split], [split, yTop]);
    } else rows.push([yMid, yTop]);
    rows.forEach(([ya, yb], ri) => {
      const isVent = ventH > 0 && ri === 0;
      for (let ci = 0; ci < nCols; ci++) {
        const xa = c.x0 + 0.12 + (ci * (w - 0.24)) / nCols;
        const xb = c.x0 + 0.12 + ((ci + 1) * (w - 0.24)) / nCols;
        const dw = xb - xa - gap;
        const dh = yb - ya - gap;
        const dx = (xa + xb) / 2;
        const dy = (ya + yb) / 2;
        const win = c.window && !isVent && c.window.x0 < xb && c.window.x1 > xa && c.window.y0 < yb && c.window.y1 > ya ? c.window : null;
        if (isVent) {
          doorGeos.push(at(rbox(dw, dh, 0.12, 0.04), dx, dy, zf - 0.06));
          ventGeos.push(at(new THREE.PlaneGeometry(dw - 0.3, dh - 0.3), dx, dy, zf + 0.004));
        } else if (win) {
          // door with an inspection window: frame around a glass pane
          const wx0 = Math.max(win.x0, xa + 0.3);
          const wx1 = Math.min(win.x1, xb - 0.3);
          const wy0 = Math.max(win.y0, ya + 0.3);
          const wy1 = Math.min(win.y1, yb - 0.3);
          const parts: [number, number, number, number][] = [
            [xa + gap / 2, wy1, xb - gap / 2, yb - gap / 2],
            [xa + gap / 2, ya + gap / 2, xb - gap / 2, wy0],
            [xa + gap / 2, wy0, wx0, wy1],
            [wx1, wy0, xb - gap / 2, wy1],
          ];
          for (const [p0, q0, p1, q1] of parts) if (p1 - p0 > 0.03 && q1 - q0 > 0.03) doorGeos.push(at(rbox(p1 - p0, q1 - q0, 0.12, 0.03), (p0 + p1) / 2, (q0 + q1) / 2, zf - 0.06));
          const fw = 0.09;
          handleGeos.push(
            at(new THREE.BoxGeometry(wx1 - wx0 + fw * 2, fw, 0.16), (wx0 + wx1) / 2, wy1 + fw / 2, zf - 0.04),
            at(new THREE.BoxGeometry(wx1 - wx0 + fw * 2, fw, 0.16), (wx0 + wx1) / 2, wy0 - fw / 2, zf - 0.04),
            at(new THREE.BoxGeometry(fw, wy1 - wy0, 0.16), wx0 - fw / 2, (wy0 + wy1) / 2, zf - 0.04),
            at(new THREE.BoxGeometry(fw, wy1 - wy0, 0.16), wx1 + fw / 2, (wy0 + wy1) / 2, zf - 0.04),
          );
          glassGeos.push(at(new THREE.PlaneGeometry(wx1 - wx0, wy1 - wy0), (wx0 + wx1) / 2, (wy0 + wy1) / 2, zf - 0.07));
        } else {
          doorGeos.push(at(rbox(dw, dh, 0.14, 0.05), dx, dy, zf - 0.07));
          // vertical handle near the opening edge
          if (dh > 1.6) handleGeos.push(at(rbox(0.09, Math.min(1.3, dh * 0.3), 0.12, 0.04), ci % 2 ? xa + 0.32 : xb - 0.32, dy, zf + 0.06));
        }
        // fasteners at the door corners
        for (const [bx, by] of [
          [xa + 0.2, ya + 0.2],
          [xb - 0.2, ya + 0.2],
          [xa + 0.2, yb - 0.2],
          [xb - 0.2, yb - 0.2],
        ])
          boltPos.push(new THREE.Vector3(bx, by, zf + 0.01));
      }
    });
    const doors = mergedMesh(doorGeos, c.separate ? paintDark() : paint());
    add(doors, [0, 0.6, 3.4]);
    if (handleGeos.length) add(mergedMesh(handleGeos, brushed()), [0, 0.6, 3.4]);
    if (ventGeos.length) {
      const vm = new THREE.MeshStandardMaterial({ map: vent, roughness: 0.7, metalness: 0.2 });
      add(mergedMesh(ventGeos, vm), [0, 0.6, 3.4]);
    }
    if (glassGeos.length) {
      const gm = new THREE.MeshPhysicalMaterial({ color: 0x9fc3e8, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, envMapIntensity: 1.4 });
      gm.userData.noEmph = true;
      gm.userData.glass = true;
      const glassMesh = mergedMesh(glassGeos, gm);
      add(glassMesh, [0, 0.6, 3.4]);
    }
    // bolts
    const boltGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.05, 10).rotateX(Math.PI / 2);
    const bolts = new THREE.InstancedMesh(boltGeo, brushed(), boltPos.length);
    const m4 = new THREE.Matrix4();
    boltPos.forEach((p, i) => bolts.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z)));
    add(bolts, [0, 0.6, 3.4]);

    // ── skirt with a hazard stripe and an accent line under the roof ──
    const skirt = new THREE.Mesh(rbox(w - 0.1, skirtH, 0.2, 0.03), graphite());
    skirt.position.set(cx, c.y0 + skirtH / 2, zf - 0.16);
    add(skirt, [0, 0, 3.0]);
    const accent = new THREE.Mesh(new THREE.BoxGeometry(w - 0.3, 0.05, 0.04), new THREE.MeshStandardMaterial({ color: 0x0e2230, emissive: c.separate ? 0xe0b050 : 0x3fd0f0, emissiveIntensity: 0.7, roughness: 0.4 }));
    (accent.material as THREE.MeshStandardMaterial).userData.noEmph = true;
    accent.position.set(cx, c.y1 - 0.13, zf + 0.02);
    add(accent, [0, 0.8, 3.4]);

    // ── roof, sides and back ──
    const roof = new THREE.Mesh(rbox(w + 0.06, 0.24, c.zd * 2 + 0.06, 0.06), graphite());
    roof.position.set(cx, c.y1 + 0.1, 0);
    add(roof, [0, 3.2, 0]);
    const sideGeo = () => rbox(0.14, h, c.zd * 2, 0.05);
    const sideL = new THREE.Mesh(sideGeo(), paint());
    sideL.position.set(c.x0 + 0.07, (c.y0 + c.y1) / 2, 0);
    add(sideL, [-3.2, 0, 0]);
    const sideR = new THREE.Mesh(sideGeo(), paint());
    sideR.position.set(c.x1 - 0.07, (c.y0 + c.y1) / 2, 0);
    add(sideR, [3.2, 0, 0]);
    const back = new THREE.Mesh(rbox(w, h, 0.14, 0.05), paintDark());
    back.position.set(cx, (c.y0 + c.y1) / 2, -c.zd + 0.07);
    add(back, [0, 0, -3.2]);

    // ── identification plate and warning label ──
    const plateW = Math.min(4.6, w * 0.62);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(plateW, plateW / 4), new THREE.MeshStandardMaterial({ map: plateTexture(c.name, c.code, !!c.separate), roughness: 0.5, metalness: 0.2 }));
    plate.position.set(c.x0 + 0.5 + plateW / 2, c.y1 - 0.62 - plateW / 8, zf + 0.012);
    if (h < 6) plate.position.y = c.y1 - 0.45 - plateW / 8;
    add(plate, [0, 0.6, 3.4]);
    if (c.warn) {
      const ww = 1.7;
      const warn = new THREE.Mesh(new THREE.PlaneGeometry(ww, ww * 0.3125), new THREE.MeshStandardMaterial({ map: warnTexture(c.warn), roughness: 0.55 }));
      warn.position.set(c.x1 - 0.55 - ww / 2, plate.position.y, zf + 0.012);
      add(warn, [0, 0.6, 3.4]);
    }
    if (c.console) {
      // operator console: angled screen on a short arm
      const con = new THREE.Group();
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.0, 0.2), brushed());
      arm.position.set(0, -0.6, 0);
      const housing = new THREE.Mesh(rbox(2.2, 1.45, 0.16, 0.05), graphite());
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.95, 1.2), new THREE.MeshBasicMaterial({ map: screenTexture(), toneMapped: false }));
      screen.position.z = 0.085;
      con.add(arm, housing, screen);
      con.rotation.x = -0.35;
      con.position.set(c.x1 - 2.0, c.y0 + 3.6, zf + 0.55);
      add(con, [0, 0.6, 3.6]);
    }
    return root;
  }

  /** Utilities across the roofs: coolant pipes, a cable tray, an exhaust duct, a status light tower and a side utility panel. */
  private buildUtilities(): THREE.Group {
    const u = new THREE.Group();
    const add = (obj: THREE.Object3D, dir: [number, number, number]) => {
      u.add(obj);
      this.parts.push({ obj, dir: new THREE.Vector3(...dir), base: obj.position.clone(), delay: 0.2 });
    };
    const pipeMat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.5 });
    // roof pipes over source + illuminator, stepping down from the taller cabinets
    const run = (pts: [number, number, number][], r: number, mat: THREE.Material) => {
      const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0.05);
      return new THREE.Mesh(new THREE.TubeGeometry(curve, 96, r, 10, false), mat);
    };
    const pipes = new THREE.Group();
    pipes.add(
      run([[-19.6, 6.5, -3.4], [-13.2, 6.5, -3.4], [-12.8, 10.75, -3.4], [-0.6, 10.75, -3.4], [-0.2, 9.55, -3.4], [13.8, 9.55, -3.4], [14.2, 18.25, -3.4], [27.6, 18.25, -3.4]], 0.13, pipeMat(0x3a6fb0)),
      run([[-19.6, 6.5, -2.9], [-13.2, 6.5, -2.9], [-12.8, 10.75, -2.9], [-0.6, 10.75, -2.9], [-0.2, 9.55, -2.9], [13.8, 9.55, -2.9], [14.2, 18.25, -2.9], [27.6, 18.25, -2.9]], 0.13, pipeMat(0x9a4a4a)),
    );
    add(pipes, [0, 3.4, -1]);
    // cable tray on the roof
    const trayGeos: THREE.BufferGeometry[] = [];
    for (const [x0, x1, y] of [
      [-12.6, -0.6, 10.62],
      [0.2, 13.8, 9.42],
      [14.6, 27.8, 18.12],
    ]) {
      trayGeos.push(at(new THREE.BoxGeometry(x1 - x0, 0.06, 1.1), (x0 + x1) / 2, y, 1.4), at(new THREE.BoxGeometry(x1 - x0, 0.3, 0.05), (x0 + x1) / 2, y + 0.15, 0.85), at(new THREE.BoxGeometry(x1 - x0, 0.3, 0.05), (x0 + x1) / 2, y + 0.15, 1.95));
    }
    add(mergedMesh(trayGeos, brushed()), [0, 3.4, 0]);
    // exhaust duct with flanges rising from the source roof
    const duct = new THREE.Group();
    const dm = brushed();
    const d1 = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 2.4, 24), dm);
    d1.position.set(-7.6, 11.7, -1.6);
    const f1 = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.12, 24), dm);
    f1.position.set(-7.6, 10.62, -1.6);
    const f2 = f1.clone();
    f2.position.y = 12.1;
    duct.add(d1, f1, f2);
    add(duct, [0, 3.6, 0]);
    // status light tower
    const tower = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 10), dm);
    pole.position.y = 0.3;
    tower.add(pole);
    [0x2fd36f, 0xe0b050, 0xe0484a].forEach((col, i) => {
      const on = i === 0;
      const m = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: on ? 1.6 : 0.08, roughness: 0.3, transparent: true, opacity: 0.92 });
      m.userData.noEmph = true;
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.26, 16), m);
      seg.position.y = 0.75 + i * 0.28;
      tower.add(seg);
    });
    tower.position.set(-1.3, 10.52, 3.4);
    add(tower, [0, 3.6, 0]);
    // utility interface on the left side of the laser cabinet: hoses and cables into the floor
    const side = new THREE.Group();
    const box = new THREE.Mesh(rbox(0.5, 3.2, 2.6, 0.06), graphite());
    box.position.set(-20.45, -2.6, 0.8);
    side.add(box);
    [0x3a6fb0, 0x9a4a4a, 0x59647a, 0x59647a].forEach((col, i) => {
      const hose = run(
        [
          [-20.7, -1.6 - i * 0.5, 0 + i * 0.5],
          [-21.3, -2.2 - i * 0.5, 0 + i * 0.5],
          [-21.4, -5.6, 0 + i * 0.5],
        ],
        i < 2 ? 0.11 : 0.07,
        pipeMat(col),
      );
      side.add(hose);
    });
    add(side, [-3.2, 0, 0]);
    this.utilities = u;
    return u;
  }

  update(c: FrameCtx) {
    const forceClosed = c.inspect === 'enclosure';
    const target = c.casingOpen && !forceClosed ? 1 : 0;
    // full open/close in about 1.6 s, independent of frame rate
    const step = c.dt / 1.6;
    this.k = clamp(this.k + Math.sign(target - this.k) * step, 0, 1);
    if (Math.abs(target - this.k) < step || this.snapNext) this.k = target;
    this.snapNext = false;
    const k = this.k;
    this.group.visible = k < 0.999;
    if (!this.group.visible) return;
    for (const p of this.parts) {
      const kk = smoothstep(p.delay, p.delay + 0.75, k);
      p.obj.position.copy(p.base).addScaledVector(p.dir, kk);
    }
    // fade: materials go transparent only while moving, so the closed casing renders opaque and sorts correctly
    const mats = this.materials();
    const fade = 1 - smoothstep(0.25, 0.95, k);
    const moving = k > 0.001;
    if (moving !== this.wasTransparent) {
      for (const m of mats) {
        if (m.userData.glass) continue;
        m.transparent = moving;
        m.depthWrite = !moving;
        m.needsUpdate = true;
      }
      this.wasTransparent = moving;
    }
    for (const m of mats) m.opacity = (m.userData.baseOpacity ?? 1) * fade;
  }

  private materials(): THREE.Material[] {
    if (!this.mats) {
      const set = new Set<THREE.Material>();
      this.group.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (m) (Array.isArray(m) ? m : [m]).forEach((x) => set.add(x));
      });
      this.mats = [...set];
      for (const m of this.mats) m.userData.baseOpacity = m.opacity;
    }
    return this.mats;
  }

  /** Run `fn` with the casing in its see-through (moving) state, so that shader variant is compiled up front
   *  instead of stalling the first frame of the opening animation. */
  withTransparent(fn: () => void) {
    const mats = this.materials().filter((m) => !m.userData.glass);
    const set = (on: boolean) =>
      mats.forEach((m) => {
        m.transparent = on;
        m.depthWrite = !on;
        m.needsUpdate = true;
      });
    set(true);
    try {
      fn();
    } finally {
      set(this.wasTransparent);
    }
  }

  /** finish a running open/close on the next frame (tests settle the scene this way) */
  snapNext = false;

  /** 0 = closed, 1 = open (for tests and the controller). */
  get openness() {
    return this.k;
  }
}
