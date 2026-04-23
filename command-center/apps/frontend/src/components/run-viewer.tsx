import { XtermContainer } from '@commander/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Terminal } from '@xterm/xterm';
import { X } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { useSessionStream } from '../hooks/use-session-stream';
import {
  type AgentRunWithScrollback,
  cancelAgentRun,
  fetchAgentRun,
  readSidecarConfig,
} from '../lib/sidecar-client';
import { Button } from './ui/button';

export interface RunViewerProps {
  runId: string;
  onClose: () => void;
}

/**
 * First real xterm mount in Command-Center. KB-P4.2 v1.2 explicit-dispose
 * lifecycle is LOAD-BEARING — the XtermContainer's `useEffect` return
 * handles `term.dispose()` + addon disposal; we only hold a ref to the
 * Terminal to feed bytes.
 *
 * Wire:
 *   1. Fetch the agent_run row (includes session's scrollback_blob).
 *   2. When xterm mounts, seed with scrollback bytes (N3 single-run replay).
 *   3. Subscribe via `useSessionStream` — live PTY bytes write to the same
 *      Terminal; hook events render in the side panel as chips.
 *   4. On unmount, WS cleanup runs via the hook, xterm dispose via the
 *      XtermContainer's useEffect return.
 */
export function RunViewer({ runId, onClose }: RunViewerProps) {
  const queryClient = useQueryClient();
  const termRef = useRef<Terminal | null>(null);
  const scrollbackSeededRef = useRef(false);

  const configQuery = useQuery({
    queryKey: ['sidecar', 'config'],
    queryFn: readSidecarConfig,
  });

  const runQuery = useQuery<AgentRunWithScrollback>({
    queryKey: ['sidecar', 'run', runId],
    queryFn: async () => {
      if (!configQuery.data?.port) throw new Error('no port');
      return fetchAgentRun(configQuery.data.port, runId);
    },
    enabled: Boolean(configQuery.data?.port),
    refetchInterval: (query) => {
      // Poll while running; stop once terminal.
      const status = query.state.data?.status;
      return status && status !== 'running' && status !== 'queued' ? false : 2_000;
    },
  });

  const run = runQuery.data;

  // Seed xterm with historical scrollback once terminal is ready + run fetched.
  const onTermReady = useCallback(
    (term: Terminal) => {
      termRef.current = term;
      if (scrollbackSeededRef.current) return;
      if (run?.scrollbackBlob && run.scrollbackBlob.length > 0) {
        try {
          const bytes = decodeBase64(run.scrollbackBlob);
          term.write(bytes);
          scrollbackSeededRef.current = true;
        } catch {
          // Corrupt scrollback — skip seed; live stream still works.
        }
      }
    },
    [run?.scrollbackBlob],
  );

  // If the run data arrives AFTER the terminal mounted, seed on the next tick.
  useEffect(() => {
    if (!termRef.current || scrollbackSeededRef.current) return;
    if (run?.scrollbackBlob && run.scrollbackBlob.length > 0) {
      try {
        termRef.current.write(decodeBase64(run.scrollbackBlob));
        scrollbackSeededRef.current = true;
      } catch {
        // noop
      }
    }
  }, [run?.scrollbackBlob]);

  // Subscribe live. Every chunk writes into the Terminal via ref — no re-render.
  const { hookEvents, status: wsStatus } = useSessionStream({
    sessionId: run?.sessionId ?? null,
    port: configQuery.data?.port ?? null,
    bearer: configQuery.data?.bearerToken ?? null,
    onPtyData: (bytes) => {
      termRef.current?.write(bytes);
    },
  });

  const cancel = useMutation({
    mutationFn: async () => {
      if (!configQuery.data?.port) throw new Error('no port');
      return cancelAgentRun(configQuery.data.port, runId);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['sidecar', 'run', runId] });
      void queryClient.invalidateQueries({ queryKey: ['sidecar', 'recent-runs'] });
    },
  });

  const isRunning = run?.status === 'running' || run?.status === 'queued';
  const elapsedLabel = computeElapsedLabel(run);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop click-outside pattern; keyboard close via header Close button (aria-labeled).
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation-only; keyboard handled by interactive children. */}
      <div
        className="w-[min(1100px,94vw)] h-[min(720px,88vh)] rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 px-6 py-4 border-b border-neutral-800">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-neutral-100">Run viewer</h2>
              <StatusBadge status={run?.status} />
            </div>
            <div className="mt-1 text-xs font-mono text-neutral-500 truncate">
              run:{runId.slice(0, 8)}… · session:{run?.sessionId?.slice(0, 8) ?? '—'}… · ws:
              {wsStatus} · {elapsedLabel}
            </div>
            {run?.exitReason ? (
              <div className="mt-1 text-xs text-neutral-400 font-mono truncate">
                exit: {run.exitReason}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {isRunning ? (
              <Button variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
                {cancel.isPending ? 'Cancelling…' : 'Cancel'}
              </Button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded hover:bg-neutral-800 text-neutral-400 hover:text-neutral-100"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="flex-1 grid grid-cols-[1fr_240px] min-h-0">
          <div className="min-h-0 bg-black border-r border-neutral-800">
            <XtermContainer onReady={onTermReady} />
          </div>
          <aside className="min-h-0 overflow-y-auto bg-neutral-950 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              Hook events
            </div>
            {hookEvents.length === 0 ? (
              <div className="mt-2 text-xs text-neutral-500">
                No hook events yet. Events from the spawned Claude Code session appear here
                chronologically.
              </div>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {hookEvents.map((evt) => (
                  <li
                    key={evt.event_uuid}
                    className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs"
                  >
                    <div className="font-mono text-neutral-100">{evt.event_name}</div>
                    <div className="mt-0.5 text-[10px] text-neutral-500 font-mono">
                      {evt.timestamp.slice(11, 19)} · evt:
                      {evt.event_uuid.slice(0, 8)}…
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>

        {cancel.isError ? (
          <footer className="px-6 py-2 border-t border-neutral-800 text-xs text-red-400">
            cancel failed: {cancel.error instanceof Error ? cancel.error.message : 'unknown'}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string | undefined }) {
  if (!status) return null;
  const color = statusColorClass(status);
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold ${color}`}
    >
      {status}
    </span>
  );
}

function statusColorClass(status: string): string {
  switch (status) {
    case 'running':
      return 'bg-blue-500/20 text-blue-300 border border-blue-500/30';
    case 'completed':
      return 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
    case 'cancelled':
      return 'bg-amber-500/20 text-amber-300 border border-amber-500/30';
    case 'timed-out':
      return 'bg-amber-500/20 text-amber-300 border border-amber-500/30';
    case 'failed':
      return 'bg-red-500/20 text-red-300 border border-red-500/30';
    case 'queued':
      return 'bg-neutral-700/40 text-neutral-300 border border-neutral-700';
    default:
      return 'bg-neutral-800 text-neutral-300 border border-neutral-700';
  }
}

function computeElapsedLabel(run: AgentRunWithScrollback | undefined): string {
  if (!run) return '—';
  if (run.wallClockSeconds && run.wallClockSeconds > 0) {
    return `${run.wallClockSeconds}s elapsed`;
  }
  if (run.startedAt) {
    const since = Date.now() - Date.parse(run.startedAt);
    if (Number.isFinite(since) && since > 0) {
      return `${Math.round(since / 1000)}s elapsed`;
    }
  }
  return 'pending';
}

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}
