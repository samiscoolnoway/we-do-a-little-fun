import { useEffect, useState } from 'react';
import { sim, useSim } from './store/sim';
import { Announcer, Fallback, Hint, StageCard, TopBar, ViewportFoot } from './ui/Chrome';
import { ExteriorCard, InspectCard, IsoVeil } from './ui/Explore';
import { ChipCard } from './ui/Chip';
import { Dock } from './ui/Dock';
import { Panel } from './ui/Panel';
import { SimCanvas } from './ui/SimCanvas';

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      const onButton = tag === 'BUTTON' || tag === 'SUMMARY' || tag === 'A';
      switch (e.key) {
        case ' ':
          if (onButton) return;
          e.preventDefault();
          sim.toggle();
          break;
        case 'ArrowRight':
          if (onButton && el?.getAttribute('role') === 'radio') return;
          sim.next();
          break;
        case 'ArrowLeft':
          if (onButton && el?.getAttribute('role') === 'radio') return;
          sim.prev();
          break;
        case 'l':
        case 'L':
          sim.toggleLabels();
          break;
        case 'p':
        case 'P':
          sim.togglePath();
          break;
        case 'd':
        case 'D':
          sim.toggleDeep();
          break;
        case 'm':
        case 'M':
          sim.setView(sim.state.view === 'machine' ? 'stage' : 'machine');
          break;
        case 'r':
        case 'R':
          sim.restart();
          break;
        case 'o':
        case 'O':
          sim.toggleCasing();
          break;
        case 'Escape':
          if (sim.state.chip) sim.chipUp();
          else if (sim.state.inspect) sim.exitInspect();
          else if (sim.state.selectedId) sim.select(null);
          else sim.togglePanel(false);
          break;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  const webgl = useSim((s) => s.webgl);
  const inspecting = useSim((s) => !!s.inspect);
  const closed = useSim((s) => s.casing === 'closed');
  const chip = useSim((s) => !!s.chip);
  const [tall, setTall] = useState(false);
  useShortcuts();
  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <div className={`viewport${inspecting || chip ? ' is-inspecting' : ''}${chip ? ' is-chip' : ''}`} data-testid="viewport" data-casing={closed ? 'closed' : 'open'}>
          <SimCanvas />
          <IsoVeil />
          {chip ? <ChipCard /> : inspecting ? <InspectCard /> : closed ? <ExteriorCard /> : <StageCard />}
          <ViewportFoot />
          <Hint />
          {webgl === 'failed' && <Fallback />}
        </div>
        <Panel tall={tall} onTall={setTall} />
      </div>
      <Dock />
      <Announcer />
    </div>
  );
}
