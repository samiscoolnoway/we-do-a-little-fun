import type { ThermalConfig } from './config';

/**
 * Heat-shield material presets. Metals: room-temperature properties from F. P. Incropera et al., Fundamentals of
 * Heat and Mass Transfer, Table A.1 (300 K). The insulators are illustrative round values in the range of
 * low-density ceramic and charring insulators, NOT data for any specific product; real properties vary strongly
 * with temperature, which this constant-property model ignores.
 */
export interface MaterialPreset {
  id: string;
  label: string;
  rho: number;
  cp: number;
  k: number;
  emissivity: number;
  source: string;
}

export const MATERIALS: MaterialPreset[] = [
  { id: 'insulator', label: 'Illustrative insulating heat-shield material', rho: 280, cp: 1200, k: 0.4, emissivity: 0.85, source: 'illustrative values (not a specific material)' },
  { id: 'ceramic', label: 'Illustrative low-density ceramic insulation', rho: 150, cp: 900, k: 0.06, emissivity: 0.85, source: 'illustrative values (not a specific material)' },
  { id: 'aluminium', label: 'Aluminium alloy 2024-T6', rho: 2770, cp: 875, k: 177, emissivity: 0.3, source: 'Incropera Table A.1, 300 K; ε illustrative (oxidised surface)' },
  { id: 'steel', label: 'Stainless steel AISI 304', rho: 7900, cp: 477, k: 14.9, emissivity: 0.6, source: 'Incropera Table A.1, 300 K; ε illustrative (oxidised surface)' },
  { id: 'copper', label: 'Copper (pure)', rho: 8933, cp: 385, k: 401, emissivity: 0.3, source: 'Incropera Table A.1, 300 K; ε illustrative' },
];

export function matchMaterial(t: ThermalConfig): MaterialPreset | undefined {
  return MATERIALS.find((m) => m.rho === t.rho && m.cp === t.cp && m.k === t.k);
}
