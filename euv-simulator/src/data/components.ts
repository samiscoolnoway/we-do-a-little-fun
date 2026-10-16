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
    parent: 'sys-source',
    engineering:
      "Built around a heated tin reservoir pressurised with inert gas, a filter that keeps solid particles away from the nozzle, a capillary nozzle only micrometres wide and a piezo-electric actuator that sets the break-up frequency. It sits above the laser focus so droplets fall through the first focus of the collector and on into the catcher. Droplet positions are monitored optically so the laser timing can follow small drifts. The real design is not public, so the model shows a schematic body with heater coils.",
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
    parent: 'sys-source',
    kind: 'process',
    context: ['dropletGenerator', 'catcher'],
    engineering:
      "Not a machine part but the fuel stream: liquid tin droplets roughly 25 µm across, travelling at tens of metres per second with even spacing. Each arrival must be synchronised with the laser pulses to a small fraction of a microsecond. Unused droplets fall into the catcher; used ones become plasma and debris. Here they are enlarged enormously and slowed down so they can be seen.",
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
    parent: 'sys-source',
    engineering:
      "A heated receptacle under the droplet path, kept above tin's 232 °C melting point so the metal stays liquid and drains away. Its shape is chosen so arriving droplets do not splash back toward the collector. It connects to a tin-recovery path; how real systems route and recycle the tin is not public, so the funnel here is schematic.",
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
    parent: 'sys-source',
    engineering:
      "A master oscillator produces short infrared pulses that pass through a chain of gas-discharge power amplifiers and then a beam-transport line into the source vessel. Focusing optics aim the beam through the central hole of the collector onto the droplet, and timing electronics fire the pre-pulse and the main pulse. In practice the drive laser is a large installation of its own; the model reduces it to one box and a straight beam.",
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
    parent: 'sys-source',
    kind: 'process',
    context: ['co2Laser', 'collector'],
    engineering:
      "Two pulses per droplet, timed from droplet-position measurements: a weaker pre-pulse that reshapes the droplet and, microseconds later, the main pulse that heats it into plasma. The two foci sit at slightly different heights because the droplet keeps moving between them. Pulse energies, lengths and delays are tuned by the machine maker and are not modelled; only the order and geometry are shown.",
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
    parent: 'sys-source',
    kind: 'process',
    context: ['collector', 'dropletGenerator', 'catcher'],
    engineering:
      "The plasma forms at the first focus of the collector, a fraction of a millimetre across, for a fraction of a microsecond per shot. Around it, hydrogen gas flows slow down fast tin ions and vapour so they do not reach the collector. Energy that does not leave as useful 13.5 nm light ends up as heat, which the cooling system removes. Shown here as a slowed, enlarged flash.",
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
    parent: 'sys-source',
    kind: 'process',
    context: ['collector', 'ffm', 'pfm', 'illumination', 'reticle', 'projection', 'waferStage'],
    engineering:
      "Not a solid object: light following the optical path from the plasma via the collector, the intermediate focus, the illuminator mirrors and the mask, through the projection mirrors to the wafer. Every surface it meets is a multilayer mirror, and the whole path is enclosed in low-pressure gas. Beam widths and pulse speeds in the model are visual aids.",
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
    parent: 'sys-source',
    engineering:
      "A large concave mirror with a central hole for the laser beam, coated with a molybdenum/silicon multilayer and a protective capping layer. Its shape is part of an ellipsoid, so it images the plasma (first focus) onto the intermediate focus (second focus). It faces the plasma directly, so it is cooled, shielded by hydrogen flows and kept clean; contamination sets its lifetime. Real dimensions and mounts are not modelled.",
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
    inspectView: [64, 12],
    cam: cam([-9.2, 3, 0], 10, 8, -28),
    widgets: ['multilayer'],
  },
  {
    id: 'vacuum',
    name: 'Vacuum Chamber',
    zone: 'source',
    parent: 'sys-source',
    engineering:
      "The light path runs through a chain of sealed compartments: the source vessel, the illuminator, the reticle and projection areas and the wafer-stage compartment. Apertures and gas locks separate them so each can keep its own pressure and cleanliness. Pumps remove gas continuously while a gentle hydrogen flow is kept where the optics need it. The model shows the source vessel as a cylinder; the other compartments are implied by the cabinets.",
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
    parent: 'sys-source',
    engineering:
      "The handover point between the source module and the scanner. A small aperture there passes the converging light while limiting the gas and debris that can travel from the source into the cleaner optics. Because the illuminator images this point, the size and stability of the focus matter for even light on the mask.",
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
    parent: 'sys-illum',
    engineering:
      "A few multilayer mirrors on stiff, temperature-controlled mounts. The field facet mirror and the pupil facet mirror shape the beam; relay mirrors fold and focus it onto the mask about 6° from the normal. The mounts keep the mirrors stable to nanometres while they warm up from absorbed light. In the model the relay is a single round mirror on a post.",
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
    parent: 'sys-illum',
    engineering:
      "A mirror divided into many small multilayer-coated facets, each with its own tilt; in some designs the tilts can be changed to switch illumination settings. It sits in a plane conjugate to the mask, so the outline of each facet matches the illuminated slit on the mask. The model uses a simple grid of rectangular tiles.",
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
    inspectView: [-20, 40],
    cam: cam([3.17, 4.9, 0], 5.5, 4, -22),
  },
  {
    id: 'pfm',
    name: 'Pupil Facet Mirror',
    zone: 'scanner',
    parent: 'sys-illum',
    engineering:
      "A second faceted mirror placed where the illuminator forms images of the source, a pupil plane. Which facets receive light decides the angles at which light reaches the mask: conventional, annular, dipole or custom shapes. In the model a hexagonal array of round tiles shows a dipole setting, with the lit facets glowing.",
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
    inspectView: [-20, 40],
    cam: cam([9.08, 3.8, 0], 5.5, 4, -22),
    widgets: ['resolution'],
  },
  {
    id: 'reticle',
    name: 'Reflective Mask',
    zone: 'scanner',
    parent: 'sys-reticle',
    engineering:
      "A 152 mm square, 6.35 mm thick plate of ultra-low-expansion glass with a Mo/Si multilayer mirror, a thin capping layer and a patterned absorber on its working face. It is held face-down by an electrostatic clamp on the reticle stage and may be protected by a pellicle, a thin membrane that keeps particles out of focus. In the model the mask hangs face-down above the projection optics, with a magnified copy of its pattern beside it.",
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
    inspectView: [-30, -30],
    cam: cam([16, 12.6, 0], 8, 6.5, -6, -24),
    widgets: ['mask', 'transfer'],
  },
  {
    id: 'projection',
    name: 'Projection Optics',
    zone: 'scanner',
    parent: 'sys-projection',
    engineering:
      "A housing holding six aspheric multilayer mirrors, each on mounts with actuators that can correct position and tilt during operation. The housing is temperature-stabilised, kept in low-pressure hydrogen and carried by the isolated metrology frame so stage vibrations do not reach it. Mirror surfaces must be accurate to a small fraction of a nanometre. The six-mirror zigzag here is a teaching layout, not a real optical prescription.",
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
    parent: 'sys-wafer',
    engineering:
      "A 300 mm silicon disc about 0.775 mm thick, coated in the track with an underlayer and a photoresist film tens of nanometres thick. During exposure it lies on the wafer table, held flat by electrostatic clamping because suction does not work in vacuum. Afterwards it leaves the scanner through a load lock to the track.",
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
    parent: 'sys-wafer',
    engineering:
      "The resist is spin-coated in the track: a small amount of resist solution is spread over the spinning wafer and baked to drive off solvent, leaving a film tens of nanometres thick. Chemically amplified resists combine a polymer, a photoacid generator and a quencher; metal-oxide resists use different chemistry. In this model the film is seen only in the magnified cross-section, which exaggerates its thickness greatly.",
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
    parent: 'sys-down',
    engineering:
      "A temperature-controlled hot plate inside the track, usually with a lid and controlled gas flow, holding the wafer just above the plate surface. Temperature uniformity is critical because the acid-catalysed reactions speed up strongly with temperature. A chill plate normally follows to stop the reaction at a defined time. Exact recipes depend on the resist and are not modelled.",
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
    parent: 'sys-down',
    engineering:
      "A spin module: a nozzle dispenses developer onto the spinning wafer, the liquid stands as a puddle for a set time, deionised water rinses it off and the wafer spins dry. A catch cup around the wafer collects the liquids. Development time, temperature and rinse sequence are tuned for each resist.",
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
    parent: 'sys-down',
    engineering:
      "A vacuum chamber in a separate etch tool with gas inlets, a radio-frequency plasma source, an electrostatic chuck that holds and cools the wafer, and pumps. Gas chemistry, pressure, plasma power and ion energy are set by the recipe for each layer. After etching, leftover resist is removed (ashing) before the next process step.",
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
    parent: 'sys-support',
    kind: 'zone',
    engineering:
      "Contains the EUV source module, the illuminator, the reticle stage, the projection optics and the wafer stage, mounted on a common base with vibration isolation, wrapped in enclosures and connected to cooling, vacuum, power and control utilities.",
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
    parent: 'sys-down',
    kind: 'zone',
    engineering:
      "The track (coating, bake, develop) is usually docked directly to the scanner so wafers move between them automatically; etching happens in separate plasma-etch tools elsewhere in the fab.",
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
  {
    id: 'reticleStage',
    name: 'Reticle Stage',
    zone: 'scanner',
    parent: 'sys-reticle',
    engineering:
      'A long-stroke stage for the scan motion carries a short-stroke fine stage for nanometre corrections; both are driven by electromagnetic motors and work in vacuum or very low pressure. The reticle is held face-down by an electrostatic clamp, and position sensors (interferometers or encoders) together with alignment marks tie the mask position to the projection optics. Real stage designs are proprietary; the model shows a carriage, a clamp and two guide rails.',
    stage: 5,
    span: [5, 7],
    simple: 'The precision platform that holds the mask upside down and slides it through the light, exactly in step with the wafer far below.',
    what: 'A moving stage that carries the reticle on an electrostatic clamp. It scans the mask through the illuminated slit while the wafer stage scans underneath at a quarter of the speed.',
    does: 'Moves the mask pattern through the light so a whole field is exposed, and keeps the mask position known to nanometres during every scan.',
    physics:
      'Because the projection optics demagnify 4×, the mask must move four times as far and four times as fast as the wafer during a scan: v_mask = M · v_wafer. Quick starts and stops at the ends of each scan need large forces (F = m · a), so stages are light but stiff and driven by electromagnetic linear motors. Their position is measured with laser interferometers or optical encoders against a stable reference; any timing mismatch between mask and wafer would smear the image.',
    chemistry: 'No chemistry is involved. Clamp and stage materials must release very little gas in vacuum, and the mask surface must stay free of particles.',
    equations: [
      eq('Scan synchronisation', 'v_{mask} = M · v_{wafer}', [['v_mask', 'mask scan speed', 'm/s'], ['M', 'reduction ratio of the projection optics (4)', ''], ['v_wafer', 'wafer scan speed', 'm/s']], 'M = 4: when the wafer moves 1 mm, the mask moves 4 mm in the same time.'),
      eq('Force to accelerate the stage', 'F = m · a', [['F', 'motor force', 'N'], ['m', 'moving mass', 'kg'], ['a', 'acceleration', 'm/s²']], 'Illustrative: 20 kg accelerated at 100 m/s² needs 2 kN.'),
    ],
    see: 'The dark carriage and clamp above the mask slide along two rails while the bright slit of light sweeps across the pattern.',
    deep: {
      notes: [
        'The control system compares the measured positions of mask and wafer thousands of times per second and corrects any difference.',
        'Only a narrow slit of the field is imaged at any moment; scanning mask and wafer together is what lets a scanner expose a large field with smaller optics.',
      ],
      limits: ['Stage size, travel and motor layout are schematic.', 'The 4× speed ratio is real; the motion shown is slowed down enormously.'],
    },
    cam: cam([16, 14.1, 0], 7.5, 4.5, -24, 20),
  },
  {
    id: 'waferStage',
    name: 'Wafer Stage',
    zone: 'scanner',
    parent: 'sys-wafer',
    engineering:
      'A long-stroke stage carries a short-stroke fine stage with the wafer table, which clamps the wafer electrostatically on a pattern of tiny pins. Position is measured by laser interferometers or grid encoders referenced to the metrology frame, and level and alignment sensors map each wafer before exposure. Cables and coolant reach the moving stage through flexible carriers designed to disturb it as little as possible.',
    stage: 7,
    simple: 'The fast, ultra-precise table that carries the wafer under the light, stepping from field to field and scanning each one while keeping the wafer exactly in focus.',
    what: 'A positioning system with a wafer table and electrostatic clamp, driven by electromagnetic motors and measured by interferometers or encoders, with level and alignment sensors nearby.',
    does: 'Positions every field of the wafer under the projection optics, scans it in step with the mask and holds focus and overlay within nanometres.',
    physics:
      'Each layer of a chip must land on top of the previous one within a few nanometres (overlay), so the stage position is measured continuously and corrected by feedback control. Before exposure, sensors map the wafer height (levelling) and locate alignment marks. Temperature matters too: silicon expands by about 2.6 × 10⁻⁶ per kelvin, so a 0.01 K change across 300 mm moves the edge by about 8 nm.',
    chemistry: 'No chemistry is involved. Clamp surfaces must stay clean, because a particle under the wafer bends it and spoils focus.',
    equations: [
      eq('Thermal expansion', 'ΔL = α · L · ΔT', [['ΔL', 'change in length', 'm'], ['α', 'linear expansion coefficient, ≈ 2.6×10⁻⁶ for silicon', '1/K'], ['L', 'length', 'm'], ['ΔT', 'temperature change', 'K']], 'L = 0.3 m, ΔT = 0.01 K → ΔL ≈ 7.8 nm.'),
      eq('Electrostatic clamping pressure', 'P ≈ ε_{0} ε_{r} E^{2} / 2', [['P', 'clamping pressure', 'Pa'], ['ε₀', 'vacuum permittivity', 'F/m'], ['ε_r', 'relative permittivity of the clamp dielectric', ''], ['E', 'electric field across the gap', 'V/m']], undefined, 'Order-of-magnitude estimate; real clamps use structured surfaces with tiny contact pins.'),
    ],
    see: 'The dark stage block and the chuck under the wafer, on rails over a long base; a small sensor head with a red light beside it stands in for the position sensors.',
    deep: {
      notes: [
        'Publicly documented dual-stage designs measure one wafer while another is being exposed, so the slow measurements do not cost exposure time.',
        'High stage accelerations keep throughput up, which is why the optics sit on a separate, vibration-isolated frame.',
      ],
      limits: ['The stage is drawn as a block on rails; motors, sensors and dual-stage hardware are not modelled in detail.'],
    },
    cam: cam([26.2, -3.0, 0], 13, 5, -18, 18),
  },
  {
    id: 'frame',
    name: 'Structural Frame and Vibration Isolation',
    zone: 'scanner',
    parent: 'sys-support',
    engineering:
      'Heavy base beams spread the load on the fab floor; pneumatic or active isolators carry a metrology frame made of stiff, low-expansion material. Stage motors push against the base frame (force path) while interferometers and encoders measure against the metrology frame (measurement path), so the forces never reach the reference. The model shows beams, six isolators, a metrology plate and four columns as a simplified representation.',
    stage: 6,
    simple: 'The heavy base and the quiet inner frame that keep the optics so still that floor vibrations and the fast-moving stages cannot blur the image.',
    what: 'A rigid base frame on the floor, with vibration isolators carrying a separate metrology frame on which the projection optics and the position sensors are mounted.',
    does: 'Separates the parts that move and shake (stages, pumps, coolant flows) from the parts that must stay still (the optics and the sensors that measure positions).',
    physics:
      'A mass on a spring isolates vibrations above its natural frequency f_n = (1/2π)·√(k/m): far above f_n almost no motion is passed on, near f_n it is amplified. Isolators with very low natural frequencies, around 1 Hz, therefore block most building vibration. A second principle is separating the force path from the measurement path: motors push against one frame while sensors measure against another that carries no forces.',
    chemistry: 'No chemistry is involved. Frame materials are chosen for stiffness, damping and low thermal expansion.',
    equations: [
      eq('Natural frequency of a spring–mass mount', 'f_{n} = (1/2π) √(k / m)', [['f_n', 'natural frequency', 'Hz'], ['k', 'spring stiffness', 'N/m'], ['m', 'supported mass', 'kg']], 'm = 1000 kg, k = 4×10⁴ N/m → f_n ≈ 1 Hz.'),
      eq('Transmissibility (undamped)', 'T = 1 / | 1 − (f/f_{n})^{2} |', [['T', 'fraction of floor vibration passed to the frame', ''], ['f', 'vibration frequency', 'Hz'], ['f_n', 'natural frequency of the mount', 'Hz']], 'f = 10 Hz, f_n = 1 Hz → T ≈ 1%.', 'Real isolators add damping and active feedback.'),
    ],
    see: 'Steel base beams under the scanner, cylindrical isolators with bellows, a dark metrology plate under the optics and wafer stage, and the columns that carry the projection optics box.',
    deep: {
      notes: [
        'Active isolation measures the remaining motion with accelerometers and cancels it with actuators, complementing the passive springs.',
        'Fab floors are themselves built to be very stiff, and lithography tools often stand on dedicated foundations.',
      ],
      limits: ['Positions, sizes and number of isolators are illustrative, not the real arrangement.'],
    },
    cam: cam([14, -4.6, 0], 40, 9, -14, 14),
  },
  {
    id: 'vacuumPumps',
    name: 'Vacuum Pumps and Valves',
    zone: 'scanner',
    parent: 'sys-support',
    engineering:
      'Each compartment has its own turbomolecular pumps on large flanges, backed by dry roughing pumps through foreline piping, with gate valves that isolate sections for service. Hydrogen supply lines, pressure gauges and residual-gas analysers monitor and control the gas environment. The model shows three turbo pumps, a manifold, foreline pipes and a gate valve where the source meets the illuminator.',
    stage: 3,
    simple: 'Pumps that keep the inside of the machine almost empty of gas, because even a little air would swallow the EUV light.',
    what: 'Turbomolecular pumps on the source vessel, the optics compartments and the stage areas, backed by roughing pumps and connected through valves and pipes.',
    does: 'Removes gas and contaminants continuously while a controlled, low-pressure hydrogen flow is fed in where the optics need it.',
    physics:
      'At low pressure gas molecules rarely meet each other: the mean free path λ = k_B·T / (√2·π·d²·p) grows to millimetres or metres, so gas moves molecule by molecule (molecular flow). A turbomolecular pump has rotor blades moving about as fast as the molecules themselves, and each molecule that hits a blade is pushed toward the exhaust. Pumping speed S and chamber volume V set how quickly pressure falls: p(t) = p₀·e^(−S·t/V).',
    chemistry: 'Besides hydrogen, the pumps remove tin hydride (SnH₄) formed when hydrogen radicals clean tin deposits, and the water and hydrocarbons that would otherwise contaminate the mirrors. Pump materials and lubricants must not add contamination.',
    equations: [
      eq('Mean free path', 'λ = k_{B} T / ( √2 π d^{2} p )', [['λ', 'mean free path', 'm'], ['k_B T', 'thermal energy, 4.1×10⁻²¹ J at 300 K', 'J'], ['d', 'molecular diameter, ≈ 3.7×10⁻¹⁰ m for N₂', 'm'], ['p', 'pressure', 'Pa']], 'N₂ at 1 Pa → λ ≈ 7 mm; at 10⁻³ Pa → about 7 m.'),
      eq('Pump-down', 'p(t) = p_{0} e^{−S t / V}', [['p', 'pressure', 'Pa'], ['S', 'pumping speed', 'm³/s'], ['t', 'time', 's'], ['V', 'chamber volume', 'm³']], undefined, 'Ideal case: ignores gas released by the walls, which dominates at low pressure.'),
    ],
    see: 'Ribbed cylinders (turbo pumps) under the source vessel, behind the optics box and beside the wafer stage, linked by grey pipes to a manifold; a valve ring sits where the source meets the illuminator.',
    deep: {
      notes: [
        'EUV tools do not run in hard vacuum everywhere: a few pascals of hydrogen near the source and optics slow debris and clean surfaces, while apertures and gas locks hold pressure differences between compartments.',
        'At low pressure, gas released by surfaces (outgassing) usually limits the achievable pressure more than pump speed does.',
      ],
      limits: ['Pump positions, counts and sizes are illustrative.'],
    },
    cam: cam([10, -1.5, 0], 44, 13, -12, 12),
  },
  {
    id: 'cooling',
    name: 'Cooling and Thermal Management',
    zone: 'scanner',
    parent: 'sys-support',
    engineering:
      'Chillers outside the cleanroom feed manifolds that split into many separately regulated loops, each with flow and temperature sensors. Flexible lines reach moving stages, and loops inside the vacuum use welded, leak-tested connections. The model shows one manifold with paired supply and return lines to the main heat sources.',
    stage: 3,
    simple: 'Water circuits that carry heat away, because the laser, plasma, mirrors and motors would otherwise warm up and the machine would lose its nanometre precision.',
    what: 'A network of temperature-controlled coolant loops with supply and return lines to the source, collector, laser, optics, stages and electronics, fed from chillers and manifolds.',
    does: 'Removes heat where it is produced and holds critical parts at a constant temperature, often to within thousandths of a kelvin.',
    physics:
      'Heat carried away by a liquid loop is Q = ṁ·c_p·ΔT. Multilayer mirrors absorb roughly a third of the EUV light that reaches them, and that heat makes them expand; a change of even a nanometre alters the image. Mirror substrates therefore use materials with near-zero thermal expansion, and the remaining heat flows by conduction into cooled mounts.',
    chemistry: 'Coolant water is deionised and filtered so it neither corrodes the lines nor leaves deposits; loops near the vacuum must never leak.',
    equations: [
      eq('Heat carried by a coolant loop', 'Q = ṁ · c_{p} · ΔT', [['Q', 'heat removed', 'W'], ['ṁ', 'mass flow of coolant', 'kg/s'], ['c_p', 'specific heat, ≈ 4180 for water', 'J/(kg·K)'], ['ΔT', 'temperature rise of the coolant', 'K']], 'Q = 1 kW with ΔT = 2 K → ṁ ≈ 0.12 kg/s, about 7 litres per minute.'),
    ],
    see: 'Blue (supply) and red (return) lines run from a manifold to the source vessel, the laser, the optics box and the stages. The colours are only a visual code.',
    deep: {
      notes: [
        'Temperature stability matters as much as cooling power: a slowly drifting temperature moves parts more than a constant heat load does.',
        'The drive laser and the source dissipate by far the most power; the optics need the most stable temperatures.',
      ],
      limits: ['Line routing, colours and the manifold are illustrative; real systems use many separate loops.'],
    },
    cam: cam([6, 3, 0], 46, 20, -12, 12),
  },
  {
    id: 'cabling',
    name: 'Power, Control and Sensors',
    zone: 'scanner',
    parent: 'sys-support',
    engineering:
      'Power and signal cables run in trays to electronics racks; flexible cable carriers follow the moving stages. Sensor heads (interferometers or encoders for position, optical level and alignment sensors) sit close to the parts they measure, and vacuum feedthroughs pass signals through chamber walls. The rack, trays and sensor heads in the model stand in for a large, proprietary control system.',
    stage: 7,
    simple: 'Many kilometres of wiring and many sensors that power the motors and lasers and let the control computers measure and adjust everything thousands of times a second.',
    what: 'Cable trays and flexible cable carriers, electronics racks, and sensors such as position encoders, interferometers and level and alignment sensors.',
    does: 'Delivers power and signals between the control electronics and the machine, and feeds the measurements that keep stages, optics and source synchronised.',
    physics:
      'Precision positioning relies on feedback control: sensors measure the position, a controller compares it with the target and drives the motors to correct the error. Cables that move with a stage push and pull on it, so carriers are designed for small, repeatable forces, and shielding keeps electrical noise out of sensitive signals.',
    chemistry: 'Cables inside the vacuum need insulation that releases very little gas (low outgassing), because vapours from plastics could deposit on the mirrors.',
    equations: [eq('Resistive heating of a cable', 'P = I^{2} R', [['P', 'heat produced', 'W'], ['I', 'current', 'A'], ['R', 'cable resistance', 'Ω']], 'I = 10 A, R = 0.05 Ω → P = 5 W of heat for the cooling to remove.')],
    see: 'Trays along the top, a dark electronics rack with status lights, a flexible chain feeding the wafer stage and small sensor heads beside the wafer.',
    deep: {
      notes: ['Stage control loops run at kilohertz rates; sensors, electronics and mechanics are designed together.', 'Electronics that produce a lot of heat are kept away from the most temperature-sensitive areas.'],
      limits: ['The rack, trays and sensor heads are schematic placeholders.'],
    },
    cam: cam([8, 2, 0], 46, 18, -12, 12),
  },
  {
    id: 'enclosure',
    name: 'Machine Enclosure',
    zone: 'scanner',
    parent: 'sys-support',
    engineering:
      'Panels hang on a steel frame and open for service; door interlocks connect to the laser and high-voltage safety systems. Utility interfaces bring in coolant, gases, vacuum exhaust, power and data. In the model each module has its own cabinet with an identification plate, and the track and etch tool have separate cabinets because they are separate machines.',
    stage: 0,
    simple: 'The outer cabinets of the machine. They keep dust, light, heat and people out, and keep the laser light and dangerous voltages in.',
    what: 'Modular painted-metal and aluminium panels on a structural frame, with service doors, ventilation, inspection windows, utility connections and identification and warning plates.',
    does: 'Gives the machine a clean, temperature-stable internal environment, provides safe access for service, and has interlocks that stop the laser when a door opens.',
    physics:
      'The enclosure is not the vacuum boundary: the vacuum chambers sit inside it. Its job is thermal and particle control. Filtered air at a controlled temperature flows through it so heat from electronics and motors does not drift into the optics.',
    chemistry: 'Panels and seals are chosen to shed few particles and release little vapour, because airborne molecular contamination can affect optics and resist.',
    equations: [],
    see: 'Light-grey cabinets with dark trim, service doors with handles and fasteners, vents, inspection windows, pipes and cable trays on top, and identification and warning plates. Open the machine to watch the panels retract.',
    deep: {
      notes: ['Lithography tools stand in some of the cleanest areas of a fab and add their own filtered mini-environments.', 'Service access is designed in: whole modules can be opened, swapped or serviced.'],
      limits: ['Inspired by publicly shown EUV systems; panel layout, proportions, labels and colours are illustrative, not the real design.'],
    },
    cam: { t: [6.5, 3, 0], az: -14, el: 10, fit: [60, 30] },
  },
];

export const COMPONENTS: Record<string, ComponentInfo> = Object.fromEntries(COMPONENT_LIST.map((c) => [c.id, c]));
