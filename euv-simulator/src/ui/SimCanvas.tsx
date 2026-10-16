import { useEffect, useRef } from 'react';
import { SceneController } from '../scene/SceneController';
import { COMPONENT_LIST } from '../data/components';
import { CONCEPTS } from '../data/concepts';
import { LABELS } from '../data/labels';
import { QUIZ } from '../data/quiz';
import { STAGES, STAGE_START, T_TOTAL } from '../data/stages';
import { sim } from '../store/sim';

declare global {
  interface Window {
    __euv?: { sim: typeof sim; scene: SceneController | null; starts: number[]; durations: number[]; total: number; data: unknown };
  }
}

/** Measure the overlay cards so the 3-D view can be framed in the free part of the canvas. */
function useInsets() {
  useEffect(() => {
    const vp = document.querySelector('.viewport') as HTMLElement | null;
    if (!vp) return;
    const measure = () => {
      const ctl = window.__euv?.scene;
      if (!ctl) return;
      const vr = vp.getBoundingClientRect();
      const mobile = window.matchMedia('(max-width: 900px)').matches;
      const card = vp.querySelector('.stage-card') as HTMLElement | null;
      const foot = vp.querySelector('.viewport-foot') as HTMLElement | null;
      const panel = document.querySelector('.panel') as HTMLElement | null;
      let l = 0;
      let t = 0;
      let b = 0;
      if (card) {
        const cr = card.getBoundingClientRect();
        if (mobile) t = Math.max(0, cr.bottom - vr.top + 4);
        else if (cr.height > 120) l = Math.max(0, cr.right - vr.left + 6);
      }
      if (foot) {
        const fr = foot.getBoundingClientRect();
        b = Math.max(0, vr.bottom - fr.top + 2);
      }
      if (mobile && panel && !panel.hidden) b = Math.max(b, vr.bottom - panel.getBoundingClientRect().top + 4);
      ctl.setInsets({ l, r: 0, t, b });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(vp);
    for (const sel of ['.stage-card', '.viewport-foot', '.panel']) {
      const el = document.querySelector(sel);
      if (el) ro.observe(el);
    }
    const iv = window.setInterval(measure, 600); // catches class/hidden changes that do not resize anything
    window.addEventListener('resize', measure);
    window.addEventListener('euv-ready', measure);
    measure();
    return () => {
      ro.disconnect();
      window.clearInterval(iv);
      window.removeEventListener('resize', measure);
      window.removeEventListener('euv-ready', measure);
    };
  }, []);
}

/** Hosts the Three.js scene. All UI state flows through the central store. */
export function SimCanvas() {
  const host = useRef<HTMLDivElement>(null);
  useInsets();
  useEffect(() => {
    const el = host.current!;
    let ctl: SceneController | null = null;
    try {
      ctl = new SceneController(el);
      sim.setWebgl('ok');
    } catch (err) {
      console.error('WebGL initialisation failed', err);
      sim.setWebgl('failed');
    }
    const meta = {
      starts: STAGE_START,
      durations: STAGES.map((s) => s.duration),
      total: T_TOTAL,
      // read-only copies of the content tables, used by the automated tests
      data: { STAGES, COMPONENT_LIST, LABELS: LABELS.map((l) => ({ id: l.id, comp: l.comp, kind: l.kind })), CONCEPTS: CONCEPTS.map((c) => c.id), QUIZ },
    };
    window.__euv = { sim, scene: ctl, ...meta };
    window.dispatchEvent(new Event('euv-ready'));
    return () => {
      ctl?.dispose();
      if (window.__euv?.scene === ctl) window.__euv = { sim, scene: null, ...meta };
    };
  }, []);
  return <div className="viewport-gl" ref={host} />;
}
