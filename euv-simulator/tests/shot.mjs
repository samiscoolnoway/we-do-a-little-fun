// Usage: node tests/shot.mjs <out.png> [--stage N] [--p 0.5] [--T sec] [--view machine|stage|component] [--tone positive|negative|compare] [--w 1440] [--h 860] [--mobile] [--atm air]
import { startServer, launch, ready, setScene, sleep } from './lib.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const args = process.argv.slice(2);
const out = args[0];
const get = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(`--${k}`);
const { server, url } = await startServer(dir);
const { browser, page, errors, logs } = await launch({ width: +get('w', 1440), height: +get('h', 860), mobile: flag('mobile') });
await ready(page, url);
const stage = get('stage'), T = get('T');
const view = get('view'), tone = get('tone'), atm = get('atm');
await page.evaluate(({ atm, panel, sel }) => {
  const { sim } = window.__euv;
  if (atm) sim.setAtmosphere(atm);
  if (panel) sim.togglePanel(true);
  if (sel) sim.select(sel);
}, { atm, panel: flag('panel'), sel: get('select') });
await setScene(page, { stage: stage !== undefined ? +stage : undefined, p: +get('p', 0.5), T: T !== undefined ? +T : undefined, view, tone, settle: +get('settle', 3200) });
await page.screenshot({ path: out });
const info = await page.evaluate(() => ({ labels: window.__euv.scene.labels.visibleIds(), stage: window.__euv.sim.state.stage, t: window.__euv.sim.getTime() }));
console.log(JSON.stringify(info));
if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
if (logs.length && flag('logs')) console.log('LOGS:\n' + logs.join('\n'));
await browser.close();
server.close();
