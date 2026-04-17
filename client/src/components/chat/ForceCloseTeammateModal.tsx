import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const M = 'Montserrat, sans-serif';

interface ForceCloseTeammateModalProps {
  open: boolean;
  teammateName: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

// Friction layer over the Phase G dismiss endpoint. The X button was too
// easy to hit by accident — dismissing a teammate that the PM thinks is
// alive silently de-syncs the two. The modal forces an acknowledgement
// that force-close bypasses the PM, and the caller fires a system-notice
// to the PM so the PM can reconcile.
export const ForceCloseTeammateModal = ({
  open,
  teammateName,
  onCancel,
  onConfirm,
}: ForceCloseTeammateModalProps) => {
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Reset the checkbox when the modal is re-opened — otherwise a past
  // confirm-then-cancel flow would leave it pre-ticked for the next one.
  useEffect(() => {
    if (open) {
      setAcknowledged(false);
      setSubmitting(false);
    }
  }, [open]);

  const handleConfirm = async () => {
    if (!acknowledged || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          style={{
            background: 'rgba(8, 12, 18, 0.6)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            fontFamily: M,
          }}
          onClick={onCancel}
          data-escape-owner="force-close-teammate-modal"
        >
          <motion.div
            className="glass-modal p-6 max-w-md w-full mx-4"
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.2, 0.65, 0.3, 0.9] }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="force-close-title"
          >
            <div className="flex items-start gap-3 mb-3">
              <div
                className="shrink-0 flex items-center justify-center rounded-full"
                style={{
                  width: 40,
                  height: 40,
                  background: 'rgba(244, 63, 94, 0.12)',
                  border: '1px solid rgba(244, 63, 94, 0.3)',
                }}
              >
                <AlertTriangle size={18} style={{ color: '#f43f5e' }} />
              </div>
              <div className="flex-1 min-w-0">
                <h2
                  id="force-close-title"
                  className="text-base font-semibold"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  Force-close teammate?
                </h2>
                <p
                  className="text-xs mt-0.5 truncate"
                  style={{ color: 'var(--color-text-tertiary)' }}
                  title={teammateName}
                >
                  {teammateName}
                </p>
              </div>
            </div>

            <p
              className="text-sm leading-relaxed mb-4"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              This bypasses your PM's orchestration. If the teammate is healthy,
              prefer letting the PM manage lifecycle. Only force-close for
              genuinely stuck teammates — the PM will receive a system notice.
            </p>

            <label
              className="flex items-start gap-2 mb-5 cursor-pointer select-none"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5 shrink-0"
                style={{ accentColor: '#f43f5e' }}
              />
              <span className="text-xs">
                I understand this is a last-resort action.
              </span>
            </label>

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={onCancel}
                disabled={submitting}
                className="text-sm font-medium px-3 py-1.5 rounded-md transition-colors"
                style={{
                  fontFamily: M,
                  color: 'var(--color-text-secondary)',
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
                onMouseEnter={(e) => { if (!submitting) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'; }}
                onMouseLeave={(e) => { if (!submitting) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'; }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={!acknowledged || submitting}
                className="text-sm font-semibold px-3 py-1.5 rounded-md transition-all"
                style={{
                  fontFamily: M,
                  color: acknowledged && !submitting ? '#fff' : 'rgba(244, 63, 94, 0.5)',
                  background: acknowledged && !submitting
                    ? 'linear-gradient(180deg, #f43f5e 0%, #e11d48 100%)'
                    : 'rgba(244, 63, 94, 0.12)',
                  border: acknowledged && !submitting
                    ? '1px solid rgba(244, 63, 94, 0.6)'
                    : '1px solid rgba(244, 63, 94, 0.22)',
                  cursor: acknowledged && !submitting ? 'pointer' : 'not-allowed',
                  opacity: submitting ? 0.75 : 1,
                }}
              >
                {submitting ? 'Closing…' : 'Force close'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
