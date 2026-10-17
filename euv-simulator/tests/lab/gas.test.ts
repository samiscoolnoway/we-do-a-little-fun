import { CP, CV, GAS, density, freestream, normalShock, pitotPressure, pressureFromConservative, soundSpeed, stagnationTemperature, sutherland, temperature, toConservative, toPrimitive } from '../../src/lab/core/gas';
import { sampleRiemann, starState } from '../../src/lab/core/riemann';

// Reference values: ISA sea level (ρ = 1.2250 kg/m³, a = 340.29 m/s at 288.15 K, 101 325 Pa);
// NACA Report 1135 tables for normal shocks and the Rayleigh pitot formula; Toro (2009) table 4.3 for Sod.
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('ideal-gas equation of state and units', () => {
  it('specific heats are consistent with R and γ', () => {
    expect(CP - CV).toBeCloseTo(GAS.R, 10);
    expect(CP / CV).toBeCloseTo(GAS.gamma, 12);
    expect(CP).toBeCloseTo(1004.675, 2);
  });

  it('reproduces ISA sea-level density and speed of sound (SI units)', () => {
    const rho = density(101325, 288.15);
    expect(rel(rho, 1.225)).toBeLessThan(2e-4);
    expect(rel(soundSpeed(rho, 101325), 340.29)).toBeLessThan(1e-4);
    expect(temperature(rho, 101325)).toBeCloseTo(288.15, 9);
  });

  it('conservative ↔ primitive round trip', () => {
    const w = { rho: 0.413, u: 612.5, v: -48.2, p: 26500 };
    const U = toConservative(w);
    const back = toPrimitive(U);
    expect(rel(back.rho, w.rho)).toBeLessThan(1e-14);
    expect(rel(back.u, w.u)).toBeLessThan(1e-14);
    expect(rel(back.v, w.v)).toBeLessThan(1e-13);
    expect(rel(back.p, w.p)).toBeLessThan(1e-12);
    expect(rel(pressureFromConservative(U[0], U[1], U[2], U[3]), w.p)).toBeLessThan(1e-12);
  });

  it('freestream builder: Mach, angle and velocity components', () => {
    const fs = freestream(3, 220, 5000, 10);
    expect(rel(fs.V, 3 * Math.sqrt(1.4 * 287.05 * 220))).toBeLessThan(1e-14);
    expect(rel(Math.atan2(fs.v, fs.u), (10 * Math.PI) / 180)).toBeLessThan(1e-14);
    expect(rel(Math.hypot(fs.u, fs.v) / soundSpeed(fs.rho, fs.p), 3)).toBeLessThan(1e-13);
  });

  it('stagnation temperature T0 = T(1 + 0.2 M²)', () => {
    expect(stagnationTemperature(250, 5)).toBeCloseTo(1500, 9);
  });

  it('normal-shock relations at M = 2 match the NACA 1135 table', () => {
    const s = normalShock(2);
    expect(s.p21).toBeCloseTo(4.5, 10);
    expect(rel(s.r21, 2.6667)).toBeLessThan(1e-4);
    expect(rel(s.T21, 1.6875)).toBeLessThan(1e-4);
    expect(rel(s.M2, 0.57735)).toBeLessThan(1e-4);
  });

  it('pitot pressure: Rayleigh formula (M = 2 → 5.6404 p) and isentropic below M = 1 (M = 0.5 → 1.1862 p)', () => {
    expect(rel(pitotPressure(1, 2), 5.6404)).toBeLessThan(1e-4);
    expect(rel(pitotPressure(1, 0.5), 1.1862)).toBeLessThan(1e-4);
    // continuous at M = 1
    expect(rel(pitotPressure(1, 1 + 1e-9), pitotPressure(1, 1))).toBeLessThan(1e-7);
  });

  it("Sutherland's law: μ(273.15 K) = 1.716e-5 Pa·s, μ(300 K) ≈ 1.846e-5 Pa·s", () => {
    expect(rel(sutherland(273.15), 1.716e-5)).toBeLessThan(1e-12);
    expect(rel(sutherland(300), 1.8458e-5)).toBeLessThan(5e-4);
  });
});

describe('exact Riemann solver', () => {
  it('Sod problem star state matches Toro table 4.3 (p* = 0.30313, u* = 0.92745)', () => {
    const s = starState({ rho: 1, u: 0, p: 1 }, { rho: 0.125, u: 0, p: 0.1 });
    expect(rel(s.p, 0.30313)).toBeLessThan(2e-5);
    expect(rel(s.u, 0.92745)).toBeLessThan(2e-5);
  });

  it('star densities on either side of the contact (0.42632 and 0.26557)', () => {
    const L = { rho: 1, u: 0, p: 1 };
    const R = { rho: 0.125, u: 0, p: 0.1 };
    const st = starState(L, R);
    expect(rel(sampleRiemann(L, R, st.u - 1e-6).rho, 0.42632)).toBeLessThan(5e-5);
    expect(rel(sampleRiemann(L, R, st.u + 1e-6).rho, 0.26557)).toBeLessThan(5e-5);
  });

  it('123 problem (two rarefactions) is symmetric', () => {
    const L = { rho: 1, u: -2, p: 0.4 };
    const R = { rho: 1, u: 2, p: 0.4 };
    const st = starState(L, R);
    expect(Math.abs(st.u)).toBeLessThan(1e-12);
    expect(rel(st.p, 0.00189)).toBeLessThan(5e-3);
    const a = sampleRiemann(L, R, -0.7);
    const b = sampleRiemann(L, R, 0.7);
    expect(a.rho).toBeCloseTo(b.rho, 12);
    expect(a.u).toBeCloseTo(-b.u, 12);
  });
});
