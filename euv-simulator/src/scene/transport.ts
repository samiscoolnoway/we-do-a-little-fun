import * as THREE from 'three';
import {
  ROUTE_BAKE_TO_DEV,
  ROUTE_DEV_TO_ETCH,
  ROUTE_SCANNER_TO_BAKE,
  TOOLS,
  W0,
  polylineAt,
} from '../data/layout';
import { STAGE_START, STAGES } from '../data/stages';
import { easeInOut } from './util';

export type WaferSite = 'scanner' | 'transit' | 'bake' | 'develop' | 'etch';

export interface WaferPose {
  pos: THREE.Vector3;
  at: WaferSite;
  leg: number; // 0 = still in the scanner, 1..3 = journey number
  u: number; // travel progress during a leg 0..1 (1 when parked)
  slabX: number; // x position of the magnified cross-section
  sinceArrival: number; // seconds since the wafer last arrived somewhere
}

/** Duration of each wafer transfer in timeline seconds. */
export const TRAVEL = 3.4;

const LEGS = [
  { stage: 8, route: ROUTE_SCANNER_TO_BAKE, to: 'bake' as const, x0: W0.x, x1: TOOLS.bake.x },
  { stage: 9, route: ROUTE_BAKE_TO_DEV, to: 'develop' as const, x0: TOOLS.bake.x, x1: TOOLS.develop.x },
  { stage: 10, route: ROUTE_DEV_TO_ETCH, to: 'etch' as const, x0: TOOLS.develop.x, x1: TOOLS.etch.x },
];

export function waferPose(T: number, out: WaferPose = { pos: new THREE.Vector3(), at: 'scanner', leg: 0, u: 1, slabX: W0.x, sinceArrival: 0 }): WaferPose {
  out.pos.copy(W0);
  out.at = 'scanner';
  out.leg = 0;
  out.u = 1;
  out.slabX = W0.x;
  out.sinceArrival = T;
  for (let i = 0; i < LEGS.length; i++) {
    const L = LEGS[i];
    const t0 = STAGE_START[L.stage];
    if (T < t0) break;
    const u = Math.min(1, (T - t0) / TRAVEL);
    const e = easeInOut(u);
    out.leg = i + 1;
    out.u = u;
    out.slabX = L.x0 + (L.x1 - L.x0) * e;
    polylineAt(L.route, e, out.pos);
    if (u < 1) {
      out.at = 'transit';
      out.sinceArrival = 0;
      break;
    }
    out.at = L.to;
    out.sinceArrival = T - (t0 + TRAVEL);
  }
  return out;
}

export const STAGE_OF_SITE: Record<string, number> = { scanner: 7, bake: 8, develop: 9, etch: 10 };
export const stageDur = (i: number) => STAGES[i].duration;
