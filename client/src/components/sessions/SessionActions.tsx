import { useState, useCallback, useRef, useEffect } from 'react';
import { Square, Trash2 } from 'lucide-react';

const M = 'Montserrat, sans-serif';

interface SessionActionsProps {
  sessionId: string;
  isStopped: boolean;
  onDelete: (id: string) => Promise<void>;
}

export const SessionActions = ({
  sessionId,
  isStopped,
  onDelete,
}: SessionActionsProps) => {
  const [confirming, setConfirming] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, []);

  const handleDeleteClick = useCallback(() => {
    if (confirming) {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      setConfirming(false);
      onDelete(sessionId);
    } else {
      setConfirming(true);
      confirmTimer.current = setTimeout(() => setConfirming(false), 3000);
    }
  }, [confirming, sessionId, onDelete]);

  return (
    <button
      onClick={handleDeleteClick}
      className="flex items-center justify-center gap-1 rounded-lg px-2 transition-colors text-xs font-medium shrink-0"
      style={{
        height: 32,
        fontFamily: M,
        color: confirming ? '#fff' : 'var(--color-text-tertiary)',
        background: confirming ? 'var(--color-error)' : 'transparent',
      }}
      onMouseEnter={(e) => {
        if (!confirming) {
          e.currentTarget.style.color = 'var(--color-error)';
          e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
        }
      }}
      onMouseLeave={(e) => {
        if (!confirming) {
          e.currentTarget.style.color = 'var(--color-text-tertiary)';
          e.currentTarget.style.background = 'transparent';
        }
      }}
      title={isStopped ? 'Remove' : 'Kill session'}
    >
      {confirming ? (
        <span>Sure?</span>
      ) : isStopped ? (
        <Trash2 size={14} />
      ) : (
        <Square size={14} />
      )}
    </button>
  );
};
