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

**The machine first.** The app opens on the closed machine: a stylised exterior with cabinets for the drive
laser, the EUV source, the illuminator, the reticle (mask) stage, the projection optics and the wafer stage,
plus the separate track and etch tools. Doors, panel seams, fasteners, vents, utility hoses, a base frame,
windows, identification plates and warning markings are modelled to read as industrial equipment. **This is not
ASML CAD data**: the layout is an educational arrangement built from public descriptions, not to scale.
Opening the machine (button, the *Machine: Exterior / Interior* control, `O`, or pressing Play) slides and
fades the panels away to reveal the interior: the source, the illumination and projection optics, the reticle
and wafer stages, and the supporting systems (metrology frame with vibration isolation, vacuum pumps, cooling
circuits, cabling and sensors).

**Exploring a part.** Hover any cabinet or part to highlight it and click it (or its label, or an entry of
the *Explore* tab) to open the **isolated inspection view**: everything else is hidden, the camera glides to the
part, frames it so it never leaves the screen, and turns it slowly (one turn per minute). Assemblies such as
*EUV light source* are inspected whole and list their parts, each of which can be isolated in turn.
Processes (droplets, laser pulses, plasma, EUV light) are shown with the hardware around them. The card shows
the name at once, the breadcrumb (*Machine › subsystem › part*) and the category, then **types** the
explanation in three levels, *Overview → Engineering → Deep science*, one after the other, with a progress bar,
Pause / Resume text, Skip, and level tabs. With *reduced motion* the text appears complete at once.
Switching to another part cancels the old text. The toolbar has Back (to exactly where you were),
Pause / Resume rotation, Reverse, Reset view, Front / Side / Top / Iso, Full notes (the science panel) and
Machine exterior. Dragging rotates the part and pauses the automatic rotation until Resume is pressed;
scroll or pinch zooms; right-drag or a two-finger drag pans.

**The finished wafer, down to one transistor.** At the last stage (etch) the stage card offers **Inspect
finished wafer** (also in the *Explore* tab). The camera glides onto the wafer in the etch tool and crosses over
to a separate multiscale explorer:

| Level | Representation | What you can do |
|---|---|---|
| 1 · Wafer | **physical scale**: 300 mm wafer, notch, scribe lines, a grid of example 12 × 10 mm dies; dies cut by the edge are printed but marked unusable | select any die (complete or partial), slow rotation |
| 2 · Die | **physical scale** in the die plane (feature heights exaggerated): a system-on-chip floorplan with CPU cores, SRAM caches, a graphics block, memory PHY, analog and the I/O ring with bumps | select a block, see its size; logic and SRAM blocks can be opened |
| 3 · Circuit region | **enlarged educational model** of a 4 × 2.6 µm patch: 18 rows of standard cells, a 6T SRAM array with word lines, bit lines and periphery, M1–M3 signal routing, a clock H-tree and the power grid | select and isolate each structure; pick a logic cell |
| 4 · Cell | **enlarged model** of a NAND2 cell built from four **gate-all-around nanosheet** transistors (architecture stated explicitly), with contacts, vias, M0–M3, upper metal, low-k dielectric and passivation | select gates, sheets, gate dielectric, source/drain, spacers, contacts, vias, metal levels, dielectric, wells, substrate |
| 5 · Transistor | one transistor isolated and enlarged, slowly turning | cut along the channel or across the gate, explode the layers, illustrative ON/OFF state |

