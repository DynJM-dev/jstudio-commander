import { useState } from 'react';
import {
  FileText,
  FilePlus,
  Pencil,
  Terminal,
  Search,
  Users,
  ListChecks,
  MessageSquare,
  Wrench,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

const M = 'Montserrat, sans-serif';

const TOOL_ICONS: Record<string, LucideIcon> = {
  Read: FileText,
  Write: FilePlus,
  Edit: Pencil,
  Bash: Terminal,
  Grep: Search,
  Glob: Search,
  Agent: Users,
  TaskCreate: ListChecks,
  TaskUpdate: ListChecks,
  TaskList: ListChecks,
  SendMessage: MessageSquare,
};

interface ToolCallBlockProps {
  name: string;
  input: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  duration?: number;
}

const truncate = (s: string, max: number): { text: string; truncated: boolean } => {
  if (s.length <= max) return { text: s, truncated: false };
  return { text: s.slice(0, max), truncated: true };
};

const getToolPath = (name: string, input: Record<string, unknown>): string => {
  const filePath = input.file_path ?? input.path ?? input.command;
  if (typeof filePath === 'string') {
    const short = filePath.replace(/^\/Users\/[^/]+/, '~');
    return short.length > 60 ? short.slice(0, 57) + '...' : short;
  }
  if (name === 'Grep' && typeof input.pattern === 'string') {
    const pat = input.pattern;
    return `"${pat.length > 50 ? pat.slice(0, 47) + '...' : pat}"`;
  }
  return '';
};

// Issue 7 — Bash output: line-based truncation (spec: 40 lines), not
// char-count. Errors take red chrome + warning border; success uses the
// existing green monospace look.
const BASH_PREVIEW_LINES = 40;
const RenderBashContent = ({ input, result, isError }: { input: Record<string, unknown>; result?: string; isError?: boolean }) => {
  const command = typeof input.command === 'string' ? input.command : '';
  const [showFull, setShowFull] = useState(false);
  const resultText = result ?? '';
  const lines = resultText.split('\n');
  const overflowing = lines.length > BASH_PREVIEW_LINES;
  const preview = overflowing ? lines.slice(0, BASH_PREVIEW_LINES).join('\n') : resultText;

  return (
    <div className="space-y-2">
      <div
        className="rounded px-3 py-2 font-mono-stats text-sm"
        style={{ background: 'rgba(0, 0, 0, 0.3)', color: 'var(--color-accent-light)' }}
      >
        <span style={{ color: 'var(--color-text-tertiary)' }}>$ </span>
        {command}
      </div>
      {resultText && (
        <div
          className="rounded px-3 py-2 font-mono-stats text-xs max-h-[400px] overflow-y-auto whitespace-pre-wrap break-all"
          style={{
            background: isError ? 'rgba(239, 68, 68, 0.08)' : 'rgba(0, 0, 0, 0.2)',
            border: isError ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid transparent',
            color: isError ? 'var(--color-error)' : 'rgba(34, 197, 94, 0.8)',
          }}
        >
          {showFull ? resultText : preview}
          {overflowing && !showFull && (
            <button
              onClick={() => setShowFull(true)}
              className="block mt-1 text-xs"
              style={{ color: 'var(--color-accent-light)', fontFamily: M }}
            >
              Show more ({lines.length - BASH_PREVIEW_LINES} more lines)...
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const RenderEditContent = ({ input, result }: { input: Record<string, unknown>; result?: string }) => {
  const filePath = typeof input.file_path === 'string'
    ? input.file_path.replace(/^\/Users\/[^/]+/, '~')
    : 'unknown file';
  const oldStr = typeof input.old_string === 'string' ? input.old_string : '';
  const newStr = typeof input.new_string === 'string' ? input.new_string : '';

  return (
    <div className="space-y-2">
      <div className="font-mono-stats text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        {filePath}
      </div>
      {(oldStr || newStr) && (
        <div
          className="rounded px-3 py-2 font-mono-stats text-xs max-h-[200px] overflow-y-auto whitespace-pre-wrap"
          style={{ background: 'rgba(0, 0, 0, 0.25)' }}
        >
          {oldStr && oldStr.split('\n').map((line, i) => (
            <div
              key={`old${i}`}
              className="px-1"
              style={{ color: 'rgba(239, 68, 68, 0.8)', background: 'rgba(239, 68, 68, 0.15)' }}
            >
              - {line}
            </div>
          ))}
          {newStr && newStr.split('\n').map((line, i) => (
            <div
              key={`new${i}`}
              className="px-1"
              style={{ color: 'rgba(34, 197, 94, 0.8)', background: 'rgba(34, 197, 94, 0.15)' }}
            >
              + {line}
            </div>
          ))}
        </div>
      )}
      {result && (
        <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          {result.slice(0, 100)}
        </div>
      )}
    </div>
  );
};

// Issue 7 — generic content: 40-line limit (matches Bash). 3000-char
// cap as a secondary guard so a single catastrophic line doesn't
// freeze render.
const GENERIC_PREVIEW_LINES = 40;
const GENERIC_PREVIEW_CHARS = 3000;
const RenderGenericContent = ({ input, result, isError }: { input: Record<string, unknown>; result?: string; isError?: boolean }) => {
  const [showFullResult, setShowFullResult] = useState(false);
  const entries = Object.entries(input).filter(([, v]) => v !== undefined && v !== null);
  const resultText = result ?? '';
  const resultLines = resultText.split('\n');
  const overflowByLines = resultLines.length > GENERIC_PREVIEW_LINES;
  const overflowByChars = resultText.length > GENERIC_PREVIEW_CHARS;
  const showPreview = (overflowByLines || overflowByChars) && !showFullResult;

  return (
    <div className="space-y-2">
      {entries.length > 0 && (
        <div
          className="rounded px-3 py-2 font-mono-stats text-xs space-y-0.5"
          style={{ background: 'rgba(0, 0, 0, 0.2)' }}
        >
          {entries.map(([key, val]) => {
            const valStr = typeof val === 'string' ? val : JSON.stringify(val);
            const { text, truncated: isTrunc } = truncate(valStr, 200);
            return (
              <div key={key} style={{ color: 'var(--color-text-secondary)' }}>
                <span style={{ color: 'var(--color-text-tertiary)' }}>{key}:</span>{' '}
                {text}{isTrunc && '...'}
              </div>
            );
          })}
        </div>
      )}
      {resultText && (
        <div
          className="rounded px-3 py-2 font-mono-stats text-xs max-h-[400px] overflow-y-auto whitespace-pre-wrap break-words"
          style={{
            background: isError ? 'rgba(239, 68, 68, 0.08)' : 'rgba(0, 0, 0, 0.2)',
            border: isError ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid transparent',
            color: isError ? 'var(--color-error)' : 'var(--color-text-secondary)',
          }}
        >
          {showPreview
            ? (overflowByChars
                ? resultText.slice(0, GENERIC_PREVIEW_CHARS)
                : resultLines.slice(0, GENERIC_PREVIEW_LINES).join('\n'))
            : resultText}
          {showPreview && (
            <button
              onClick={() => setShowFullResult(true)}
              className="block mt-1 text-xs"
              style={{ color: 'var(--color-accent-light)', fontFamily: M }}
            >
              Show more ({overflowByLines
                ? `${resultLines.length - GENERIC_PREVIEW_LINES} more lines`
                : `${resultText.length - GENERIC_PREVIEW_CHARS} more chars`})...
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export const ToolCallBlock = ({ name, input, result, isError, duration }: ToolCallBlockProps) => {
  // Issue 7 — auto-expand errors so the user never has to click
  // through to see a failure. Success cases still start collapsed for
  // tidy chat density.
  const [expanded, setExpanded] = useState<boolean>(isError === true);
  const ToolIcon = TOOL_ICONS[name] ?? Wrench;
  const path = getToolPath(name, input);
  const hasResult = result !== undefined;

  const StatusIcon = isError
    ? XCircle
    : hasResult
      ? CheckCircle2
      : Loader2;

  const statusColor = isError
    ? 'var(--color-error)'
    : hasResult
      ? 'var(--color-working)'
      : 'var(--color-accent)';

  const renderContent = () => {
    switch (name) {
      case 'Bash':
        return <RenderBashContent input={input} result={result} isError={isError} />;
      case 'Edit':
        return <RenderEditContent input={input} result={result} />;
      default:
        return <RenderGenericContent input={input} result={result} isError={isError} />;
    }
  };

  return (
    <div
      className="my-0.5"
      style={{
        borderLeft: '2px solid rgba(245, 158, 11, 0.3)',
        paddingLeft: 8,
      }}
    >
      {/* Collapsed single-line header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 py-1 px-1 w-full text-left cursor-pointer transition-colors rounded"
        style={{ fontFamily: M }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        {/* Status icon */}
        <StatusIcon
          size={14}
          style={{ color: statusColor }}
          className={`shrink-0 ${!hasResult && !isError ? 'animate-spin' : ''}`}
        />

        {/* Tool icon */}
        <ToolIcon
          size={14}
          className="shrink-0"
          style={{ color: 'var(--color-text-tertiary)' }}
        />

        {/* Tool name */}
        <span
          className="text-xs font-medium"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {name}
        </span>

        {/* Path/command */}
        {path && (
          <span
            className="font-mono-stats text-xs truncate"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            {path}
          </span>
        )}

        <span className="flex-1" />

        {/* Duration */}
        {duration !== undefined && duration > 0 && (
          <span
            className="font-mono-stats text-xs shrink-0"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            {(duration / 1000).toFixed(1)}s
          </span>
        )}
      </button>

      {/* Expanded content */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' as const }}
            className="overflow-hidden"
          >
            <div
              className="mt-1 mb-2 rounded-lg p-3"
              style={{ background: 'rgba(0, 0, 0, 0.15)' }}
            >
              {renderContent()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
