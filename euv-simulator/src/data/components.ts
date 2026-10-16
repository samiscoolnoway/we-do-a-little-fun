import type { CamPreset, ComponentInfo, EquationDef } from './types';

const cam = (t: [number, number, number], w: number, h: number, az = -10, el = 8): CamPreset => ({ t, fit: [w, h], az, el });
const eq = (title: string, tex: string, vars: EquationDef['vars'], example?: string, note?: string): EquationDef => ({ title, tex, vars, example, note });

const PHOTON = eq(
  'Photon energy',
  'E = hc / λ',
  [
    ['E', 'energy of one photon', 'J  (1 eV = 1.602×10⁻¹⁹ J)'],
    ['h', 'Planck constant, 6.626×10⁻³⁴', 'J·s'],
    ['c', 'speed of light, 2.998×10⁸', 'm/s'],
    ['λ', 'wavelength', 'm'],
  ],
  'λ = 13.5 nm: E = 1239.84 eV·nm ÷ 13.5 nm = 91.8 eV = 1.47×10⁻¹⁷ J',
  'A handy form: E[eV] = 1239.84 / λ[nm].',
);
const BRAGG = eq(
  'Multilayer (Bragg) condition',
  'm λ = 2 d cos θ',
  [
    ['m', 'order of reflection (1 for the main peak)', ''],
    ['λ', 'wavelength', 'nm'],
    ['d', 'period of one Mo/Si layer pair', 'nm'],
    ['θ', 'angle of incidence from the surface normal', 'deg'],
  ],
  'λ = 13.5 nm, θ = 6°, m = 1 → d = 6.8 nm. Real periods are ≈ 6.9 nm because the refractive index is slightly below 1.',
  'Ignores refraction and absorption in the layers; real reflectivity needs a full thin-film (Fresnel) calculation.',
);

