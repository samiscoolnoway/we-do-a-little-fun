import * as THREE from 'three';
import { LABELS, LabelCtx, LabelDef } from '../data/labels';
import { STAGES } from '../data/stages';
import type { ToneMode, ViewMode } from '../data/types';

interface Item {
  def: LabelDef;
  el: HTMLButtonElement;
  textEl: HTMLSpanElement;
  subEl: HTMLSpanElement;
  line: SVGLineElement;
  dot: SVGCircleElement;
  w: number;
  h: number;
  x: number;
  y: number;
  shown: boolean;
  cand: number;
  lastText: string;
  lastSub: string;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** weight of an overlap with this obstacle (default 1); a soft obstacle may be touched when that gives a much shorter leader */
  soft?: number;
}

export interface LabelUpdate {
  camera: THREE.PerspectiveCamera;
  width: number;
  height: number;
  dt: number;
  enabled: boolean;
  view: ViewMode;
  focusId: string | null;
  stage: number;
  tone: ToneMode;
  resolve: (d: LabelDef) => THREE.Vector3 | null;
  hoverComp: string | null;
  selectedComp: string | null;
  obstacles: Rect[];
  /** place labels at their targets immediately instead of easing (used by tests and after resizes) */
  snap?: boolean;
  /** show at most this many labels (tags excluded), highest priority first: keeps small screens readable */
  maxLabels?: number;
  /** labels of this component are drawn first, so they survive the cap */
  preferComp?: string | null;
}

const CAND: [number, number][] = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [0, -1.35],
  [0, 1.35],
  [1.5, 0],
  [-1.5, 0],
  [1.7, 1.6],
  [-1.7, 1.6],
  [1.7, -1.6],
  [-1.7, -1.6],
];

const _v = new THREE.Vector3();

/** DOM labels anchored to 3-D positions with leader lines, collision avoidance and click-through to the inspector. */
export class LabelLayer {
  root: HTMLDivElement;
  private svg: SVGSVGElement;
  private items: Item[] = [];
  private box: HTMLDivElement;
  private resizeObs: ResizeObserver | null = null;
  private compact = false;

