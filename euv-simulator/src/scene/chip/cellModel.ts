import * as THREE from 'three';
import { CELL } from '../../data/chip';
import type { Box } from './boxModel';

/**
 * A NAND2 standard cell made of four gate-all-around (GAA) nanosheet transistors, 1 unit = 1 nm.
 * x runs along the cell row (gate pitch direction), z across it (cell height), y up.
 *
 *   VDD rail (z = -70)
 *   p-active  z ∈ [-48, -18]   pFETs A and B in parallel: VDD – pA – Y and VDD – pB – Y
 *   n-active  z ∈ [ 18,  48]   nFETs A and B in series:   VSS – nA – (internal) – nB – Y
 *   VSS rail (z = +70)
 *
 * Gates: dummy (diffusion break) at x = ±72, inputs A at x = -24 and B at x = +24.
 * Source/drain regions sit between the gates at x = -48, 0, +48.
 * Dimensions are typical public values for recent processes, rounded; illustrative only.
 */
export const GATE_X = { A: -24, B: 24, dummyL: -72, dummyR: 72 };
export const P_Z: [number, number] = [-48, -18];
export const N_Z: [number, number] = [18, 48];
const SD_X = [-48, 0, 48];
const HALF_LG = CELL.lg / 2; // 7
const SPACER = 5;
const SHEET_HALF = CELL.sheetT / 2;
const HK = 1.5; // drawn thicker than the real ~1-2 nm stack so it can be seen
const EXT = 90; // half-size of the drawn area around the cell

// stack heights (nm)
export const Y = {
  sub: [-90, -50],
  well: [-50, -15],
  sti: [-15, 0],
  gateTop: 55,
  capTop: 63,
  epiTop: 47,
  contactTop: 70,
  v0: [70, 78],
  m0: [78, 96],
  v1: [96, 106],
  m1: [106, 124],
  v2: [124, 134],
  m2: [134, 154],
  v3: [154, 164],
  m3: [164, 188],
  vtop: [188, 230],
  top: [230, 262],
  pass: [268, 284],
} as const;

/** transistor id from its gate and type */
const tid = (g: 'A' | 'B', t: 'n' | 'p') => `${t}${g}`;

export interface CellBuild {
  boxes: Box[];
  /** per transistor: the region it occupies (used to crop the isolated view) and its channel path */
  devices: Record<string, { crop: THREE.Box3; zs: [number, number]; x0: number; x1: number; type: 'n' | 'p' }>;
}

