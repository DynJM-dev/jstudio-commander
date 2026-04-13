import { useState, useEffect, useRef, useCallback } from 'react';
import { Clipboard, Check } from 'lucide-react';

const M = 'Montserrat, sans-serif';

interface CodeBlockProps {
  code: string;
  language?: string;
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
        langs: ['typescript', 'tsx', 'javascript', 'jsx', 'json', 'css', 'html', 'bash', 'sql', 'markdown', 'python', 'rust', 'go', 'yaml', 'toml', 'diff', 'text'],
      })
    );
  }
  return highlighterPromise;
};

export const CodeBlock = ({ code, language }: CodeBlockProps) => {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trimmedCode = code.replace(/\n$/, '');
  const lineCount = trimmedCode.split('\n').length;
  const lang = language || 'text';

  useEffect(() => {
    let cancelled = false;

    getHighlighter()
      .then((highlighter) => {
        if (cancelled) return;
        // Check if the lang is supported, fallback to text
        const supported = highlighter.codeToHtml;
        try {
          const result = supported(trimmedCode, { lang, theme: 'github-dark' });
          if (!cancelled) setHtml(result);
        } catch {
          // Unsupported language, try text
          try {
            const result = supported(trimmedCode, { lang: 'text', theme: 'github-dark' });
            if (!cancelled) setHtml(result);
          } catch {
            // Give up on highlighting
          }
        }
      })
      .catch(() => {
        // Shiki failed to load
      });

    return () => { cancelled = true; };
  }, [trimmedCode, lang]);

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

  return (
    <div
      className="rounded-lg overflow-hidden my-2"
      style={{ background: 'rgba(0, 0, 0, 0.3)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-1.5"
        style={{ background: 'rgba(0, 0, 0, 0.2)' }}
      >
        <span
          className="text-xs"
          style={{ color: 'var(--color-text-tertiary)', fontFamily: M }}
        >
          {lang}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs transition-colors rounded px-1.5 py-0.5"
          style={{
            color: copied ? 'var(--color-working)' : 'var(--color-text-tertiary)',
          }}
          onMouseEnter={(e) => {
            if (!copied) e.currentTarget.style.color = 'var(--color-text-secondary)';
          }}
          onMouseLeave={(e) => {
            if (!copied) e.currentTarget.style.color = 'var(--color-text-tertiary)';
          }}
        >
          {copied ? <Check size={12} /> : <Clipboard size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* Code area */}
      <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
        {html ? (
          <div
            className="p-4 text-sm [&_pre]:!bg-transparent [&_pre]:!m-0 [&_pre]:!p-0 [&_code]:!bg-transparent"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre className="p-4 text-sm overflow-x-auto" style={{ color: 'var(--color-text-secondary)' }}>
            <code className="font-mono-stats">
              {lineCount > 5
                ? trimmedCode.split('\n').map((line, i) => (
                    <div key={i} className="flex">
                      <span
                        className="select-none pr-4 text-right inline-block"
                        style={{
                          width: `${String(lineCount).length + 1}ch`,
                          color: 'rgba(255, 255, 255, 0.2)',
                        }}
                      >
                        {i + 1}
                      </span>
                      <span>{line}</span>
                    </div>
                  ))
                : trimmedCode}
            </code>
          </pre>
        )}
      </div>
    </div>
  );
};
