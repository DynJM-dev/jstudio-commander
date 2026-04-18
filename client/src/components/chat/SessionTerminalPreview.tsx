import { useState, useEffect, useCallback, useRef } from 'react';
import { Terminal, ShieldCheck, ShieldAlert, CheckCircle, ListChecks, XCircle, Loader2 } from 'lucide-react';
import { api } from '../../services/api';
import { getPromptActions, type DetectedPrompt } from '../../utils/promptActions';

const M = 'Montserrat, sans-serif';

interface TerminalPrompt {
  type: string;
  message: string;
  options?: string[];
}

const TITLE_BY_TYPE: Record<string, string> = {
  trust: 'Workspace Trust',
  permission: 'Permission Required',
  choice: 'Choose an option',
  confirm: 'Confirmation',
};

interface SessionOutput {
  output: string;
  lines: string[];
  alive: boolean;
  prompts: TerminalPrompt[];
}

interface Props {
  sessionId: string;
}

export const SessionTerminalPreview = ({ sessionId }: Props) => {
  const [output, setOutput] = useState<SessionOutput | null>(null);
  const [responding, setResponding] = useState(false);
  // #219 — pause polling when the preview leaves the viewport. Multi-
  // teammate views mount up to three previews simultaneously and a
  // long SessionsPage scrolls plenty of them off-screen. Callback ref
  // re-binds the observer when the wrapper element swaps across the
  // loading / not-alive / normal return paths.
  const [isOnscreen, setIsOnscreen] = useState(true);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const wrapperRef = useCallback((el: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setIsOnscreen(entry?.isIntersecting ?? true),
      { threshold: 0.1 },
    );
    obs.observe(el);
    observerRef.current = obs;
  }, []);
  useEffect(() => () => observerRef.current?.disconnect(), []);

  // Poll terminal output every 2s — gated on visibility so off-screen
  // previews skip the network call entirely (not just the state update).
  useEffect(() => {
    if (!isOnscreen) return;
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
  }, [sessionId, isOnscreen]);

  // Dispatch any prompt action through the shared mapper — command vs
  // key is already resolved by getPromptActions, so the dispatcher is a
  // thin POST to the right endpoint. Lets SessionTerminalPreview and
  // PermissionPrompt share the same resolver without duplicating the
  // per-type button-to-value switch.
  const dispatchAction = useCallback(
    async (action: { type: 'command' | 'key'; value: string }) => {
      setResponding(true);
      try {
        if (action.type === 'key') {
          await api.post(`/sessions/${sessionId}/key`, { key: action.value });
        } else {
          await api.post(`/sessions/${sessionId}/command`, { command: action.value });
        }
      } catch {
        // ignore
      } finally {
        setTimeout(() => setResponding(false), 1000);
      }
    },
    [sessionId],
  );

  if (!output) {
    return (
      <div ref={wrapperRef} className="flex items-center justify-center gap-2 py-8">
        <Loader2 size={16} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
        <span className="text-sm" style={{ color: 'var(--color-text-tertiary)', fontFamily: M }}>
          Connecting to session...
        </span>
      </div>
    );
  }

  if (!output.alive) {
    return (
      <div ref={wrapperRef} className="glass-card p-4 mx-4" style={{ fontFamily: M }}>
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
    <div ref={wrapperRef} className="flex flex-col gap-3 px-4 lg:px-6 py-4" style={{ fontFamily: M }}>

      {/* Interactive prompts — actions come from the shared getPromptActions
          resolver so a new prompt type gets picked up here and in
          PermissionPrompt from a single edit. */}
      {output.prompts.map((prompt, i) => {
        const actions = getPromptActions(prompt as DetectedPrompt);
        const title = TITLE_BY_TYPE[prompt.type] ?? 'Claude needs input';
        const isTrust = prompt.type === 'trust';
        const isPermission = prompt.type === 'permission';
        const background = isTrust
          ? 'rgba(14, 124, 123, 0.08)'
          : isPermission
            ? 'rgba(245, 158, 11, 0.08)'
            : 'rgba(255, 255, 255, 0.04)';
        const border = `1px solid ${
          isTrust
            ? 'rgba(14, 124, 123, 0.2)'
            : isPermission
              ? 'rgba(245, 158, 11, 0.2)'
              : 'rgba(255, 255, 255, 0.08)'
        }`;
        return (
          <div key={i} className="rounded-xl p-4" style={{ background, border }}>
            <div className="flex items-center gap-2 mb-2">
              {isTrust && <ShieldCheck size={18} style={{ color: 'var(--color-accent)' }} />}
              {isPermission && <ShieldAlert size={18} style={{ color: 'var(--color-idle)' }} />}
              {prompt.type === 'confirm' && <CheckCircle size={18} style={{ color: 'var(--color-accent)' }} />}
              {prompt.type === 'choice' && <ListChecks size={18} style={{ color: 'var(--color-idle)' }} />}
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {title}
              </span>
            </div>

            <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>
              {prompt.message}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              {actions.map((action, j) => {
                const isDeny =
                  /^(deny|no|no, exit|reject|3\.\s*no\b)/i.test(action.label);
                const primary = j === 0 && !isDeny;
                return (
                  <button
                    key={j}
                    onClick={() => dispatchAction(action)}
                    disabled={responding}
                    className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
                    style={{
                      background: primary ? 'var(--color-accent)' : 'rgba(255, 255, 255, 0.04)',
                      color: primary ? '#fff' : isDeny ? 'var(--color-error)' : 'var(--color-text-secondary)',
                      border: primary ? '1px solid transparent' : '1px solid rgba(255, 255, 255, 0.08)',
                      opacity: responding ? 0.5 : 1,
                      cursor: responding ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {primary && responding ? (
                      <Loader2 size={13} className="animate-spin inline mr-1" />
                    ) : null}
                    {action.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

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
