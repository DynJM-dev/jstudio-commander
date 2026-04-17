import { useState } from 'react';
import { CheckCircle2, XCircle, Clock, ChevronRight, FileText, Sparkles, Wrench } from 'lucide-react';
import { motion } from 'framer-motion';
import type { TaskNotification } from '../../utils/chatMessageParser';
import { renderTextContent } from '../../utils/text-renderer';
import { formatTokens, formatDuration } from '../../utils/format';

const M = 'Montserrat, sans-serif';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface TaskNotificationCardProps {
  notification: TaskNotification;
}

interface StatusVisual {
  icon: typeof CheckCircle2;
  color: string;
  bg: string;
  border: string;
  label: string;
}

const statusVisual = (status: string): StatusVisual => {
  const s = status.toLowerCase();
  if (s === 'completed' || s === 'done' || s === 'success') {
    return {
      icon: CheckCircle2,
      color: 'var(--color-working)',
      bg: 'rgba(34, 197, 94, 0.06)',
      border: 'rgba(34, 197, 94, 0.18)',
      label: 'Completed',
    };
  }
  if (s === 'failed' || s === 'error') {
    return {
      icon: XCircle,
      color: 'var(--color-error)',
      bg: 'rgba(239, 68, 68, 0.06)',
      border: 'rgba(239, 68, 68, 0.20)',
      label: 'Failed',
    };
  }
  return {
    icon: Clock,
    color: 'var(--color-idle)',
    bg: 'rgba(234, 179, 8, 0.06)',
    border: 'rgba(234, 179, 8, 0.18)',
    label: status || 'In progress',
  };
};

export const TaskNotificationCard = ({ notification }: TaskNotificationCardProps) => {
  const { summary, result, status, usage, outputFile } = notification;
  const [expanded, setExpanded] = useState(false);
  const visual = statusVisual(status);
  const StatusIcon = visual.icon;
  const reduced = prefersReducedMotion();
  const hasResult = result.trim().length > 0;

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' as const }}
      className="w-full py-2.5 px-3.5 rounded-xl"
      style={{
        fontFamily: M,
        background: visual.bg,
        border: `1px solid ${visual.border}`,
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* Header */}
      <div className="flex items-start gap-2">
        <StatusIcon
          size={16}
          className="shrink-0 mt-0.5"
          style={{ color: visual.color }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: visual.color }}
            >
              Task · {visual.label}
            </span>
          </div>
          <div
            className="text-sm font-medium mt-0.5 leading-snug"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {summary || 'Task notification'}
          </div>
        </div>
      </div>

      {/* Collapsible result — only rendered when content exists. Leans on
          the existing markdown/code pipeline so code blocks + inline
          formatting match the rest of the chat. */}
      {hasResult && (
        <div className="mt-2">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs transition-colors"
            style={{
              fontFamily: M,
              color: 'var(--color-text-tertiary)',
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-accent-light)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-tertiary)'; }}
          >
            <ChevronRight
              size={12}
              className="transition-transform"
              style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
            />
            <span>{expanded ? 'Hide result' : 'Show result'}</span>
          </button>

          {expanded && (
            <motion.div
              initial={reduced ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              transition={{ duration: 0.18, ease: 'easeOut' as const }}
              className="mt-2 pt-2 text-sm leading-relaxed"
              style={{
                color: 'var(--color-text-secondary)',
                borderTop: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              {renderTextContent(result)}
            </motion.div>
          )}
        </div>
      )}

      {/* Footer — usage stats. Rendered only when at least one field is
          present so a minimal notification stays compact. */}
      {(usage || outputFile) && (
        <div
          className="flex items-center gap-3 flex-wrap mt-2 pt-2 text-[11px]"
          style={{
            color: 'var(--color-text-tertiary)',
            borderTop: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          {usage?.totalTokens !== undefined && (
            <span className="flex items-center gap-1">
              <Sparkles size={11} />
              {formatTokens(usage.totalTokens)} tokens
            </span>
          )}
          {usage?.toolUses !== undefined && (
            <span className="flex items-center gap-1">
              <Wrench size={11} />
              {usage.toolUses} tools
            </span>
          )}
          {usage?.durationMs !== undefined && (
            <span className="flex items-center gap-1">
              <Clock size={11} />
              {formatDuration(usage.durationMs)}
            </span>
          )}
          {outputFile && (
            <span
              className="flex items-center gap-1 truncate"
              title={outputFile}
              style={{ maxWidth: 280 }}
            >
              <FileText size={11} />
              {outputFile.split('/').pop()}
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
};
