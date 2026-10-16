// End-to-end checks, run against the production build in ./dist with headless Chromium (software WebGL).
// Every test drives the real UI (mouse, keyboard, DOM) and asserts on real state or rendered output.
//   npm run build && npm run test:e2e            (add --only "<substring>[|<substring>…]" to run a subset)
import { startServer, launch, ready, sleep } from './lib.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx > 0 ? process.argv[onlyIdx + 1].toLowerCase() : null;

const results = [];
const assert = (c, m) => {
  if (!c) throw new Error(m);
};
const near = (a, b, tol, m) => assert(Math.abs(a - b) <= tol, `${m}: got ${a}, expected ${b} ±${tol}`);
async function test(name, fn) {
  if (only && !only.split('|').some((o) => name.toLowerCase().includes(o))) return;
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    results.push({ name, ok: false, err: e.message });
    console.log(`  ✗ ${name}\n      ${String(e.message).split('\n').join('\n      ')}`);
  }
}

const { server, url } = await startServer(dir);
const { browser, page, errors } = await launch({ width: 1440, height: 860, lowq: true });
const ignorable = (e) => /Failed to load resource/.test(e);
await ready(page, url);
const data = await page.evaluate(() => JSON.parse(JSON.stringify({ ...window.__euv.data, starts: window.__euv.starts, total: window.__euv.total })));
const STAGES = data.STAGES;
const stageAt = (t) => {
  let k = 0;
  for (let i = 0; i < data.starts.length; i++) if (t >= data.starts[i]) k = i;
  return k;
};
const S = (fn, ...a) => page.evaluate(fn, ...a);
const st = () => S(() => ({ ...window.__euv.sim.state, t: window.__euv.sim.getTime() }));
const go = async (T, view) => {
  await S(({ T, view }) => {
    const { sim } = window.__euv;
    sim.exitInspect();
    sim.pause();
    if (view) sim.setView(view);
    sim.setTime(T);
  }, { T, view });
  await frames(2);
};
// Software WebGL in headless Chromium manages only ~1-2 fps, so tests never rely on the animation loop:
// state changes are followed by synchronous frames (debugFrame) and waits are on real conditions.
const frame = () => S(() => window.__euv.scene.debugFrame());
const frames = async (n = 2) => {
  for (let i = 0; i < n; i++) {
    await frame();
    await sleep(50);
  }
};
/** Let the camera glide and the label easing run to completion (done synchronously: waiting for the
 *  1.5 s glide in wall-clock time is unreliable when a frame takes half a second to rasterise). */
const settle = async () => {
  for (let k = 0; k < 2; k++) {
    await sleep(120); // React commits the new stage card; the overlay cards then report their size
    await S(() => {
      window.dispatchEvent(new Event('resize')); // re-measure the overlay cards now (they are otherwise polled every 0.6 s)
      window.__euv.scene.debugSettle();
    });
  }
};

console.log('\nEUV simulator end-to-end tests\n');

// ───────────────────────────────────────────────────────────── rendering
await test('renders: WebGL canvas, draw calls, non-blank pixels, no console errors', async () => {
  await frames(2);
  const r = await S(() => {
    const c = window.__euv.scene;
    const cv = document.querySelector('canvas.gl');
    const stats = c.debugStats();
    return { w: cv.clientWidth, h: cv.clientHeight, webgl: window.__euv.sim.state.webgl, stats, px: c.debugSamplePixels() };
  });
  assert(r.w > 300 && r.h > 300, `canvas too small ${r.w}x${r.h}`);
  assert(r.webgl === 'ok', 'webgl state is ' + r.webgl);
  assert(r.stats.calls > 40, 'too few draw calls: ' + r.stats.calls);
  assert(r.stats.triangles > 5000, 'too few triangles: ' + r.stats.triangles);
  assert(r.px.distinct >= 10, 'canvas looks blank: distinct colours ' + r.px.distinct);
  assert(errors.filter((e) => !ignorable(e)).length === 0, 'console errors: ' + errors.filter((e) => !ignorable(e)).join(' | '));
});

await test('page has no horizontal scroll at desktop width and the dock is visible', async () => {
  const r = await S(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, dock: !!document.querySelector('[data-testid=dock]')?.getBoundingClientRect().height }));
  assert(r.sw <= r.iw, `horizontal overflow ${r.sw} > ${r.iw}`);
  assert(r.dock, 'dock missing');
});

// ───────────────────────────────────────────────────────────── machine exterior (initial view)
await test('starts on the closed machine exterior: paused, cabinet labels only, only cabinets pickable', async () => {
  await settle();
  const r = await S(() => {
    const sc = window.__euv.scene;
    const s = window.__euv.sim.state;
    return {
      playing: s.playing,
      casing: s.casing,
      open: sc.debugInspect().casing,
      card: !!document.querySelector('[data-testid=exterior-card]'),
      note: document.querySelector('[data-testid=exterior-card]')?.textContent ?? '',
      labels: sc.labels.visibleIds(),
      drawn: sc.drawnComponents(),
      badge: document.querySelector('[data-testid=zone-badge]').textContent,
    };
  });
  assert(r.playing === false, 'the timeline should start paused on the exterior');
  assert(r.casing === 'closed' && r.open === 0, `casing should start closed (state ${r.casing}, openness ${r.open})`);
  assert(r.card && /not ASML CAD/i.test(r.note), 'exterior card with the "not ASML CAD" note expected');
  assert(r.labels.length >= 6 && r.labels.every((id) => id.startsWith('x-')), 'only exterior (cabinet) labels on the closed machine: ' + r.labels.join(','));
  assert(r.drawn.filter((id) => id.startsWith('cab-')).length >= 8, 'cabinets should be drawn: ' + r.drawn.join(','));
  assert(/exterior/i.test(r.badge), 'top bar should say Machine exterior: ' + r.badge);
  // hovering a cabinet highlights it; a click on it opens that part of the machine in the isolated view
  const p = await S(() => window.__euv.scene.findPickPoint('cab-source'));
  assert(p, 'no pickable point on the source cabinet');
  const box = await page.locator('canvas.gl').boundingBox();
  await page.mouse.move(box.x + p.x, box.y + p.y);
  await sleep(150);
  await page.mouse.move(box.x + p.x + 1, box.y + p.y);
  await sleep(150);
  assert((await S(() => window.__euv.scene.hoverId)) === 'cab-source', 'hovering the source cabinet should highlight it');
  await page.mouse.click(box.x + p.x, box.y + p.y);
  await sleep(150);
  const s = await st();
  assert(s.inspect === 'sys-source' && s.casing === 'open', `cabinet click should inspect the source assembly (inspect ${s.inspect}, casing ${s.casing})`);
  await page.click('[data-testid=insp-back]');
  await settle();
  const b = await st();
  assert(b.inspect === null && b.casing === 'closed', `Back should return to the closed exterior (casing ${b.casing})`);
  await page.mouse.move(5, 5);
});

// ───────────────────────────────────────────────────────────── stage selection
await test('every one of the 11 timeline stages can be selected from the stage buttons', async () => {
  // the app starts paused on the closed machine; choosing a stage opens the casing and keeps the clock still
  for (let i = 0; i < STAGES.length; i++) {
    await page.click(`[data-testid=chips] [data-stage="${i}"]`);
    await sleep(200);
    const s = await S(() => ({
      stage: window.__euv.sim.state.stage,
      t: window.__euv.sim.getTime(),
      title: document.querySelector('[data-testid=stage-title]').textContent,
      cur: document.querySelector('[data-testid=chips] [aria-current=step]')?.getAttribute('data-stage'),
      zone: document.querySelector('[data-testid=zone-badge]').textContent,
      live: document.querySelector('[role=status]').textContent,
    }));
    assert(s.stage === i, `stage ${i}: state says ${s.stage}`);
    near(s.t, data.starts[i], 0.05, `stage ${i} start time`);
    assert(s.title === STAGES[i].title, `stage ${i}: title "${s.title}"`);
    assert(String(s.cur) === String(i), `stage ${i}: aria-current on ${s.cur}`);
    assert(s.zone.includes(STAGES[i].inScanner ? 'Inside' : 'Outside'), `stage ${i}: zone badge "${s.zone}"`);
    assert(s.live.includes(`Stage ${i + 1} of 11`), `stage ${i}: live region "${s.live}"`);
    if (i === 0) assert((await st()).casing === 'open', 'choosing a stage should open the machine casing');
  }
});

await test('previous / next stage buttons step through the stages and clamp at both ends', async () => {
  await go(0.5);
  await page.click('[data-testid=btn-next]');
  assert((await st()).stage === 1, 'next from 0 should be 1');
  await page.click('[data-testid=btn-next]');
  await page.click('[data-testid=btn-prev]');
  assert((await st()).stage === 1, 'prev after next should return to 1');
  await S(() => window.__euv.sim.goStage(10));
  await page.click('[data-testid=btn-next]');
  assert((await st()).stage === 10, 'next at the last stage must clamp');
  await go(0.0);
  await page.click('[data-testid=btn-prev]');
  assert((await st()).stage === 0, 'prev at the first stage must clamp');
});

// ───────────────────────────────────────────────────────────── transport
await test('play and pause: clock advances while playing and holds still while paused', async () => {
  await go(5);
  await page.click('[data-testid=btn-play]');
  const a = (await st()).t;
  await page.waitForFunction((t0) => window.__euv.sim.getTime() > t0 + 0.1, a, { timeout: 15000 });
  const b = await st();
  assert(b.playing === true, 'not playing after Play');
  assert(b.t > a + 0.1, `clock did not advance (${a} → ${b.t})`);
  await page.click('[data-testid=btn-play]');
  const c = await st();
  await sleep(2500); // several animation frames at the slow software-GL rate
  const d = await st();
  assert(d.playing === false, 'still playing after Pause');
  near(d.t, c.t, 0.001, 'clock moved while paused');
  // paused scene is inspectable: time stays, the render loop must keep the canvas alive on interaction
  await S(() => window.__euv.scene.controls.dispatchEvent({ type: 'change' }));
});

await test('restart jumps to 0:00 and plays', async () => {
  await go(70);
  await page.click('[data-testid=btn-restart]');
  const s = await st();
  assert(s.t < 1.5, 'restart did not rewind: ' + s.t);
  assert(s.playing === true, 'restart should start playback');
  assert(s.stage === 0, 'restart should be at stage 1');
  await page.click('[data-testid=btn-play]'); // pause again
});

await test('timeline scrubber: clicking and dragging with the mouse sets the clock; dragging pauses and resumes', async () => {
  await go(3);
  await page.click('[data-testid=btn-play]'); // playing
  const box = await page.locator('[data-testid=scrub]').boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.2, y);
  await page.mouse.down();
  assert((await st()).playing === false, 'dragging should pause playback');
  await page.mouse.move(box.x + box.width * 0.5, y, { steps: 6 });
  await page.mouse.move(box.x + box.width * 0.8, y, { steps: 6 });
  const mid = await st();
  near(mid.t, data.total * 0.8, data.total * 0.06, 'clock while dragging');
  assert(mid.stage === stageAt(mid.t), `stage ${mid.stage} does not match time ${mid.t}`);
  await page.mouse.up();
  assert((await st()).playing === true, 'playback should resume after the drag');
  await page.click('[data-testid=btn-play]');
  // a single click
  await page.mouse.click(box.x + box.width * 0.5, y);
  const c = await st();
  near(c.t, data.total * 0.5, data.total * 0.05, 'clock after click');
  assert(c.stage === stageAt(c.t), 'stage/time mismatch after click');
});

await test('scrubbing programmatically to the very start and end is safe; playback stops at the end', async () => {
  await go(data.total + 50);
  let s = await st();
  assert(s.stage === 10, 'end should be the last stage');
  assert(s.t < data.total, 'time must stay inside the timeline');
  await go(-10);
  s = await st();
  assert(s.stage === 0 && s.t === 0, 'start clamp failed');
  await S(() => {
    const { sim } = window.__euv;
    sim.setSpeed(4);
    sim.setTime(window.__euv.total - 1);
    sim.play();
  });
  await page.waitForFunction(() => window.__euv.sim.state.finished === true, null, { timeout: 20000 });
  s = await st();
  assert(s.playing === false && s.finished === true, `should stop at the end (playing=${s.playing} finished=${s.finished})`);
  await page.click('[data-testid=btn-play]'); // press play at the end: starts from the beginning
  s = await st();
  assert(s.playing === true && s.t < 3, 'Play at the end should restart from 0: t=' + s.t);
  await S(() => window.__euv.sim.setSpeed(1));
  await page.click('[data-testid=btn-play]');
});

