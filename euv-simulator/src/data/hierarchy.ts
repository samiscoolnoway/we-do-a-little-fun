import { COMPONENTS, COMPONENT_LIST } from './components';
import type { SubsystemId } from './types';

/**
 * Component identity for exploration: every selectable item is either a component (COMPONENTS) or a
 * subsystem that groups components. The machine view, the interior view, the isolated inspection view,
 * the explorer list and the information card all resolve ids through this file.
 */
export interface SubsystemDef {
  id: SubsystemId;
  name: string;
  /** explanation levels for the whole assembly */
  overview: string;
  engineering: string;
  deep: string;
  children: string[];
}

export const SUBSYSTEMS: SubsystemDef[] = [
  {
    id: 'sys-source',
    name: 'EUV light source',
    overview:
      'Turns tiny drops of tin into flashes of 13.5 nm light. A laser hits each drop, the tin becomes a glowing plasma, and a curved mirror collects the light and sends it into the scanner.',
    engineering:
      'A droplet generator above and a catcher below, the drive laser entering through the centre of the collector, the collector mirror around the plasma, and a vacuum vessel with hydrogen flows, cooling and debris protection. The module ends at the intermediate focus, where the light is handed to the scanner.',
    deep:
      'A CO₂-laser pre-pulse reshapes each tin droplet and the main pulse heats it to electron temperatures of tens of eV. Sn⁸⁺ to Sn¹⁴⁺ ions then emit a dense band of lines near 13.5 nm. An ellipsoidal Mo/Si-coated collector images the plasma onto the intermediate focus. Only a few percent of the laser energy becomes useful in-band EUV; the rest is heat, fast ions and debris that the vessel has to handle.',
    children: ['dropletGenerator', 'droplets', 'co2Laser', 'laserPulses', 'plasma', 'collector', 'catcher', 'vacuum', 'intermediateFocus', 'euvBeam'],
  },
  {
    id: 'sys-illum',
    name: 'Illumination optics',
    overview: 'Mirrors that turn the light from the source into an even strip of light on the mask, arriving from carefully chosen angles.',
    engineering: 'A field facet mirror, a pupil facet mirror and relay mirrors on stable, cooled mounts inside the vacuum.',
    deep:
      'A fly’s-eye integrator: the field facets split the beam, the pupil facets steer each channel, and the images of all facets overlap on the mask, averaging out non-uniformity. The pattern of lit facets on the pupil mirror sets the illumination angles (σ, dipoles), which decides which diffraction orders the projection optics can capture.',
    children: ['illumination', 'ffm', 'pfm'],
  },
  {
    id: 'sys-reticle',
    name: 'Reticle and mask stage',
    overview: 'The mask that carries the chip pattern, and the stage that scans it through the light.',
    engineering: 'A reflective mask on an electrostatic clamp, carried by a long- and short-stroke stage that is measured by interferometers or encoders and synchronised with the wafer stage.',
    deep:
      'The mask reflects where its multilayer is bare and absorbs where the absorber sits. It is lit about 6° off the normal, so the height of the absorber casts small shadows (mask 3D effects). It scans four times faster than the wafer because the projection optics demagnify 4×.',
    children: ['reticle', 'reticleStage'],
  },
  {
    id: 'sys-projection',
    name: 'Projection optics',
    overview: 'Six curved mirrors that shrink the mask pattern four times and focus it sharply onto the wafer.',
    engineering: 'Aspheric multilayer mirrors on actuated mounts in a temperature-stable housing, carried by the vibration-isolated metrology frame.',
    deep:
      'Diffraction orders from the mask that fall inside the numerical aperture (0.33) interfere at the wafer to form the image. Resolution R = k₁λ/NA is about 12–16 nm for k₁ between 0.3 and 0.4, and the depth of focus, roughly λ/NA², is about 120 nm.',
    children: ['projection'],
  },
  {
    id: 'sys-wafer',
    name: 'Wafer stage',
    overview: 'The table that carries the resist-coated wafer under the light, field by field, in perfect step with the mask.',
    engineering: 'A wafer table with an electrostatic clamp on a long- and short-stroke stage, measured against the metrology frame, with level and alignment sensors. The wafer arrives already coated with resist from the track.',
    deep:
      'Overlay of a few nanometres needs position feedback at kilohertz rates, temperature control at the milli-kelvin level (silicon expands 2.6 ppm per kelvin) and focus control within the depth of focus. In the resist, absorbed 92 eV photons release secondary electrons that free acid and form the latent image.',
    children: ['waferStage', 'wafer', 'resist'],
  },
  {
    id: 'sys-support',
    name: 'Supporting systems',
    overview: 'Everything that keeps the optics still, the inside free of gas, the temperature constant, and the machine powered, controlled and protected.',
    engineering: 'A base frame with a vibration-isolated metrology frame, vacuum pumps and valves, cooling loops, cabling, sensors and electronics, and the outer enclosure.',
    deep:
      'Nanometre imaging is as much a stability problem as an optics problem: vibration isolation above about 1 Hz, temperature control to milli-kelvins, gas pressures low enough for EUV to survive metres of path (Beer–Lambert), and feedback control linking sensors and actuators.',
    children: ['frame', 'vacuumPumps', 'cooling', 'cabling', 'enclosure'],
  },
  {
    id: 'sys-down',
    name: 'Downstream processing (separate machines)',
    overview: 'Machines that work on the wafer after the scanner: bake, develop and etch turn the hidden chemical pattern into a real structure.',
    engineering: 'A track (coat, bake, develop) docked to the scanner and a separate plasma-etch tool.',
    deep:
      'The bake drives acid-catalysed deprotection or cross-linking, development dissolves the soluble regions (positive or negative tone), and ion-assisted plasma etching transfers the pattern into the film before the resist is stripped. The exact chemistry depends on the resist formulation.',
    children: ['bakePlate', 'developer', 'etcher'],
  },
];

