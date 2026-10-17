// Measures solver performance in the browser (Web Worker, production build): steps and wall time to convergence
// for each mesh at M = 3 and M = 0.5. Run: npm run build && node tests/e2e/perf.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, ready, startServer, waitDone } from './lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
const { server, url } = await startServer(root);
const { browser, page } = await launch();
await ready(page, url);
const rows = [];
for (const [mach, mesh] of [[3, 'coarse'], [3, 'medium'], [3, 'fine'], [0.5, 'coarse'], [0.5, 'medium']]) {
  await page.evaluate(({ mach, mesh }) => {
    const s = window.aerothermo.store;
    const c = JSON.parse(JSON.stringify(s.state.edited));
    c.flow = mach < 1 ? { mach, Tinf: 288.15, pinf: 101325, angle: 0 } : { mach, Tinf: 220, pinf: 2500, angle: 0 };
    c.numerics.mesh = mesh;
    c.numerics.maxSteps = 20000;
    s.setEdited(c);
    s.restart();
  }, { mach, mesh });
  await page.waitForFunction(() => window.aerothermo.store.state.snap?.diag.steps === 0);
  const t0 = Date.now();
  await page.evaluate(() => window.aerothermo.store.runSim());
  await waitDone(page, 600000);
  const sec = (Date.now() - t0) / 1000;
  const d = await page.evaluate(() => window.aerothermo.store.state.snap.diag);
  rows.push({ mach, mesh: `${d.ni}×${d.nj}`, scheme: d.scheme, status: d.status, steps: d.steps, 'wall s': +sec.toFixed(1), 'ms/step': +((sec * 1000) / d.steps).toFixed(2), drop: +d.drop.toFixed(2) });
  console.log(JSON.stringify(rows.at(-1)));
}
console.table(rows);
await browser.close();
server.close();
