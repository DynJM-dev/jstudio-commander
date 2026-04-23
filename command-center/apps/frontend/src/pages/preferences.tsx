import { useQuery } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { DialogShell } from '../components/ui/dialog';
import { TabsShell } from '../components/ui/tabs';
import { getFirstPaintMs } from '../lib/first-paint';
import { probeGpu } from '../lib/gpu-probe';
import { type HealthResponse, fetchHealth, readSidecarConfig } from '../lib/sidecar-client';
import { usePreferencesStore } from '../state/preferences-store';

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
      description="Configure Command-Center and inspect sidecar state."
    >
      <TabsShell
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as 'general' | 'debug')}
        tabs={[
          { value: 'general', label: 'General', content: <GeneralTab /> },
          { value: 'debug', label: 'Debug', content: <DebugTab /> },
        ]}
      />
    </DialogShell>
  );
}

// ----- TanStack Query keys -----

const HEALTH_QUERY_KEY = ['sidecar', 'health'] as const;
const CONFIG_QUERY_KEY = ['sidecar', 'config'] as const;

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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
      {children}
    </div>
  );
}
