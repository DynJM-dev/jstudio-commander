import type { ReactNode } from 'react';
import { CodeBlock } from '../components/chat/CodeBlock';

const M = 'Montserrat, sans-serif';

const CODE_FENCE_RE = /```(\w*)\n([\s\S]*?)```/g;
const NUMBERED_LIST_RE = /^(\d+)\.\s+/;

interface TextSegment {
  type: 'text' | 'code_block' | 'plan';
  content: string;
  language?: string;
  items?: string[];
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

  // Post-process text segments to extract numbered plans
  const result: TextSegment[] = [];
  for (const seg of segments) {
    if (seg.type !== 'text') {
      result.push(seg);
      continue;
    }

    // Split text segment into plan blocks and non-plan text
    const lines = seg.content.split('\n');
    let planItems: string[] = [];
    let textLines: string[] = [];

    const flushText = () => {
      if (textLines.length > 0) {
        const content = textLines.join('\n');
        if (content.trim()) result.push({ type: 'text', content });
        textLines = [];
      }
    };

    const flushPlan = () => {
      if (planItems.length > 0) {
        result.push({ type: 'plan', content: '', items: planItems });
        planItems = [];
      }
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (NUMBERED_LIST_RE.test(trimmed)) {
        // Check if this starts or continues a numbered list (3+ items = plan)
        flushText();
        planItems.push(trimmed.replace(NUMBERED_LIST_RE, '').trim());
      } else if (planItems.length > 0 && trimmed === '') {
        // Empty line after numbered items — could be end of plan
        continue;
      } else if (planItems.length > 0 && !NUMBERED_LIST_RE.test(trimmed)) {
        // Non-numbered line after items — flush plan if 3+ items, else dump as text
        if (planItems.length >= 3) {
          flushPlan();
        } else {
          // Not enough items — treat as regular text
          textLines.push(...planItems.map((item, i) => `${i + 1}. ${item}`));
          planItems = [];
        }
        textLines.push(line);
      } else {
        textLines.push(line);
      }
    }

    // Flush remaining
    if (planItems.length >= 3) {
      flushText();
      flushPlan();
    } else if (planItems.length > 0) {
      textLines.push(...planItems.map((item, i) => `${i + 1}. ${item}`));
      flushText();
    } else {
      flushText();
    }
  }

  return result;
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

const PlanCard = ({ items, keyPrefix }: { items: string[]; keyPrefix: string }) => (
  <div
    className="rounded-lg my-2 overflow-hidden"
    style={{
      fontFamily: M,
      background: 'rgba(14, 124, 123, 0.06)',
      border: '1px solid rgba(14, 124, 123, 0.15)',
    }}
  >
    <div
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
      style={{
        color: 'var(--color-accent-light)',
        borderBottom: '1px solid rgba(14, 124, 123, 0.1)',
      }}
    >
      Plan
    </div>
    <div className="px-3 py-2 space-y-1">
      {items.map((item, i) => (
        <div
          key={`${keyPrefix}-pi${i}`}
          className="flex items-start gap-2 text-sm"
          style={{ color: 'var(--color-text-primary)' }}
        >
          <span
            className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full"
            style={{ background: 'var(--color-accent)' }}
          />
          <span>{renderInlineFormatting(item, `${keyPrefix}-pi${i}`)}</span>
        </div>
      ))}
    </div>
  </div>
);

export const renderTextContent = (text: string): ReactNode[] => {
  const segments = splitSegments(text);
  const nodes: ReactNode[] = [];

  segments.forEach((seg, i) => {
    if (seg.type === 'code_block') {
      nodes.push(
        <CodeBlock key={`cb${i}`} code={seg.content} language={seg.language} />
      );
    } else if (seg.type === 'plan' && seg.items) {
      nodes.push(
        <PlanCard key={`pl${i}`} items={seg.items} keyPrefix={`pl${i}`} />
      );
    } else {
      nodes.push(
        <span key={`ts${i}`}>{renderTextSegment(seg.content, `s${i}`)}</span>
      );
    }
  });

  return nodes;
};
