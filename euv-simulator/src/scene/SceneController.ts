import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { COMPONENTS } from '../data/components';
import { LabelDef } from '../data/labels';
import { SLAB, v3 } from '../data/layout';
import { EXTERIOR, OVERVIEW, STAGES, stageProgress } from '../data/stages';
import type { CamPreset, InspectPreset } from '../data/types';
import { framingTargets, isSubsystem, isolationTargets } from '../data/hierarchy';
import { CABINET_BY_ID, CasingModule } from './casing';
import { SupportModule } from './support';
import { sim } from '../store/sim';
import { LabelLayer, Rect } from './labels';
import { OpticsModule } from './optics';
import { Registry } from './registry';
import { SlabModule } from './slab';
import { SourceModule } from './source';
import { FrameCtx, SimModule, euvPulses } from './timing';
import { TracksModule } from './tracks';
import { waferPose } from './transport';
import { WaferModule } from './wafer';
import { WorldModule } from './world';
import { DEG, clamp, easeInOut, easeOut, lerp } from './util';

const FOV = 34;
/** render layer used to draw only the inspected component */
const ISO = 1;
const PRESET_DIR: Record<Exclude<InspectPreset, 'default'>, [number, number]> = { front: [0, 4], side: [90, 4], top: [0, 88], iso: [42, 30] };
const _ndc = new THREE.Vector2();
const _box = new THREE.Box3();
const _v = new THREE.Vector3();

interface Pose {
  pos: THREE.Vector3;
  target: THREE.Vector3;
}

export interface Insets {
  l: number;
  r: number;
  t: number;
  b: number;
}

/**
 * Camera pose that keeps `fit` world units visible inside the *usable* part of the canvas
 * (the part not covered by overlay cards). Distance follows from the limiting px-per-unit scale.
 */
function poseFor(p: CamPreset, W: number, H: number, ins: Insets): Pose {
  const tanV = Math.tan((FOV * DEG) / 2);
  const Wu = Math.max(80, W - ins.l - ins.r);
  const Hu = Math.max(80, H - ins.t - ins.b);
  const fullH = H + Math.abs(ins.t - ins.b);
  const fit = p.fitNarrow && W / H < 0.75 ? p.fitNarrow : p.fit;
  const unitsPerPx = Math.max(fit[0] / Wu, fit[1] / Hu);
  const dist = (unitsPerPx * fullH) / (2 * tanV);
  const az = p.az * DEG;
  const el = p.el * DEG;
  const target = new THREE.Vector3(...p.t);
  const off = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist);
  return { pos: target.clone().add(off), target };
}

export class SceneController {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly registry = new Registry();
  readonly labels: LabelLayer;

  private canvas: HTMLCanvasElement;
  private modules: SimModule[] = [];
  private wafer: WaferModule;
  private slab: SlabModule;
  private raf = 0;
  private last = performance.now();
  private width = 1;
  private height = 1;
  private ro: ResizeObserver;
  private dirtyUntil = 0;
  private tween: { t0: number; dur: number; fromPos: THREE.Vector3; fromTarget: THREE.Vector3; to: Pose } | null = null;
  private presetKey = '';
  private userMoved = false;
  frames = 0;
  private hoverId: string | null = null;
  private down: { x: number; y: number; t: number } | null = null;
  private lastHoverTest = 0;
  private unsub: (() => void)[] = [];
  private disposed = false;
  private emphT = new Map<string, number>();
  private insets: Insets = { l: 0, r: 0, t: 0, b: 0 };
  private obstacles: Rect[] = [];
  private obstacleT = 0;
  private snapLabels = false;
  readonly casing: CasingModule;
  private isoKey = '';
  private isoObjs: THREE.Object3D[] = [];
  private inspectCache: { key: string; preset: CamPreset } | null = null;
  private lastInspect: string | null = null;
  private returnPose: { pos: THREE.Vector3; target: THREE.Vector3; userMoved: boolean } | null = null;

