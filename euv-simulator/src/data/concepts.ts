import type { ConceptDef, EquationDef } from './types';

const eq = (title: string, tex: string, vars: EquationDef['vars'], example?: string, note?: string): EquationDef => ({ title, tex, vars, example, note });

export const CONCEPTS: ConceptDef[] = [
  {
    id: 'photonEnergy',
    title: 'Photon energy: E = hc/λ',
    stage: 2,
    focus: 'euvBeam',
    beginner:
      'Light comes in tiny packets called photons. The shorter the wavelength, the more energy each packet carries. A photon of red light carries about 2 eV; an EUV photon carries roughly 46 times more.',
    intermediate:
      'A photon’s energy is inversely proportional to its wavelength: E = hc/λ, or E[eV] = 1239.84 / λ[nm]. Energy decides what a photon can do to matter. Visible photons (2–3 eV) excite molecules, deep-UV photons (6.4 eV at 193 nm) can break weak bonds, and EUV photons (92 eV) can knock electrons out of any atom.',
    advanced:
      'E = hc/λ = hν with h = 6.626×10⁻³⁴ J·s and c = 2.998×10⁸ m/s. At λ = 13.5 nm: E = 1.47×10⁻¹⁷ J = 91.8 eV. For a given dose D the photon density is N/A = D/E, so EUV delivers 14 times fewer photons than 193 nm light at equal dose. This is the root of photon shot noise, σ_N/N = 1/√N, in EUV resists. Assumes monochromatic light; real EUV light has a bandwidth of about 2%.',
    equation: eq('Photon energy', 'E = hc / λ', [['E', 'photon energy', 'eV or J'], ['h', 'Planck constant', 'J·s'], ['c', 'speed of light', 'm/s'], ['λ', 'wavelength', 'm']], '13.5 nm → 91.8 eV'),
  },
  {
    id: 'euvWavelength',
    title: 'EUV wavelength ≈ 13.5 nm',
    stage: 3,
    focus: 'collector',
    beginner:
      'Printing finer lines needs light with a shorter wavelength, like using a thinner pen. EUV light has a wavelength of about 13.5 nanometres, roughly 14 times shorter than the 193 nm deep-ultraviolet light used before. 13.5 nm was chosen because we can make bright light there and we can make mirrors that reflect it.',
    intermediate:
      'Two things meet at 13.5 nm: tin plasma emits a strong band there, and molybdenum/silicon multilayer mirrors reflect it best (about 65–70%). Together they make a usable source and optical system. A shorter wavelength lets smaller features be resolved but is also absorbed far more strongly by everything.',
    advanced:
      'The Mo/Si reflectivity peak is set by the layer period d ≈ λ/(2cosθ) and sits just above the silicon L-edge (≈ 12.4 nm), where silicon stops absorbing strongly. The Sn⁸⁺–Sn¹⁴⁺ 4d–4f and 4p–4d lines form an unresolved transition array in the same band. The passband is only about 2% wide, so source power is quoted in that band. Resolution R = k₁λ/NA: going from 193 nm immersion (NA 1.35) to 13.5 nm (NA 0.33) reduces λ/NA from 143 nm to 41 nm.',
    equation: eq('Rayleigh resolution', 'R = k_{1} λ / NA', [['R', 'half-pitch', 'nm'], ['k₁', 'process factor ≥ 0.25', ''], ['λ', 'wavelength', 'nm'], ['NA', 'numerical aperture', '']], '13.5 / 0.33 = 40.9 nm; × k₁ = 0.4 → 16 nm'),
  },
  {
    id: 'energy92',
    title: 'Photon energy at 13.5 nm: about 92 eV',
    stage: 7,
    focus: 'resist',
    beginner:
      'Each EUV photon carries about 92 electron-volts of energy. For a single particle of light that is a lot: enough to knock electrons off atoms. That is why EUV is called ionising radiation, and why it hits the resist very differently from ordinary light.',
    intermediate:
      '92 eV is several times the energy needed to remove an electron from a molecule (about 8–25 eV). One photon therefore ionises a molecule, and the freed electron, carrying most of the leftover energy, goes on to ionise more molecules. In a chemically amplified resist one absorbed photon can therefore lead to several acid molecules.',
    advanced:
      'A photoelectron leaves with E_k ≈ hν − E_binding, about 75–85 eV for valence electrons. It loses energy by inelastic scattering (mean free path of order 1–3 nm at tens of eV), producing secondary electrons of roughly 5–80 eV. The number of ionisation events per absorbed photon is hν divided by the mean energy per event (of order 20–30 eV), so a few. Reported acid yields per absorbed photon are of order 2–3 but depend on the resist. Absorption is α ≈ 4–5 µm⁻¹ for organic resists and higher when elements such as Sn, I, Zn or Hf are present.',
  },
  {
    id: 'plasmaCoupling',
    title: 'Laser-to-plasma energy transfer',
    stage: 1,
    focus: 'laserPulses',
    beginner:
      'The laser’s energy has to end up as EUV light. First the pre-pulse flattens the droplet into a bigger target. Then the main pulse pours its energy in and heats the tin to hundreds of thousands of degrees. A few percent of the laser energy comes out as EUV; the rest becomes heat.',
    intermediate:
      'Free electrons in the tin absorb the laser light (inverse bremsstrahlung) and share the energy with ions through collisions. Absorption happens up to the critical density, so a CO₂ laser (long wavelength, low critical density) deposits its energy in a thin, low-density region from which the 13.5 nm light can escape. The pre-pulse builds a large, low-density target so that more of the main pulse is absorbed in the right place. The conversion efficiency reaches CE ≈ 5–6%.',
    advanced:
      'Collisional absorption scales as κ_ib ∝ Z n_e² / (ω² T_e^{3/2}) and the light cannot propagate beyond n_c = ε₀ m_e ω²/e². CE = E_EUV(2π sr, 2% band)/E_laser. Most of the absorbed energy ends up as ion kinetic energy, hydrodynamic expansion and out-of-band radiation. The scaling hides pulse-length, spot-size and target-shape effects; no analytic model captures them, so sources are optimised with radiation-hydrodynamic simulations and experiments.',
    equation: eq('Critical density', 'n_{c} ≈ 1.1×10^{21} / λ^{2}', [['n_c', 'critical electron density', 'cm⁻³'], ['λ', 'laser wavelength', 'µm']], '10.6 µm → 9.8×10¹⁸ cm⁻³'),
  },
  {
    id: 'ionization',
    title: 'Tin ionisation and plasma emission',
    stage: 2,
    focus: 'plasma',
    beginner:
      'At extreme temperature atoms lose many electrons and become a hot soup of charged particles called plasma. Tin ions that have lost around ten electrons glow at 13.5 nm when their remaining electrons jump between energy levels. It is like a neon sign, not a fire.',
    intermediate:
      'Electron collisions strip tin atoms to Sn⁸⁺–Sn¹⁴⁺ at electron temperatures of a few tens of eV. The 4d electrons of these ions make a huge number of closely spaced transitions (4p–4d, 4d–4f) that merge into one strong band near 13.5 nm, an unresolved transition array. Combustion needs oxygen and chemical bonds; here there are neither. This is atomic physics.',
    advanced:
      'In local thermodynamic equilibrium the ion populations follow the Saha equation, but laser-produced plasmas are only partly in LTE, so collisional-radiative models are used. Strong in-band emission needs ion stages around Sn¹⁰⁺ and electron temperatures of roughly 30–50 eV; a hotter plasma goes to ion stages that emit at shorter wavelengths, a colder one does not ionise enough. Self-absorption inside a dense plasma limits the escaping in-band light, which is why target density and size are controlled.',
    equation: eq(
      'Saha ionisation balance',
      'n_{i+1} n_{e} / n_{i} = (2 / Λ^{3}) (g_{i+1} / g_{i}) exp( −χ_{i} / k_{B}T )',
      [['n_i', 'ion density of charge state i', 'm⁻³'], ['n_e', 'electron density', 'm⁻³'], ['Λ', 'thermal de Broglie wavelength', 'm'], ['χ_i', 'ionisation energy', 'eV'], ['k_B T', 'thermal energy', 'eV']],
      undefined,
      'Equilibrium assumption; only an approximation for these plasmas.',
    ),
  },
  {
    id: 'multilayer',
    title: 'Multilayer interference and reflection',
    stage: 4,
    focus: 'illumination',
    beginner:
      'Ordinary mirrors do not reflect EUV, because the light is absorbed. The trick is to stack dozens of ultra-thin alternating layers. Each boundary reflects a tiny bit, and the layers are spaced so that all the tiny reflections line up and add, like perfectly timed ripples. About two thirds of the light is reflected.',
    intermediate:
      'A Mo/Si mirror has roughly 40–50 pairs of layers with a period of about 6.9 nm (half a wavelength). The reflections from all interfaces add in phase when the Bragg condition mλ = 2d cosθ holds, giving about 65–70% at 13.5 nm within a bandwidth of roughly 2%. A thin capping layer protects the surface. Every mirror still loses a third of the light, so after about a dozen reflections (collector, illuminator, mask and six projection mirrors) only about 1% of the light reaches the wafer.',
    advanced:
      'Reflectance follows from the recursive Fresnel (Parratt) equations with complex indices n = 1 − δ + iβ (Mo ≈ 0.92 + 0.006i, Si ≈ 0.999 + 0.002i at 13.5 nm). Absorption in the stack limits the useful number of periods (≈ 40–50) and the peak (about 74% theoretical for ideal Mo/Si; interdiffusion at the interfaces brings real mirrors to ≈ 70%). The bandwidth is Δλ/λ ≈ 1/N_eff. Across a curved mirror the period must be varied to stay on the peak for every angle of incidence.',
    equation: eq('Bragg condition', 'm λ = 2 d cos θ', [['m', 'order', ''], ['λ', 'wavelength', 'nm'], ['d', 'layer-pair period', 'nm'], ['θ', 'angle from the normal', 'deg']], 'θ = 6°, d = 6.8 nm → λ = 13.5 nm'),
  },
  {
    id: 'vacuum',
    title: 'Vacuum and EUV absorption',
    stage: 3,
    focus: 'vacuum',
    beginner:
      'EUV light is swallowed by almost anything, even air. If the machine were filled with air, the light would vanish a fraction of a millimetre from the source. So the whole light path is sealed and pumped out. Flip the Chamber switch to Air to watch the light die.',
    intermediate:
      'Gas molecules absorb EUV photons by photoionisation. The surviving fraction is exp(−nσx), where n is the molecule density and σ the absorption cross-section. At atmospheric pressure the 1/e length is about 0.1 mm; in low-pressure hydrogen (a few pascals) it is many metres. Hydrogen is used because it absorbs very weakly at 13.5 nm, and it helps keep the mirrors clean.',
    advanced:
      'Beer–Lambert with n = P/k_BT. The cross-section of N₂ at 92 eV is of order 10⁻¹⁸ cm², and that of H₂ is far smaller. For a section of length L the transmission is exp(−σPL/k_BT), which sets an allowed pressure–length product of order Pa·m. Hydrogen also reacts with tin (forming volatile SnH₄) and with carbon contamination, but it can damage multilayers through blistering if the capping layer fails, which limits the hydrogen flux.',
    equation: eq('Beer–Lambert', 'I = I_{0} exp( −n σ x )', [['n', 'molecule density', 'm⁻³'], ['σ', 'absorption cross-section', 'm²'], ['x', 'path length', 'm']], 'Air, 1 atm: 1/e length of order 0.1 mm'),
  },
  {
    id: 'diffraction',
    title: 'Diffraction and numerical aperture',
    stage: 6,
    focus: 'projection',
    beginner:
      'A pattern of tiny lines spreads light into several beams, like ripples leaving a narrow gap. The mirrors must catch enough of those beams to rebuild the pattern. A bigger “mouth”, called the numerical aperture, catches more beams, so it can print finer lines.',
    intermediate:
      'A grating of pitch p diffracts light into orders at angles sinθ_m = mλ/p. The optics passes only orders inside its acceptance cone, sinθ ≤ NA. To form any image it must catch the 0th order and at least one of the ±1 orders. This gives a smallest pitch of λ/NA for on-axis light and λ/(2NA) for well-chosen off-axis (dipole) light, so the smallest half-pitch is λ/(4NA) at best.',
    advanced:
      'In wafer space: sinθ_m = mλ/p. Two-beam imaging with orders 0 and −1 gives I(x) = c₀² + c₁² + 2c₀c₁cos(2πx/p) with contrast 2c₀c₁/(c₀² + c₁²), about 0.9 for an ideal binary grating (c₀ = 1/2, c₁ = 1/π). k₁ = HP·NA/λ ≥ 0.25 for single exposure. This is a scalar, thin-mask, ideal-dipole picture. Real resolution is also limited by polarisation, 3D mask effects, aberrations, resist blur and stochastics.',
    equation: eq('Diffraction orders', 'sin θ_{m} = m λ / p', [['θ_m', 'angle of diffraction order m', 'deg'], ['m', 'order (0, ±1, …)', ''], ['λ', 'wavelength', 'nm'], ['p', 'pitch of the pattern (wafer scale)', 'nm']], 'p = 40 nm, λ = 13.5 nm → θ₁ = 19.7°; NA = 0.33 accepts up to 19.3°, so 40 nm pitch just fails on-axis.'),
  },
  {
    id: 'maskImaging',
    title: 'Mask-pattern imaging and resolution',
    stage: 5,
    focus: 'reticle',
    beginner:
      'Think of the mask as a stencil for light, except that instead of letting light through, it reflects or absorbs it. The reflected light carries a picture of one layer of a chip. The projection mirrors shrink that picture four times and focus it on the wafer.',
    intermediate:
      'Where the mask has absorber no light comes back; where it has bare multilayer the light reflects. The projection optics images this pattern with 4× reduction: a 52 nm wide absorber line on the mask becomes a 13 nm line in the image. The finest pitch that prints depends on the wavelength, the NA and a process factor k₁ (R = k₁λ/NA).',
    advanced:
      'Image formation is Fourier filtering: I(x) = |FT⁻¹{ M̃(f)·P(f) }|² with pupil P(f) = 1 for |f| ≤ NA/λ; partial coherence sums this over source points (Hopkins). EUV masks are lit at ≈ 6° off the normal and the absorber has finite height, so shadowing and best-focus shifts appear that thin-mask models ignore. Mask 3D effects, flare and stochastics limit the k₁ that can be reached in practice.',
    equation: eq('Rayleigh resolution', 'R = k_{1} λ / NA', [['R', 'half-pitch', 'nm'], ['k₁', 'process factor', ''], ['NA', 'numerical aperture', '']], '4× reduction: 52 nm on the mask ↔ 13 nm on the wafer'),
  },
  {
    id: 'resistChem',
    title: 'Photoresist chemical changes',
    stage: 7,
    focus: 'resist',
    beginner:
      'Where EUV hits the resist, it creates a little acid. During a gentle bake each acid molecule triggers many reactions that change the resist so it dissolves differently. A tiny bit of light causes a big chemical change.',
    intermediate:
      'EUV ionises resist molecules and the freed electrons release acid from photoacid generators (PAGs). In the post-exposure bake the acid diffuses a few nanometres and catalyses the removal of protecting groups (or cross-linking) and is regenerated, so it triggers many reactions: chemical amplification. This turns the acid pattern into a solubility pattern. Different resists (chemically amplified, metal-oxide) use different mechanisms.',
    advanced:
      'Acid generation is dose dependent, roughly A = 1 − exp(−C·dose). Amplification is catalytic: d[M]/dt = −k[H⁺][M], with acid lost to quenchers; the chain length is limited by diffusion and base content. PAG decomposition has no single balanced equation: it proceeds through electron capture and polymer radical-cation pathways. This app’s model is: aerial image → exposure → blur (σ_e) → acid diffusion (σ_d) → Hill-type amplification → threshold. It ignores depth-dependent absorption and stochastics.',
    equation: eq('Catalytic deprotection', 'd[M]/dt = −k [H^{+}] [M]', [['[M]', 'concentration of protected sites', 'mol/L'], ['[H⁺]', 'acid concentration', 'mol/L'], ['k', 'rate constant, rises with temperature (Arrhenius)', 'L/(mol·s)']], undefined, 'First order in both; ignores quenching and diffusion.'),
  },
  {
    id: 'tone',
    title: 'Positive-tone versus negative-tone development',
    stage: 9,
    focus: 'developer',
    beginner:
      'With a positive resist the part that gets light is washed away. With a negative resist the part that gets light stays and the dark part is washed away. The same pattern of light gives opposite results. Try the Positive, Negative and Compare buttons.',
    intermediate:
      'In positive tone the exposed resist becomes more soluble in the developer (typically aqueous TMAH). In negative tone the exposed resist becomes less soluble, through cross-linking or a polarity change, and the unexposed resist dissolves; negative-tone development often uses organic solvents. Which tone is better depends on the pattern: negative tone can give better contrast or less pattern collapse for some features.',
    advanced:
      'The dissolution rate depends non-linearly on the reaction extent, R(m) (Mack model), so edges form where the local extent crosses a threshold m_TH. For one aerial image the two tones have the same edge positions but print complementary regions. Edge placement is governed by the image log-slope ILS = d ln I/dx at the edge, and line-edge roughness scales roughly as 1/(ILS·√N_photons). Threshold models neglect resist swelling and nanometre-scale development kinetics.',
    equation: eq('Dissolution rate (Mack)', 'R(m) = R_{max} (a+1)(1−m)^{n} / ( a + (1−m)^{n} ) + R_{min}', [['R', 'dissolution rate', 'nm/s'], ['m', 'fraction of protecting groups left', ''], ['n', 'selectivity parameter', '']], undefined, 'Empirical, fitted per resist.'),
  },
  {
    id: 'etch',
    title: 'Etching and pattern transfer',
    stage: 10,
    focus: 'etcher',
    beginner:
      'After developing, the resist is like a stencil on top of a layer of the chip. A plasma then eats away that layer wherever the stencil is open. When the stencil is stripped off, the pattern is in the chip layer itself.',
    intermediate:
      'Etching is done in a plasma tool: ions are accelerated straight down and, together with reactive radicals, remove the film where resist does not cover it. The process is chosen to be selective (it removes the film much faster than the resist) and anisotropic (vertical walls). Then the leftover resist is stripped, usually in an oxygen plasma. Baking, development and etching all happen in separate machines, not in the scanner.',
    advanced:
      'Selectivity S = R_film/R_resist and anisotropy A = 1 − R_lat/R_vert; ion energy E ≈ eV_sheath; aspect-ratio-dependent etching slows the etch in narrow features. Plasma etching of dielectrics such as SiO₂ in fluorocarbon plasmas proceeds through ion-enhanced formation of volatile products (SiF₄, CO, CO₂) with polymer passivation on the sidewalls. The reaction network is complicated and no single reaction describes it. EUV resists are so thin that hard masks and multi-step etches are used.',
    equation: eq('Selectivity and anisotropy', 'S = R_{film} / R_{resist},   A = 1 − R_{lateral} / R_{vertical}', [['S', 'selectivity', ''], ['A', 'anisotropy', ''], ['R', 'etch rates', 'nm/min']]),
  },
];
