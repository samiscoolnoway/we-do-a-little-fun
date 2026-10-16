# EUV Lithography Simulator

An interactive 3-D teaching model of how an extreme-ultraviolet (EUV) lithography scanner prints a chip
pattern, and of the separate steps that turn the exposed wafer into a patterned structure.
React 19 + Three.js (plain, no react-three-fiber) + TypeScript + Vite.

> **Educational model, not a reproduction of any real machine.** It is not an exact or proprietary
> ASML design: geometry, mirror counts and positions, beam shapes, timings and chemistry are
> simplified teaching approximations built from publicly available, textbook-level physics.
> **EUV light is invisible to the human eye.** The cyan beam is a visualization aid; so are the red laser
> and the magenta plasma. Several distances and brightnesses are deliberately exaggerated
> (for example how quickly EUV fades in air, or how bright each mirror reflection looks).

## What it shows

Eleven stages on one timeline (125 s at 1× speed). The first eight happen **inside the scanner**
(cyan frame, vacuum); the last three happen in **separate machines** (amber frame) and are labelled that way
in the scene, the top bar and the stage cards.

| # | Stage | Where | What you see |
|---|-------|-------|--------------|
| 1 | Tin droplets enter the source | scanner · source | droplet generator, a stream of molten tin, catcher, vacuum vessel |
| 2 | Laser pre-pulse reshapes the droplet | scanner · source | CO₂ laser, a weak pre-pulse flattens the droplet into a pancake |
| 3 | Main pulse makes tin plasma and EUV | scanner · source | main CO₂ pulse hits the pancake; plasma emits 13.5 nm light in all directions |
| 4 | Collector mirror focuses the light | scanner · source | ellipsoidal multilayer mirror sends the light to the intermediate focus |
| 5 | Illumination optics shape the beam | scanner | field/pupil facet mirrors, relay mirrors |
| 6 | The reflective mask carries the circuit pattern | scanner | multilayer mirror + absorber pattern, slit scanning over the reticle |
| 7 | Projection optics shrink the image 4× | scanner | six mirrors, 4× reduction, NA 0.33 (diffraction and resolution lab in the inspector) |
| 8 | EUV exposes the photoresist | scanner · wafer stage | photons, ionization, secondary electrons, photoacid generation (magnified cross-section) |
| 9 | Post-exposure bake amplifies the image | **track (separate tool)** | hot plate, acid diffusion and catalytic deprotection |
| 10 | Development dissolves the soluble resist | **track (separate tool)** | positive or negative tone develops away different regions |
| 11 | Etching transfers the pattern | **etch tool (separate)** | reactive ions open the film where the resist is gone, then the resist is stripped |

The photoresist section uses a deliberately simplified **chemically amplified resist** example and never
shows an invented reaction equation where the real mechanism is formulation-dependent: it names the steps
(photoabsorption → ionization → secondary electrons → photoacid generator → acid; bake: acid-catalysed
deprotection with diffusion; development: solubility switch) instead of writing one made-up reaction.

## Controls