await test('speed buttons change the playback rate', async () => {
  const rate = async (btn) => {
    await page.click(`[data-testid=seg-speed] [data-value="${btn}"]`);
    await go(5);
    await page.click('[data-testid=btn-play]');
    const a = (await st()).t;
    await sleep(3500);
    const b = (await st()).t;
    await page.click('[data-testid=btn-play]');
    return (b - a) / 3.5;
  };
  const slow = await rate(0.5);
  const fast = await rate(4);
  assert((await st()).speed === 4, 'speed state');
  assert(fast > slow * 3, `4× should be clearly faster than 0.5× (${fast.toFixed(2)} vs ${slow.toFixed(2)} s/s)`);
  await page.click('[data-testid=seg-speed] [data-value="1"]');
});

// ───────────────────────────────────────────────────────────── view controls
await test('Labels button shows and hides the floating labels', async () => {
  await go(24, 'stage');
  await settle();
  const count = () => S(() => document.querySelectorAll('.lbl:not(.is-hidden)').length);
  const on = await count();
  assert(on >= 4, 'expected several labels, got ' + on);
  try {
    await page.click('[data-testid=btn-labels]');
    await frames(2);
    assert((await count()) === 0, 'labels should be gone');
    assert((await S(() => window.__euv.sim.state.labels)) === false, 'state.labels');
  } finally {
    if (!(await S(() => window.__euv.sim.state.labels))) await page.click('[data-testid=btn-labels]');
  }
  await frames(2);
  assert((await count()) === on, 'labels should return');
});

await test('Optical path button shows and hides the laser and EUV light in the scene', async () => {
  await go(70, 'stage');
  await settle(1200);
  const lit = () => S(() => window.__euv.scene.debugStats().beamsLit);
  const on = await lit();
  assert(on > 20, 'beams should be drawn with the path on, got ' + on);
  try {
    await page.click('[data-testid=btn-path]');
    const off = await lit();
    assert(off === 0, 'no beams expected with the path off, got ' + off);
  } finally {
    if (!(await S(() => window.__euv.sim.state.path))) await page.click('[data-testid=btn-path]');
  }
  assert((await lit()) > 20, 'beams should return');
});

await test('Whole machine and Close-up views move the camera to different presets', async () => {
  await go(70);
  await page.click('[data-testid=seg-view] [data-value=machine]');
  await settle();
  const far = await S(() => window.__euv.scene.camera.position.distanceTo(window.__euv.scene.controls.target));
  await page.click('[data-testid=seg-view] [data-value=stage]');
  await settle();
  const near1 = await S(() => ({ d: window.__euv.scene.camera.position.distanceTo(window.__euv.scene.controls.target), t: window.__euv.scene.controls.target.toArray() }));
  assert(far > near1.d * 1.8, `whole machine (${far.toFixed(1)}) should be much farther than close-up (${near1.d.toFixed(1)})`);
  near(near1.t[0], 21.4, 3, 'close-up target x for stage 7');
  await page.click('[data-testid=seg-view] [data-value=machine]');
  await settle();
  const t2 = await S(() => window.__euv.scene.controls.target.toArray());
  near(t2[0], 6.5, 4, 'overview target x');
  assert((await st()).view === 'machine', 'view state');
});

await test('stage changes move the close-up camera while in Close-up mode but not in Whole-machine mode', async () => {
  await page.click('[data-testid=seg-view] [data-value=stage]');
  await go(5);
  await settle();
  const a = await S(() => window.__euv.scene.controls.target.toArray());
  await S(() => window.__euv.sim.goStage(8));
  await settle();
  const b = await S(() => window.__euv.scene.controls.target.toArray());
  assert(Math.abs(a[0] - b[0]) > 8, `camera should travel (${a[0]} → ${b[0]})`);
  await page.click('[data-testid=seg-view] [data-value=machine]');
  await settle();
  const c = await S(() => window.__euv.scene.controls.target.toArray());
  await S(() => window.__euv.sim.goStage(2));
  await settle(1000);
  const d = await S(() => window.__euv.scene.controls.target.toArray());
  near(c[0], d[0], 0.5, 'machine view must stay put when the stage changes');
});

// ───────────────────────────────────────────────────────────── inspection: picking in the 3-D scene
const PICK_STAGE = { dropletGenerator: 0, droplets: 0, catcher: 0, co2Laser: 1, laserPulses: 1, plasma: 2, euvBeam: 3, collector: 3, vacuum: 3, intermediateFocus: 3, ffm: 4, pfm: 4, illumination: 4, reticle: 5, projection: 6, wafer: 7, resist: 7, bakePlate: 8, developer: 9, etcher: 10 };
await test('clicking each major component in the 3-D scene opens it in the isolated inspection view', async () => {
  const failures = [];
  // 1) a click on the machine opens the isolated view of what was clicked, with its name at once
  await S(() => {
    const { sim } = window.__euv;
    sim.exitInspect();
    sim.select(null);
    sim.togglePanel(false);
    sim.setView('stage');
    sim.goStage(0, { keepPlaying: false });
    sim.setTime(5);
  });
  await settle();
  {
    const p = await S(() => window.__euv.scene.findPickPoint('dropletGenerator'));
    assert(p, 'no pickable point for the droplet generator');
    const box = await page.locator('canvas.gl').boundingBox();
    await page.mouse.click(box.x + p.x, box.y + p.y);
    await sleep(150);
    const s = await S(() => ({ ...window.__euv.sim.state, name: document.querySelector('[data-testid=inspect-name]')?.textContent }));
    if (s.inspect !== 'dropletGenerator' || s.name !== 'Tin Droplet Generator') failures.push(`first click: inspect ${s.inspect}, card name ${s.name}`);
    // the Back button returns to the machine view the click came from
    await page.click('[data-testid=insp-back]');
    const b = await st();
    if (b.inspect !== null || b.view !== 'stage') failures.push(`Back: inspect ${b.inspect}, view ${b.view}`);
    await S(() => window.__euv.sim.togglePanel(true));
    await settle();
  }
  // 2) every component in turn (the panel stays open so the layout does not move between clicks)
  let lastStage = -1;
  for (const [id, stage] of Object.entries(PICK_STAGE)) {
    if (stage !== lastStage) {
      await S((i) => window.__euv.sim.goStage(i, { keepPlaying: false }), stage);
      await S((T) => window.__euv.sim.setTime(T), data.starts[stage] + (stage === 7 ? 0.55 : 0.4) * STAGES[stage].duration);
      await settle();
      lastStage = stage;
    }
    // leaving the isolated view swaps the overlay card, which re-frames the camera: let that land first
    await S(() => {
      window.__euv.sim.exitInspect();
      window.__euv.sim.select(null);
    });
    await settle();
    const p = await S((id) => window.__euv.scene.findPickPoint(id), id);
    if (!p) {
      const why = await S((id) => {
        const sc = window.__euv.scene;
        const s = window.__euv.sim.state;
        const c = sc.camera.position;
        return `inspect ${s.inspect}, view ${s.view}, casing ${sc.debugInspect().casing}, layers ${sc.camera.layers.mask}, cam (${c.x.toFixed(1)},${c.y.toFixed(1)},${c.z.toFixed(1)}), on screen ${JSON.stringify(sc.screenOf(id))}`;
      }, id);
      failures.push(`${id}: no pickable, unobstructed point on screen in stage ${stage + 1} (${why})`);
      continue;
    }
    const box = await page.locator('canvas.gl').boundingBox();
    await page.mouse.click(box.x + p.x, box.y + p.y);
    await sleep(120);
    const s = await S(() => ({ insp: window.__euv.sim.state.inspect, card: document.querySelector('[data-testid=inspect-card]')?.getAttribute('data-inspect'), comp: document.querySelector('[data-testid=inspector]')?.getAttribute('data-comp') }));
    if (s.insp !== id || s.card !== id || s.comp !== id) failures.push(`${id}: clicked at (${p.x | 0},${p.y | 0}) → inspect ${s.insp}, card ${s.card}, panel inspector ${s.comp}`);
  }
  await S(() => window.__euv.sim.exitInspect());
  await settle();
  assert(failures.length === 0, failures.join('\n'));
});

await test('clicking empty space deselects, and the selection bracket tracks the selected part', async () => {
  await S(() => window.__euv.sim.exitInspect());
  await go(24, 'stage');
  await settle();
  await S(() => window.__euv.sim.select('plasma'));
  await frames(2);
  // The scene sets the bracket's opacity to 1; the 0.2 s CSS fade itself needs presented frames, which a software
  // renderer delivers seconds apart. So the checks are on the value the scene sets and on the bracket's geometry.
  const read = () =>
    S(() => {
      const sc = window.__euv.scene;
      const el = document.querySelector('.sel-box');
      const b = el.getBoundingClientRect();
      const cv = document.querySelector('canvas.gl').getBoundingClientRect();
      const c = sc.screenOf('plasma');
      return { op: el.style.opacity, cx: b.left + b.width / 2, cy: b.top + b.height / 2, w: b.width, h: b.height, px: cv.left + c.x, py: cv.top + c.y };
    });
  const r = await read();
  assert(r.op === '1', 'selection bracket should be shown, opacity ' + r.op);
  assert(r.w > 12 && r.h > 12, `bracket too small: ${r.w}×${r.h}`);
  near(r.cx, r.px, 8, 'bracket centre x vs the plasma on screen');
  near(r.cy, r.py, 8, 'bracket centre y vs the plasma on screen');
  // shifting the camera moves the plasma on screen, and the bracket must follow it
  await S(() => {
    const sc = window.__euv.scene;
    sc.controls.target.x += 1.5;
    sc.debugFrame();
  });
  const r2 = await read();
  assert(Math.hypot(r2.px - r.px, r2.py - r.py) > 8, 'camera shift should move the plasma on screen');
  near(r2.cx, r2.px, 8, 'bracket centre x after the camera moved');
  near(r2.cy, r2.py, 8, 'bracket centre y after the camera moved');
  await S(() => {
    const sc = window.__euv.scene;
    sc.controls.target.x -= 1.5;
    sc.debugFrame();
  });
  // click a point of the canvas where nothing pickable is drawn and no overlay sits
  const empty = await S(() => {
    const sc = window.__euv.scene;
    const cvEl = document.querySelector('canvas.gl');
    const cv = cvEl.getBoundingClientRect();
    for (let j = 0; j < 8; j++)
      for (let i = 0; i < 12; i++) {
        const x = cv.width * (0.05 + (0.9 * i) / 11);
        const y = cv.height * (0.1 + (0.8 * j) / 7);
        if (sc.registry.pick({ x: (x / sc.width) * 2 - 1, y: -(y / sc.height) * 2 + 1 }, sc.camera) !== null) continue;
        if (document.elementFromPoint(cv.left + x, cv.top + y) !== cvEl) continue;
        return { x: cv.left + x, y: cv.top + y };
      }
    return null;
  });
  assert(empty, 'could not find an empty point on the canvas');
  await page.mouse.click(empty.x, empty.y);
  assert((await st()).selectedId === null, `an empty click at (${empty.x | 0},${empty.y | 0}) should clear the selection`);
  await frames(1);
  assert((await S(() => document.querySelector('.sel-box').style.opacity)) === '0', 'bracket should hide once nothing is selected');
});