  constructor(private host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'gl';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Interactive 3D model of an EUV lithography scanner and downstream wafer-processing tools');
    this.canvas.tabIndex = 0;
    host.appendChild(this.canvas);
    const lowq = !!(window as unknown as { __EUV_LOWQ?: boolean }).__EUV_LOWQ;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !lowq, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(lowq ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.background = new THREE.Color(0x070b13);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 600);

    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pm.dispose();

    const world = new WorldModule(this.scene);
    const source = new SourceModule(this.registry);
    const optics = new OpticsModule(this.registry);
    this.wafer = new WaferModule(this.registry);
    this.slab = new SlabModule(this.registry);
    const tracks = new TracksModule(this.registry);
    const support = new SupportModule(this.registry);
    this.casing = new CasingModule(this.registry);
    this.modules = [world, source, optics, this.wafer, this.slab, tracks, support, this.casing];
    for (const m of this.modules) this.scene.add(m.group);
    // lights must be on the isolation layer too, or an isolated component would render unlit
    this.scene.traverse((o) => {
      if ((o as THREE.Light).isLight) o.layers.enable(ISO);
    });

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 120;
    this.controls.minPolarAngle = 0.12 * Math.PI;
    this.controls.maxPolarAngle = 0.92 * Math.PI;
    this.controls.minAzimuthAngle = -1.25;
    this.controls.maxAzimuthAngle = 1.25;
    this.controls.screenSpacePanning = true;
    this.controls.zoomSpeed = 0.9;
    // the user has taken the camera only once it really moves during a drag, wheel or pinch (a plain click on a
    // part also fires 'start', and must not count: Back would otherwise return to a stale pose)
    let interacting = false;
    this.controls.addEventListener('start', () => {
      this.tween = null;
      interacting = true;
      sim.dismissHint();
    });
    this.controls.addEventListener('end', () => {
      interacting = false;
    });
    this.controls.addEventListener('change', () => {
      if (interacting) this.userMoved = true;
      this.markDirty();
    });

    this.labels = new LabelLayer(
      host,
      (comp) => sim.inspect(comp),
      (comp) => {
        this.hoverId = comp;
        this.markDirty();
      },
    );

    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerleave', this.onLeave);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();

    let cards = '';
    this.unsub.push(
      sim.subscribe(() => {
        // the overlay cards change with these: measure them again on the next frame instead of waiting for the poll
        const s = sim.state;
        const k = `${s.inspect}|${s.casing}|${s.panelOpen}`;
        if (k !== cards) {
          cards = k;
          this.obstacleT = 0;
        }
        this.markDirty();
      }),
    );
    this.unsub.push(sim.subscribeTime(() => this.markDirty()));
    this.snapToPreset(true);
    this.warmUp();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Compile every shader up front (hidden objects included) so that stage changes never hitch. */
  private warmUp() {
    const hidden: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    try {
      this.renderer.compile(this.scene, this.camera);
      this.casing.withTransparent(() => this.renderer.compile(this.scene, this.camera));
    } catch (e) {
      console.warn('shader warm-up skipped', e);
    }
    for (const o of hidden) o.visible = false;
  }

  // ───────── lifecycle ─────────
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.unsub.forEach((u) => u());
    this.ro.disconnect();
    this.labels.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  markDirty(ms = 900) {
    this.dirtyUntil = Math.max(this.dirtyUntil, performance.now() + ms);
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.applyView();
    if (!this.userMoved && !this.tween) this.snapToPreset(false);
    this.markDirty(1500);
  }

  /** Overlay cards report how much of the canvas they cover; the 3-D view is shifted into the free area. */
  setInsets(i: Insets) {
    const o = this.insets;
    if (Math.abs(i.l - o.l) + Math.abs(i.r - o.r) + Math.abs(i.t - o.t) + Math.abs(i.b - o.b) < 6) return;
    this.insets = i;
    this.applyView();
    if (this.frames > 0 && !this.userMoved) this.startTween(this.currentPreset().preset);
    this.markDirty(2000);
  }

  private applyView() {
    const W = this.width;
    const H = this.height;
    const { l, r, t, b } = this.insets;
    const sx = l - r;
    const sy = t - b;
    if (Math.abs(sx) < 1 && Math.abs(sy) < 1) {
      this.camera.clearViewOffset();
      this.camera.aspect = W / H;
    } else {
      const fullW = W + Math.abs(sx);
      const fullH = H + Math.abs(sy);
      this.camera.aspect = fullW / fullH;
      this.camera.setViewOffset(fullW, fullH, sx < 0 ? -sx : 0, sy < 0 ? -sy : 0, W, H);
    }
    this.camera.updateProjectionMatrix();
  }

  // ───────── camera ─────────
  private currentPreset(): { key: string; preset: CamPreset } {
    const s = sim.state;
    if (s.inspect) {
      const key = `I:${s.inspect}:${s.camNonce}`;
      if (this.inspectCache?.key !== key) this.inspectCache = { key, preset: this.inspectPreset(s.inspect, s.camPreset) };
      return this.inspectCache;
    }
    if (s.view === 'component' && s.focusId && COMPONENTS[s.focusId]) {
      const c = COMPONENTS[s.focusId];
      let preset = c.cam;
      if (s.focusId === 'resist') preset = { ...preset, t: [this.slabCenterX(), SLAB.y + 1.3, 0] };
      return { key: `C:${s.focusId}:${s.viewNonce}`, preset };
    }
    if (s.view === 'stage') return { key: `S:${s.stage}:${s.viewNonce}`, preset: STAGES[s.stage].cam };
    if (s.casing === 'closed') return { key: `X:${s.viewNonce}`, preset: EXTERIOR };
    return { key: `M:${s.viewNonce}`, preset: OVERVIEW };
  }

  /**
   * Camera framing for the inspection view: centred on what is isolated, at a distance that keeps its bounding
   * sphere inside the free part of the canvas, so it never rotates out of view whatever its size.
   */
  private inspectPreset(id: string, which: InspectPreset): CamPreset {
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    for (const t of framingTargets(id)) {
      const b = isSubsystem(id) || t === 'enclosure' ? this.registry.isoBox(t, tmp) : this.registry.box(t, tmp) ?? this.registry.isoBox(t, tmp);
      if (b && !b.isEmpty()) box.union(b);
    }
    if (box.isEmpty()) box.setFromCenterAndSize(this.controls.target.clone(), new THREE.Vector3(4, 4, 4));
    const c = box.getCenter(new THREE.Vector3());
    // the cross-section moves with the wafer: aim where it will be at the current time, not where it was last drawn
    if (id === 'resist') c.set(this.slabCenterX(), SLAB.y + 1.3, 0);
    const comp = COMPONENTS[id];
    // a process (plasma, droplets, light) is framed with some of its surroundings in view
    const r = Math.max(comp?.kind === 'process' ? 2.6 : 0.8, box.getSize(new THREE.Vector3()).length() / 2);
    let az = comp?.cam.az ?? -24;
    let el = comp?.cam.el ?? 16;
    if (which !== 'default') [az, el] = PRESET_DIR[which];
    else if (comp?.inspectView) [az, el] = comp.inspectView;
    else {
      // default: a three-quarter view, a little above, so depth and surface detail read clearly
      az = Math.abs(az) < 12 ? (az < 0 ? -26 : 26) : az;
      el = Math.max(10, Math.min(28, el));
    }
    const d = 2 * r * 1.08;
    return { t: [c.x, c.y, c.z], az, el, fit: [d, d] };
  }

  /** Draw only the isolated component (render layer ISO), or everything again when id is null. */
  private applyIsolation(id: string | null) {
    const key = id ?? '';
    if (key === this.isoKey) return;
    for (const o of this.isoObjs) o.traverse((x) => x.layers.disable(ISO));
    this.isoObjs = [];
    this.isoKey = key;
    if (!id) {
      this.camera.layers.set(0);
      return;
    }
    const ids = id === 'enclosure' ? ['enclosure'] : isolationTargets(id);
    // the EUV light is drawn by beam segments spread over several modules; they are marked userData.beam
    // (true for EUV, 'laser' for the drive-laser cones)
    if (ids.includes('euvBeam'))
      this.scene.traverse((o) => {
        if (o.userData.beam === true) {
          o.traverse((x) => x.layers.enable(ISO));
          this.isoObjs.push(o);
        }
      });
    for (const t of ids) {
      const e = this.registry.entries.get(t);
      if (!e) continue;
      for (const r of e.isoRoots) {
        r.traverse((x) => x.layers.enable(ISO));
        this.isoObjs.push(r);
      }
    }
    this.camera.layers.set(ISO);
  }

  /** Orbit limits: the machine views keep the camera in front of the machine; inspection allows a full turn. */
  private setInspectControls(on: boolean) {
    const c = this.controls;
    c.minAzimuthAngle = on ? -Infinity : -1.25;
    c.maxAzimuthAngle = on ? Infinity : 1.25;
    c.minPolarAngle = on ? 0.02 * Math.PI : 0.12 * Math.PI;
    c.maxPolarAngle = on ? 0.98 * Math.PI : 0.92 * Math.PI;
    c.minDistance = on ? 0.4 : 3;
    c.maxDistance = on ? 220 : 120;
  }

  /** Which component ids may be picked right now. */
  private pickFilter(): (id: string) => boolean {
    const st = sim.state;
    if (st.inspect === 'enclosure') return (id) => id.startsWith('cab-');
    if (st.inspect) {
      const set = new Set(isolationTargets(st.inspect));
      return (id) => set.has(id);
    }
    if (this.casing.openness < 0.5) return (id) => id.startsWith('cab-');
    return (id) => !id.startsWith('cab-') && id !== 'enclosure';
  }

  /** Centre of the magnified cross-section(s), computed from the wafer transport so it is valid before the slab is first drawn. */
  private slabCenterX() {
    return waferPose(sim.getTime()).slabX;
  }

  private snapToPreset(initial: boolean) {
    const { key, preset } = this.currentPreset();
    this.presetKey = key;
    const pose = poseFor(preset, this.width, this.height, this.insets);
    this.camera.position.copy(pose.pos);
    this.controls.target.copy(pose.target);
    this.controls.update();
    if (initial) this.userMoved = false;
  }

  private startTween(preset: CamPreset) {
    const to = poseFor(preset, this.width, this.height, this.insets);
    this.tween = { t0: performance.now(), dur: 1500, fromPos: this.camera.position.clone(), fromTarget: this.controls.target.clone(), to };
    this.userMoved = false;
  }

  /** Drop the damped rotate/zoom/pan momentum OrbitControls keeps between updates (e.g. from the auto-rotation),
   *  so a glide lands exactly on its pose instead of drifting on afterwards. */
  private stopMomentum() {
    const c = this.controls as unknown as { _sphericalDelta?: THREE.Spherical; _panOffset?: THREE.Vector3; _scale?: number };
    c._sphericalDelta?.set(0, 0, 0);
    c._panOffset?.set(0, 0, 0);
    if (c._scale !== undefined) c._scale = 1;
  }

  private stepTween(now: number) {
    const tw = this.tween;
    if (!tw) return;
    this.stopMomentum();
    const k = easeInOut(clamp((now - tw.t0) / tw.dur));
    const target = tw.fromTarget.clone().lerp(tw.to.target, k);
    // interpolate the offset in spherical coordinates for a smooth arc
    const o0 = tw.fromPos.clone().sub(tw.fromTarget);
    const o1 = tw.to.pos.clone().sub(tw.to.target);
    const s0 = new THREE.Spherical().setFromVector3(o0);
    const s1 = new THREE.Spherical().setFromVector3(o1);
    let dTheta = s1.theta - s0.theta;
    if (dTheta > Math.PI) dTheta -= 2 * Math.PI;
    if (dTheta < -Math.PI) dTheta += 2 * Math.PI;
    const s = new THREE.Spherical(Math.exp(lerp(Math.log(s0.radius), Math.log(s1.radius), k)), lerp(s0.phi, s1.phi, k), s0.theta + dTheta * k);
    this.camera.position.copy(target).add(_v.setFromSpherical(s));
    this.controls.target.copy(target);
    if (k >= 1) this.tween = null;
  }

  // ───────── pointer interaction ─────────
  private ndc(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return _ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  private onDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  private onUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!d) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
    sim.dismissHint();
    const st = sim.state;
    const hit = this.registry.pickHit(this.ndc(e), this.camera, this.pickFilter());
    if (!hit) {
      if (!st.inspect) sim.select(null);
      return;
    }
    if (hit.id.startsWith('cab-')) {
      // a cabinet of the closed machine: open it and explore what that cabinet contains
      if (st.inspect !== 'enclosure') sim.inspect(CABINET_BY_ID[hit.id].target);
      return;
    }
    if (st.inspect === hit.id) return;
    sim.inspect(hit.id);
  };
  private onMove = (e: PointerEvent) => {
    if (e.buttons) {
      // dragging in the inspection view takes over from the automatic rotation
      const d = this.down;
      if (d && sim.state.inspect && sim.state.spin && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) sim.setSpin(false);
      return;
    }
    const now = performance.now();
    if (now - this.lastHoverTest < 60) return;
    this.lastHoverTest = now;
    const id = this.registry.pick(this.ndc(e), this.camera, this.pickFilter());
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.canvas.style.cursor = id ? 'pointer' : 'grab';
      this.markDirty();
    }
  };
  private onLeave = () => {
    if (this.hoverId) {
      this.hoverId = null;
      this.markDirty();
    }
  };

  // ───────── label anchors ─────────
  private resolveAnchor = (d: LabelDef): THREE.Vector3 | null => {
    const out = _v;
    if (d.ref === 'world') {
      // Per-stage anchors only apply to close-ups; the whole-machine view keeps the zone corner.
      const p = (sim.state.view !== 'machine' && d.pStage?.[sim.state.stage]) || d.p;
      return out.set(p[0], p[1], p[2]).clone();
    }
    if (d.ref === 'wafer') {
      const root = this.waferRoot();
      root.updateWorldMatrix(true, false);
      return root.localToWorld(out.set(d.p[0], d.p[1], d.p[2])).clone();
    }
    const slab = d.ref === 'slabA' ? this.slab.A : this.slab.B;
    if (!this.slab.group.visible || !slab.group.visible) return null;
    const neg = d.pNeg && sim.state.tone === 'negative';
    const p = neg ? d.pNeg! : d.pStage?.[sim.state.stage] ?? d.p;
    slab.group.updateWorldMatrix(true, false);
    return slab.group.localToWorld(out.set(p[0], p[1], p[2])).clone();
  };

  private waferRoot(): THREE.Object3D {
    return (this.wafer as any).root as THREE.Object3D;
  }

  // ───────── debugging / test helpers ─────────
  screenOf(id: string): { x: number; y: number } | null {
    const b = this.registry.box(id, _box);
    if (!b) return null;
    b.getCenter(_v);
    _v.project(this.camera);
    return { x: (_v.x * 0.5 + 0.5) * this.width, y: (-_v.y * 0.5 + 0.5) * this.height };
  }
  /** Find a screen point that really picks the component and is not covered by a DOM overlay (used by tests). */
  findPickPoint(id: string): { x: number; y: number } | null {
    const b = this.registry.box(id, _box);
    if (!b) return null;
    const c = b.getCenter(new THREE.Vector3());
    const size = b.getSize(new THREE.Vector3());
    const r = this.canvas.getBoundingClientRect();
    for (let i = 0; i < 400; i++) {
      const p = c.clone().add(new THREE.Vector3((Math.random() - 0.5) * size.x, (Math.random() - 0.5) * size.y, (Math.random() - 0.5) * size.z));
      p.project(this.camera);
      if (Math.abs(p.x) > 0.98 || Math.abs(p.y) > 0.98 || p.z > 1) continue;
      _ndc.set(p.x, p.y);
      if (this.registry.pick(_ndc, this.camera) !== id) continue;
      const x = (p.x * 0.5 + 0.5) * this.width;
      const y = (-p.y * 0.5 + 0.5) * this.height;
      if (document.elementFromPoint(r.left + x, r.top + y) !== this.canvas) continue;
      return { x, y };
    }
    return null;
  }

  /** Run one full update + render immediately (used by tests so results do not depend on timer scheduling). */
  debugFrame() {
    this.frame(performance.now(), true);
  }

  /** Finish any camera glide and label easing at once, then render (used by tests on slow software renderers). */
  debugSettle() {
    // ResizeObserver callbacks are only delivered in rendering steps, which are ~1 s apart on a software renderer
    if (this.host.clientWidth !== this.width || this.host.clientHeight !== this.height) this.resize();
    this.casing.snapNext = true;
    this.obstacleT = 0; // re-measure the overlay cards now
    this.debugFrame(); // notices a changed preset and starts the glide
    if (this.tween) this.tween.t0 = performance.now() - this.tween.dur - 1;
    this.debugFrame(); // lands the camera
    this.snapLabels = true;
    this.debugFrame();
    this.snapLabels = false;
  }

  /** Inspection/casing state for tests: what is drawn, how the camera is set up. */
  debugInspect() {
    return {
      layerMask: this.camera.layers.mask,
      casing: this.casing.openness,
      autoRotate: this.controls.autoRotate,
      autoRotateSpeed: this.controls.autoRotateSpeed,
      tween: !!this.tween,
      target: this.controls.target.toArray(),
      distance: this.camera.position.distanceTo(this.controls.target),
      azimuth: this.controls.getAzimuthalAngle(),
      polar: this.controls.getPolarAngle(),
      drawn: this.drawnComponents(),
    };
  }

  /** Component ids with at least one mesh that is visible and on the camera's render layer. */
  drawnComponents(): string[] {
    const out: string[] = [];
    const visibleDeep = (o: THREE.Object3D) => {
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
      return true;
    };
    for (const [id, e] of this.registry.entries) {
      let hit = false;
      for (const r of [...e.roots, ...e.isoRoots]) {
        r.traverse((o) => {
          if (hit || !(o as THREE.Mesh).isMesh) return;
          if (o.layers.test(this.camera.layers) && visibleDeep(o)) hit = true;
        });
        if (hit) break;
      }
      if (hit) out.push(id);
    }
    return out;
  }

  /** Render statistics and beam visibility (used by tests). */
  debugStats() {
    this.debugFrame();
    let beamsLit = 0;
    this.scene.traverse((o) => {
      if (!o.userData.beam) return;
      const m = o as THREE.Mesh | THREE.InstancedMesh;
      if (!m.visible) return;
      if ((m as THREE.InstancedMesh).isInstancedMesh) {
        beamsLit += (m as THREE.InstancedMesh).count;
      } else if ((m.material as THREE.MeshBasicMaterial).opacity > 0.004) beamsLit++;
    });
    return { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, beamsLit, frames: this.frames };
  }

  /** Re-render and read back coarse pixels (used to prove the canvas shows content, not a blank frame). */
  debugSamplePixels(nx = 24, ny = 14) {
    this.renderer.render(this.scene, this.camera);
    const gl = this.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(4);
    const seen = new Set<string>();
    let bright = 0;
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        gl.readPixels(Math.floor(((i + 0.5) / nx) * w), Math.floor(((j + 0.5) / ny) * h), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        seen.add(`${px[0] >> 4},${px[1] >> 4},${px[2] >> 4}`);
        if (px[0] + px[1] + px[2] > 150) bright++;
      }
    return { distinct: seen.size, bright, samples: nx * ny };
  }

  // ───────── frame loop ─────────
  private frame = (nowMs: number, once = false) => {
    if (this.disposed) return;
    if (!once) this.raf = requestAnimationFrame(this.frame);
    // never negative: a requestAnimationFrame timestamp can be older than a performance.now() taken by debugFrame()
    const dt = Math.min(Math.max((nowMs - this.last) / 1000, 0), 0.1);
    this.last = nowMs;
    sim.tick(dt);
    const st = sim.state;
    const T = sim.getTime();

    // inspection mode: isolation, orbit limits, and remembering where the user was
    if (st.inspect !== this.lastInspect) {
      const entering = !this.lastInspect && !!st.inspect;
      const leaving = !!this.lastInspect && !st.inspect;
      if (entering) this.returnPose = { pos: this.camera.position.clone(), target: this.controls.target.clone(), userMoved: this.userMoved };
      this.lastInspect = st.inspect;
      this.applyIsolation(st.inspect);
      this.setInspectControls(!!st.inspect);
      if (leaving && this.returnPose) {
        // Back: glide to exactly where the user had put the camera before inspection started; if they had not
        // moved it, to the current view's preset (the same place, unless the stage changed in the meantime)
        const rp = this.returnPose;
        const cur = this.currentPreset();
        this.presetKey = cur.key;
        const to = rp.userMoved ? { pos: rp.pos, target: rp.target } : poseFor(cur.preset, this.width, this.height, this.insets);
        this.tween = { t0: performance.now(), dur: 1300, fromPos: this.camera.position.clone(), fromTarget: this.controls.target.clone(), to };
        this.userMoved = rp.userMoved;
        this.returnPose = null;
        this.markDirty(2200);
      }
    }

    // camera presets
    const { key, preset } = this.currentPreset();
    if (key !== this.presetKey) {
      this.presetKey = key;
      if (this.frames === 0) this.snapToPreset(true);
      else this.startTween(preset);
      this.markDirty(2200);
    }
    const tweening = !!this.tween;
    if (tweening) {
      this.stepTween(nowMs);
      this.markDirty(300);
    }

    // slow automatic rotation around the inspected component (paused while gliding and when the user takes over)
    const spinning = !!st.inspect && st.spin && !this.tween;
    this.controls.autoRotate = spinning;
    this.controls.autoRotateSpeed = 1.0 * st.spinDir; // one turn per minute
    this.controls.update(dt); // dispatches 'change' (→ markDirty) while the camera is still gliding
    this.frames++;
    const casingMoving = this.casing.openness > 0.001 && this.casing.openness < 0.999;
    const needs = st.playing || tweening || spinning || casingMoving || nowMs < this.dirtyUntil || once;
    if (!needs) return;

    // frame context
    const stage = st.stage;
    const p = stageProgress(T, stage);
    const prev = stage > 0 ? STAGES[stage - 1].reach : 0;
    const reach = lerp(prev, STAGES[stage].reach, easeOut(clamp(p / 0.35)));
    const focus = new Set(STAGES[stage].focus);
    const k = 1 - Math.exp(-dt * 8);
    for (const [id, e] of this.registry.entries) {
      let target = focus.has(id) ? 1 : 0;
      if (this.hoverId === id) target = Math.max(target, 0.85);
      if (st.selectedId === id) target = Math.max(target, 0.6);
      // in the inspection view the model keeps its own colours: only a faint tint on the selection, a clear one on hover
      if (st.inspect) target = this.hoverId === id ? 0.7 : st.selectedId === id ? 0.18 : 0;
      const cur = this.emphT.get(id) ?? 0;
      const nv = cur + (target - cur) * k;
      this.emphT.set(id, nv);
      this.registry.setEmphasis(id, nv);
    }
    const ctx: FrameCtx = {
      T,
      dt,
      stage,
      p,
      playing: st.playing,
      atmosphere: st.atmosphere,
      tone: st.tone,
      dose: st.dose,
      showPath: st.path,
      reach,
      legs: STAGES[stage].legs,
      camera: this.camera,
      pulses: euvPulses(T),
      emph: (id) => this.emphT.get(id) ?? 0,
      casingOpen: st.casing === 'open',
      inspect: st.inspect,
    };
    for (const m of this.modules) m.update(ctx);
    this.renderer.render(this.scene, this.camera);

    // 2-D overlay
    this.labels.update({
      camera: this.camera,
      width: this.width,
      height: this.height,
      dt,
      enabled: st.labels && !st.inspect,
      exterior: this.casing.openness < 0.5 && !st.inspect,
      view: st.view,
      focusId: st.focusId,
      stage,
      tone: st.tone,
      resolve: this.resolveAnchor,
      snap: this.snapLabels,
      maxLabels: this.maxLabels(),
      preferComp: st.selectedId,
      hoverComp: this.hoverId,
      selectedComp: st.selectedId,
      obstacles: this.readObstacles(nowMs).concat(this.slabRect()),
    });
    this.updateBracket(st.inspect ? null : st.selectedId);
  };

  /** How many labels fit: phones get a handful, and fewer still when a bottom sheet leaves only a thin strip of 3-D view. */
  private maxLabels(): number {
    const freeH = this.height - this.insets.t - this.insets.b;
    if (this.width >= 700 && freeH >= 270) return Infinity;
    return freeH < 270 ? 3 : 6;
  }

  /** Screen rectangles of the overlay cards (relative to the canvas), refreshed a few times per second. */
  private readObstacles(now: number): Rect[] {
    if (now - this.obstacleT < 300) return this.obstacles;
    this.obstacleT = now;
    const vr = this.host.getBoundingClientRect();
    const out: Rect[] = [];
    for (const el of Array.from(this.host.parentElement?.querySelectorAll('.stage-card, .keys, .viewport-note, .hint') ?? [])) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      out.push({ x0: r.left - vr.left - 4, y0: r.top - vr.top - 4, x1: r.right - vr.left + 4, y1: r.bottom - vr.top + 4 });
    }
    // on phones and tablets the science panel is a bottom sheet drawn over the viewport
    const sheet = document.querySelector('.panel') as HTMLElement | null;
    if (sheet && !sheet.hidden && sheet.getBoundingClientRect().left <= vr.left + 1) {
      const r = sheet.getBoundingClientRect();
      out.push({ x0: 0, y0: r.top - vr.top - 4, x1: vr.width, y1: vr.height + 40 });
    }
    this.obstacles = out;
    return out;
  }

  /** Screen rectangle of the magnified cross-section so callouts are placed around it, not on it. */
  private slabRect(): Rect[] {
    if (!this.slab.group.visible) return [];
    const b = this.slab.bounds();
    if (b.isEmpty()) return [];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    // only the cut face and the aerial image above it (not the photon streaks) block labels
    for (let i = 0; i < 8; i++) {
      _v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.min.y + (b.max.y - b.min.y) * 0.78 : b.min.y, i & 4 ? b.max.z : b.min.z).project(this.camera);
      if (_v.z > 1) return [];
      const sx = (_v.x * 0.5 + 0.5) * this.width;
      const sy = (-_v.y * 0.5 + 0.5) * this.height;
      x0 = Math.min(x0, sx);
      x1 = Math.max(x1, sx);
      y0 = Math.min(y0, sy);
      y1 = Math.max(y1, sy);
    }
    return [{ x0: x0 - 6, y0: y0 - 6, x1: x1 + 6, y1: y1 + 6, soft: 0.25 }];
  }

  private updateBracket(id: string | null) {
    if (!id) return this.labels.setBracket(null);
    const b = this.registry.box(id, _box);
    if (!b || b.isEmpty()) return this.labels.setBracket(null);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      _v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(this.camera);
      if (_v.z > 1) return this.labels.setBracket(null);
      const sx = (_v.x * 0.5 + 0.5) * this.width;
      const sy = (-_v.y * 0.5 + 0.5) * this.height;
      x0 = Math.min(x0, sx);
      x1 = Math.max(x1, sx);
      y0 = Math.min(y0, sy);
      y1 = Math.max(y1, sy);
    }
    if (x1 < 0 || y1 < 0 || x0 > this.width || y0 > this.height) return this.labels.setBracket(null);
    this.labels.setBracket({ x0: Math.max(x0, 4), y0: Math.max(y0, 4), x1: Math.min(x1, this.width - 4), y1: Math.min(y1, this.height - 4) });
  }
}
