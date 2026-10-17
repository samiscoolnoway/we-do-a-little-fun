import { DEFAULT_CONFIG } from '../src/core/config';
import { Store, flowKey } from '../src/ui/store';
import type { ToWorker } from '../src/worker/protocol';

/** a stand-in for the worker that records what the store sends and lets the test reply */
class FakeWorker {
  sent: ToWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  postMessage(m: ToWorker) {
    this.sent.push(structuredClone(m));
  }
  reply(m: unknown) {
    this.onmessage?.({ data: m } as MessageEvent);
  }
}

const snapshot = (runId: number, steps: number, status = 'running', running = true) => ({
  type: 'snapshot',
  runId,
  running,
  fields: {},
  surface: {},
  diag: { steps, status, mode: 'steady' },
  history: new Float32Array(),
  windHistory: new Float32Array(),
  historySteps: new Float32Array(),
});

const boot = () => {
  const s = new Store();
  const w = new FakeWorker();
  s.boot(w as unknown as Worker);
  return { s, w };
};

describe('run / reset / restart semantics', () => {
  it('boots by initialising the default configuration', () => {
    const { s, w } = boot();
    expect(w.sent[0]).toMatchObject({ type: 'init', runId: 1 });
    expect(flowKey((w.sent[0] as { config: typeof DEFAULT_CONFIG }).config)).toBe(flowKey(DEFAULT_CONFIG));
    expect(s.needsRestart()).toBe(false);
  });

  it('editing a flow parameter flags a restart but leaves the results and their configuration untouched', () => {
    const { s, w } = boot();
    w.reply(snapshot(1, 120));
    s.edit('flow', 'mach', 5);
    expect(s.needsRestart()).toBe(true);
    expect(s.state.run.flow.mach).toBe(3);
    expect(s.state.snap?.diag.steps).toBe(120);
  });

  it('editing only heat-shield parameters never requires a flow restart', () => {
    const { s } = boot();
    s.edit('thermal', 'k', 2);
    s.edit('thermal', 'thickness', 0.05);
    expect(s.needsRestart()).toBe(false);
  });

  it('Reset re-initialises with the parameters of the current results, not the edited ones', () => {
    const { s, w } = boot();
    s.edit('flow', 'mach', 5);
    s.reset();
    const init = w.sent.at(-1) as { type: string; runId: number; config: typeof DEFAULT_CONFIG };
    expect(init.type).toBe('init');
    expect(init.runId).toBe(2);
    expect(init.config.flow.mach).toBe(3);
    expect(s.needsRestart()).toBe(true);
    expect(s.state.snap).toBeNull();
  });

  it('Restart applies the edited parameters and clears the restart flag', () => {
    const { s, w } = boot();
    s.edit('flow', 'mach', 5);
    s.edit('numerics', 'mesh', 'medium');
    s.restart();
    const init = w.sent.at(-1) as { config: typeof DEFAULT_CONFIG };
    expect(init.config.flow.mach).toBe(5);
    expect(init.config.numerics.mesh).toBe('medium');
    expect(s.state.run.flow.mach).toBe(5);
    expect(s.needsRestart()).toBe(false);
  });

  it('results from a superseded run are never shown', () => {
    const { s, w } = boot();
    s.edit('flow', 'mach', 5);
    s.restart(); // run 2
    w.reply(snapshot(1, 999)); // late message from run 1
    expect(s.state.snap).toBeNull();
    w.reply(snapshot(2, 10));
    expect(s.state.snap?.diag.steps).toBe(10);
  });

  it('Restore defaults resets the controls only; the current results stay until a restart', () => {
    const { s, w } = boot();
    s.edit('flow', 'mach', 5);
    s.restart();
    w.reply(snapshot(2, 50, 'converged', false));
    s.restoreDefaults();
    expect(s.state.edited.flow.mach).toBe(3);
    expect(s.state.run.flow.mach).toBe(5);
    expect(s.needsRestart()).toBe(true);
    expect(s.state.snap?.diag.steps).toBe(50);
  });

  it('Run continues a converged run with "continue", a fresh one with "run"; Pause and Step send their messages', () => {
    const { s, w } = boot();
    s.runSim();
    expect(w.sent.at(-1)).toEqual({ type: 'run' });
    s.pause();
    expect(w.sent.at(-1)).toEqual({ type: 'pause' });
    s.step(10);
    expect(w.sent.at(-1)).toEqual({ type: 'step', n: 10 });
    w.reply(snapshot(1, 400, 'converged', false));
    s.runSim();
    expect(w.sent.at(-1)).toEqual({ type: 'continue' });
  });
});
