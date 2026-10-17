// End-to-end tests of the production build in headless Chromium: real clicks, typing and downloads, with
// assertions on the application state and on rendered pixels. Run: npm run build && npm run test:e2e
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, launch, ready, runTests, sleep, startServer, state, waitDone } from './lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error('dist/ not found: run `npm run build` first');
  process.exit(1);
}
const { server, url } = await startServer(root);
const { browser, page, errors } = await launch();
await ready(page, url);

const click = (id) => page.click(`[data-testid="${id}"]`);
const tab = (id) => click(`tab-${id}`);
const text = (id) => page.locator(`[data-testid="${id}"]`).innerText();
const setNumber = async (id, v) => {
  const el = page.locator(`[data-testid="${id}"]`);
  await el.fill(String(v));
  await el.press('Enter');
};
const openSection = async (id) => {
  const open = await page.locator(`[data-testid="${id}"]`).evaluate((d) => d.open);
  if (!open) await page.click(`[data-testid="${id}"] > summary`);
};
/** distinct colours in a 24 × 16 sample grid of a canvas layer (0 = WebGL field, 1 = overlay) */
const canvasColours = (layer) =>
  page.evaluate((layer) => {
    const c = document.querySelectorAll('.canvas-wrap canvas')[layer];
    const tmp = document.createElement('canvas');
    tmp.width = c.width;
    tmp.height = c.height;
    const ctx = tmp.getContext('2d');
    ctx.drawImage(c, 0, 0);
    const seen = new Set();
    let opaque = 0;
    for (let i = 1; i < 24; i++)
      for (let j = 1; j < 16; j++) {
        const d = ctx.getImageData(Math.floor((i * c.width) / 24), Math.floor((j * c.height) / 16), 1, 1).data;
        if (d[3] > 0) opaque++;
        seen.add(`${d[0] >> 3},${d[1] >> 3},${d[2] >> 3},${d[3] >> 6}`);
      }
    return { distinct: seen.size, opaque };
  }, layer);
const canvasPoint = async (fx, fy) => {
  const b = await page.locator('[data-testid="flow-canvas"]').boundingBox();
  return [b.x + b.width * fx, b.y + b.height * fy];
};

