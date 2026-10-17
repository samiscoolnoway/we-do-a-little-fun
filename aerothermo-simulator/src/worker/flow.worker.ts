/// <reference lib="webworker" />
import { Simulation, computeFields, surfaceData } from '../core/simulation';
import type { FromWorker, ToWorker } from './protocol';

/**
 * Flow-solver worker: owns the Simulation, advances it in time slices so it can still receive pause / step
 * messages, and posts a snapshot of the computed fields after every slice (at most every ~120 ms while running).
 */
const ctx = self as unknown as DedicatedWorkerGlobalScope;
let sim: Simulation | null = null;
let runId = 0;
let running = false;
let force = false;
let timer: ReturnType<typeof setTimeout> | null = null;

const post = (m: FromWorker, transfer: Transferable[] = []) => ctx.postMessage(m, transfer);

function snapshot() {
  if (!sim) return;
  const fields = computeFields(sim);
  const surface = surfaceData(sim);
  const h = sim.history;
  const stride = Math.max(1, Math.ceil(h.length / 1000));
  const n = Math.ceil(h.length / stride);
  const history = new Float32Array(n);
  const historySteps = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const idx = Math.min(h.length - 1, k * stride);
    history[k] = h[idx];
    historySteps[k] = idx + 1;
  }
  if (h.length && historySteps[n - 1] !== h.length) {
    history[n - 1] = h[h.length - 1];
    historySteps[n - 1] = h.length;
  }
  const transfer = [...Object.values(fields).map((a) => a.buffer), history.buffer, historySteps.buffer];
  post({ type: 'snapshot', runId, running, fields, surface, diag: sim.diagnostics(), history, historySteps }, transfer);
}

function loop() {
  timer = null;
  if (!sim || !running) return;
  const t0 = performance.now();
  // advance for ~100 ms per slice, then report
  while (performance.now() - t0 < 100) {
    const k = sim.advance(50, 100 - (performance.now() - t0), force);
    if (k === 0 || sim.done) break;
  }
  if (sim.done && !(force && sim.status !== 'failed' && sim.status !== 'max-steps')) running = false;
  if (sim.status === 'failed' || sim.status === 'max-steps') running = false;
  snapshot();
  if (running) timer = setTimeout(loop, 0);
}

function stop() {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
}

ctx.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  try {
    switch (m.type) {
      case 'init': {
        stop();
        force = false;
        runId = m.runId;
        sim = new Simulation(m.config);
        const mesh = sim.mesh;
        post({
          type: 'mesh',
          runId,
          ni: mesh.ni,
          nj: mesh.nj,
          x: mesh.x,
          y: mesh.y,
          xc: mesh.xc,
          yc: mesh.yc,
          area: mesh.area,
          bodyX: mesh.body!.x,
          bodyY: mesh.body!.y,
          info: mesh.info,
        });
        snapshot();
        break;
      }
      case 'run':
        if (!sim || running) return;
        force = false;
        running = true;
        loop();
        break;
      case 'continue':
        if (!sim || running) return;
        force = true;
        running = true;
        loop();
        break;
      case 'pause':
        stop();
        snapshot();
        break;
      case 'step':
        if (!sim) return;
        stop();
        sim.advance(m.n, Infinity, true);
        snapshot();
        break;
    }
  } catch (err) {
    stop();
    post({ type: 'error', runId, message: err instanceof Error ? err.message : String(err) });
  }
};