Moving down a scale dives the camera onto the chosen item, cross-fades, and pulls out of the distance in the next
representation; moving up does the reverse, landing back on the same spot. A zoom-path minimap, a scale bar
("view ≈ 1.2 µm wide, about ×300,000 on screen") and a badge (*physical scale* / *enlarged educational model*)
show where you are. Scroll past the zoom limit over an item (or double-click it) to go a scale deeper, and
scroll back out to rise. The cell and transistor views have Whole / Cut along channel / Cut across gate,
an Explode slider, and a Layers panel (visibility per layer, selection for explanation, material legend).
Every selection shows its name at once and types its three explanation levels with the same typewriter as the
machine explorer. The ON/OFF control moves illustrative carriers and is labelled as such: **no device physics,
current or quantum effect is calculated.** Die size, floorplan and all dimensions are illustrative examples
(typical public values), not a specification of any commercial chip or of anything an ASML machine defines.
Real chips have far more transistors, more metal levels (often 12–20) and structures that vary by process and design.

**The process.** Eleven stages on one timeline (125 s at 1× speed). The first eight happen **inside the scanner**
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
| Play / pause, restart | run the timeline (starts paused on the exterior; playing opens the machine) |
| Machine: Exterior / Interior | close or open the casing, animated (`O`) |
| Click a cabinet, a part or a label | isolated inspection view of that item (see above) |
| Explore tab | the machine as a tree: every subsystem and part, each one opens the isolated view |
| Previous / next stage, stage chips | jump to the start of any of the 11 stages |
| Timeline scrubber | drag or click anywhere; the scene is a pure function of the timeline time, so scrubbing never pops |
| Speed | 0.25×, 0.5×, 1×, 2×, 4× |
| Labels | show / hide the floating labels (leader lines follow the objects) |
| Optical path | show / hide the laser, EUV and diffraction beams |
| Whole machine / Close-up | overview of both zones, or a camera that follows the current stage |
| Chamber: Vacuum / Air | shows why EUV needs vacuum: in air the beam dies within a short, exaggerated distance |
| Resist: Positive / Negative / Compare | changes the resist tone; compare shows both side by side with the same exposure |
| Dose | exposure dose; under-exposure and over-exposure change the printed profile |
| Full notes / Inspect tab | the component panel: a one-line *In plain words* summary, then What it is, What it does, Physics, Chemistry, Equation, What you see, and a *Real science vs. this model* section (established science / simplified here / not shown). Small interactive labs appear where they help: photon energy, diffraction and resolution, resist response, multilayer interference, mask pattern, Beer–Lambert absorption, and a pattern-transfer chart that follows one line pattern from the mask through light, acid, bake, development and etch |
| Deep Science | adds advanced notes, limits of the model and extra equations to every panel |
| Concepts tab | the 12 teaching concepts at Beginner / Intermediate / Advanced, each with a jump to the stage that shows it |
| Quiz tab | 15 questions with explanations |
| Keyboard | `Space` play/pause · `←` `→` stage · `L` labels · `P` optical path · `M` view · `O` open/close casing · `D` deep science · `R` restart · `Esc` leave inspection / close |

## Run it without installing anything

Download [`download/EUV-Lithography-Simulator.html`](download/EUV-Lithography-Simulator.html) (on GitHub: open the
file, then the *Download raw file* button) and double-click it. It is the whole app in one file and runs in
Chrome, Edge, Firefox or Safari straight from disk, with no server, account or internet connection (web fonts
load when online; otherwise the system font is used). It is a copy of `dist/standalone.html` from the last
build and is refreshed by hand (`cp dist/standalone.html download/EUV-Lithography-Simulator.html`).

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
  dock, stage card, the inspection card and the 3-D scene all follow it (casing, inspected id, rotation,
  camera preset all live there).
* **One identity per part.** `src/data/hierarchy.ts` groups the components (`src/data/components.ts`) into
  seven subsystems; the registry (`src/scene/registry.ts`) maps each id to its scene objects, picking
  priority, bounds and isolation roots. The machine view, the explorer, the card and the isolation all resolve
  ids through these two files.
