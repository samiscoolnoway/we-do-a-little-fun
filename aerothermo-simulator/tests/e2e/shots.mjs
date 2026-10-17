// Documentation screenshots (dark theme). Run: npm run build && node tests/e2e/shots.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, ready, sleep, startServer, waitDone } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../dist');
const out = path.resolve(here, '../../docs/images');
const { server, url } = await startServer(root);

async function shot(name, { width = 1440, height = 900, mobile = false, setup }) {
  const { browser, page } = await launch({ width, height, mobile, dark: true });
  await ready(page, url);
  await setup(page);
  await sleep(700);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  await browser.close();
  console.log('saved', name);
}
const configure = (page, f) =>
  page.evaluate((src) => {
    const s = window.aerothermo.store;
    const c = JSON.parse(JSON.stringify(s.state.edited));
    new Function('c', src)(c);
    s.setEdited(c);
    s.restart();
  }, f);
const run = async (page) => {
  await page.waitForFunction(() => window.aerothermo.store.state.snap?.diag.steps === 0);
  await page.evaluate(() => window.aerothermo.store.runSim());
  await waitDone(page);
};

await shot('mach6-streamlines', {
  setup: async (p) => {
    await configure(p, 'c.flow.mach = 6; c.numerics.mesh = "medium";');
    await run(p);
  },
});
await shot('pressure-mesh-probe', {
  setup: async (p) => {
    await run(p);
    await p.selectOption('[data-testid="sel-field"]', 'p');
    await p.click('[data-testid="tg-mesh"]');
    await p.click('[data-testid="tg-vectors"]');
    await p.click('[data-testid="tg-stream"]');
    await p.evaluate(() => window.aerothermo.store.setProbe({ x: -0.62, y: 0.12 }));
    await p.click('[data-testid="tab-probe"]');
  },
});
await shot('heating', {
  setup: async (p) => {
    await configure(p, 'c.flow.mach = 6;');
    await run(p);
    await p.selectOption('[data-testid="sel-field"]', 'T');
    await p.click('[data-testid="tab-heating"]');
    await p.evaluate(() => (document.querySelector('.right').scrollTop = 520));
  },
});
await shot('heat-shield', {
  setup: async (p) => {
    await configure(p, 'c.flow.mach = 6;');
    await run(p);
    await p.selectOption('[data-testid="sel-field"]', 'T');
    await p.click('[data-testid="tab-thermal"]');
    await p.evaluate(() => (document.querySelector('.right').scrollTop = 330));
  },
});
await shot('incidence-entropy', {
  setup: async (p) => {
    await configure(p, 'c.flow.mach = 4; c.flow.angle = 10; c.numerics.mesh = "medium";');
    await run(p);
    await p.selectOption('[data-testid="sel-field"]', 'ds');
  },
});
await shot('experiments', {
  setup: async (p) => {
    await p.click('[data-testid="tab-experiments"]');
    await p.click('[data-testid="experiment-mach"] > summary');
    await p.click('[data-testid="run-experiment-mach"]');
    await p.waitForFunction(() => !window.aerothermo.store.state.experiment, null, { timeout: 120000 });
    await p.evaluate(() => (document.querySelector('.right').scrollTop = document.querySelector('[data-testid="comparison-table"]').offsetTop - 200));
  },
});
await shot('phone', {
  width: 390,
  height: 844,
  mobile: true,
  setup: async (p) => {
    await run(p);
  },
});
server.close();
