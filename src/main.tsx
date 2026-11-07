import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { enableCrossTabSync } from './lib/crossTab';
import { useStudyStore } from './stores/studyStore';
import { useTimerStore } from './stores/timerStore';
import { useUiStore } from './stores/uiStore';

enableCrossTabSync([
  { key: 'cma-study-os', rehydrate: () => useStudyStore.persist.rehydrate() },
  { key: 'cma-study-os-timer', rehydrate: () => useTimerStore.persist.rehydrate() },
  { key: 'cma-study-os-ui', rehydrate: () => useUiStore.persist.rehydrate() },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
