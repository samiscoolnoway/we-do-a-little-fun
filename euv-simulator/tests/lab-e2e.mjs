// End-to-end checks of the unified application: section navigation between the EUV machine, the wafer & transistor
// explorer and the Engineering & Computational Science Lab, and the lab's solver, controls, probe, heating,
// heat-shield, experiments, exports and learning features, all inside the production build (and the single-file
// build). Run after `npm run build`:  npm run test:lab-e2e
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, ready, sleep, startServer } from './lib.mjs';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
if (!fs.existsSync(path.join(dir, 'index.html'))) {
  console.error('dist/ not found: run `npm run build` first');
  process.exit(1);
}
const { server, url } = await startServer(dir);

let pass = 0;
const failed = [];
async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    pass++;
    console.log(`  ✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    failed.push(name);
    console.log(`  ✗ ${name}\n      ${String(e.message).split('\n')[0]}`);
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

/** resource failures other than the font requests the harness blocks on purpose and the (pre-existing) missing favicon */
function watchResources(page) {
  const bad = [];
  page.on('requestfailed', (r) => {
    if (!/fonts\.(googleapis|gstatic)\.com/.test(r.url())) bad.push(`failed ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !/favicon\.ico$/.test(r.url())) bad.push(`${r.status()} ${r.url()}`);
  });
  return bad;
}
/** console errors except the ones caused by the blocked font requests */
const realErrors = (errors) => errors.filter((e) => !/Failed to load resource: net::ERR_FAILED/.test(e));

const labState = (page) =>
  page.evaluate(() => {
    const s = window.__lab.store.state;
    return { steps: s.snap?.diag.steps ?? -1, status: s.snap?.diag.status, running: s.running, runMach: s.run.flow.mach, editedMach: s.edited.flow.mach, rows: s.rows.length };
  });
async function labDone(page, timeout = 180000) {
  await page.waitForFunction(
    () => {
      const s = window.__lab?.store.state;
      return s?.snap && !s.running && ['converged', 'levelled', 'finished', 'max-steps', 'failed'].includes(s.snap.diag.status);
    },
    null,
    { timeout },
  );
}
const tid = (id) => `[data-testid="${id}"]`;

console.log('Unified application · desktop 1440 × 900');
const { browser, page, errors } = await launch({ width: 1440, height: 900 });
const badResources = watchResources(page);
await ready(page, url);
const click = (id) => page.click(tid(id));
const text = (id) => page.locator(tid(id)).innerText();
const setNumber = async (id, v) => {
  const el = page.locator(tid(id));
  await el.fill(String(v));
  await el.press('Enter');
};
const openSection = async (id) => {
  if (!(await page.locator(tid(id)).evaluate((d) => d.open))) await page.click(`${tid(id)} > summary`);
};
const machinePixels = () => page.evaluate(() => window.__euv.scene.debugSamplePixels());

await test('the EUV machine is the main application: it opens first, the section bar offers all three sections', async () => {
  const nav = await page.locator(tid('section-nav')).innerText();
  assert(/ASML EUV Machine/i.test(nav) && /Wafer & Transistor Explorer/i.test(nav) && /Engineering Lab/i.test(nav), `nav: ${nav}`);
  assert((await page.locator(tid('nav-machine')).getAttribute('aria-current')) === 'page', 'machine is the current section');
  assert(await page.locator(tid('viewport')).isVisible(), '3-D viewport visible');
  assert(await page.locator(tid('lab')).count() === 0, 'lab not mounted yet');
  const px = await machinePixels();
  assert(px.distinct >= 10, `machine canvas looks blank (${px.distinct} colours)`);
});

await test('component selection and isolated inspection still work in the machine section', async () => {
  await page.evaluate(() => window.__euv.sim.openCasing());
  await page.evaluate(() => window.__euv.sim.inspect('collector'));
  await page.waitForFunction(() => window.__euv.sim.state.inspect === 'collector');
  await page.waitForSelector('.viewport.is-inspecting');
  await page.evaluate(() => window.__euv.sim.exitInspect());
  await page.waitForFunction(() => !window.__euv.sim.state.inspect);
});

