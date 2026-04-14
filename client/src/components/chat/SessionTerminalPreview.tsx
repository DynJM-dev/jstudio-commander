import { useState, useEffect, useCallback } from 'react';
import { Terminal, ShieldCheck, ShieldAlert, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { api } from '../../services/api';

const M = 'Montserrat, sans-serif';

interface TerminalPrompt {
  type: string;
  message: string;
  options?: string[];
}

interface SessionOutput {
  output: string;
  lines: string[];
  alive: boolean;
  prompts: TerminalPrompt[];
}

interface Props {
  sessionId: string;
  onSendKeys: (keys: string) => Promise<void>;
}

export const SessionTerminalPreview = ({ sessionId, onSendKeys }: Props) => {
  const [output, setOutput] = useState<SessionOutput | null>(null);
  const [responding, setResponding] = useState(false);

  // Poll terminal output every 2s
  useEffect(() => {
    let mounted = true;

    const poll = async () => {
      try {
        const data = await api.get<SessionOutput>(`/sessions/${sessionId}/output?lines=25`);
        if (mounted) setOutput(data);
      } catch {
        // ignore
      }
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => { mounted = false; clearInterval(interval); };
  }, [sessionId]);

  const handlePromptAction = useCallback(async (action: string) => {
    setResponding(true);
    try {
      // For trust prompt and other Enter-confirmable prompts, just send Enter
      // For y/n prompts, send the key
      if (action === 'confirm' || action === 'Yes, I trust this folder' || action === 'Allow') {
        await onSendKeys('');
      } else if (action === 'deny' || action === 'No, exit' || action === 'Deny') {
        // For deny actions, we might need to send specific keys
        if (action === 'No, exit') {
          // Arrow down to select "No" option, then Enter
          await onSendKeys('');  // This needs more nuance for multi-select
        } else {
          await onSendKeys('n');
        }
      } else {
        await onSendKeys(action);
      }
    } catch {
      // ignore
    } finally {
      setTimeout(() => setResponding(false), 1000);
    }
  }, [onSendKeys]);

  if (!output) {
    return (
      <div className="flex items-center justify-center gap-2 py-8">
        <Loader2 size={16} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
        <span className="text-sm" style={{ color: 'var(--color-text-tertiary)', fontFamily: M }}>
          Connecting to session...
        </span>
      </div>
    );
  }

  if (!output.alive) {
    return (
      <div className="glass-card p-4 mx-4" style={{ fontFamily: M }}>
        <div className="flex items-center gap-2 mb-2">
          <XCircle size={16} style={{ color: 'var(--color-error)' }} />
          <span className="text-sm font-medium" style={{ color: 'var(--color-error)' }}>
            Session not running
          </span>
        </div>
        <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          The tmux session for this session no longer exists.
        </p>
      </div>
    );
  }

  // Clean up output lines — remove empty lines from top
  const cleanLines = output.lines.slice(
    output.lines.findIndex((l) => l.trim() !== '')
  );

  return (
    <div className="flex flex-col gap-3 px-4 lg:px-6 py-4" style={{ fontFamily: M }}>

      {/* Interactive prompts */}
      {output.prompts.map((prompt, i) => (
        <div
          key={i}
          className="rounded-xl p-4"
          style={{
            background: prompt.type === 'trust'
              ? 'rgba(14, 124, 123, 0.08)'
              : prompt.type === 'permission'
                ? 'rgba(245, 158, 11, 0.08)'
                : 'rgba(255, 255, 255, 0.04)',
            border: `1px solid ${
              prompt.type === 'trust'
                ? 'rgba(14, 124, 123, 0.2)'
                : prompt.type === 'permission'
                  ? 'rgba(245, 158, 11, 0.2)'
                  : 'rgba(255, 255, 255, 0.08)'
            }`,
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            {prompt.type === 'trust' && <ShieldCheck size={18} style={{ color: 'var(--color-accent)' }} />}
            {prompt.type === 'permission' && <ShieldAlert size={18} style={{ color: 'var(--color-idle)' }} />}
            {prompt.type === 'confirm' && <CheckCircle size={18} style={{ color: 'var(--color-accent)' }} />}
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {prompt.type === 'trust' ? 'Workspace Trust' :
               prompt.type === 'permission' ? 'Permission Required' :
               'Confirmation'}
            </span>
          </div>

          <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>
            {prompt.message}
          </p>

          <div className="flex items-center gap-2">
            {prompt.type === 'trust' && (
              <>
                <button
                  onClick={() => handlePromptAction('confirm')}
                  disabled={responding}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all"
                  style={{
                    background: 'var(--color-accent)',
                    color: '#fff',
                    opacity: responding ? 0.7 : 1,
                  }}
                >
                  {responding ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                  Trust & Continue
                </button>
                <button
                  onClick={() => handlePromptAction('deny')}
                  disabled={responding}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  style={{
                    background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--color-text-secondary)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                  }}
                >
                  Exit
                </button>
              </>
            )}
            {prompt.type === 'permission' && (
              <>
                <button
                  onClick={() => handlePromptAction('Allow')}
                  disabled={responding}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all"
                  style={{ background: 'var(--color-accent)', color: '#fff', opacity: responding ? 0.7 : 1 }}
                >
                  Allow
                </button>
                <button
                  onClick={() => handlePromptAction('Deny')}
                  disabled={responding}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  style={{
                    background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--color-text-secondary)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                  }}
                >
                  Deny
                </button>
              </>
            )}
            {prompt.type === 'confirm' && (
              <>
                <button
                  onClick={() => handlePromptAction('confirm')}
                  disabled={responding}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
                  style={{ background: 'var(--color-accent)', color: '#fff', opacity: responding ? 0.7 : 1 }}
                >
                  Yes
                </button>
                <button
                  onClick={() => handlePromptAction('n')}
                  disabled={responding}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  style={{
                    background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--color-text-secondary)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                  }}
                >
                  No
                </button>
              </>
            )}
          </div>
        </div>
      ))}

      {/* Terminal output preview */}
      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: 'rgba(0, 0, 0, 0.3)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
        }}
      >
        <div
          className="flex items-center gap-2 px-3 py-2"
          style={{
            background: 'rgba(0, 0, 0, 0.2)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
          }}
        >
          <Terminal size={13} style={{ color: 'var(--color-text-tertiary)' }} />
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-tertiary)' }}>
            Live Terminal Output
          </span>
          <div
            className="w-1.5 h-1.5 rounded-full animate-pulse ml-auto"
            style={{ background: 'var(--color-working)' }}
          />
        </div>
        <pre
          className="p-3 text-xs leading-relaxed overflow-x-auto max-h-[300px] overflow-y-auto"
          style={{
            fontFamily: 'JetBrains Mono, SF Mono, Monaco, Menlo, monospace',
            color: 'var(--color-text-secondary)',
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {cleanLines.join('\n') || 'Waiting for output...'}
        </pre>
      </div>
    </div>
  );
};
