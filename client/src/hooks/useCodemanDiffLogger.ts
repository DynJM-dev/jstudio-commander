import { useEffect } from 'react';
import type { ChatMessage, SessionState, SessionStatus } from '@commander/shared';
import { api } from '../services/api';
import type { ToolExecutionState } from './useToolExecutionState';

// Phase Y Rotation 1 — `[codeman-diff]` parallel-run divergence logger.
// Called once per render cycle from ChatPage where BOTH the codeman-
// pattern state and the legacy composite are known. When the two
// disagree, emit one log line to DevTools console AND POST the payload
// to `/api/debug/codeman-diff` for durable JSONL storage
// (`~/.jstudio-commander/codeman-diff.jsonl`) per CTO Amendment 1.
//
// Dedupe: module-level Map<sessionId, lastPayloadSignature>. Skip emit
// when the signature hasn't changed — prevents log flooding across
// idle re-renders that produce identical derivation outputs.
//
// This hook is TEMPORARY. Rotation 2 deletes the hook, its callers,
// the server endpoint, and the JSONL file. Strip verification at
// dispatch §2.6 confirms all four.

interface LegacyState {
  isWorking: boolean;
  label: string | null;
}

interface DiffPayload {
  ts: number;
  sessionId: string;
  codemanIsWorking: boolean;
  codemanLabel: string | null;
  codemanSubtype: ToolExecutionState['subtype'];
  legacyIsWorking: boolean;
  legacyLabel: string | null;
  messagesTail: Array<{ id: string; role: string; blockTypes: string[] }>;
  sessionStatus: SessionStatus | string | null;
  sessionStateKind: SessionState['kind'] | null;
}

// Per-session dedupe. Keyed by sessionId; value is a stable signature
// of the (codeman × legacy) divergence tuple. Only one signature per
// session at a time — the NEXT distinct signature emits.
const lastEmittedByCapture = new Map<string, string>();

const MESSAGES_TAIL_COUNT = 3;

const signatureOf = (p: Omit<DiffPayload, 'ts' | 'messagesTail'>): string =>
  [
    p.sessionId,
    p.codemanIsWorking ? '1' : '0',
    p.codemanLabel ?? '∅',
    p.codemanSubtype,
    p.legacyIsWorking ? '1' : '0',
    p.legacyLabel ?? '∅',
    p.sessionStatus ?? '∅',
    p.sessionStateKind ?? '∅',
  ].join('|');

const truncateTail = (messages: ChatMessage[]): DiffPayload['messagesTail'] => {
  const start = Math.max(0, messages.length - MESSAGES_TAIL_COUNT);
  const out: DiffPayload['messagesTail'] = [];
  for (let i = start; i < messages.length; i++) {
    const m = messages[i];
    if (!m) continue;
    out.push({
      id: m.id,
      role: m.role,
      blockTypes: m.content.map((b) => b.type),
    });
  }
  return out;
};

// Test-only peek + reset. Not referenced by production code.
export const __codemanDiffTestSupport = {
  peekSignature: (sessionId: string): string | undefined =>
    lastEmittedByCapture.get(sessionId),
  reset: (): void => { lastEmittedByCapture.clear(); },
  // Direct entry point for tests that exercise the emit-on-change
  // contract without standing up a React tree. Returns `true` when
  // this call emitted; `false` when dedupe suppressed.
  tryEmitForTest: (payload: Omit<DiffPayload, 'ts' | 'messagesTail'>): boolean => {
    const sig = signatureOf(payload);
    if (lastEmittedByCapture.get(payload.sessionId) === sig) return false;
    lastEmittedByCapture.set(payload.sessionId, sig);
    return true;
  },
};

export interface UseCodemanDiffLoggerArgs {
  sessionId: string | undefined;
  codemanState: ToolExecutionState;
  legacyState: LegacyState;
  messages: ChatMessage[];
  sessionStatus: SessionStatus | string | null | undefined;
  sessionStateKind: SessionState['kind'] | null | undefined;
}

export const useCodemanDiffLogger = (args: UseCodemanDiffLoggerArgs): void => {
  const {
    sessionId,
    codemanState,
    legacyState,
    messages,
    sessionStatus,
    sessionStateKind,
  } = args;

  useEffect(() => {
    if (!sessionId) return;
    const codemanIsWorking = codemanState.isWorking;
    const codemanLabel = codemanState.label;
    const legacyIsWorking = legacyState.isWorking;
    const legacyLabel = legacyState.label;

    // Only emit on DIVERGENCE. Agreement adds no audit value and
    // bloats the JSONL during steady-state work.
    const divergent =
      codemanIsWorking !== legacyIsWorking || codemanLabel !== legacyLabel;
    if (!divergent) return;

    const signatureInput = {
      sessionId,
      codemanIsWorking,
      codemanLabel,
      codemanSubtype: codemanState.subtype,
      legacyIsWorking,
      legacyLabel,
      sessionStatus: sessionStatus ?? null,
      sessionStateKind: sessionStateKind ?? null,
    };
    const signature = signatureOf(signatureInput);
    if (lastEmittedByCapture.get(sessionId) === signature) return;
    lastEmittedByCapture.set(sessionId, signature);

    const payload: DiffPayload = {
      ts: Date.now(),
      ...signatureInput,
      messagesTail: truncateTail(messages),
    };

    // Console emit — live debug during rotation 1 real-use.
    // Prefix `[codeman-diff]` per `standards/INVESTIGATION_DISCIPLINE.md`
    // so grep-strip at rotation 2 is mechanical.
    // eslint-disable-next-line no-console
    console.log('[codeman-diff]', payload);

    // Durable POST — fire-and-forget. The server appends to JSONL;
    // disk errors are logged server-side but don't fail the request.
    // Swallow client-side rejects so a server restart or an offline
    // tunnel doesn't produce unhandled promise rejections.
    api.post('/debug/codeman-diff', payload).catch(() => { /* swallow */ });
  }, [
    sessionId,
    codemanState.isWorking,
    codemanState.label,
    codemanState.subtype,
    legacyState.isWorking,
    legacyState.label,
    sessionStatus,
    sessionStateKind,
    messages,
  ]);
};
