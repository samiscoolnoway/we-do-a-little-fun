// Helpers for the end-to-end tests: a static server for dist/, a headless Chromium page, and a tiny test runner.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', 'playwright-core', '/opt/node-tools/node_modules/playwright-core', '/opt/node22/lib/node_modules/playwright'].filter(Boolean);
let chromium;
for (const c of candidates) {
  try {
    ({ chromium } = require(c));
    break;
  } catch {
    /* try the next location */
  }
}
if (!chromium) throw new Error('Playwright not found: set PLAYWRIGHT_MODULE to a playwright or playwright-core installation');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

export function startServer(dir) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(dir, p);
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

export async function launch({ width = 1440, height = 900, mobile = false, dark = false } = {}) {
  const exe = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch({ headless: true, executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile, colorScheme: dark ? 'dark' : 'light', acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/GPU stall|GL Driver Message|ReadPixels/.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // never wait for web fonts: the layout must work with the fallback stack
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  return { browser, page, errors };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** open the app and wait until the worker has built the mesh and posted the first snapshot */
export async function ready(page, url) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.aerothermo?.store.state.snap && window.aerothermo.store.state.mesh, null, { timeout: 30000 });
}

export const state = (page) =>
  page.evaluate(() => {
    const s = window.aerothermo.store.state;
    return { steps: s.snap?.diag.steps ?? -1, status: s.snap?.diag.status, running: s.running, runMach: s.run.flow.mach, editedMach: s.edited.flow.mach, runId: s.runId, rows: s.rows.length, experiment: !!s.experiment };
  });

/** wait until the solver has stopped in a terminal state */
export async function waitDone(page, timeout = 120000) {
  await page.waitForFunction(
    () => {
      const s = window.aerothermo.store.state;
      return s.snap && !s.running && ['converged', 'levelled', 'finished', 'max-steps', 'failed'].includes(s.snap.diag.status);
    },
    null,
    { timeout },
  );
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

export async function runTests(tests) {
  let pass = 0;
  const failed = [];
  for (const [name, fn] of tests) {
    const t0 = Date.now();
    try {
      await fn();
      pass++;
      console.log(`  ✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    } catch (e) {
      failed.push(name);
      console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`);
    }
  }
  console.log(`\n${pass} passed, ${failed.length} failed`);
  return failed.length;
}
