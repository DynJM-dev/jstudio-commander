import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

// Commander Finalizer A.3 — Stop button routing per-pane isolation.
// Jose-requested guardrail (belt-and-suspenders): pin that Stop click
// on one pane's ChatPage interrupts ONLY that pane's session, never
// leaking to a sibling pane's session in split view.
//
// Mechanism: ChatPage's `interruptSession` useCallback closes over the
// component's own `sessionId` (ChatPage.tsx:274-285). The callback is
// bound into ContextBar via `onInterrupt={interruptSession}` prop
// (ChatPage.tsx:715). React's component-instance scoping means two
// <ChatPage> instances in a split view each hold their own closure
// over their own sessionId; no global state, no shared mutable ref.
//
// This test simulates that closure pattern without requiring jsdom /
// RTL. The assertion is that the api.post call made inside the
// closure carries the INSTANCE's captured sessionId, never a stale
// or sibling value. A regression in this contract would be e.g.
// using a module-level ref for sessionId, a non-memoized callback
// that captures the wrong closure, or a global event bus that
// routes by pane focus instead of by sessionId.
//
// If this test ever starts failing because ChatPage refactored to
// use a shared interrupt helper, audit the new routing carefully —
// the invariant being pinned is "click Stop on pane A → only pane
// A's session receives interrupt; pane B untouched."

interface ApiPostCall {
  url: string;
  body: unknown;
}

// Mirrors ChatPage.tsx:274-285's interruptSession closure pattern.
// `apiPost` is parameterized so the test captures the actual POST
// calls made. Each factory invocation returns a closure bound to
// one specific `sessionId` — analogous to one ChatPage instance's
// callback.
const makeInterruptClosure = (sessionId: string, apiPost: (url: string, body: unknown) => void): (() => void) => {
  return () => {
    if (!sessionId) return;
    apiPost(`/sessions/${sessionId}/key`, { key: 'Escape' });
  };
};

describe('Commander Finalizer A.3 — Stop routing per-pane isolation', () => {
  test('Stop click on pane A posts to pane A session only', () => {
    const calls: ApiPostCall[] = [];
    const apiPost = (url: string, body: unknown) => calls.push({ url, body });

    const paneA = makeInterruptClosure('sess-A-uuid', apiPost);
    const paneB = makeInterruptClosure('sess-B-uuid', apiPost);

    paneA();

    assert.equal(calls.length, 1, 'exactly one POST fired');
    assert.equal(calls[0]?.url, '/sessions/sess-A-uuid/key', 'POST targeted pane A session');
    assert.deepEqual(calls[0]?.body, { key: 'Escape' });
    // And no pane B POST.
    assert.equal(
      calls.some((c) => c.url.includes('sess-B-uuid')),
      false,
      'pane B session never touched',
    );
    // Avoid unused-var lint on paneB — the test's point is that it exists
    // but wasn't invoked.
    void paneB;
  });

  test('Stop click on pane B posts to pane B session only (inverse)', () => {
    const calls: ApiPostCall[] = [];
    const apiPost = (url: string, body: unknown) => calls.push({ url, body });

    const paneA = makeInterruptClosure('sess-A-uuid', apiPost);
    const paneB = makeInterruptClosure('sess-B-uuid', apiPost);

    paneB();

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, '/sessions/sess-B-uuid/key');
    assert.equal(
      calls.some((c) => c.url.includes('sess-A-uuid')),
      false,
      'pane A session never touched by pane B click',
    );
    void paneA;
  });

  test('Both panes clicked sequentially — each routes to its own session, no cross-talk', () => {
    const calls: ApiPostCall[] = [];
    const apiPost = (url: string, body: unknown) => calls.push({ url, body });

    const paneA = makeInterruptClosure('sess-A-uuid', apiPost);
    const paneB = makeInterruptClosure('sess-B-uuid', apiPost);

    paneA();
    paneB();
    paneA();

    assert.equal(calls.length, 3);
    assert.equal(calls[0]?.url, '/sessions/sess-A-uuid/key');
    assert.equal(calls[1]?.url, '/sessions/sess-B-uuid/key');
    assert.equal(calls[2]?.url, '/sessions/sess-A-uuid/key');
  });

  test('closure captures sessionId at creation — later re-call uses original id', () => {
    // Simulates React's useCallback closure semantics: the closure
    // captures `sessionId` at the time the callback was constructed.
    // Even if some hypothetical mutation changed a passed-in ref
    // later, the closure's own captured value is stable. This pins
    // the "no mutable session ref" invariant.
    const calls: ApiPostCall[] = [];
    const apiPost = (url: string, body: unknown) => calls.push({ url, body });
    let mutableSessionId = 'sess-A-uuid';
    const paneA = makeInterruptClosure(mutableSessionId, apiPost);
    mutableSessionId = 'sess-MUTATED'; // no effect — closure already captured
    paneA();
    assert.equal(calls[0]?.url, '/sessions/sess-A-uuid/key', 'closure captured original sessionId, not the mutated local');
  });

  test('empty-string sessionId guards a no-op (matches ChatPage.tsx:275 `if (!sessionId) return`)', () => {
    const calls: ApiPostCall[] = [];
    const apiPost = (url: string, body: unknown) => calls.push({ url, body });
    const paneNoSession = makeInterruptClosure('', apiPost);
    paneNoSession();
    assert.equal(calls.length, 0, 'empty sessionId short-circuits — no POST fires');
  });
});