await test('Engineering Lab opens in the same page: 3-D view hidden (kept), timeline paused, worker started, hash #lab', async () => {
  await page.evaluate(() => window.__euv.sim.play());
  await click('nav-lab');
  await page.waitForSelector(tid('lab'));
  await page.waitForFunction(() => window.__lab?.store.state.snap && window.__lab.store.state.mesh, null, { timeout: 30000 });
  assert(!(await page.locator(tid('viewport')).isVisible()), 'machine viewport hidden');
  assert(await page.evaluate(() => !!window.__euv.scene), 'machine scene kept alive');
  assert(await page.evaluate(() => window.__euv.sim.state.playing === false), 'machine timeline paused');
  assert((await page.evaluate(() => location.hash)) === '#lab', 'hash #lab');
  const s = await labState(page);
  assert(s.status === 'ready' && s.steps === 0, `initial lab state ${JSON.stringify(s)}`);
  const badge = await text('zone-badge');
  assert(/separate aerothermodynamics experiment/i.test(badge), `badge: ${badge}`);
  assert(/does not operate like a high-speed vehicle/.test(await text('lab-disclaimer')), 'disclaimer shown in About');
});

await test('machine keyboard shortcuts do not act while the lab is open', async () => {
  await page.locator(tid('lab')).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(' ');
  await page.keyboard.press('ArrowRight');
  await sleep(300);
  const st = await page.evaluate(() => ({ playing: window.__euv.sim.state.playing }));
  assert(!st.playing, 'space did not start the machine timeline');
});

await test('Step advances exactly one solver step in the worker, Step ×10 exactly ten', async () => {
  await click('btn-step');
  await page.waitForFunction(() => window.__lab.store.state.snap.diag.steps === 1);
  await click('btn-step10');
  await page.waitForFunction(() => window.__lab.store.state.snap.diag.steps === 11);
});

await test('Run converges in the worker: same discrete solution as the standalone lab (M = 3: 484 steps, p_stag/pitot 0.993)', async () => {
  await click('btn-run');
  await labDone(page);
  const s = await labState(page);
  assert(s.status === 'converged', `status ${s.status}`);
  await click('tab-workbench');
  assert(/Converged/.test(await text('diag-status')), 'workbench shows converged');
  assert((await text('diag-invalid')) === 'none', 'no invalid states');
  const r = await page.evaluate(() => {
    const st = window.__lab.store.state;
    const pInf = 2500;
    const pitot = 12.061 * pInf; // Rayleigh pitot ratio at M = 3, γ = 1.4
    return { steps: st.snap.diag.steps, ratio: st.snap.surface.p[0] / pitot };
  });
  assert(r.steps === 484, `steps ${r.steps}`);
  assert(Math.abs(r.ratio - 0.993) < 0.002, `p_stag/pitot ${r.ratio}`);
});

await test('restart banner on parameter change; Reset keeps the computed parameters; Restart applies the new ones', async () => {
  await setNumber('in-mach', 4);
  await page.waitForSelector(tid('restart-banner'));
  let s = await labState(page);
  assert(s.runMach === 3 && s.editedMach === 4 && s.status === 'converged', `after edit ${JSON.stringify(s)}`);
  await click('btn-reset');
  await page.waitForFunction(() => window.__lab.store.state.snap?.diag.steps === 0);
  s = await labState(page);
  assert(s.runMach === 3, 'reset used the computed parameters');
  await click('lab-btn-restart');
  await page.waitForFunction(() => window.__lab.store.state.snap?.diag.steps === 0 && window.__lab.store.state.run.flow.mach === 4);
  assert(await page.locator(tid('restart-banner')).count() === 0, 'banner gone after restart');
});

