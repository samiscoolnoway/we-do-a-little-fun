import * as THREE from 'three';

export const COLOR = {
  laser: 0xff4d4f,
  plasma: 0xe56bff,
  euv: 0x3fe0ff,
  mask: 0x9c8cff,
  silicon: 0x8196bd,
  resist: 0xf0a832,
  tin: 0xd9dee8,
  track: 0x4fd1c5,
  etch: 0x7bd88f,
  steel: 0x9aa6b8,
  zone: 0x8fb4ff,
} as const;

// ───────────── materials ─────────────
export const steel = (color = 0x9aa6b8, rough = 0.34, metal = 0.9) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, envMapIntensity: 1 });
export const darkSteel = (color = 0x2b3342, rough = 0.46, metal = 0.82) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, envMapIntensity: 0.8 });
export const glass = (color = 0x7fb0ff, opacity = 0.07) =>
  new THREE.MeshPhysicalMaterial({
    color,
    transparent: true,
    opacity,
    roughness: 0.08,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    envMapIntensity: 0.6,
  });
export const glowMat = (color: number, opacity = 1) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
export const flat = (color: number, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, toneMapped: false });

/** Metal that glows with the emissive colour when the component is emphasised. */
export const emissiveSteel = (color: number, emissive: number, ei = 1, rough = 0.4, metal = 0.6) => {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive, emissiveIntensity: ei });
  m.userData.noEmph = true;
  return m;
};

// ───────────── procedural textures ─────────────
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

let _glow: THREE.Texture | null = null;
export function glowTexture() {
  if (_glow) return _glow;
  _glow = canvasTex(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.12, 'rgba(255,255,255,0.75)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.22)');
    gr.addColorStop(0.7, 'rgba(255,255,255,0.05)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
  }, false);
  return _glow;
}
let _ring: THREE.Texture | null = null;
export function ringTexture() {
  if (_ring) return _ring;
  _ring = canvasTex(256, 256, (g) => {
    const gr = g.createRadialGradient(128, 128, 90, 128, 128, 126);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.55, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.7, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
  }, false);
  return _ring;
}
let _dot: THREE.Texture | null = null;
export function dotTexture() {
  if (_dot) return _dot;
  _dot = canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.45, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.62, 'rgba(255,255,255,0.25)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  }, false);
  return _dot;
}

/** Simple circuit-like layout. Dark = absorber, bright = multilayer mirror. */
export function circuitCanvasDraw(g: CanvasRenderingContext2D, S: number, bright: string, dark: string, frame = true) {
  const u = S / 512;
  g.fillStyle = bright;
  g.fillRect(0, 0, S, S);
  g.fillStyle = dark;
  g.strokeStyle = dark;
  const R = (x: number, y: number, w: number, h: number) => g.fillRect(x * u, y * u, w * u, h * u);
  if (frame) {
    R(0, 0, 512, 18);
    R(0, 494, 512, 18);
    R(0, 0, 18, 512);
    R(494, 0, 18, 512);
  }
  // dense line/space block
  for (let i = 0; i < 7; i++) R(46, 48 + i * 30, 190, 14);
  // comb structure
  R(290, 48, 170, 14);
  for (let i = 0; i < 6; i++) R(290 + i * 32, 62, 14, 80);
  // L shapes + pad
  R(46, 280, 14, 90);
  R(46, 356, 80, 14);
  R(150, 280, 14, 90);
  R(150, 280, 70, 14);
  R(236, 280, 40, 40);
  // serpentine route
  g.lineWidth = 14 * u;
  g.lineJoin = 'miter';
  g.lineCap = 'butt';
  g.beginPath();
  g.moveTo(300 * u, 210 * u);
  g.lineTo(460 * u, 210 * u);
  g.lineTo(460 * u, 250 * u);
  g.lineTo(300 * u, 250 * u);
  g.lineTo(300 * u, 290 * u);
  g.lineTo(460 * u, 290 * u);
  g.lineTo(460 * u, 330 * u);
  g.lineTo(330 * u, 330 * u);
  g.stroke();
  // contact holes
  for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) R(60 + i * 34, 410 + j * 20, 14, 10);
  // vias and pads
  for (let i = 0; i < 4; i++) R(320 + i * 40, 400, 22, 22);
  g.lineWidth = 12 * u;
  g.strokeRect(330 * u, 436 * u, 126 * u, 44 * u);
  R(46, 214, 150, 14);
  R(46, 214, 14, 44);
  R(182, 214, 14, 44);
}

export function circuitTexture(bright = '#7f93d4', dark = '#10131b', size = 512) {
  return canvasTex(size, size, (g) => {
    circuitCanvasDraw(g, size, bright, dark);
    // subtle multilayer sheen on bright regions
    const gr = g.createLinearGradient(0, 0, size, size);
    gr.addColorStop(0, 'rgba(255,255,255,0.18)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0)');
    gr.addColorStop(1, 'rgba(120,180,255,0.16)');
    g.globalCompositeOperation = 'screen';
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    g.globalCompositeOperation = 'source-over';
  });
}