  constructor(host: HTMLElement, private onPick: (comp: string) => void, private onHover: (comp: string | null) => void) {
    this.root = document.createElement('div');
    this.root.className = 'label-layer';
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'leader-layer');
    this.svg.setAttribute('aria-hidden', 'true');
    this.root.appendChild(this.svg);
    this.box = document.createElement('div');
    this.box.className = 'sel-box';
    this.box.setAttribute('aria-hidden', 'true');
    this.box.innerHTML = '<i></i><i></i><i></i><i></i>';
    this.root.appendChild(this.box);
    for (const def of LABELS) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `lbl lbl-${def.kind ?? 'part'} is-hidden`;
      el.dataset.id = def.id;
      el.dataset.comp = def.comp;
      el.style.setProperty('--c', `var(--c-${def.color})`);
      const textEl = document.createElement('span');
      textEl.className = 'lbl-text';
      const subEl = document.createElement('span');
      subEl.className = 'lbl-sub';
      el.append(textEl, subEl);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onPick(def.comp);
      });
      el.addEventListener('pointerenter', () => this.onHover(def.comp));
      el.addEventListener('pointerleave', () => this.onHover(null));
      el.addEventListener('focus', () => this.onHover(def.comp));
      el.addEventListener('blur', () => this.onHover(null));
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('class', 'leader');
      line.style.setProperty('--c', `var(--c-${def.color})`);
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('class', 'anchor');
      dot.setAttribute('r', '3.2');
      dot.style.setProperty('--c', `var(--c-${def.color})`);
      this.svg.append(line, dot);
      this.root.appendChild(el);
      this.items.push({ def, el, textEl, subEl, line, dot, w: 100, h: 28, x: 0, y: 0, shown: false, cand: 0, lastText: '', lastSub: '' });
    }
    host.appendChild(this.root);
    this.resizeObs = new ResizeObserver(() => this.items.forEach((i) => (i.w = 0)));
    this.resizeObs.observe(host);
    if ((document as any).fonts?.ready) (document as any).fonts.ready.then(() => this.items.forEach((i) => (i.w = 0)));
  }

  dispose() {
    this.resizeObs?.disconnect();
    this.root.remove();
  }

  /** Number of labels currently shown (used by tests). */
  visibleIds(): string[] {
    return this.items.filter((i) => i.shown).map((i) => i.def.id);
  }

  private wanted(it: Item, u: LabelUpdate, ctx: LabelCtx): boolean {
    if (!u.enabled) return false;
    const d = it.def;
    if (d.show && !d.show(ctx)) return false;
    const inStage = STAGES[u.stage].labels.includes(d.id);
    if (u.view === 'machine') return u.width < 700 ? inStage : !!d.overview || inStage;
    if (u.view === 'component') return d.comp === u.focusId || (inStage && d.comp === u.focusId);
    return inStage;
  }

  setBracket(rect: { x0: number; y0: number; x1: number; y1: number } | null) {
    if (!rect) {
      this.box.style.opacity = '0';
      return;
    }
    const pad = 8;
    this.box.style.opacity = '1';
    this.box.style.transform = `translate(${rect.x0 - pad}px, ${rect.y0 - pad}px)`;
    this.box.style.width = `${rect.x1 - rect.x0 + pad * 2}px`;
    this.box.style.height = `${rect.y1 - rect.y0 + pad * 2}px`;
  }

  update(u: LabelUpdate) {
    const ctx: LabelCtx = { tone: u.tone, stage: u.stage };
    const scale = Math.min(1, Math.max(0.72, u.width / 1100));
    const margin = 10;
    const compact = u.view === 'machine';
    if (compact !== this.compact) {
      this.compact = compact;
      this.root.classList.toggle('is-overview', compact);
      this.items.forEach((i) => (i.w = 0));
    }
    // overlay cards are obstacles: labels are laid out around them
    const placed: Rect[] = u.obstacles.map((o) => ({ ...o }));
    const stageLabels = STAGES[u.stage].labels;

    // priority: stage labels first (in listed order), then the remaining overview labels, zones last
    const order = this.items
      .map((it) => {
        const d = it.def;
        let pr = d.kind === 'tag' ? -10 : (stageLabels.indexOf(d.id) >= 0 ? stageLabels.indexOf(d.id) : 50) + (d.kind === 'zone' ? 100 : 0);
        if (u.preferComp && d.comp === u.preferComp && d.kind !== 'tag') pr = Math.min(pr, 0) - 5;
        return { it, pr };
      })
      .sort((a, b) => a.pr - b.pr);
    const cap = u.maxLabels ?? Infinity;
    let drawn = 0;

    for (const { it } of order) {
      const d = it.def;
      const want = this.wanted(it, u, ctx);
      let anchor: THREE.Vector3 | null = null;
      if (want) anchor = u.resolve(d);
      let sx = 0;
      let sy = 0;
      let ok = false;
      if (anchor) {
        _v.copy(anchor).project(u.camera);
        sx = (_v.x * 0.5 + 0.5) * u.width;
        sy = (-_v.y * 0.5 + 0.5) * u.height;
        ok = _v.z < 1 && _v.z > -1 && sx > -30 && sx < u.width + 30 && sy > -30 && sy < u.height + 30;
      }
      if (ok && d.kind !== 'tag') {
        if (drawn >= cap) ok = false;
        else drawn++;
      }
      if (!ok) {
        if (it.shown) {
          it.shown = false;
          it.el.classList.add('is-hidden');
          it.line.style.opacity = '0';
          it.dot.style.opacity = '0';
        }
        continue;
      }
      // text
      const text = typeof d.text === 'function' ? d.text(ctx) : d.text;
      const sub = d.sub ? (typeof d.sub === 'function' ? d.sub(ctx) : d.sub) : '';
      if (text !== it.lastText || sub !== it.lastSub) {
        it.textEl.textContent = text;
        it.subEl.textContent = sub;
        it.subEl.style.display = sub ? '' : 'none';
        it.lastText = text;
        it.lastSub = sub;
        it.w = 0;
      }
      if (!it.w) {
        it.w = it.el.offsetWidth || 120;
        it.h = it.el.offsetHeight || 28;
      }
      const wasShown = it.shown;
      it.shown = true;
      it.el.classList.remove('is-hidden');
      const active = stageLabels.includes(d.id);
      it.el.classList.toggle('is-active', active);
      it.el.classList.toggle('is-dim', u.view === 'machine' && !active);
      const hot = u.hoverComp === d.comp || u.selectedComp === d.comp;
      it.el.classList.toggle('is-hot', hot);

      // candidate positions around the anchor
      const [ox, oy] = d.off;
      const baseX = ox * scale;
      const baseY = oy * scale;
      const SCALES = [1, 1.7, 2.5];
      const total = 1 + CAND.length * SCALES.length;
      const tryRect = (ci: number) => {
        let cx: number;
        let cy: number;
        if (ci === 0) {
          cx = baseX;
          cy = baseY;
        } else {
          const k = ci - 1;
          const [mx, my] = CAND[k % CAND.length];
          const sc = SCALES[Math.floor(k / CAND.length)];
          const dx = Math.max(60, Math.abs(baseX)) + 14;
          const dy = Math.max(34, Math.abs(baseY)) + 10;
          cx = mx * dx * sc;
          cy = my * dy * sc;
        }
        const x0 = sx + cx - it.w / 2;
        const y0 = sy + cy - it.h / 2;
        return { x0, y0, x1: x0 + it.w, y1: y0 + it.h };
      };
      const inside = (r: { x0: number; y0: number; x1: number; y1: number }) => r.x0 >= margin && r.y0 >= margin && r.x1 <= u.width - margin && r.y1 <= u.height - margin;
      const overlap = (r: { x0: number; y0: number; x1: number; y1: number }) => {
        let a = 0;
        for (const p of placed) {
          const w = Math.min(r.x1, p.x1 + 6) - Math.max(r.x0, p.x0 - 6);
          const h = Math.min(r.y1, p.y1 + 4) - Math.max(r.y0, p.y0 - 4);
          if (w > 0 && h > 0) a += w * h * (p.soft ?? 1);
        }
        return a;
      };
      // distance from the anchor to the nearest point of a candidate box = the length of its leader line
      const leader = (r: { x0: number; y0: number; x1: number; y1: number }) => Math.hypot(Math.max(r.x0 - sx, 0, sx - r.x1), Math.max(r.y0 - sy, 0, sy - r.y1));
      // Cost of a spot: overlaps and leaving the view dominate, then a short leader line, then the preferred position.
      // The label keeps its current spot unless another one is clearly cheaper (a margin stops flicker), so the
      // arrangement converges to the same result whatever path the camera took to get here.
      const cost = (ci: number) => {
        const r = tryRect(ci);
        return overlap(r) + (inside(r) ? 0 : 5000) + leader(r) * 0.6 + (ci === 0 ? 0 : 10) + (ci === it.cand ? 0 : 30);
      };
      let best = it.cand;
      let bestCost = cost(best);
      if (bestCost > 0) {
        for (let ci = 0; ci < total; ci++) {
          if (ci === it.cand) continue;
          const c = cost(ci);
          if (c < bestCost) {
            bestCost = c;
            best = ci;
          }
        }
      }
      const bestR = tryRect(best);
      it.cand = best;
      // clamp into view as a last resort
      const w = bestR.x1 - bestR.x0;
      const h = bestR.y1 - bestR.y0;
      const tx = Math.min(Math.max(bestR.x0, margin), Math.max(margin, u.width - margin - w));
      const ty = Math.min(Math.max(bestR.y0, margin), Math.max(margin, u.height - margin - h));
      if (!wasShown || u.snap) {
        it.x = tx;
        it.y = ty;
      } else {
        const k = 1 - Math.exp(-u.dt * 16);
        it.x += (tx - it.x) * k;
        it.y += (ty - it.y) * k;
      }
      it.el.style.transform = `translate(${it.x.toFixed(1)}px, ${it.y.toFixed(1)}px)`;
      placed.push({ x0: it.x, y0: it.y, x1: it.x + w, y1: it.y + h });

      // leader from the anchor to the nearest point of the box
      const qx = Math.min(Math.max(sx, it.x), it.x + w);
      const qy = Math.min(Math.max(sy, it.y), it.y + h);
      const inBox = sx >= it.x && sx <= it.x + w && sy >= it.y && sy <= it.y + h;
      it.line.setAttribute('x1', sx.toFixed(1));
      it.line.setAttribute('y1', sy.toFixed(1));
      it.line.setAttribute('x2', qx.toFixed(1));
      it.line.setAttribute('y2', qy.toFixed(1));
      it.dot.setAttribute('cx', sx.toFixed(1));
      it.dot.setAttribute('cy', sy.toFixed(1));
      const dim = u.view === 'machine' && !active ? 0.45 : 1;
      it.line.style.opacity = inBox ? '0' : String(0.85 * dim);
      it.dot.style.opacity = String(dim);
      it.line.classList.toggle('is-hot', hot);
      it.dot.classList.toggle('is-hot', hot);
    }
  }
}
