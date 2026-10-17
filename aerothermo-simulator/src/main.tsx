import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { store } from './ui/store';
import './ui/styles.css';

const worker = new Worker(new URL('./worker/flow.worker.ts', import.meta.url), { type: 'module' });
store.boot(worker);
// exposed for end-to-end tests and for curious users in the console
(window as unknown as { aerothermo: unknown }).aerothermo = { store };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