export function waferTexture() {
  return canvasTex(512, 512, (g) => {
    const gr = g.createRadialGradient(256, 256, 20, 256, 256, 256);
    gr.addColorStop(0, '#6a7aa0');
    gr.addColorStop(0.7, '#4c5a80');
    gr.addColorStop(1, '#3b4767');
    g.fillStyle = gr;
    g.fillRect(0, 0, 512, 512);
    g.strokeStyle = 'rgba(170,190,235,0.28)';
    g.lineWidth = 1.2;
    const step = 512 / 14;
    for (let i = 0; i <= 14; i++) {
      g.beginPath();
      g.moveTo(i * step, 0);
      g.lineTo(i * step, 512);
      g.stroke();
      g.beginPath();
      g.moveTo(0, i * step);
      g.lineTo(512, i * step);
      g.stroke();
    }
    // notch
    g.fillStyle = '#1b2236';
    g.beginPath();
    g.arc(256, 508, 9, 0, Math.PI * 2);
    g.fill();
  });
}

export function hotplateTexture() {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#2a2120';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#ff9a3c';
    g.lineWidth = 5;
    for (let r = 20; r < 125; r += 17) {
      g.beginPath();
      g.arc(128, 128, r, 0, Math.PI * 2);
      g.stroke();
    }
  });
}

export function backdropTexture() {
  return canvasTex(1024, 1024, (g) => {
    const gr = g.createRadialGradient(512, 460, 80, 512, 512, 760);
    gr.addColorStop(0, '#16213a');
    gr.addColorStop(0.55, '#0d1424');
    gr.addColorStop(1, '#070b13');
    g.fillStyle = gr;
    g.fillRect(0, 0, 1024, 1024);
    g.strokeStyle = 'rgba(120,150,210,0.07)';
    g.lineWidth = 1;
    for (let i = 0; i <= 64; i++) {
      const p = (i / 64) * 1024;
      g.beginPath();
      g.moveTo(p, 0);
      g.lineTo(p, 1024);
      g.stroke();
      g.beginPath();
      g.moveTo(0, p);
      g.lineTo(1024, p);
      g.stroke();
    }
    g.strokeStyle = 'rgba(120,150,210,0.13)';
    for (let i = 0; i <= 8; i++) {
      const p = (i / 8) * 1024;
      g.beginPath();
      g.moveTo(p, 0);
      g.lineTo(p, 1024);
      g.stroke();
      g.beginPath();
      g.moveTo(0, p);
      g.lineTo(1024, p);
      g.stroke();
    }
  });
}

// ───────────── glow sprite ─────────────
export function glowSprite(color: number, scale: number, opacity = 1, tex: THREE.Texture = glowTexture()) {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  s.scale.setScalar(scale);
  s.raycast = () => {};
  return s;
}

// ───────────── instanced segment pool (beams, photon packets) ─────────────
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);

export class SegPool {
  mesh: THREE.InstancedMesh;
  n = 0;
  private cap: number;
  private colors: Float32Array;
  constructor(cap: number, radial = 6, opacity = 1) {
    this.cap = cap;
    const geo = new THREE.CylinderGeometry(1, 1, 1, radial, 1, false);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.raycast = () => {};
    this.mesh.userData.beam = true;
    this.colors = new Float32Array(cap * 3);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(this.colors, 3);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
  begin() {
    this.n = 0;
  }
  add(a: THREE.Vector3, b: THREE.Vector3, radius: number, color: THREE.Color, k = 1) {
    if (this.n >= this.cap || k <= 0.002) return;
    _dir.subVectors(b, a);
    const len = _dir.length();
    if (len < 1e-5) return;
    _dir.multiplyScalar(1 / len);
    _mid.addVectors(a, b).multiplyScalar(0.5);
    _q.setFromUnitVectors(_up, _dir);
    _s.set(radius, len, radius);
    _m.compose(_mid, _q, _s);
    this.mesh.setMatrixAt(this.n, _m);
    const i = this.n * 3;
    this.colors[i] = color.r * k;
    this.colors[i + 1] = color.g * k;
    this.colors[i + 2] = color.b * k;
    this.n++;
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** A single beam segment drawn as an additive frustum (cone) between two points. */
export function beamFrustum(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, color: number, opacity: number, radial = 20) {
  const len = a.distanceTo(b);
  const geo = new THREE.CylinderGeometry(rb, ra, len, radial, 1, true); // top (+y) radius first = end b
  const mesh = new THREE.Mesh(geo, glowMat(color, opacity));
  const dir = b.clone().sub(a).normalize();
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  mesh.raycast = () => {};
  mesh.userData.beam = true;
  return mesh;
}

/** Tube between two points (solid, e.g. rods, pipes). */
export function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material, radial = 12) {
  const len = a.distanceTo(b);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, radial), mat);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return mesh;
}

export function edgeBox(w: number, h: number, d: number, color: number, opacity = 0.5) {
  const g = new THREE.BoxGeometry(w, h, d);
  const e = new THREE.LineSegments(
    new THREE.EdgesGeometry(g),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity, toneMapped: false }),
  );
  e.raycast = () => {};
  return e;
}
