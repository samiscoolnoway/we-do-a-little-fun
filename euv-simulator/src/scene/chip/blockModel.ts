import { BLOCK } from '../../data/chip';
import type { Box } from './boxModel';

/**
 * A representative 4 µm × 2.6 µm circuit region, 1 unit = 10 nm, centred on the origin.
 * Left: 18 rows of standard cells (cell height 140 nm, gate pitch 48 nm). Right: an SRAM array of 6T bit cells
 * with word-line drivers and sense amplifiers. Above: M1–M3 signal wiring, a clock H-tree and the power grid.
 * Cell sequence and wiring are generated from a fixed pseudo-random sequence: representative, not a real layout.
 */
export interface CellRec {
  /** index into the cell list */
  i: number;
  type: string;
  row: number;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
export interface BlockBuild {
  boxes: Box[];
  cells: CellRec[];
  sramCells: { i: number; x0: number; x1: number; z0: number; z1: number }[];
  /** centre of the area to frame for logic and for SRAM */
  logic: { x: number; z: number; w: number; d: number };
  sram: { x: number; z: number; w: number; d: number };
}

const LIB: [string, number][] = [
  ['INV', 2],
  ['NAND2', 3],
  ['NOR2', 3],
  ['AOI21', 4],
  ['BUF', 3],
  ['NAND2', 3],
  ['DFF', 11],
  ['INV', 2],
  ['OAI22', 5],
  ['NAND3', 4],
  ['XOR2', 6],
  ['FILL', 1],
];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function buildBlock(): BlockBuild {
  const B: Box[] = [];
  const cells: CellRec[] = [];
  const sramCells: BlockBuild['sramCells'] = [];
  const r = rng(20251016);
  const add = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, rest: Omit<Box, 'min' | 'max'>) => {
    B.push({ min: [x0, y0, z0], max: [x1, y1, z1], ...rest });
    return B.length - 1;
  };
  const W2 = BLOCK.w / 2; // 200
  const D2 = BLOCK.d / 2; // 130
  const LX0 = -W2; // logic area x from -200 …
  const LX1 = -W2 + BLOCK.logicW; // … to 50
  const SX0 = -W2 + BLOCK.sramX0; // SRAM from 62 …
  const SX1 = W2;
  const rows = 18;
  const RZ0 = -(rows * BLOCK.rowH) / 2; // -126
  const cpp = BLOCK.cpp;
  // heights (10 nm units)
  const Y = { sub: [-6, -0.6], act: [-0.6, 2.6], gate: [0, 5.5], ct: [2.6, 7.8], m0: [7.8, 9.6], v1: [9.6, 10.8], m1: [10.8, 12.6], v2: [12.6, 13.6], m2: [13.6, 15.6], v3: [15.6, 16.8], m3: [16.8, 19.2], clk: [24, 26.5], pg1: [28, 31], pgv: [31, 34], pg2: [34, 40] };

  // substrate under everything
  add(-W2, W2, Y.sub[0], Y.sub[1], -D2, D2, { mat: 'substrate', part: 'substrate', layer: 'sub' });

