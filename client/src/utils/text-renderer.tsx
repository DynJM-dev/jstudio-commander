import type { ReactNode } from 'react';
import { CodeBlock } from '../components/chat/CodeBlock';

const CODE_FENCE_RE = /```(\w*)\n([\s\S]*?)```/g;
const INLINE_CODE_RE = /`([^`\n]+)`/g;
const BOLD_RE = /\*\*(.+?)\*\*/g;

interface TextSegment {
  type: 'text' | 'code_block';
  content: string;
  language?: string;
}

const splitCodeBlocks = (text: string): TextSegment[] => {
  const segments: TextSegment[] = [];
  let lastIndex = 0;

  CODE_FENCE_RE.lastIndex = 0;
  let match = CODE_FENCE_RE.exec(text);

  while (match) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    segments.push({
      type: 'code_block',
      language: match[1] || undefined,
      content: match[2] ?? '',
    });
    lastIndex = match.index + match[0].length;
    match = CODE_FENCE_RE.exec(text);
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return segments;
};

const renderInlineFormatting = (text: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  // Combined pass: split on bold and inline code patterns
  const COMBINED_RE = /(\*\*(.+?)\*\*)|(`([^`\n]+)`)/g;
  let lastIdx = 0;
  let idx = 0;

  COMBINED_RE.lastIndex = 0;
  let m = COMBINED_RE.exec(text);

  while (m) {
    if (m.index > lastIdx) {
      nodes.push(<span key={`t${idx++}`}>{text.slice(lastIdx, m.index)}</span>);
    }
    if (m[2]) {
      // Bold
      nodes.push(<strong key={`b${idx++}`}>{m[2]}</strong>);
    } else if (m[4]) {
      // Inline code
      nodes.push(
        <code
          key={`c${idx++}`}
          className="font-mono-stats text-[0.9em] px-1 py-0.5 rounded"
          style={{ background: 'rgba(255, 255, 255, 0.06)' }}
        >
          {m[4]}
        </code>
      );
    }
    lastIdx = m.index + m[0].length;
    m = COMBINED_RE.exec(text);
  }

  if (lastIdx < text.length) {
    nodes.push(<span key={`t${idx}`}>{text.slice(lastIdx)}</span>);
  }

  return nodes.length > 0 ? nodes : [<span key="raw">{text}</span>];
};

const renderTextSegment = (text: string, keyPrefix: string): ReactNode[] => {
  const lines = text.split('\n');
  const nodes: ReactNode[] = [];

  lines.forEach((line, i) => {
    if (i > 0) nodes.push(<br key={`${keyPrefix}-br${i}`} />);
    const inline = renderInlineFormatting(line);
    nodes.push(...inline.map((n, j) => {
      if (typeof n === 'string') return <span key={`${keyPrefix}-${i}-${j}`}>{n}</span>;
      return n;
    }));
  });

  return nodes;
};

export const renderTextContent = (text: string): ReactNode[] => {
  const segments = splitCodeBlocks(text);
  const nodes: ReactNode[] = [];

  segments.forEach((seg, i) => {
    if (seg.type === 'code_block') {
      nodes.push(
        <CodeBlock key={`cb${i}`} code={seg.content} language={seg.language} />
      );
    } else {
      nodes.push(
        <span key={`ts${i}`}>{renderTextSegment(seg.content, `s${i}`)}</span>
      );
    }
  });

  return nodes;
};
