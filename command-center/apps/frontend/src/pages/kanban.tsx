import { useQuery } from '@tanstack/react-query';
import { Plus, Settings } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AddTaskModal } from '../components/add-task-modal';
import { TaskCard } from '../components/task-card';
import { Button } from '../components/ui/button';
import {
  type TaskStatus,
  type TaskWithLatestRun,
  fetchTasksWithLatestRun,
  readSidecarConfig,
} from '../lib/sidecar-client';
import { usePreferencesStore } from '../state/preferences-store';

/**
 * Kanban home page (N4 T2). Four columns keyed to `task.status`:
 *   todo · in_progress · in_review · done
 *
 * Data flow: single `/api/tasks/with-latest-run` query fetches all tasks
 * across all projects (no workspace filter in N4a — that ships in N4b T10).
 * Rows are bucketed client-side by status to avoid 4× round-trips. Poll every
 * 3s so cards pick up run-status transitions without manual refresh.
 *
 * Clicking a card opens the RunViewer for the latest run (via the shared
 * `viewingRunId` store — App.tsx renders the viewer overlay). The "+ Add
 * Task" button per column pre-seeds the modal's status selector.
 */
export function KanbanPage() {
  const setOpenPrefs = usePreferencesStore((s) => s.setOpen);
  const setViewingRunId = usePreferencesStore((s) => s.setViewingRunId);

  const configQuery = useQuery({
    queryKey: ['sidecar', 'config'],
    queryFn: readSidecarConfig,
  });

  const tasksQuery = useQuery({
    queryKey: ['sidecar', 'tasks-with-latest-run'],
    queryFn: async () => {
      if (!configQuery.data?.port) throw new Error('no port');
      return fetchTasksWithLatestRun(configQuery.data.port);
    },
    enabled: Boolean(configQuery.data?.port),
    refetchInterval: 3_000,
  });

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addModalStatus, setAddModalStatus] = useState<TaskStatus>('todo');

  const buckets = useMemo(
    () => bucketTasksByStatus(tasksQuery.data?.tasks ?? []),
    [tasksQuery.data?.tasks],
  );

  return (
    <main className="h-full w-full flex flex-col bg-neutral-950 text-neutral-100 overflow-hidden">
      <header className="flex items-center justify-between gap-4 px-6 py-3 border-b border-neutral-800">
        <div className="flex items-center gap-3">
          <div className="text-sm font-semibold tracking-tight">Command Center</div>
          <div className="text-[11px] text-neutral-500 font-mono">
            {tasksQuery.data
              ? `${tasksQuery.data.count} task${tasksQuery.data.count === 1 ? '' : 's'}`
              : '—'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              setAddModalStatus('todo');
              setAddModalOpen(true);
            }}
          >
            <Plus size={14} />
            Add task
          </Button>
          <Button variant="ghost" onClick={() => setOpenPrefs(true)} aria-label="Preferences">
            <Settings size={14} />
          </Button>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-4 gap-4 p-4 min-h-0 overflow-hidden">
        {COLUMNS.map((col) => (
          <KanbanColumn
            key={col.status}
            status={col.status}
            label={col.label}
            tasks={buckets[col.status]}
            loading={tasksQuery.isLoading}
            error={tasksQuery.error}
            onAdd={() => {
              setAddModalStatus(col.status);
              setAddModalOpen(true);
            }}
            onOpenRun={(runId) => setViewingRunId(runId)}
          />
        ))}
      </div>

      <AddTaskModal
        open={addModalOpen}
        onOpenChange={setAddModalOpen}
        defaultStatus={addModalStatus}
      />
    </main>
  );
}

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'Todo' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'in_review', label: 'In review' },
  { status: 'done', label: 'Done' },
];

function bucketTasksByStatus(tasks: TaskWithLatestRun[]): Record<TaskStatus, TaskWithLatestRun[]> {
  const out: Record<TaskStatus, TaskWithLatestRun[]> = {
    todo: [],
    in_progress: [],
    in_review: [],
    done: [],
  };
  for (const t of tasks) {
    if (t.status in out) out[t.status].push(t);
  }
  return out;
}

interface KanbanColumnProps {
  status: TaskStatus;
  label: string;
  tasks: TaskWithLatestRun[];
  loading: boolean;
  error: unknown;
  onAdd: () => void;
  onOpenRun: (runId: string) => void;
}

function KanbanColumn({ label, tasks, loading, error, onAdd, onOpenRun }: KanbanColumnProps) {
  return (
    <section className="flex flex-col min-h-0 rounded-lg border border-neutral-800 bg-neutral-900/40">
      <header className="flex items-center justify-between px-3 py-2 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <div className="text-xs uppercase tracking-wider font-semibold text-neutral-400">
            {label}
          </div>
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded bg-neutral-800 text-[10px] font-mono text-neutral-300">
            {tasks.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="p-1 rounded hover:bg-neutral-800 text-neutral-500 hover:text-neutral-200 transition-colors"
          aria-label={`Add task to ${label}`}
        >
          <Plus size={14} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {loading ? (
          <div className="text-xs text-neutral-500 px-1 py-6 text-center">Loading…</div>
        ) : error ? (
          <div className="text-xs text-red-400 px-1 py-6 text-center">
            {error instanceof Error ? error.message : 'fetch failed'}
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-xs text-neutral-600 px-1 py-6 text-center">No tasks.</div>
        ) : (
          tasks.map((t) => <TaskCard key={t.id} task={t} onOpenRun={onOpenRun} />)
        )}
      </div>
    </section>
  );
}