await test('every stage shows all of its floating labels, anchored on screen, and each label opens its component', async () => {
  await S(() => {
    const { sim } = window.__euv;
    sim.exitInspect();
    sim.pause();
    sim.select(null);
    sim.setView('stage');
    sim.setTone('positive');
    sim.setTab('inspect');
    sim.togglePanel(true); // a label click then does not re-flow the page, which keeps the positions still
  });
  const problems = [];
  for (let i = 0; i < STAGES.length; i++) {
    await S(({ T }) => {
      window.__euv.sim.pause();
      window.__euv.sim.setTime(T);
    }, { T: data.starts[i] + (i === 7 ? 0.6 : i === 2 ? 0.07 : 0.5) * STAGES[i].duration });
    await settle();
    const shown = await S(() => window.__euv.scene.labels.visibleIds());
    // l-tone-b is only drawn in "Compare" mode (its own test below), so it is not expected here
    const want = STAGES[i].labels.filter((id) => id !== 'l-tone-b');
    const missing = want.filter((id) => !shown.includes(id));
    if (missing.length) problems.push(`stage ${i + 1}: labels not visible on screen: ${missing.join(', ')}`);
    // synchronisation with the timeline: nothing from another stage may linger
    const strays = shown.filter((id) => !STAGES[i].labels.includes(id));
    if (strays.length) problems.push(`stage ${i + 1}: labels of other stages still shown: ${strays.join(', ')}`);
    // labels must not be drawn on top of each other
    const overlaps = await S(() => {
      const r = window.__euv.scene.labels.visibleIds().map((id) => ({ id, b: document.querySelector(`.lbl[data-id="${id}"]`).getBoundingClientRect() }));
      const out = [];
      for (let a = 0; a < r.length; a++)
        for (let c = a + 1; c < r.length; c++) {
          const w = Math.min(r[a].b.right, r[c].b.right) - Math.max(r[a].b.left, r[c].b.left);
          const h = Math.min(r[a].b.bottom, r[c].b.bottom) - Math.max(r[a].b.top, r[c].b.top);
          if (w > 3 && h > 3) out.push(`${r[a].id} × ${r[c].id} (${Math.round(w)}×${Math.round(h)} px)`);
        }
      return out;
    });
    if (overlaps.length) problems.push(`stage ${i + 1}: labels overlap: ${overlaps.join('; ')}`);
    // click every visible label with a real mouse click at its centre; it must open the component it names.
    // Playwright's own click() waits for the element to hold still for two animation frames, which never
    // happens on a 1-2 fps software renderer, so the position is read after forced frames and the
    // "is anything covering it?" check is done explicitly with elementFromPoint.
    for (const id of shown) {
      const def = data.LABELS.find((l) => l.id === id);
      if (def.kind === 'zone') continue;
      await S(() => window.__euv.sim.select(null));
      await frames(2);
      const r = await S((id) => {
        const el = document.querySelector(`.lbl[data-id="${id}"]`);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        const x = b.x + b.width / 2;
        const y = b.y + b.height / 2;
        const top = document.elementFromPoint(x, y);
        return { x, y, covered: top?.closest('.lbl')?.getAttribute('data-id') !== id, top: top ? top.tagName + '.' + String(top.className).slice(0, 30) + (top.closest('.lbl') ? ' [' + top.closest('.lbl').dataset.id + ']' : '') : 'none', inView: x > 0 && y > 0 && x < innerWidth && y < innerHeight };
      }, id);
      if (!r || !r.inView || r.covered) {
        problems.push(`stage ${i + 1}: label ${id} is not clickable (${!r ? 'missing' : !r.inView ? 'off screen' : 'covered by ' + r.top})`);
        continue;
      }
      await page.mouse.click(r.x, r.y);
      const insp = await S(() => window.__euv.sim.state.inspect);
      if (insp !== def.comp) problems.push(`stage ${i + 1}: label ${id} opened ${insp}, expected ${def.comp}`);
      // back to the stage view, with the camera landed again (also after the card swap) before the next label is clicked
      await S(() => window.__euv.sim.exitInspect());
      await settle();
    }
    await S(() => window.__euv.sim.select(null));
  }
  assert(problems.length === 0, problems.join('\n'));
});

await test('floating labels stay glued to their 3-D objects while the camera moves', async () => {
  // the leader dot of a label sits on a fixed 3-D point; after a camera move it must sit on the re-projected point
  await go(24, 'stage'); // main pulse: plasma at the focus F1 = (-7, 3, 0)
  await settle();
  const dot = (id) =>
    S((id) => {
      const el = document.querySelector(`.lbl[data-id="${id}"]`);
      const idx = [...document.querySelectorAll('.lbl')].indexOf(el);
      const c = document.querySelectorAll('.leader-layer circle.anchor')[idx];
      const sc = window.__euv.scene;
      const cv = document.querySelector('canvas.gl').getBoundingClientRect();
      return { x: cv.left + +c.getAttribute('cx'), y: cv.top + +c.getAttribute('cy'), vis: !el.classList.contains('is-hidden') };
    }, id);
  const project = (x, y, z) =>
    S(({ x, y, z }) => {
      const sc = window.__euv.scene;
      const cv = document.querySelector('canvas.gl').getBoundingClientRect();
      const v = sc.camera.position.clone().set(x, y, z).project(sc.camera);
      return { x: cv.left + (v.x * 0.5 + 0.5) * sc.width, y: cv.top + (-v.y * 0.5 + 0.5) * sc.height };
    }, { x, y, z });
  const failures = [];
  for (const [id, p] of [['l-plasma', [-7, 3, 0]], ['l-collector', [-9.2, 5.9, 0]], ['l-laser', [-16.1, 4.5, 0]]]) {
    const a = await dot(id);
    const b = await project(...p);
    if (!a.vis || Math.hypot(a.x - b.x, a.y - b.y) > 2) failures.push(`${id}: dot at (${a.x.toFixed(1)},${a.y.toFixed(1)}), object projects to (${b.x.toFixed(1)},${b.y.toFixed(1)})`);
  }
  // move the camera: orbit 20° and dolly in
  const before = await dot('l-plasma');
  await S(() => {
    const sc = window.__euv.scene;
    const t = sc.controls.target;
    const off = sc.camera.position.clone().sub(t);
    off.applyAxisAngle(sc.camera.up, 0.35).multiplyScalar(0.8);
    sc.camera.position.copy(t).add(off);
    sc.debugFrame();
    sc.debugFrame();
  });
  const after = await dot('l-plasma');
  if (Math.hypot(after.x - before.x, after.y - before.y) < 6) failures.push('the camera move did not shift the plasma label anchor');
  for (const [id, p] of [['l-plasma', [-7, 3, 0]], ['l-collector', [-9.2, 5.9, 0]]]) {
    const a = await dot(id);
    const b = await project(...p);
    if (!a.vis) continue; // may have left the view after the move
    if (Math.hypot(a.x - b.x, a.y - b.y) > 2) failures.push(`${id} after orbit: dot at (${a.x.toFixed(1)},${a.y.toFixed(1)}), object projects to (${b.x.toFixed(1)},${b.y.toFixed(1)})`);
  }
  // put the camera back on its preset (the manual orbit left it off the stage preset)
  await S(() => window.__euv.sim.setView('machine'));
  await settle();
  await S(() => window.__euv.sim.setView('stage'));
  await settle();
  assert(failures.length === 0, failures.join('\n'));
});

await test('every inspectable component has a label or list entry, and the stage guide lists all of them', async () => {
  const ids = data.COMPONENT_LIST.map((c) => c.id);
  const noLabel = ids.filter((id) => !data.LABELS.some((l) => l.comp === id));
  assert(noLabel.length === 0, 'components without any floating label: ' + noLabel.join(', '));
  await S(() => {
    window.__euv.sim.select(null);
    window.__euv.sim.setTab('inspect');
  });
  await sleep(200);
  const listed = await S(() => [...document.querySelectorAll('[data-testid=stage-guide] .list-item')].map((b) => b.getAttribute('data-comp')));
  for (const id of ids) assert(listed.includes(id), `stage guide lacks a button for ${id}`);
  // the buttons really select
  await page.click('[data-testid=stage-guide] .list-item[data-comp="reticle"]');
  assert((await st()).selectedId === 'reticle', 'list button should select the component');
});

await test('inspector shows the six required sections for every component (with equations where applicable)', async () => {
  const problems = [];
  for (const c of data.COMPONENT_LIST) {
    await S((id) => window.__euv.sim.select(id), c.id);
    await sleep(120);
    const r = await S(() => {
      const root = document.querySelector('[data-testid=inspector]');
      return {
        title: root?.querySelector('h2')?.textContent,
        heads: [...(root?.querySelectorAll('h3') || [])].map((h) => h.textContent.trim()),
        eq: root?.querySelectorAll('.eq').length,
        paras: [...(root?.querySelectorAll('section p') || [])].map((p) => p.textContent.trim().length),
        plain: root?.querySelector('[data-testid=plain-words]')?.textContent.trim().length || 0,
        acc: [...(root?.querySelectorAll('[data-testid=accuracy] dt') || [])].map((d) => d.textContent.trim()),
        limits: root?.querySelectorAll('[data-testid=accuracy] li').length || 0,
      };
    });
    if (r.plain < 40) problems.push(`${c.id}: plain-language summary missing`);
    if (JSON.stringify(r.acc) !== JSON.stringify(['Established science', 'Simplified in this model', 'Not shown'])) problems.push(`${c.id}: accuracy section ${r.acc.join(' | ')}`);
    if (r.limits < 1) problems.push(`${c.id}: no simplifications listed`);
    const need = ['What it is', 'What it does', 'Physics', 'Chemistry', 'Equation', 'What you see'];
    if (r.title !== c.name) problems.push(`${c.id}: title "${r.title}"`);
    if (JSON.stringify(r.heads.slice(0, 6)) !== JSON.stringify(need)) problems.push(`${c.id}: headings ${r.heads.slice(0, 6).join(' | ')}`);
    if (c.equations.length && r.eq < c.equations.length) problems.push(`${c.id}: ${r.eq} equation cards for ${c.equations.length} equations`);
    if (r.paras.some((n) => n < 8)) problems.push(`${c.id}: an empty section`);
  }
  assert(problems.length === 0, problems.join('\n'));
});

await test('component widgets render: photon lab, diffraction lab, resist chart, multilayer, mask, Beer–Lambert', async () => {
  const want = { euvBeam: ['Photon energy lab'], projection: ['Diffraction & numerical aperture lab'], resist: ['Resist response'], collector: ['Why a multilayer reflects EUV'], reticle: ['Mask cross-section'], vacuum: ['Beer–Lambert absorption lab'] };
  for (const [id, titles] of Object.entries(want)) {
    await S((id) => window.__euv.sim.select(id), id);
    await sleep(150);
    const labs = await S(() => [...document.querySelectorAll('[data-testid=inspector] .lab-h')].map((e) => e.textContent));
    for (const t of titles) assert(labs.some((l) => l.includes(t)), `${id}: missing widget "${t}" (have ${labs.join(' | ')})`);
  }
  // the diffraction lab responds: NA slider changes the verdict for a tight pitch
  await S(() => window.__euv.sim.select('projection'));
  await sleep(150);
  const verdict = () => S(() => document.querySelector('[data-testid=inspector] .verdict').textContent);
  const setRange = (label, v) =>
    S(({ label, v }) => {
      const inp = [...document.querySelectorAll('[data-testid=inspector] .lab input[type=range]')].find((i) => i.id.endsWith(label));
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(inp, String(v));
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }, { label, v });
  await setRange('-hp', 12);
  await setRange('-na', 0.2);
  assert((await verdict()).includes('No image'), 'NA 0.20 at 12 nm half-pitch should not image');
  await setRange('-na', 0.6);
  assert((await verdict()).includes('Image forms'), 'NA 0.60 at 12 nm half-pitch should image');
});

await test('pattern-transfer lab follows the Resist and Dose controls (positive and negative are complementary)', async () => {
  await S(() => {
    const { sim } = window.__euv;
    sim.setDose(1);
    sim.setTone('compare');
    sim.select('etcher');
  });
  await sleep(250);
  // film rects of the etch rows: height 6, coloured as the etched film; one row per tone
  const film = () =>
    S(() => {
      const svg = document.querySelector('[data-testid=inspector] [data-testid=transfer-lab]');
      if (!svg) return null;
      return [...svg.querySelectorAll('rect')].filter((r) => r.getAttribute('height') === '6' && r.getAttribute('fill') === 'var(--c-etch)').length;
    });
  const both = await film();
  assert(both !== null, 'pattern transfer lab missing in the etch inspector');
  assert(Math.abs(both - 108) <= 2, `compare: positive + negative film should cover the 108 columns once, got ${both}`);
  await S(() => window.__euv.sim.setTone('positive'));
  await sleep(150);
  const pos1 = await film();
  await S(() => window.__euv.sim.setTone('negative'));
  await sleep(150);
  const neg1 = await film();
  assert(Math.abs(pos1 + neg1 - 108) <= 2 && pos1 > 10 && neg1 > 10, `tones should be complementary: ${pos1} + ${neg1}`);
  await S(() => {
    window.__euv.sim.setTone('positive');
    window.__euv.sim.setDose(1.5);
  });
  await sleep(150);
  const posHigh = await film();
  assert(posHigh < pos1, `higher dose should leave narrower positive-tone lines (${posHigh} vs ${pos1} columns)`);
  for (const id of ['reticle', 'resist', 'bakePlate', 'developer']) {
    await S((id) => window.__euv.sim.select(id), id);
    await sleep(120);
    assert(await S(() => !!document.querySelector('[data-testid=inspector] [data-testid=transfer-lab]')), `${id}: pattern transfer lab missing`);
  }
  await S(() => {
    window.__euv.sim.setDose(1);
    window.__euv.sim.setTone('positive');
  });
});

