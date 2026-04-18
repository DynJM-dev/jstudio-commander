import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FOCUSABLE_SELECTOR } from '../../hooks/useModalA11y';

// Phase P.2 — a11y + mobile + touch-target hardening.
//
// Each of the five patches lands as a small, pattern-level change
// across several components. Static source-level assertions are the
// right coverage level here — the client test runner is
// `node --test` (no DOM), and integration coverage would require
// standing up a React Testing Library harness that isn't yet in
// package.json.
//
// These tests guard the contract so a future refactor that removes
// an aria attribute or downgrades a touch target to < 44px loudly
// regresses instead of silently slipping in.

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..'); // client/

const read = (rel: string): string => readFileSync(join(root, rel), 'utf-8');

describe('P.2 C1 — global :focus-visible ring', () => {
  const css = read('src/index.css');

  test('index.css defines a global :focus-visible rule bound to --color-accent', () => {
    assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--color-accent\)/);
  });

  test('every interactive element class has a matching focus-visible override', () => {
    for (const selector of ['button:focus-visible', 'input:focus-visible', 'a:focus-visible']) {
      assert.ok(css.includes(selector), `expected "${selector}" rule in index.css`);
    }
  });

  test('outline-none Tailwind utility is re-enabled on :focus-visible', () => {
    assert.match(css, /\.outline-none:focus-visible\s*\{[^}]*outline-style:\s*solid/);
  });
});

describe('P.2 C2 — modal aria + focus trap', () => {
  test('useModalA11y FOCUSABLE_SELECTOR covers every natively tabbable element class', () => {
    for (const snippet of [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled]):not([type="hidden"])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ]) {
      assert.ok(FOCUSABLE_SELECTOR.includes(snippet), `selector missing: ${snippet}`);
    }
  });

  test('CreateSessionModal has role=dialog + aria-modal + aria-labelledby bound to its title', () => {
    const src = read('src/components/sessions/CreateSessionModal.tsx');
    assert.match(src, /role="dialog"/);
    assert.match(src, /aria-modal="true"/);
    assert.match(src, /aria-labelledby="create-session-title"/);
    assert.match(src, /id="create-session-title"/);
    assert.match(src, /useModalA11y\s*\(/);
  });

  test('MobileOverflowDrawer has role=dialog + aria-modal + labelled title + useModalA11y', () => {
    const src = read('src/layouts/MobileOverflowDrawer.tsx');
    assert.match(src, /role="dialog"/);
    assert.match(src, /aria-modal="true"/);
    assert.match(src, /aria-labelledby="mobile-overflow-title"/);
    assert.match(src, /id="mobile-overflow-title"/);
    assert.match(src, /useModalA11y\s*\(/);
  });

  test('PinGate carries role=dialog + aria-modal (full-screen auth gate)', () => {
    const src = read('src/components/shared/PinGate.tsx');
    assert.match(src, /role="dialog"/);
    assert.match(src, /aria-modal="true"/);
    assert.match(src, /aria-labelledby="pin-gate-title"/);
  });

  test('ContextLowToast is role=status + aria-live=polite, NOT dialog', () => {
    const src = read('src/components/shared/ContextLowToast.tsx');
    assert.match(src, /role="status"/);
    assert.match(src, /aria-live="polite"/);
    assert.ok(!/role="dialog"/.test(src), 'toast must not be role=dialog');
  });
});

describe('P.2 C3 — SessionCostTable degrades to card stack on mobile', () => {
  const src = read('src/components/analytics/SessionCostTable.tsx');

  test('desktop-only table is wrapped in hidden md:block', () => {
    assert.match(src, /className="hidden md:block/);
  });

  test('mobile-only card list is wrapped in md:hidden', () => {
    assert.match(src, /className="md:hidden/);
  });

  test('empty state uses themed EmptyState component, not plain text', () => {
    assert.match(src, /import \{\s*EmptyState\s*\}/);
    assert.match(src, /<EmptyState\s/);
  });
});

describe('P.2 C4 — touch targets bumped to ≥ 44×44', () => {
  // Phase P.3 H4 — TerminalTabs was removed alongside the half-built
  // Terminal page; its 44×44 bump is no longer a live contract.
  const targets: Array<{ label: string; path: string }> = [
    { label: 'SessionCard split-view button', path: 'src/components/sessions/SessionCard.tsx' },
    { label: 'ContextBar refresh button', path: 'src/components/chat/ContextBar.tsx' },
    { label: 'CreateSessionModal close X', path: 'src/components/sessions/CreateSessionModal.tsx' },
    { label: 'MobileOverflowDrawer close X', path: 'src/layouts/MobileOverflowDrawer.tsx' },
  ];

  for (const { label, path } of targets) {
    test(`${label} declares minWidth/minHeight: 44`, () => {
      const src = read(path);
      assert.match(src, /minWidth:\s*44/);
      assert.match(src, /minHeight:\s*44/);
    });
  }

  test('.session-tab in index.css has min-height: 44px', () => {
    const css = read('src/index.css');
    assert.match(css, /\.session-tab\s*\{[\s\S]*?min-height:\s*44px/);
  });
});

// P.2 H2 — tabs-wrap contract retired in Phase W.2. SplitChatLayout
// was deleted (PaneContainer is role-agnostic and doesn't have an
// inner teammate tab row). TerminalTabs was already gone in P.3 H4.
// If a new horizontal tab row appears, re-add this check pointing at
// that new component.
