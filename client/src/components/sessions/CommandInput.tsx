import { useState, useCallback } from 'react';
import { SendHorizontal, Check } from 'lucide-react';

const M = 'Montserrat, sans-serif';

interface CommandInputProps {
  sessionId: string;
  disabled?: boolean;
  onSend: (sessionId: string, command: string) => Promise<void>;
}

export const CommandInput = ({ sessionId, disabled = false, onSend }: CommandInputProps) => {
  const [value, setValue] = useState('');
  const [sent, setSent] = useState(false);

  const handleSend = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;

    try {
      await onSend(sessionId, trimmed);
      setValue('');
      setSent(true);
      setTimeout(() => setSent(false), 1000);
    } catch {
      // Error handled upstream
    }
  }, [value, disabled, onSend, sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Send command..."
        disabled={disabled}
        className="flex-1 min-w-0 rounded-lg px-3 py-1.5 text-base outline-none transition-colors"
        style={{
          fontFamily: M,
          fontSize: 14,
          background: 'rgba(255, 255, 255, 0.04)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          color: disabled ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
          cursor: disabled ? 'not-allowed' : 'text',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--color-accent)';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.06)';
        }}
      />
      <button
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        className="shrink-0 flex items-center justify-center rounded-lg transition-all"
        style={{
          width: 32,
          height: 32,
          background: sent ? 'var(--color-working)' : 'var(--color-accent)',
          color: '#fff',
          opacity: disabled || !value.trim() ? 0.3 : 1,
          cursor: disabled || !value.trim() ? 'not-allowed' : 'pointer',
        }}
      >
        {sent ? <Check size={14} /> : <SendHorizontal size={14} />}
      </button>
    </div>
  );
};
