import type { ReactNode } from 'react';
import { CodeBlock } from '../components/chat/CodeBlock';
import { AgentPlan } from '../components/chat/AgentPlan';
import type { PlanTask } from '../components/chat/AgentPlan';

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

const parsePlanStatus = (raw: string): { text: string; done: boolean } => {
  const trimmed = raw.trim();
  if (/^[✅✓]/.test(trimmed)) return { text: trimmed.replace(/^[✅✓]\s*/, ''), done: true };
  if (/~~.+~~/.test(trimmed)) return { text: trimmed.replace(/~~/g, ''), done: true };
  if (/\s*[✓✅]\s*$/.test(trimmed) || /\s*[—-]\s*(done|complete|completed)\s*$/i.test(trimmed) || /\s*\((done|complete|completed)\)\s*$/i.test(trimmed)) {
    const cleaned = trimmed.replace(/\s*[✓✅]\s*$/, '').replace(/\s*[—-]\s*(done|complete|completed)\s*$/i, '').replace(/\s*\((done|complete|completed)\)\s*$/i, '');
    return { text: cleaned, done: true };
  }
  return { text: trimmed, done: false };
};

const itemsToTasks = (items: string[]): PlanTask[] =>
  items.map((raw, i) => {
    const parsed = parsePlanStatus(raw);
    return {
      id: `plan-${i}`,
      title: parsed.text,
      status: parsed.done ? 'completed' as const : 'pending' as const,
    };
  });

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
        <AgentPlan key={`pl${i}`} tasks={itemsToTasks(seg.items)} />
      );
    } else {
      nodes.push(
        <span key={`ts${i}`}>{renderTextSegment(seg.content, `s${i}`)}</span>
      );
    }
  });

  return nodes;
};
