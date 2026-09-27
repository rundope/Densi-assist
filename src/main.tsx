import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { loadStoredProject, startAutosave } from './state/persist';
import { useApp } from './state/store';
import './ui/styles.css';

async function boot() {
  const stored = await loadStoredProject();
  if (stored) useApp.getState().loadProject(stored);
  startAutosave();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

boot();
