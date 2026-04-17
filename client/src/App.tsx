import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { PinGate } from './components/shared/PinGate';
import { WebSocketProvider } from './hooks/useWebSocket';
import { DashboardLayout } from './layouts/DashboardLayout';
import { LoadingSkeleton } from './components/shared/LoadingSkeleton';

const SessionsPage = lazy(() => import('./pages/SessionsPage').then(m => ({ default: m.SessionsPage })));
const ChatPage = lazy(() => import('./pages/ChatPage').then(m => ({ default: m.ChatPage })));
const SplitChatLayout = lazy(() => import('./pages/SplitChatLayout').then(m => ({ default: m.SplitChatLayout })));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage').then(m => ({ default: m.ProjectsPage })));
const ProjectDetailPage = lazy(() => import('./pages/ProjectDetailPage').then(m => ({ default: m.ProjectDetailPage })));
// Phase P.3 H4 — TerminalPage removed. The half-built xterm preview
// was dropping more than it rendered (partial cursor sync, no resize
// stability). Full xterm.js + node-pty rebuild is a future phase; for
// now the page + its deps are gone.
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then(m => ({ default: m.AnalyticsPage })));
const CityPage = lazy(() => import('./pages/CityPage').then(m => ({ default: m.CityPage })));

const PageFallback = () => (
  <div className="p-4 lg:p-6">
    <LoadingSkeleton variant="card" count={3} />
  </div>
);

const pageTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2, ease: 'easeOut' as const },
};

const AnimatedRoutes = () => {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <motion.div key={location.pathname} {...pageTransition}>
        <Suspense fallback={<PageFallback />}>
          <Routes location={location}>
            <Route element={<DashboardLayout />}>
              <Route path="/sessions" element={<SessionsPage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/chat/:sessionId" element={<SplitChatLayout />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/projects/:id" element={<ProjectDetailPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/city" element={<CityPage />} />
              <Route path="*" element={<Navigate to="/sessions" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </motion.div>
    </AnimatePresence>
  );
};

export const App = () => (
  <ErrorBoundary>
    <PinGate>
      <WebSocketProvider>
        <BrowserRouter>
          <AnimatedRoutes />
        </BrowserRouter>
      </WebSocketProvider>
    </PinGate>
  </ErrorBoundary>
);