const tests = [
  [
    'loads without errors, builds the mesh, labels the model as 2D and inviscid',
    async () => {
      const s = await state(page);
      assert(s.status === 'ready' && s.steps === 0, `initial state ${JSON.stringify(s)}`);
      const badges = await page.locator('.view-badges').innerText();
      assert(/2D planar flow/.test(badges) && /Inviscid Euler/.test(badges), `badges: ${badges}`);
      const cells = await text('diag-cells');
      assert(/96\s*×\s*48/.test(cells), `mesh diag: ${cells}`);
      assert(errors.length === 0, `console errors: ${errors.join(' | ')}`);
    },
  ],
  [
    'Step advances exactly one step, Step ×10 exactly ten',
    async () => {
      await click('btn-step');
      await page.waitForFunction(() => window.aerothermo.store.state.snap.diag.steps === 1);
      await click('btn-step10');
      await page.waitForFunction(() => window.aerothermo.store.state.snap.diag.steps === 11);
      assert((await text('diag-steps')) === '11', 'workbench shows 11 steps');
    },
  ],
  [
    'Run converges; the workbench reports converged with real diagnostics; the field is drawn',
    async () => {
      await click('btn-run');
      await waitDone(page);
      const s = await state(page);
      assert(s.status === 'converged', `status ${s.status}`);
      const st = await text('diag-status');
      assert(/Converged/.test(st), `status text ${st}`);
      assert(/^0\.0\d+/.test(await text('diag-residual')), 'residual shown');
      assert((await text('diag-invalid')) === 'none', 'no invalid states');
      const field = await canvasColours(0);
      assert(field.distinct > 15, `field canvas looks blank: ${field.distinct} colours`);
      assert(await page.locator('[data-testid="residual-plot"] path.series').count() === 2, 'two residual series');
    },
  ],
  [
    'changing a flow parameter shows the restart banner and leaves the results untouched',
    async () => {
      const before = await state(page);
      await setNumber('in-mach', 4);
      await page.waitForSelector('[data-testid="restart-banner"]');
      const after = await state(page);
      assert(after.runMach === 3 && after.editedMach === 4, `configs ${JSON.stringify(after)}`);
      assert(after.steps === before.steps && after.status === 'converged', 'results unchanged');
    },
  ],
  [
    'Reset returns to the initial state with the parameters of the results (banner stays)',
    async () => {
      await click('btn-reset');
      await page.waitForFunction(() => window.aerothermo.store.state.snap?.diag.steps === 0);
      const s = await state(page);
      assert(s.runMach === 3 && s.status === 'ready', `after reset ${JSON.stringify(s)}`);
      assert(await page.locator('[data-testid="restart-banner"]').count() === 1, 'banner still shown');
    },
  ],
  [
    'Restart applies the edited parameters; the banner disappears',
    async () => {
      await click('btn-restart');
      await page.waitForFunction(() => window.aerothermo.store.state.snap?.diag.steps === 0 && window.aerothermo.store.state.run.flow.mach === 4);
      assert(await page.locator('[data-testid="restart-banner"]').count() === 0, 'banner gone');
    },
  ],
  [
    'Pause stops the solver, Resume continues it',
    async () => {
      await click('btn-run');
      await page.waitForFunction(() => window.aerothermo.store.state.snap.diag.steps > 20);
      await click('btn-pause');
      // wait for the worker to confirm the pause (snapshots already in flight may still arrive before it)
      await page.waitForFunction(() => !window.aerothermo.store.state.running && !window.aerothermo.store.state.pausePending);
      const a = (await state(page)).steps;
      await sleep(800);
      const b = (await state(page)).steps;
      assert(a === b, `steps changed while paused: ${a} → ${b}`);
      const label = await page.locator('[data-testid="btn-run"]').innerText();
      assert(label === 'Resume', `run button says ${label}`);
      await click('btn-run');
      await page.waitForFunction((n) => window.aerothermo.store.state.snap.diag.steps > n, b);
      await waitDone(page);
    },
  ],
  [
    'Restore defaults resets the controls (results stay until Restart)',
    async () => {
      await click('btn-defaults');
      await page.waitForFunction(() => document.querySelector('[data-testid="in-mach"]').value === '3', null, { timeout: 5000 });
      const s = await state(page);
      assert(s.runMach === 4, 'results still for M = 4');
      await page.waitForSelector('[data-testid="restart-banner"]');
      await click('btn-restart');
      await click('btn-run');
      await waitDone(page);
    },
  ],
  [
    'the probe reads computed cell values: freestream upstream, interpretation, nothing inside the body',
    async () => {
      await tab('probe');
      // upstream point: left edge of the view at mid height
      const [ux, uy] = await canvasPoint(0.04, 0.3);
      await page.mouse.click(ux, uy);
      await page.waitForSelector('[data-testid="probe"]');
      const mach = await page.locator('[data-testid="probe-mach"] td').nth(1).innerText();
      assert(Math.abs(Number(mach) - 3) < 1e-3, `Mach upstream ${mach}`);
      const region = await page.locator('[data-testid="probe-interpretation"]').getAttribute('data-region');
      assert(region === 'freestream', `region ${region}`);
      // the probe value equals the solver's own cell value
      const same = await page.evaluate(() => {
        const s = window.aerothermo.store.state;
        const shown = Number(document.querySelector('[data-testid="probe-p"] td:nth-child(2)').textContent);
        const head = document.querySelector('.probe-head').textContent.match(/i = (\d+), j = (\d+)/);
        const c = Number(head[2]) * s.mesh.ni + Number(head[1]);
        return Math.abs(shown - s.snap.fields.p[c]) / s.snap.fields.p[c];
      });
      assert(same < 1e-4, `probe p differs from the cell value by ${same}`);
      // centre of the body
      const b = await page.evaluate(() => {
        const s = window.aerothermo.store.state;
        return { x: s.mesh.bodyX[0], y: s.mesh.bodyY[0] };
      });
      await page.evaluate(() => window.aerothermo.store.setProbe({ x: 0, y: 0 }));
      await page.waitForSelector('[data-testid="probe-outside"]');
      assert(/inside the body/.test(await text('probe-outside')), 'inside-body message');
      assert(b.x < 0, 'body outline available');
    },
  ],
  [
    'field selector changes the legend; overlays change the rendered overlay',
    async () => {
      await page.selectOption('[data-testid="sel-field"]', 'T');
      await page.waitForFunction(() => /Temperature T/.test(document.querySelector('[data-testid="legend"]').textContent));
      assert(/\[K\]/.test(await text('legend')), 'legend unit K');
      const before = await canvasColours(1);
      await click('tg-mesh');
      await click('tg-vectors');
      await sleep(300);
      const after = await canvasColours(1);
      assert(after.opaque > before.opaque, `overlay pixels ${before.opaque} → ${after.opaque}`);
      await click('tg-mesh');
      await click('tg-vectors');
    },
  ],
  [
    'surface heating: stagnation heat flux and comparison values are shown, with assumptions',
    async () => {
      await tab('heating');
      const q = await text('q-stag');
      const val = Number(q.match(/[\d.]+/)[0]);
      assert(val > 10 && val < 30, `q_stag ${q}`);
      assert(/kW\/m²/.test(await text('q-sg')), 'Sutton–Graves comparison');
      const a = await text('heating-assumptions');
      assert(/laminar/.test(a) && /not area-averaged/.test(a) && /Anderson/.test(a), 'assumptions and source shown');
      assert(await page.locator('[data-testid="heating-plot"] path.series').count() === 1, 'heating plot');
    },
  ],
  [
    'heat shield: changing the thickness updates the back-face temperature without a flow restart',
    async () => {
      await tab('thermal');
      await page.waitForSelector('[data-testid="t-back"]');
      const before = Number((await text('t-back')).match(/[\d.]+/)[0]);
      await openSection('sec-thermal');
      await setNumber('in-thickness', 10);
      await page.waitForFunction((b) => Number(document.querySelector('[data-testid="t-back"]').textContent.match(/[\d.]+/)[0]) !== b, before);
      const after = Number((await text('t-back')).match(/[\d.]+/)[0]);
      assert(after > before + 5, `thinner shield back face ${before} → ${after}`);
      assert(await page.locator('[data-testid="restart-banner"]').count() === 0, 'no restart needed');
      assert(Number(await text('energy-check')) < 1e-6, 'energy balance closes');
      await setNumber('in-thickness', 30);
    },
  ],
  [
    'experiment: two thicknesses add two rows; CSV and JSON exports download with units',
    async () => {
      await tab('experiments');
      await page.click('[data-testid="experiment-thickness"] > summary');
      await click('run-experiment-thickness');
      await page.waitForFunction(() => !window.aerothermo.store.state.experiment && window.aerothermo.store.state.rows.length === 2, null, { timeout: 120000 });
      const rows = await page.locator('[data-testid="comparison-table"] tbody tr').count();
      assert(rows === 2, `${rows} rows`);
      const [dl] = await Promise.all([page.waitForEvent('download'), click('btn-export-csv')]);
      const csv = fs.readFileSync(await dl.path(), 'utf8').trim().split('\n');
      assert(csv.length === 3 && /T_back \(end\) \[K\]/.test(csv[0]), `csv header ${csv[0]}`);
      const [dj] = await Promise.all([page.waitForEvent('download'), click('btn-export-json')]);
      const json = JSON.parse(fs.readFileSync(await dj.path(), 'utf8'));
      assert(json.rows.length === 2 && json.rows[1].TbackEnd < json.rows[0].TbackEnd, 'thicker shield has a cooler back face');
      const [df] = await Promise.all([page.waitForEvent('download'), click('btn-export-fields')]);
      const fields = fs.readFileSync(await df.path(), 'utf8').trim().split('\n');
      assert(fields.length === 96 * 48 + 1, `fields csv has ${fields.length} lines`);
    },
  ],
  [
    'learn: levels change the text; an activity needs a prediction, then runs and compares',
    async () => {
      await tab('learn');
      const t1 = await text('topic-scene');
      await click('level-numerical');
      const t2 = await text('topic-scene');
      assert(t1 !== t2 && /O-grid/.test(t2), 'numerical text shown');
      const btn = page.locator('[data-testid="activity-run-conductivity"]');
      assert(await btn.isDisabled(), 'run disabled before a prediction');
      await page.locator('[data-testid="activity-conductivity"] input[type=radio]').first().check();
      await btn.click();
      await page.waitForSelector('[data-testid="activity-result-conductivity"]', { timeout: 120000 });
      assert(/matches the computation/.test(await text('activity-result-conductivity')), 'cooler surface was predicted and computed');
    },
  ],
  [
    'an unstable setting is caught: failure reported with its location, Run disabled, last valid state kept',
    async () => {
      await openSection('sec-numerics');
      await page.selectOption('[data-testid="in-scheme"]', 'explicit');
      await setNumber('in-cfl', 1.5);
      await setNumber('in-mach', 6);
      await click('btn-restart');
      await page.waitForFunction(() => window.aerothermo.store.state.snap?.diag.steps === 0 && window.aerothermo.store.state.run.flow.mach === 6);
      await tab('workbench');
      await click('btn-run');
      await waitDone(page);
      const s = await state(page);
      assert(s.status === 'failed', `status ${s.status}`);
      const f = await text('failure');
      assert(/non-positive|non-finite/.test(f) && /cell \(i = \d+, j = \d+\)/.test(f), `failure text: ${f}`);
      assert(await page.locator('[data-testid="btn-run"]').isDisabled(), 'Run disabled after failure');
      const finite = await page.evaluate(() => Array.from(window.aerothermo.store.state.snap.fields.p).every((v) => v > 0 && Number.isFinite(v)));
      assert(finite, 'displayed state is physical');
      await click('btn-defaults');
      await click('btn-restart');
    },
  ],
  [
    'no console errors during the whole session',
    async () => {
      assert(errors.length === 0, errors.join(' | '));
    },
  ],
];

console.log('AeroThermo Lab end-to-end tests (desktop 1440 × 900)');
let failed = await runTests(tests);
await browser.close();

// phone layout
const m = await launch({ width: 390, height: 844, mobile: true, dark: true });
await ready(m.page, url);
console.log('\nPhone layout (390 × 844, dark)');
failed += await runTests([
  [
    'no horizontal page scroll; the compact run strip runs the solver',
    async () => {
      const over = await m.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(over <= 0, `page is ${over}px wider than the screen`);
      await m.page.click('[data-testid="m-run"]');
      await waitDone(m.page);
      const s = await state(m.page);
      assert(s.status === 'converged', `status ${s.status}`);
      assert(m.errors.length === 0, m.errors.join(' | '));
    },
  ],
]);
await m.browser.close();
server.close();
process.exit(failed ? 1 : 0);
