/**
 * Teaching text at three levels. Intuitive: no equations. Engineering: the governing relations and orders of
 * magnitude. Numerical: how the simulator computes it and where the numbers can be wrong.
 */
export type Level = 'intuitive' | 'engineering' | 'numerical';
export const LEVELS: { id: Level; label: string }[] = [
  { id: 'intuitive', label: 'Intuitive' },
  { id: 'engineering', label: 'Engineering' },
  { id: 'numerical', label: 'Numerical' },
];

export interface Topic {
  id: string;
  title: string;
  text: Record<Level, string[]>;
}

export const TOPICS: Topic[] = [
  {
    id: 'scene',
    title: 'What you are looking at',
    text: {
      intuitive: [
        'Air flows from left to right past a blunt body, the cross-section of an idealised heat shield. Colours show a quantity computed by the simulator at every point: speed, pressure, temperature and so on.',
        'The picture is two-dimensional: imagine a very long cylinder seen end-on, not a capsule. The air in the flow solver has no friction (it is "inviscid"), which is why heating is estimated in a separate step.',
      ],
      engineering: [
        'The flow model is the 2D compressible Euler equations for a calorically perfect gas (air, γ = 1.4, R = 287.05 J/(kg·K)). Viscosity and heat conduction in the gas are neglected; the wall is a slip wall.',
        'A planar body has a different flow from an axisymmetric one of the same profile: shocks stand further off and the stagnation heating is lower by roughly 1/√2. Numbers here are for the planar case.',
      ],
      numerical: [
        'The domain is an O-grid wrapped around the body: cells are small at the wall and stretch towards a circular far-field boundary 8–25 body half-heights away. Every coloured cell is one finite-volume cell whose value is the cell average of the solution.',
        'The "smooth" display interpolates node averages for the eye; switch it off to see the actual cell values. The probe always reports cell values.',
      ],
    },
  },
  {
    id: 'shock',
    title: 'The bow shock and the stagnation point',
    text: {
      intuitive: [
        'When the air arrives faster than sound it cannot "hear" the body coming, so it piles up in a thin sheet, the bow shock, standing in front of the body. Crossing it, the air slows down abruptly and becomes denser, hotter and higher in pressure.',
        'Right at the front of the body the air comes to rest: the stagnation point. That is where the pressure, and usually the heating, are highest.',
        'Below the speed of sound there is no shock: pressure waves travel ahead and the air starts to move aside long before it reaches the body.',
      ],
      engineering: [
        'Across a normal shock at M = 3 (γ = 1.4) the pressure rises 10.3×, the density 3.86× and the temperature 2.68×; the flow becomes subsonic (M = 0.475). The stagnation pressure behind it is given by the Rayleigh pitot formula; for M = 3 it is 12.06 p∞.',
        'The shock standoff distance shrinks as the Mach number grows. Billig\'s empirical correlation for cylinders, Δ/R = 0.386 exp(4.67/M²), gives 0.65 R at M = 3 and 0.44 R at M = 6.',
      ],
      numerical: [
        'The shock is "captured", not tracked: it appears as a steep gradient over 2–3 cells, whose intermediate states are not physical. The Rusanov flux used here is robust at strong shocks but diffusive, so shocks and especially contact surfaces are smeared.',
        'Check: the computed stagnation pressure agrees with the pitot formula to within about 1 % at M = 3 and 6, and the standoff is within about 10 % of the Billig correlation (a correlation, not exact theory).',
      ],
    },
  },
  {
    id: 'hot',
    title: 'Why the gas gets hot',
    text: {
      intuitive: [
        'Moving air carries energy of motion. When it is brought to rest at the front of the body, that energy turns into heat. The faster the flow, the hotter it gets: at Mach 6 air at −50 °C reaches about 1 800 K at the stagnation point.',
        'This is not friction: even the frictionless air in the flow solver heats up when it is compressed and slowed down.',
      ],
      engineering: [
        'For steady adiabatic flow the total enthalpy h + V²/2 is constant along a streamline, so the stagnation temperature is T₀ = T∞ (1 + (γ−1)/2 M∞²). At M = 3 and T∞ = 220 K, T₀ = 616 K; at M = 6, 1 804 K.',
        'Above about 2 000 K real air starts to dissociate and absorbs energy, so a calorically perfect gas overestimates the temperatures. The simulator warns when that happens.',
      ],
      numerical: [
        'Total enthalpy should be exactly constant in the converged inviscid solution, so its deviation measures numerical error. The workbench reports it: about 1 % on the windward side here, a few per cent inside the captured shock, and much more in the wake.',
      ],
    },
  },
  {
    id: 'heating',
    title: 'How the heat reaches the shield',
    text: {
      intuitive: [
        'The hot gas does not touch the wall directly at its full temperature. In a thin layer next to the wall (the boundary layer) the gas slows to rest and cools against the surface, and heat flows through that layer into the shield.',
        'The thinner the layer, the faster the heat flows. It is thinnest at the stagnation point of a small, sharp nose, which is why heat shields are big and blunt.',
      ],
      engineering: [
        'Laminar stagnation-line heating on a 2D cylinder: q₀ = 0.57 Pr^−0.6 √(ρₑμₑ duₑ/ds) (h_aw − h_w). The velocity gradient duₑ/ds ≈ (1/Rₙ)√(2(pₑ−p∞)/ρₑ) scales with 1/Rₙ, so q₀ ∝ 1/√Rₙ: doubling the nose radius cuts the heating by about 30 %.',
        'Heating falls along the surface (Lees\' local-similarity distribution) to roughly 80 % at 30° and 45 % at 60°. A hot wall receives less: q = H (T_aw − T_wall).',
      ],
      numerical: [
        'The Euler solver cannot compute heat flux. The correlation is evaluated with the solver\'s wall values as boundary-layer edge conditions, and the velocity gradient is fitted to the computed wall velocities (it agrees with the Newtonian estimate to a few per cent). The correlation itself is uncertain at the 10–20 % level and assumes a laminar, continuum boundary layer.',
      ],
    },
  },
  {
    id: 'conduction',
    title: 'Inside the heat shield',
    text: {
      intuitive: [
        'Heat entering the surface spreads slowly into the shield. A good insulator keeps the heat near the surface: the outside gets hot, which lets it radiate heat away like a glowing stove, while the inside stays cool.',
        'So there are four different temperatures: the gas, the surface, the inside of the shield, and the structure behind it. Only the gas temperature comes directly from the flow solver.',
      ],
      engineering: [
        'ρ c_p ∂T/∂t = k ∂²T/∂x². Heat penetrates about √(αt) in a time t, with diffusivity α = k/(ρ c_p). For α ≈ 1.2e-6 m²/s that is 8 mm in a minute; crossing 30 mm takes L²/α ≈ 13 minutes.',
        'At the surface the incoming flux H (T_aw − T_s) is balanced by conduction inwards and by re-radiation ε σ T_s⁴. With an insulated back face the surface tends to the radiative-equilibrium temperature.',
      ],
      numerical: [
        'One-dimensional implicit finite-volume model through the thickness, verified against the analytical semi-infinite-solid solution (to 2e-4 of the temperature rise) and an exact steady state. Energy is conserved to round-off. The quasi-2D map is a set of independent columns: no sideways conduction.',
      ],
    },
  },
  {
    id: 'solver',
    title: 'How the flow solver works',
    text: {
      intuitive: [
        'The space around the body is divided into thousands of small cells. Each cell keeps track of how much mass, momentum and energy it contains. Every step, the simulator works out how much flows across each cell face and updates the cells; whatever leaves one cell enters its neighbour.',
      ],
      engineering: [
        'Finite-volume form of the Euler equations: d/dt ∫U dA = −∮F·n ds, with U = (ρ, ρu, ρv, E). The flux through each face is computed from the states on its two sides with the Rusanov (local Lax–Friedrichs) formula; second-order accuracy comes from MUSCL reconstruction with a slope limiter that prevents oscillations at shocks.',
      ],
      numerical: [
        'Boundary conditions use ghost cells: a slip wall mirrors the normal velocity; the far field uses Riemann invariants (characteristics), so waves leave without reflecting much. Every update is checked for positive density and pressure; if a step would create a non-physical state, the step is undone and the location is reported. Nothing is clipped.',
        'Verification: a uniform flow stays uniform to round-off on the curved mesh; the 1D shock tube converges to the exact Riemann solution; mass and energy in a closed box are conserved to 1e-12.',
      ],
    },
  },
  {
    id: 'convergence',
    title: 'Time steps, CFL and convergence',
    text: {
      intuitive: [
        'An explicit simulation can only take small time steps: information may not jump over more than about one cell per step (the CFL condition). Finding a steady flow therefore takes hundreds to thousands of steps.',
        'The simulator stops when the flow has stopped changing, which it measures with the "residual": how fast the solution is still changing.',
      ],
      engineering: [
        'CFL condition: Δt ≤ CFL · A / (½ Σ (|uₙ| + a) ℓ) for every cell. Time-accurate mode uses the smallest Δt for all cells, so each snapshot is a physical moment. Steady mode lets each cell use its own Δt (local time stepping), which reaches the steady state much faster but makes intermediate states unphysical.',
      ],
      numerical: [
        'Supersonic steady runs use an implicit LU-SGS scheme with CFL up to ~10, which converges in roughly 500–1 200 steps on all three meshes. Convergence is a drop of the residual (RMS of ∂ρ/∂t) by a set number of orders of magnitude; for supersonic flow it may be judged on the windward region only, which the wake cannot influence.',
        'A residual that stops falling ("levelled off") or a solver stopped at the step limit means the result is not converged to the requested level; the workbench says so instead of calling it converged.',
      ],
    },
  },
  {
    id: 'limits',
    title: 'Limits of this model',
    text: {
      intuitive: [
        'This is a teaching simulator. It shows the right physics and computes real numbers, but it leaves out friction in the flow, turbulence, chemistry of very hot air and the burning-away (ablation) of real heat shields. Treat its numbers as estimates, not design values.',
      ],
      engineering: [
        'Not modelled: viscous flow separation (the inviscid wake is unrealistic), turbulent heating, real-gas effects above ~2 000 K, rarefied flow, radiation from the shock layer, ablation and pyrolysis, temperature-dependent material properties, 3D and axisymmetric geometry.',
      ],
      numerical: [
        'Main error sources: shock smearing, the low-Mach accuracy of the Rusanov flux (subsonic stagnation pressure about 1 % high on the coarse mesh), first-cell wall values used as boundary-layer edge conditions, and the 10–20 % uncertainty of the heating correlation. The Experiments tab lets you estimate the grid error by comparing meshes.',
      ],
    },
  },
];
