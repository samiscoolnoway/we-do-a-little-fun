// Shared helpers for the Playwright-based checks (screenshots and end-to-end tests).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

export function startServer(dir, port = 0) {
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
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

export async function launch({ width = 1440, height = 860, mobile = false, args, lowq = false } = {}) {
  const browser = await chromium.launch({
    headless: true,
    args: args || ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
  });
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    hasTouch: mobile,
    isMobile: mobile,
  });
  if (lowq) await ctx.addInitScript(() => { window.__EUV_LOWQ = true; });
  const page = await ctx.newPage();
  const errors = [];
  const logs = [];
  page.on('console', (m) => {
    const t = m.type();
    const text = m.text();
    if (t === 'error' || t === 'warning') {
      if (/GPU stall|GL Driver Message|ReadPixels/.test(text)) return;
      logs.push(`[${t}] ${text}`);
      if (t === 'error') errors.push(text);
    }
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // never wait for web fonts: the layout must work with the fallback stack
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  return { browser, ctx, page, errors, logs };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function ready(page, url) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__euv && window.__euv.scene, null, { timeout: 30000 });
  await sleep(600);
}

/** Pause and jump to a timeline position, then give the camera tween and label smoothing time to settle. */
export async function setScene(page, { stage, p = 0.5, T, view, tone, settle = 2600, extra } = {}) {
  await page.evaluate(
    ({ stage, p, T, view, tone, extra }) => {
      const { sim } = window.__euv;
      sim.pause();
      if (view) sim.setView(view);
      if (tone) sim.setTone(tone);
      if (extra) extra(sim);
      if (T !== undefined) sim.setTime(T);
      else if (stage !== undefined) {
        const starts = window.__euv.starts;
        sim.goStage(stage, { keepPlaying: false });
        if (starts) sim.setTime(starts[stage] + p * window.__euv.durations[stage]);
      }
    },
    { stage, p, T, view, tone, extra: undefined },
  );
  // Let React commit and the overlay cards report their size, then finish the camera glide and label easing
  // synchronously: waiting for it in wall-clock time is unreliable when a software-rendered frame takes seconds.
  await sleep(Math.min(settle, 300));
  for (let k = 0; k < 2; k++) {
    await page.evaluate(() => {
      window.dispatchEvent(new Event('resize'));
      window.__euv.scene.debugSettle();
    });
    await sleep(150);
  }
  // CSS fades (labels, leader lines) only advance in presented frames, which a software renderer produces slowly
  await sleep(Math.max(0, settle - 600));
}
