// Checks the single-file builds produced by scripts/make-standalone.mjs:
//   dist/standalone.html opened from disk (file://), and dist/artifact.html wrapped in a minimal page skeleton
//   the way a host that accepts fragments would wrap it. Each must start WebGL, draw the scene and stay free of console errors.
//   npm run build && node tests/standalone.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from './lib.mjs';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const results = [];
const ignorable = (e) => /Failed to load resource/.test(e);

async function check(name, open) {
  const { browser, page, errors } = await launch({ width: 1280, height: 800, lowq: true });
  try {
    await open(page);
    await page.waitForFunction(() => window.__euv && window.__euv.scene, null, { timeout: 30000 });
    await sleep(800);
    const r = await page.evaluate(() => {
      const c = window.__euv.scene;
      const stats = c.debugStats();
      const px = c.debugSamplePixels();
      return {
        title: document.title,
        webgl: window.__euv.sim.state.webgl,
        calls: stats.calls,
        triangles: stats.triangles,
        distinct: px.distinct,
        overflow: document.documentElement.scrollWidth > innerWidth,
        stageButtons: document.querySelectorAll('[data-testid=chips] [data-stage]').length,
        labels: c.labels.visibleIds().length,
      };
    });
    const real = errors.filter((e) => !ignorable(e));
    const problems = [];
    if (r.title !== 'EUV Lithography Simulator') problems.push(`title "${r.title}"`);
    if (r.webgl !== 'ok') problems.push(`webgl ${r.webgl}`);
    if (r.calls < 40 || r.triangles < 5000) problems.push(`scene looks empty: ${r.calls} calls, ${r.triangles} triangles`);
    if (r.distinct < 10) problems.push(`canvas looks blank (${r.distinct} distinct colours)`);
    if (r.overflow) problems.push('horizontal overflow');
    if (r.stageButtons !== 11) problems.push(`${r.stageButtons} stage buttons`);
    if (r.labels < 4) problems.push(`only ${r.labels} labels shown`);
    if (real.length) problems.push('console errors: ' + real.join(' | '));
    results.push({ name, ok: problems.length === 0, err: problems.join('; ') });
    console.log(`  ${problems.length ? '✗' : '✓'} ${name}${problems.length ? '\n      ' + problems.join('\n      ') : ` (${r.calls} draw calls, ${r.triangles} triangles, ${r.labels} labels)`}`);
  } catch (e) {
    results.push({ name, ok: false, err: e.message });
    console.log(`  ✗ ${name}\n      ${e.message}`);
  } finally {
    await browser.close();
  }
}

console.log('\nSingle-file build checks\n');
const standalone = path.join(dist, 'standalone.html');
const fragment = path.join(dist, 'artifact.html');
for (const f of [standalone, fragment]) if (!fs.existsSync(f)) throw new Error(`${f} is missing: run "npm run build" first`);

await check('standalone.html runs from disk (file://) without a server', (page) => page.goto('file://' + standalone, { waitUntil: 'load' }));

await check('artifact.html works inside a minimal host skeleton', async (page) => {
  const html = fs.readFileSync(fragment, 'utf8');
  const skeleton = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${html}</body></html>`;
  await page.setContent(skeleton, { waitUntil: 'load' });
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} single-file checks passed`);
process.exit(failed.length ? 1 : 0);
