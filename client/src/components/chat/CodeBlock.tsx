import { useState, useEffect, useRef, useCallback } from 'react';
import { Clipboard, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { motion } from 'framer-motion';

const M = 'Montserrat, sans-serif';
const COLLAPSE_THRESHOLD = 20;

interface CodeBlockProps {
  code: string;
  language?: string;
  filePath?: string;
}

// Lazy shiki singleton
let highlighterPromise: Promise<{
  codeToHtml: (code: string, opts: { lang: string; theme: string }) => string;
}> | null = null;

const getHighlighter = () => {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then((mod) =>
      mod.createHighlighter({
        themes: ['github-dark'],
        langs: [
          'typescript', 'tsx', 'javascript', 'jsx', 'json', 'css', 'html',
          'bash', 'sql', 'markdown', 'python', 'rust', 'go', 'yaml', 'toml',
          'diff', 'text',
        ],
      })
    );
  }
  return highlighterPromise;
};

// Check prefers-reduced-motion
const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const CodeBlock = ({ code, language, filePath }: CodeBlockProps) => {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trimmedCode = code.replace(/\n$/, '');
  const lines = trimmedCode.split('\n');
  const lineCount = lines.length;
  const lang = language || 'text';
  const isCollapsible = lineCount > COLLAPSE_THRESHOLD;
  const showCode = isCollapsible && collapsed
    ? lines.slice(0, COLLAPSE_THRESHOLD).join('\n')
    : trimmedCode;

  useEffect(() => {
    let cancelled = false;

    getHighlighter()
      .then((highlighter) => {
        if (cancelled) return;
        try {
          const result = highlighter.codeToHtml(showCode, { lang, theme: 'github-dark' });
          if (!cancelled) setHtml(result);
        } catch {
          try {
            const result = highlighter.codeToHtml(showCode, { lang: 'text', theme: 'github-dark' });
            if (!cancelled) setHtml(result);
          } catch {
            // Give up on highlighting
          }
        }
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [showCode, lang]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(trimmedCode).then(() => {
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    });
  }, [trimmedCode]);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const reduced = prefersReducedMotion();

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.15, ease: 'easeOut' as const }}
      className="rounded-xl overflow-hidden my-2"
      style={{
        background: 'rgba(10, 14, 20, 0.8)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
      }}
    >
      {/* Header: language badge left, copy button right */}
      <div
        className="flex items-center justify-between px-3 py-1.5"
        style={{ background: 'rgba(0, 0, 0, 0.2)' }}
      >
        {/* Language badge */}
        <span
          className="text-xs px-2 py-0.5 rounded-full"
          style={{
            background: 'rgba(255, 255, 255, 0.06)',
            color: 'var(--color-text-tertiary)',
            fontFamily: M,
          }}
        >
          {filePath ? filePath.replace(/^\/Users\/[^/]+/, '~') : lang}
        </span>

        {/* Copy button */}
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs transition-colors rounded px-1.5 py-0.5"
          style={{
            color: copied ? 'var(--color-working)' : 'var(--color-text-tertiary)',
            fontFamily: M,
          }}
          onMouseEnter={(e) => {
            if (!copied) e.currentTarget.style.color = 'var(--color-text-secondary)';
          }}
          onMouseLeave={(e) => {
            if (!copied) e.currentTarget.style.color = 'var(--color-text-tertiary)';
          }}
        >
          {copied ? <Check size={12} /> : <Clipboard size={12} />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {/* Code area */}
      <div className="overflow-x-auto">
        {html ? (
          <div
            className="p-4 text-sm [&_pre]:!bg-transparent [&_pre]:!m-0 [&_pre]:!p-0 [&_code]:!bg-transparent"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre
            className="p-4 text-sm overflow-x-auto"
            style={{ color: 'var(--color-text-secondary)', margin: 0 }}
          >
            <code className="font-mono-stats">{showCode}</code>
          </pre>
        )}
      </div>

      {/* Collapse toggle */}
      {isCollapsible && (
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center gap-1.5 w-full py-1.5 text-xs transition-colors"
          style={{
            color: 'var(--color-accent-light)',
            background: 'rgba(0, 0, 0, 0.15)',
            borderTop: '1px solid rgba(255, 255, 255, 0.04)',
            fontFamily: M,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0, 0, 0, 0.25)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0, 0, 0, 0.15)'; }}
        >
          {collapsed ? (
            <>
              <ChevronDown size={12} />
              Show {lineCount - COLLAPSE_THRESHOLD} more lines
            </>
          ) : (
            <>
              <ChevronUp size={12} />
              Show less
            </>
          )}
        </button>
      )}
    </motion.div>
  );
};
