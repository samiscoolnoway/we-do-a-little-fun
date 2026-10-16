// Usage: node tests/shots.mjs <outdir> '<json array of {name,T|stage,p,view,tone,atm,select,w,h}>'
import { startServer, launch, ready, setScene, sleep } from './lib.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const [outDir, spec] = process.argv.slice(2);
const shots = JSON.parse(spec);
const { server, url } = await startServer(dir);
const { browser, page, errors } = await launch({ width: shots[0].w || 1440, height: shots[0].h || 860 });
await ready(page, url);
for (const s of shots) {
  if (s.w && s.h) await page.setViewportSize({ width: s.w, height: s.h });
  await page.evaluate(({ atm, panel, sel, tone, dose }) => {
    const { sim } = window.__euv;
    sim.setAtmosphere(atm || 'vacuum');
    sim.setTone(tone || 'positive');
    sim.setDose(dose || 1);
    sim.togglePanel(!!panel);
    sim.select(sel || null);
  }, { atm: s.atm, panel: s.panel, sel: s.select, tone: s.tone, dose: s.dose });
  if (s.focus) await page.evaluate((id) => window.__euv.sim.focusComponent(id), s.focus);
  await setScene(page, { stage: s.stage, p: s.p ?? 0.5, T: s.T, view: s.focus ? undefined : (s.view || 'stage'), settle: s.settle ?? 3200 });
  await page.screenshot({ path: path.join(outDir, `${s.name}.png`) });
  const labels = await page.evaluate(() => window.__euv.scene.labels.visibleIds().length);
  console.log(s.name, 'labels:', labels);
}
const real = errors.filter((e) => !/Failed to load resource/.test(e));
if (real.length) console.log('ERRORS:\n' + real.join('\n'));
await browser.close();
server.close();
