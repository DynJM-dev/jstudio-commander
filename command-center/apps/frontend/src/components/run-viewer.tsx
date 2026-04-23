import { XtermContainer } from '@commander/ui';
import * as RadixDialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Terminal } from '@xterm/xterm';
import { ArrowLeft, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSessionStream } from '../hooks/use-session-stream';
import {
  type AgentRunWithScrollback,
  type KnowledgeEntryRow,
  appendKnowledgeEntry,
  cancelAgentRun,
  fetchAgentRun,
  fetchKnowledgeByTask,
  readSidecarConfig,
} from '../lib/sidecar-client';
import { Button } from './ui/button';

export interface RunViewerProps {
  runId: string;
  onClose: () => void;
}

/**
 * Run viewer — Radix Dialog surface for a single agent_run's live xterm +
 * hook events + cancel affordance.
 *
 * **N4 T5 changes vs N3:**
 *
 * - Radix `<Dialog.Root>` + `<Dialog.Portal>` + `<Dialog.Content>` owns focus
 *   trap, Escape-to-close, aria-labeling, click-outside-to-close. **Debt 22
 *   a11y biome-ignore suppressions are gone** — Radix's semantics satisfy
 *   `useKeyWithClickEvents` natively.
 * - **Debt 23 fix: xterm buffer preservation on `running → completed`
 *   transition.** Root cause: `onTermReady` callback was defined via
 *   `useCallback(..., [run?.scrollbackBlob])`. Every time the polling query
 *   refetched after status flipped (which lands the freshly-flushed
 *   scrollback_blob from the sidecar's T3 `finalizeTerminal` → flush path),
 *   the callback identity changed, XtermContainer's `useEffect([onReady])`
 *   re-ran, cleanup disposed the old `term`, a new terminal mounted empty —
 *   visual "buffer cleared" artifact. **Fix:** route `run?.scrollbackBlob`
 *   through a ref (`scrollbackBlobRef`) + use `useCallback(..., [])` with
 *   empty deps so `onTermReady` identity is stable. XtermContainer's effect
 *   doesn't re-run on status transition; the existing Terminal instance +
 *   its byte buffer survive intact.
 * - **Back button** (UX Observation A) in the header alongside Close. Both
 *   invoke `onClose` — in N4 the "previous view" is always kanban (the
 *   home route), so Back and Close are functionally equivalent here. N5+
 *   card→viewer→card chains will diverge the two.
 */
