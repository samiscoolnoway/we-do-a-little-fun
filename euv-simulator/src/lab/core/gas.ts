/**
 * Calorically perfect ideal gas (air at moderate temperature).
 *
 *   p = ρ R T                       equation of state
 *   E = p / (γ − 1) + ½ ρ (u² + v²)  total energy per unit volume
 *   a = √(γ p / ρ) = √(γ R T)        speed of sound
 *
 * Constants are standard values for dry air with constant specific heats. At the stagnation temperatures of
 * real high-speed flight (thousands of kelvin) air is no longer calorically perfect: vibrational excitation,
 * dissociation and ionisation change γ and c_p. This model does not include those effects.
 * All quantities are SI.
 */
export const GAS = {
  /** specific gas constant of dry air, J/(kg·K) */
  R: 287.05,
  /** ratio of specific heats c_p / c_v (dimensionless) */
  gamma: 1.4,
} as const;

export const CP = (GAS.gamma * GAS.R) / (GAS.gamma - 1); // ≈ 1004.7 J/(kg·K)
export const CV = GAS.R / (GAS.gamma - 1); // ≈ 717.6 J/(kg·K)

/** Stefan–Boltzmann constant, W/(m²·K⁴) */
export const SIGMA_SB = 5.670374419e-8;

export interface Primitive {
  rho: number; // kg/m³
  u: number; // m/s
  v: number; // m/s
  p: number; // Pa
}

export function density(p: number, T: number, R: number = GAS.R): number {
  return p / (R * T);
}

export function temperature(rho: number, p: number, R: number = GAS.R): number {
  return p / (rho * R);
}

export function soundSpeed(rho: number, p: number, gamma: number = GAS.gamma): number {
  return Math.sqrt((gamma * p) / rho);
}

/** total energy per unit volume, J/m³ */
export function totalEnergy(rho: number, u: number, v: number, p: number, gamma: number = GAS.gamma): number {
  return p / (gamma - 1) + 0.5 * rho * (u * u + v * v);
}

/** pressure from conservative variables (ρ, ρu, ρv, E) */
export function pressureFromConservative(rho: number, mu: number, mv: number, E: number, gamma: number = GAS.gamma): number {
  return (gamma - 1) * (E - (0.5 * (mu * mu + mv * mv)) / rho);
}

export function toConservative(w: Primitive, gamma: number = GAS.gamma): [number, number, number, number] {
  return [w.rho, w.rho * w.u, w.rho * w.v, totalEnergy(w.rho, w.u, w.v, w.p, gamma)];
}

export function toPrimitive(U: ArrayLike<number>, gamma: number = GAS.gamma): Primitive {
  const rho = U[0];
  return { rho, u: U[1] / rho, v: U[2] / rho, p: pressureFromConservative(rho, U[1], U[2], U[3], gamma) };
}

/** Freestream state from Mach number, static temperature, static pressure and flow angle (degrees, positive = flow upward). */
export function freestream(mach: number, T: number, p: number, angleDeg = 0): Primitive & { T: number; a: number; V: number; mach: number } {
  const rho = density(p, T);
  const a = Math.sqrt(GAS.gamma * GAS.R * T);
  const V = mach * a;
  const al = (angleDeg * Math.PI) / 180;
  return { rho, u: V * Math.cos(al), v: V * Math.sin(al), p, T, a, V, mach };
}

/** stagnation (total) temperature of the freestream, K: T₀ = T (1 + (γ−1)/2 M²) */
export function stagnationTemperature(T: number, mach: number, gamma: number = GAS.gamma): number {
  return T * (1 + 0.5 * (gamma - 1) * mach * mach);
}

/**
 * Pitot pressure behind a normal shock (Rayleigh pitot formula), Pa. For M ≤ 1, isentropic stagnation pressure.
 * Used as an analytic check on the stagnation pressure computed by the flow solver.
 */
export function pitotPressure(p: number, mach: number, gamma: number = GAS.gamma): number {
  const g = gamma;
  const M2 = mach * mach;
  if (mach <= 1) return p * Math.pow(1 + 0.5 * (g - 1) * M2, g / (g - 1));
  const a = Math.pow(((g + 1) * (g + 1) * M2) / (4 * g * M2 - 2 * (g - 1)), g / (g - 1));
  const b = (1 - g + 2 * g * M2) / (g + 1);
  return p * a * b;
}

/** Normal-shock jump relations (upstream Mach M₁ > 1): pressure, density and temperature ratios, downstream Mach. */
export function normalShock(M1: number, gamma: number = GAS.gamma) {
  const g = gamma;
  const M2s = M1 * M1;
  const p21 = 1 + ((2 * g) / (g + 1)) * (M2s - 1);
  const r21 = ((g + 1) * M2s) / ((g - 1) * M2s + 2);
  const M2 = Math.sqrt((1 + 0.5 * (g - 1) * M2s) / (g * M2s - 0.5 * (g - 1)));
  return { p21, r21, T21: p21 / r21, M2 };
}

/**
 * Sutherland's law for the dynamic viscosity of air, Pa·s:
 *   μ = μ_ref (T / T_ref)^{3/2} (T_ref + S) / (T + S),  μ_ref = 1.716e-5 Pa·s, T_ref = 273.15 K, S = 110.4 K.
 * Used only by the heating model (the Euler solver is inviscid).
 */
export function sutherland(T: number): number {
  const muRef = 1.716e-5;
  const Tref = 273.15;
  const S = 110.4;
  return muRef * Math.pow(T / Tref, 1.5) * ((Tref + S) / (T + S));
}
