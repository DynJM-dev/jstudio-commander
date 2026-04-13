import { useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  FileText,
  FilePlus,
  Pencil,
  Terminal,
  Search,
  Users,
  ListChecks,
  MessageSquare,
  Wrench,
} from 'lucide-react';
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
}

const truncate = (s: string, max: number): { text: string; truncated: boolean } => {
  if (s.length <= max) return { text: s, truncated: false };
  return { text: s.slice(0, max), truncated: true };
};

const getToolLabel = (name: string, input: Record<string, unknown>): string => {
  const filePath = input.file_path ?? input.path ?? input.command;
  if (typeof filePath === 'string') {
    // Show short path
    const short = filePath.replace(/^\/Users\/[^/]+/, '~');
    return `${name} ${short}`;
  }
  if (name === 'Grep' && typeof input.pattern === 'string') {
    return `${name} "${input.pattern}"`;
  }
  return name;
};

const RenderBashTool = ({ input, result, isError }: { input: Record<string, unknown>; result?: string; isError?: boolean }) => {
  const command = typeof input.command === 'string' ? input.command : '';
  const [showFull, setShowFull] = useState(false);
  const resultText = result ?? '';
  const { text: preview, truncated } = truncate(resultText, 1000);

  return (
    <div className="space-y-2">
      {/* Command */}
      <div
        className="rounded px-3 py-2 font-mono-stats text-sm"
        style={{ background: 'rgba(0, 0, 0, 0.25)', color: 'var(--color-accent-light)' }}
      >
        <span style={{ color: 'var(--color-text-tertiary)' }}>$ </span>
        {command}
      </div>
      {/* Output */}
      {resultText && (
        <div
          className="rounded px-3 py-2 font-mono-stats text-xs max-h-[300px] overflow-y-auto whitespace-pre-wrap break-all"
          style={{
            background: 'rgba(0, 0, 0, 0.15)',
            color: isError ? 'var(--color-error)' : 'rgba(34, 197, 94, 0.8)',
          }}
        >
          {showFull ? resultText : preview}
          {truncated && !showFull && (
            <button
              onClick={() => setShowFull(true)}
              className="block mt-1 text-xs"
              style={{ color: 'var(--color-accent-light)', fontFamily: M }}
            >
              Show more...
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const RenderEditTool = ({ input, result }: { input: Record<string, unknown>; result?: string }) => {
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
          style={{ background: 'rgba(0, 0, 0, 0.2)' }}
        >
          {oldStr && oldStr.split('\n').map((line, i) => (
            <div key={`old${i}`} style={{ color: 'rgba(239, 68, 68, 0.8)' }}>- {line}</div>
          ))}
          {newStr && newStr.split('\n').map((line, i) => (
            <div key={`new${i}`} style={{ color: 'rgba(34, 197, 94, 0.8)' }}>+ {line}</div>
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

const RenderWriteTool = ({ input, result }: { input: Record<string, unknown>; result?: string }) => {
  const filePath = typeof input.file_path === 'string'
    ? input.file_path.replace(/^\/Users\/[^/]+/, '~')
    : 'unknown file';

  return (
    <div className="space-y-1">
      <div className="font-mono-stats text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        {filePath}
      </div>
      <div className="text-xs" style={{ color: 'var(--color-working)' }}>
        {result ? result.slice(0, 100) : 'File created'}
      </div>
    </div>
  );
};

const RenderGenericTool = ({ input, result }: { input: Record<string, unknown>; result?: string }) => {
  const [showFullResult, setShowFullResult] = useState(false);
  const entries = Object.entries(input).filter(([, v]) => v !== undefined && v !== null);
  const resultText = result ?? '';
  const resultLines = resultText.split('\n');
  const showPreview = resultLines.length > 10 && !showFullResult;

  return (
    <div className="space-y-2">
      {entries.length > 0 && (
        <div>
          <div className="text-xs font-medium mb-1" style={{ color: 'var(--color-text-tertiary)', fontFamily: M }}>
            Input:
          </div>
          <div
            className="rounded px-3 py-2 font-mono-stats text-xs space-y-0.5"
            style={{ background: 'rgba(0, 0, 0, 0.15)' }}
          >
            {entries.map(([key, val]) => {
              const valStr = typeof val === 'string' ? val : JSON.stringify(val);
              const { text, truncated } = truncate(valStr, 200);
              return (
                <div key={key} style={{ color: 'var(--color-text-secondary)' }}>
                  <span style={{ color: 'var(--color-text-tertiary)' }}>{key}:</span>{' '}
                  {text}{truncated && '...'}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {resultText && (
        <div>
          <div className="text-xs font-medium mb-1" style={{ color: 'var(--color-text-tertiary)', fontFamily: M }}>
            Result:
          </div>
          <div
            className="rounded px-3 py-2 font-mono-stats text-xs max-h-[300px] overflow-y-auto whitespace-pre-wrap break-words"
            style={{ background: 'rgba(0, 0, 0, 0.15)', color: 'var(--color-text-secondary)' }}
          >
            {showPreview ? resultLines.slice(0, 10).join('\n') : resultText}
            {showPreview && (
              <button
                onClick={() => setShowFullResult(true)}
                className="block mt-1 text-xs"
                style={{ color: 'var(--color-accent-light)', fontFamily: M }}
              >
                Show more ({resultLines.length - 10} more lines)...
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const ToolCallBlock = ({ name, input, result, isError }: ToolCallBlockProps) => {
  const [expanded, setExpanded] = useState(false);
  const Icon = TOOL_ICONS[name] ?? Wrench;
  const label = getToolLabel(name, input);

  const renderContent = () => {
    switch (name) {
      case 'Bash':
        return <RenderBashTool input={input} result={result} isError={isError} />;
      case 'Edit':
        return <RenderEditTool input={input} result={result} />;
      case 'Write':
        return <RenderWriteTool input={input} result={result} />;
      default:
        return <RenderGenericTool input={input} result={result} />;
    }
  };

  return (
    <div className="my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 py-1.5 text-sm cursor-pointer transition-colors w-full text-left"
        style={{ color: 'var(--color-text-secondary)', fontFamily: M }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-primary)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Icon size={14} />
        <span className="truncate">{label}</span>
        {isError && (
          <span className="text-xs px-1.5 py-0.5 rounded" style={{ color: 'var(--color-error)', background: 'rgba(239, 68, 68, 0.1)' }}>
            error
          </span>
        )}
      </button>

      {expanded && (
        <div
          className="rounded-lg p-3 mt-1 ml-5"
          style={{ background: 'rgba(0, 0, 0, 0.2)' }}
        >
          {renderContent()}
        </div>
      )}
    </div>
  );
};
