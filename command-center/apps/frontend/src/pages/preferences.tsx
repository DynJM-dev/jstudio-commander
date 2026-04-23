import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { DialogShell } from '../components/ui/dialog';
import { TabsShell } from '../components/ui/tabs';
import { getFirstPaintMs } from '../lib/first-paint';
import { probeGpu } from '../lib/gpu-probe';
import {
  type AgentRunSummary,
  type HealthResponse,
  type HookEventSummary,
  type RecentEventsResponse,
  type RecentRunsResponse,
  fetchHealth,
  fetchRecentEvents,
  fetchRecentRuns,
  readSidecarConfig,
  replayLastEvent,
} from '../lib/sidecar-client';
import { type PreferencesTab, usePreferencesStore } from '../state/preferences-store';
import { PluginTab } from './preferences-plugin-tab';

const XtermProbe = lazy(() =>
  import('../components/xterm-probe').then((m) => ({ default: m.XtermProbe })),
);

export interface PreferencesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PreferencesModal({ open, onOpenChange }: PreferencesModalProps) {
  const activeTab = usePreferencesStore((s) => s.activeTab);
  const setActiveTab = usePreferencesStore((s) => s.setActiveTab);

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Preferences"
      description="Configure Command Center and inspect sidecar state."
    >
      <TabsShell
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as PreferencesTab)}
        tabs={[
          { value: 'general', label: 'General', content: <GeneralTab /> },
          { value: 'plugin', label: 'Plugin', content: <PluginTab /> },
          { value: 'debug', label: 'Debug', content: <DebugTab /> },
        ]}
      />
    </DialogShell>
  );
}

// ----- TanStack Query keys -----

const HEALTH_QUERY_KEY = ['sidecar', 'health'] as const;
const CONFIG_QUERY_KEY = ['sidecar', 'config'] as const;
const RECENT_EVENTS_QUERY_KEY = ['sidecar', 'recent-events'] as const;
const RECENT_RUNS_QUERY_KEY = ['sidecar', 'recent-runs'] as const;

// ----- General tab -----

function GeneralTab() {
  const configQuery = useQuery({
    queryKey: CONFIG_QUERY_KEY,
    queryFn: readSidecarConfig,
  });

  const healthQuery = useQuery<HealthResponse>({
    queryKey: HEALTH_QUERY_KEY,
    queryFn: async () => {
      if (!configQuery.data?.port) throw new Error('no port from config');
      return fetchHealth(configQuery.data.port);
    },
    enabled: Boolean(configQuery.data?.port),
    refetchInterval: 5_000,
  });

  return (
    <div className="space-y-6">
      <SidecarStatusPanel healthQuery={healthQuery} configQuery={configQuery} />
      <BearerTokenPanel bearer={configQuery.data?.bearerToken} />
      <section>
        <SectionLabel>Version</SectionLabel>
        <div className="mt-1 text-sm text-neutral-300 font-mono">
          {healthQuery.data?.version ?? configQuery.data?.version ?? '—'}
        </div>
      </section>
    </div>
  );
}

function SidecarStatusPanel({
  healthQuery,
  configQuery,
}: {
  healthQuery: ReturnType<typeof useQuery<HealthResponse>>;
  configQuery: ReturnType<typeof useQuery<Awaited<ReturnType<typeof readSidecarConfig>>>>;
}) {
  let status: 'healthy' | 'degraded' | 'unreachable' | 'loading';
  let detail = '';
  if (configQuery.isLoading || healthQuery.isLoading) {
    status = 'loading';
    detail = 'Probing sidecar…';
  } else if (configQuery.error) {
    status = 'unreachable';
    detail = `config.json unreadable: ${configQuery.error instanceof Error ? configQuery.error.message : 'unknown'}`;
  } else if (healthQuery.error) {
    status = 'unreachable';
    detail = `fetch /health failed: ${healthQuery.error instanceof Error ? healthQuery.error.message : 'unknown'}`;
  } else if (healthQuery.data?.status === 'ok') {
    status = 'healthy';
    detail = `port ${healthQuery.data.port} · uptime ${healthQuery.data.uptimeSeconds}s`;
  } else {
    status = 'degraded';
    detail = 'Sidecar responded but status != "ok"';
  }

  const dotClass =
    status === 'healthy'
      ? 'bg-emerald-400'
      : status === 'unreachable'
        ? 'bg-red-400'
        : status === 'degraded'
          ? 'bg-amber-400'
          : 'bg-neutral-500 animate-pulse';

  return (
    <section>
      <SectionLabel>Sidecar</SectionLabel>
      <div className="mt-1 flex items-center gap-2 text-sm">
        <span className={`w-2 h-2 rounded-full ${dotClass}`} />
        <span className="text-neutral-100 capitalize">{status}</span>
        <span className="text-neutral-500 text-xs">· {detail}</span>
      </div>
    </section>
  );
}

