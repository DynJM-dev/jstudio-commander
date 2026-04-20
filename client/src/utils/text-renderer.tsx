import type { ReactNode } from 'react';
import { CodeBlock } from '../components/chat/CodeBlock';

const CODE_FENCE_RE = /```(\w*)\n([\s\S]*?)```/g;

interface TextSegment {
  type: 'text' | 'code_block';
  content: string;
  language?: string;
}

const splitSegments = (text: string): TextSegment[] => {
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

const renderInlineFormatting = (text: string, keyPrefix: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  const COMBINED_RE = /(\*\*(.+?)\*\*)|(`([^`\n]+)`)/g;
  let lastIdx = 0;
  let idx = 0;

  COMBINED_RE.lastIndex = 0;
  let m = COMBINED_RE.exec(text);

  while (m) {
    if (m.index > lastIdx) {
      nodes.push(<span key={`${keyPrefix}-t${idx++}`}>{text.slice(lastIdx, m.index)}</span>);
    }
    if (m[2]) {
      nodes.push(<strong key={`${keyPrefix}-b${idx++}`}>{m[2]}</strong>);
    } else if (m[4]) {
      nodes.push(
        <code
          key={`${keyPrefix}-c${idx++}`}
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
    nodes.push(<span key={`${keyPrefix}-t${idx}`}>{text.slice(lastIdx)}</span>);
  }

  return nodes;
};

const renderTextSegment = (text: string, keyPrefix: string): ReactNode[] => {
  const lines = text.split('\n');
  const nodes: ReactNode[] = [];

  lines.forEach((line, i) => {
    if (i > 0) nodes.push(<br key={`${keyPrefix}-br${i}`} />);
    const inline = renderInlineFormatting(line, `${keyPrefix}-${i}`);
    nodes.push(...inline);
  });

  return nodes;
};

export const renderTextContent = (text: string): ReactNode[] => {
  const segments = splitSegments(text);
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
