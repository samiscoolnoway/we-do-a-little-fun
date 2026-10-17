import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initNavFromHash } from './nav';
import './styles.css';

initNavFromHash();

createRoot(document.getElementById('root')!).render(<App />);
