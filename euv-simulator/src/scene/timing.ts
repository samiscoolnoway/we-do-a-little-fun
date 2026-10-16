import * as THREE from 'three';
import type { Atmosphere, ToneMode } from '../data/types';
import { PRE_DELAY, SRC, S_TOTAL } from '../data/layout';
import { STAGE_START } from '../data/stages';

/** Every animated quantity is a pure function of the timeline clock T and these flags. */
export interface FrameCtx {
  T: number;
  dt: number;
  stage: number;
  p: number; // progress within the stage 0..1
  playing: boolean;
  atmosphere: Atmosphere;
  tone: ToneMode;
  dose: number;
  showPath: boolean;
  reach: number; // current animated EUV reach (scene units along the path)
  legs: 1 | 2;
  camera: THREE.PerspectiveCamera;
  pulses: Pulse[];
  emph: (id: string) => number;
  /** enclosure target state (the casing animates towards it) */
  casingOpen: boolean;
  /** id shown in the isolated inspection view, or null */
  inspect: string | null;
}

export interface SimModule {
  group: THREE.Group;
  update(c: FrameCtx): void;
}

// The pre-pulse is enabled from stage 2 onwards, the main pulse from stage 3 onwards.
export const preOnAt = (t: number) => t >= STAGE_START[1];
export const mainOnAt = (t: number) => t >= STAGE_START[2];

/** Time at which the main pulse of shot k reaches the droplet. */
export const tMain = (k: number) => k + SRC.tShot;
export const tPre = (k: number) => k + SRC.tShot - PRE_DELAY;

export interface Pulse {
  k: number;
  tk: number;
  s: number; // distance travelled from the plasma along the optical path
}

const MAX_S = S_TOTAL + 8;
export function euvPulses(T: number): Pulse[] {
  const out: Pulse[] = [];
  const kmax = Math.floor(T - SRC.tShot);
  const kmin = Math.floor(T - SRC.tShot - MAX_S / SRC.v_euv) - 1;
  for (let k = kmin; k <= kmax; k++) {
    const tk = tMain(k);
    if (!mainOnAt(tk)) continue;
    const s = SRC.v_euv * (T - tk);
    if (s < 0 || s > MAX_S) continue;
    out.push({ k, tk, s });
  }
  return out;
}

/** Most recent main-pulse arrival time ≤ T. */
export const lastMainTime = (T: number) => Math.floor(T - SRC.tShot) + SRC.tShot;
export const lastPreTime = (T: number) => Math.floor(T - SRC.tShot + PRE_DELAY) + SRC.tShot - PRE_DELAY;

/** Plasma brightness envelope after the main pulse (τ seconds after arrival). */
export const plasmaEnv = (tau: number) => (tau < 0 ? 0 : Math.min(1, tau / 0.045) * Math.exp(-tau / 0.3));

/** Attenuation of 13.5 nm light in air (visual length scale, hugely exaggerated). */
export const AIR_LEN = 1.25;
export const airAtt = (atm: Atmosphere, s: number) => (atm === 'air' ? Math.exp(-s / AIR_LEN) : 1);

/** Brightness of EUV after n reflections (visual, exaggerated: real mirrors reflect ~0.65). */
export const VIS_R = 0.87;
export const visBrightness = (n: number) => Math.pow(VIS_R, n);

// ───────── step-and-scan: reticle and wafer scan synchronously at a 4:1 speed ratio ─────────
export const SCAN_PERIOD = 6.5;
export function scanState(T: number) {
  const phase = T / SCAN_PERIOD - Math.floor(T / SCAN_PERIOD);
  const slit = Math.min(1, Math.max(0, phase / 0.8));
  const fade = 1 - Math.min(1, Math.max(0, (phase - 0.93) / 0.07));
  return {
    phase,
    slit,
    fade,
    zPlate: -1.25 + 2.5 * slit, // slit position on the mask plate (local z)
    zField: 0.3125 - 0.625 * slit, // slit position on the wafer field (local z) — 4× smaller, opposite direction
  };
}
