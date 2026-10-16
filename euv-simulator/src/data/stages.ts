import type { CamPreset, StageDef, Zone } from './types';
import { N_IDX, S_AT, S_TOTAL } from './layout';

export const OVERVIEW: CamPreset = { t: [6.5, -2.4, 0], az: -8, el: 9, fit: [62, 43] };

export const STAGES: StageDef[] = [
  {
    id: 'droplets',
    n: 1,
    short: 'Droplets',
    title: 'Tin droplets enter the source',
    zone: 'source',
    inScanner: true,
    duration: 10,
    caption:
      'A heated reservoir pushes molten tin (melting point 232 °C) through a nozzle. A vibration breaks the jet into identical droplets and surface tension pulls each one into a sphere. A real source fires roughly 50,000 droplets per second; here the action is slowed down enormously.',
    watch: 'Each droplet leaves the nozzle stretched, wobbles round, then travels at steady speed with even spacing.',
    focus: ['dropletGenerator', 'droplets', 'catcher'],
    labels: ['l-dropgen', 'l-droplets', 'l-catcher', 'l-vessel', 'l-surface'],
    cam: { t: [-7, 4.7, 0], az: -14, el: 7, fit: [10.5, 12.4] },
    reach: 0,
    legs: 1,
    concept: 'tin',
  },
  {
    id: 'prepulse',
    n: 2,
    short: 'Pre-pulse',
    title: 'Laser pre-pulse reshapes the droplet',
    zone: 'source',
    inScanner: true,
    duration: 10,
    caption:
      'A weak CO₂ laser pre-pulse (10.6 µm infrared, invisible; drawn red) hits each droplet first. It flattens the sphere into a wide, thin disc, giving the main pulse a larger, lower-density target. The main pulse is switched off in this stage so you can see the pre-pulse on its own.',
    watch: 'The red pre-pulse arrives slightly upstream. The sphere expands into a disc (edge-on it looks like a thin, tall sliver) and drifts on to the tin catcher.',
    focus: ['co2Laser', 'laserPulses', 'droplets'],
    labels: ['l-laser', 'l-prepulse', 'l-pancake', 'l-droplets2', 'l-catcher'],
    cam: { t: [-8.4, 3.5, 0], az: 30, el: 6, fit: [13.5, 8.8] },
    reach: 0,
    legs: 1,
    concept: 'plasmaCoupling',
  },
  {
    id: 'plasma',
    n: 3,
    short: 'Plasma',
    title: 'Main pulse makes tin plasma and EUV',
    zone: 'source',
    inScanner: true,
    duration: 12,
    caption:
      'The main pulse heats the disc to hundreds of thousands of kelvin. Tin atoms lose 8–14 electrons and the ions emit light near 13.5 nm: plasma radiation, not combustion. EUV leaves in every direction and only the part that reaches the collector is used. Cyan is a visualization aid; EUV is invisible to the eye.',
    watch: 'A white-hot flash with a violet halo; cyan rays spread in all directions and sparkle where they land on the collector.',
    focus: ['plasma', 'euvBeam', 'laserPulses'],
    labels: ['l-laser', 'l-mainpulse', 'l-plasma', 'l-euv', 'l-collector', 'l-lost'],
    cam: { t: [-7.6, 3.6, 0], az: 22, el: 6, fit: [12.5, 8.4] },
    reach: 0,
    legs: 1,
    concept: 'ionization',
  },
  {
    id: 'collector',
    n: 4,
    short: 'Collector',
    title: 'Collector mirror focuses the light',
    zone: 'source',
    inScanner: true,
    duration: 10,
    caption:
      'A curved multilayer mirror shaped like part of an ellipsoid sends light from one focus (the plasma) to the other focus (the intermediate focus). EUV is absorbed by air, so the path is a vacuum with a gentle hydrogen flow that shields the mirror from tin debris. Try the Air option in the controls.',
    watch: 'All rays from the plasma meet at one bright point: every ray has the same path length. In Air, the cyan light dies within a short distance.',
    focus: ['collector', 'vacuum', 'intermediateFocus', 'euvBeam'],
    labels: ['l-collector', 'l-euv', 'l-if', 'l-vessel', 'l-h2', 'l-multilayer'],
    cam: { t: [-6.0, 3.3, 0], az: 24, el: 8, fit: [16.5, 10.5] },
    reach: S_AT[N_IDX.if],
    legs: 2,
    concept: 'vacuum',
  },
  {
    id: 'illumination',
    n: 5,
    short: 'Illumination',
    title: 'Illumination optics shape the beam',
    zone: 'scanner',
    inScanner: true,
    duration: 11,
    caption:
      'From the intermediate focus the light meets a field facet mirror and a pupil facet mirror (each built from many small tilted mirrors) and then a relay mirror. Together they make the light uniform across the mask and set the angles from which it arrives. Each mirror reflects only about 60–70% of the EUV.',
    watch: 'The beam widens, then narrows again, and dims at every reflection. The bright facets on the pupil mirror show the illumination shape.',
    focus: ['illumination', 'ffm', 'pfm', 'intermediateFocus'],
    labels: ['l-if', 'l-ffm', 'l-pfm', 'l-relay', 'l-illum', 'l-r'],
    cam: { t: [7.6, 5, 0], az: -10, el: 10, fit: [25, 12.5] },
    reach: S_AT[N_IDX.reticle],
    legs: 2,
    concept: 'multilayer',
  },
  {
    id: 'mask',
    n: 6,
    short: 'Mask',
    title: 'The reflective mask carries the circuit pattern',
    zone: 'scanner',
    inScanner: true,
    duration: 11,
    caption:
      'The mask is a mirror, not a transparent slide. About 40 pairs of molybdenum and silicon layers reflect the light and a patterned absorber on top swallows it where no light should go. The reflected beam therefore carries the circuit pattern, drawn 4× larger than it will be on the wafer.',
    watch: 'Beamlets that hit the absorber stop at the mask; the rest reflect toward the projection optics. A bright slit scans across the pattern.',
    focus: ['reticle'],
    labels: ['l-reticle', 'l-reticlestage', 'l-absorber', 'l-patterned'],
    cam: { t: [16.6, 11.6, 0], az: -34, el: -20, fit: [13, 11] },
    reach: S_AT[N_IDX.m1],
    legs: 2,
    concept: 'maskImaging',
  },
  {
    id: 'projection',
    n: 7,
    short: 'Projection',
    title: 'Projection optics shrink the image 4×',
    zone: 'scanner',
    inScanner: true,
    duration: 12,
    caption:
      'Six ultra-smooth multilayer mirrors collect the light diffracted by the mask pattern and form a 4× reduced image on the wafer. The more diffraction orders they capture (set by the numerical aperture, 0.33 for conventional EUV), the finer the detail that prints: R = k₁λ/NA. This six-mirror layout is a simplified teaching model, not the real optical design.',
    watch: 'The patterned bundle narrows by four from mask to wafer. Open the diffraction lab in the inspector to see which orders get captured.',
    focus: ['projection'],
    labels: ['l-po', 'l-m1', 'l-m6', 'l-reduce', 'l-na', 'l-patterned2'],
    cam: { t: [21.4, 6.9, 0], az: 12, el: 8, fit: [17, 21.5] },
    reach: S_TOTAL + 2,
    legs: 2,
    concept: 'diffraction',
  },
  {
    id: 'exposure',
    n: 8,
    short: 'Exposure',
    title: 'EUV exposes the photoresist',
    zone: 'scanner',
    inScanner: true,
    duration: 13,
    caption:
      'A 92 eV photon is absorbed in the resist by photoionisation. The freed electron and the secondary electrons it creates (a few to tens of eV) travel a few nanometres and ionise more molecules. In a chemically amplified resist this releases acid, mostly where the image is bright, leaving a hidden (latent) image. Only a minority of photons are absorbed.',
    watch: 'Cyan photons fall into the magnified cross-section. Flashes mark absorption, yellow secondary electrons scatter and violet acid dots pile up in the bright regions.',
    focus: ['wafer', 'resist'],
    labels: ['l-wafer', 'l-resist', 'l-photons', 'l-electrons', 'l-acid', 'l-film', 'l-field', 'l-silicon', 'l-tone-a', 'l-tone-b'],
    cam: { t: [27.5, -5.4, 0], az: -8, el: 5, fit: [15, 12.5], fitNarrow: [9, 12.5] },
    reach: S_TOTAL + 2,
    legs: 2,
    concept: 'resistChem',
  },
  {
    id: 'peb',
    n: 9,
    short: 'Bake',
    title: 'Post-exposure bake amplifies the image',
    zone: 'track',
    inScanner: false,
    duration: 11,
    caption:
      'The exposed wafer leaves the scanner and is baked at roughly 90–130 °C in the track, a separate machine. Each acid molecule diffuses a few nanometres and catalyses many reactions: it removes protecting groups (positive tone) or triggers cross-linking (negative tone). A faint chemical image becomes a strong solubility difference.',
    watch: 'The wafer rides out of the scanner to the hot plate. Acid dots hop around and leave marks: pale (soluble) in positive tone, dark (hardened) in negative tone.',
    focus: ['bakePlate', 'resist', 'zoneDownstream'],
    labels: ['l-peb', 'l-down', 'l-resist', 'l-latent', 'l-deprot', 'l-tone-a', 'l-tone-b'],
    cam: { t: [24, -11.2, 0], az: -10, el: 7, fit: [15, 14], fitNarrow: [9.5, 14] },
    reach: S_TOTAL + 2,
    legs: 2,
    concept: 'resistChem',
  },
  {
    id: 'develop',
    n: 10,
    short: 'Develop',
    title: 'Development dissolves the soluble resist',
    zone: 'track',
    inScanner: false,
    duration: 12,
    caption:
      'In the track’s developer module a liquid developer dissolves the more soluble resist: the exposed regions for positive tone (aqueous base such as TMAH), the unexposed regions for negative tone (usually an organic solvent). The strongly non-linear dissolution gives steep sidewalls.',
    watch: 'Compare positive and negative tone: the same exposure leaves lines where the opposite regions were. Soluble resist lifts away from the top down.',
    focus: ['developer', 'resist', 'zoneDownstream'],
    labels: ['l-developer', 'l-down', 'l-resist', 'l-dissolve', 'l-tone-a', 'l-tone-b'],
    cam: { t: [10, -11.2, 0], az: -10, el: 7, fit: [15, 14], fitNarrow: [9.5, 14] },
    reach: S_TOTAL + 2,
    legs: 2,
    concept: 'tone',
  },
  {
    id: 'etch',
    n: 11,
    short: 'Etch',
    title: 'Etching transfers the pattern',
    zone: 'etch',
    inScanner: false,
    duration: 13,
    caption:
      'In another separate tool, a plasma accelerates ions straight down. Where the resist is gone the film underneath is etched away; where resist remains it protects the film. The leftover resist is then stripped, leaving the pattern in the film. This is pattern transfer.',
    watch: 'Green ions rain downward. The film vanishes in the open trenches, the resist erodes slowly and is finally stripped.',
    focus: ['etcher', 'resist', 'zoneDownstream'],
    labels: ['l-etch', 'l-down', 'l-transfer', 'l-ions', 'l-resist', 'l-film', 'l-strip', 'l-tone-a', 'l-tone-b'],
    cam: { t: [-3, -11.2, 0], az: -10, el: 7, fit: [15, 14], fitNarrow: [9.5, 14] },
    reach: S_TOTAL + 2,
    legs: 2,
    concept: 'etch',
  },
];

export const N_STAGES = STAGES.length;
export const STAGE_START: number[] = [];
{
  let t = 0;
  for (const s of STAGES) {
    STAGE_START.push(t);
    t += s.duration;
  }
}
export const T_TOTAL = STAGES.reduce((a, s) => a + s.duration, 0);

export function stageAt(T: number): number {
  const t = Math.min(Math.max(T, 0), T_TOTAL - 1e-6);
  for (let i = N_STAGES - 1; i >= 0; i--) if (t >= STAGE_START[i]) return i;
  return 0;
}
export const stageProgress = (T: number, i: number) => Math.min(1, Math.max(0, (T - STAGE_START[i]) / STAGES[i].duration));

export const ZONE_LABEL: Record<Zone, string> = {
  source: 'EUV source module',
  scanner: 'EUV scanner',
  track: 'Track (outside scanner)',
  etch: 'Etch tool (outside scanner)',
};
export const fmtTime = (t: number) => {
  const s = Math.max(0, Math.round(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
