import { useState } from 'react';
import { CheckCircle2, Circle, CircleDotDashed, CircleAlert, CircleX, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const M = 'Montserrat, sans-serif';

const EASE: [number, number, number, number] = [0.2, 0.65, 0.3, 0.9];

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface PlanTask {
  id: string;
  title: string;
  description?: string;
  status: 'completed' | 'in_progress' | 'pending' | 'need_help' | 'failed';
  subtasks?: PlanTask[];
}

interface AgentPlanProps {
  tasks: PlanTask[];
  title?: string;
}

const STATUS_CONFIG = {
  completed: {
    icon: CheckCircle2,
    color: 'var(--color-working)',
    label: 'Done',
  },
  in_progress: {
    icon: CircleDotDashed,
    color: 'var(--color-accent)',
    label: 'Working',
  },
  pending: {
    icon: Circle,
    color: 'var(--color-stopped)',
    label: 'Pending',
  },
  need_help: {
    icon: CircleAlert,
    color: 'var(--color-idle)',
    label: 'Needs help',
  },
  failed: {
    icon: CircleX,
    color: 'var(--color-error)',
    label: 'Failed',
  },
} as const;

const StatusIcon = ({ status }: { status: PlanTask['status'] }) => {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const Icon = config.icon;
  const reduced = prefersReducedMotion();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={status}
        initial={reduced ? false : { rotate: -90, scale: 0.5, opacity: 0 }}
        animate={{ rotate: 0, scale: 1, opacity: 1 }}
        exit={reduced ? undefined : { rotate: 90, scale: 0.5, opacity: 0 }}
        transition={{ duration: 0.3, ease: EASE }}
        className="shrink-0"
      >
        <Icon size={16} style={{ color: config.color }} />
      </motion.div>
    </AnimatePresence>
  );
};

const TaskRow = ({ task, depth = 0, index = 0 }: { task: PlanTask; depth?: number; index?: number }) => {
  const [expanded, setExpanded] = useState(false);
  const hasSubtasks = task.subtasks && task.subtasks.length > 0;
  const reduced = prefersReducedMotion();
  const statusConfig = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.pending;

  return (
    <motion.div
      layout={!reduced}
      initial={reduced ? false : { opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04, ease: EASE }}
    >
      {/* Task row */}
      <div
        className="flex items-start gap-2 py-1.5 px-2 rounded-md transition-colors cursor-default"
        style={{ paddingLeft: depth * 20 + 8 }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        onClick={() => hasSubtasks && setExpanded(!expanded)}
      >
        {/* Expand chevron or spacer */}
        {hasSubtasks ? (
          <motion.div
            animate={{ rotate: expanded ? 90 : 0 }}
            transition={{ duration: 0.2, ease: EASE }}
            className="shrink-0 mt-px cursor-pointer"
          >
            <ChevronRight size={14} style={{ color: 'var(--color-text-tertiary)' }} />
          </motion.div>
        ) : (
          <div className="w-3.5 shrink-0" />
        )}

        {/* Status icon */}
        <StatusIcon status={task.status} />

        {/* Title */}
        <span
          className="text-sm flex-1 min-w-0"
          style={{
            fontFamily: M,
            color: task.status === 'completed' ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
          }}
        >
          {task.title}
        </span>

        {/* Status badge */}
        {task.status !== 'pending' && (
          <span
            className="text-xs px-1.5 py-0.5 rounded shrink-0"
            style={{
              fontFamily: M,
              color: statusConfig.color,
              background: `color-mix(in srgb, ${statusConfig.color} 10%, transparent)`,
            }}
          >
            {statusConfig.label}
          </span>
        )}
      </div>

      {/* Subtasks */}
      <AnimatePresence>
        {expanded && hasSubtasks && (
          <motion.div
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduced ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="overflow-hidden relative"
          >
            {/* Vertical dashed connecting line */}
            <div
              className="absolute"
              style={{
                left: depth * 20 + 22,
                top: 0,
                bottom: 8,
                width: 1,
                borderLeft: '1px dashed rgba(255, 255, 255, 0.1)',
              }}
            />
            {task.subtasks!.map((sub, i) => (
              <TaskRow key={sub.id} task={sub} depth={depth + 1} index={i} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export const AgentPlan = ({ tasks, title }: AgentPlanProps) => {
  const completed = tasks.filter((t) => t.status === 'completed').length;
  const total = tasks.length;
  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div
      className="rounded-lg my-2 overflow-hidden"
      style={{
        fontFamily: M,
        background: 'rgba(14, 124, 123, 0.04)',
        border: '1px solid rgba(14, 124, 123, 0.12)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: '1px solid rgba(14, 124, 123, 0.08)' }}
      >
        <span
          className="text-xs font-semibold"
          style={{ color: 'var(--color-accent-light)' }}
        >
          {title ?? 'Plan'}
        </span>
        <span className="flex-1" />
        {completed > 0 && (
          <>
            <span
              className="font-mono-stats text-xs"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              {completed}/{total}
            </span>
            <div
              className="w-12 h-1.5 rounded-full overflow-hidden"
              style={{ background: 'rgba(255, 255, 255, 0.06)' }}
            >
              <motion.div
                className="h-full rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent}%` }}
                transition={{ duration: 0.5, ease: EASE }}
                style={{
                  background: progressPercent === 100 ? 'var(--color-working)' : 'var(--color-accent)',
                }}
              />
            </div>
          </>
        )}
      </div>

      {/* Task list */}
      <div className="py-1">
        {tasks.map((task, i) => (
          <TaskRow key={task.id} task={task} index={i} />
        ))}
      </div>
    </div>
  );
};
