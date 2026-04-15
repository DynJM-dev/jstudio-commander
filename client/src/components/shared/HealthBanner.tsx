import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useWebSocket } from '../../hooks/useWebSocket';
import { setIsServerDown } from '../../services/serverHealth';

const M = 'Montserrat, sans-serif';

// Server emits `system:health` every 5s via ws/index.ts. If we haven't seen
// one in ~12s (2.4 heartbeat intervals, tolerant of a few lost packets) we
// assume the server is restarting — common during `pnpm dev` iterations —
// and surface a non-alarming banner so queued requests don't look like
// hard errors.
const HEALTH_STALE_MS = 12_000;

export const HealthBanner = () => {
  const { lastEvent, connected } = useWebSocket();
  const [healthLostAt, setHealthLostAt] = useState<number | null>(null);
  const lastHealthRef = useRef<number>(Date.now());
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Update last-seen on every heartbeat.
  useEffect(() => {
    if (lastEvent?.type === 'system:health') {
      lastHealthRef.current = Date.now();
      setHealthLostAt(null);
    }
  }, [lastEvent]);

  // 1s ticker that checks staleness. Cheap, no setInterval leak across
  // unmount — banner mounts once in DashboardLayout.
  useEffect(() => {
    tickerRef.current = setInterval(() => {
      const age = Date.now() - lastHealthRef.current;
      if (age > HEALTH_STALE_MS) {
        setHealthLostAt((prev) => prev ?? Date.now());
      }
    }, 1000);
    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, []);

  // Only surface when WS itself is up but heartbeats have gone quiet, OR
  // when WS is down. If WS is reconnecting, useWebSocket.connected flips.
  const showStalled = healthLostAt !== null && connected;
  const showDisconnected = !connected;
  const visible = showStalled || showDisconnected;

  // Mirror to module-level flag so non-React code (api.ts) can suppress
  // error toasts during expected downtime.
  useEffect(() => {
    setIsServerDown(visible);
  }, [visible]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18, ease: 'easeOut' as const }}
          className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 text-xs py-1.5 px-3"
          style={{
            fontFamily: M,
            background: showDisconnected
              ? 'rgba(239, 68, 68, 0.16)'
              : 'rgba(245, 158, 11, 0.14)',
            borderBottom: showDisconnected
              ? '1px solid rgba(239, 68, 68, 0.35)'
              : '1px solid rgba(245, 158, 11, 0.35)',
            color: showDisconnected ? 'var(--color-error)' : 'var(--color-idle)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
          }}
        >
          <Loader2 size={13} className="animate-spin shrink-0" />
          <span className="font-medium">
            {showDisconnected ? 'Reconnecting to Commander server…' : 'Server is slow or restarting…'}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
