import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  TASK_STATUSES,
  type TaskStatus,
  createTask,
  readSidecarConfig,
} from '../lib/sidecar-client';
import { Button } from './ui/button';
import { DialogShell } from './ui/dialog';

export interface AddTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected column — the "+" button in a column sets this. */
  defaultStatus?: TaskStatus;
}

export function AddTaskModal({ open, onOpenChange, defaultStatus = 'todo' }: AddTaskModalProps) {
  const qc = useQueryClient();
  const configQuery = useQuery({
    queryKey: ['sidecar', 'config'],
    queryFn: readSidecarConfig,
  });

  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [status, setStatus] = useState<TaskStatus>(defaultStatus);

  const titleInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (open) titleInputRef.current?.focus();
  }, [open]);

  const create = useMutation({
    mutationFn: async () => {
      if (!configQuery.data?.port) throw new Error('no port');
      return createTask(configQuery.data.port, {
        title: title.trim(),
        instructionsMd: instructions,
        status,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sidecar', 'tasks'] });
      void qc.invalidateQueries({ queryKey: ['sidecar', 'tasks-with-latest-run'] });
      setTitle('');
      setInstructions('');
      setStatus(defaultStatus);
      onOpenChange(false);
    },
  });

  const canSubmit = title.trim().length > 0 && !create.isPending;

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Add task"
      description="Create a task row. You can spawn an agent against it from the card."
      widthClassName="w-[560px] max-w-[92vw]"
    >
      <form
        className="px-6 py-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) create.mutate();
        }}
      >
        <div>
          <label
            htmlFor="task-title"
            className="block text-xs uppercase tracking-wider text-neutral-500 font-semibold mb-1"
          >
            Title
          </label>
          <input
            id="task-title"
            ref={titleInputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What should happen?"
            className="w-full bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500/50"
          />
        </div>

        <div>
          <label
            htmlFor="task-instructions"
            className="block text-xs uppercase tracking-wider text-neutral-500 font-semibold mb-1"
          >
            Instructions (markdown)
          </label>
          <textarea
            id="task-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Context the agent will run against…"
            rows={6}
            className="w-full bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-sm text-neutral-100 font-mono focus:outline-none focus:border-blue-500/50 resize-y"
          />
        </div>

        <div>
          <label
            htmlFor="task-status"
            className="block text-xs uppercase tracking-wider text-neutral-500 font-semibold mb-1"
          >
            Column
          </label>
          <select
            id="task-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as TaskStatus)}
            className="bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500/50"
          >
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanizeStatus(s)}
              </option>
            ))}
          </select>
        </div>

        {create.isError ? (
          <div className="text-xs text-red-400">
            create failed: {create.error instanceof Error ? create.error.message : 'unknown'}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-800 -mx-6 px-6 pt-4">
          <Button variant="ghost" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {create.isPending ? 'Creating…' : 'Create task'}
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}

function humanizeStatus(s: TaskStatus): string {
  switch (s) {
    case 'todo':
      return 'Todo';
    case 'in_progress':
      return 'In progress';
    case 'in_review':
      return 'In review';
    case 'done':
      return 'Done';
  }
}