  // ── standard-cell rows ──
  for (let row = 0; row < rows; row++) {
    const z0 = RZ0 + row * BLOCK.rowH;
    const z1 = z0 + BLOCK.rowH;
    const flip = row % 2 === 1;
    // active strips: p next to the VDD rail, n next to the VSS rail (rows alternate orientation)
    const pz: [number, number] = flip ? [z1 - 5.4, z1 - 2.4] : [z0 + 2.4, z0 + 5.4];
    const nz: [number, number] = flip ? [z0 + 2.4, z0 + 5.4] : [z1 - 5.4, z1 - 2.4];
    let x = LX0 + 0.4;
    while (x < LX1 - 2 * cpp) {
      const [type, wc] = LIB[Math.floor(r() * LIB.length)];
      const w = Math.min(wc, Math.floor((LX1 - x) / cpp));
      if (w < 1) break;
      const ci = cells.length;
      const x1 = x + w * cpp;
      cells.push({ i: ci, type, row, x0: x, x1, z0, z1 });
      const tag = { group: 'blk-cells', cell: ci, layer: 'fe' } as const;
      if (type !== 'FILL') {
        add(x + 0.8, x1 - 0.8, Y.act[0], Y.act[1], pz[0], pz[1], { mat: 'si', part: 'mesa', ...tag, layer: 'iso' });
        add(x + 0.8, x1 - 0.8, Y.act[0], Y.act[1], nz[0], nz[1], { mat: 'si', part: 'mesa', ...tag, layer: 'iso' });
        for (let k = 1; k < w; k++) {
          const gx = x + k * cpp;
          add(gx - 0.7, gx + 0.7, Y.gate[0], Y.gate[1], z0 + 1.4, z1 - 1.4, { mat: 'gate', part: 'gate', ...tag });
        }
        // contacts on some of the source/drain regions, gate contacts on some gates
        for (let k = 0; k < w; k++) {
          const sx = x + (k + 0.5) * cpp;
          if (r() < 0.62) add(sx - 0.7, sx + 0.7, Y.ct[0], Y.ct[1], pz[0] + 0.4, pz[1] - 0.4, { mat: 'contact', part: 'tcn', ...tag, layer: 'ct' });
          if (r() < 0.55) add(sx - 0.7, sx + 0.7, Y.ct[0], Y.ct[1], nz[0] + 0.4, nz[1] - 0.4, { mat: 'contact', part: 'tcn', ...tag, layer: 'ct' });
        }
        // local M0 wiring inside the cell
        const tracks = [z0 + 4.2, z0 + 7, z0 + 9.8];
        const nseg = 1 + Math.floor(r() * 2);
        for (let s = 0; s < nseg; s++) {
          const tz = tracks[Math.floor(r() * tracks.length)];
          const a = x + cpp * (0.3 + Math.floor(r() * Math.max(1, w - 1)));
          const len = cpp * (1 + Math.floor(r() * Math.min(3, w)));
          add(a, Math.min(a + len, x1 - 0.4), Y.m0[0], Y.m0[1], tz - 0.6, tz + 0.6, { mat: 'copper', part: 'm0', ...tag, layer: 'm0' });
        }
        // the cell's pin on M1 (front–back) with its via
        const px = x + cpp * (0.5 + Math.floor(r() * w));
        add(px - 0.6, px + 0.6, Y.m1[0], Y.m1[1], z0 + 3.5, z1 - 3.5, { mat: 'copper', part: 'm1', group: 'blk-signal', layer: 'm1' });
        add(px - 0.6, px + 0.6, Y.v1[0], Y.v1[1], z0 + 6.4, z0 + 7.6, { mat: 'via', part: 'via', group: 'blk-signal', layer: 'm1' });
      }
      // diffusion break / dummy gate at the cell boundary
      add(x - 0.7, x + 0.7, Y.gate[0], Y.gate[1], z0 + 1.4, z1 - 1.4, { mat: 'gate', part: 'dummy', group: 'blk-cells', cell: ci, layer: 'fe' });
      x = x1;
    }
  }
  // supply rails at every row boundary (shared by neighbouring rows), part of the power network
  for (let k = 0; k <= rows; k++) {
    const z = RZ0 + k * BLOCK.rowH;
    add(LX0, LX1, Y.m0[0], Y.m0[1], z - 1.2, z + 1.2, { mat: 'copper', part: 'rail', group: 'blk-power', layer: 'm0', label: k === 9 ? (k % 2 ? 'VSS rail' : 'VDD rail') : undefined });
  }

  // ── signal routing over the logic: M2 left–right, M3 front–back ──
  for (let t = 0; t < 32; t++) {
    const z = RZ0 + 3 + t * 7.8 + (r() - 0.5);
    let x = LX0 + r() * 40;
    while (x < LX1 - 20) {
      const len = 18 + r() * 70;
      const x1 = Math.min(x + len, LX1 - 2);
      if (r() < 0.6) {
        add(x, x1, Y.m2[0], Y.m2[1], z - 0.8, z + 0.8, { mat: 'copper', part: 'm2', group: 'blk-signal', layer: 'm2', label: t === 16 && !B.some((b) => b.label === 'Signal routing (M2)') ? 'Signal routing (M2)' : undefined });
        add(x, x + 1.4, Y.v2[0], Y.v2[1], z - 0.7, z + 0.7, { mat: 'via', part: 'via', group: 'blk-signal', layer: 'm2' });
      }
      x = x1 + 4 + r() * 20;
    }
  }
  for (let t = 0; t < 18; t++) {
    const x = LX0 + 6 + t * 13.6 + (r() - 0.5);
    let z = -D2 + r() * 40;
    while (z < D2 - 20) {
      const len = 30 + r() * 110;
      const z1 = Math.min(z + len, D2 - 4);
      if (r() < 0.65) {
        add(x - 1, x + 1, Y.m3[0], Y.m3[1], z, z1, { mat: 'copper', part: 'm3', group: 'blk-signal', layer: 'm3' });
        add(x - 0.8, x + 0.8, Y.v3[0], Y.v3[1], z + 1, z + 2.6, { mat: 'via', part: 'via', group: 'blk-signal', layer: 'm3' });
      }
      z = z1 + 6 + r() * 30;
    }
  }

