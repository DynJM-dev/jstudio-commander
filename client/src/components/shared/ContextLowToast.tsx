import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ContextBand } from '../../utils/contextBands';
import { bandColor, isWarningCrossing } from '../../utils/contextBands';

const M = 'Montserrat, sans-serif';
const AUTO_DISMISS_MS = 6000;

interface ContextLowToastProps {
  // The current band for THIS session. The component watches transitions
  // and fires the toast when a band crosses upward into orange or red.
  band: ContextBand;
  // Current percentage for display. If null, no toast (we only show
  // once we have a real number AND we crossed into a warning band).
  percentage: number | null;
}

const messageFor = (band: ContextBand, pct: number): { title: string; body: string } => {
  if (band === 'red') {
    return {
      title: `Context at ${Math.round(pct)}%`,
      body: '/compact now or lose detail.',
    };
  }
  return {
    title: `Context at ${Math.round(pct)}%`,
    body: 'Consider /compact soon.',
  };
};

// Tiny self-contained toast — no provider needed. Consumers mount one
// per session view (ChatPage renders it). Auto-dismisses after
// AUTO_DISMISS_MS; user can click to dismiss early.
export const ContextLowToast = ({ band, percentage }: ContextLowToastProps) => {
  const prevBandRef = useRef<ContextBand>(band);
  const [visible, setVisible] = useState(false);
  const [shown, setShown] = useState<{ band: ContextBand; pct: number } | null>(null);

  useEffect(() => {
    const prev = prevBandRef.current;
    prevBandRef.current = band;
    if (!Number.isFinite(percentage ?? Number.NaN)) return;
    if (!isWarningCrossing(prev, band)) return;
    setShown({ band, pct: percentage as number });
    setVisible(true);
    const t = setTimeout(() => setVisible(false), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [band, percentage]);

  const color = shown ? bandColor(shown.band) : 'var(--color-text-tertiary)';
  const message = shown ? messageFor(shown.band, shown.pct) : null;

  return (
    <AnimatePresence>
      {visible && message && (
        <motion.button
          type="button"
          onClick={() => setVisible(false)}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18, ease: 'easeOut' as const }}
          className="fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg"
          style={{
            fontFamily: M,
            background: 'rgba(20, 20, 22, 0.92)',
            border: `1px solid ${color}`,
            color: 'var(--color-text-primary)',
            backdropFilter: 'blur(18px) saturate(180%)',
            WebkitBackdropFilter: 'blur(18px) saturate(180%)',
            cursor: 'pointer',
            maxWidth: 340,
            textAlign: 'left',
          }}
          aria-label="Dismiss context warning"
        >
          <AlertTriangle size={18} style={{ color, flexShrink: 0 }} />
          <div>
            <div className="text-sm font-semibold" style={{ color }}>
              {message.title}
            </div>
            <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              {message.body}
            </div>
          </div>
        </motion.button>
      )}
    </AnimatePresence>
  );
};