await test('Pause stops the solver (confirmed by the worker), Resume continues it', async () => {
  await click('btn-run');
  await page.waitForFunction(() => window.__lab.store.state.snap.diag.steps > 20);
  await click('btn-pause');
  await page.waitForFunction(() => !window.__lab.store.state.running && !window.__lab.store.state.pausePending);
  const a = (await labState(page)).steps;
  await sleep(800);
  const b = (await labState(page)).steps;
  assert(a === b, `steps changed while paused: ${a} → ${b}`);
  assert((await page.locator(tid('btn-run')).innerText()).toLowerCase() === 'resume', 'button offers Resume');
  await click('btn-run');
  await page.waitForFunction((n) => window.__lab.store.state.snap.diag.steps > n, b);
  await labDone(page);
});

await test('Restore defaults resets the controls; results stay until Restart', async () => {
  await click('btn-defaults');
  await page.waitForFunction(() => document.querySelector('[data-testid="in-mach"]').value === '3');
  assert((await labState(page)).runMach === 4, 'results still for M = 4');
  await click('lab-btn-restart');
  await click('btn-run');
  await labDone(page);
});

await test('the flow field is drawn and the probe reads the solver’s own cell values', async () => {
  const field = await page.evaluate(() => {
    const c = document.querySelector('.atl .canvas-wrap canvas');
    const t = document.createElement('canvas');
    t.width = c.width;
    t.height = c.height;
    const ctx = t.getContext('2d');
    ctx.drawImage(c, 0, 0);
    const seen = new Set();
    for (let i = 1; i < 24; i++) for (let j = 1; j < 16; j++) seen.add(ctx.getImageData(Math.floor((i * c.width) / 24), Math.floor((j * c.height) / 16), 1, 1).data.slice(0, 3).join());
    return seen.size;
  });
  assert(field > 15, `flow canvas looks blank (${field} colours)`);
  await click('tab-probe');
  const b = await page.locator(tid('flow-canvas')).boundingBox();
  await page.mouse.click(b.x + b.width * 0.04, b.y + b.height * 0.3);
  await page.waitForSelector(tid('probe'));
  const mach = Number(await page.locator(`${tid('probe-mach')} td`).nth(1).innerText());
  assert(Math.abs(mach - 3) < 1e-3, `upstream Mach ${mach}`);
  assert((await page.locator(tid('probe-interpretation')).getAttribute('data-region')) === 'freestream', 'interpreted as freestream');
  const diff = await page.evaluate(() => {
    const s = window.__lab.store.state;
    const shown = Number(document.querySelector('[data-testid="probe-p"] td:nth-child(2)').textContent);
    const m = document.querySelector('.probe-head').textContent.match(/i = (\d+), j = (\d+)/);
    const c = Number(m[2]) * s.mesh.ni + Number(m[1]);
    return Math.abs(shown - s.snap.fields.p[c]) / s.snap.fields.p[c];
  });
  assert(diff < 1e-4, `probe differs from the cell value by ${diff}`);
});

await test('field selector and legend units; surface heating and heat-shield conduction computed from the flow', async () => {
  await page.selectOption(tid('sel-field'), 'T');
  await page.waitForFunction(() => /Temperature T/.test(document.querySelector('[data-testid="legend"]').textContent));
  await click('tab-heating');
  const q = Number((await text('q-stag')).match(/[\d.]+/)[0]);
  assert(q > 10 && q < 30, `q_stag ${q} kW/m²`);
  assert(/Anderson/.test(await text('heating-assumptions')), 'source shown');
  await click('tab-thermal');
  const before = Number((await text('t-back')).match(/[\d.]+/)[0]);
  await openSection('sec-thermal');
  await setNumber('in-thickness', 10);
  await page.waitForFunction((b0) => Number(document.querySelector('[data-testid="t-back"]').textContent.match(/[\d.]+/)[0]) !== b0, before);
  const after = Number((await text('t-back')).match(/[\d.]+/)[0]);
  assert(after > before + 5, `thinner shield back face ${before} → ${after}`);
  assert(Number(await text('energy-check')) < 1e-6, 'energy balance closes');
  await setNumber('in-thickness', 30);
});

