import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidElement, type ReactNode, type ReactElement } from 'react';
import type { ChatMessage } from '@commander/shared';
import { renderTextContent } from '../text-renderer.js';
import { getActivePlan } from '../plans.js';

// Walk the rendered tree and collect every element whose type is a function
// or named component (i.e., not an intrinsic string tag like 'span'/'br').
// After Candidate 22, plain-text assistant input must never produce any
// component element — AgentPlan included. The only component text-renderer
// emits post-fix is CodeBlock, which is gated behind fenced code blocks.
const collectComponentElements = (nodes: ReactNode): ReactElement[] => {
  const found: ReactElement[] = [];
  const walk = (n: ReactNode) => {
    if (n == null || typeof n === 'boolean') return;
    if (Array.isArray(n)) {
      for (const child of n) walk(child);
      return;
    }
    if (isValidElement(n)) {
      const el = n as ReactElement<{ children?: ReactNode }>;
      if (typeof el.type !== 'string') found.push(el);
      if (el.props && el.props.children !== undefined) walk(el.props.children);
    }
  };
  walk(nodes);
  return found;
};

const componentNames = (els: ReactElement[]): string[] =>
  els.map((el) => {
    const t = el.type as { displayName?: string; name?: string } | string;
    if (typeof t === 'string') return t;
    return t.displayName ?? t.name ?? 'anonymous';
  });

describe('Candidate 22 — markdown-shape Plan detection removed', () => {
  test('case 1: 5 numbered list lines in assistant text → no AgentPlan in rendered tree', () => {
    const text = [
      '1. foo',
      '2. bar',
      '3. baz',
      '4. quux',
      '5. corge',
    ].join('\n');

    const nodes = renderTextContent(text);
    const names = componentNames(collectComponentElements(nodes));

    assert.ok(
      !names.includes('AgentPlan'),
      `expected no AgentPlan component in rendered tree, found: ${names.join(', ')}`
    );
  });

  test('case 2: 1–2 numbered items → no AgentPlan in rendered tree', () => {
    const oneItem = renderTextContent('1. only one');
    const twoItems = renderTextContent('1. first\n2. second');

    for (const [label, nodes] of [['one', oneItem], ['two', twoItems]] as const) {
      const names = componentNames(collectComponentElements(nodes));
      assert.ok(
        !names.includes('AgentPlan'),
        `${label}: expected no AgentPlan component, found: ${names.join(', ')}`
      );
    }
  });

  test('case 3: real TaskCreate tool_use → getActivePlan returns a plan (structured path intact)', () => {
    const now = Date.parse('2026-04-20T12:00:00Z');
    const messages: ChatMessage[] = [
      {
        id: 'u1',
        parentId: null,
        isSidechain: false,
        role: 'user',
        timestamp: '2026-04-20T11:59:00Z',
        content: [{ type: 'text', text: 'start phase' }],
      },
      {
        id: 'a1',
        parentId: 'u1',
        isSidechain: false,
        role: 'assistant',
        timestamp: '2026-04-20T11:59:30Z',
        model: 'claude-opus-4-7',
        content: [
          {
            type: 'tool_use',
            id: 'tu-1',
            name: 'TaskCreate',
            input: { subject: 'Implement fix', description: 'Remove markdown-shape plan' },
          },
        ],
      },
      {
        id: 'u2',
        parentId: 'a1',
        isSidechain: false,
        role: 'user',
        timestamp: '2026-04-20T11:59:31Z',
        content: [
          {
            type: 'tool_result',
            toolUseId: 'tu-1',
            content: 'Task #42 created successfully: Implement fix',
          },
        ],
      },
    ];

    const active = getActivePlan(messages, now);
    assert.ok(active, 'expected an active plan from TaskCreate tool_use');
    assert.equal(active!.plan.length, 1, 'expected exactly one task');
    assert.equal(active!.plan[0]!.id, '42');
    assert.equal(active!.plan[0]!.title, 'Implement fix');
    assert.equal(active!.key, 'a1');
  });
});