export function buildCell(): CellBuild {
  const B: Box[] = [];
  const add = (b: Box) => {
    B.push(b);
    return B.length - 1;
  };
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, rest: Omit<Box, 'min' | 'max'>) =>
    add({ min: [x0, y0, z0], max: [x1, y1, z1], ...rest });

  // ── substrate, wells, isolation, active regions ──
  box(-EXT, EXT, Y.sub[0], Y.sub[1], -EXT, EXT, { mat: 'substrate', part: 'substrate', layer: 'sub' });
  box(-EXT, EXT, Y.well[0], Y.well[1], -EXT, 0, { mat: 'nwell', part: 'well-n', layer: 'sub', devs: ['pA', 'pB'] });
  box(-EXT, EXT, Y.well[0], Y.well[1], 0, EXT, { mat: 'pwell', part: 'well-p', layer: 'sub', devs: ['nA', 'nB'] });
  for (const [z0, z1] of [
    [-EXT, P_Z[0]],
    [P_Z[1], N_Z[0]],
    [N_Z[1], EXT],
  ])
    box(-EXT, EXT, Y.sti[0], Y.sti[1], z0, z1, { mat: 'sti', part: 'sti', layer: 'iso' });
  box(-EXT, EXT, Y.sti[0], Y.sti[1], P_Z[0], P_Z[1], { mat: 'si', part: 'mesa', layer: 'iso', devs: ['pA', 'pB'] });
  box(-EXT, EXT, Y.sti[0], Y.sti[1], N_Z[0], N_Z[1], { mat: 'si', part: 'mesa', layer: 'iso', devs: ['nA', 'nB'] });

  // ── gates with their channels, dielectric, spacers and caps ──
  for (const g of ['A', 'B'] as const) {
    const x = GATE_X[g];
    for (const [t, zs, zg] of [
      ['p', P_Z, [-56, 0]],
      ['n', N_Z, [0, 56]],
    ] as const) {
      const id = tid(g, t);
      const devs = [id];
      // the gate line wraps all the way around every sheet (gate-all-around)
      box(x - HALF_LG, x + HALF_LG, 0, Y.gateTop, zg[0], zg[1], { mat: 'gate', part: 'gate', layer: 'fe', devs, label: t === 'p' && g === 'A' ? 'Gate (input A)' : undefined });
      box(x - HALF_LG, x + HALF_LG, Y.gateTop, Y.capTop, zg[0], zg[1], { mat: 'cap', part: 'cap', layer: 'fe', devs });
      for (const s of [-1, 1])
        box(s < 0 ? x - HALF_LG - SPACER : x + HALF_LG, s < 0 ? x - HALF_LG : x + HALF_LG + SPACER, 0, Y.capTop, zg[0], zg[1], { mat: 'spacer', part: 'spacer', layer: 'fe', devs });
      for (const yc of CELL.sheets) {
        // sheet: under the gate and through the spacers, ending on the source/drain epitaxy
        box(x - HALF_LG - SPACER, x + HALF_LG + SPACER, yc - SHEET_HALF, yc + SHEET_HALF, zs[0], zs[1], { mat: 'sheet', part: 'sheet', layer: 'fe', devs, nest: 2 });
        // high-k dielectric coating the sheet where the gate surrounds it
        box(x - HALF_LG, x + HALF_LG, yc - SHEET_HALF - HK, yc + SHEET_HALF + HK, zs[0] - HK, zs[1] + HK, { mat: 'hk', part: 'hk', layer: 'fe', devs, nest: 1 });
      }
    }
  }
  // dummy gates at the cell edges isolate it from its neighbours (diffusion break)
  for (const x of [GATE_X.dummyL, GATE_X.dummyR]) {
    box(x - HALF_LG, x + HALF_LG, 0, Y.gateTop, -56, 56, { mat: 'gate', part: 'dummy', layer: 'fe' });
    box(x - HALF_LG, x + HALF_LG, Y.gateTop, Y.capTop, -56, 56, { mat: 'cap', part: 'cap', layer: 'fe' });
    for (const s of [-1, 1]) box(s < 0 ? x - HALF_LG - SPACER : x + HALF_LG, s < 0 ? x - HALF_LG : x + HALF_LG + SPACER, 0, Y.capTop, -56, 56, { mat: 'spacer', part: 'spacer', layer: 'fe' });
  }

  // ── source/drain epitaxy between the gates ──
  // devices on each side: left of A, between A and B, right of B
  const sdDevs = (t: 'n' | 'p', k: number) => (k === 0 ? [tid('A', t)] : k === 1 ? [tid('A', t), tid('B', t)] : [tid('B', t)]);
  SD_X.forEach((x, k) => {
    const x0 = x - 12;
    const x1 = x + 12;
    box(x0, x1, 0, Y.epiTop, P_Z[0] - 3, P_Z[1] + 3, { mat: 'epip', part: 'sd-p', layer: 'fe', devs: sdDevs('p', k), nest: 1 });
    box(x0, x1, 0, Y.epiTop, N_Z[0] - 3, N_Z[1] + 3, { mat: 'epin', part: 'sd-n', layer: 'fe', devs: sdDevs('n', k), nest: 1 });
  });

  // ── contacts ──
  // p side: left and right S/D tie to VDD (contacts reach under the VDD rail), middle is the output Y
  // n side: left S/D ties to VSS, the middle node between the series nFETs has no contact, right is the output Y
  const tcn = (x: number, z0: number, z1: number, devs: string[], label?: string) =>
    box(x - 7, x + 7, Y.epiTop - 7, Y.contactTop, z0, z1, { mat: 'contact', part: 'tcn', layer: 'ct', devs, nest: 2, label });
  tcn(-48, -70, P_Z[1] - 2, ['pA']);
  tcn(0, P_Z[0] + 2, P_Z[1] - 2, ['pA', 'pB'], 'Contact');
  tcn(48, -70, P_Z[1] - 2, ['pB']);
  tcn(-48, N_Z[0] + 2, 70, ['nA']);
  tcn(48, N_Z[0] + 2, N_Z[1] - 2, ['nB']);
  // gate contacts between the n and p regions
  for (const [g, zc] of [
    ['A', -11],
    ['B', 11],
  ] as const)
    box(GATE_X[g] - 5, GATE_X[g] + 5, Y.gateTop, Y.contactTop, zc - 5, zc + 5, { mat: 'contact', part: 'gcn', layer: 'ct', devs: [tid(g, 'n'), tid(g, 'p')], nest: 2 });

  // ── V0 + M0 local interconnect ──
  const via = (x: number, z: number, y: readonly [number, number], layer: string, s = 10) => box(x - s / 2, x + s / 2, y[0], y[1], z - s / 2, z + s / 2, { mat: 'via', part: 'via', layer, nest: 1 });
  const line = (x0: number, x1: number, z0: number, z1: number, y: readonly [number, number], layer: string, part: string, mat: 'copper' | 'copperTop' = 'copper', label?: string) =>
    box(x0, x1, y[0], y[1], z0, z1, { mat, part, layer, label });
  for (const [x, z] of [
    [-48, -70],
    [48, -70],
    [-48, 70],
    [0, -42],
    [48, 42],
    [-24, -11],
    [24, 11],
  ])
    via(x, z, Y.v0, 'ct');
  line(-EXT, EXT, -82, -58, Y.m0, 'm0', 'rail', 'copper', 'VDD rail');
  line(-EXT, EXT, 58, 82, Y.m0, 'm0', 'rail', 'copper');
  line(-8, 56, -48, -36, Y.m0, 'm0', 'm0', 'copper', 'M0');
  line(40, 56, 36, 48, Y.m0, 'm0', 'm0');
  line(-36, -12, -17, -5, Y.m0, 'm0', 'm0');
  line(12, 36, 5, 17, Y.m0, 'm0', 'm0');

  // ── V1 + M1 (front–back) ──
  via(48, -42, Y.v1, 'm1');
  via(48, 42, Y.v1, 'm1');
  via(-24, -11, Y.v1, 'm1');
  via(24, 11, Y.v1, 'm1');
  line(42, 54, -48, 48, Y.m1, 'm1', 'm1', 'copper', 'M1 (output Y)');
  line(-30, -18, -24, 0, Y.m1, 'm1', 'm1');
  line(18, 30, 0, 24, Y.m1, 'm1', 'm1');

  // ── V2 + M2 (left–right): the cell's pins, plus wires passing over it ──
  via(-24, -18, Y.v2, 'm2');
  via(24, 14, Y.v2, 'm2');
  via(48, 14, Y.v2, 'm2');
  line(-EXT, -16, -25, -11, Y.m2, 'm2', 'm2', 'copper', 'M2');
  line(-10, 30, 7, 21, Y.m2, 'm2', 'm2');
  line(40, EXT, 7, 21, Y.m2, 'm2', 'm2');
  line(-EXT, EXT, -57, -43, Y.m2, 'm2', 'm2');
  line(-EXT, EXT, 39, 53, Y.m2, 'm2', 'm2');

  // ── V3 + M3 (front–back) ──
  via(72, 14, Y.v3, 'm3', 12);
  for (const x of [-48, 0, 72]) line(x - 8, x + 8, -EXT, EXT, Y.m3, 'm3', 'm3');

  // ── power: via stacks from the rails up to the thick upper straps (VDD at the back, VSS at the front) ──
  for (const [x, z] of [
    [-82, -70],
    [82, 70],
  ]) {
    via(x, z, Y.v1, 'm1', 12);
    line(x - 7, x + 7, z - 7, z + 7, Y.m1, 'm1', 'm1');
    via(x, z, Y.v2, 'm2', 12);
    line(x - 7, x + 7, z - 7, z + 7, Y.m2, 'm2', 'm2');
    via(x, z, Y.v3, 'm3', 12);
    line(x - 7, x + 7, z - 7, z + 7, Y.m3, 'm3', 'm3');
    via(x, z, Y.vtop, 'top', 14);
  }
  line(-EXT, EXT, -86, -54, Y.top, 'top', 'top', 'copperTop', 'Upper metal (VDD strap)');
  line(-EXT, EXT, 54, 86, Y.top, 'top', 'top', 'copperTop');

  // ── insulating fill between conductors (translucent), level by level, and the passivation on top ──
  const diel = (y0: number, y1: number, layer: string, part: string) => box(-EXT, EXT, y0, y1, -EXT, EXT, { mat: 'dielectric', part, layer, diel: true });
  diel(0, Y.v0[1], 'ct', 'pmd');
  diel(Y.m0[0], Y.m0[1], 'm0', 'ild');
  diel(Y.v1[0], Y.m1[1], 'm1', 'ild');
  diel(Y.v2[0], Y.m2[1], 'm2', 'ild');
  diel(Y.v3[0], Y.m3[1], 'm3', 'ild');
  diel(Y.vtop[0], Y.top[1], 'top', 'ild');
  box(-EXT, EXT, Y.pass[0], Y.pass[1], -EXT, EXT, { mat: 'pass', part: 'pass', layer: 'pass' });

  // per transistor: crop region for the isolated view, channel span for the illustrative carrier flow
  const devices: CellBuild['devices'] = {};
  for (const g of ['A', 'B'] as const)
    for (const t of ['n', 'p'] as const) {
      const zs = t === 'n' ? N_Z : P_Z;
      const x = GATE_X[g];
      devices[tid(g, t)] = {
        crop: new THREE.Box3(new THREE.Vector3(x - 36, -40, zs[0] - 10), new THREE.Vector3(x + 36, Y.contactTop, zs[1] + 10)),
        zs,
        x0: x - 24,
        x1: x + 24,
        type: t,
      };
    }
  return { boxes: B, devices };
}
