import type { TaskLatestRun, TaskWithLatestRun } from '../lib/sidecar-client';

export interface TaskCardProps {
  task: TaskWithLatestRun;
  /** Clicking a card opens the RunViewer for its latest run (if any). */
  onOpenRun: (runId: string) => void;
}

/**
 * Kanban card. Renders title + the latest agent_run's status pill, elapsed
 * time, and exit reason if terminal. Clicking the card opens the RunViewer
 * focused on the latest run. If the task has never spawned, the card is a
 * no-op click with a faded "no runs yet" subtitle.
 *
 * Status pill colors follow KB-P1.10 conventions:
 *  - running / queued → blue
 *  - completed        → emerald
 *  - cancelled / timed-out → amber
 *  - failed           → red
 *  - (none)           → neutral
 */
export function TaskCard({ task, onOpenRun }: TaskCardProps) {
  const latest = task.latestRun;
  const hasRun = latest !== null;

  const clickable = hasRun;
  const Wrapper = clickable ? 'button' : 'div';
  const wrapperProps: Record<string, unknown> = clickable
    ? {
        type: 'button',
        onClick: () => latest && onOpenRun(latest.id),
        'aria-label': `Open run ${latest?.id.slice(0, 8)}`,
      }
    : {};

  return (
    <Wrapper
      {...wrapperProps}
      className={`w-full text-left rounded border border-neutral-800 bg-neutral-900 px-3 py-2.5 transition-colors ${
        clickable ? 'hover:border-neutral-700 hover:bg-neutral-800/60 cursor-pointer' : ''
      }`}
    >
      <div className="text-sm text-neutral-100 font-medium break-words">{task.title}</div>

      <div className="mt-1.5 flex items-center gap-2 flex-wrap text-[11px]">
        {latest ? <RunStatusPill status={latest.status} /> : null}
        {latest ? (
          <RunMetaLabel latest={latest} />
        ) : (
          <span className="text-neutral-500 font-mono">no runs yet</span>
        )}
      </div>

      {latest?.exitReason ? (
        <div className="mt-1.5 text-[11px] font-mono text-neutral-500 truncate">
          exit: {latest.exitReason}
        </div>
      ) : null}
    </Wrapper>
  );
}

function RunStatusPill({ status }: { status: string }) {
  const color =
    status === 'running' || status === 'queued' || status === 'waiting'
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

function RunMetaLabel({ latest }: { latest: TaskLatestRun }) {
  const parts: string[] = [];
  const isTerminal =
    latest.status === 'completed' ||
    latest.status === 'failed' ||
    latest.status === 'cancelled' ||
    latest.status === 'timed-out';

  if (latest.wallClockSeconds > 0) {
    parts.push(`${latest.wallClockSeconds}s`);
  } else if (latest.startedAt && !isTerminal) {
    const since = Date.now() - Date.parse(latest.startedAt);
    if (Number.isFinite(since) && since > 0) {
      parts.push(`${Math.round(since / 1000)}s`);
    }
  }
  if (latest.tokensUsed > 0) parts.push(`${latest.tokensUsed} tok`);
  parts.push(`run:${latest.id.slice(0, 8)}…`);
  return <span className="text-neutral-500 font-mono">{parts.join(' · ')}</span>;
}
