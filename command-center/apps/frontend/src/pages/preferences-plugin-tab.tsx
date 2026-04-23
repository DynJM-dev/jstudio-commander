import { useQuery } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import {
  type RecentEventsResponse,
  fetchRecentEvents,
  getPluginPath,
  readSidecarConfig,
} from '../lib/sidecar-client';

const PLUGIN_DETECTED_WINDOW_MS = 10 * 60 * 1000; // 10 min — per dispatch §2 T8

interface CopyableBlockProps {
  label: string;
  command: string;
  helperText?: string;
}

function CopyableBlock({ label, command, helperText }: CopyableBlockProps) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard denied — noop
    }
  }, [command]);

  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="mt-1 flex items-stretch gap-2">
        <code className="flex-1 text-xs font-mono bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-neutral-300 select-all break-all">
          {command}
        </code>
        <Button variant="outline" onClick={copy} aria-label={`Copy ${label}`}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {helperText ? <p className="mt-1 text-xs text-neutral-500">{helperText}</p> : null}
    </div>
  );
}

function isRecent(timestampIso: string, withinMs: number): boolean {
  const eventMs = Date.parse(timestampIso);
  if (Number.isNaN(eventMs)) return false;
  return Date.now() - eventMs <= withinMs;
}

function StatusIndicator({ events }: { events: RecentEventsResponse | undefined }) {
  const detected = useMemo(() => {
    if (!events || events.count === 0) return false;
    return events.events.some((e) => isRecent(e.timestamp, PLUGIN_DETECTED_WINDOW_MS));
  }, [events]);

  const dotClass = detected ? 'bg-emerald-400' : 'bg-neutral-500';
  const label = detected
    ? 'Plugin detected'
    : 'Plugin not detected — install to enable hook events';

  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        Status
      </div>
      <div className="mt-1 flex items-center gap-2 text-sm">
        <span className={`w-2 h-2 rounded-full ${dotClass}`} />
        <span className="text-neutral-100">{label}</span>
      </div>
      {detected ? (
        <p className="mt-1 text-xs text-neutral-500">
          Hook events arrived within the last {PLUGIN_DETECTED_WINDOW_MS / 60_000} min.
        </p>
      ) : (
        <p className="mt-1 text-xs text-neutral-500">
          Run the install command in a Claude Code session, then send any prompt.
        </p>
      )}
    </div>
  );
}

export function PluginTab() {
  const configQuery = useQuery({
    queryKey: ['sidecar', 'config'],
    queryFn: readSidecarConfig,
  });

  const pluginPathQuery = useQuery({
    queryKey: ['tauri', 'plugin-path'],
    queryFn: getPluginPath,
  });

  const recentQuery = useQuery<RecentEventsResponse>({
    queryKey: ['sidecar', 'recent-events', 'status'],
    queryFn: async () => {
      if (!configQuery.data?.port) throw new Error('no port from config');
      return fetchRecentEvents(configQuery.data.port, { limit: 1 });
    },
    enabled: Boolean(configQuery.data?.port),
    refetchInterval: 5_000, // dispatch §2 T8 — 5s poll
  });

  const pluginPath = pluginPathQuery.data;
  const port = configQuery.data?.port;
  const token = configQuery.data?.bearerToken;

  const installCommand = pluginPath ? `/plugin install file://${pluginPath}` : 'resolving…';
  const marketplaceCommand = pluginPath
    ? `/plugin marketplace add file://${pluginPath}\n/plugin install commander@jstudio`
    : 'resolving…';
  const envExportCommand =
    port && token ? `export COMMANDER_PORT=${port}\nexport COMMANDER_TOKEN=${token}` : 'resolving…';

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold text-neutral-100">How it works</h3>
        <p className="mt-1 text-xs text-neutral-400">
          Install the Command Center plugin in a Claude Code session. After install, the plugin
          POSTs every hook event (SessionStart, UserPromptSubmit, PreToolUse, etc.) to this app's
          local sidecar so sessions, tasks, and runs stay in sync.
        </p>
      </section>

      <CopyableBlock
        label="1. Export env vars (set before launching the Claude Code session)"
        command={envExportCommand}
        helperText="Add to ~/.zshrc to persist across terminals. COMMANDER_TOKEN is this sidecar's bearer — required for hook authentication."
      />

      <CopyableBlock
        label="2. Install via marketplace (recommended — survives Command Center path changes after registration)"
        command={marketplaceCommand}
      />

      <CopyableBlock
        label="2. Or — single-shot install by path"
        command={installCommand}
        helperText="Equivalent to the marketplace approach but re-references the path on every use."
      />

      <StatusIndicator events={recentQuery.data} />

      {recentQuery.error ? (
        <div className="text-xs text-red-400">
          status poll failed:{' '}
          {recentQuery.error instanceof Error ? recentQuery.error.message : 'unknown'}
        </div>
      ) : null}
    </div>
  );
}