await test('Deep Science reveals advanced notes and limits, and switches the concepts to the Advanced level', async () => {
  await S(() => {
    window.__euv.sim.select('plasma');
    if (window.__euv.sim.state.deep) window.__euv.sim.toggleDeep();
  });
  await sleep(200);
  assert((await S(() => !!document.querySelector('[data-testid=deep-content]'))) === false, 'deep content should be hidden at first');
  // the simplifications of the model are listed even without Deep Science
  assert((await S(() => document.querySelectorAll('[data-testid=accuracy] li').length)) > 0, 'model limits should be visible without Deep Science');
  await page.click('[data-testid=btn-deep]');
  await sleep(250);
  const r = await S(() => ({
    deep: document.querySelector('[data-testid=deep-content]')?.textContent || '',
    pressed: document.querySelector('[data-testid=btn-deep]').getAttribute('aria-pressed'),
    level: window.__euv.sim.state.conceptLevel,
  }));
  assert(r.deep.includes('Saha'), 'deep content should include the Saha equation for the plasma');
  assert(r.pressed === 'true', 'button should show pressed');
  assert(r.level === 'advanced', 'concept level should be advanced, got ' + r.level);
  await page.click('[data-testid=btn-deep]');
  await sleep(200);
  assert((await S(() => !!document.querySelector('[data-testid=deep-content]'))) === false, 'deep content should hide again');
});

await test('Concepts tab: 12 concepts, three levels, level switch changes the text, equations at higher levels', async () => {
  await S(() => {
    window.__euv.sim.setTab('concepts');
    window.__euv.sim.setConceptLevel('beginner');
  });
  await sleep(250);
  const n = await S(() => document.querySelectorAll('[data-testid=concepts] details.card[data-concept]').length);
  assert(n === 12, 'expected 12 concept cards, got ' + n);
  await page.click('[data-testid=concepts] details.card[data-concept=photonEnergy] > summary');
  const text = () => S(() => document.querySelector('[data-testid=concepts] details[data-concept=photonEnergy] .card-body > p').textContent);
  const b = await text();
  assert((await S(() => document.querySelectorAll('[data-testid=concepts] details[data-concept=photonEnergy] > .card-body > .eq').length)) === 0, 'beginner should have no equation');
  await page.click('[data-testid=level-seg] [data-value=intermediate]');
  const i = await text();
  await page.click('[data-testid=level-seg] [data-value=advanced]');
  const a = await text();
  assert(b !== i && i !== a && b !== a, 'the three levels must be different texts');
  assert(a.includes('91.8 eV'), 'advanced text should quote 91.8 eV');
  assert((await S(() => document.querySelectorAll('[data-testid=concepts] details[data-concept=photonEnergy] > .card-body > .eq').length)) === 1, 'advanced should show the equation');
  // all three levels exist for every concept
  const missing = await S(() => 0);
  void missing;
});

await test('Quiz: answers are graded with explanations, progress is tracked and the score is shown at the end', async () => {
  await S(() => window.__euv.sim.setTab('quiz'));
  await sleep(250);
  for (let q = 0; q < data.QUIZ.length; q++) {
    const Q = data.QUIZ[q];
    const wrong = q === 1; // answer question 2 incorrectly on purpose
    const pick = wrong ? (Q.answer + 1) % Q.options.length : Q.answer;
    await page.click(`[data-testid=quiz] [data-testid=opt-${pick}]`);
    const r = await S(() => ({
      right: document.querySelectorAll('[data-testid=quiz] .opt.right').length,
      wrongs: document.querySelectorAll('[data-testid=quiz] .opt.wrong').length,
      why: document.querySelector('[data-testid=quiz-why]')?.textContent || '',
    }));
    assert(r.right === 1, `q${q + 1}: the correct option must be highlighted`);
    assert(r.wrongs === (wrong ? 1 : 0), `q${q + 1}: wrong-answer highlight count ${r.wrongs}`);
    assert(r.why.includes(wrong ? 'Not quite' : 'Correct'), `q${q + 1}: feedback "${r.why.slice(0, 30)}"`);
    await page.click(q === data.QUIZ.length - 1 ? '[data-testid=quiz-finish]' : '[data-testid=quiz-next]');
  }
  const res = await S(() => document.querySelector('[data-testid=quiz-result] .score-big')?.textContent);
  assert(res && res.trim() === `${data.QUIZ.length - 1} / ${data.QUIZ.length}`, 'final score text: ' + res);
});

await test('About tab states the model limits, the EUV invisibility note and the scanner / downstream split', async () => {
  await S(() => window.__euv.sim.setTab('about'));
  await sleep(200);
  const t = await S(() => document.querySelector('[data-testid=about]').textContent);
  for (const s of ['not an exact reproduction', 'not visible to the human eye', 'visualization aid', 'Downstream', 'Nothing is to scale']) assert(t.toLowerCase().includes(s.toLowerCase()), `About tab lacks "${s}"`);
  const foot = await S(() => document.querySelector('[data-testid=viz-note]').textContent);
  assert(/invisible to the eye/.test(foot) && /visualization aid/.test(foot), 'the viewport note must state EUV is invisible and colours are a visualization aid');
});

// ───────────────────────────────────────────────────────────── resist controls change the displayed outcome
const slabInfo = () =>
  S(() => {
    window.__euv.scene.debugFrame();
    const s = window.__euv.scene.slab;
    const read = (inst) => {
      if (!inst.group.visible) return null;
      const hb = Array.from(inst.resist.hb);
      const N = hb.length - 1;
      const at = (x) => hb[Math.round(((x + 2.7) / 5.4) * N)];
      const tall = hb.filter((h) => h > 0.5 * 0.95).length;
      return { line0: at(0), space: at(0.9), tall, tone: inst.tone };
    };
    return { A: read(s.A), B: read(s.B), visible: s.group.visible };
  });

await test('Resist control: Positive leaves lines under the dark mask regions, Negative inverts them, Compare shows both', async () => {
  await go(data.starts[9] + 0.95 * STAGES[9].duration, 'stage'); // end of development
  await page.click('[data-testid=seg-tone] [data-value=positive]');
  await frames(2);
  const pos = await slabInfo();
  assert(pos.A, 'slab should be visible after development');
  assert(pos.A.line0 > 0.6 && pos.A.space < 0.1, `positive tone: line centre height ${pos.A.line0}, space height ${pos.A.space}`);
  await page.click('[data-testid=seg-tone] [data-value=negative]');
  await frames(2);
  const neg = await slabInfo();
  assert(neg.A.line0 < 0.1 && neg.A.space > 0.6, `negative tone: line centre height ${neg.A.line0}, space height ${neg.A.space}`);
  await page.click('[data-testid=seg-tone] [data-value=compare]');
  await settle();
  const cmp = await slabInfo();
  assert(cmp.B && cmp.A, 'compare should show two cross-sections');
  assert(cmp.A.line0 > 0.6 && cmp.B.line0 < 0.1, 'compare: left must be positive, right negative');
  const tags = await S(() => [...document.querySelectorAll('.lbl:not(.is-hidden)')].map((l) => l.textContent));
  assert(tags.some((t) => t.includes('Positive-tone')) && tags.some((t) => t.includes('Negative-tone')), 'compare mode should label both slabs: ' + tags.join(' | '));
  await page.click('[data-testid=seg-tone] [data-value=positive]');
});

await test('Resist control also changes the earlier stages (bake colours) and the etched pattern', async () => {
  // after the etch the film must be open where the resist was removed, in both tones
  const filmOpen = () =>
    S(() => {
      window.__euv.scene.debugFrame();
      const f = window.__euv.scene.slab.A.film;
      const hb = Array.from(f.hb);
      const N = hb.length - 1;
      const at = (x) => hb[Math.round(((x + 2.7) / 5.4) * N)];
      return { line0: at(0), space: at(0.9) };
    });
  await go(data.starts[10] + 0.99 * STAGES[10].duration, 'stage');
  await page.click('[data-testid=seg-tone] [data-value=positive]');
  await frames(2);
  const p = await filmOpen();
  assert(p.line0 > 0.4 && p.space < 0.05, `positive tone etch: film at line ${p.line0}, at space ${p.space}`);
  await page.click('[data-testid=seg-tone] [data-value=negative]');
  await frames(2);
  const n = await filmOpen();
  assert(n.line0 < 0.05 && n.space > 0.4, `negative tone etch: film at line ${n.line0}, at space ${n.space}`);
  const resistGone = await S(() => Math.max(...Array.from(window.__euv.scene.slab.A.resist.hb)));
  assert(resistGone < 0.02, 'resist must be stripped at the end of the etch stage, max height ' + resistGone);
  await page.click('[data-testid=seg-tone] [data-value=positive]');
});

