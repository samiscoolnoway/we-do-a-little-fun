import * as THREE from 'three';
import { CHIP_INFO, DIE, DIES, FLOORPLAN, IO_RING, TRANSISTORS, WAFER, regionAt, type RegionDef } from '../../data/chip';
import type { CamPreset, ChipLevel, ChipState, ChipView } from '../../data/types';
import { BoxModel, type Box } from './boxModel';
import { buildBlock, type BlockBuild } from './blockModel';
import { GATE_X, N_Z, P_Z, buildCell, type CellBuild } from './cellModel';
import { WaferModel, W_TOP, toWorld } from './waferModel';

/** The three representations: physical wafer + die, the enlarged circuit region, the enlarged cell / transistor. */
export type Repr = 'wafer' | 'block' | 'cell';
export const reprOf = (l: ChipLevel): Repr => (l === 'wafer' || l === 'die' ? 'wafer' : l === 'block' ? 'block' : 'cell');

/** model units per micrometre in each representation */
const UNIT_UM: Record<Repr, number> = { wafer: 1000, block: 0.01, cell: 0.001 };
const UNIT_UM_INV: Record<Repr, number> = { wafer: 1 / 1000, block: 100, cell: 1000 };
const GAP: Record<Repr, number> = { wafer: 0, block: 7, cell: 46 };

/** part names in the box models that share an explanation */
const INFO_ALIAS: Record<string, string> = { via: 'v0', clock: 'blk-clock', power: 'blk-power' };
export const infoKey = (part: string) => INFO_ALIAS[part] ?? part;

export interface ChipHit {
  /** CHIP_INFO key */
  sel: string;
  die?: number;
  region?: string;
  box?: number;
  cell?: number;
  device?: string;
}

interface LabelItem {
  el: HTMLButtonElement;
  key: string;
  sel: string;
  anchor: () => THREE.Vector3 | null;
  box?: number;
}

const _v = new THREE.Vector3();

export class ChipModule {
  readonly scene = new THREE.Scene();
  readonly wafer: WaferModel;
  readonly block: BoxModel;
  readonly cell: BoxModel;
  readonly blockData: BlockBuild;
  readonly cellData: CellBuild;
  repr: Repr = 'wafer';
  private st: ChipState | null = null;
  private outline: THREE.LineSegments;
  private hoverBox: THREE.LineSegments;
  private particles: THREE.InstancedMesh;
  private partMats: { e: THREE.MeshBasicMaterial; h: THREE.MeshBasicMaterial };
  private labelRoot: HTMLDivElement;
  private labels: LabelItem[] = [];
  private labelKey = '';
  private raycaster = new THREE.Raycaster();
  private phase = 0;

