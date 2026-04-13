import { useState, useCallback, useRef, useEffect } from 'react';
import { Square, Trash2, Pencil } from 'lucide-react';

const M = 'Montserrat, sans-serif';

interface SessionActionsProps {
  sessionId: string;
  isStopped: boolean;
  currentName: string;
  onDelete: (id: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
}

export const SessionActions = ({
  sessionId,
  isStopped,
  currentName,
  onDelete,
  onRename,
}: SessionActionsProps) => {
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(currentName);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, []);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

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

  const handleRenameSubmit = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== currentName) {
      onRename(sessionId, trimmed);
    }
    setEditing(false);
  }, [editValue, currentName, sessionId, onRename]);

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRenameSubmit();
    } else if (e.key === 'Escape') {
      setEditValue(currentName);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={handleRenameKeyDown}
        onBlur={handleRenameSubmit}
        className="rounded-lg px-2 py-1 text-sm outline-none w-full"
        style={{
          fontFamily: M,
          background: 'rgba(255, 255, 255, 0.06)',
          border: '1px solid var(--color-accent)',
          color: 'var(--color-text-primary)',
        }}
      />
    );
  }

  return (
    <div className="flex items-center gap-1">
      {/* Rename */}
      <button
        onClick={() => {
          setEditValue(currentName);
          setEditing(true);
        }}
        className="flex items-center justify-center rounded-lg transition-colors"
        style={{
          width: 32,
          height: 32,
          color: 'var(--color-text-tertiary)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--color-text-secondary)';
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--color-text-tertiary)';
          e.currentTarget.style.background = 'transparent';
        }}
        title="Rename"
      >
        <Pencil size={14} />
      </button>

      {/* Kill / Remove */}
      <button
        onClick={handleDeleteClick}
        className="flex items-center justify-center gap-1 rounded-lg px-2 transition-colors text-xs font-medium"
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
    </div>
  );
};