  // ── SRAM array: word-line drivers on the left, sense amplifiers at the bottom ──
  const cw = 20;
  const ch = 10.5;
  const AX0 = SX0 + 16;
  const AZ0 = -118;
  const cols = 6;
  const nrows = 20;
  for (let rr = 0; rr < nrows; rr++)
    for (let cc = 0; cc < cols; cc++) {
      const x0 = AX0 + cc * cw;
      const z0 = AZ0 + rr * ch;
      const si = sramCells.length;
      sramCells.push({ i: si, x0, x1: x0 + cw, z0, z1: z0 + ch });
      const tag = { group: 'blk-sram', cell: 1000 + si } as const;
      // mirrored neighbours share contacts and wells
      const m = cc % 2 === 1;
      const ax = m ? [17, 12.5, 7.5, 3] : [3, 7.5, 12.5, 17];
      for (const a of ax) add(x0 + a - 0.6, x0 + a + 0.6, Y.act[0], Y.act[1], z0 + 0.6, z0 + ch - 0.6, { mat: 'si', part: 'mesa', ...tag, layer: 'iso' });
      add(x0 + 1, x0 + 11, Y.gate[0], Y.gate[1], z0 + 2.1, z0 + 3.5, { mat: 'gate', part: 'gate', ...tag, layer: 'fe' });
      add(x0 + 9, x0 + 19, Y.gate[0], Y.gate[1], z0 + 7, z0 + 8.4, { mat: 'gate', part: 'gate', ...tag, layer: 'fe' });
      add(x0 + 2.4, x0 + 3.6, Y.ct[0], Y.ct[1], z0 + 4.6, z0 + 5.8, { mat: 'contact', part: 'tcn', ...tag, layer: 'ct' });
      add(x0 + 16.4, x0 + 17.6, Y.ct[0], Y.ct[1], z0 + 4.6, z0 + 5.8, { mat: 'contact', part: 'tcn', ...tag, layer: 'ct' });
      add(x0 + 6.9, x0 + 8.1, Y.ct[0], Y.ct[1], z0 + 9, z0 + 10, { mat: 'contact', part: 'tcn', ...tag, layer: 'ct' });
      add(x0 + 11.9, x0 + 13.1, Y.ct[0], Y.ct[1], z0 + 0.4, z0 + 1.4, { mat: 'contact', part: 'tcn', ...tag, layer: 'ct' });
    }
  // word lines (left–right, one per row) and bit-line pairs (front–back, two per column)
  for (let rr = 0; rr < nrows; rr++) {
    const z = AZ0 + rr * ch + ch / 2;
    add(SX0 + 2, AX0 + cols * cw, Y.m2[0], Y.m2[1], z - 1, z + 1, { mat: 'copper', part: 'm2', group: 'blk-sram', layer: 'm2', label: rr === 10 ? 'Word line' : undefined });
  }
  for (let cc = 0; cc < cols; cc++)
    for (const off of [4, 16]) {
      const x = AX0 + cc * cw + off;
      add(x - 0.9, x + 0.9, Y.m1[0], Y.m1[1], AZ0, AZ0 + nrows * ch + 14, { mat: 'copper', part: 'm1', group: 'blk-sram', layer: 'm1', label: cc === 2 && off === 4 ? 'Bit line' : undefined });
    }
  // periphery: word-line drivers (left column) and sense amplifiers (bottom row), drawn as dense logic
  for (let k = 0; k < nrows; k++) {
    const z0 = AZ0 + k * ch;
    add(SX0 + 1, SX0 + 14, Y.act[0], Y.act[1], z0 + 1.5, z0 + 4.5, { mat: 'si', part: 'mesa', group: 'blk-sram', layer: 'iso' });
    add(SX0 + 1, SX0 + 14, Y.act[0], Y.act[1], z0 + 6, z0 + 9, { mat: 'si', part: 'mesa', group: 'blk-sram', layer: 'iso' });
    for (const gx of [4, 8.8, 13.6]) add(SX0 + gx - 0.7, SX0 + gx + 0.7, Y.gate[0], Y.gate[1], z0 + 0.8, z0 + 9.7, { mat: 'gate', part: 'gate', group: 'blk-sram', layer: 'fe' });
  }
  const SZ0 = AZ0 + nrows * ch + 2;
  for (let cc = 0; cc < cols; cc++) {
    const x0 = AX0 + cc * cw;
    add(x0 + 1, x0 + cw - 1, Y.act[0], Y.act[1], SZ0 + 1, SZ0 + 5, { mat: 'si', part: 'mesa', group: 'blk-sram', layer: 'iso' });
    add(x0 + 1, x0 + cw - 1, Y.act[0], Y.act[1], SZ0 + 8, SZ0 + 12, { mat: 'si', part: 'mesa', group: 'blk-sram', layer: 'iso' });
    for (let g = 1; g < 4; g++) add(x0 + g * 4.8 - 0.7, x0 + g * 4.8 + 0.7, Y.gate[0], Y.gate[1], SZ0, SZ0 + 13, { mat: 'gate', part: 'gate', group: 'blk-sram', layer: 'fe' });
  }