export function RunViewer({ runId, onClose }: RunViewerProps) {
  const queryClient = useQueryClient();
  const termRef = useRef<Terminal | null>(null);
  const scrollbackSeededRef = useRef(false);
  const scrollbackBlobRef = useRef<string | null>(null);

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
      const status = query.state.data?.status;
      return status && status !== 'running' && status !== 'queued' ? false : 2_000;
    },
  });

  const run = runQuery.data;

  // Keep the latest scrollback_blob in a ref so `onTermReady` can read it
  // without having it in useCallback deps — Debt 23 root cause.
  useEffect(() => {
    scrollbackBlobRef.current = run?.scrollbackBlob ?? null;
  }, [run?.scrollbackBlob]);

  // Stable callback identity (empty deps). XtermContainer's useEffect won't
  // re-run + dispose the Terminal when other parts of run data change.
  const onTermReady = useCallback((term: Terminal) => {
    termRef.current = term;
    if (scrollbackSeededRef.current) return;
    const blob = scrollbackBlobRef.current;
    if (blob && blob.length > 0) {
      try {
        term.write(decodeBase64(blob));
        scrollbackSeededRef.current = true;
      } catch {
        // Corrupt scrollback — skip seed; live stream still works.
      }
    }
  }, []);

  // If run data arrives AFTER the terminal mounted (race between xterm mount
  // and initial /api/runs/:id fetch), seed on data arrival. One-shot via the
  // scrollbackSeededRef guard.
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
      void queryClient.invalidateQueries({ queryKey: ['sidecar', 'tasks-with-latest-run'] });
    },
  });

  const isRunning = run?.status === 'running' || run?.status === 'queued';
  const elapsedLabel = computeElapsedLabel(run);

  return (
    <RadixDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
        <RadixDialog.Content
          className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[min(1100px,94vw)] h-[min(720px,88vh)] rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl flex flex-col overflow-hidden focus:outline-none"
          aria-describedby={undefined}
        >
          <header className="flex items-start justify-between gap-4 px-6 py-4 border-b border-neutral-800">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  onClick={onClose}
                  aria-label="Back to kanban"
                  className="!px-2 !py-1"
                >
                  <ArrowLeft size={14} />
                  Back
                </Button>
                <RadixDialog.Title className="text-sm font-semibold text-neutral-100">
                  Run viewer
                </RadixDialog.Title>
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
                <Button
                  variant="outline"
                  onClick={() => cancel.mutate()}
                  disabled={cancel.isPending}
                >
                  {cancel.isPending ? 'Cancelling…' : 'Cancel'}
                </Button>
              ) : null}
              <RadixDialog.Close asChild>
                <button
                  type="button"
                  className="p-1 rounded hover:bg-neutral-800 text-neutral-400 hover:text-neutral-100 transition-colors"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </RadixDialog.Close>
            </div>
          </header>

          <div className="flex-1 grid grid-cols-[1fr_240px] min-h-0">
            <div className="min-h-0 bg-black">
              <XtermContainer onReady={onTermReady} />
            </div>
            <aside className="min-h-0 flex flex-col bg-neutral-950 border-l border-neutral-800">
              <SidebarTabs
                hookEvents={hookEvents}
                taskId={run?.taskId ?? null}
                runId={runId}
                port={configQuery.data?.port ?? null}
              />
            </aside>
          </div>

          {cancel.isError ? (
            <footer className="px-6 py-2 border-t border-neutral-800 text-xs text-red-400">
              cancel failed: {cancel.error instanceof Error ? cancel.error.message : 'unknown'}
            </footer>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
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

// ----- Sidebar tabs: Hook events + Knowledge (N4 T7) -----

type SidebarTab = 'events' | 'knowledge';

interface HookEventForSidebar {
  event_uuid: string;
  event_name: string;
  timestamp: string;
}

function SidebarTabs({
  hookEvents,
  taskId,
  runId,
  port,
}: {
  hookEvents: HookEventForSidebar[];
  taskId: string | null;
  runId: string;
  port: number | null;
}) {
  const [tab, setTab] = useState<SidebarTab>('events');

  return (
    <>
      <div className="flex items-center border-b border-neutral-800 text-[11px] font-semibold uppercase tracking-wider">
        <TabButton active={tab === 'events'} onClick={() => setTab('events')}>
          Hook events
        </TabButton>
        <TabButton active={tab === 'knowledge'} onClick={() => setTab('knowledge')}>
          Knowledge
        </TabButton>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        {tab === 'events' ? (
          <HookEventsList events={hookEvents} />
        ) : (
          <KnowledgePanel taskId={taskId} runId={runId} port={port} />
        )}
      </div>
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-3 py-2 transition-colors ${
        active
          ? 'text-neutral-100 bg-neutral-900 border-b border-neutral-100'
          : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900/50'
      }`}
    >
      {children}
    </button>
  );
}

function HookEventsList({ events }: { events: HookEventForSidebar[] }) {
  if (events.length === 0) {
    return (
      <div className="text-xs text-neutral-500">
        No hook events yet. Events from the spawned Claude Code session appear here chronologically.
      </div>
    );
  }
  return (
    <ul className="space-y-1.5">
      {events.map((evt) => (
        <li
          key={evt.event_uuid}
          className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs"
        >
          <div className="font-mono text-neutral-100">{evt.event_name}</div>
          <div className="mt-0.5 text-[10px] text-neutral-500 font-mono">
            {evt.timestamp.slice(11, 19)} · evt:{evt.event_uuid.slice(0, 8)}…
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Knowledge panel — KB-P1.3 append-only. Lists entries for the current task
 * (across all runs of that task) in chronological order + a bottom compose
 * box. Null taskId (run data still loading) renders a stub.
 */
function KnowledgePanel({
  taskId,
  runId,
  port,
}: {
  taskId: string | null;
  runId: string;
  port: number | null;
}) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['sidecar', 'knowledge', taskId],
    queryFn: async () => {
      if (!port || !taskId) throw new Error('no port / taskId');
      return fetchKnowledgeByTask(port, taskId);
    },
    enabled: Boolean(port && taskId),
    refetchInterval: 5_000,
  });

  const [draft, setDraft] = useState('');
  const append = useMutation({
    mutationFn: async () => {
      if (!port || !taskId) throw new Error('no port / taskId');
      return appendKnowledgeEntry(port, taskId, {
        contentMd: draft.trim(),
        agentRunId: runId,
      });
    },
    onSuccess: () => {
      setDraft('');
      void qc.invalidateQueries({ queryKey: ['sidecar', 'knowledge', taskId] });
    },
  });

  if (!taskId) {
    return <div className="text-xs text-neutral-500">Waiting for run data…</div>;
  }

  const entries = query.data?.entries ?? [];
  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
        {query.isLoading ? (
          <div className="text-xs text-neutral-500">Loading…</div>
        ) : query.error ? (
          <div className="text-xs text-red-400">
            {query.error instanceof Error ? query.error.message : 'fetch failed'}
          </div>
        ) : entries.length === 0 ? (
          <div className="text-xs text-neutral-500">
            No knowledge entries yet. Entries are append-only (KB-P1.3) and persist across runs of
            this task.
          </div>
        ) : (
          entries.map((e) => <KnowledgeEntry key={e.id} entry={e} />)
        )}
      </div>
      <form
        className="pt-2 border-t border-neutral-800"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim().length > 0 && !append.isPending) append.mutate();
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Append note (markdown)…"
          rows={3}
          className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1.5 text-xs text-neutral-100 font-mono focus:outline-none focus:border-blue-500/50 resize-y"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          {append.isError ? (
            <span className="text-[10px] text-red-400 truncate">
              {append.error instanceof Error ? append.error.message : 'append failed'}
            </span>
          ) : (
            <span />
          )}
          <Button
            type="submit"
            disabled={draft.trim().length === 0 || append.isPending}
            className="!text-xs !px-2 !py-1"
          >
            {append.isPending ? 'Appending…' : 'Append'}
          </Button>
        </div>
      </form>
    </div>
  );
}

function KnowledgeEntry({ entry }: { entry: KnowledgeEntryRow }) {
  const hhmmss = entry.timestamp.slice(11, 19);
  const byAgent = entry.agentId ? `agent:${entry.agentId.slice(0, 8)}…` : 'user';
  return (
    <div className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs">
      <div className="text-[10px] font-mono text-neutral-500 flex items-center justify-between gap-2">
        <span>{hhmmss}</span>
        <span>{byAgent}</span>
      </div>
      <div className="mt-1 text-neutral-200 whitespace-pre-wrap break-words">{entry.contentMd}</div>
    </div>
  );
}
