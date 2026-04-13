import { Loader2, AlertCircle } from 'lucide-react';
import { useTerminal } from '../../hooks/useTerminal';
import '@xterm/xterm/css/xterm.css';

const M = 'Montserrat, sans-serif';

interface TerminalPanelProps {
  sessionId: string;
}

export const TerminalPanel = ({ sessionId }: TerminalPanelProps) => {
  const { containerRef, connected, error } = useTerminal(sessionId);

  return (
    <div className="flex-1 relative" style={{ background: '#0A0E14' }}>
      {/* Loading overlay */}
      {!connected && !error && (
        <div className="absolute inset-0 flex items-center justify-center z-10" style={{ background: '#0A0E14' }}>
          <div className="flex items-center gap-2">
            <Loader2 size={18} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
            <span className="text-sm" style={{ fontFamily: M, color: 'var(--color-text-secondary)' }}>
              Connecting to terminal...
            </span>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center z-10" style={{ background: '#0A0E14' }}>
          <div className="flex flex-col items-center gap-2">
            <AlertCircle size={24} style={{ color: 'var(--color-error)' }} />
            <span className="text-sm" style={{ fontFamily: M, color: 'var(--color-error)' }}>
              {error}
            </span>
          </div>
        </div>
      )}

      {/* xterm container */}
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ padding: 4 }}
      />
    </div>
  );
};
