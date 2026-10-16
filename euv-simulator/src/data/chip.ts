import type { ChipLevel } from './types';

/**
 * Finished wafer and chip explorer: geometry, materials and texts.
 *
 * Everything here is an educational example built from public, textbook-level descriptions of semiconductor
 * manufacturing. The die size, floorplan, cell and transistor dimensions are illustrative values, not the
 * design or specification of any commercial chip, and not something an ASML machine defines.
 */

// ═══════════════════════════ materials (shared by the 3-D models and the legend) ═══════════════════════════
export type ChipMat =
  | 'substrate'
  | 'pwell'
  | 'nwell'
  | 'sti'
  | 'si'
  | 'sheet'
  | 'hk'
  | 'gate'
  | 'cap'
  | 'spacer'
  | 'epin'
  | 'epip'
  | 'contact'
  | 'via'
  | 'copper'
  | 'copperTop'
  | 'dielectric'
  | 'pass';

export interface MatDef {
  name: string;
  color: string;
  /** what it is made of (illustrative, typical choices) */
  material: string;
  metal?: boolean;
  /** translucent insulator */
  clear?: number;
  rough?: number;
}

export const CHIP_MATS: Record<ChipMat, MatDef> = {
  substrate: { name: 'Silicon substrate', color: '#5d6672', material: 'crystalline silicon (p-type)', rough: 0.6 },
  pwell: { name: 'p-well', color: '#6b7584', material: 'boron-doped silicon', rough: 0.6 },
  nwell: { name: 'n-well', color: '#76707f', material: 'phosphorus/arsenic-doped silicon', rough: 0.6 },
  sti: { name: 'Shallow-trench isolation', color: '#a9b8c2', material: 'silicon dioxide (SiO₂)', rough: 0.7 },
  si: { name: 'Active silicon', color: '#8d97a4', material: 'silicon', rough: 0.5 },
  sheet: { name: 'Nanosheet channel', color: '#c7ccd3', material: 'silicon', rough: 0.4 },
  hk: { name: 'Gate dielectric', color: '#3fb8a5', material: 'HfO₂ high-k on a thin SiO₂ interlayer', rough: 0.5 },
  gate: { name: 'Gate metal', color: '#b8955c', material: 'work-function metals (e.g. TiN, TiAl) + fill metal', metal: true, rough: 0.38 },
  cap: { name: 'Gate cap', color: '#d6d0c2', material: 'silicon nitride (SiN)', rough: 0.7 },
  spacer: { name: 'Spacer', color: '#e3ddcc', material: 'silicon nitride / low-k nitride', rough: 0.7 },
  epin: { name: 'n-type source/drain', color: '#6f93c4', material: 'phosphorus-doped silicon (Si:P) epitaxy', rough: 0.5 },
  epip: { name: 'p-type source/drain', color: '#b585c4', material: 'boron-doped silicon-germanium (SiGe:B) epitaxy', rough: 0.5 },
  contact: { name: 'Contact', color: '#9aa4b0', material: 'tungsten, cobalt or ruthenium with a thin liner', metal: true, rough: 0.35 },
  via: { name: 'Via', color: '#c9cfd6', material: 'copper, cobalt or ruthenium (filled hole)', metal: true, rough: 0.3 },
  copper: { name: 'Metal line', color: '#c77d4a', material: 'copper with a TaN/Ta barrier and a Co or Ru liner', metal: true, rough: 0.3 },
  copperTop: { name: 'Thick upper metal', color: '#d18a54', material: 'thick copper (power and clock distribution)', metal: true, rough: 0.32 },
  dielectric: { name: 'Insulating dielectric', color: '#9fc6d8', material: 'low-k SiCOH (carbon-doped oxide) and etch-stop films', clear: 0.16, rough: 0.2 },
  pass: { name: 'Passivation', color: '#8fb3a6', material: 'silicon nitride + oxide (and polyimide on top)', clear: 0.22, rough: 0.4 },
};

// ═══════════════════════════ wafer and die (physical scale, millimetres) ═══════════════════════════
export const WAFER = {
  diameter: 300,
  thickness: 0.775,
  /** no complete die is placed closer than this to the edge */
  edgeExclusion: 3,
  notch: 1.5,
};
/** illustrative die size (an example, not a real product) */
export const DIE = { w: 12, h: 10, scribe: 0.1 };
export const DIE_PITCH = { x: DIE.w + DIE.scribe, y: DIE.h + DIE.scribe };

export interface DieDef {
  i: number;
  col: number;
  row: number;
  /** centre in wafer coordinates (mm): x right, y up as seen from above with the notch at the bottom */
  x: number;
  y: number;
  /** the whole die lies inside the usable area */
  full: boolean;
}

