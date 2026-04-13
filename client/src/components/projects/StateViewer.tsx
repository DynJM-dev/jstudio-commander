import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const M = 'Montserrat, sans-serif';

interface StateViewerProps {
  content: string;
}

export const StateViewer = ({ content }: StateViewerProps) => {
  if (!content) {
    return (
      <p
        className="text-sm italic"
        style={{ fontFamily: M, color: 'var(--color-text-tertiary)' }}
      >
        No STATE.md found in this project.
      </p>
    );
  }

  return (
    <div className="prose-dark" style={{ fontFamily: M }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1
              className="text-xl font-semibold mb-3 mt-4"
              style={{ color: 'var(--color-text-primary)', fontFamily: M }}
            >
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2
              className="text-lg font-semibold mb-2 mt-4"
              style={{ color: 'var(--color-text-primary)', fontFamily: M }}
            >
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3
              className="text-base font-semibold mb-2 mt-3"
              style={{ color: 'var(--color-text-primary)', fontFamily: M }}
            >
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p
              className="text-sm mb-2 leading-relaxed"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {children}
            </p>
          ),
          ul: ({ children }) => (
            <ul className="text-sm mb-2 ml-4 list-disc" style={{ color: 'var(--color-text-secondary)' }}>
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="text-sm mb-2 ml-4 list-decimal" style={{ color: 'var(--color-text-secondary)' }}>
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="mb-0.5">{children}</li>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto mb-3">
              <table
                className="w-full text-sm"
                style={{ borderCollapse: 'collapse' }}
              >
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead style={{ borderBottom: '2px solid rgba(255, 255, 255, 0.1)' }}>
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th
              className="text-left px-3 py-2 text-xs font-semibold"
              style={{
                fontFamily: M,
                color: 'var(--color-text-secondary)',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td
              className="px-3 py-2 text-sm"
              style={{
                color: 'var(--color-text-secondary)',
                borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
              }}
            >
              {children}
            </td>
          ),
          tr: ({ children }) => (
            <tr
              style={{ background: 'transparent' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              {children}
            </tr>
          ),
          code: ({ className, children }) => {
            const isInline = !className;
            if (isInline) {
              return (
                <code
                  className="font-mono-stats text-[0.9em] px-1 py-0.5 rounded"
                  style={{ background: 'rgba(255, 255, 255, 0.06)', color: 'var(--color-accent-light)' }}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                className="font-mono-stats text-sm block p-3 rounded-lg overflow-x-auto"
                style={{ background: 'rgba(0, 0, 0, 0.3)', color: 'var(--color-text-secondary)' }}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="mb-3">{children}</pre>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              className="underline"
              style={{ color: 'var(--color-accent-light)' }}
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
          strong: ({ children }) => (
            <strong style={{ color: 'var(--color-text-primary)' }}>{children}</strong>
          ),
          input: ({ checked, ...props }) => (
            <input
              {...props}
              checked={checked}
              readOnly
              className="mr-1.5"
              style={{
                accentColor: 'var(--color-accent)',
              }}
            />
          ),
          hr: () => (
            <hr className="my-4" style={{ border: 'none', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