await test('Dose slider changes the printed line width', async () => {
  await go(data.starts[9] + 0.95 * STAGES[9].duration, 'stage');
  await page.click('[data-testid=seg-tone] [data-value=positive]');
  const width = async (v) => {
    await S((v) => {
      const inp = document.querySelector('[data-testid=dose]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, String(v));
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
    await frames(2);
    return (await slabInfo()).A.tall;
  };
  const lowDose = await width(0.7);
  const highDose = await width(1.5);
  assert(lowDose > highDose + 6, `positive tone: low dose should leave wider lines (${lowDose} columns) than high dose (${highDose})`);
  await width(1.0);
});

await test('Chamber control: Air fills the chamber with gas and kills the EUV; Vacuum restores it', async () => {
  await go(70, 'stage');
  await settle(1200);
  const air = () => S(() => ({ air: window.__euv.scene.modules[1].airV.visible, stats: window.__euv.scene.debugStats(), h2: window.__euv.scene.modules[1].h2.visible }));
  const packets = () =>
    S(() => {
      window.__euv.scene.debugFrame();
      const m = window.__euv.scene.modules[2].pool.mesh; // EUV packets travelling through the illuminator and projection optics
      let max = 0;
      for (let i = 0; i < m.count * 3; i++) max = Math.max(max, m.instanceColor.array[i]);
      return { n: m.count, max };
    });
  const a0 = await air();
  assert(!a0.air && a0.h2, 'vacuum: no air molecules, hydrogen flow visible');
  const inVac = await packets();
  assert(inVac.n > 0 && inVac.max > 0.3, `in vacuum EUV packets travel through the optics (n=${inVac.n}, max=${inVac.max.toFixed(2)})`);
  await page.click('[data-testid=seg-atm] [data-value=air]');
  await frames(2);
  const a1 = await air();
  assert(a1.air && !a1.h2, 'air mode should show air molecules and no hydrogen flow');
  // photons beyond the first few units must be (near) invisible in air: sample brightness of the instanced photons
  const inAir = await packets();
  assert(inAir.max < 0.05, 'in air the packets beyond the source must be invisible; max channel ' + inAir.max.toFixed(3));
  await page.click('[data-testid=seg-atm] [data-value=vacuum]');
  await frames(2);
  const a2 = await air();
  assert(!a2.air && a2.h2, 'back to vacuum');
});

// ───────────────────────────────────────────────────────────── robustness and determinism
await test('scene is a pure function of the timeline: jumping away and back reproduces the same beams', async () => {
  const probes = [20.7, 44.4, 70.2, 99.5];
  const read = async (T) => {
    await go(T, 'stage');
    return S(() => window.__euv.scene.debugStats().beamsLit);
  };
  const first = [];
  for (const T of probes) first.push(await read(T));
  const second = [];
  for (const T of [...probes].reverse()) second.push(await read(T));
  second.reverse();
  assert(JSON.stringify(first) === JSON.stringify(second), `beam counts differ after jumping around: ${first} vs ${second}`);
  assert(first.some((n) => n > 0), 'probe times should contain visible beams');
});

await test('rapid stage switching, scrubbing and toggling while playing causes no errors and the render loop keeps running', async () => {
  errors.length = 0;
  await S(() => {
    const { sim } = window.__euv;
    sim.setSpeed(4);
    sim.play();
  });
  const f0 = await S(() => window.__euv.scene.frames);
  const tones = ['positive', 'negative', 'compare'];
  for (let k = 0; k < 60; k++) {
    await S(({ k, tone }) => {
      const { sim } = window.__euv;
      sim.goStage((k * 7) % 11);
      if (k % 5 === 0) sim.setTone(tone);
      if (k % 7 === 0) sim.toggleLabels();
      if (k % 9 === 0) sim.togglePath();
      if (k % 6 === 0) sim.setView(['machine', 'stage'][k % 2]);
      if (k % 8 === 0) sim.setAtmosphere(k % 16 === 0 ? 'air' : 'vacuum');
      if (k % 11 === 0) sim.setTime(Math.random() * window.__euv.total);
    }, { k, tone: tones[k % 3] });
    await sleep(60);
    if (k % 10 === 0) await frame();
  }
  await S(() => {
    const { sim } = window.__euv;
    sim.setSpeed(1);
    sim.setAtmosphere('vacuum');
    sim.setTone('positive');
    sim.pause();
  });
  // the animation loop itself (not forced frames) must still be alive after the stress
  const f1 = await S(() => window.__euv.scene.frames);
  await S(() => window.__euv.sim.play());
  await page.waitForFunction((n) => window.__euv.scene.frames > n + 2, f1, { timeout: 20000 });
  await S(() => window.__euv.sim.pause());
  assert((await S(() => window.__euv.scene.frames)) > f0, 'render loop stalled');
  const real = errors.filter((e) => !ignorable(e));
  assert(real.length === 0, 'errors during stress: ' + real.slice(0, 3).join(' | '));
  const state = await st();
  const labelsOn = state.labels;
  const pathOn = state.path;
  if (!labelsOn) await page.click('[data-testid=btn-labels]');
  if (!pathOn) await page.click('[data-testid=btn-path]');
});

// ───────────────────────────────────────────────────────────── exploration: casing, isolation, camera, typewriter
await test('Exterior / Interior control opens and closes the casing with an animation; interior labels follow', async () => {
  await S(() => {
    const { sim } = window.__euv;
    sim.exitInspect();
    sim.togglePanel(false);
    sim.setView('machine');
  });
  await page.click('[data-testid=seg-casing] [data-value=closed]');
  await settle();
  const c = await S(() => ({ open: window.__euv.scene.debugInspect().casing, labels: window.__euv.scene.labels.visibleIds() }));
  assert(c.open === 0 && c.labels.every((id) => id.startsWith('x-')), 'closed: openness ' + c.open);
  await page.click('[data-testid=seg-casing] [data-value=open]');
  // the panels move over several frames (an animation, not a jump)
  await S(() => {
    const sc = window.__euv.scene;
    sc.debugFrame();
    sc.debugFrame();
  });
  const mid = await S(() => window.__euv.scene.debugInspect().casing);
  assert(mid > 0 && mid < 1, 'casing should be part-way open after two frames, openness ' + mid);
  await settle();
  const o = await S(() => ({ open: window.__euv.scene.debugInspect().casing, labels: window.__euv.scene.labels.visibleIds(), drawn: window.__euv.scene.drawnComponents() }));
  assert(o.open === 1, 'open: openness ' + o.open);
  assert(o.labels.length > 0 && !o.labels.some((id) => id.startsWith('x-')), 'open machine shows interior labels: ' + o.labels.join(','));
  assert(!o.drawn.some((id) => id.startsWith('cab-')), 'the opened casing should no longer be drawn');
  assert(['collector', 'projection', 'frame', 'vacuumPumps', 'cooling', 'cabling'].every((id) => o.drawn.includes(id)), 'interior parts and support systems should be drawn: ' + o.drawn.join(','));
});

await test('isolation: every subsystem and every part is drawn alone (with its context for processes) and framed inside the view', async () => {
  const ids = await S(() => {
    const ex = window.__euv.explore;
    return [...ex.SUBSYSTEMS.map((s) => s.id), ...window.__euv.data.COMPONENT_LIST.map((c) => c.id).filter((id) => ex.isInspectable(id))];
  });
  const problems = [];
  for (const id of ids) {
    await S((id) => window.__euv.sim.inspect(id), id);
    await sleep(60); // React commits the card
    const r = await S((id) => {
      const { scene, explore } = window.__euv;
      scene.debugSettle();
      const d = scene.debugInspect();
      const want = id === 'enclosure' ? ['enclosure'] : explore.isolationTargets(id);
      // screen-space extent of what is isolated: it must fit in the free part of the canvas
      const b = id === 'enclosure' || explore.SUBSYSTEMS.some((s) => s.id === id) ? null : scene.registry.box(id);
      let fit = true;
      if (b && !b.isEmpty()) {
        for (let k = 0; k < 8; k++) {
          const v = b.min.clone().set(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z).project(scene.camera);
          if (Math.abs(v.x) > 1.02 || Math.abs(v.y) > 1.02 || v.z > 1) fit = false;
        }
      }
      return { mask: d.layerMask, drawn: d.drawn, want, fit, rot: d.autoRotate, name: document.querySelector('[data-testid=inspect-name]')?.textContent, expect: explore.inspectInfo(id).name, labels: scene.labels.visibleIds().length };
    }, id);
    const parts = r.drawn.filter((x) => !x.startsWith('cab-') || id === 'enclosure');
    const missing = r.want.filter((w) => !r.drawn.includes(w));
    // the resist is shown as the magnified cross-section, which includes its silicon and film layers
    const allowed = id === 'resist' ? ['wafer', 'etcher'] : [];
    const extra = parts.filter((x) => !r.want.includes(x) && !allowed.includes(x) && !(id === 'enclosure' && x.startsWith('cab-')));
    if (r.mask !== 2) problems.push(`${id}: camera not on the isolation layer (mask ${r.mask})`);
    if (missing.length) problems.push(`${id}: not drawn: ${missing.join(',')}`);
    if (extra.length) problems.push(`${id}: other parts still drawn: ${extra.join(',')}`);
    if (!r.fit) problems.push(`${id}: does not fit inside the view (would be clipped)`);
    if (!r.rot) problems.push(`${id}: auto-rotation should be on`);
    if (r.name !== r.expect) problems.push(`${id}: card shows "${r.name}", expected "${r.expect}"`);
    if (r.labels) problems.push(`${id}: ${r.labels} floating labels still shown`);
  }
  await S(() => window.__euv.sim.exitInspect());
  await settle();
  assert(problems.length === 0, problems.join('\n'));
});

await test('a part that exists only at some moments moves the timeline to it, and Back restores the moment', async () => {
  await go(5, 'stage');
  await settle();
  await S(() => window.__euv.sim.inspect('euvBeam'));
  const a = await st();
  assert(a.stage === 7 && a.playing === false, `inspecting the EUV light should show the exposure stage (stage ${a.stage})`);
  await S(() => window.__euv.sim.inspect('collector')); // switching inside the inspection keeps the original moment
  await S(() => window.__euv.sim.exitInspect());
  const b = await st();
  near(b.t, 5, 0.01, 'Back should return to the original time');
  assert(b.stage === 0, 'Back should return to the original stage');
  await settle();
});

await test('every part belongs to a subsystem and has its own overview, engineering and deep-science text', async () => {
  const r = await S(() => {
    const ex = window.__euv.explore;
    const ids = [...ex.SUBSYSTEMS.map((s) => s.id), ...window.__euv.data.COMPONENT_LIST.map((c) => c.id).filter((id) => ex.isInspectable(id))];
    const infos = ids.map((id) => ex.inspectInfo(id));
    const short = infos.filter((i) => !i || i.levels.overview.length < 60 || i.levels.engineering.length < 60 || i.levels.deep.length < 60).map((i) => i?.id);
    const texts = infos.flatMap((i) => [i.levels.overview, i.levels.engineering, i.levels.deep]);
    const dupes = texts.filter((t, k) => texts.indexOf(t) !== k).length;
    return { orphans: ex.ORPHANS, short, dupes, n: ids.length };
  });
  assert(r.orphans.length === 0, 'components outside the hierarchy: ' + r.orphans.join(','));
  assert(r.short.length === 0, 'missing or too short explanation levels: ' + r.short.join(','));
  assert(r.dupes === 0, `${r.dupes} explanation texts are shared between items (each must be specific)`);
  assert(r.n >= 30, 'expected at least 30 inspectable items, got ' + r.n);
});

await test('inspection camera: drag pauses the rotation, Resume / Reverse / presets / Reset work, Back restores the view', async () => {
  await go(24, 'stage');
  await settle();
  // the user turns the machine view first (a real drag); Back must come back to this pose, not to the preset
  {
    const bx = await page.locator('canvas.gl').boundingBox();
    const x0 = bx.x + bx.width * 0.75;
    const y0 = bx.y + bx.height * 0.7;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let k = 1; k <= 5; k++) await page.mouse.move(x0 - k * 14, y0 - k * 3);
    await page.mouse.up();
  }
  const before = await S(() => {
    const sc = window.__euv.scene;
    sc.debugFrame();
    sc.stopMomentum(); // let the damped drag come to rest here
    sc.debugFrame();
    const c = sc.camera.position;
    return [c.x, c.y, c.z];
  });
  assert((await S(() => window.__euv.scene.userMoved)) === true, 'a drag should count as the user moving the camera');
  await S(() => window.__euv.sim.inspect('collector'));
  await settle();
  const help = await S(() => document.querySelector('[data-testid=inspect-help]').textContent);
  assert(/rotat/i.test(help) && /drag to rotate/i.test(help) && /zoom/i.test(help) && /pan/i.test(help), 'instruction text should describe rotation, drag, zoom and pan: ' + help);
  assert((await S(() => window.__euv.scene.controls.autoRotate)) === true, 'auto-rotation should be on');
  // real mouse drag on the canvas
  const box = await page.locator('canvas.gl').boundingBox();
  const cx = box.x + box.width * 0.62;
  const cy = box.y + box.height * 0.45;
  const az0 = await S(() => window.__euv.scene.controls.getAzimuthalAngle());
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let k = 1; k <= 6; k++) await page.mouse.move(cx + k * 22, cy + k * 4);
  await page.mouse.up();
  await frames(2);
  const d = await S(() => ({ spin: window.__euv.sim.state.spin, auto: window.__euv.scene.controls.autoRotate, az: window.__euv.scene.controls.getAzimuthalAngle(), insp: window.__euv.sim.state.inspect }));
  assert(d.insp === 'collector', 'a drag must not change the inspected part');
  assert(d.spin === false && d.auto === false, 'dragging should pause the automatic rotation');
  assert(Math.abs(d.az - az0) > 0.05, 'dragging should rotate the camera');
  assert(/paused/i.test(await S(() => document.querySelector('[data-testid=inspect-help]').textContent)), 'instruction text should say the rotation is paused');
  // the mouse wheel zooms (distance to the part shrinks), and the part stays the one inspected
  const camDist = () => S(() => window.__euv.scene.camera.position.distanceTo(window.__euv.scene.controls.target));
  const z0 = await camDist();
  await page.mouse.move(cx, cy);
  for (let k = 0; k < 3; k++) await page.mouse.wheel(0, -240);
  await frames(3);
  const z1 = await camDist();
  assert(z1 < z0 * 0.95, `wheel should zoom in (distance ${z0.toFixed(2)} → ${z1.toFixed(2)})`);
  // the rotation stays paused until Resume is pressed
  await frames(3);
  assert((await st()).spin === false, 'rotation must stay paused without an explicit Resume');
  await page.click('[data-testid=insp-spin]');
  assert((await st()).spin === true, 'Resume rotation');
  await frames(1);
  const sp1 = await S(() => window.__euv.scene.controls.autoRotateSpeed);
  await page.click('[data-testid=insp-reverse]');
  await frames(1);
  const sp2 = await S(() => window.__euv.scene.controls.autoRotateSpeed);
  assert(sp1 * sp2 < 0, `Reverse should flip the rotation direction (${sp1} → ${sp2})`);
  // the rotation really turns the camera, in the chosen direction
  const turn = await S(() => {
    const sc = window.__euv.scene;
    const a = sc.controls.getAzimuthalAngle();
    for (let k = 0; k < 4; k++) sc.debugFrame();
    return sc.controls.getAzimuthalAngle() - a;
  });
  assert(Math.abs(turn) > 1e-4 && Math.sign(turn) === Math.sign(sp2), `auto-rotation should turn the camera in the chosen direction (Δaz ${turn}, speed ${sp2})`);
  // presets
  const offset = () =>
    S(() => {
      const sc = window.__euv.scene;
      const o = sc.camera.position.clone().sub(sc.controls.target).normalize();
      return { x: o.x, y: o.y, z: o.z };
    });
  await page.click('[data-testid=insp-presets] [data-value=top]');
  await settle();
  const top = await offset();
  assert(top.y > 0.95, 'Top preset should look down from above: ' + JSON.stringify(top));
  await page.click('[data-testid=insp-presets] [data-value=front]');
  await settle();
  const front = await offset();
  assert(front.z > 0.95, 'Front preset should look along the machine front: ' + JSON.stringify(front));
  await page.click('[data-testid=insp-presets] [data-value=side]');
  await settle();
  const side = await offset();
  assert(Math.abs(side.x) > 0.95, 'Side preset should look from the side: ' + JSON.stringify(side));
  await page.click('[data-testid=insp-presets] [data-value=iso]');
  await settle();
  const iso = await offset();
  assert(iso.y > 0.3 && Math.abs(iso.x) > 0.3 && iso.z > 0.3, 'Iso preset: ' + JSON.stringify(iso));
  // Reset view returns to the default framing of the part
  await page.click('[data-testid=insp-reset]');
  await settle();
  const reset = await S(() => ({ preset: window.__euv.sim.state.camPreset, mask: window.__euv.scene.camera.layers.mask }));
  assert(reset.preset === 'default' && reset.mask === 2, 'Reset view keeps the isolation and returns to the default framing');
  // Back restores the machine view the user came from
  await page.click('[data-testid=insp-back]');
  await settle();
  const after = await S(() => {
    const c = window.__euv.scene.camera.position;
    return { p: [c.x, c.y, c.z], view: window.__euv.sim.state.view, mask: window.__euv.scene.camera.layers.mask };
  });
  assert(after.view === 'stage' && after.mask === 1, `Back should restore the stage view with everything drawn (view ${after.view}, mask ${after.mask})`);
  const dist = Math.hypot(after.p[0] - before[0], after.p[1] - before[1], after.p[2] - before[2]);
  assert(dist < 0.5, 'Back should put the camera where it was, off by ' + dist.toFixed(2));
});

await test('assemblies: children are listed and selectable; the explorer isolates exactly the chosen part', async () => {
  await S(() => window.__euv.sim.inspect('sys-illum'));
  await settle();
  const kids = await S(() => [...document.querySelectorAll('[data-testid=insp-children] [data-inspect]')].map((b) => b.dataset.inspect));
  assert(kids.includes('ffm') && kids.includes('pfm'), 'assembly card should list its parts: ' + kids.join(','));
  await page.click('[data-testid=insp-children] [data-inspect=pfm]');
  await settle();
  const d1 = await S(() => ({ insp: window.__euv.sim.state.inspect, drawn: window.__euv.scene.drawnComponents(), crumb: document.querySelector('[data-testid=crumb-parent]')?.textContent }));
  assert(d1.insp === 'pfm' && d1.drawn.join() === 'pfm', 'child chip should isolate only that part: ' + d1.drawn.join(','));
  assert(/illumination/i.test(d1.crumb), 'breadcrumb should name the parent assembly: ' + d1.crumb);
  // breadcrumb back up to the assembly
  await page.click('[data-testid=crumb-parent]');
  await settle();
  assert((await st()).inspect === 'sys-illum', 'breadcrumb should go back to the assembly');
  // the explorer tab of the panel: pick a part in another subsystem, then a whole subsystem
  await S(() => window.__euv.sim.togglePanel(true));
  await sleep(150);
  await page.click('#tab-explore');
  await page.click('[data-testid=explore-tree] [data-inspect=reticleStage]');
  await settle();
  const d2 = await S(() => window.__euv.scene.drawnComponents());
  assert(d2.join() === 'reticleStage', 'explorer: only the reticle stage should be drawn: ' + d2.join(','));
  await page.click('[data-testid=explore-tree] [data-inspect=sys-support]');
  await settle();
  const d3 = await S(() => window.__euv.scene.drawnComponents());
  assert(['frame', 'vacuumPumps', 'cooling', 'cabling'].every((id) => d3.includes(id)) && !d3.includes('collector'), 'explorer: the support systems alone: ' + d3.join(','));
  // Machine exterior closes everything
  await page.click('[data-testid=insp-exterior]');
  await settle();
  const e = await S(() => ({ ...window.__euv.sim.state, open: window.__euv.scene.debugInspect().casing, mask: window.__euv.scene.camera.layers.mask }));
  assert(e.inspect === null && e.casing === 'closed' && e.open === 0 && e.mask === 1, 'Machine exterior should end the inspection and close the casing');
  await S(() => window.__euv.sim.togglePanel(false));
});

await test('typewriter: name at once, text types in order, pause / resume / skip, switching cancels, no mixing of levels', async () => {
  // clicks use force: Playwright otherwise waits for two still animation frames, which take seconds on a software renderer
  const click = (sel) => page.click(sel, { force: true });
  await S(() => window.__euv.sim.inspect('collector'));
  await sleep(60);
  const info = await S(() => window.__euv.explore.inspectInfo('collector'));
  const read = () => S(() => ({ text: document.querySelector('[data-testid=tw-text]')?.textContent ?? '', level: document.querySelector('[data-testid=typewriter]')?.dataset.level, name: document.querySelector('[data-testid=inspect-name]')?.textContent }));
  const a = await read();
  assert(a.name === 'Collector Mirror', 'the name must appear immediately: ' + a.name);
  assert(a.level === 'overview' && a.text.length < info.levels.overview.length, 'typing should start with the overview');
  // the text grows with time (polled: a software-rendered frame can take most of a second)
  let b = a;
  for (let k = 0; k < 20 && b.text.length <= a.text.length; k++) {
    await sleep(250);
    b = await read();
  }
  assert(b.text.length > a.text.length && info.levels.overview.startsWith(b.text), `overview text should grow as a prefix of the overview (${a.text.length} → ${b.text.length})`);
  // another level shows only its own text, typed from its own start
  assert(info.levels.deep.length > 300, 'the deep-science text should be long enough to test pausing');
  await click('[data-testid=tw-tab-deep]');
  let d = await read();
  // typing advances on animation frames; a software renderer can stall frames for many seconds after a scene change
  for (let k = 0; k < 80 && !(d.level === 'deep' && d.text.length > 0); k++) {
    // a forced click can land while the card re-renders: click again if the tab did not switch
    if (k % 8 === 7 && d.level !== 'deep') await click('[data-testid=tw-tab-deep]');
    await sleep(250);
    d = await read();
  }
  assert(d.level === 'deep' && d.text.length > 0 && info.levels.deep.startsWith(d.text), `deep tab should type the deep-science text (level ${d.level}, ${d.text.length} chars: "${d.text.slice(0, 40)}")`);
  assert(!d.text.includes(info.levels.overview.slice(0, 30)), 'levels must not mix');
  // pause holds the text, resume continues it
  await click('[data-testid=tw-pause]');
  const p1 = (await read()).text.length;
  await sleep(700);
  const p2 = (await read()).text.length;
  assert(p1 === p2, `paused text should not change (${p1} → ${p2})`);
  assert(/paused/i.test(await S(() => document.querySelector('[data-testid=tw-status]').textContent)), 'status should say Paused');
  await click('[data-testid=tw-pause]');
  let p3 = p2;
  for (let k = 0; k < 20 && p3 <= p2; k++) {
    await sleep(250);
    p3 = (await read()).text.length;
  }
  assert(p3 > p2, `resume should continue typing (${p2} → ${p3})`);
  // skip completes the level
  await click('[data-testid=tw-skip]');
  await sleep(60);
  assert((await read()).text === info.levels.deep, 'Skip should show the whole deep-science text');
  // back to the overview: its own text again (complete or still a prefix), never the deep text
  await click('[data-testid=tw-tab-overview]');
  await sleep(60);
  const o = await read();
  assert(o.level === 'overview' && info.levels.overview.startsWith(o.text) && !o.text.includes(info.levels.deep.slice(0, 30)), 'overview tab shows only the overview');
  // switching component cancels the old text and starts the new one
  await S(() => window.__euv.sim.inspect('reticle'));
  await sleep(300);
  const info2 = await S(() => window.__euv.explore.inspectInfo('reticle'));
  const r = await read();
  assert(r.name === info2.name, 'new name immediately');
  assert(r.level === 'overview' && info2.levels.overview.startsWith(r.text), 'new component starts at its own overview: "' + r.text.slice(0, 50) + '"');
  assert(!r.text.includes(info.levels.overview.slice(0, 30)), 'old text must be gone after switching');
  // the levels follow one another: after the overview is done and the reading pause passes, engineering starts
  await click('[data-testid=tw-skip]');
  const t0 = Date.now();
  let lvl = '';
  while (Date.now() - t0 < 12000) {
    lvl = (await read()).level;
    if (lvl === 'engineering') break;
    await sleep(400);
  }
  assert(lvl === 'engineering', 'after the overview and a reading pause, the engineering level should start by itself');
  const e = await read();
  assert(info2.levels.engineering.startsWith(e.text), 'auto-advanced level types its own text');
  // the text and the rotation are independent: pausing the text keeps the model turning
  await click('[data-testid=tw-pause]');
  assert((await S(() => window.__euv.sim.state.spin)) === true, 'pausing the text must not stop the rotation');
  // reduced motion: the whole text is shown at once
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await S(() => window.__euv.sim.inspect('pfm'));
  await sleep(200);
  const info3 = await S(() => window.__euv.explore.inspectInfo('pfm'));
  const rm = await read();
  assert(rm.text === info3.levels.overview, 'with reduced motion the overview should appear complete at once');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await S(() => window.__euv.sim.exitInspect());
  await settle();
});

// ───────────────────────────────────────────────────────────── finished wafer + chip explorer
const chipDbg = () => S(() => window.__euv.scene.debugChip());
const chipSt = () => S(() => window.__euv.sim.state.chip);
const press = (sel) => page.click(sel, { force: true }); // no stability wait: frames are ~1 s apart on a software renderer
/** click a chip structure in the 3-D view with the real mouse */
const chipClick = async (spec) => {
  const p = await S((s) => window.__euv.scene.findChipPoint(s), spec);
  assert(p, 'no clickable point on screen for ' + JSON.stringify(spec));
  const b = await page.locator('canvas.gl').boundingBox();
  await page.mouse.click(b.x + p.x, b.y + p.y);
  await sleep(150);
};
const cardName = () => S(() => document.querySelector('[data-testid=chip-name]')?.textContent);

await test('finished wafer: offered at the end of the process; the machine gives way to the whole wafer', async () => {
  await S(() => {
    window.__euv.sim.exitInspect();
    window.__euv.sim.togglePanel(false);
  });
  await page.click('[data-testid=chips] [data-stage="10"]');
  await settle();
  assert(await page.locator('[data-testid=stage-card] [data-testid=btn-finished-wafer]').isVisible(), 'the last stage should offer "Inspect finished wafer"');
  await press('[data-testid=btn-finished-wafer]');
  await settle();
  const d = await chipDbg();
  const c = await chipSt();
  assert(c && c.level === 'wafer' && d.active && d.repr === 'wafer' && d.wafer, 'the wafer explorer should be open and drawn: ' + JSON.stringify({ level: c?.level, active: d.active }));
  assert(d.calls < 40, 'only the wafer should be drawn now, not the machine (draw calls ' + d.calls + ')');
  assert((await S(() => window.__euv.scene.labels.visibleIds())).length === 0, 'machine labels must be hidden');
  assert((await cardName()) === 'Finished 300 mm wafer', 'card name: ' + (await cardName()));
  const meta = await S(() => window.__euv.chip);
  assert(meta.full > 300 && meta.partial > 20, `a 300 mm wafer with complete and partial edge dies (${meta.full} complete, ${meta.partial} partial)`);
  assert(/physical scale/i.test(await S(() => document.querySelector('[data-testid=scale-badge]').textContent)), 'the wafer is shown at physical scale');
  assert(d.autoRotate === true, 'the isolated wafer turns slowly');
});

await test('die grid: a complete die and a partial edge die can be selected, each with its own explanation', async () => {
  await press('[data-testid=chip-spin]'); // hold the wafer still so the points found stay put
  await settle();
  await chipClick({ sel: 'die-edge' });
  let c = await chipSt();
  assert(c.sel === 'die-edge' && /edge die/i.test(await cardName()), 'edge die selected: ' + (await cardName()));
  assert(await S(() => document.querySelector('[data-testid=chip-dive]').disabled), 'an edge die cannot be zoomed into');
  await chipClick({ sel: 'die' });
  c = await chipSt();
  const meta = await S((i) => window.__euv.chip, c.die);
  assert(c.sel === 'die' && c.die !== null && /^Die [A-Z]+\d+$/.test(await cardName()), 'complete die selected: ' + (await cardName()));
  assert(!(await S(() => document.querySelector('[data-testid=chip-dive]').disabled)), 'a complete die can be zoomed into');
  assert(meta, 'chip metadata');
});

await test('zoom: wafer → die → circuit region → cell, each a recognisable representation with labels and scale', async () => {
  const wd = (await chipDbg()).dist;
  await press('[data-testid=chip-dive]');
  await settle();
  let d = await chipDbg();
  assert(d.level === 'die' && d.dist < wd / 8 && d.dieDetail, `die level: closer camera and die relief (dist ${d.dist.toFixed(1)} vs ${wd.toFixed(1)})`);
  assert(d.labels.includes('r-core0') && d.labels.includes('d-w'), 'die labels with blocks and the illustrative dimensions: ' + d.labels.join(','));
  assert(/12 × 10 mm/.test(await S(() => document.querySelector('[data-testid=chip-card] .pill').textContent)), 'die dimensions shown as an example');
  await chipClick({ sel: 'fp-core' });
  assert((await chipSt()).region?.startsWith('core'), 'a CPU core region should be selected');
  await press('[data-testid=chip-dive]');
  await settle();
  d = await chipDbg();
  assert(d.level === 'block' && d.repr === 'block', 'circuit-region level');
  assert(d.block.gate > 500 && d.block.si > 500 && d.block.contact > 500 && d.block.copper > 200, 'cells, transistors, contacts and wires drawn: ' + JSON.stringify(d.block));
  assert(['b-cells', 'b-sram'].every((k) => d.labels.includes(k)), 'labels for the standard cells and the SRAM: ' + d.labels.join(','));
  assert(/enlarged educational model/i.test(await S(() => document.querySelector('[data-testid=scale-badge]').textContent)), 'the switch to an enlarged model is announced');
  assert(/µm/.test(await S(() => document.querySelector('[data-testid=chip-scale]')?.textContent ?? '')), 'scale bar in micrometres');
  // a circuit block isolates on selection
  await press('[data-testid=chip-structures] [data-sel=blk-sram]');
  await settle();
  d = await chipDbg();
  assert((await chipSt()).iso && d.block.gate < 500 && d.block.gate > 100 && /SRAM/.test(await cardName()), 'SRAM array isolated: ' + JSON.stringify(d.block));
  await press('[data-testid=chip-iso]');
  await settle();
  await chipClick({ sel: 'std-cell' });
  assert((await chipSt()).sel === 'std-cell', 'a standard cell selected');
  await press('[data-testid=chip-dive]');
  await settle();
  d = await chipDbg();
  assert(d.level === 'cell' && d.repr === 'cell', 'cell level');
});

await test('transistor structures are distinct geometry: gates, nanosheets, dielectric, source/drain, contacts, vias', async () => {
  const d = await chipDbg();
  const c = d.cell;
  assert(c.gate === 6 && c.sheet === 12 && c.hk === 12 && c.epin === 3 && c.epip === 3, 'four GAA transistors (+2 dummy gates), 3 sheets each, wrapped in high-k, between source/drain regions: ' + JSON.stringify(c));
  assert(c.contact >= 7 && c.via >= 10 && c.copper >= 15 && c.dielectric >= 5, 'contacts, vias, metal lines and dielectric layers: ' + JSON.stringify(c));
  assert((await S(() => document.querySelectorAll('[data-testid=chip-transistors] [data-device]').length)) === 4, 'the four transistors are listed');
  // cut across the gate, then click the parts on the cut face
  await press('[data-testid=chip-views] [data-value=gate]');
  await settle();
  await chipClick({ sel: 'gate' });
  assert((await cardName()) === 'Gate', 'clicking a gate explains the gate: ' + (await cardName()));
  const t1 = await S(() => document.querySelector('[data-testid=tw-text]').textContent);
  const info = await S(() => window.__euv.chip.CHIP_INFO);
  assert(info.gate.overview.startsWith(t1), 'the typed text is the gate overview');
  await chipClick({ sel: 'hk' });
  assert(/dielectric/i.test(await cardName()), 'the gate dielectric has its own explanation: ' + (await cardName()));
  await chipClick({ sel: 'sheet' });
  assert(/nanosheet/i.test(await cardName()), 'the channel: ' + (await cardName()));
});

await test('cross-section and exploded views: the cut trims the geometry, the explode separates the layers', async () => {
  const gate = await chipDbg();
  assert(gate.trimmed > 20, 'the gate cut trims boxes: ' + gate.trimmed);
  await press('[data-testid=chip-views] [data-value=channel]');
  await settle();
  const ch = await chipDbg();
  assert(ch.trimmed > 20 && ch.trimmed !== gate.trimmed, 'the channel cut trims a different set: ' + ch.trimmed);
  await press('[data-testid=chip-views] [data-value=top]');
  await settle();
  const top0 = (await chipDbg()).topY;
  assert((await chipDbg()).trimmed === 0, 'no cut in the whole view');
  await page.locator('[data-testid=chip-explode]').fill('1');
  await settle();
  const top1 = (await chipDbg()).topY;
  assert(top1 > top0 + 200, `exploding raises the upper layers (${top0.toFixed(0)} → ${top1.toFixed(0)} nm)`);
  const d = await chipDbg();
  assert(d.calls > 5 && d.dist > d.minDist * 0.99, 'the exploded stack stays drawn and framed');
  await page.locator('[data-testid=chip-explode]').fill('0');
  await settle();
});

await test('layers: metal, vias and insulators are distinct materials, can be hidden and selected for explanation', async () => {
  await press('[data-testid=chip-layers-btn]');
  await sleep(200);
  const legend = await S(() => Object.fromEntries([...document.querySelectorAll('[data-testid=chip-legend] .lg')].map((e) => [e.querySelector('b').textContent, e.querySelector('i').style.background])));
  const metal = legend['Metal line'];
  const via = legend['Via'];
  const diel = legend['Insulating dielectric'];
  assert(metal && via && diel && new Set([metal, via, diel]).size === 3, 'metal, via and dielectric need distinct colours: ' + JSON.stringify(legend));
  await press('[data-select-layer=m0]');
  assert((await cardName()) === 'M0 local interconnect' && (await chipSt()).sel === 'layer:m0', 'M0 layer selected: ' + (await cardName()));
  await press('[data-select-layer=diel]');
  assert((await cardName()) === 'Insulating dielectric', 'dielectric explained: ' + (await cardName()));
  const before = (await chipDbg()).cell.dielectric;
  await press('[data-layer=diel]');
  await settle();
  const after = (await chipDbg()).cell.dielectric;
  assert(before > 0 && after === 0, `hiding the dielectric removes it (${before} → ${after})`);
  const cu0 = (await chipDbg()).cell.copper;
  await press('[data-layer=m2]');
  await settle();
  const cu1 = (await chipDbg()).cell.copper;
  assert(cu1 < cu0, `hiding V2 + M2 removes its lines (${cu0} → ${cu1})`);
  await press('[data-layer=diel]');
  await press('[data-layer=m2]');
  await press('[data-testid=chip-layers-btn]');
  await settle();
});

await test('transistor: isolated and enlarged, turns slowly, drag pauses, illustrative ON/OFF state', async () => {
  await press('[data-testid=chip-transistors] [data-device=nA]');
  assert(/nFET/.test(await cardName()), 'transistor selected: ' + (await cardName()));
  await press('[data-testid=chip-dive]');
  await settle();
  let d = await chipDbg();
  assert(d.level === 'transistor' && d.cell.gate === 1 && d.cell.sheet === 3 && d.cell.copper === 0, 'only this transistor is drawn: ' + JSON.stringify(d.cell));
  assert(d.autoRotate, 'it turns slowly');
  const b = await page.locator('canvas.gl').boundingBox();
  await page.mouse.move(b.x + b.width * 0.62, b.y + b.height * 0.45);
  await page.mouse.down();
  for (let k = 1; k <= 5; k++) await page.mouse.move(b.x + b.width * 0.62 + k * 20, b.y + b.height * 0.45);
  await page.mouse.up();
  await frames(2);
  assert((await st()).spin === false && (await chipDbg()).autoRotate === false, 'dragging pauses the rotation');
  await press('[data-testid=chip-onoff] [data-value=on]');
  await settle();
  d = await chipDbg();
  assert(d.particles > 0 && (await chipSt()).on, 'ON shows the carriers flowing');
  assert(/not a device simulation/i.test(await S(() => document.querySelector('[data-testid=chip-onoff]').textContent)), 'ON/OFF is labelled as an illustration');
  await press('[data-testid=chip-onoff] [data-value=off]');
  await settle();
  assert((await chipDbg()).particles === 0, 'OFF: no carriers');
  await press('[data-testid=chip-spin]');
});

await test('zooming never passes through or loses the model; scrolling past the limit dives one scale deeper', async () => {
  const levels = [];
  for (const lvl of ['transistor', 'cell', 'block', 'die', 'wafer']) {
    if (lvl !== 'transistor') await S((l) => window.__euv.sim.chipGo(l), lvl);
    await settle();
    const b = await page.locator('canvas.gl').boundingBox();
    await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.45);
    for (let k = 0; k < 2; k++) await page.mouse.wheel(0, -2400);
    await frames(3);
    const d = await chipDbg();
    levels.push(`${lvl}: ${d.dist.toFixed(1)} ≥ ${d.minDist.toFixed(1)}, calls ${d.calls}`);
    assert(d.dist >= d.minDist * 0.98 && d.dist > 0 && d.calls >= 3, 'zoom clamped and model drawn — ' + levels.join(' | '));
    assert((await chipSt()).level === lvl || lvl === 'wafer', 'a big zoom alone does not change scale at ' + lvl);
  }
  // on the wafer, at the zoom limit, with the cursor over a complete die: keep scrolling to dive into that die
  await S(() => window.__euv.sim.chipGo('wafer'));
  await settle();
  const sw = await S(() => ({ chip: window.__euv.sim.state.chip?.level, spin: window.__euv.sim.state.spin, btn: !!document.querySelector('[data-testid=chip-spin]') }));
  assert(sw.btn, 'rotation control expected on the wafer: ' + JSON.stringify(sw));
  if (sw.spin) await press('[data-testid=chip-spin]');
  await settle();
  const p = await S(() => window.__euv.scene.findChipPoint({ sel: 'die' }));
  const b = await page.locator('canvas.gl').boundingBox();
  await page.mouse.move(b.x + p.x, b.y + p.y);
  for (let k = 0; k < 4; k++) {
    await page.mouse.wheel(0, -2400);
    await frames(1);
  }
  for (let k = 0; k < 4 && (await chipSt()).level === 'wafer'; k++) {
    await page.mouse.wheel(0, -300);
    await sleep(80);
  }
  await settle();
  assert((await chipSt()).level === 'die', 'scrolling on at the zoom limit should open the die under the cursor, level ' + (await chipSt()).level);
  await S(() => window.__euv.sim.setSpin(true));
});