/** The die grid across the wafer: complete dies and the partial ones cut by the edge. */
export const DIES: DieDef[] = (() => {
  const out: DieDef[] = [];
  const R = WAFER.diameter / 2;
  const Ru = R - WAFER.edgeExclusion;
  // grid offset so that the pattern is not symmetric about the centre (like a real reticle layout)
  const ox = DIE_PITCH.x * 0.5;
  const oy = DIE_PITCH.y * 0.3;
  const nx = Math.ceil(R / DIE_PITCH.x) + 1;
  const ny = Math.ceil(R / DIE_PITCH.y) + 1;
  let i = 0;
  for (let r = -ny; r <= ny; r++)
    for (let c = -nx; c <= nx; c++) {
      const x = c * DIE_PITCH.x + ox;
      const y = r * DIE_PITCH.y + oy;
      const corners = [
        [x - DIE.w / 2, y - DIE.h / 2],
        [x + DIE.w / 2, y - DIE.h / 2],
        [x - DIE.w / 2, y + DIE.h / 2],
        [x + DIE.w / 2, y + DIE.h / 2],
      ];
      const inside = corners.filter(([a, b]) => Math.hypot(a, b) <= Ru).length;
      // partial dies: printed (the reticle field is exposed anyway) but cut by the edge
      const touches = Math.hypot(Math.max(Math.abs(x) - DIE.w / 2, 0), Math.max(Math.abs(y) - DIE.h / 2, 0)) < R - 0.5;
      if (!touches) continue;
      out.push({ i: i++, col: c + nx, row: r + ny, x, y, full: inside === 4 });
    }
  return out;
})();
export const FULL_DIES = DIES.filter((d) => d.full).length;

/** die label in the notation of a wafer map: row letter(s) + column number */
export function dieName(d: DieDef): string {
  const rows = Math.max(...DIES.map((x) => x.row)) + 1;
  const r = rows - 1 - d.row; // row A at the top
  const letter = r < 26 ? String.fromCharCode(65 + r) : 'A' + String.fromCharCode(65 + r - 26);
  return `${letter}${d.col + 1}`;
}