function BearerTokenPanel({ bearer }: { bearer: string | undefined }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    if (!bearer) return;
    try {
      await navigator.clipboard.writeText(bearer);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // noop
    }
  }, [bearer]);

  return (
    <section>
      <SectionLabel>Bearer token</SectionLabel>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 text-xs font-mono bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-neutral-300 tracking-tight select-all">
          {bearer ?? '—'}
        </code>
        <Button variant="outline" onClick={copy} disabled={!bearer} aria-label="Copy bearer token">
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="mt-2 text-xs text-neutral-500">
        Paste into external Claude Code sessions (MCP config) and the plugin (
        <code>$COMMANDER_TOKEN</code>).
      </p>
    </section>
  );
}

// ----- Debug tab -----

function DebugTab() {
  const gpu = useMemo(() => probeGpu(), []);
  const firstPaintMs = useMemo(() => getFirstPaintMs(), []);

  const configQuery = useQuery({ queryKey: CONFIG_QUERY_KEY, queryFn: readSidecarConfig });
  const healthQuery = useQuery<HealthResponse>({
    queryKey: HEALTH_QUERY_KEY,
    queryFn: async () => {
      if (!configQuery.data?.port) throw new Error('no port');
      return fetchHealth(configQuery.data.port);
    },
    enabled: Boolean(configQuery.data?.port),
  });

  const [showProbe, setShowProbe] = useState(false);
  const [schemaExpanded, setSchemaExpanded] = useState(false);

  const tableCount = healthQuery.data?.tableCount ?? null;
  const tableNames = healthQuery.data?.tableNames ?? [];

  return (
    <div className="space-y-6">
      <RecentRunsPanel port={configQuery.data?.port} />

      <RecentEventsPanel port={configQuery.data?.port} />

      <section>
        <SectionLabel>Schema</SectionLabel>
        <button
          type="button"
          onClick={() => setSchemaExpanded((v) => !v)}
          className="mt-1 text-sm text-neutral-200 hover:text-blue-400 transition-colors flex items-center gap-1"
        >
          {tableCount !== null ? `${tableCount} tables loaded` : 'loading…'}
          <span className="text-neutral-500 text-xs">
            {schemaExpanded ? '(click to collapse)' : '(click to expand)'}
          </span>
        </button>
        {schemaExpanded && tableNames.length > 0 ? (
          <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono text-neutral-400">
            {tableNames.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section>
        <SectionLabel>GPU acceleration</SectionLabel>
        <div className="mt-1 flex items-center gap-2 text-sm">
          <span
            className={`w-2 h-2 rounded-full ${gpu.accelerated ? 'bg-emerald-400' : 'bg-red-400'}`}
          />
          <span className="text-neutral-100">
            {gpu.accelerated ? 'Hardware accelerated' : 'Software only'}
          </span>
        </div>
        <dl className="mt-2 text-xs text-neutral-400 font-mono grid grid-cols-[110px_1fr] gap-x-4 gap-y-1">
          <dt>Renderer</dt>
          <dd className="text-neutral-300 break-all">{gpu.renderer}</dd>
          <dt>Vendor</dt>
          <dd className="text-neutral-300 break-all">{gpu.vendor}</dd>
          <dt>WebGL</dt>
          <dd className="text-neutral-300">{gpu.webglVersion}</dd>
          {gpu.reason ? (
            <>
              <dt>Reason</dt>
              <dd className="text-amber-400">{gpu.reason}</dd>
            </>
          ) : null}
        </dl>
      </section>

      <section>
        <SectionLabel>First-paint timestamp</SectionLabel>
        <div className="mt-1 text-sm text-neutral-300 font-mono">
          {firstPaintMs !== null ? `${firstPaintMs.toFixed(1)} ms` : 'unavailable'}
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          Target: ≤ 200 ms from webview mount (dispatch §1.1).
        </p>
      </section>

      <section>
        <SectionLabel>Xterm probe</SectionLabel>
        <div className="mt-1 flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowProbe((v) => !v)}>
            {showProbe ? 'Hide probe' : 'Show probe'}
          </Button>
          <span className="text-xs text-neutral-500">
            Verifies scrollbar-gutter fix — no 14px strip should appear.
          </span>
        </div>
        {showProbe ? (
          <div className="mt-3 h-56 rounded border border-neutral-800 bg-black overflow-hidden">
            <Suspense fallback={<div className="p-3 text-xs text-neutral-500">Loading xterm…</div>}>
              <XtermProbe />
            </Suspense>
          </div>
        ) : null}
      </section>
    </div>
  );
}

// ----- Recent hook events panel (acceptance 2.2 + 2.3) -----

function RecentEventsPanel({ port }: { port: number | undefined }) {
  const queryClient = useQueryClient();
  const eventsQuery = useQuery<RecentEventsResponse>({
    queryKey: RECENT_EVENTS_QUERY_KEY,
    queryFn: async () => {
      if (!port) throw new Error('no port');
      return fetchRecentEvents(port, { limit: 20 });
    },
    enabled: Boolean(port),
    refetchInterval: 3_000,
  });

  const replay = useMutation({
    mutationFn: async () => {
      if (!port) throw new Error('no port');
      return replayLastEvent(port);
    },
    onSettled: () => {
      // Force a refresh of the events list AFTER the replay so the user can
      // see the count stayed the same (acceptance 2.3 de-dupe verification).
      void queryClient.invalidateQueries({ queryKey: RECENT_EVENTS_QUERY_KEY });
    },
  });

  const count = eventsQuery.data?.count ?? 0;
  const events = eventsQuery.data?.events ?? [];

  return (
    <section>
      <div className="flex items-center justify-between">
        <SectionLabel>Recent hook events</SectionLabel>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-neutral-500 font-mono">
            {count} event{count === 1 ? '' : 's'}
          </span>
          <Button
            variant="outline"
            onClick={() => eventsQuery.refetch()}
            aria-label="Refresh recent events"
          >
            <RefreshCw size={13} />
            Refresh
          </Button>
          <Button
            variant="outline"
            onClick={() => replay.mutate()}
            disabled={replay.isPending || events.length === 0}
            aria-label="Replay last event"
          >
            {replay.isPending ? 'Replaying…' : 'Replay last event'}
          </Button>
        </div>
      </div>

      {replay.isError ? (
        <div className="mt-2 text-xs text-red-400">
          {replay.error instanceof Error ? replay.error.message : 'replay failed'}
        </div>
      ) : null}
      {replay.isSuccess && replay.data ? (
        <div className="mt-2 text-xs text-emerald-400">
          Replayed {replay.data.replayedEventName} — de-dupe should leave count unchanged.
        </div>
      ) : null}

      <div className="mt-2 rounded border border-neutral-800 bg-neutral-900 max-h-64 overflow-y-auto">
        {eventsQuery.isLoading ? (
          <div className="p-3 text-xs text-neutral-500">Loading…</div>
        ) : eventsQuery.error ? (
          <div className="p-3 text-xs text-red-400">
            {eventsQuery.error instanceof Error ? eventsQuery.error.message : 'fetch failed'}
          </div>
        ) : events.length === 0 ? (
          <div className="p-3 text-xs text-neutral-500">
            No events yet. Install the plugin (Plugin tab) and start a Claude Code session.
          </div>
        ) : (
          <ul className="divide-y divide-neutral-800">
            {events.map((e) => (
              <HookEventRow key={e.id} event={e} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function HookEventRow({ event }: { event: HookEventSummary }) {
  const hhmmss = event.timestamp.slice(11, 19);
  const sid = event.sessionId.slice(0, 8);
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-neutral-500 font-mono">{hhmmss}</span>
        <span className="font-mono text-neutral-100">{event.eventName}</span>
      </div>
      <span className="text-[10px] font-mono text-neutral-500 truncate">sid:{sid}…</span>
    </li>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
      {children}
    </div>
  );
}

// ----- Recent agent runs panel (N3 T9) -----

function RecentRunsPanel({ port }: { port: number | undefined }) {
  const setViewingRunId = usePreferencesStore((s) => s.setViewingRunId);
  const setOpen = usePreferencesStore((s) => s.setOpen);

  const runsQuery = useQuery<RecentRunsResponse>({
    queryKey: RECENT_RUNS_QUERY_KEY,
    queryFn: async () => {
      if (!port) throw new Error('no port');
      return fetchRecentRuns(port, { limit: 20 });
    },
    enabled: Boolean(port),
    refetchInterval: 5_000,
  });

  const runs = runsQuery.data?.runs ?? [];
  const count = runsQuery.data?.count ?? 0;

  return (
    <section>
      <div className="flex items-center justify-between">
        <SectionLabel>Recent agent runs</SectionLabel>
        <span className="text-[11px] text-neutral-500 font-mono">
          {count} run{count === 1 ? '' : 's'}
        </span>
      </div>

      <div className="mt-2 rounded border border-neutral-800 bg-neutral-900 max-h-64 overflow-y-auto">
        {runsQuery.isLoading ? (
          <div className="p-3 text-xs text-neutral-500">Loading…</div>
        ) : runsQuery.error ? (
          <div className="p-3 text-xs text-red-400">
            {runsQuery.error instanceof Error ? runsQuery.error.message : 'fetch failed'}
          </div>
        ) : runs.length === 0 ? (
          <div className="p-3 text-xs text-neutral-500">
            No agent runs yet. Spawn one via the Claude Code MCP tool
            <code className="mx-1 text-neutral-300">spawn_agent_run</code>.
          </div>
        ) : (
          <ul className="divide-y divide-neutral-800">
            {runs.map((r) => (
              <AgentRunRow
                key={r.id}
                run={r}
                onView={() => {
                  setViewingRunId(r.id);
                  setOpen(false); // close Preferences so the viewer is frontmost
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function AgentRunRow({
  run,
  onView,
}: {
  run: AgentRunSummary;
  onView: () => void;
}) {
  const hhmmss = run.startedAt ? run.startedAt.slice(11, 19) : '—';
  const sid = run.sessionId ? `${run.sessionId.slice(0, 8)}…` : '—';
  const wall = run.wallClockSeconds && run.wallClockSeconds > 0 ? `${run.wallClockSeconds}s` : '—';
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs">
      <div className="min-w-0 flex-1 grid grid-cols-[auto_auto_1fr_auto] gap-3 items-center">
        <span className="text-neutral-500 font-mono">{hhmmss}</span>
        <RunStatusPill status={run.status} />
        <span className="font-mono text-neutral-500 truncate">
          run:{run.id.slice(0, 8)}… · sid:{sid} · {wall}
        </span>
      </div>
      <Button variant="outline" onClick={onView} aria-label={`View run ${run.id.slice(0, 8)}`}>
        View
      </Button>
    </li>
  );
}

function RunStatusPill({ status }: { status: string }) {
  const color =
    status === 'running'
      ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
      : status === 'completed'
        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
        : status === 'cancelled' || status === 'timed-out'
          ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
          : status === 'failed'
            ? 'bg-red-500/20 text-red-300 border-red-500/30'
            : 'bg-neutral-700/40 text-neutral-300 border-neutral-700';
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold border ${color}`}
    >
      {status}
    </span>
  );
}
