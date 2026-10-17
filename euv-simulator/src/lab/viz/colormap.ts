/**
 * Colour maps for scalar fields. Sequential fields (Mach, p, ρ, T, |V|, Δs) use a perceptually ordered map
 * (viridis control points, van der Walt & Smith 2015) so that lighter always means larger. Signed fields (v, Cp)
 * use a diverging blue – neutral – red map centred on zero, so the sign is readable at a glance.
 */
export type ColormapName = 'viridis' | 'diverging';

const VIRIDIS = ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'];
const DIVERGING = ['#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#ebebeb', '#fddbc7', '#f4a582', '#d6604d', '#b2182b'];

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** 256-entry RGBA table */
export function colormapTable(name: ColormapName): Uint8Array {
  const stops = (name === 'viridis' ? VIRIDIS : DIVERGING).map(hex);
  const out = new Uint8Array(256 * 4);
  for (let k = 0; k < 256; k++) {
    const t = (k / 255) * (stops.length - 1);
    const a = Math.min(stops.length - 2, Math.floor(t));
    const f = t - a;
    for (let c = 0; c < 3; c++) out[k * 4 + c] = Math.round(stops[a][c] * (1 - f) + stops[a + 1][c] * f);
    out[k * 4 + 3] = 255;
  }
  return out;
}

export function colormapCss(name: ColormapName): string {
  const stops = name === 'viridis' ? VIRIDIS : DIVERGING;
  return `linear-gradient(to right, ${stops.map((s, i) => `${s} ${((i / (stops.length - 1)) * 100).toFixed(1)}%`).join(', ')})`;
}

export function sampleColormap(table: Uint8Array, t: number): string {
  const k = Math.max(0, Math.min(255, Math.round(t * 255)));
  return `rgb(${table[k * 4]}, ${table[k * 4 + 1]}, ${table[k * 4 + 2]})`;
}

/** "nice" tick values covering [lo, hi] (about n ticks) */
export function niceTicks(lo: number, hi: number, n = 5): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9 * step; v += step) out.push(Math.abs(v) < 1e-12 * step ? 0 : v);
  return out;
}

/** compact number formatting with units-friendly precision */
export function fmt(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(digits - 1);
  return Number(v.toPrecision(digits)).toString();
}
