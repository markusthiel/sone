import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { sweepLocalDocs } from './storage/localDocs.ts';

import { App } from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { applyAppearance } from './hooks/useAppearance.ts';
import './styles.css';

// Applied before React mounts, so the chosen theme is in place on the first
// paint. Without this a dark-theme user gets a white flash on every load, and a
// larger text scale visibly reflows.
try {
  const stored = localStorage.getItem('sone.appearance');
  if (stored) applyAppearance(JSON.parse(stored) as Parameters<typeof applyAppearance>[0]);
} catch {
  // Unreadable storage just means defaults.
}


const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

// Drop local copies nobody has opened in a month.
//
// At startup rather than on a timer: it touches storage, and a background sweep
// competing with a page being typed into buys nothing. Failures are ignored —
// this is a cache bound, and an unswept copy is a nuisance rather than a fault.
void sweepLocalDocs().catch(() => {});

createRoot(root).render(
  <StrictMode>
    {/* Outermost boundary. Without one, any render-time throw unmounts the whole
        tree and leaves a blank page — which happened, and gave the person
        nothing to report and no reason to believe their work survived. */}
    <ErrorBoundary where="SONE">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