export const SUBSYSTEM_BY_ID: Record<string, SubsystemDef> = Object.fromEntries(SUBSYSTEMS.map((s) => [s.id, s]));

export const isSubsystem = (id: string | null | undefined): boolean => !!id && id in SUBSYSTEM_BY_ID;

/** Can this id be opened in the isolated inspection view? (zones are regions, not objects) */
export function isInspectable(id: string): boolean {
  if (isSubsystem(id)) return true;
  const c = COMPONENTS[id];
  return !!c && c.kind !== 'zone';
}

/** Registry ids drawn while `id` is inspected: the item itself, a process with its hardware, or a whole assembly. */
export function isolationTargets(id: string): string[] {
  const s = SUBSYSTEM_BY_ID[id];
  if (s) return s.children.filter((c) => COMPONENTS[c]?.kind !== 'process' && c !== 'enclosure' && c !== 'resist');
  const c = COMPONENTS[id];
  if (!c) return [];
  return c.kind === 'process' ? [id, ...(c.context ?? [])] : [id];
}

/** Registry ids the camera frames: the item itself, an assembly's parts, or a process together with the hardware drawn around it. */
export function framingTargets(id: string): string[] {
  return isSubsystem(id) || COMPONENTS[id]?.kind === 'process' ? isolationTargets(id) : [id];
}

export interface InspectInfo {
  id: string;
  name: string;
  category: string;
  path: string[];
  isSubsystem: boolean;
  isProcess: boolean;
  children: string[];
  parent: string | null;
  levels: { overview: string; engineering: string; deep: string };
}

const noChem = /^(no chemistry|none|not a chemical)/i;

/** Everything the inspection card shows for an id, built from the shared component data. */
export function inspectInfo(id: string): InspectInfo | null {
  const s = SUBSYSTEM_BY_ID[id];
  if (s)
    return {
      id,
      name: s.name,
      category: 'Subsystem',
      path: ['Machine', s.name],
      isSubsystem: true,
      isProcess: false,
      children: s.children,
      parent: null,
      levels: { overview: s.overview, engineering: s.engineering, deep: s.deep },
    };
  const c = COMPONENTS[id];
  if (!c) return null;
  const sys = SUBSYSTEM_BY_ID[c.parent];
  const deep = [c.physics, noChem.test(c.chemistry) ? '' : `Chemistry: ${c.chemistry}`, c.deep.notes[0] ?? ''].filter(Boolean).join('\n\n');
  return {
    id,
    name: c.name,
    category: sys?.name ?? 'Machine',
    path: ['Machine', sys?.name ?? '', c.name].filter(Boolean),
    isSubsystem: false,
    isProcess: c.kind === 'process',
    children: [],
    parent: sys?.id ?? null,
    levels: { overview: `${c.simple} ${c.does}`, engineering: c.engineering, deep },
  };
}

/** Components that are not listed under any subsystem (sanity check used by the tests). */
export const ORPHANS = COMPONENT_LIST.filter((c) => c.kind !== 'zone' && !SUBSYSTEMS.some((s) => s.children.includes(c.id))).map((c) => c.id);