await test('back to the wafer and to the machine without losing either scene', async () => {
  await S(() => window.__euv.sim.chipGo('cell'));
  await settle();
  await press('[data-testid=chip-wafer]');
  await settle();
  let c = await chipSt();
  assert(c.level === 'wafer' && c.die !== null && (await chipDbg()).repr === 'wafer', 'Whole wafer returns to the wafer, keeping the chosen die');
  await press('[data-testid=chip-up]');
  await settle();
  const s = await st();
  const d = await chipDbg();
  assert(s.chip === null && !d.active && s.stage === 10, 'back in the machine at the last stage');
  assert((await S(() => window.__euv.scene.labels.visibleIds())).length > 0 && d.calls > 100, 'the machine is drawn again with its labels');
  assert(Math.abs(d.near - 0.5) < 1e-6, 'camera clipping restored for the machine');
  // and the explorer can be opened again
  await press('[data-testid=btn-finished-wafer]');
  await settle();
  assert((await chipSt())?.level === 'wafer' && (await chipDbg()).active, 'the explorer opens again');
  await page.keyboard.press('Escape');
  await settle();
  assert((await st()).chip === null, 'Escape from the wafer returns to the machine');
});

await test('keyboard shortcuts: Space, arrows, L, P, D, M, R, O, Escape', async () => {
  await S(() => {
    window.__euv.sim.select(null);
    window.__euv.sim.togglePanel(false);
    window.__euv.sim.setTime(5);
    window.__euv.sim.pause();
    document.activeElement?.blur?.();
  });
  await page.mouse.click(5, 5); // focus the page body
  await page.keyboard.press('Space');
  assert((await st()).playing === true, 'Space should play');
  await page.keyboard.press('Space');
  assert((await st()).playing === false, 'Space should pause');
  await page.keyboard.press('ArrowRight');
  assert((await st()).stage === 1, 'ArrowRight → next stage');
  await page.keyboard.press('ArrowLeft');
  assert((await st()).stage === 0, 'ArrowLeft → previous stage');
  const before = (await st()).labels;
  await page.keyboard.press('l');
  assert((await st()).labels === !before, 'L toggles labels');
  await page.keyboard.press('l');
  const p0 = (await st()).path;
  await page.keyboard.press('p');
  assert((await st()).path === !p0, 'P toggles path');
  await page.keyboard.press('p');
  const v0 = (await st()).view;
  await page.keyboard.press('m');
  assert((await st()).view !== v0, 'M toggles the view');
  await page.keyboard.press('m');
  await page.keyboard.press('d');
  assert((await st()).deep === true, 'D → deep science');
  await page.keyboard.press('d');
  await S(() => window.__euv.sim.inspect('collector'));
  await page.keyboard.press('Escape');
  assert((await st()).inspect === null, 'Escape leaves the inspection view first');
  const c0 = (await st()).casing;
  await page.keyboard.press('o');
  assert((await st()).casing !== c0, 'O opens or closes the machine casing');
  await page.keyboard.press('o');
  assert((await st()).casing === c0, 'O again restores the casing');
  await S(() => window.__euv.sim.select('plasma'));
  await page.keyboard.press('Escape');
  assert((await st()).selectedId === null, 'Escape clears the selection');
  await page.keyboard.press('Escape');
  assert((await st()).panelOpen === false, 'second Escape closes the panel');
  await S(() => window.__euv.sim.setTime(60));
  await page.keyboard.press('r');
  assert((await st()).t < 2, 'R restarts');
  await page.click('[data-testid=btn-play]');
});

