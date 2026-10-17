import { GAS } from './gas';

/**
 * Exact solution of the one-dimensional Riemann problem for the Euler equations with an ideal gas
 * (E. F. Toro, "Riemann Solvers and Numerical Methods for Fluid Dynamics", 3rd ed., Springer 2009, ch. 4).
 *
 * Two uniform states, left and right of x = x0, are released at t = 0. The solution is self-similar in
 * ξ = (x − x0) / t: a left wave (shock or rarefaction), a contact discontinuity and a right wave. The pressure p*
 * and velocity u* between the two outer waves are found with Newton iterations on the pressure function.
 *
 * Used as the reference for the shock-tube benchmark of the finite-volume solver.
 */
export interface State1D {
  rho: number;
  u: number;
  p: number;
}

function fK(p: number, s: State1D, g: number): [number, number] {
  const a = Math.sqrt((g * s.p) / s.rho);
  if (p > s.p) {
    // shock
    const A = 2 / ((g + 1) * s.rho);
    const B = ((g - 1) / (g + 1)) * s.p;
    const q = Math.sqrt(A / (p + B));
    return [(p - s.p) * q, q * (1 - (0.5 * (p - s.p)) / (B + p))];
  }
  // rarefaction
  const pr = p / s.p;
  return [((2 * a) / (g - 1)) * (Math.pow(pr, (g - 1) / (2 * g)) - 1), (1 / (s.rho * a)) * Math.pow(pr, -(g + 1) / (2 * g))];
}

/** star-region pressure and velocity */
export function starState(L: State1D, R: State1D, g: number = GAS.gamma): { p: number; u: number } {
  const aL = Math.sqrt((g * L.p) / L.rho);
  const aR = Math.sqrt((g * R.p) / R.rho);
  if ((2 / (g - 1)) * (aL + aR) <= R.u - L.u) throw new Error('vacuum is generated: no star state');
  // two-rarefaction initial guess (Toro eq. 4.46), always positive
  const z = (g - 1) / (2 * g);
  let p = Math.pow((aL + aR - 0.5 * (g - 1) * (R.u - L.u)) / (aL / Math.pow(L.p, z) + aR / Math.pow(R.p, z)), 1 / z);
  for (let k = 0; k < 100; k++) {
    const [fl, dl] = fK(p, L, g);
    const [fr, dr] = fK(p, R, g);
    const pn = Math.max(1e-12 * p, p - (fl + fr + R.u - L.u) / (dl + dr));
    const change = Math.abs(pn - p) / (0.5 * (pn + p));
    p = pn;
    if (change < 1e-14) break;
  }
  const u = 0.5 * (L.u + R.u) + 0.5 * (fK(p, R, g)[0] - fK(p, L, g)[0]);
  return { p, u };
}

/** sample the exact solution at similarity coordinate ξ = (x − x0)/t */
export function sampleRiemann(L: State1D, R: State1D, xi: number, g: number = GAS.gamma, star = starState(L, R, g)): State1D {
  const { p: ps, u: us } = star;
  const gm = (g - 1) / (g + 1);
  if (xi <= us) {
    // left of the contact
    const a = Math.sqrt((g * L.p) / L.rho);
    if (ps > L.p) {
      const S = L.u - a * Math.sqrt(((g + 1) / (2 * g)) * (ps / L.p) + (g - 1) / (2 * g));
      if (xi <= S) return { ...L };
      return { rho: (L.rho * (ps / L.p + gm)) / (gm * (ps / L.p) + 1), u: us, p: ps };
    }
    const aStar = a * Math.pow(ps / L.p, (g - 1) / (2 * g));
    const head = L.u - a;
    const tail = us - aStar;
    if (xi <= head) return { ...L };
    if (xi >= tail) return { rho: L.rho * Math.pow(ps / L.p, 1 / g), u: us, p: ps };
    const c = (2 / (g + 1)) * (a + 0.5 * (g - 1) * (L.u - xi));
    const u = (2 / (g + 1)) * (a + 0.5 * (g - 1) * L.u + xi);
    const rho = L.rho * Math.pow(c / a, 2 / (g - 1));
    return { rho, u, p: L.p * Math.pow(c / a, (2 * g) / (g - 1)) };
  }
  // right of the contact
  const a = Math.sqrt((g * R.p) / R.rho);
  if (ps > R.p) {
    const S = R.u + a * Math.sqrt(((g + 1) / (2 * g)) * (ps / R.p) + (g - 1) / (2 * g));
    if (xi >= S) return { ...R };
    return { rho: (R.rho * (ps / R.p + gm)) / (gm * (ps / R.p) + 1), u: us, p: ps };
  }
  const aStar = a * Math.pow(ps / R.p, (g - 1) / (2 * g));
  const head = R.u + a;
  const tail = us + aStar;
  if (xi >= head) return { ...R };
  if (xi <= tail) return { rho: R.rho * Math.pow(ps / R.p, 1 / g), u: us, p: ps };
  const c = (2 / (g + 1)) * (a - 0.5 * (g - 1) * (R.u - xi));
  const u = (2 / (g + 1)) * (-a + 0.5 * (g - 1) * R.u + xi);
  const rho = R.rho * Math.pow(c / a, 2 / (g - 1));
  return { rho, u, p: R.p * Math.pow(c / a, (2 * g) / (g - 1)) };
}