// ═══════════════════════════ die floorplan (mm, origin at the lower-left corner of the die) ═══════════════════════════
export type RegionKind = 'logic' | 'sram' | 'analog' | 'io';
export interface RegionDef {
  id: string;
  /** CHIP_INFO key */
  info: string;
  name: string;
  kind: RegionKind;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export const FLOORPLAN: RegionDef[] = [
  { id: 'core0', info: 'fp-core', name: 'CPU core 0', kind: 'logic', x0: 0.8, y0: 7.15, x1: 3.25, y1: 9.2 },
  { id: 'core1', info: 'fp-core', name: 'CPU core 1', kind: 'logic', x0: 3.35, y0: 7.15, x1: 5.8, y1: 9.2 },
  { id: 'core2', info: 'fp-core', name: 'CPU core 2', kind: 'logic', x0: 0.8, y0: 5.0, x1: 3.25, y1: 7.05 },
  { id: 'core3', info: 'fp-core', name: 'CPU core 3', kind: 'logic', x0: 3.35, y0: 5.0, x1: 5.8, y1: 7.05 },
  { id: 'cache', info: 'fp-cache', name: 'Shared cache (SRAM)', kind: 'sram', x0: 0.8, y0: 2.6, x1: 5.8, y1: 4.85 },
  { id: 'gpu', info: 'fp-gpu', name: 'Graphics / accelerator', kind: 'logic', x0: 6.0, y0: 4.4, x1: 11.2, y1: 9.2 },
  { id: 'slc', info: 'fp-slc', name: 'System cache (SRAM)', kind: 'sram', x0: 6.0, y0: 2.6, x1: 11.2, y1: 4.25 },
  { id: 'phy', info: 'fp-phy', name: 'Memory interface (PHY)', kind: 'analog', x0: 0.8, y0: 0.8, x1: 7.4, y1: 2.4 },
  { id: 'analog', info: 'fp-analog', name: 'Clocks, PLLs and sensors', kind: 'analog', x0: 7.6, y0: 0.8, x1: 11.2, y1: 2.4 },
];
/** the I/O ring: the 0.5 mm border of the die */
export const IO_RING = 0.55;

export function regionAt(u: number, v: number): RegionDef | 'io' | null {
  if (u < 0 || v < 0 || u > DIE.w || v > DIE.h) return null;
  for (const r of FLOORPLAN) if (u >= r.x0 && u <= r.x1 && v >= r.y0 && v <= r.y1) return r;
  if (u < IO_RING || v < IO_RING || u > DIE.w - IO_RING || v > DIE.h - IO_RING) return 'io';
  return null;
}

// ═══════════════════════════ circuit region and cell models ═══════════════════════════
/** Block model: 1 unit = 10 nm. Field of 4 µm × 2.6 µm with standard-cell rows, an SRAM array and the wiring above. */
export const BLOCK = { unitNm: 10, w: 400, d: 260, rowH: 14, cpp: 4.8, logicW: 250, sramX0: 262 };
/** Device model: 1 unit = 1 nm. A NAND2 standard cell built from gate-all-around nanosheet transistors. */
export const CELL = { unitNm: 1, cpp: 48, height: 140, lg: 14, sheetT: 5, sheetW: 30, sheets: [10, 25, 40] };

export interface LayerDef {
  id: string;
  name: string;
  /** stack order for the exploded view (0 = bottom) */
  order: number;
  /** CHIP_INFO key */
  info: string;
  mats: ChipMat[];
}
/** The layer stack used by the circuit-region and cell models (bottom to top). */
export const CHIP_LAYERS: LayerDef[] = [
  { id: 'sub', name: 'Substrate and wells', order: 0, info: 'substrate', mats: ['substrate', 'pwell', 'nwell'] },
  { id: 'iso', name: 'Isolation and active regions', order: 1, info: 'sti', mats: ['sti', 'si'] },
  { id: 'fe', name: 'Transistors (gates, channels, source/drain)', order: 2, info: 'nfet', mats: ['sheet', 'hk', 'gate', 'cap', 'spacer', 'epin', 'epip'] },
  { id: 'ct', name: 'Contacts', order: 3, info: 'tcn', mats: ['contact'] },
  { id: 'm0', name: 'M0 local interconnect', order: 4, info: 'm0', mats: ['copper'] },
  { id: 'm1', name: 'V1 + M1', order: 5, info: 'm1', mats: ['copper', 'via'] },
  { id: 'm2', name: 'V2 + M2', order: 6, info: 'm2', mats: ['copper', 'via'] },
  { id: 'm3', name: 'V3 + M3', order: 7, info: 'm3', mats: ['copper', 'via'] },
  { id: 'top', name: 'Upper metals (power, clock)', order: 8, info: 'top', mats: ['copperTop', 'via'] },
  { id: 'pass', name: 'Passivation', order: 9, info: 'pass', mats: ['pass'] },
];
/** pseudo-layer: all insulating fill between the conductors (toggled on its own) */
export const DIELECTRIC_LAYER = { id: 'diel', name: 'Insulating dielectric', info: 'ild' };

/** The four transistors of the NAND2 cell (inputs A, B; output Y). */
export const TRANSISTORS: { id: string; name: string; type: 'n' | 'p'; gate: 'A' | 'B'; info: string; source: 'left' | 'right'; role: string }[] = [
  { id: 'nA', name: 'nFET (input A)', type: 'n', gate: 'A', info: 'nfet', source: 'left', role: 'lower of the two series nFETs: connects the internal node to VSS when A is high' },
  { id: 'nB', name: 'nFET (input B)', type: 'n', gate: 'B', info: 'nfet', source: 'left', role: 'upper of the two series nFETs: connects the output Y to the internal node when B is high' },
  { id: 'pA', name: 'pFET (input A)', type: 'p', gate: 'A', info: 'pfet', source: 'left', role: 'one of the two parallel pFETs: pulls the output Y up to VDD when A is low' },
  { id: 'pB', name: 'pFET (input B)', type: 'p', gate: 'B', info: 'pfet', source: 'right', role: 'one of the two parallel pFETs: pulls the output Y up to VDD when B is low' },
];

// ═══════════════════════════ levels ═══════════════════════════
export const CHIP_LEVELS: { id: ChipLevel; name: string; scale: 'physical' | 'model'; note: string }[] = [
  { id: 'wafer', name: 'Finished wafer', scale: 'physical', note: 'True proportions: 300 mm wafer, example 12 × 10 mm dies.' },
  { id: 'die', name: 'Die', scale: 'physical', note: 'True proportions in the die plane; the height of surface features is exaggerated.' },
  { id: 'block', name: 'Circuit region', scale: 'model', note: 'Enlarged educational model (4 × 2.6 µm field): representative rows, arrays and wires, not a real layout.' },
  { id: 'cell', name: 'Standard cell', scale: 'model', note: 'Enlarged educational model of one NAND2 cell (about 0.15 µm wide), gate-all-around nanosheet transistors.' },
  { id: 'transistor', name: 'Transistor', scale: 'model', note: 'One nanosheet transistor of the cell, enlarged. Dimensions are typical public values, not a specification.' },
];

// ═══════════════════════════ explanations (three levels each) ═══════════════════════════
export interface ChipInfo {
  name: string;
  category: string;
  overview: string;
  engineering: string;
  deep: string;
}

export const CHIP_INFO: Record<string, ChipInfo> = {
  wafer: {
    name: 'Finished 300 mm wafer',
    category: 'Wafer',
    overview:
      'A thin disc of single-crystal silicon, 300 mm across and less than a millimetre thick, after hundreds of process steps. Its surface is covered edge to edge with identical rectangular chips, called dies; the rainbow sheen comes from the repeating patterns diffracting light.',
    engineering:
      'The wafer is 775 µm thick and carries a small notch that marks its crystal orientation. Dies are laid out on a grid set by the exposure field of the scanner (at most 26 × 33 mm, often several dies per field), separated by narrow scribe lines. A few millimetres at the edge are excluded, and the dies that the edge cuts through are printed but cannot work. Here the example die is 12 × 10 mm, giving about ' +
      FULL_DIES +
      ' complete dies.',
    deep:
      'Each die is built up layer by layer: transistors in the top few hundred nanometres of the silicon, then a stack of insulated copper wiring levels. A leading-edge logic process uses on the order of 60 to 100 mask layers; the densest of them (gates, contacts, the lowest metal and via levels) are where EUV lithography is used, the rest with older deep-ultraviolet tools. After electrical testing on the wafer, it is thinned, sawn along the scribe lines, and the good dies are packaged.',
  },
  die: {
    name: 'Die',
    category: 'Wafer › die',
    overview:
      'One complete integrated circuit: the chip that ends up inside a package. It is not a transistor; a die like this holds billions of transistors and the wiring between them.',
    engineering:
      'This example die is 12 mm × 10 mm (120 mm², an illustrative size). It is a system-on-chip: four CPU cores, two SRAM caches, a graphics/accelerator block, a memory interface and analog circuits (clocks, voltage sensors), with input/output pads around the edge. The blocks you see are the floorplan; every block is filled with millions of standard cells or memory cells.',
    deep:
      'Dies are tested on the wafer with probe cards before dicing; the fraction that works is the yield, which falls with die area because a single killer defect ruins a whole die. That is one reason large designs are split into smaller dies (chiplets). Real floorplans are proprietary and optimised for wire length, power delivery and heat; this one is a simplified example.',
  },
  'die-edge': {
    name: 'Partial edge die',
    category: 'Wafer › edge die',
    overview: 'A die that the round edge of the wafer cuts through. It is printed along with the rest but cannot become a working chip.',
    engineering:
      'Exposure fields are rectangular and the wafer is round, so the outer ring of fields is only partly on the wafer. Partial fields are usually still exposed and processed: it keeps the film thicknesses, etch loading and chemical-mechanical polishing uniform for the complete dies nearby.',
    deep: 'The edge exclusion zone (a few millimetres) suffers from edge bead removal, film non-uniformity and handling contact, so even complete dies very close to the edge are often lower yielding. Wafer-edge engineering is a topic of its own in fab yield work.',
  },
  scribe: {
    name: 'Scribe line',
    category: 'Wafer › scribe line',
    overview: 'The narrow lane between dies where the saw cuts the wafer apart. It is also used for test structures and alignment marks.',
    engineering:
      'Scribe lines are typically 50–100 µm wide. They hold the alignment marks the scanner measures before exposing each layer, overlay targets for measuring how well each layer lines up with the one below, and small test transistors and resistors for process monitoring.',
    deep: 'Overlay between critical layers must be controlled to a few nanometres across the whole wafer. The scanner measures marks in the scribe lines on every wafer and corrects field position, rotation and magnification, and even higher-order distortions, before it exposes.',
  },
  'fp-core': {
    name: 'CPU core',
    category: 'Die › logic block',
    overview: 'A processor core: the logic that fetches, decodes and executes instructions, with its own small, fast memories.',
    engineering:
      'Mostly random logic built from standard cells (gates and flip-flops placed in rows), plus small SRAM arrays for its level-1 and level-2 caches and register files. In this example a core is about 2.4 × 2 mm. Zoom in to see a representative logic region.',
    deep:
      'Core logic is limited by how fast signals can switch and travel. Designers balance transistor count, wire length and power: the clock is distributed to millions of flip-flops with tightly controlled skew, and the supply is delivered through a dense power grid to limit voltage drop.',
  },
  'fp-gpu': {
    name: 'Graphics / accelerator block',
    category: 'Die › logic block',
    overview: 'Many small, identical processing units that work in parallel, used for graphics and for machine-learning workloads.',
    engineering: 'Like the CPU cores it is standard-cell logic with embedded SRAM, but the units are repeated many times. Its regular structure is visible as a repeating pattern in the floorplan. Zoom in for a representative logic region.',
    deep: 'Parallel accelerators trade the complex control logic of a CPU for many arithmetic units and wide memory paths. Their power density is high, so the power grid and the cooling path from the die through the package matter as much as the transistors.',
  },
  'fp-cache': {
    name: 'Shared cache (SRAM)',
    category: 'Die › memory block',
    overview: 'Fast on-chip memory shared by the cores. It is made of millions of identical memory cells in dense arrays, which is why it looks so regular.',
    engineering:
      'Static RAM (SRAM): each bit is held by six transistors (6T cell) arranged in a grid, with word lines selecting a row and pairs of bit lines carrying the data. The arrays are split into banks with decoders and sense amplifiers at their edges. Zoom in to see the array.',
    deep:
      'SRAM cells are the densest structures on a logic die and are often used to compare processes: reported 6T cell areas at leading nodes are around 0.02 µm². Because they are so small, their transistors are the most sensitive to random variation, and SRAM density has scaled more slowly than logic in recent nodes.',
  },
  'fp-slc': {
    name: 'System cache (SRAM)',
    category: 'Die › memory block',
    overview: 'A large SRAM shared by all the blocks of the chip, between them and the external memory.',
    engineering: 'Built from the same 6T SRAM cells as the core caches, in large banks with their own control logic. Zoom in to see the array.',
    deep: 'A system-level cache reduces how often the chip has to go to external DRAM, which costs far more energy per bit than reading on-chip SRAM. Its size is a trade-off between die area (cost) and performance and power.',
  },
  'fp-phy': {
    name: 'Memory interface (PHY)',
    category: 'Die › mixed-signal block',
    overview: 'The circuits that send and receive data to the external memory chips at very high speed.',
    engineering:
      'Mixed-signal circuits: transmitters, receivers, delay lines and calibration logic, laid out by hand-optimised analog design rather than placed standard cells. It sits at the die edge, next to the pads that connect to the package. This model does not go deeper into analog blocks.',
    deep: 'High-speed interfaces must control impedance, timing jitter and signal integrity over the package and board. Analog transistors often use longer gates and thicker gate oxides than the core logic, for accuracy and to tolerate higher voltages.',
  },
  'fp-analog': {
    name: 'Clocks, PLLs and sensors',
    category: 'Die › analog block',
    overview: 'Analog circuits that make the clock signals and watch over the chip: phase-locked loops, voltage regulators, temperature and voltage sensors.',
    engineering: 'Hand-drawn analog layouts with matched transistors, capacitors and inductors. This model does not go deeper into analog blocks.',
    deep: 'A phase-locked loop multiplies a slow reference crystal frequency up to the GHz core clock and keeps it stable. On-die sensors let the chip lower its voltage and frequency when it gets hot, which keeps it within its power and temperature limits.',
  },
  'fp-io': {
    name: 'I/O ring and pads',
    category: 'Die › input/output',
    overview: 'The border of the die, where power, ground and signals enter and leave the chip through pads or tiny solder bumps.',
    engineering:
      'Pads connect the top metal layer of the die to the package, by wire bonds or, in modern chips, by an array of micro-bumps (flip-chip). The I/O cells next to them contain drivers and electrostatic-discharge protection.',
    deep: 'Many chips also have bumps over the whole die area, not just the edge, so that power can be delivered straight down into the power grid. Electrostatic-discharge protection devices must survive kilovolt pulses from handling without damaging the fragile gate dielectrics.',
  },
  block: {
    name: 'Circuit region (4 × 2.6 µm)',
    category: 'Die › circuit region',
    overview:
      'A tiny patch of the die, magnified about a million times compared with the wafer: rows of standard logic cells on the left, an SRAM memory array on the right, and layers of metal wiring above them.',
    engineering:
      'Logic cells sit in rows of fixed height with power rails along their edges; the SRAM is a regular array of six-transistor bit cells. Above them, thin metal lines in alternating directions carry signals, and wide upper metals carry the power supply and the clock. Click a structure to isolate it.',
    deep: 'This is an educational model with representative structures, not a real layout: real regions are generated by place-and-route software from millions of cells, and their exact patterns are proprietary. Dimensions are typical public values for recent processes.',
  },
  'blk-cells': {
    name: 'Standard-cell logic rows',
    category: 'Circuit region › logic',
    overview: 'Rows of small pre-designed logic gates (inverters, NAND and NOR gates, flip-flops) placed side by side. Every row is the same height, so cells fit together like bricks.',
    engineering:
      'Each row has a supply rail (VDD) on one edge and a ground rail (VSS) on the other; alternate rows are flipped so neighbours share rails. Inside a cell, vertical gate lines cross horizontal strips of n- and p-type active silicon, forming transistors where they cross. The cell height here is 140 nm and the gate pitch 48 nm (illustrative).',
    deep: 'Cell heights are counted in metal tracks (for example "6-track" cells), and the contacted gate pitch (CPP) times the cell height sets the logic density. Placement and routing tools arrange millions of cells and connect them with the metal levels above.',
  },
  'blk-sram': {
    name: 'SRAM array',
    category: 'Circuit region › memory',
    overview: 'A grid of identical memory cells, each storing one bit. Word lines run across to select a row; bit lines run down to read and write the data.',
    engineering:
      'Each 6T cell is two cross-coupled inverters (which hold the bit) and two access transistors connected to the bit lines. Here a cell is about 200 × 105 nm (≈0.021 µm², in line with reported values for leading nodes). Word-line drivers sit on the left and sense amplifiers at the bottom of the array.',
    deep: 'Reading an SRAM cell discharges one bit line slightly; the sense amplifier detects the small difference between the pair. Cell stability depends on the strength ratios of its six transistors, so SRAM arrays are very sensitive to transistor variability and are drawn with special, very regular layout rules.',
  },
  'blk-signal': {
    name: 'Signal routing (M2, M3)',
    category: 'Circuit region › wiring',
    overview: 'The thin metal wires that connect the logic cells to one another. Each level runs in one direction, and vias connect a level to the one above or below.',
    engineering:
      'Lower levels are the thinnest and densest (pitches of a few tens of nanometres), so they reach between nearby cells; higher levels are thicker and wider and carry signals across longer distances with lower resistance. In this model M2 runs left–right and M3 front–back.',
    deep: 'Wire delay grows with resistance times capacitance, and both get worse as wires shrink: narrow copper lines have higher resistivity (electron scattering at surfaces and grain boundaries) and closer neighbours add capacitance. This is why low-k dielectrics and alternative metals such as ruthenium are researched for the tightest levels.',
  },
  'blk-power': {
    name: 'Power grid',
    category: 'Circuit region › power delivery',
    overview: 'A mesh of wide, thick metal straps in the upper levels that brings the supply voltage and ground to every cell.',
    engineering:
      'Straps in alternating directions are stitched together by stacks of vias down to the rails of the cell rows. The grid must keep the voltage drop (IR drop) to a few percent of the supply even when millions of gates switch at once.',
    deep: 'Current density in the straps is limited by electromigration: moving electrons gradually push copper atoms along a line and can open it after years of use. Some new processes move the power grid to the back of the wafer (backside power delivery) to free the front side for signals.',
  },
  'blk-clock': {
    name: 'Clock tree',
    category: 'Circuit region › clock distribution',
    overview: 'A branching network of wires (here an H-tree) that delivers the clock signal to every flip-flop at almost exactly the same moment.',
    engineering: 'The tree runs on upper metal levels with buffers at its branch points. Equal path lengths keep the skew (difference in arrival time) small, typically a few picoseconds within a block.',
    deep: 'The clock network can use a large share of a chip’s dynamic power because it switches every cycle. Clock gating turns off branches whose logic is idle, one of the most effective power-saving techniques.',
  },
  'std-cell': {
    name: 'Standard cell',
    category: 'Circuit region › logic cell',
    overview: 'One small logic gate from the cell library. Its transistors sit where the vertical gate lines cross the strips of active silicon.',
    engineering: 'Cells come in a library of hundreds of types and drive strengths. Zoom in to see the transistor layout of a NAND2 cell; every logic cell is built from the same kind of transistors and wiring.',
    deep: 'A library cell is characterised for delay, power and noise across voltage and temperature. Synthesis tools turn a hardware description into a netlist of these cells, and placement tools arrange them in rows.',
  },
  'sram-cell': {
    name: 'SRAM bit cell (6T)',
    category: 'Circuit region › memory cell',
    overview: 'One bit of memory: six transistors forming two cross-coupled inverters and two access gates.',
    engineering: 'The cell is about 200 × 105 nm in this model. Its word line (left–right) turns on the two access transistors; the two bit lines (front–back) read or write the stored value.',
    deep: 'Cells are mirrored with their neighbours so they share contacts and wells, which is a large part of why SRAM is so dense. The stored bit is lost when power is removed (static but volatile memory).',
  },
  nand2: {
    name: 'NAND2 standard cell',
    category: 'Standard cell',
    overview: 'A two-input NAND gate: its output is low only when both inputs are high. Any logic function can be built from NAND gates.',
    engineering:
      'Four transistors: two nFETs in series between the output and ground (VSS), and two pFETs in parallel between the output and the supply (VDD). Gate lines A and B each control one nFET and one pFET. The cell is 3 gate pitches wide (≈144 nm) and 140 nm tall in this example, with dummy gates at its edges isolating it from its neighbours.',
    deep: 'CMOS logic draws almost no current when it is not switching: for every input combination, either the pull-up or the pull-down network is off. The energy goes mainly into charging and discharging the capacitance of wires and gates, proportional to C·V² per transition.',
  },
  nfet: {
    name: 'n-type nanosheet transistor (nFET)',
    category: 'Transistor',
    overview: 'A switch for current made of electrons. When its gate is at the supply voltage it conducts between source and drain; at 0 V it is off.',
    engineering:
      'Gate-all-around (GAA) nanosheet architecture: three thin silicon sheets (5 nm thick, 30 nm wide here) are stacked above each other, and the gate surrounds each sheet on all four sides. Phosphorus-doped source and drain regions are grown at the ends of the sheets. Gate length ≈14 nm (illustrative).',
    deep:
      'A positive gate voltage pulls electrons to the sheet surfaces and forms a conducting channel; below the threshold voltage the current falls exponentially (about a decade per 60–70 mV at room temperature). Wrapping the gate around the channel gives it better control than the three-sided fin of a FinFET, which reduces leakage at short gate lengths.',
  },
  pfet: {
    name: 'p-type nanosheet transistor (pFET)',
    category: 'Transistor',
    overview: 'The complementary switch, conducting with holes (missing electrons). It turns on when its gate is at 0 V and off when the gate is at the supply voltage.',
    engineering:
      'Same gate-all-around nanosheet structure as the nFET, but with boron-doped silicon-germanium source and drain regions, which also compress the channel and raise hole mobility. It sits in an n-type well and uses a different work-function metal in its gate.',
    deep: 'Pairing nFETs and pFETs (CMOS) means a logic gate only draws current while switching. Hole mobility is lower than electron mobility in silicon, which designers compensate with strain engineering, wider devices or more sheets.',
  },
  gate: {
    name: 'Gate',
    category: 'Transistor › gate',
    overview: 'The control electrode. Its voltage switches the transistor on or off without any current flowing into it.',
    engineering:
      'A metal gate stack wraps around the nanosheets: thin work-function metals (for example TiN, TiAl) set the threshold voltage, and a fill metal lowers the resistance. One gate line runs across both the nFET and the pFET, so each input drives a complementary pair. Gate length here ≈14 nm.',
    deep: 'The gate forms a capacitor with the channel through the gate dielectric. Its work function, not doping, sets the threshold voltage in modern devices; different threshold flavours (low, standard, high Vt) are offered so designers can trade speed against leakage.',
  },
  hk: {
    name: 'Gate dielectric (high-k)',
    category: 'Transistor › insulator',
    overview: 'An extremely thin insulating film between the gate and the channel. It lets the gate’s electric field through but blocks current.',
    engineering: 'About 1–2 nm of hafnium oxide (HfO₂, a "high-k" material) on an interfacial layer of SiO₂ well under 1 nm thick. It coats every surface of every sheet. Its thickness is exaggerated here so it can be seen.',
    deep: 'With a dielectric constant around 20 instead of 3.9 for SiO₂, hafnium oxide gives the same capacitance as a sub-nanometre oxide while being physically thick enough to stop electrons tunnelling through it. Its equivalent oxide thickness (EOT) is below 1 nm.',
  },
  sheet: {
    name: 'Nanosheet channel',
    category: 'Transistor › channel',
    overview: 'Thin ribbons of silicon that carry the current. The gate wraps all the way around them.',
    engineering:
      'Three sheets about 5 nm thick, stacked about 10 nm apart and 30 nm wide here. They start as alternating Si and SiGe layers grown on the wafer; the SiGe is later etched away and replaced by the gate. Wider sheets carry more current.',
    deep: 'Sheet thickness controls how well the gate can deplete the channel; too thin and carrier mobility suffers from surface roughness and quantum confinement. Stacking sheets vertically increases drive current without taking more area on the wafer.',
  },
  'sd-n': {
    name: 'Source / drain (n-type)',
    category: 'Transistor › source and drain',
    overview: 'The two ends of the nFET. Electrons flow in at the source and out at the drain when the gate turns the channel on.',
    engineering: 'Phosphorus-doped silicon grown epitaxially from the cut ends of the sheets. Which end is the source depends on the circuit: in the NAND2 the source of the lower nFET is the one tied to VSS.',
    deep: 'Very high doping and low-resistance contacts are needed because, at these sizes, the resistance of the source, drain and contacts is comparable to that of the channel itself.',
  },
  'sd-p': {
    name: 'Source / drain (p-type)',
    category: 'Transistor › source and drain',
    overview: 'The two ends of the pFET, where holes enter and leave the channel.',
    engineering: 'Boron-doped silicon-germanium grown epitaxially. Its larger lattice constant compresses the silicon channel, which increases hole mobility.',
    deep: 'Strain engineering through the source/drain material has been a standard performance booster since around the 90 nm generation.',
  },
  spacer: {
    name: 'Spacers',
    category: 'Transistor › insulator',
    overview: 'Thin insulating walls on both sides of the gate that separate it from the source/drain and its contacts.',
    engineering: 'Silicon nitride (or a lower-k nitride) a few nanometres thick. Inner spacers between the sheets isolate the gate from the source/drain epitaxy at the ends of each sheet.',
    deep: 'Spacer thickness is a trade-off: thinner spacers lower resistance but increase the parasitic capacitance between gate and contacts, which slows switching.',
  },
  cap: {
    name: 'Gate cap',
    category: 'Transistor › insulator',
    overview: 'An insulating cap on top of the gate so that the contacts beside it cannot short to it.',
    engineering: 'Silicon nitride. It allows "self-aligned" contacts: the contact etch stops on the cap, so small overlay errors in lithography do not cause shorts.',
    deep: 'Self-aligned contacts and gate caps were introduced so that contacts could be placed between gates at very tight pitch without lithography having to place them perfectly.',
  },
  tcn: {
    name: 'Source/drain contact',
    category: 'Contacts',
    overview: 'A metal plug that connects a source or drain region up to the wiring.',
    engineering: 'Trench contacts of tungsten, cobalt or ruthenium land on the source/drain epitaxy through a thin silicide that lowers the contact resistance. In this cell the outer pFET contacts reach the VDD rail and one nFET contact reaches the VSS rail.',
    deep: 'Contact resistance scales badly with area. Silicides (such as TiSi) and very high doping at the interface keep it acceptable; it is one of the main parasitic resistances of a modern transistor.',
  },
  dummy: {
    name: 'Dummy gate (diffusion break)',
    category: 'Standard cell › cell boundary',
    overview: 'A gate line at the edge of the cell that switches nothing: it separates this cell’s transistors from the neighbouring cell’s.',
    engineering: 'Gates are printed at a perfectly regular pitch because regular patterns print best. At cell boundaries the active silicon is cut under a gate line, which is then left unconnected (or tied off) so that it isolates the two cells.',
    deep: 'Single and double diffusion breaks are a recurring area cost in standard-cell design; regular, one-directional gate patterns are what make lithography at these pitches possible at all.',
  },
  gcn: {
    name: 'Gate contact',
    category: 'Contacts',
    overview: 'A metal plug through the gate cap that connects the gate line (an input of the cell) to the wiring above.',
    engineering: 'Placed between the nFET and pFET regions here. Some recent processes place gate contacts directly over the active region ("contact over active gate") to save area.',
    deep: 'Gate contacts land on the metal gate after the cap is opened; they must not touch the neighbouring source/drain contacts, separated by only a few nanometres of insulator.',
  },
  v0: {
    name: 'Via (V0, V1, …)',
    category: 'Interconnect › via',
    overview: 'A short vertical metal connection between two wiring levels, or between a contact and the first metal level.',
    engineering: 'Vias are formed in the same dual-damascene step as the metal line above: holes and trenches are etched into the dielectric and filled with metal at once, then polished flat. Only where a via exists do two levels connect.',
    deep: 'A chip contains tens of billions of vias; a single open via can break a circuit, so critical connections often use redundant (doubled) vias. Via resistance grows quickly as their diameter shrinks below about 20 nm.',
  },
  m0: {
    name: 'M0 local interconnect',
    category: 'Interconnect › metal 0',
    overview: 'The first and finest wiring level, connecting the contacts of the transistors inside the cell. Its wide outer lines are the VDD and VSS rails.',
    engineering: 'Lines run left–right at a pitch of about 28 nm in this model (illustrative). The densest metal levels are among the layers printed with EUV, sometimes with more than one exposure.',
    deep: 'At pitches of 20–30 nm, the barrier and liner take up a large fraction of the line, so the effective resistivity of copper rises steeply; ruthenium or other metals without a thick barrier are being introduced for the tightest levels.',
  },
  rail: {
    name: 'Power rails (VDD, VSS)',
    category: 'Interconnect › power rails',
    overview: 'Wide M0 lines along the top and bottom of every cell row: the supply (VDD) and ground (VSS) for each cell.',
    engineering: 'Rails are shared with the neighbouring row (rows alternate orientation). They are fed from the power grid through via stacks.',
    deep: 'In backside power delivery, these rails move under the transistors and are reached from the back of the wafer, freeing the front-side tracks for signals.',
  },
  m1: {
    name: 'M1 (metal 1)',
    category: 'Interconnect › metal 1',
    overview: 'The second wiring level, running front–back, perpendicular to M0. It connects the output of the cell and its input pins.',
    engineering: 'Copper lines in a low-k dielectric, connected to M0 by V1 vias. In this NAND2, an M1 line joins the pFET drain and the nFET drain to form the output Y.',
    deep: 'Alternating the direction of each level (Manhattan routing) keeps routing regular and lets tools stack thousands of nets without crossing on the same level.',
  },
  m2: {
    name: 'M2 (metal 2)',
    category: 'Interconnect › metal 2',
    overview: 'A signal wiring level running left–right that connects this cell to its neighbours and carries wires passing over it.',
    engineering: 'Slightly wider and thicker than M0/M1. Some of the M2 lines over this cell belong to other circuits: wires routinely run over cells they do not connect to.',
    deep: 'Global routing assigns each net to levels and tracks; the lower levels are reserved mostly for short connections because their resistance per length is high.',
  },
  m3: {
    name: 'M3 (metal 3)',
    category: 'Interconnect › metal 3',
    overview: 'The next wiring level, running front–back, for connections that span several cells.',
    engineering: 'Real chips continue with many more levels (often 12 to 20 in total), each thicker and wider than the last.',
    deep: 'Intermediate levels balance density against resistance; their pitch can be several times that of M0, and they are printed with DUV immersion lithography rather than EUV.',
  },
  top: {
    name: 'Upper metal levels',
    category: 'Interconnect › upper metals',
    overview: 'The thickest wiring at the top of the stack. It carries the power supply and the clock across the die and connects to the pads.',
    engineering: 'Lines here can be micrometres wide and thick, with very low resistance per length. Only one upper level is drawn in this model; a real stack has several, and the exact count depends on the process and the design.',
    deep: 'The top level is also where the chip connects to the package (through pads and bumps). Thick metal here is needed to carry tens to hundreds of amperes into the die with an acceptable voltage drop.',
  },
  ild: {
    name: 'Insulating dielectric (ILD)',
    category: 'Interconnect › insulator',
    overview: 'The glass-like insulator that fills all the space between the wires and keeps them electrically apart.',
    engineering: 'Low-k carbon-doped oxide (SiCOH, dielectric constant about 2.5–3.0, versus 3.9 for SiO₂), with thin etch-stop and cap layers between levels. It is drawn translucent so the metal inside is visible; toggle it off to see the wires alone.',
    deep: 'Lower dielectric constant means less capacitance between neighbouring wires, hence faster and lower-power circuits. Porous low-k films are mechanically weak, which makes packaging and polishing harder; some processes use air gaps between the tightest lines.',
  },
  pmd: {
    name: 'Pre-metal dielectric',
    category: 'Device level › insulator',
    overview: 'The insulator that surrounds the transistors and their contacts, below the first metal level.',
    engineering: 'Silicon dioxide deposited over the finished transistors and polished flat; the contacts are etched through it.',
    deep: 'The flatness of each level is restored by chemical-mechanical polishing, so that the next level can be printed within the very small depth of focus of the lithography.',
  },
  sti: {
    name: 'Shallow-trench isolation (STI)',
    category: 'Device level › isolation',
    overview: 'Oxide-filled trenches in the silicon that electrically separate neighbouring transistors.',
    engineering: 'Trenches etched around the active regions and filled with silicon dioxide. The transistors sit on narrow ridges of silicon (the active regions) rising between them.',
    deep: 'Without isolation, current would leak between neighbouring devices through the substrate. Nanosheet processes may add a bottom dielectric isolation layer under the sheets for the same reason.',
  },
  mesa: {
    name: 'Active region',
    category: 'Device level › active silicon',
    overview: 'The strip of silicon on which a row of transistors is built, between the isolation trenches.',
    engineering: 'In the layout these are the horizontal strips; where a gate line crosses one, there is a transistor. The nanosheet stack is grown and patterned on top of it.',
    deep: 'Breaking an active strip between cells ("diffusion break") isolates neighbouring cells; this is why there are extra dummy gates at the cell edges.',
  },
  'well-p': {
    name: 'p-well',
    category: 'Substrate › well',
    overview: 'A region of the silicon doped with boron, in which the nFETs are built.',
    engineering: 'Formed by ion implantation into the substrate. Its doping sets the electrical environment of the transistors and connects to ground through well taps.',
    deep: 'Wells of opposite type side by side form diodes that are kept reverse-biased; careful layout prevents the parasitic thyristor structure (latch-up) that CMOS wells can form.',
  },
  'well-n': {
    name: 'n-well',
    category: 'Substrate › well',
    overview: 'A region of the silicon doped with phosphorus or arsenic, in which the pFETs are built.',
    engineering: 'Tied to the supply voltage through well taps, so that it stays reverse-biased with respect to the p-type substrate.',
    deep: 'Biasing the wells (body bias) shifts the threshold voltage of the transistors, a knob some processes use to trade speed against leakage after manufacturing.',
  },
  substrate: {
    name: 'Silicon substrate',
    category: 'Substrate',
    overview: 'The bulk of the wafer: hundreds of micrometres of crystalline silicon under a device layer only a few hundred nanometres deep.',
    engineering: 'Lightly p-doped single-crystal silicon. Only the top surface takes part in the circuit; the rest gives the wafer its strength and conducts heat away. Only a thin slice is drawn here.',
    deep: 'The silicon is grown as a single crystal ingot (Czochralski process), sliced, and polished flat to nanometres. Its crystal orientation (usually (100)) affects carrier mobility and how the material etches.',
  },
  pass: {
    name: 'Passivation',
    category: 'Top of the stack',
    overview: 'The protective coat over the finished chip, which keeps out moisture, ions and scratches.',
    engineering: 'Silicon nitride and oxide films, often with a polyimide layer on top, with openings only over the pads. It is drawn translucent here.',
    deep: 'Mobile ions such as sodium would shift transistor thresholds if they reached the devices; silicon nitride is an excellent barrier against them and against water.',
  },
};
