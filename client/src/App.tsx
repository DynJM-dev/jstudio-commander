import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ErrorBoundary } from './components/shared/ErrorBoundary';

const M = 'Montserrat, sans-serif';

const Placeholder = () => (
  <div
    className="min-h-screen flex items-center justify-center"
    style={{ fontFamily: M, background: 'var(--color-bg-deep)' }}
  >
    <div className="glass-card p-12 text-center max-w-md">
      <h1
        className="text-3xl font-semibold mb-3"
        style={{ color: 'var(--color-text-primary)', fontFamily: M }}
      >
        JStudio Commander
      </h1>
      <p
        className="text-base"
        style={{ color: 'var(--color-text-secondary)', fontFamily: M }}
      >
        Command center initializing...
      </p>
      <div
        className="mt-6 inline-block w-3 h-3 rounded-full animate-pulse"
        style={{ backgroundColor: 'var(--color-accent)' }}
      />
    </div>
  </div>
);

export const App = () => (
  <ErrorBoundary>
    <BrowserRouter>
      <Routes>
        <Route path="*" element={<Placeholder />} />
      </Routes>
    </BrowserRouter>
  </ErrorBoundary>
);
