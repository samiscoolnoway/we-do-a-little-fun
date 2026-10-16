export type Zone = 'source' | 'scanner' | 'track' | 'etch';
export type ToneMode = 'positive' | 'negative' | 'compare';
export type ViewMode = 'machine' | 'stage' | 'component';
export type Level = 'beginner' | 'intermediate' | 'advanced';
export type Atmosphere = 'vacuum' | 'air';
export type PanelTab = 'inspect' | 'explore' | 'concepts' | 'quiz' | 'about';
export type CasingState = 'closed' | 'open';
export type InspectPreset = 'default' | 'front' | 'side' | 'top' | 'iso';

/** Camera pose described by what must stay visible, so it adapts to any aspect ratio. */
export interface CamPreset {
  t: [number, number, number]; // look-at target
  az: number; // azimuth in degrees (0 = looking down -z from +z)
  el: number; // elevation in degrees
  fit: [number, number]; // world-space width/height that must fit on screen
  /** alternative `fit` for tall, narrow screens (phones in portrait), where the width is the limit */
  fitNarrow?: [number, number];
}

export interface EquationDef {
  title: string;
  /** Mini markup: x_{sub}  x^{sup} */
  tex: string;
  vars: [symbol: string, meaning: string, unit?: string][];
  example?: string;
  note?: string;
}

export type WidgetId = 'photon' | 'resolution' | 'resist' | 'multilayer' | 'mask' | 'beer' | 'transfer';

export type SubsystemId = 'sys-source' | 'sys-illum' | 'sys-reticle' | 'sys-projection' | 'sys-wafer' | 'sys-support' | 'sys-down';

export interface ComponentInfo {
  id: string;
  name: string;
  zone: Zone;
  /** subsystem this component belongs to (explorer hierarchy, breadcrumbs, subsystem isolation) */
  parent: SubsystemId;
  /** 'part' = hardware; 'process' = something that happens (plasma, light, droplets): isolated together with `context` */
  kind?: 'part' | 'process' | 'zone';
  /** hardware shown alongside a process when it is isolated, so the process has something to happen in */
  context?: string[];
  /** construction, sub-parts, materials and neighbours: level 2 of the inspection explanations */
  engineering: string;
  /** Primary stage index (0-based) where this component is the star. */
  stage: number;
  /** Stages (0-based, inclusive) during which the component is active, when it spans more than one. */
  span?: [number, number];
  /** one or two sentences in plain language (high-school level), shown first in the inspector */
  simple: string;
  what: string;
  does: string;
  physics: string;
  chemistry: string;
  equations: EquationDef[];
  see: string;
  deep: { notes: string[]; limits: string[]; equations?: EquationDef[] };
  cam: CamPreset;
  /** default [azimuth, elevation] in the isolated inspection view, when the close-up angle does not suit it */
  inspectView?: [number, number];
  widgets?: WidgetId[];
}

export interface StageDef {
  id: string;
  n: number;
  short: string;
  title: string;
  zone: Zone;
  /** true while the action happens inside the EUV scanner system */
  inScanner: boolean;
  duration: number;
  caption: string;
  watch: string;
  focus: string[]; // component ids emphasised in this stage
  labels: string[]; // label ids shown in close-up mode
  cam: CamPreset;
  /** Path distance (scene units, from the plasma) up to which EUV light is drawn. */
  reach: number;
  /** Collector rays: 1 = only plasma→collector, 2 = also collector→intermediate focus */
  legs: 1 | 2;
  concept?: string;
}

export interface ConceptDef {
  id: string;
  title: string;
  stage: number;
  focus?: string;
  beginner: string;
  intermediate: string;
  advanced: string;
  equation?: EquationDef;
}

export interface QuizQ {
  id: string;
  q: string;
  options: string[];
  answer: number;
  why: string;
  stage: number;
}

// ── finished wafer + chip explorer ──
/** Scale level of the chip explorer: physical wafer and die, then enlarged educational models of a circuit region, a cell and one transistor. */
export type ChipLevel = 'wafer' | 'die' | 'block' | 'cell' | 'transistor';
/** Top-down layout view, or a cut along the transistor channel, or a cut across the gate. */
export type ChipView = 'top' | 'channel' | 'gate';
export interface ChipState {
  level: ChipLevel;
  /** selected die (index into DIES) */
  die: number | null;
  /** floorplan region of the die that was opened (FLOORPLAN id) */
  region: string | null;
  /** transistor isolated at the transistor level */
  device: string | null;
  /** structure whose explanation is shown (CHIP_INFO key) */
  sel: string | null;
  /** the clicked instance in a box model, outlined */
  selBox: number | null;
  view: ChipView;
  /** 0 = layers in place, 1 = fully separated */
  explode: number;
  /** hidden layer ids (CHIP_LAYERS) */
  hidden: string[];
  /** draw only the selected structure */
  iso: boolean;
  /** illustrative ON state of the isolated transistor */
  on: boolean;
  /** changes on every "Reset view" (re-frames the camera) */
  nonce: number;
}
