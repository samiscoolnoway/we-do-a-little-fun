import type { ToneMode } from './types';

export type LabelRef = 'world' | 'slabA' | 'slabB' | 'wafer';
export type LabelColor = 'laser' | 'plasma' | 'euv' | 'mask' | 'silicon' | 'resist' | 'track' | 'etch' | 'steel' | 'zone' | 'tin';

export interface LabelCtx {
  tone: ToneMode;
  stage: number;
}

export interface LabelDef {
  id: string;
  text: string | ((c: LabelCtx) => string);
  sub?: string | ((c: LabelCtx) => string);
  comp: string; // component opened on click
  ref: LabelRef;
  p: [number, number, number];
  pNeg?: [number, number, number]; // alternate anchor for negative tone (slab labels)
  pStage?: Partial<Record<number, [number, number, number]>>; // per-stage anchor override (world labels)
  off: [number, number]; // preferred offset (px) of the label centre from its anchor
  color: LabelColor;
  kind?: 'part' | 'zone' | 'tag';
  overview?: boolean;
  show?: (c: LabelCtx) => boolean;
}

const L = (d: LabelDef): LabelDef => d;

export const LABELS: LabelDef[] = [
  // ── Source module ──
  L({ id: 'l-dropgen', text: 'Tin Droplet Generator', sub: 'heated nozzle, ~50 000 droplets/s', comp: 'dropletGenerator', ref: 'world', p: [-7, 8.7, 0], off: [112, -26], color: 'tin', overview: true }),
  L({ id: 'l-droplets', text: 'Molten Tin Droplets', sub: 'liquid Sn, melts at 232 °C', comp: 'droplets', ref: 'world', p: [-7, 4.9, 0], off: [112, -6], color: 'tin' }),
  L({ id: 'l-surface', text: 'Surface tension pulls it round', comp: 'droplets', ref: 'world', p: [-7.05, 6.0, 0], off: [-124, -22], color: 'tin' }),
  L({ id: 'l-catcher', text: 'Tin Catcher', sub: 'collects unused tin', comp: 'catcher', ref: 'world', p: [-7, -1.0, 0], off: [96, 6], color: 'tin' }),
  L({ id: 'l-vessel', text: 'Vacuum Chamber', sub: 'EUV is absorbed by air', comp: 'vacuum', ref: 'world', p: [-11.4, 6.2, 0], off: [-108, -10], color: 'steel', overview: true }),
  L({ id: 'l-laser', text: 'CO₂ Laser', sub: '10.6 µm infrared, tens of kW', comp: 'co2Laser', ref: 'world', p: [-16.1, 4.5, 0], off: [-6, -44], color: 'laser', overview: true }),
  L({ id: 'l-prepulse', text: 'Pre-pulse', sub: 'reshapes the droplet', comp: 'laserPulses', ref: 'world', p: [-8.35, 3.38, 0], off: [-88, -68], color: 'laser' }),
  L({ id: 'l-mainpulse', text: 'Main Pulse', sub: 'heats it to plasma', comp: 'laserPulses', ref: 'world', p: [-11.2, 3, 0], off: [-70, 62], color: 'laser' }),
  L({ id: 'l-pancake', text: 'Droplet → flat disc', comp: 'laserPulses', ref: 'world', p: [-7, 2.2, 0], off: [116, 34], color: 'laser' }),
  L({ id: 'l-droplets2', text: 'Molten tin droplet', comp: 'droplets', ref: 'world', p: [-7, 5.2, 0], off: [112, -24], color: 'tin' }),
  L({ id: 'l-plasma', text: 'Tin Plasma', sub: '≈10⁵ K, ions Sn⁸⁺…Sn¹⁴⁺', comp: 'plasma', ref: 'world', p: [-7, 3, 0], off: [104, 62], color: 'plasma', overview: true }),
  L({ id: 'l-euv', text: '13.5 nm EUV Radiation', sub: 'invisible; colour is a visual aid', comp: 'euvBeam', ref: 'world', p: [-4.7, 3.6, 0], off: [6, -84], color: 'euv', overview: true }),
  L({ id: 'l-lost', text: 'Emitted in all directions', comp: 'euvBeam', ref: 'world', p: [-5.6, 5.1, 0], off: [76, -52], color: 'euv' }),
  L({ id: 'l-collector', text: 'Collector Mirror', sub: 'ellipsoidal, Mo/Si multilayer', comp: 'collector', ref: 'world', p: [-9.2, 5.9, 0], off: [-112, -28], color: 'steel', overview: true }),
  L({ id: 'l-multilayer', text: 'Multilayer coating', comp: 'collector', ref: 'world', p: [-8.75, 4.4, 0], off: [-112, 4], color: 'steel' }),
  L({ id: 'l-h2', text: 'H₂ buffer gas flow', sub: 'sweeps away tin debris', comp: 'vacuum', ref: 'world', p: [-9.05, 0.7, 0], off: [-104, 44], color: 'steel' }),
  L({ id: 'l-if', text: 'Intermediate Focus', sub: 'light enters the scanner', comp: 'intermediateFocus', ref: 'world', p: [-2, 3, 0], off: [4, 72], color: 'euv', overview: true }),

  // ── Illuminator ──
  L({ id: 'l-illum', text: 'Illumination Optics', sub: 'facet mirrors + relay', comp: 'illumination', ref: 'world', p: [6.1, 6.3, 0], off: [-4, -46], color: 'euv', overview: true }),
  L({ id: 'l-ffm', text: 'Field Facet Mirror', comp: 'ffm', ref: 'world', p: [3.17, 5.9, 0], off: [-28, -60], color: 'steel' }),
  L({ id: 'l-pfm', text: 'Pupil Facet Mirror', comp: 'pfm', ref: 'world', p: [9.08, 5.1, 0], off: [16, -64], color: 'steel' }),
  L({ id: 'l-relay', text: 'Relay Mirror', comp: 'illumination', ref: 'world', p: [14.595, 4.9, 0], off: [-76, 52], color: 'steel' }),
  L({ id: 'l-r', text: '~65% reflected per mirror', comp: 'euvBeam', ref: 'world', p: [11.84, 4.72, 0], off: [-8, 66], color: 'euv' }),

  // ── Mask ──
  L({ id: 'l-reticle', text: 'Reflective Mask', sub: 'multilayer mirror + absorber', comp: 'reticle', ref: 'world', p: [17.15, 13.45, 0], off: [86, 24], color: 'mask', overview: true }),
  L({ id: 'l-reticlestage', text: 'Reticle Stage', sub: 'scans at 4× wafer speed', comp: 'reticle', ref: 'world', p: [14.2, 14.35, 0], off: [-84, -22], color: 'mask' }),
  L({ id: 'l-absorber', text: 'Mask pattern, magnified', sub: 'dark = absorber, bright = mirror', comp: 'reticle', ref: 'world', p: [20.6, 15.3, 1.3], off: [104, 0], color: 'mask' }),
  L({ id: 'l-patterned', text: 'Patterned EUV', sub: 'reflected light carries the pattern', comp: 'euvBeam', ref: 'world', p: [16.8, 9.0, 0], off: [-112, 8], color: 'euv' }),
  L({ id: 'l-patterned2', text: 'Pattern-carrying beam', comp: 'euvBeam', ref: 'world', p: [20.0, 7.75, 0], off: [-6, -48], color: 'euv' }),

  // ── Projection optics ──
  L({ id: 'l-po', text: 'Projection Optics', sub: '6 mirrors, 4× reduction', comp: 'projection', ref: 'world', p: [21.4, 12.4, 0], off: [4, -52], color: 'steel', overview: true }),
  L({ id: 'l-m1', text: 'M1', comp: 'projection', ref: 'world', p: [17.6, 3.5, 0], off: [-26, 34], color: 'steel' }),
  L({ id: 'l-m6', text: 'M6', comp: 'projection', ref: 'world', p: [25.6, 11.9, 0], off: [32, -26], color: 'steel' }),
  L({ id: 'l-reduce', text: '4× reduction', sub: 'mask feature → ¼ size', comp: 'projection', ref: 'world', p: [26.53, 2.0, 0], off: [84, -4], color: 'euv' }),
  L({ id: 'l-na', text: 'NA = 0.33', sub: 'sets the resolution limit', comp: 'projection', ref: 'world', p: [27.2, -1.25, 0], off: [86, 36], color: 'euv' }),

  // ── Wafer ──
  L({ id: 'l-wafer', text: 'Silicon Wafer', sub: '300 mm, resist-coated', comp: 'wafer', ref: 'wafer', p: [1.0, 0.05, 0.3], off: [90, -18], color: 'silicon', overview: true }),
  L({ id: 'l-field', text: 'Exposure field', sub: 'scanned slit', comp: 'wafer', ref: 'wafer', p: [-0.2, 0.06, -0.1], off: [-88, -34], color: 'euv' }),

  // ── Resist cross-section (anchors in slab-local space) ──
  L({
    id: 'l-resist',
    text: (c) => (c.stage >= 10 ? 'Photoresist (etch mask)' : 'Photoresist'),
    sub: 'tens of nm thick in reality',
    comp: 'resist',
    ref: 'slabA',
    p: [-2.62, 1.62, 0.55],
    off: [-108, -26],
    color: 'resist',
  }),
  L({ id: 'l-film', text: 'Underlying film', sub: 'to be patterned', comp: 'etcher', ref: 'slabA', p: [2.62, 0.82, 0.55], off: [100, 6], color: 'etch' }),
  L({ id: 'l-silicon', text: 'Silicon', comp: 'wafer', ref: 'slabA', p: [-2.5, 0.27, 0.55], off: [-86, 26], color: 'silicon' }),
  L({ id: 'l-photons', text: 'EUV photons, 92 eV', sub: 'most pass straight through', comp: 'euvBeam', ref: 'slabA', p: [1.05, 3.1, 0], off: [104, -18], color: 'euv' }),
  L({ id: 'l-electrons', text: 'Secondary electrons', sub: 'few–tens of eV, ~nm range', comp: 'resist', ref: 'slabA', p: [-0.75, 1.5, 0.55], off: [-110, -50], color: 'resist' }),
  L({ id: 'l-acid', text: 'Photoacid (H⁺)', sub: 'made where the image is bright', comp: 'resist', ref: 'slabA', p: [0.92, 1.25, 0.55], off: [104, 36], color: 'plasma' }),
  L({ id: 'l-latent', text: 'Latent image', sub: 'chemical, not yet visible', comp: 'resist', ref: 'slabA', p: [0.92, 1.8, 0.55], off: [-96, -52], color: 'plasma' }),
  L({
    id: 'l-deprot',
    text: (c) => (c.tone === 'negative' ? 'Acid-catalysed cross-linking' : 'Acid-catalysed deprotection'),
    sub: 'one acid, many reactions',
    comp: 'bakePlate',
    ref: 'slabA',
    p: [0.92, 1.5, 0.55],
    off: [108, -44],
    color: 'plasma',
  }),
  L({
    id: 'l-dissolve',
    text: 'Soluble resist dissolves',
    sub: (c) => (c.tone === 'negative' ? 'unexposed regions (negative tone)' : 'exposed regions (positive tone)'),
    comp: 'developer',
    ref: 'slabA',
    p: [0.92, 1.75, 0.55],
    pNeg: [0, 1.75, 0.55],
    off: [112, -42],
    color: 'track',
  }),
  L({
    id: 'l-transfer',
    text: 'Pattern Transfer',
    sub: 'film etched where resist is gone',
    comp: 'etcher',
    ref: 'slabA',
    p: [0.92, 0.78, 0.55],
    pNeg: [0, 0.78, 0.55],
    off: [112, 30],
    color: 'etch',
    overview: false,
  }),
  L({ id: 'l-ions', text: 'Reactive ions', sub: 'accelerated straight down', comp: 'etcher', ref: 'slabA', p: [-1.8, 3.0, 0], off: [-96, -10], color: 'etch' }),
  L({ id: 'l-strip', text: 'Resist strip', sub: 'final step', comp: 'etcher', ref: 'slabA', p: [0, 1.6, 0.55], off: [-12, -78], color: 'resist' }),
  L({
    id: 'l-tone-a',
    kind: 'tag',
    text: (c) => (c.tone === 'compare' ? 'Positive-tone' : c.tone === 'negative' ? 'Negative-tone resist' : 'Positive-tone resist'),
    comp: 'resist',
    ref: 'slabA',
    p: [0, 3.55, 0.3], // above the aerial image while the wafer is being exposed …
    pStage: { 8: [0, 2.12, 0.3], 9: [0, 2.12, 0.3], 10: [0, 2.12, 0.3] }, // … and just above the resist after it
    off: [0, -38],
    color: 'resist',
  }),
  L({
    id: 'l-tone-b',
    kind: 'tag',
    text: 'Negative-tone',
    comp: 'resist',
    ref: 'slabB',
    p: [0, 3.55, 0.3],
    pStage: { 8: [0, 2.12, 0.3], 9: [0, 2.12, 0.3], 10: [0, 2.12, 0.3] },
    off: [0, -38],
    color: 'resist',
    show: (c) => c.tone === 'compare',
  }),

  // ── Downstream tools ──
  L({ id: 'l-peb', text: 'Post-Exposure Bake', sub: 'hot plate in the track', comp: 'bakePlate', ref: 'world', p: [24, -13.0, 1.2], off: [0, -56], color: 'track', overview: true }),
  L({ id: 'l-developer', text: 'Development', sub: 'track developer module', comp: 'developer', ref: 'world', p: [10, -13.0, 1.2], off: [0, -56], color: 'track', overview: true }),
  L({ id: 'l-etch', text: 'Etch Chamber', sub: 'plasma etch tool', comp: 'etcher', ref: 'world', p: [-3, -12.9, 1.2], off: [0, -56], color: 'etch', overview: true }),

  // ── Zones ──
  L({ id: 'l-scanner', kind: 'zone', text: 'EUV SCANNER SYSTEM · vacuum', sub: 'source → illuminator → mask → projection → wafer stage', comp: 'zoneScanner', ref: 'world', p: [-19.6, 17.4, 4.2], off: [196, 30], color: 'zone', overview: true }),
  L({ id: 'l-down', kind: 'zone', text: 'DOWNSTREAM PROCESSING · outside the scanner', sub: 'track (bake, develop) + etch tool: separate machines', comp: 'zoneDownstream', ref: 'world', p: [29.6, -20.9, 3.4], pStage: { 8: [24, -12.2, 3.4], 9: [10, -12.2, 3.4], 10: [-3, -12.2, 3.4] }, off: [-196, 22], color: 'zone', overview: true }),
];

export const LABEL_BY_ID: Record<string, LabelDef> = Object.fromEntries(LABELS.map((l) => [l.id, l]));
