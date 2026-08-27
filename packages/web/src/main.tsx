import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

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