  constructor(
    host: HTMLElement,
    env: THREE.Texture,
    private onLabel: (hit: ChipHit) => void,
  ) {
    this.scene.background = new THREE.Color(0x070b13);
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.6;
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(0.4, 1, 0.6);
    const fill = new THREE.DirectionalLight(0x9fb8ff, 0.5);
    fill.position.set(-0.7, 0.4, -0.5);
    this.scene.add(key, fill, new THREE.AmbientLight(0x8090a8, 0.35));

    this.wafer = new WaferModel();
    this.blockData = buildBlock();
    this.cellData = buildCell();
    this.block = new BoxModel(this.blockData.boxes);
    this.cell = new BoxModel(this.cellData.boxes);
    this.scene.add(this.wafer.group, this.block.group, this.cell.group);

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x3fe0ff, depthTest: false, transparent: true }));
    this.hoverBox = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.8 }));
    for (const o of [this.outline, this.hoverBox]) {
      o.renderOrder = 10;
      o.visible = false;
      this.scene.add(o);
    }
    // carriers for the illustrative ON state (electrons in nFETs, holes in pFETs)
    this.partMats = { e: new THREE.MeshBasicMaterial({ color: 0x8fd8ff }), h: new THREE.MeshBasicMaterial({ color: 0xffb46b }) };
    this.particles = new THREE.InstancedMesh(new THREE.SphereGeometry(1.1, 10, 8), this.partMats.e, 42);
    this.particles.visible = false;
    // drawn over the gate that surrounds the channel (an illustration, not a physical view)
    this.partMats.e.depthTest = false;
    this.partMats.h.depthTest = false;
    this.particles.renderOrder = 8;
    this.particles.raycast = () => {};
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);

    this.labelRoot = document.createElement('div');
    this.labelRoot.className = 'chip-labels';
    host.appendChild(this.labelRoot);
    this.setRepr('wafer');
  }

  setRepr(r: Repr) {
    this.repr = r;
    this.wafer.group.visible = r === 'wafer';
    this.block.group.visible = r === 'block';
    this.cell.group.visible = r === 'cell';
    this.hoverBox.visible = false;
    this.labelKey = '';
  }

  /** Bring the current representation in line with the store (layout, highlight, outlines). */
  apply(st: ChipState) {
    this.st = st;
    const die = st.die !== null ? DIES[st.die] : null;
    if (this.repr === 'wafer') {
      this.wafer.setDieOutline('sel', die);
      this.wafer.showDieDetail(st.level === 'die' ? die : null);
      const reg = st.level === 'die' && st.region ? (st.region === 'io' ? 'io' : FLOORPLAN.find((f) => f.id === st.region) ?? null) : null;
      this.wafer.setRegionOutline('sel', st.level === 'die' ? die : null, reg);
      this.outline.visible = false;
      return;
    }
    const hidden = new Set(st.hidden);
    if (this.repr === 'block') {
      const selBox = st.selBox !== null ? this.block.boxes[st.selBox] : null;
      const group = st.sel?.startsWith('blk-') ? st.sel : null;
      this.block.layout({
        explode: st.explode,
        gap: GAP.block,
        hidden,
        section: null,
        keep: st.iso && group ? (b) => b.group === group : null,
      });
      const cell = selBox?.cell;
      this.hoverBox.visible = false;
      this.block.tint((b) => {
        if (cell !== undefined && cell !== null && st.sel !== null && (st.sel === 'std-cell' || st.sel === 'sram-cell')) return b.cell === cell ? 1.55 : 0.62;
        if (group && !st.iso) return b.group === group ? 1.3 : 0.45;
        return 1;
      });
      this.setOutline(this.block, st.selBox);
      return;
    }
    // cell / transistor
    this.hoverBox.visible = false; // the layout may have moved; the next pointer move re-evaluates the hover
    const dev = st.level === 'transistor' && st.device ? this.cellData.devices[st.device] : null;
    const devId = st.device;
    const substrateParts = new Set(['substrate', 'well-n', 'well-p', 'mesa', 'sti']);
    this.cell.layout({
      explode: st.explode,
      gap: GAP.cell,
      hidden,
      section: this.section(st.view, st.level, devId),
      crop: dev ? dev.crop : null,
      keep: (b) => {
        if (dev && devId && !(b.devs?.includes(devId) || substrateParts.has(b.part))) return false;
        if (st.iso && st.sel) return this.matches(b, st);
        return true;
      },
    });
    const on = st.level === 'transistor' && st.on;
    const isN = devId?.startsWith('n');
    this.cell.tint((b) => {
      // illustrative ON state: the conducting channel glows (blue for electrons, amber for holes), the gate is driven
      if (on && devId && b.devs?.includes(devId) && b.part === 'sheet') return isN ? [0.75, 1.45, 2.1] : [2.0, 1.35, 0.7];
      if (on && devId && b.devs?.includes(devId) && b.part === 'gate') return [1.45, 1.3, 1.0];
      if (st.sel && !st.iso && this.selIsGroup(st)) return this.matches(b, st) ? 1.35 : 0.72;
      if (st.level === 'cell' && devId) return b.devs?.includes(devId) ? 1.35 : 0.7;
      return 1;
    });
    this.setOutline(this.cell, st.selBox);
  }

  /** a selection that refers to a kind of part or a layer (highlight every matching box) rather than nothing in particular */
  private selIsGroup(st: ChipState) {
    return !!st.sel && st.sel !== 'nand2' && st.sel !== 'block';
  }

  private matches(b: Box, st: ChipState): boolean {
    const s = st.sel!;
    if ((s === 'nfet' || s === 'pfet') && st.device) return !!b.devs?.includes(st.device);
    if (s === 'ild' || s === 'pmd') return !!b.diel;
    if (s.startsWith('layer:')) return b.layer === s.slice(6);
    const k = infoKey(b.part);
    if (s === 'v0') return b.part === 'via';
    return k === s || (s === 'nfet' && b.layer === 'fe') || (s === 'tcn' && b.part === 'gcn');
  }

  private section(view: ChipView, level: ChipLevel, devId: string | null): { axis: 'x' | 'z'; at: number } | null {
    if (view === 'top') return null;
    const dev = level === 'transistor' && devId ? TRANSISTORS.find((t) => t.id === devId) : null;
    if (view === 'channel') {
      const zs = dev ? (dev.type === 'n' ? N_Z : P_Z) : N_Z;
      return { axis: 'z', at: (zs[0] + zs[1]) / 2 };
    }
    return { axis: 'x', at: dev ? GATE_X[dev.gate] : GATE_X.A };
  }

  private setOutline(m: BoxModel, i: number | null) {
    const p = i !== null ? m.placed[i] : null;
    this.outline.visible = !!p;
    if (p) {
      p.getCenter(this.outline.position);
      p.getSize(this.outline.scale);
      this.outline.scale.addScalar(this.repr === 'cell' ? 0.6 : 0.3);
    }
  }

  // ───────── picking ─────────
  pick(ndc: THREE.Vector2, camera: THREE.Camera): ChipHit | null {
    this.raycaster.setFromCamera(ndc, camera);
    const st = this.st;
    if (this.repr === 'wafer') {
      const hit = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -W_TOP), hit)) return null;
      const x = hit.x;
      const y = -hit.z;
      const d = this.wafer.dieAt(x, y);
      if (!d) return null;
      const sel = st && st.level === 'die' && st.die !== null ? DIES[st.die] : null;
      if (d === 'scribe') return { sel: st?.level === 'die' ? 'scribe' : 'wafer' };
      if (sel && d.i === sel.i) {
        const r = regionAt(x - (d.x - DIE.w / 2), y - (d.y - DIE.h / 2));
        if (r === 'io') return { sel: 'fp-io', die: d.i, region: 'io' };
        if (r) return { sel: r.info, die: d.i, region: r.id };
        return { sel: 'die', die: d.i };
      }
      return { sel: d.full ? 'die' : 'die-edge', die: d.i };
    }
    const model = this.repr === 'block' ? this.block : this.cell;
    const i = model.pick(this.raycaster);
    if (i === null) return null;
    const b = model.boxes[i];
    if (this.repr === 'block') {
      if (b.group === 'blk-cells') return { sel: 'std-cell', cell: b.cell, box: i };
      if (b.group === 'blk-sram') return b.cell !== undefined ? { sel: 'sram-cell', cell: b.cell, box: i } : { sel: 'blk-sram', box: i };
      if (b.group) return { sel: b.group, box: i };
      return { sel: b.diel ? 'ild' : 'block', box: i };
    }
    return { sel: infoKey(b.part), box: i, device: b.devs?.length === 1 ? b.devs[0] : undefined };
  }

  setHover(h: ChipHit | null) {
    if (this.repr === 'wafer') {
      const st = this.st;
      const inDie = st?.level === 'die' && h?.die === st.die && h?.region;
      this.wafer.setDieOutline('hover', h?.die !== undefined && !inDie && h.die !== st?.die ? DIES[h.die] : null);
      const reg = inDie ? (h!.region === 'io' ? 'io' : FLOORPLAN.find((f) => f.id === h!.region) ?? null) : null;
      this.wafer.setRegionOutline('hover', inDie ? DIES[st!.die!] : null, reg);
      return;
    }
    const m = this.repr === 'block' ? this.block : this.cell;
    const p = h?.box !== undefined ? m.placed[h.box] : null;
    this.hoverBox.visible = !!p;
    if (p) {
      p.getCenter(this.hoverBox.position);
      p.getSize(this.hoverBox.scale);
      this.hoverBox.scale.addScalar(this.repr === 'cell' ? 0.4 : 0.2);
    }
  }

  // ───────── camera framing ─────────
  /** Final framing for a state; `close` = right on top of `item` (start or end of a dive), `far` = pulled back. */
  preset(st: ChipState, kind: 'final' | 'close' | 'far' = 'final', item?: { die?: number | null; region?: string | null; cell?: number | null }): CamPreset {
    const r = reprOf(st.level);
    let p: CamPreset;
    if (r === 'wafer') {
      const die = st.die !== null ? DIES[st.die] : null;
      if (kind === 'close' && item?.region && die) {
        const reg = item.region === 'io' ? null : FLOORPLAN.find((f) => f.id === item.region);
        const b = reg ?? { x0: 0, y0: 0, x1: DIE.w, y1: DIE.h };
        const c = toWorld(die.x - DIE.w / 2 + (b.x0 + b.x1) / 2, die.y - DIE.h / 2 + (b.y0 + b.y1) / 2);
        return { t: [c.x, c.y, c.z], az: 0, el: 80, fit: [(b.x1 - b.x0) * 0.08, (b.y1 - b.y0) * 0.08] };
      }
      if (st.level === 'die' && die) {
        const c = toWorld(die.x, die.y);
        p = { t: [c.x, c.y, c.z], az: 0, el: 62, fit: [DIE.w * 1.3, DIE.h * 1.3] };
      } else p = { t: [0, 0, 0], az: 0, el: 58, fit: [WAFER.diameter * 1.08, WAFER.diameter * 0.82] };
    } else if (r === 'block') {
      const reg = st.region ? FLOORPLAN.find((f) => f.id === st.region) : null;
      const a = reg?.kind === 'sram' ? this.blockData.sram : reg?.kind === 'logic' ? this.blockData.logic : { x: 0, z: 0, w: 400, d: 260 };
      if (kind === 'close' && item?.cell !== undefined && item.cell !== null) {
        const c = this.cellRect(item.cell);
        if (c) return { t: [(c.x0 + c.x1) / 2, 6, (c.z0 + c.z1) / 2], az: 0, el: 78, fit: [(c.x1 - c.x0) * 0.6, (c.z1 - c.z0) * 0.6] };
      }
      p = { t: [a.x, 8 + st.explode * 20, a.z], az: -12, el: 44, fit: [a.w * 1.08, a.d * 0.8 + st.explode * 40] };
    } else {
      const dev = st.level === 'transistor' && st.device ? this.cellData.devices[st.device] : null;
      if (dev) {
        const b = this.cell.bounds();
        const c = b.isEmpty() ? new THREE.Vector3() : b.getCenter(new THREE.Vector3());
        const s = b.isEmpty() ? 80 : b.getSize(new THREE.Vector3()).length();
        p = { t: [c.x, c.y, c.z], az: -38, el: 24, fit: [s * 0.95, s * 0.95] };
      } else {
        const b = this.cell.bounds((x) => !x.diel && x.mat !== 'pass');
        const c = b.isEmpty() ? new THREE.Vector3(0, 90, 0) : b.getCenter(new THREE.Vector3());
        p = { t: [c.x, c.y, c.z], az: -28, el: 26, fit: [260, 330 + st.explode * 380] };
      }
      if (st.view === 'channel') p = { ...p, az: 0, el: 3, fit: dev ? p.fit : [240, 400 + st.explode * 420] };
      if (st.view === 'gate') p = { ...p, az: -90, el: 3, fit: dev ? p.fit : [240, 420 + st.explode * 420] };
    }
    if (kind === 'far') p = { ...p, fit: [p.fit[0] * 6, p.fit[1] * 6] };
    return p;
  }

  private cellRect(ci: number) {
    if (ci >= 1000) return this.blockData.sramCells[ci - 1000] ?? null;
    return this.blockData.cells[ci] ?? null;
  }

  /** where the dive into an item starts on the current representation (die → region, region → cell) */
  diveItem(st: ChipState): { region?: string | null; cell?: number | null } {
    const b = st.selBox !== null && this.repr === 'block' ? this.block.boxes[st.selBox] : null;
    return { region: st.region, cell: b?.cell ?? null };
  }

  // ───────── per frame ─────────
  update(dt: number, camera: THREE.PerspectiveCamera, W: number, H: number) {
    this.phase += dt;
    this.updateParticles();
    this.updateLabels(camera, W, H);
  }

  private updateParticles() {
    const st = this.st;
    const show = this.repr === 'cell' && !!st && st.level === 'transistor' && st.on && !!st.device && !st.hidden.includes('fe');
    this.particles.visible = show;
    if (!show || !st || !st.device) return;
    const d = this.cellData.devices[st.device];
    const t = TRANSISTORS.find((x) => x.id === st.device)!;
    this.particles.material = t.type === 'n' ? this.partMats.e : this.partMats.h;
    const dir = t.source === 'left' ? 1 : -1;
    const sec = this.section(st.view, st.level, st.device);
    const dy = 2 * st.explode * GAP.cell;
    const m = new THREE.Matrix4();
    const n = this.particles.count;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const sheet = i % 3;
      const lane = Math.floor(i / 3);
      const f = (this.phase * 0.35 + lane / (n / 3) + sheet * 0.13) % 1;
      const x = dir > 0 ? d.x0 + f * (d.x1 - d.x0) : d.x1 - f * (d.x1 - d.x0);
      const z = d.zs[0] + 4 + ((lane * 7.3) % (d.zs[1] - d.zs[0] - 8));
      const y = [10, 25, 40][sheet] + dy;
      if (sec?.axis === 'x' && x < sec.at) m.makeScale(0, 0, 0);
      else m.makeTranslation(x, y, sec?.axis === 'z' ? sec.at + 0.8 : z);
      this.particles.setMatrixAt(k++, m);
    }
    this.particles.instanceMatrix.needsUpdate = true;
  }

  // ── labels: a few representative structures, clickable, anchored to their boxes ──
  private labelDefs(): { key: string; text: string; sel: string; anchor: () => THREE.Vector3 | null; box?: number; cls?: string }[] {
    const st = this.st;
    if (!st) return [];
    // anchor on the face that looks at the camera: the top, or the cut face in a section
    const boxAnchor = (m: BoxModel, i: number) => () => {
      const p = m.placed[i];
      if (!p) return null;
      const v = this.st?.view;
      if (this.repr === 'cell' && v === 'channel') return new THREE.Vector3((p.min.x + p.max.x) / 2, (p.min.y + p.max.y) / 2, p.max.z);
      if (this.repr === 'cell' && v === 'gate') return new THREE.Vector3(p.min.x, (p.min.y + p.max.y) / 2, (p.min.z + p.max.z) / 2);
      return new THREE.Vector3((p.min.x + p.max.x) / 2, p.max.y, (p.min.z + p.max.z) / 2);
    };
    const first = (m: BoxModel, pred: (b: Box) => boolean) => m.boxes.findIndex((b, i) => pred(b) && !!m.placed[i]);
    if (this.repr === 'wafer') {
      if (st.level === 'wafer') {
        const centre = DIES.filter((d) => d.full).sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))[0];
        const edge = DIES.filter((d) => !d.full).sort((a, b) => Math.abs(a.y) - Math.abs(b.y) || b.x - a.x)[0];
        return [
          { key: 'w-die', text: 'Die (one complete chip)', sel: 'die', anchor: () => toWorld(centre.x, centre.y) },
          { key: 'w-edge', text: 'Partial edge die', sel: 'die-edge', anchor: () => toWorld(edge.x, edge.y) },
          { key: 'w-notch', text: 'Notch', sel: 'wafer', anchor: () => toWorld(0, -WAFER.diameter / 2 + 2) },
        ];
      }
      const die = st.die !== null ? DIES[st.die] : null;
      if (!die) return [];
      const at = (u: number, v: number) => () => toWorld(die.x - DIE.w / 2 + u, die.y - DIE.h / 2 + v, W_TOP + 0.01);
      const out: { key: string; text: string; sel: string; anchor: () => THREE.Vector3 | null; cls?: string }[] = FLOORPLAN.filter((f) => f.id !== 'core1' && f.id !== 'core2' && f.id !== 'core3').map((f) => ({
        key: `r-${f.id}`,
        text: f.id === 'core0' ? 'CPU cores (×4)' : f.name,
        sel: f.info,
        anchor: at((f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2),
      }));
      out.push({ key: 'r-io', text: 'I/O pads and bumps', sel: 'fp-io', anchor: at(IO_RING / 2, DIE.h * 0.62) });
      out.push({ key: 'd-w', text: '12 mm (example)', sel: 'die', anchor: at(DIE.w / 2, 0), cls: 'dim' });
      out.push({ key: 'd-h', text: '10 mm', sel: 'die', anchor: at(DIE.w, DIE.h / 2), cls: 'dim' });
      return out;
    }
    if (this.repr === 'block') {
      const out: { key: string; text: string; sel: string; anchor: () => THREE.Vector3 | null; box?: number }[] = [];
      const m = this.block;
      const g = first(m, (b) => b.group === 'blk-cells' && b.part === 'gate' && b.min[2] > -10 && b.min[0] > -120);
      if (g >= 0) out.push({ key: 'b-cells', text: 'Standard-cell rows', sel: 'blk-cells', anchor: boxAnchor(m, g), box: g });
      const s = first(m, (b) => b.group === 'blk-sram' && b.cell === 1000 + 63);
      if (s >= 0) out.push({ key: 'b-sram', text: 'SRAM array (6T cells)', sel: 'blk-sram', anchor: boxAnchor(m, s), box: s });
      m.boxes.forEach((b, i) => {
        if (b.label && m.placed[i]) out.push({ key: `b-${i}`, text: b.label, sel: b.group ?? infoKey(b.part), anchor: boxAnchor(m, i), box: i });
      });
      return out;
    }
    const m = this.cell;
    const out: { key: string; text: string; sel: string; anchor: () => THREE.Vector3 | null; box?: number }[] = [];
    const push = (key: string, text: string, pred: (b: Box) => boolean) => {
      const i = first(m, pred);
      if (i >= 0) out.push({ key, text, sel: infoKey(m.boxes[i].part), anchor: boxAnchor(m, i), box: i });
    };
    if (st.level === 'transistor' && st.device) {
      const t = TRANSISTORS.find((x) => x.id === st.device)!;
      const dv = this.cellData.devices[st.device];
      const sx = t.source === 'left' ? dv.x0 : dv.x1;
      const dx = t.source === 'left' ? dv.x1 : dv.x0;
      push('t-gate', 'Gate (wraps the channel)', (b) => b.part === 'gate' && !!b.devs?.includes(t.id));
      push('t-hk', 'High-k gate dielectric', (b) => b.part === 'hk' && b.min[1] > 30);
      push('t-sheet', 'Nanosheet channel (×3)', (b) => b.part === 'sheet' && b.min[1] > 35);
      push('t-src', 'Source', (b) => (b.part === 'sd-n' || b.part === 'sd-p') && b.min[0] < sx && b.max[0] > sx);
      push('t-drn', 'Drain', (b) => (b.part === 'sd-n' || b.part === 'sd-p') && b.min[0] < dx && b.max[0] > dx);
      push('t-sp', 'Spacer', (b) => b.part === 'spacer' && !!b.devs?.includes(t.id));
      push('t-ct', 'Contact', (b) => b.part === 'tcn');
      push('t-well', t.type === 'n' ? 'p-well' : 'n-well', (b) => b.part === (t.type === 'n' ? 'well-p' : 'well-n'));
      return out;
    }
    m.boxes.forEach((b, i) => {
      if (b.label && m.placed[i]) out.push({ key: `c-${i}`, text: b.label, sel: infoKey(b.part), anchor: boxAnchor(m, i), box: i });
    });
    push('c-sheet', 'Nanosheets', (b) => b.part === 'sheet' && b.min[1] > 35 && b.min[2] < 0);
    push('c-sdp', 'p source/drain (SiGe:B)', (b) => b.part === 'sd-p');
    push('c-sdn', 'n source/drain (Si:P)', (b) => b.part === 'sd-n' && b.min[0] > 20);
    push('c-gcn', 'Gate contact', (b) => b.part === 'gcn');
    push('c-via', 'Via', (b) => b.part === 'via' && b.min[1] >= 96 && b.min[1] < 106);
    push('c-sti', 'Isolation (STI)', (b) => b.part === 'sti' && b.min[2] > 40);
    return out;
  }

  private updateLabels(camera: THREE.PerspectiveCamera, W: number, H: number) {
    const st = this.st;
    const key = st ? `${this.repr}|${st.level}|${st.die}|${st.device}|${st.view}|${st.explode}|${st.hidden.join()}|${st.iso}|${st.sel}` : '';
    if (key !== this.labelKey) {
      this.labelKey = key;
      this.labelRoot.replaceChildren();
      this.labels = this.labelDefs().map((d) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = `chip-lbl${d.cls ? ' ' + d.cls : ''}`;
        el.dataset.sel = d.sel;
        el.innerHTML = '<i></i><span></span>';
        el.querySelector('span')!.textContent = d.text;
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onLabel({ sel: d.sel, box: d.box, die: st?.die ?? undefined });
        });
        this.labelRoot.appendChild(el);
        return { el, key: d.key, sel: d.sel, anchor: d.anchor, box: d.box };
      });
    }
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const l of this.labels) {
      const p = l.anchor();
      if (!p) {
        l.el.style.display = 'none';
        continue;
      }
      _v.copy(p).project(camera);
      const x = (_v.x * 0.5 + 0.5) * W;
      const y = (-_v.y * 0.5 + 0.5) * H;
      const vis = _v.z < 1 && x > 4 && y > 4 && x < W - 4 && y < H - 4;
      if (!vis) {
        l.el.style.display = 'none';
        continue;
      }
      // tag above-right of the anchor, nudged up past tags already placed
      const w = (l.el.querySelector('span') as HTMLElement).offsetWidth || 120;
      // tag to the right of the anchor, or to the left near the right edge; nudged up past tags already placed
      const tx = x + 14 + w > W - 6 ? -14 - w : 14;
      let ty = -30;
      for (let k = 0; k < 7; k++) {
        const r = { x0: x + tx, y0: y + ty - 12, x1: x + tx + w, y1: y + ty + 12 };
        if (!placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)) break;
        ty -= 26;
      }
      placed.push({ x0: x + tx, y0: y + ty - 12, x1: x + tx + w, y1: y + ty + 12 });
      l.el.style.display = '';
      l.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      l.el.style.setProperty('--ty', `${ty}px`);
      l.el.style.setProperty('--tx', `${tx}px`);
      l.el.classList.toggle('on', !!st && (st.sel === l.sel || (l.box !== undefined && st.selBox === l.box)));
    }
  }

  setLabelsVisible(on: boolean) {
    this.labelRoot.style.display = on ? '' : 'none';
  }

  visibleLabels(): string[] {
    return this.labels.filter((l) => l.el.style.display !== 'none' && this.labelRoot.style.display !== 'none').map((l) => l.key);
  }

  // ───────── scale indicator ─────────
  scale(camera: THREE.PerspectiveCamera, target: THREE.Vector3, W: number, H: number) {
    const dist = camera.position.distanceTo(target);
    const fieldUnits = 2 * dist * Math.tan((camera.fov * Math.PI) / 360) * (W / H);
    const fieldUm = fieldUnits * UNIT_UM[this.repr];
    // a bar of a round length, about a fifth of the view
    const target5 = fieldUm / 5;
    const p10 = Math.pow(10, Math.floor(Math.log10(target5)));
    const nice = [1, 2, 5, 10].map((m) => m * p10).reduce((a, b) => (Math.abs(b - target5) < Math.abs(a - target5) ? b : a));
    const barPx = (nice / fieldUm) * W;
    // on a typical screen (≈ 0.26 mm per CSS pixel)
    const mag = (W * 0.2646 * 1000) / fieldUm;
    return { field: fmtLen(fieldUm), bar: fmtLen(nice), barPx, mag, physical: this.repr === 'wafer', unitsPerUm: UNIT_UM_INV[this.repr] };
  }

  /** what is drawn (tests) */
  debug() {
    return {
      repr: this.repr,
      wafer: this.wafer.group.visible,
      dieDetail: this.wafer.dieDetail.visible,
      block: this.block.group.visible ? this.block.counts() : null,
      cell: this.cell.group.visible ? this.cell.counts() : null,
      particles: this.particles.visible ? this.particles.count : 0,
      // boxes trimmed by the current cross-section, and the height of the topmost drawn box (exploded view)
      trimmed: this.cell.group.visible ? this.cell.placed.filter((p, i) => p && (p.max.z < this.cell.boxes[i].max[2] - 1e-3 || p.min.x > this.cell.boxes[i].min[0] + 1e-3)).length : 0,
      topY: Math.max(...(this.cell.group.visible ? this.cell : this.block).placed.filter((p) => p).map((p) => p!.max.y), -1e9),
    };
  }

  /** a screen point that picks `want` (tests): searches the current representation */
  findPoint(camera: THREE.PerspectiveCamera, W: number, H: number, want: (h: ChipHit) => boolean, free: (x: number, y: number) => boolean): { x: number; y: number } | null {
    const ndc = new THREE.Vector2();
    // coarse grid first, then a finer one offset by half a cell
    for (const [nx, ny, off] of [
      [24, 16, 0.5],
      [48, 32, 0.25],
    ])
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          ndc.set(-0.96 + (1.92 * (i + off)) / nx, 0.96 - (1.92 * (j + off)) / ny);
          const x = ((ndc.x + 1) / 2) * W;
          const y = ((1 - ndc.y) / 2) * H;
          if (!free(x, y)) continue;
          const h = this.pick(ndc, camera);
          if (h && want(h)) return { x, y };
        }
    return null;
  }

  regionOf(id: string | null): RegionDef | null {
    return FLOORPLAN.find((f) => f.id === id) ?? null;
  }

  dispose() {
    this.wafer.dispose();
    this.block.dispose();
    this.cell.dispose();
    this.particles.geometry.dispose();
    this.partMats.e.dispose();
    this.partMats.h.dispose();
    (this.outline.material as THREE.Material).dispose();
    (this.hoverBox.material as THREE.Material).dispose();
    this.outline.geometry.dispose();
    this.labelRoot.remove();
  }
}

function fmtLen(um: number): string {
  if (um >= 1000) return `${+(um / 1000).toPrecision(um >= 10000 ? 3 : 2)} mm`;
  if (um >= 1) return `${+um.toPrecision(um >= 10 ? 3 : 2)} µm`;
  return `${+(um * 1000).toPrecision(um * 1000 >= 10 ? 3 : 2)} nm`;
}

export { CHIP_INFO };
