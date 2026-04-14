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

const getButtonAction = (prompt: DetectedPrompt, option: string, index: number): { type: 'command' | 'key'; value: string } => {
  if (prompt.type === 'confirm' && !prompt.options) {
    return option === 'Yes'
      ? { type: 'key', value: 'Enter' }
      : { type: 'key', value: 'Escape' };
  }
  if (prompt.type === 'choice') {
    return { type: 'command', value: String(index + 1) };
  }
  if (prompt.type === 'trust') {
    return { type: 'command', value: index === 0 ? 'yes' : 'no' };
  }
  if (prompt.type === 'permission') {
    if (option === 'Allow') return { type: 'command', value: 'y' };
    if (option === 'Allow always') return { type: 'command', value: 'a' };
    if (option === 'Deny') return { type: 'command', value: 'n' };
  }
  return { type: 'command', value: option };
};

const TITLE_MAP: Record<string, string> = {
  permission: 'Claude needs permission',
  trust: 'Trust this workspace?',
  confirm: 'Confirmation needed',
  choice: 'Choose an option',
};

export const PermissionPrompt = ({ sessionId, prompt, onResponded }: PermissionPromptProps) => {
  const [sending, setSending] = useState(false);
  const [customInput, setCustomInput] = useState('');

  const sendAction = useCallback(async (action: { type: 'command' | 'key'; value: string }) => {
    if (sending) return;
    setSending(true);
    try {
      if (action.type === 'key') {
        await api.post(`/sessions/${sessionId}/key`, { key: action.value });
      } else {
        await api.post(`/sessions/${sessionId}/command`, { command: action.value });
      }
      onResponded();
    } catch {
      setSending(false);
    }
  }, [sessionId, sending, onResponded]);

  const options = prompt.options ?? (prompt.type === 'confirm' ? ['Yes', 'No'] : []);
  const title = TITLE_MAP[prompt.type] ?? 'Claude needs your input';

  // Only show context if it's different from the message and non-empty
  const showContext = prompt.context && prompt.context !== prompt.message && prompt.context.trim().length > 0;

  return (
    <motion.div
      data-escape-owner="permission-prompt"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          // ESC inside the prompt = decline — ask Claude to drop the request
          // instead of interrupting its generation.
          e.stopPropagation();
          sendAction({ type: 'key', value: 'Escape' });
        }
      }}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2, ease: 'easeOut' as const }}
      className="shrink-0 mx-3 lg:mx-6 mb-2 rounded-lg overflow-hidden"
      style={{
        fontFamily: M,
        background: 'rgba(245, 158, 11, 0.06)',
        border: '1px solid rgba(245, 158, 11, 0.2)',
        borderLeftWidth: 3,
        borderLeftColor: 'rgba(245, 158, 11, 0.5)',
        padding: 16,
      }}
    >
      {/* Title — one line */}
      <div className="flex items-center gap-2 mb-2">
        <ShieldAlert size={16} style={{ color: 'var(--color-idle)' }} />
        <span
          className="text-sm font-semibold"
          style={{ color: 'var(--color-idle)' }}
        >
          {title}
        </span>
      </div>

      {/* Context — only if different from message */}
      {showContext && (
        <pre
          className="text-xs leading-relaxed mb-2 whitespace-pre-wrap font-mono-stats"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {prompt.context}
        </pre>
      )}

      {/* Message — one line */}
      <p
        className="text-sm mb-3 leading-relaxed"
        style={{ color: 'var(--color-text-primary)' }}
      >
        {prompt.message}
      </p>

      {/* Action buttons + custom input on same row */}
      <div className="flex flex-wrap items-center gap-2">
        {options.map((option, i) => {
          const isDeny = option === 'Deny' || option === 'No' || option === 'No, exit' || option === 'Reject';
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
              onClick={() => sendAction(getButtonAction(prompt, option, i))}
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

        {/* Inline custom input */}
        <div className="flex items-center gap-1 ml-auto">
          <input
            type="text"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && customInput.trim()) {
                sendAction({ type: 'command', value: customInput.trim() });
              }
            }}
            disabled={sending}
            placeholder="Custom..."
            className="text-xs bg-transparent outline-none px-2 py-1 rounded w-24"
            style={{
              fontFamily: M,
              color: 'var(--color-text-primary)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              background: 'rgba(0, 0, 0, 0.15)',
            }}
          />
          <button
            onClick={() => customInput.trim() && sendAction({ type: 'command', value: customInput.trim() })}
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
      </div>
    </motion.div>
  );
};