  // ── clock H-tree over the logic area ──
  const htree = (cx: number, cz: number, w: number, d: number, lvl: number, wd: number) => {
    // horizontal bar and two vertical bars of an "H"
    add(cx - w / 2, cx + w / 2, Y.clk[0], Y.clk[1], cz - wd / 2, cz + wd / 2, { mat: 'copper', part: 'clock', group: 'blk-clock', layer: 'top', label: lvl === 0 ? 'Clock tree' : undefined });
    for (const s of [-1, 1]) add(cx + (s * w) / 2 - wd / 2, cx + (s * w) / 2 + wd / 2, Y.clk[0], Y.clk[1], cz - d / 2, cz + d / 2, { mat: 'copper', part: 'clock', group: 'blk-clock', layer: 'top' });
    if (lvl >= 2) {
      // leaves: vias down to the local clock buffers
      for (const s of [-1, 1]) for (const t of [-1, 1]) add(cx + (s * w) / 2 - 0.8, cx + (s * w) / 2 + 0.8, Y.m3[1], Y.clk[0], cz + (t * d) / 2 - 0.8, cz + (t * d) / 2 + 0.8, { mat: 'via', part: 'via', group: 'blk-clock', layer: 'top' });
      return;
    }
    for (const s of [-1, 1]) for (const t of [-1, 1]) htree(cx + (s * w) / 2, cz + (t * d) / 2, w / 2, d / 2, lvl + 1, wd * 0.7);
  };
  htree((LX0 + LX1) / 2, 0, 124, 124, 0, 3);

  // ── power grid: straps in two directions on the top levels, stitched by via stacks to the rails ──
  const vx = [-176, -116, -56, 4, 92, 152];
  const hz = [-98, -32, 34, 100];
  for (const x of vx) add(x - 3, x + 3, Y.pg2[0], Y.pg2[1], -D2, D2, { mat: 'copperTop', part: 'power', group: 'blk-power', layer: 'top', label: x === -56 ? 'Power grid (upper metals)' : undefined });
  for (const z of hz) add(-W2, W2, Y.pg1[0], Y.pg1[1], z - 2.5, z + 2.5, { mat: 'copperTop', part: 'power', group: 'blk-power', layer: 'top' });
  vx.forEach((x, a) =>
    hz.forEach((z, b) => {
      add(x - 2, x + 2, Y.pgv[0], Y.pgv[1], z - 2, z + 2, { mat: 'via', part: 'via', group: 'blk-power', layer: 'top' });
      // every other crossing drops a via stack to the nearest cell rail
      if ((a + b) % 2 === 0 && x < LX1) {
        const zr = RZ0 + Math.round((z - RZ0) / BLOCK.rowH) * BLOCK.rowH;
        add(x - 1.2, x + 1.2, Y.m0[1], Y.pg1[0], zr - 1.2, zr + 1.2, { mat: 'via', part: 'via', group: 'blk-power', layer: 'm3' });
      }
    }),
  );

  // ── insulating fill (translucent), level by level ──
  for (const [y0, y1, layer] of [
    [Y.act[1], Y.m0[0], 'ct'],
    [Y.m0[0], Y.v1[0], 'm0'],
    [Y.v1[0], Y.v2[0], 'm1'],
    [Y.v2[0], Y.v3[0], 'm2'],
    [Y.v3[0], Y.m3[1], 'm3'],
    [Y.m3[1], Y.pg2[1], 'top'],
  ] as const)
    add(-W2, W2, y0, y1, -D2, D2, { mat: 'dielectric', part: 'ild', layer, diel: true });

  return {
    boxes: B,
    cells,
    sramCells,
    logic: { x: (LX0 + LX1) / 2, z: 0, w: LX1 - LX0, d: rows * BLOCK.rowH },
    sram: { x: (SX0 + SX1) / 2, z: 0, w: SX1 - SX0, d: BLOCK.d },
  };
}