await test('experiment rows, CSV / JSON / field exports download from the lab', async () => {
  await click('tab-experiments');
  await page.click(`${tid('experiment-thickness')} > summary`);
  await click('run-experiment-thickness');
  await page.waitForFunction(() => !window.__lab.store.state.experiment && window.__lab.store.state.rows.length === 2, null, { timeout: 180000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), click('btn-export-csv')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8').trim().split('\n');
  assert(csv.length === 3 && /T_back \(end\) \[K\]/.test(csv[0]), `csv: ${csv[0]}`);
  const [dj] = await Promise.all([page.waitForEvent('download'), click('btn-export-json')]);
  const json = JSON.parse(fs.readFileSync(await dj.path(), 'utf8'));
  assert(json.rows.length === 2 && json.rows[1].TbackEnd < json.rows[0].TbackEnd, 'thicker shield has the cooler back face');
  const [df] = await Promise.all([page.waitForEvent('download'), click('btn-export-fields')]);
  assert(fs.readFileSync(await df.path(), 'utf8').trim().split('\n').length === 96 * 48 + 1, 'all cells exported');
});

await test('learning content at three levels and a predict-run-compare activity', async () => {
  await click('tab-learn');
  const t1 = await text('topic-scene');
  await click('level-numerical');
  const t2 = await text('topic-scene');
  assert(t1 !== t2 && /O-grid/.test(t2), 'numerical level text');
  const btn = page.locator(tid('activity-run-conductivity'));
  assert(await btn.isDisabled(), 'needs a prediction first');
  await page.locator(`${tid('activity-conductivity')} input[type=radio]`).first().check();
  await btn.click();
  await page.waitForSelector(tid('activity-result-conductivity'), { timeout: 180000 });
});

await test('an unstable setting is caught and reported with its location', async () => {
  await openSection('sec-numerics');
  await page.selectOption(tid('in-scheme'), 'explicit');
  await setNumber('in-cfl', 1.5);
  await setNumber('in-mach', 6);
  await click('lab-btn-restart');
  await page.waitForFunction(() => window.__lab.store.state.snap?.diag.steps === 0 && window.__lab.store.state.run.flow.mach === 6);
  await click('tab-workbench');
  await click('btn-run');
  await labDone(page);
  assert((await labState(page)).status === 'failed', 'failed status');
  assert(/cell \(i = \d+, j = \d+\)/.test(await text('failure')), 'failure location reported');
  await click('btn-defaults');
  await click('lab-btn-restart');
  await page.waitForFunction(() => window.__lab.store.state.run.flow.mach === 3 && window.__lab.store.state.snap?.diag.steps === 0);
});

await test('wafer & transistor explorer opens from the section bar and renders; the lab keeps its results meanwhile', async () => {
  await click('btn-run');
  await labDone(page);
  const steps = (await labState(page)).steps;
  await click('nav-explorer');
  await page.waitForFunction(() => window.__euv.sim.state.chip?.level === 'wafer');
  assert(await page.locator(tid('lab')).count() === 0, 'lab unmounted');
  assert(await page.locator(tid('viewport')).isVisible(), 'viewport shown again');
  assert((await page.evaluate(() => location.hash)) === '#explorer', 'hash #explorer');
  await sleep(1500);
  const px = await machinePixels();
  assert(px.distinct >= 10, `explorer canvas looks blank (${px.distinct})`);
  await page.evaluate(() => window.__euv.sim.chipGo('die'));
  await page.waitForFunction(() => window.__euv.sim.state.chip?.level === 'die');
  await click('nav-lab');
  await page.waitForFunction(() => window.__lab.store.state.snap);
  assert((await labState(page)).steps === steps, 'lab results kept across sections');
});

await test('back to the machine: the scene renders again and inspection still works', async () => {
  await click('nav-machine');
  await page.waitForFunction(() => !window.__euv.sim.state.chip);
  await sleep(1500);
  const px = await machinePixels();
  assert(px.distinct >= 10, `machine canvas blank after returning (${px.distinct})`);
  await page.evaluate(() => window.__euv.sim.inspect('waferStage'));
  await page.waitForFunction(() => !!window.__euv.sim.state.inspect);
  await page.evaluate(() => window.__euv.sim.exitInspect());
  assert((await page.evaluate(() => location.hash)) === '#machine', 'hash #machine');
});

await test('no console errors and no failed resources or worker loads during the session', async () => {
  const errs = realErrors(errors);
  assert(errs.length === 0, `console errors: ${errs.join(' | ')}`);
  assert(badResources.length === 0, `resources: ${badResources.join(' | ')}`);
});
await browser.close();

console.log('\nDeep link and phone layout');
await test('opening the app at #lab shows the lab directly', async () => {
  const m = await launch({ width: 1280, height: 800 });
  await m.page.goto(`${url}/#lab`, { waitUntil: 'load' });
  await m.page.waitForFunction(() => window.__lab?.store.state.snap, null, { timeout: 30000 });
  assert(await m.page.locator(tid('lab')).isVisible(), 'lab visible');
  await m.browser.close();
});

await test('phone 390 × 844: section bar in the single top-bar row, no horizontal scroll in any section, the lab runs', async () => {
  const m = await launch({ width: 390, height: 844, mobile: true });
  const bad = watchResources(m.page);
  await ready(m.page, url);
  const over = () => m.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert((await over()) <= 0, 'machine: horizontal overflow');
  assert(await m.page.locator(tid('nav-lab')).isVisible(), 'nav visible on phone');
  // the section bar must not add a second row: the top bar keeps the height it had before the integration
  const bar = await m.page.evaluate(() => document.querySelector('[data-testid="topbar"]').getBoundingClientRect().height);
  assert(bar <= 50, `top bar is ${bar}px tall on a phone`);
  await m.page.click(tid('nav-lab'));
  await m.page.waitForFunction(() => window.__lab?.store.state.snap, null, { timeout: 30000 });
  assert((await over()) <= 0, 'lab: horizontal overflow');
  const labOver = await m.page.evaluate(() => {
    const el = document.querySelector('.atl');
    return el.scrollWidth - el.clientWidth;
  });
  assert(labOver <= 0, `lab content wider than the screen by ${labOver}px`);
  await m.page.click(tid('m-run'));
  await labDone(m.page);
  assert((await m.page.evaluate(() => window.__lab.store.state.snap.diag.status)) === 'converged', 'converged on phone');
  await m.page.click(tid('nav-explorer'));
  await m.page.waitForFunction(() => window.__euv.sim.state.chip);
  assert((await over()) <= 0, 'explorer: horizontal overflow');
  assert(realErrors(m.errors).length === 0, realErrors(m.errors).join(' | '));
  assert(bad.length === 0, bad.join(' | '));
  await m.browser.close();
});

console.log('\nSingle-file build');
await test('dist/standalone.html from disk (file://): the lab worker is inlined and the solver converges', async () => {
  const m = await launch({ width: 1440, height: 900 });
  await m.page.goto(pathToFileURL(path.join(dir, 'standalone.html')).href + '#lab', { waitUntil: 'load' });
  await m.page.waitForFunction(() => window.__lab?.store.state.snap, null, { timeout: 30000 });
  await m.page.click(tid('btn-run'));
  await labDone(m.page);
  const st = await m.page.evaluate(() => window.__lab.store.state.snap.diag);
  assert(st.status === 'converged' && st.steps === 484, `standalone lab: ${st.status} after ${st.steps} steps`);
  assert(realErrors(m.errors).length === 0, realErrors(m.errors).join(' | '));
  await m.browser.close();
});

server.close();
console.log(`\n${pass} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