export const COMPONENT_LIST: ComponentInfo[] = [
  {
    id: 'dropletGenerator',
    name: 'Tin Droplet Generator',
    zone: 'source',
    stage: 0,
    simple:
      'A tiny, very hot nozzle that shoots out a steady stream of molten tin drops, each thinner than a human hair, tens of thousands of times per second.',
    what: 'A heated reservoir with a micrometre-scale nozzle and a piezo-electric actuator. It fires a steady stream of molten tin droplets, each roughly 25 µm across, at tens of kilohertz (about 50,000 per second is publicly reported).',
    does: 'Delivers a fresh, identical target to the laser focus for every shot. Droplets that the laser does not use are caught by the tin catcher.',
    physics:
      'Tin melts at 232 °C, so the reservoir is kept hotter than that. Pressure pushes liquid tin out as a thin jet and a vibration at the right frequency makes the jet pinch off into equal droplets (the Rayleigh–Plateau instability). Surface tension then pulls each fragment into a sphere. Spacing and speed must stay steady because the laser has to hit every droplet to within micrometres.',
    chemistry: 'Tin (Sn) is a metal with a low melting point. Tin oxide contamination is a known problem for stable droplet formation, so the molten tin is kept in a controlled, oxygen-poor environment.',
    equations: [
      eq(
        'Jet break-up into droplets',
        'λ_{opt} ≈ 4.51 d_{jet}   →   d_{drop} ≈ 1.89 d_{jet}',
        [
          ['λ_opt', 'wavelength of the fastest-growing surface ripple on the jet', 'm'],
          ['d_jet', 'diameter of the liquid jet', 'm'],
          ['d_drop', 'diameter of the droplet that forms', 'm'],
        ],
        'A 14 µm jet breaks into droplets ≈ 26 µm across, spaced ≈ 63 µm apart.',
        'Valid for an ideal, inviscid jet. A piezo actuator drives the real jet near this optimum frequency.',
      ),
    ],
    see: 'Each droplet leaves the nozzle slightly stretched, wobbles toward a sphere as surface tension pulls it round, then travels at constant speed with even spacing toward the laser focus.',
    deep: {
      notes: [
        'Droplet spacing = v / f. At about 70 m/s and 50 kHz that is 1.4 mm, roughly 50 droplet diameters, so each plasma has cleared away before the next droplet arrives.',
        'The position of every droplet at the laser focus has to be stable to a small fraction of the droplet size, because the focused laser spot is of similar size.',
      ],
      limits: [
        'Droplet size, spacing and speed are exaggerated by orders of magnitude for visibility. Real droplets are about 10,000 times smaller than the collector.',
        'The nozzle, heater and actuator are schematic, not a real design.',
      ],
    },
    cam: cam([-7, 8.2, 0], 7, 6),
  },
  {
    id: 'droplets',
    name: 'Molten Tin Droplets',
    zone: 'source',
    stage: 0,
    simple:
      'Each drop of liquid tin is the fuel for one flash of EUV light. Surface tension pulls it into a near-perfect little ball.',
    what: 'A sphere of liquid tin about 25 µm across: the fuel for one EUV flash. Only tens of nanograms of tin are used per shot.',
    does: 'Acts as a mass-limited target that is renewed for every pulse, so the plasma starts from the same conditions each time.',
    physics:
      'Surface tension γ pulls liquid into the shape with the least surface area, a sphere. The pressure inside exceeds the pressure outside by ΔP = 2γ/r (Young–Laplace). For r ≈ 13 µm and γ ≈ 0.55 N/m that is about 85 kPa, close to one atmosphere. A disturbed droplet rings between stretched and squashed shapes before it settles.',
    chemistry: 'Pure elemental tin. In the plasma it loses many electrons; the 13.5 nm light comes from Sn⁸⁺ to Sn¹⁴⁺ ions. Tin that is not ionised leaves as vapour, fragments and tiny droplets: debris that must be kept off the mirrors.',
    equations: [
      eq(
        'Laplace pressure of a droplet',
        'ΔP = 2γ / r',
        [
          ['ΔP', 'pressure inside minus outside', 'Pa'],
          ['γ', 'surface tension of liquid tin, ≈ 0.55 near the melting point', 'N/m'],
          ['r', 'droplet radius', 'm'],
        ],
        'r = 13 µm: ΔP = 2 × 0.55 ÷ 13×10⁻⁶ ≈ 8.5×10⁴ Pa',
      ),
    ],
    see: 'Just after the nozzle the droplet oscillates between stretched and round. That is surface tension at work. Later the same droplet is reshaped by the laser pre-pulse.',
    deep: {
      notes: [
        'Why tin? Sn ions emit strongly inside the narrow band around 13.5 nm that Mo/Si mirrors reflect, the conversion efficiency from laser light is high, and a liquid droplet renews the target on every shot. Debris is the price.',
        'The slowest oscillation of the droplet has frequency f = (1/2π)·√(8γ / ρr³), about 80 kHz for a 27 µm tin droplet.',
      ],
      limits: ['The wobble you see is a stylised damped oscillation, not a fluid simulation.'],
      equations: [
        eq(
          'Rayleigh oscillation frequency (l = 2 mode)',
          'f = (1 / 2π) √( 8γ / (ρ r^{3}) )',
          [
            ['f', 'oscillation frequency', 'Hz'],
            ['γ', 'surface tension', 'N/m'],
            ['ρ', 'density of liquid tin, ≈ 7000', 'kg/m³'],
            ['r', 'droplet radius', 'm'],
          ],
          'r = 13.5 µm, γ = 0.55 N/m, ρ = 7000 kg/m³ → f ≈ 8×10⁴ Hz',
        ),
      ],
    },
    cam: cam([-7, 4.6, 0], 6, 7),
  },
  {
    id: 'catcher',
    name: 'Tin Catcher',
    zone: 'source',
    stage: 0,
    simple:
      'A heated funnel that catches the tin drops the laser did not use, so tin does not pile up inside the machine.',
    what: 'A funnel-shaped receptacle at the bottom of the droplet path, kept hot enough to keep the tin liquid.',
    does: 'Catches the droplets and debris that the laser did not turn into plasma so tin does not build up inside the chamber.',
    physics:
      'Liquid tin that lands on a hot, wetted surface pools and drains under gravity. At 50,000 droplets per second the flow is only a few milligrams per second, but it never stops, so the catcher is designed to avoid splashing tin back toward the optics.',
    chemistry: 'Not a chemical process: simple capture and drainage of liquid tin. Keeping the catcher above the melting point (232 °C) prevents solid tin from clogging it.',
    equations: [
      eq(
        'Tin mass flow',
        'ṁ = f · (4/3) π r^{3} ρ',
        [
          ['ṁ', 'mass of tin used per second', 'kg/s'],
          ['f', 'droplet rate', 'Hz'],
          ['r', 'droplet radius', 'm'],
          ['ρ', 'density of liquid tin ≈ 7000', 'kg/m³'],
        ],
        '5×10⁴ /s × 7.2×10⁻¹¹ kg ≈ 3.6 mg/s ≈ 13 g per hour',
      ),
    ],
    see: 'Droplets that pass the focus fall into the funnel. In the pre-pulse stage the flattened discs land there too, because the main pulse is switched off.',
    deep: {
      notes: ['The mass of tin per droplet (≈ 72 ng) is tiny, but a source running continuously handles about ten grams per hour that must be captured and recycled.'],
      limits: ['Funnel geometry and bin are schematic.'],
    },
    cam: cam([-7, -1.4, 0], 7, 5.5),
  },
  {
    id: 'co2Laser',
    name: 'CO₂ Laser',
    zone: 'source',
    stage: 1,
    simple:
      'A powerful infrared laser. It does not print anything itself: its only job is to heat the tin drops until they give off EUV light.',
    what: 'A high-power pulsed carbon-dioxide laser, called the drive laser. It emits mid-infrared light at 10.6 µm, is amplified in several stages and delivered into the source vessel. It is not the light that exposes the wafer.',
    does: 'Supplies the energy that turns a tin droplet into plasma: a weak pre-pulse reshapes the droplet, then a powerful main pulse heats it.',
    physics:
      'Gain comes from vibrational transitions of CO₂ molecules, pumped by collisions with N₂ in an electric discharge. A 10.6 µm photon carries only 0.117 eV, while an EUV photon carries 92 eV, but each laser pulse contains a huge number of photons. Light is absorbed by free electrons (inverse bremsstrahlung) up to the critical density n_c, which falls as 1/λ²: for 10.6 µm, n_c ≈ 10¹⁹ cm⁻³.',
    chemistry: 'No chemistry is involved in producing the beam. The gain medium is a gas mixture (CO₂, N₂, He) and the light comes from molecular vibrational transitions.',
    equations: [
      eq(
        'Critical electron density',
        'n_{c} = ε_{0} m_{e} ω^{2} / e^{2}  ≈  1.1×10^{21} / λ^{2}',
        [
          ['n_c', 'density above which the plasma reflects the laser light', 'cm⁻³'],
          ['ε₀', 'vacuum permittivity', 'F/m'],
          ['m_e', 'electron mass', 'kg'],
          ['ω', 'angular frequency of the light, 2πc/λ', 'rad/s'],
          ['e', 'elementary charge', 'C'],
          ['λ', 'laser wavelength (in the right-hand form)', 'µm'],
        ],
        'λ = 10.6 µm → n_c ≈ 9.8×10¹⁸ cm⁻³;   λ = 1.06 µm → n_c ≈ 10²¹ cm⁻³',
      ),
    ],
    see: 'Red pulses leave the laser box, pass through the hole in the collector and meet the droplet: a small pre-pulse first, then the main pulse at the focus. Red is a visualization aid; 10.6 µm infrared light is also invisible.',
    deep: {
      notes: [
        'Publicly reported production lasers deliver tens of kilowatts of average power; only a few percent of that ends up as in-band EUV.',
        'A lower critical density means the main pulse is absorbed in lower-density, optically thinner plasma, which lets more of the emitted 13.5 nm light escape. This is a commonly cited reason why CO₂ lasers outperform 1 µm lasers for tin.',
      ],
      limits: ['The multi-stage amplifier chain, beam transport and focusing optics are reduced to one box and a straight beam.'],
    },
    cam: cam([-14.5, 3, 0], 11, 7, 20),
  },
  {
    id: 'laserPulses',
    name: 'Pre-pulse and Main Pulse',
    zone: 'source',
    stage: 1,
    simple:
      'Two laser shots per drop: a gentle first shot flattens the ball into a thin pancake, then a strong second shot turns the pancake into glowing plasma.',
    what: 'A pair of laser pulses for every droplet. The pre-pulse is weaker and arrives first (microseconds earlier in the real machine); the main pulse carries most of the energy.',
    does: 'The pre-pulse reshapes the droplet into a thin, wide disc or mist so that the main pulse can heat it efficiently into EUV-emitting plasma.',
    physics:
      'The pre-pulse heats and ablates the droplet surface; recoil pressure and heating deform the droplet into a flat “pancake” that expands for a few microseconds. A larger, lower-density target absorbs the main pulse over a bigger area at a plasma density that favours EUV emission. Because the droplet keeps moving, the two pulses are focused at slightly different positions along its path.',
    chemistry: 'None: this is physical heating, ablation and expansion of liquid tin.',
    equations: [
      eq(
        'Pulse separation along the droplet path',
        'Δs = v_{d} · Δt',
        [
          ['Δs', 'distance between the pre-pulse and main-pulse focus positions', 'm'],
          ['v_d', 'droplet speed', 'm/s'],
          ['Δt', 'delay between the two pulses', 's'],
        ],
        'Illustrative values: 70 m/s × 2 µs = 140 µm.',
      ),
    ],
    see: 'The small red packet (pre-pulse) hits the sphere slightly upstream. Over the next half second the sphere spreads into a disc. In this stage the main pulse is off, so the disc just drifts on to the catcher; from the next stage the main pulse follows.',
    deep: {
      notes: [
        'Different sources use pre-pulses from picoseconds to nanoseconds long. Target shaping is one of the main reasons the conversion efficiency rose from a few percent to about 5–6%.',
        'Seen edge-on from the front the disc looks like a thin vertical sliver. Orbit the camera to see it face-on.',
      ],
      limits: ['The delay between the pulses is slowed by roughly 10⁵ so that you can see it.'],
    },
    cam: cam([-9.4, 3.3, 0], 9.5, 6, 30),
  },
  {
    id: 'plasma',
    name: 'Tin Plasma',
    zone: 'source',
    stage: 2,
    simple:
      'Tin heated so much that its atoms lose many electrons. These charged atoms give off light at 13.5 nm, more like a neon sign than a fire.',
    what: 'A hot, partly ionised cloud of tin a fraction of a millimetre across that lights up for a fraction of a microsecond. It is the source of the EUV light.',
    does: 'Converts part of the laser pulse energy into 13.5 nm radiation emitted in all directions.',
    physics:
      'The laser heats free electrons; collisions strip electrons from tin atoms until ions such as Sn⁸⁺ to Sn¹⁴⁺ dominate, at electron temperatures of tens of eV (a few 10⁵ K). These ions emit a dense bunch of spectral lines near 13.5 nm when bound electrons change between n = 4 sub-shells. It is atomic line emission from a plasma: neither a blackbody glow nor combustion.',
    chemistry:
      'No chemical bonds are involved. Combustion is a reaction with oxygen; here there is no oxygen, no flame and no new compound. Energy comes from the laser and the light comes from electrons moving between energy levels of tin ions. Afterwards the tin vapour, ions and fragments (debris) must be kept off the collector.',
    equations: [
      eq(
        'Conversion efficiency',
        'CE = E_{EUV} / E_{laser}',
        [
          ['E_EUV', 'in-band energy (13.5 nm, 2% bandwidth) emitted into 2π sr', 'J'],
          ['E_laser', 'energy of the laser pulse', 'J'],
        ],
        'CE ≈ 5–6% is reported: about 94–95% of the laser energy becomes heat, fast ions and other radiation.',
      ),
    ],
    see: 'At the main pulse the disc turns into a white-hot ball with a violet halo that flares and fades. Thin cyan rays leave it in all directions and sparkle on the collector. Orange specks are tin debris.',
    deep: {
      notes: [
        'A blackbody at about 2.2×10⁵ K would peak near 13 nm (Wien’s law, λ_max = b/T), but the real spectrum is a set of tin-ion lines, so that match is a coincidence, not the explanation.',
        'Opacity matters: light made deep inside a dense plasma is re-absorbed. The pre-pulse is tuned to give a plasma size and density from which the 13.5 nm light can escape.',
      ],
      limits: ['Plasma size, brightness and lifetime are stylised, and the flash is slowed by about 10⁵.'],
      equations: [
        eq(
          'Saha ionisation balance',
          'n_{i+1} n_{e} / n_{i} = (2 / Λ^{3}) (g_{i+1} / g_{i}) exp( −χ_{i} / k_{B}T )',
          [
            ['n_i', 'density of ions with charge i', 'm⁻³'],
            ['n_e', 'electron density', 'm⁻³'],
            ['Λ', 'thermal de Broglie wavelength of the electrons', 'm'],
            ['g', 'statistical weights of the ion states', ''],
            ['χ_i', 'ionisation energy of ion i', 'eV'],
            ['k_B T', 'electron thermal energy', 'eV'],
          ],
          undefined,
          'Assumes local thermodynamic equilibrium. Laser-produced tin plasmas are only partly in equilibrium, so real models use collisional-radiative codes.',
        ),
      ],
    },
    cam: cam([-7, 3, 0], 5, 3.8, 28),
  },
  {
    id: 'euvBeam',
    name: '13.5 nm EUV Radiation',
    zone: 'scanner',
    stage: 2,
    span: [2, 7],
    simple:
      'Light with a wavelength of 13.5 nm, about 40 times shorter than visible light. Short waves can draw finer details, but almost everything, even air, swallows this light. You cannot see it; the cyan colour is only for the picture.',
    what: 'Light with a wavelength of 13.5 nm, between ultraviolet and X-rays. Each photon carries about 92 eV. It is invisible to the human eye; the cyan colour used here is only a visualization aid.',
    does: 'Carries the circuit pattern from the mask to the wafer. A shorter wavelength allows finer features (R = k₁λ/NA).',
    physics:
      'E = hc/λ gives 91.8 eV at 13.5 nm. At this photon energy every material absorbs strongly through photoionisation, so there are no good transparent lens materials and even gases absorb the light. That is why the optics are reflective multilayer mirrors in vacuum, and why only about 1% of the light the collector gathers reaches the wafer.',
    chemistry:
      '92 eV is far above typical molecular ionisation energies (about 8–15 eV), so EUV photochemistry in the resist works through ionisation and secondary electrons rather than through direct electronic excitation, as with 193 nm photons (6.4 eV).',
    equations: [PHOTON],
    see: 'Cyan streaks travel along the optical path. The light dims after every mirror because Mo/Si multilayers reflect only about 60–70% each. After the mask, the beam splits into beamlets that carry the pattern.',
    deep: {
      notes: [
        'A dose of 30 mJ/cm² is about 2×10¹⁵ photons per cm², roughly 20 photons per nm². At 193 nm the same dose holds 14 times more photons, so EUV suffers more photon shot noise.',
        'Only light within about 2% of 13.5 nm (the passband of Mo/Si mirrors) is useful, which is why the source is tuned to that band.',
      ],
      limits: ['Beam widths and speeds are schematic. The pulse brightness falls by a milder factor per mirror than the real 0.65–0.70 so the beam stays visible.'],
    },
    cam: cam([-5, 3.3, 0], 11, 6.5),
    widgets: ['photon'],
  },
  {
    id: 'collector',
    name: 'Collector Mirror',
    zone: 'source',
    stage: 3,
    simple:
      'A large curved mirror next to the plasma. It gathers light that flies out in many directions and focuses it into one point.',
    what: 'A large, concave, multilayer-coated mirror shaped like part of an ellipsoid, with a central hole for the laser beam.',
    does: 'Collects the EUV light that the plasma emits over a wide angle and focuses it at the intermediate focus, where it enters the scanner.',
    physics:
      'An ellipsoid has two foci: any ray leaving one focus reflects to the other, and every such path has the same length, |PF₁| + |PF₂| = 2a, so the flash also arrives in step. Reflection comes from a Mo/Si multilayer whose ≈ 7 nm period makes the reflections from its many interfaces add up in phase (Bragg condition), reaching about 60–70% at 13.5 nm.',
    chemistry:
      'Tin vapour and droplets would coat the mirror and ruin its reflectivity. A flow of hydrogen gas slows the debris, and atomic hydrogen can convert deposited tin into volatile stannane that is pumped away: Sn + 4 H → SnH₄ (net result only, simplified).',
    equations: [
      eq(
        'Ellipse property',
        '|PF_{1}| + |PF_{2}| = 2a',
        [
          ['P', 'any point on the mirror surface', ''],
          ['F₁, F₂', 'the two foci: plasma and intermediate focus', ''],
          ['a', 'semi-major axis of the ellipse', 'length'],
        ],
        'Here a = 5 units, so every ray travels 10 units from plasma to focus, whichever point of the dish it hits.',
      ),
      BRAGG,
    ],
    see: 'Cyan rays leave the plasma, strike the dish (sparkles) and all converge on one bright point, the intermediate focus. Because every ray has the same length, the light arrives together.',
    deep: {
      notes: [
        'The collector faces the full heat and debris load of the plasma. Reflectivity lost to contamination sets mirror lifetime and is a major cost driver.',
        'Real collectors are roughly half a metre or more across, with protective capping layers and dedicated gas-flow channels.',
      ],
      limits: ['The dish is a smooth surface of revolution; the holes, mounts and gas channels of real collectors are not modelled.'],
    },
    cam: cam([-9.2, 3, 0], 10, 8, -28),
    widgets: ['multilayer'],
  },
  {
    id: 'vacuum',
    name: 'Vacuum Chamber',
    zone: 'source',
    stage: 3,
    span: [3, 7],
    simple:
      'The light path is pumped almost empty of air, because air would swallow EUV light within a fraction of a millimetre.',
    what: 'The sealed chambers that enclose the whole EUV light path, at very low pressure with a gentle flow of hydrogen in places.',
    does: 'Lets EUV travel metres to the wafer, and keeps contaminants away from the mirrors.',
    physics:
      'Gas molecules absorb 13.5 nm photons through photoionisation. The surviving fraction follows the Beer–Lambert law, I/I₀ = exp(−nσx). In air at atmospheric pressure the absorption length is far below a millimetre; at pascal-level pressures of hydrogen, which absorbs EUV only weakly, the loss over metres is small.',
    chemistry:
      'Hydrogen is used because it absorbs little at 13.5 nm, and hydrogen radicals also clean carbon and tin from mirror surfaces. Oxygen and water are kept very low because they oxidise mirror coatings and absorb EUV.',
    equations: [
      eq(
        'Beer–Lambert absorption',
        'I = I_{0} exp( −n σ x ),   n = P / (k_{B} T)',
        [
          ['I / I₀', 'fraction of EUV that survives', ''],
          ['n', 'number density of gas molecules', 'm⁻³'],
          ['σ', 'photoabsorption cross-section at 13.5 nm', 'm²'],
          ['x', 'distance travelled', 'm'],
          ['P', 'gas pressure', 'Pa'],
          ['k_B T', 'thermal energy, 4.1×10⁻²¹ J at 300 K', 'J'],
        ],
        'Air at 1 atm: n ≈ 2.4×10²⁵ m⁻³; with σ of a few 10⁻²² m² the 1/e length is of order 0.1 mm.',
      ),
    ],
    see: 'Switch the Chamber control to Air: gas molecules fill the chamber and the cyan EUV dies within a short distance of the plasma. The distance is greatly exaggerated; in reality it is a fraction of a millimetre. In vacuum a thin hydrogen flow (faint blue specks) sweeps along the collector.',
    deep: {
      notes: [
        'Real scanners are not perfect vacuum: pressure zones, hydrogen flows and “gas locks” separate the source, scanner and wafer areas.',
        'Resist outgassing under EUV is a contamination risk for nearby optics, so every resist is characterised for it.',
      ],
      limits: ['Pressures and gas flows are not modelled. The Air demonstration is illustrative.'],
    },
    cam: cam([-6.2, 3.1, 0], 16, 10, -14),
    widgets: ['beer'],
  },
  {
    id: 'intermediateFocus',
    name: 'Intermediate Focus',
    zone: 'source',
    stage: 3,
    simple:
      'The bright point where the collector focuses the light. It is the doorway from the light source into the rest of the scanner.',
    what: 'The point where the collector focuses the EUV light, at the boundary between the source module and the scanner. A small aperture there passes the light and helps keep gas and debris on the source side.',
    does: 'Acts as the light source of the scanner: the illuminator images this point, and source power is specified here.',
    physics:
      'Light converges to a small spot and then spreads out again. Étendue (area × solid angle) cannot be reduced by passive optics, so the plasma size and the collector’s convergence angle limit how much light the illuminator can accept.',
    chemistry: 'No chemistry is involved: it is an optical aperture and a barrier for gas and debris.',
    equations: [
      eq(
        'Étendue',
        'G = n^{2} A Ω',
        [
          ['G', 'étendue', 'm²·sr'],
          ['n', 'refractive index (1 in vacuum)', ''],
          ['A', 'cross-sectional area of the beam', 'm²'],
          ['Ω', 'solid angle of the light cone', 'sr'],
        ],
        undefined,
        'Passive imaging optics can keep G constant at best, never reduce it.',
      ),
    ],
    see: 'All ray bundles meet at one bright knot. Beyond it the beam spreads toward the field facet mirror.',
    deep: {
      notes: ['Source power of a few hundred watts at the intermediate focus is publicly reported for production sources; the scanner only ever receives that light.'],
      limits: ['The aperture plate is schematic.'],
    },
    cam: cam([-2, 3, 0], 5.5, 4),
  },
  {
    id: 'illumination',
    name: 'Illumination Optics',
    zone: 'scanner',
    stage: 4,
    simple:
      'A set of mirrors that spreads the light evenly over the mask and makes it arrive from carefully chosen directions.',
    what: 'A set of multilayer mirrors between the intermediate focus and the mask: a field facet mirror, a pupil facet mirror and relay mirror(s). Real illuminators use about four mirrors; this model draws three.',
    does: 'Shapes the beam so that it lights the mask evenly in a narrow arc-shaped slit and arrives from a chosen set of angles.',
    physics:
      'A “fly’s-eye” arrangement: the field facets cut the beam into channels, the pupil facets steer each channel, and the images of all facets overlap on the mask, which averages out non-uniformity (Köhler-style integration). The mirrors work at moderate angles of incidence and reflect about 60–70% each.',
    chemistry: 'The mirror coatings are Mo/Si multilayers with a thin protective capping layer (commonly ruthenium) against oxidation and hydrogen.',
    equations: [
      eq(
        'Uniformity by superposition',
        'I(x) = (1/N) Σ_{i} I_{i}(x)    →    σ_{I} / I ≈ 1 / √N',
        [
          ['N', 'number of overlapped facet images', ''],
          ['I_i(x)', 'intensity of the i-th facet image on the mask', 'W/m²'],
          ['σ_I / I', 'relative non-uniformity', ''],
        ],
        'N = 100 independent channels → non-uniformity ≈ 10%, before any further smoothing.',
        'A statistical estimate; real designs also use the facet shapes to tailor the slit.',
      ),
    ],
    see: 'The beam widens onto the field facet mirror (a grid of small tiles), is steered onto the pupil facet mirror (round tiles; the bright ones are in use) and reaches the mask via a relay mirror, dimming at every reflection.',
    deep: {
      notes: ['After the collector and about four illuminator mirrors at ≈ 65% each, only roughly 10–15% of the light is left before it even reaches the mask.'],
      limits: ['Facet counts and shapes are schematic. Real field facets are arc-shaped and individually positioned.'],
    },
    cam: cam([8.6, 4.8, 0], 18, 9, -8),
  },
  {
    id: 'ffm',
    name: 'Field Facet Mirror',
    zone: 'scanner',
    stage: 4,
    simple:
      'A mirror made of many small tilted tiles. It chops the beam into many little beams so that any unevenness averages out.',
    what: 'A mirror built from many small facets, each tilted individually (tens to hundreds of them in real scanners).',
    does: 'Splits the beam into many channels. The shape of each facet matches the arc-shaped slit that will be imaged on the mask.',
    physics: 'Each field facet forms an image of the intermediate focus on its own pupil facet; together, the facets define the illuminated field. Splitting and recombining the channels is what makes the illumination uniform.',
    chemistry: 'Mo/Si multilayer coating with a capping layer; no other chemistry.',
    equations: [eq('Statistical uniformity', 'σ_{I} / I ≈ 1 / √N', [['σ_I / I', 'relative non-uniformity of the overlapped image', ''], ['N', 'number of facets', '']], 'N = 400 → about 5%')],
    see: 'A grid of small tiles, each tilted a little differently. The beam spreads across the grid and each tile sends its share toward the pupil facet mirror.',
    deep: { notes: ['In some designs the facets can be re-tilted to switch between illumination settings.'], limits: ['Tile count and tilts are schematic.'] },
    cam: cam([3.17, 4.9, 0], 5.5, 4, -22),
  },
  {
    id: 'pfm',
    name: 'Pupil Facet Mirror',
    zone: 'scanner',
    stage: 4,
    simple:
      'A second tiled mirror that decides from which directions the light reaches the mask. Light arriving at the right angles helps print finer lines.',
    what: 'A second faceted mirror placed at a pupil plane of the illuminator.',
    does: 'Chooses from which angles the light reaches the mask, that is the illumination shape (conventional, annular, dipole…). Each field facet is paired with one pupil facet.',
    physics:
      'Position on the pupil mirror corresponds to angle at the mask. The shape and size of the lit region, described by σ = NA_illum / NA_obj, decide how many diffraction orders the projection optics can capture, and therefore contrast and resolution. Off-axis (dipole) illumination can double the resolution for dense lines.',
    chemistry: 'Mo/Si multilayer coating with a capping layer; no other chemistry.',
    equations: [
      eq(
        'Partial coherence factor',
        'σ = NA_{illum} / NA_{obj}',
        [
          ['σ', 'partial coherence (fill) factor of the illumination', ''],
          ['NA_illum', 'numerical aperture of the illumination cone, mask side', ''],
          ['NA_obj', 'numerical aperture of the projection optics, mask side', ''],
        ],
        'σ = 0.9 would mean the illumination cone nearly fills the acceptance cone of the projection optics; a dipole instead uses two small, off-axis poles.',
      ),
    ],
    see: 'Round tiles in a hexagonal pattern. The bright ones form two poles (a dipole): only light from those facets reaches the mask.',
    deep: {
      notes: ['For a grating of pitch p, a dipole matched to p lets the 0 and −1 orders both fit inside the NA when p ≥ λ / (2 NA), instead of p ≥ λ / NA for on-axis light. Try it in the diffraction lab of the Projection Optics inspector.'],
      limits: ['Which facets are lit is fixed here; real systems choose them by source–mask optimisation.'],
    },
    cam: cam([9.08, 3.8, 0], 5.5, 4, -22),
    widgets: ['resolution'],
  },
  {
    id: 'reticle',
    name: 'Reflective Mask',
    zone: 'scanner',
    stage: 5,
    simple:
      'The stencil that holds the chip pattern. Unlike a slide, it is a mirror: bare mirror areas reflect the light and dark absorber areas swallow it.',
    what: 'A 152 mm square glass plate with an ultra-flat reflective multilayer on one face and a patterned absorber on top of it. The mask is a mirror, not a transparent slide.',
    does: 'Imprints the circuit pattern on the light. Multilayer regions reflect the EUV, absorber regions (tens of nanometres of tantalum-based material) absorb it. The reflected beam is the pattern, drawn 4× larger than it will be on the wafer.',
    physics:
      'About 40 Mo/Si pairs with a period near 6.9 nm reflect in phase at 13.5 nm (Bragg condition), reaching ≈ 65% reflectivity. The mask is lit about 6° off the normal so the incoming and outgoing beams can be separated; the absorber is not infinitely thin, so it casts a slight shadow at that angle (mask 3D effects). The glass has almost no thermal expansion because the mask absorbs some of the light and must stay flat to nanometres.',
    chemistry:
      'Materials: Mo and Si layers on low-thermal-expansion glass, a thin capping layer and a tantalum-based absorber. Surfaces must be defect-free, since a single buried defect in the multilayer can print. Masks are handled in sealed pods because particles and carbon contamination ruin imaging.',
    equations: [BRAGG],
    see: 'Look from below (the Mask stage camera does): the reflective face is on the underside. A slit of EUV scans over the pattern; beamlets that meet the dark absorber stop there and the rest reflect downward, so the beam leaves carrying the pattern. The card to the side shows the pattern magnified.',
    deep: {
      notes: [
        'Pellicles (thin membranes that keep particles off the mask) exist for EUV but must pass most of the EUV twice, once in and once out.',
        'Defects buried in the multilayer can shift the phase of the reflected light; inspecting mask blanks at 13.5 nm is a major topic of its own.',
      ],
      limits: ['The pattern is a made-up demonstration layout. Real masks are 152 mm wide with a 104 × 132 mm pattern area.'],
    },
    cam: cam([16, 12.6, 0], 8, 6.5, -6, -24),
    widgets: ['mask', 'transfer'],
  },
  {
    id: 'projection',
    name: 'Projection Optics',
    zone: 'scanner',
    stage: 6,
    simple:
      'A set of very precise curved mirrors that shrinks the mask pattern four times and focuses it sharply onto the wafer.',
    what: 'Six ultra-smooth, aspherical multilayer mirrors in a rigid, temperature-stable frame (for a 0.33 NA scanner). The layout here is a simplified teaching model, not the real design.',
    does: 'Collects the pattern-carrying light from the mask and forms a 4× reduced image on the wafer.',
    physics:
      'A grating-like mask diffracts light into orders (0, ±1, …). The optics collects only the orders that fit inside its numerical aperture, NA = n sinθ, and the interference of those orders forms the image. Resolution is R = k₁λ/NA; with NA = 0.33 and k₁ ≈ 0.4 that is about 16 nm. The 4× reduction makes mask features four times larger than their image, which eases mask making. Surface errors must be a small fraction of a nanometre.',
    chemistry: 'The mirrors are Mo/Si multilayers with capping layers. The surrounding hydrogen atmosphere is controlled so that contamination does not lower the reflectivity.',
    equations: [
      eq(
        'Rayleigh resolution',
        'R = k_{1} λ / NA',
        [
          ['R', 'smallest half-pitch that prints', 'nm'],
          ['k₁', 'process factor; ≥ 0.25 for single exposure', ''],
          ['λ', 'wavelength', 'nm'],
          ['NA', 'numerical aperture of the projection optics', ''],
        ],
        'λ = 13.5 nm, NA = 0.33 → λ/NA = 40.9 nm; k₁ = 0.40 gives R ≈ 16 nm, k₁ = 0.25 gives R ≈ 10 nm.',
        'The Rayleigh form is an engineering estimate. k₁ bundles illumination, mask, resist and process effects.',
      ),
      eq(
        'Depth of focus',
        'DOF = k_{2} λ / NA^{2}',
        [
          ['DOF', 'range of focus over which the image stays acceptable', 'nm'],
          ['k₂', 'process factor of order 1', ''],
        ],
        'k₂ = 1: DOF ≈ 124 nm at NA = 0.33; ≈ 45 nm at NA = 0.55',
      ),
    ],
    see: 'The patterned bundle zigzags across six mirrors and narrows by four from mask to wafer. The cone above the wafer is the numerical aperture.',
    deep: {
      notes: [
        'High-NA EUV (NA = 0.55) uses anamorphic optics: 4× demagnification in one direction and 8× in the other, with a half-size exposure field, to avoid impractically large masks.',
        'Depth of focus shrinks as 1/NA², so the wafer has to be levelled to a few nanometres.',
      ],
      limits: ['Mirror shapes, positions and sizes are schematic.'],
    },
    cam: cam([21.4, 6.2, 0], 17, 20, 12),
    widgets: ['resolution'],
  },
  {
    id: 'wafer',
    name: 'Silicon Wafer',
    zone: 'scanner',
    stage: 7,
    span: [7, 10],
    simple:
      'A thin round slice of pure silicon coated with a light-sensitive film. Many chips are printed on it, one small field at a time.',
    what: 'A 300 mm diameter, 775 µm thick disc of single-crystal silicon coated with underlayers and a thin photoresist film (tens of nanometres), clamped on a wafer stage.',
    does: 'Receives the image. The wafer stage scans the wafer in step with the mask stage and steps between fields until the whole wafer has been exposed.',
    physics:
      'The beam lights a narrow slit; the mask and wafer stages scan together at a 4:1 speed ratio so that the full 26 × 33 mm field is exposed. Positioning is accurate to nanometres, and the wafer is held flat on an electrostatic chuck, because suction chucks do not work in vacuum. The dose D (mJ/cm²) sets how many photons arrive per area.',
    chemistry: 'Silicon with a thin native oxide, plus the spin-coated resist and underlayers. The resist was applied before exposure in the track, where the post-exposure processing also happens.',
    equations: [
      eq(
        'Photons per area from a dose',
        'N / A = D / E_{photon}',
        [
          ['N / A', 'photons per unit area', 'cm⁻²'],
          ['D', 'dose delivered to the wafer', 'J/cm²'],
          ['E_photon', 'energy per photon, 1.47×10⁻¹⁷ J at 13.5 nm', 'J'],
        ],
        '30 mJ/cm² ÷ 1.47×10⁻¹⁷ J ≈ 2×10¹⁵ photons/cm² ≈ 20 photons per nm².',
      ),
    ],
    see: 'A bright slit sweeps across the exposure field while the mask and wafer move; the pattern appears on the wafer 4× smaller. The glowing cone above is the numerical aperture. The small field and its neighbours are the die grid.',
    deep: {
      notes: ['Overlay (placing layer upon layer to a few nanometres) relies on alignment marks and constant measurement of stage position.', 'After the exposure the wafer is unloaded and a fresh one takes its place; this is why the next wafer appears on the chuck.'],
      limits: ['Field size is shown near its true proportion to the wafer, but the stage and chuck hardware are schematic.'],
    },
    cam: cam([27, -2.6, 0], 9, 7, -12, 20),
  },
  {
    id: 'resist',
    name: 'Photoresist',
    zone: 'scanner',
    stage: 7,
    span: [7, 10],
    simple:
      'A very thin light-sensitive coating. Where EUV light hits it, its chemistry changes, so that later only the exposed (or only the unexposed) parts wash away.',
    what: 'A thin polymer-based (or hybrid or metal-oxide) film that changes its chemistry where it absorbs EUV, creating a hidden “latent image” that is developed later. The chemistry depends on the formulation.',
    does: 'Records the image: after exposure and processing, chosen regions can be washed away and the remaining relief pattern can protect the layer below during etching.',
    physics:
      'A 92 eV photon is absorbed by photoionisation; in a thin film only about 10–30% of the photons are absorbed. The ejected photoelectron and the secondary electrons it creates (a few to tens of eV) travel a few nanometres and ionise more molecules. This electron blur, together with photon shot noise (the random arrival of photons), limits sharpness and causes line-edge roughness.',
    chemistry:
      'In a chemically amplified resist (CAR), these ionisation events lead to a strong acid being released from photoacid generator (PAG) molecules. The mechanism is formulation dependent (electron capture by the PAG and polymer radical-cation pathways), so no single balanced equation describes it. During the post-exposure bake the acid catalyses removal of protecting groups. One example, a tert-butyl ester: R–COO–C(CH₃)₃ + H⁺ → R–COOH + CH₂=C(CH₃)₂ + H⁺. The acid is regenerated, so one acid can trigger many events. Metal-oxide resists work differently and are not shown.',
    equations: [
      eq(
        'Absorption in the resist film',
        'A = 1 − exp( −α t )',
        [
          ['A', 'fraction of photons absorbed in the film', ''],
          ['α', 'linear absorption coefficient, ≈ 4–5 for organic resists', 'µm⁻¹'],
          ['t', 'film thickness', 'µm'],
        ],
        'α = 4.5 µm⁻¹, t = 30 nm → A = 1 − e^(−0.135) ≈ 13%. Most photons pass through.',
      ),
    ],
    see: 'In the magnified cross-section, cyan photons fall on the resist. Only a few are absorbed (white flash); each absorption releases yellow secondary electrons, which create violet acid dots, mostly in the bright parts of the aerial image (the cyan bars above the resist) and hardly any under the dark absorber lines.',
    deep: {
      notes: [
        'Stochastics: if a feature receives N absorbed photons on average, the random variation is about 1/√N. For 5 nm features at EUV doses N becomes small, which causes rough edges and random defects.',
        'The resolution–roughness–sensitivity (RLS) trade-off: making a resist more sensitive (fewer photons needed) generally increases roughness.',
      ],
      limits: [
        'The model here is a one-dimensional teaching model: aerial image → acid → blurred acid → threshold. It is not calibrated to any real resist.',
        'Thickness is exaggerated relative to the pattern width.',
      ],
    },
    cam: cam([27, -8.6, 0], 9.5, 8, -12, 8),
    widgets: ['transfer', 'resist'],
  },
  {
    id: 'bakePlate',
    name: 'Post-Exposure Bake',
    zone: 'track',
    stage: 8,
    simple:
      'After leaving the scanner the wafer is warmed on a hot plate in a separate machine. In common chemically amplified resists, the heat lets each acid molecule made by the light trigger many more reactions, making the hidden pattern much stronger.',
    what: 'A temperature-controlled hot plate in the track (the coater/developer), outside the EUV scanner. The wafer is baked at roughly 90–130 °C for about a minute, depending on the resist.',
    does: 'Drives the acid-catalysed reactions that turn the faint chemical image into a strong solubility contrast (chemical amplification) and smooths standing-wave ripples.',
    physics:
      'The bake thermally activates two things: diffusion of the acid over a few nanometres and the reactions it catalyses. Both follow Arrhenius laws. Diffusion also blurs the image, so there is a trade-off: too little gives roughness, too much gives blur. Base additives (quenchers) limit how far acid spreads.',
    chemistry:
      'Positive tone: acid removes protecting groups, for example R–COO–C(CH₃)₃ + H⁺ → R–COOH + CH₂=C(CH₃)₂ + H⁺ (a tert-butyl ester as one example; real formulations vary). This turns a non-polar polymer into a polar one that dissolves in aqueous base. Negative tone: the acid triggers cross-linking or polarity changes that make the exposed polymer insoluble; the detailed chemistry depends on the formulation and is not a single reaction.',
    equations: [
      eq(
        'Arrhenius rate',
        'k = A exp( −E_{a} / k_{B}T )',
        [
          ['k', 'rate constant of the reaction or diffusion', 's⁻¹'],
          ['A', 'pre-exponential factor', 's⁻¹'],
          ['E_a', 'activation energy', 'eV'],
          ['k_B T', 'thermal energy', 'eV'],
        ],
        'For E_a = 1 eV, raising the bake from 100 °C to 110 °C speeds the reaction by about 2.2×.',
      ),
      eq('Diffusion length', 'L_{D} = √(2 D t)', [['L_D', 'typical distance acid moves in one dimension', 'nm'], ['D', 'diffusion coefficient', 'nm²/s'], ['t', 'bake time', 's']], 'D = 0.5 nm²/s, t = 60 s → L_D ≈ 7.7 nm'),
    ],
    see: 'The wafer rides out of the scanner to the hot plate; the plate glows and the lid closes. Violet acid dots hop around and leave marks behind: pale green in positive tone (polymer made soluble), red-orange in negative tone (cross-links). The exposed regions change colour: pale for positive, dark for negative.',
    deep: {
      notes: [
        'The bake temperature sensitivity of the line width is often quoted in nm per °C, so plates are controlled to a fraction of a degree.',
        'Catalytic chain length depends on the resist; quencher loading and acid diffusion limit it.',
      ],
      limits: ['Diffusion and reaction are drawn as a random walk of a few steps, not a reaction–diffusion simulation.'],
    },
    cam: cam([24, -14.6, 0], 11, 9),
    widgets: ['transfer', 'resist'],
  },
  {
    id: 'developer',
    name: 'Development',
    zone: 'track',
    stage: 9,
    simple:
      'A liquid washes away the parts of the coating that became soluble, leaving a raised copy of the pattern on the wafer.',
    what: 'A track module that applies liquid developer to the spinning wafer, rinses it and spins it dry.',
    does: 'Dissolves the more soluble regions of the resist. Positive tone: the exposed regions dissolve. Negative tone: the unexposed regions dissolve. What remains is a relief image of the pattern.',
    physics:
      'Dissolution speed depends on the local solubility, which changes very non-linearly with the extent of the reaction. This threshold-like behaviour turns a gradual latent image into steep sidewalls. During rinsing and drying, capillary forces between narrow lines can bend or collapse tall, thin resist lines (pattern collapse).',
    chemistry:
      'Positive-tone chemically amplified resists are typically developed in aqueous tetramethylammonium hydroxide (TMAH, 2.38 wt%). The deprotected acid groups are neutralised: R–COOH + OH⁻ → R–COO⁻ + H₂O, so the polymer becomes soluble. Negative-tone development often uses an organic solvent that dissolves the unexposed, less polar polymer while the polar exposed polymer stays; other negative resists, including metal-oxide ones, work through different chemistry.',
    equations: [
      eq(
        'Dissolution-rate model (Mack)',
        'R(m) = R_{max} (a+1)(1−m)^{n} / ( a + (1−m)^{n} ) + R_{min}',
        [
          ['R', 'dissolution rate', 'nm/s'],
          ['m', 'fraction of protecting groups still present, 0 to 1', ''],
          ['n', 'dissolution selectivity parameter', ''],
          ['a', '(n+1)/(n−1) · (1 − m_TH)^n, sets the threshold m_TH', ''],
          ['R_max, R_min', 'rate of fully deprotected and fully protected resist', 'nm/s'],
        ],
        undefined,
        'An empirical model used in lithography simulators, fitted per resist and developer; it is not derived from first principles.',
      ),
    ],
    see: 'Developer flows onto the spinning wafer. In the magnified cross-section the soluble regions are stripped from the top down. Use the Resist control: positive tone removes the pale (exposed) regions, negative tone removes the unexposed ones, so the same exposure leaves opposite patterns. Compare shows both.',
    deep: {
      notes: ['Metrology after development (critical-dimension SEM) checks line width and roughness before the wafer goes on to etch.', 'The dissolution threshold sits at 50% in this model; changing the dose slider moves the edges and changes the line width (dose-to-size).'],
      limits: ['Real developers also swell the resist and leave residues; neither is modelled.'],
    },
    cam: cam([10, -14.6, 0], 11, 9),
    widgets: ['transfer', 'resist'],
  },
  {
    id: 'etcher',
    name: 'Etch Chamber and Pattern Transfer',
    zone: 'etch',
    stage: 10,
    simple:
      'In another machine, a plasma eats into the layer below wherever the coating has been washed away, so the pattern ends up in the chip material itself.',
    what: 'A vacuum plasma-etch tool, a separate machine from the scanner, where reactive ions and radicals remove the underlying film wherever the resist does not protect it.',
    does: 'Transfers the resist’s relief pattern into the material beneath it (the film that becomes wires, gates or trenches). Afterwards the leftover resist is stripped.',
    physics:
      'A radio-frequency plasma creates ions that are accelerated by the sheath voltage to hit the wafer vertically. Ion bombardment makes the etch directional (anisotropic) and helps chemical reactions at the bottom of narrow trenches. The selectivity S = R_film / R_resist sets how thin the resist can be. Leftover resist is removed afterwards (ashing), usually in an oxygen plasma.',
    chemistry:
      'Etching relies on reactive species such as fluorine-containing radicals attacking silicon-containing films; volatile products (for example SiF₄) are pumped away. The detailed mechanism involves ion-enhanced surface kinetics and thin polymer passivation layers, so no single reaction describes it. It is shown schematically only.',
    equations: [
      eq(
        'Etch selectivity and anisotropy',
        'S = R_{film} / R_{resist},     A = 1 − R_{lateral} / R_{vertical}',
        [
          ['S', 'selectivity', ''],
          ['R_film, R_resist', 'etch rate of the film and of the resist', 'nm/min'],
          ['A', 'anisotropy (1 = perfectly vertical walls)', ''],
          ['R_lateral, R_vertical', 'sideways and downward etch rates', 'nm/min'],
        ],
        'S = 4 and 20 nm of film to remove → the resist loses about 5 nm while the film is cleared.',
      ),
      eq('Ion energy at the wafer', 'E_{ion} ≈ e V_{sheath}', [['E_ion', 'kinetic energy of an ion hitting the wafer', 'eV'], ['V_sheath', 'voltage across the plasma sheath', 'V']], 'V_sheath = 100 V → singly charged ions arrive with ≈ 100 eV'),
    ],
    see: 'Green ions rain straight down. Where the resist is gone, the film is etched away and grey volatile products leave; where resist remains, the film is protected. At the end the resist is stripped, leaving the pattern in the film. With positive vs negative tone the pattern is inverted.',
    deep: {
      notes: ['Real EUV patterning stacks usually include hard masks and several etch steps because the resist is very thin.', 'Etching can also smooth or worsen line-edge roughness left by the resist.'],
      limits: ['One generic film and one etch step are shown. The plasma colour changes to orange for the strip step only as a visual cue.'],
    },
    cam: cam([-3, -14.6, 0], 11, 9),
    widgets: ['transfer'],
  },
  {
    id: 'zoneScanner',
    name: 'EUV Scanner System',
    zone: 'scanner',
    stage: 0,
    simple:
      'Everything inside the cyan frame belongs to the EUV scanner: it makes the light and uses it to print a hidden chemical pattern into the coating.',
    what: 'The exposure machine: the EUV source module, the illuminator, the reticle stage, the projection optics and the wafer stage. In this model it is the cyan-outlined region.',
    does: 'Produces EUV light and uses it to print the mask pattern onto a resist-coated wafer. Wafers go in with resist and come out exposed, but with only a hidden chemical image.',
    physics: 'The light path runs in vacuum (with low-pressure hydrogen) because EUV is absorbed by gas, and uses only mirrors because every material absorbs EUV.',
    chemistry: 'Only the very first chemistry happens here: ionisation and acid generation in the resist during exposure. Baking, developing and etching are done elsewhere.',
    equations: [],
    see: 'The cyan frame brightens while you are in an in-scanner stage. From the bake onward the scanner is idle (dimmed) and the amber downstream frame takes over.',
    deep: { notes: ['In a fab the track and the scanner are connected, so wafers move automatically between them.'], limits: ['Distances and layout are schematic.'] },
    cam: { t: [6.5, 6, 0], az: -8, el: 9, fit: [54, 26] },
  },
  {
    id: 'zoneDownstream',
    name: 'Downstream Processing',
    zone: 'track',
    stage: 8,
    simple:
      'Everything inside the amber frame happens in other machines after printing: baking, developing and etching turn the hidden pattern into a real one.',
    what: 'The machines that finish the job after exposure: the track (post-exposure bake and development) and the plasma-etch tool. They are separate machines, drawn here inside the amber frame.',
    does: 'Turn the hidden image in the resist into a physical pattern: bake to amplify, develop to dissolve, etch to transfer the pattern into the film, then strip the resist.',
    physics: 'Thermal chemistry (bake), liquid-phase dissolution (develop) and plasma physics (etch) are all very different from the vacuum optics inside the scanner.',
    chemistry: 'Acid-catalysed deprotection or cross-linking, base or solvent dissolution of resist, and plasma etching of the underlying film.',
    equations: [],
    see: 'The wafer is carried out of the scanner along the amber rail and visits the bake plate, the developer and the etch chamber in turn.',
    deep: { notes: ['In a real fab these steps are repeated many times: a modern chip needs dozens of lithography layers.'], limits: ['One wafer and one pattern are shown, without coating or cleaning steps.'] },
    cam: { t: [10, -15, 0], az: -8, el: 8, fit: [46, 13] },
  },
];

export const COMPONENTS: Record<string, ComponentInfo> = Object.fromEntries(COMPONENT_LIST.map((c) => [c.id, c]));
