import { useState, useCallback } from 'react';
import { ShieldAlert, SendHorizontal } from 'lucide-react';
import { motion } from 'framer-motion';
import { api } from '../../services/api';

const M = 'Montserrat, sans-serif';

interface DetectedPrompt {
  type: string;
  message: string;
  context?: string;
  options?: string[];
}

interface PermissionPromptProps {
  sessionId: string;
  prompt: DetectedPrompt;
  onResponded: () => void;
}

const getButtonResponse = (prompt: DetectedPrompt, option: string, index: number): string => {
  if (prompt.type === 'choice') {
    return String(index + 1);
  }
  if (prompt.type === 'trust') {
    return index === 0 ? 'yes' : 'no';
  }
  if (prompt.type === 'confirm') {
    return option.toLowerCase().startsWith('y') ? 'y' : 'n';
  }
  if (prompt.type === 'permission') {
    if (option === 'Allow') return 'y';
    if (option === 'Allow always') return 'a';
    if (option === 'Deny') return 'n';
  }
  return option;
};

export const PermissionPrompt = ({ sessionId, prompt, onResponded }: PermissionPromptProps) => {
  const [sending, setSending] = useState(false);
  const [customInput, setCustomInput] = useState('');

  const sendResponse = useCallback(async (response: string) => {
    if (sending) return;
    setSending(true);
    try {
      await api.post(`/sessions/${sessionId}/command`, { command: response });
      onResponded();
    } catch {
      setSending(false);
    }
  }, [sessionId, sending, onResponded]);

  const options = prompt.options ?? (prompt.type === 'confirm' ? ['Yes', 'No'] : []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2, ease: 'easeOut' as const }}
      className="shrink-0 mx-3 lg:mx-6 mb-2 rounded-lg overflow-hidden"
      style={{
        fontFamily: M,
        background: 'rgba(245, 158, 11, 0.06)',
        borderLeft: '3px solid rgba(245, 158, 11, 0.5)',
        padding: 16,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2.5">
        <ShieldAlert size={16} style={{ color: 'var(--color-idle)' }} />
        <span
          className="text-sm font-semibold"
          style={{ color: 'var(--color-idle)' }}
        >
          Claude needs your input
        </span>
      </div>

      {/* Full context — what Claude wants to do (no border, just plain text) */}
      {prompt.context && (
        <pre
          className="text-xs leading-relaxed mb-2 whitespace-pre-wrap font-mono-stats"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {prompt.context}
        </pre>
      )}

      {/* Question / prompt message */}
      <p
        className="text-sm mb-3 leading-relaxed"
        style={{ color: 'var(--color-text-primary)' }}
      >
        {prompt.message}
      </p>

      {/* Action buttons */}
      {options.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {options.map((option, i) => {
            const isDeny = option === 'Deny' || option === 'No' || option === 'No, exit' || option.startsWith('3. No');
            const isPrimary = i === 0 && !isDeny;

            let bg: string;
            let color: string;
            let border: string;
            let hoverBg: string;

            if (isDeny) {
              bg = 'rgba(239, 68, 68, 0.08)';
              color = 'var(--color-error)';
              border = '1px solid rgba(239, 68, 68, 0.15)';
              hoverBg = 'rgba(239, 68, 68, 0.15)';
            } else if (isPrimary) {
              bg = 'var(--color-accent)';
              color = '#fff';
              border = '1px solid transparent';
              hoverBg = 'var(--color-accent-light)';
            } else {
              bg = 'rgba(255, 255, 255, 0.06)';
              color = 'var(--color-text-secondary)';
              border = '1px solid rgba(255, 255, 255, 0.08)';
              hoverBg = 'rgba(255, 255, 255, 0.1)';
            }

            return (
              <button
                key={i}
                disabled={sending}
                onClick={() => sendResponse(getButtonResponse(prompt, option, i))}
                className="px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                style={{
                  fontFamily: M,
                  background: bg,
                  color,
                  border,
                  opacity: sending ? 0.5 : 1,
                  cursor: sending ? 'not-allowed' : 'pointer',
                }}
                onMouseEnter={(e) => {
                  if (!sending) e.currentTarget.style.background = hoverBg;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = bg;
                }}
              >
                {option}
              </button>
            );
          })}
        </div>
      )}

      {/* Custom response input */}
      <div className="flex items-center gap-2">
        <span
          className="text-xs shrink-0"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          Or type:
        </span>
        <input
          type="text"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && customInput.trim()) {
              sendResponse(customInput.trim());
            }
          }}
          disabled={sending}
          placeholder="Custom response..."
          className="flex-1 text-xs bg-transparent outline-none px-2 py-1 rounded"
          style={{
            fontFamily: M,
            color: 'var(--color-text-primary)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(0, 0, 0, 0.15)',
          }}
        />
        <button
          onClick={() => customInput.trim() && sendResponse(customInput.trim())}
          disabled={!customInput.trim() || sending}
          className="shrink-0 p-1 rounded transition-colors"
          style={{
            color: customInput.trim() ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
            cursor: customInput.trim() ? 'pointer' : 'default',
          }}
        >
          <SendHorizontal size={14} />
        </button>
      </div>
    </motion.div>
  );
};