* **The chip explorer** (`src/scene/chip/`, `src/data/chip.ts`) is its own Three.js scene, created on first use.
  The wafer is a textured disc with the dies as one instanced, textured plane; the die pattern is painted from the
  same floorplan data used for picking. The circuit region and the cell are lists of axis-aligned boxes drawn
  with one `InstancedMesh` per material (about 7 000 boxes in ~10 draw calls). Because every part is a box, a
  cross-section is exact (each box is trimmed at the cut, so cut faces are real faces) and exploding, hiding,
  isolating and highlighting are per-instance updates. Camera near/far planes follow the distance, so the same
  camera works from 300 mm down to 1 nm.
* **Isolation uses render layers**, not copies: the inspected objects are switched onto a second layer and
  the camera draws only that layer, so nothing is duplicated and the rest of the scene keeps its state.
  The casing (`src/scene/casing.ts`) and support systems (`src/scene/support.ts`) share merged geometry and
  a handful of materials; casing materials become transparent only while the panels move.
* Content lives in plain data files: `src/data/components.ts` (29 components with engineering notes,
  equations, variables and units), `hierarchy.ts` (subsystems and their three explanation levels),
  `concepts.ts` (12 concepts × 3 levels), `quiz.ts`, `stages.ts`, `labels.ts`.
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

The exploration mode is covered too: the closed exterior at start (cabinet labels only, only cabinets
pickable, hover highlight, cabinet click), the animated open/close, isolation of **every** subsystem and part
(drawn set equals the expected set, framed inside the view, no labels), the hierarchy (no orphans, every item
has its own three explanation levels), dragging pausing the rotation, Resume, Reverse, the four presets, Reset,
Back restoring the camera, assembly children, breadcrumbs, the explorer tab, Machine exterior, and the
typewriter (name first, growing prefix, pause, resume, skip, level tabs without mixing, switching cancels,
automatic advance, independence from the rotation, reduced motion).

The chip explorer has its own tests: reaching it from the last stage (machine no longer drawn), complete and
partial die selection, the dive wafer → die → region → cell with labels and scale, structure isolation,
the geometry counts of the four GAA transistors, clicking gate / gate dielectric / sheets on a cut face, both
cross-sections and the exploded view, layer visibility and selection with distinct metal / via / dielectric
materials, transistor isolation with rotation, drag pause and ON/OFF, zoom clamping at every level and the
scroll-to-dive, returning to the wafer and to the machine, and the phone layout.

Limits you should know about:

* The checks ran on **software-rendered WebGL** (SwiftShader, about 1–2 frames per second), so frame rate on
  a real GPU has **not** been measured here. Measured per-frame cost (JavaScript + draw submission): about
  4–6 ms for the closed exterior (≈400 draw calls, 190 k triangles), 3–6 ms for the open interior (≈280 calls,
  120 k triangles), 1–2 ms in the isolated view (8–120 calls). Forty inspect/Back cycles left the number of
  textures unchanged; geometries rise once (386 → 416, meshes first built on demand) and then stay flat over repeated rounds.
  In the software renderer the first frames after opening or closing the casing stall for seconds while it
  builds pipelines for the new blend state; the shader variants are compiled at start-up to keep this short on
  real GPUs, but that has not been verified on hardware.
* Web fonts are blocked in the test browser, so the layout was verified with the fallback font stack.
* Only Chromium was used. Other browsers and real touch devices were not tested.
* The physics is a teaching approximation; nothing here has been validated against a real scanner.

## Layout of the repository

```
src/data/      stages, components (info panels), concepts, quiz, labels, geometry constants
src/scene/     Three.js scene: casing, support systems, source, optics, wafer, resist slab, tracks/etch, labels, picking
src/scene/chip/  finished wafer and chip explorer: wafer model, box models (circuit region, NAND2 cell), transitions
src/store/     the simulation store (time, stage, view, tone, dose, selection, panel)
src/ui/        React UI: top bar, stage card, exterior + inspection cards (Explore.tsx), chip explorer (Chip.tsx), dock/timeline, panel, widgets
scripts/       make-standalone.mjs (single-file build)
tests/         end-to-end tests and screenshot helpers (Playwright)
```