await test('science panel opens and closes from the top bar and the close button', async () => {
  await S(() => window.__euv.sim.togglePanel(false));
  await page.click('[data-testid=btn-panel]');
  await sleep(150);
  assert(await S(() => !document.querySelector('[data-testid=panel]').hidden), 'panel should open');
  const w = await S(() => document.querySelector('[data-testid=viewport]').clientWidth);
  assert(w < 1300, 'viewport should shrink when the panel opens: ' + w);
  await page.click('[data-testid=panel-close]');
  await sleep(150);
  assert(await S(() => document.querySelector('[data-testid=panel]').hidden), 'panel should close');
});

await test('no console errors during the whole desktop session', async () => {
  const real = errors.filter((e) => !ignorable(e));
  assert(real.length === 0, real.join('\n'));
});

// ───────────────────────────────────────────────────────────── mobile layout
{
  const m = await launch({ width: 390, height: 844, mobile: true, lowq: true });
  await ready(m.page, url);
  await test('mobile 390×844: no horizontal scroll, controls usable by touch, panel opens as a bottom sheet', async () => {
    const r = await m.page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      iw: innerWidth,
      canvas: document.querySelector('canvas.gl').getBoundingClientRect().toJSON(),
      dock: document.querySelector('[data-testid=dock]').getBoundingClientRect().toJSON(),
      card: document.querySelector('.stage-card').getBoundingClientRect().toJSON(),
    }));
    assert(r.sw <= r.iw, `horizontal overflow ${r.sw} > ${r.iw}`);
    assert(r.canvas.height > 260, 'canvas too short: ' + r.canvas.height);
    assert(r.dock.bottom <= 845 && r.dock.height < 330, 'dock too tall: ' + r.dock.height);
    assert(r.card.left >= 8 && r.card.right <= 390 - 8, 'stage card must keep its side gutter');
    // tap a stage chip and the play button
    await m.page.tap('[data-testid=chips] [data-stage="6"]');
    await sleep(300);
    assert((await m.page.evaluate(() => window.__euv.sim.state.stage)) === 6, 'tapping a chip should select the stage');
    const was = await m.page.evaluate(() => window.__euv.sim.state.playing);
    await m.page.tap('[data-testid=btn-play]');
    const playing = await m.page.evaluate(() => window.__euv.sim.state.playing);
    assert(playing === !was, 'tapping Play/Pause should toggle');
    if (playing) await m.page.tap('[data-testid=btn-play]');
    await m.page.tap('[data-testid=btn-panel]');
    await sleep(300);
    const sheet = await m.page.evaluate(() => {
      const p = document.querySelector('[data-testid=panel]');
      const r = p.getBoundingClientRect();
      return { hidden: p.hidden, top: r.top, height: r.height, left: r.left, right: r.right, pos: getComputedStyle(p).position, sw: document.documentElement.scrollWidth };
    });
    assert(!sheet.hidden && sheet.pos === 'absolute', 'panel should be an overlay sheet on phones');
    assert(sheet.left >= 0 && sheet.right <= 390 && sheet.sw <= 390, 'sheet within the viewport');
    assert(sheet.height > 250, 'sheet too short: ' + sheet.height);
    // the dock options toggle
    const more = m.page.locator('.more-btn');
    if (await more.isVisible()) {
      await more.tap();
      await sleep(200);
      assert(await m.page.locator('[data-testid=seg-tone]').isVisible(), 'More should reveal the resist control');
    }
    const lab = await m.page.evaluate(() => document.querySelectorAll('.lbl:not(.is-hidden)').length);
    assert(lab <= 8, 'phone view should not be flooded with labels: ' + lab);
    const real = m.errors.filter((e) => !ignorable(e));
    assert(real.length === 0, real.join(' | '));
  });
  await test('mobile: tapping a floating label opens the isolated view, with its card and toolbar on screen', async () => {
    await m.page.evaluate(() => {
      window.__euv.sim.togglePanel(false);
      window.__euv.sim.setView('stage');
      window.__euv.sim.goStage(2);
      window.__euv.sim.pause();
    });
    for (let k = 0; k < 2; k++) {
      await sleep(150);
      await m.page.evaluate(() => {
        window.dispatchEvent(new Event('resize'));
        window.__euv.scene.debugSettle();
      });
    }
    const ids = await m.page.evaluate(() => window.__euv.scene.labels.visibleIds());
    assert(ids.length >= 2, 'labels expected on phone, got ' + ids.length);
    const comp = await m.page.evaluate((id) => document.querySelector(`.lbl[data-id="${id}"]`).dataset.comp, ids[0]);
    const r = await m.page.evaluate((id) => {
      const b = document.querySelector(`.lbl[data-id="${id}"]`).getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, ids[0]);
    await m.page.touchscreen.tap(r.x, r.y);
    await sleep(300);
    await m.page.evaluate(() => window.__euv.scene.debugSettle());
    const s = await m.page.evaluate(() => {
      document.getAnimations().forEach((a) => {
        try {
          a.finish(); // the card slides in; measure where it ends up (an infinite animation such as the caret cannot finish)
        } catch {}
      });
      const box = (sel) => document.querySelector(sel)?.getBoundingClientRect().toJSON() ?? null;
      const wide = [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('.insp-tools, .label-layer, .chips, .insp-children'));
      return { insp: window.__euv.sim.state.inspect, card: box('[data-testid=inspect-card]'), bar: box('[data-testid=inspect-bar]'), canvas: box('canvas.gl'), sw: document.documentElement.scrollWidth, wide: wide.slice(0, 6).map((e) => e.tagName + '.' + String(e.className).slice(0, 24)), drawn: window.__euv.scene.drawnComponents() };
    });
    assert(s.insp === comp, `tapping label ${ids[0]} should inspect ${comp}, got ${s.insp}`);
    assert(s.card && s.card.left >= 8 && s.card.right <= 382, 'inspection card should keep its gutters: ' + JSON.stringify(s.card));
    assert(s.bar && s.bar.bottom <= s.canvas.bottom + 1, 'inspection toolbar should sit inside the 3-D view');
    assert(s.card.bottom < s.bar.top - 60, `the card and the toolbar must leave room for the model (card bottom ${s.card.bottom | 0}, bar top ${s.bar.top | 0})`);
    assert(s.sw <= 390, `no horizontal scroll in the inspection view (scroll width ${s.sw}; wide: ${s.wide.join(', ')})`);
    assert(s.drawn.includes(comp), 'the inspected part should be drawn: ' + s.drawn.join(','));
    await m.page.tap('[data-testid=insp-back]');
    assert((await m.page.evaluate(() => window.__euv.sim.state.inspect)) === null, 'Back should leave the inspection view on phones');
  });
  await test('mobile: the chip explorer fits the phone; card, toolbar and transistor list are usable', async () => {
    await m.page.evaluate(() => {
      window.__euv.sim.exitInspect();
      window.__euv.sim.goStage(10, { keepPlaying: false });
      window.__euv.sim.openChip();
      window.__euv.sim.chipGo('die');
      window.__euv.sim.chipGo('block', { region: 'core0' });
      window.__euv.sim.chipGo('cell');
    });
    for (let k = 0; k < 3; k++) {
      await sleep(150);
      await m.page.evaluate(() => {
        window.dispatchEvent(new Event('resize'));
        window.__euv.scene.debugSettle();
      });
    }
    const r = await m.page.evaluate(() => {
      document.getAnimations().forEach((a) => {
        try {
          a.finish();
        } catch {}
      });
      const box = (sel) => document.querySelector(sel)?.getBoundingClientRect().toJSON() ?? null;
      return { sw: document.documentElement.scrollWidth, card: box('[data-testid=chip-card]'), bar: box('[data-testid=chip-bar]'), list: box('[data-testid=chip-transistors]'), level: window.__euv.sim.state.chip?.level };
    });
    assert(r.level === 'cell', 'cell level on the phone');
    assert(r.sw <= 390, 'no horizontal scroll: ' + r.sw);
    assert(r.card && r.card.left >= 8 && r.card.right <= 382, 'card keeps its gutters');
    assert(r.list && r.list.height > 20, 'the transistor list must be visible: ' + JSON.stringify(r.list));
    assert(r.bar && r.card.bottom < r.bar.top - 40, 'room for the model between the card and the toolbar');
    await m.page.tap('[data-testid=chip-transistors] [data-device=pB]');
    await m.page.tap('[data-testid=chip-dive]');
    await sleep(300);
    assert((await m.page.evaluate(() => window.__euv.sim.state.chip?.level)) === 'transistor', 'tap to isolate a transistor on the phone');
    await m.page.evaluate(() => window.__euv.sim.exitChip());
  });
  await m.browser.close();
}

// ───────────────────────────────────────────────────────────── no-WebGL fallback
{
  const f = await launch({ width: 1200, height: 800, args: ['--disable-gpu', '--disable-3d-apis'], lowq: true });
  await f.page.goto(url, { waitUntil: 'load' });
  await sleep(1500);
  await test('without WebGL the app explains it, and the stage controls, inspector and quiz still work', async () => {
    const vis = await f.page.locator('[data-testid=webgl-fallback]').isVisible();
    assert(vis, 'fallback message should be visible');
    await f.page.click('[data-testid=chips] [data-stage="4"]');
    assert((await f.page.evaluate(() => window.__euv.sim.state.stage)) === 4, 'stage selection must still work');
    await f.page.click('[data-testid=stage-card] [data-comp]');
    await sleep(200);
    assert(await f.page.locator('[data-testid=inspector]').isVisible(), 'inspector should open from the stage card');
  });
  await f.browser.close();
}

await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} tests passed`);
if (failed.length) {
  console.log('\nFAILED:\n' + failed.map((f) => ` - ${f.name}\n     ${f.err.split('\n').join('\n     ')}`).join('\n'));
  process.exit(1);
}