| Control | Effect |
|---|---|
| Play / pause, restart | run the timeline; paused frames can be inspected and orbited |
| Previous / next stage, stage chips | jump to the start of any of the 11 stages |
| Timeline scrubber | drag or click anywhere; the scene is a pure function of the timeline time, so scrubbing never pops |
| Speed | 0.25×, 0.5×, 1×, 2×, 4× |
| Labels | show / hide the floating labels (leader lines follow the objects) |
| Optical path | show / hide the laser, EUV and diffraction beams |
| Whole machine / Close-up | overview of both zones, or a camera that follows the current stage |
| Chamber: Vacuum / Air | shows why EUV needs vacuum: in air the beam dies within a short, exaggerated distance |
| Resist: Positive / Negative / Compare | changes the resist tone; compare shows both side by side with the same exposure |
| Dose | exposure dose; under-exposure and over-exposure change the printed profile |
| Click a part or a label | opens the component panel: a one-line *In plain words* summary, then What it is, What it does, Physics, Chemistry, Equation, What you see, and a *Real science vs. this model* section (established science / simplified here / not shown). Small interactive labs appear where they help: photon energy, diffraction and resolution, resist response, multilayer interference, mask pattern, Beer–Lambert absorption, and a pattern-transfer chart that follows one line pattern from the mask through light, acid, bake, development and etch |
| Deep Science | adds advanced notes, limits of the model and extra equations to every panel |
| Concepts tab | the 12 teaching concepts at Beginner / Intermediate / Advanced, each with a jump to the stage that shows it |
| Quiz tab | 15 questions with explanations |
| Keyboard | `Space` play/pause · `←` `→` stage · `L` labels · `P` optical path · `M` view · `D` deep science · `R` restart · `Esc` close |

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # type-check, production build in dist/, plus dist/standalone.html (one file)
npm run test:e2e     # end-to-end checks against dist/ (see below)
npm run test:standalone   # checks that the single-file builds start and draw the scene
```

The tests use Playwright with Chromium (`PLAYWRIGHT_MODULE` can point at an installed copy; see `tests/lib.mjs`).

`dist/standalone.html` is the whole app inlined into one HTML file that runs from disk or any static host;
`dist/artifact.html` is the same page as a fragment for hosts that wrap pages themselves.
WebGL is required for the 3-D view. Without it, the stage cards, the component panel, the concepts
and the quiz still work and the page says so.

## How it is built

* **The scene is a pure function of the timeline time** (`src/scene/*`). Droplet fates, pulses, particles
  and the wafer transport are evaluated from the clock, with deterministic hash-based randomness, so play,
  pause, scrub, restart and "next stage" always show the same picture for the same time.
* **Optics are built from the actual geometry** (`src/data/layout.ts`): the collector is an ellipsoid with
  the plasma at one focus and the intermediate focus at the other, every mirror normal is computed from
  the law of reflection for the drawn beam path, and after the mask the beam is a bundle of beamlets that
  keeps its orientation through the projection mirrors.
* **The resist cross-section** uses one small model (`src/scene/resistModel.ts`) for both the 3-D slab and
  the charts: aerial image I(x) → acid generation `1 − exp(−k·dose·I)` → electron blur → bake diffusion
  and Hill-type amplification → solubility threshold → developed profile (positive and negative tone are
  complementary) → etch opening where no resist remains.
* **Labels** are DOM elements anchored to 3-D points with leader lines, collision avoidance, a compact
  overview mode and click-through to the component panel (`src/scene/labels.ts`).
* **State** is one small store (`src/store/sim.ts`) read through `useSyncExternalStore`; the panels,
  dock, stage card and the 3-D scene all follow it.
* Content lives in plain data files: `src/data/components.ts` (21 inspectable components with equations,
  variables and units), `concepts.ts` (12 concepts × 3 levels), `quiz.ts`, `stages.ts`, `labels.ts`.
* Chart colours in the resist widgets were checked with a palette validator for the dark panel surface
  (lightness band, colour-vision-deficiency separation and contrast).

## What the checks cover (and what they do not)

`tests/e2e.mjs` drives the production build in headless Chromium with Playwright, using real mouse and
keyboard input and asserting on real state and rendered output: rendering and console errors, selecting
every one of the 11 stages, previous/next, play/pause/restart, scrubber click and drag, speed, labels and
optical-path buttons, whole-machine vs close-up camera, clicking every major component in the 3-D scene,
every stage's labels being on screen and clickable, the six inspector sections for every component,
concepts at three levels, the quiz, the Deep Science toggle, positive/negative/compare resist and dose
changing the 3-D profile, air vs vacuum, determinism after jumps, keyboard shortcuts, a phone-sized layout
(no horizontal scroll, bottom sheet, tapping labels) and the no-WebGL fallback.

Limits you should know about:

* The checks ran on **software-rendered WebGL** (SwiftShader, about 1–2 frames per second), so frame rate on
  a real GPU has **not** been measured here. The per-frame JavaScript cost was measured at a few
  milliseconds; the scene is roughly 70 k triangles and a few hundred draw calls.
* Web fonts are blocked in the test browser, so the layout was verified with the fallback font stack.
* Only Chromium was used. Other browsers and real touch devices were not tested.
* The physics is a teaching approximation; nothing here has been validated against a real scanner.

## Layout of the repository

```
src/data/      stages, components (info panels), concepts, quiz, labels, geometry constants
src/scene/     Three.js scene: source, optics, wafer, resist slab, tracks/etch, labels, picking
src/store/     the simulation store (time, stage, view, tone, dose, selection, panel)
src/ui/        React UI: top bar, stage card, dock/timeline, panel (inspect / concepts / quiz / about), widgets
scripts/       make-standalone.mjs (single-file build)
tests/         end-to-end tests and screenshot helpers (Playwright)
```
