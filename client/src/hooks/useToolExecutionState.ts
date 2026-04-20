import { useMemo } from 'react';
import type { ChatMessage, ContentBlock } from '@commander/shared';

// Phase Y Rotation 1 — Codeman-pattern transcript-authoritative state
// derivation. Produces isWorking + rich label purely from ChatMessage[]
// with zero dependency on server-side session.status, sessionState.kind,
// or heartbeat gates.
//
// Lives alongside the 15.3-arc OR-chain in ChatPage during rotation 1
// as a parallel-run counterparty; `[codeman-diff]` logger (see
// useCodemanDiffLogger) emits on divergence. Rotation 2 deletes the
// legacy chain once the disagreement log audits clean.
//
// Derivation order (first match wins):
//   1. `/compact` in-progress  — compact_boundary tail without a
//      subsequent compact_summary → subtype 'compacting'.
//   2. Unmatched tool_use — any tool_use id in the tail without a
//      matching tool_result. Single tool → rich label; ≥2 tools →
//      synthetic "Running N tools (…)" label per Investigation A
//      Candidate (b).
//   3. Composing — last message is assistant and its final block is
//      `text`. subtype 'composing'.
//   4. Idle.
//
// Rotation 1.5 Fix C (Investigation C un-deferred) — composing detection
// is now GATED on `streamingAssistantId` threaded in from `useChat`.
// The host hook observes tail-content stability across polls: when the
// tail assistant text block has been stable for STREAMING_STABILITY_MS
// (~2 poll cadences, 3s), `streamingAssistantId` flips to null and
// composing transitions to idle. Previously a settled text tail stuck
// on "Composing response..." — Class 1 divergence in
// `~/.jstudio-commander/codeman-diff.jsonl` (entries 1-5, 8, 12, 14).
// Fix closes that edge; settled tails now fall through to idle within
// ~3s of the last content chunk.

export type ToolExecutionSubtype = 'tool_exec' | 'composing' | 'compacting' | 'idle';

export interface ToolExecutionState {
  isWorking: boolean;
  /** Single tool name, list of names (parallel), or null when idle / non-tool state. */
  currentTool: string | string[] | null;
  /** Rich human-readable label for ContextBar consumption; null when idle. */
  label: string | null;
  subtype: ToolExecutionSubtype;
}

const IDLE_STATE: ToolExecutionState = {
  isWorking: false,
  currentTool: null,
  label: null,
  subtype: 'idle',
};

// Tail scan bound. Matches `hasUnmatchedToolUse` (`contextBarAction.ts:63`)
// for consistency. Per PM ratification: bump only if live-smoke reveals
// compact_boundary / tool_use falling outside the window with no
// matching follow-up — do not pre-optimize.
const TAIL_SCAN_WINDOW = 8;

const basename = (path: string): string => {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
};

// Rich per-tool label; ordering matches the observed Claude Code tool
// surface. Fallback for unmapped tools is "Running {name}" — Issue 5
// default-render policy applied to labels.
const labelForTool = (name: string, input: Record<string, unknown>): string => {
  switch (name) {
    case 'Read':
      return typeof input.file_path === 'string'
        ? `Reading ${basename(input.file_path)}`
        : 'Reading file';
    case 'Write':
      return typeof input.file_path === 'string'
        ? `Writing ${basename(input.file_path)}`
        : 'Writing file';
    case 'Edit':
    case 'MultiEdit':
      return typeof input.file_path === 'string'
        ? `Editing ${basename(input.file_path)}`
        : 'Editing file';
    case 'Bash':
      return 'Running command';
    case 'Grep':
      return 'Searching';
    case 'Glob':
      return 'Finding files';
    case 'Task': {
      const sub = typeof input.subagent_type === 'string' ? input.subagent_type : null;
      return sub ? `Spawning agent (${sub})` : 'Spawning agent';
    }
    case 'WebFetch':
      return 'Fetching URL';
    case 'WebSearch':
      return 'Web search';
    case 'NotebookEdit':
      return 'Editing notebook';
    case 'TodoWrite':
      return 'Updating todos';
    default:
      return `Running ${name}`;
  }
};

// Synthetic label for ≥2 parallel unmatched tool_uses. Candidate (b)
// from Investigation A, ratified: cap at 2 distinct names, aggregate
// "…" suffix when 3+ distinct names appear. Repeat-counts (e.g. 5
// parallel TaskCreate) collapse to `Name×N`.
const synthesizeParallelLabel = (unmatched: Array<{ name: string }>): string => {
  const countByName = new Map<string, number>();
  for (const u of unmatched) {
    countByName.set(u.name, (countByName.get(u.name) ?? 0) + 1);
  }
  const names = Array.from(countByName.keys());
  const visibleNames = names.slice(0, 2);
  const visible = visibleNames.map((n) => {
    const c = countByName.get(n)!;
    return c > 1 ? `${n}×${c}` : n;
  });
  const suffix = names.length > visibleNames.length ? ', …' : '';
  return `Running ${unmatched.length} tools (${visible.join(', ')}${suffix})`;
};

// Pure derivation. Exported for direct unit testing (no React needed).
// Given the same `(messages, streamingAssistantId)` input, ALWAYS returns
// the same output — no module-level state, no time-dependent branches
// inside the derivation itself (the time-based stability gate lives in
// `useChat` and is surfaced here as the `streamingAssistantId` param).
// This guarantees per-session isolation at the function level
// (dispatch §1.6 test 8) — the function literally has no shared state
// to contaminate.
export const deriveToolExecutionState = (
  messages: ChatMessage[],
  window = TAIL_SCAN_WINDOW,
  streamingAssistantId: string | null = null,
): ToolExecutionState => {
  if (messages.length === 0) return IDLE_STATE;
  const start = Math.max(0, messages.length - window);

  // 1) Compact detection — scan tail for compact_boundary without a
  // later compact_summary. compact_summary appears in its own system-
  // role message AFTER the boundary in ChatMessage ordering.
  let boundarySeen = false;
  let boundaryFollowedBySummary = false;
  for (let i = start; i < messages.length; i++) {
    const m = messages[i];
    if (!m) continue;
    for (const b of m.content) {
      if (b.type === 'compact_boundary') {
        boundarySeen = true;
        boundaryFollowedBySummary = false;
      } else if (b.type === 'compact_summary' && boundarySeen) {
        boundaryFollowedBySummary = true;
      }
    }
  }
  if (boundarySeen && !boundaryFollowedBySummary) {
    return {
      isWorking: true,
      currentTool: null,
      label: 'Compacting context...',
      subtype: 'compacting',
    };
  }

  // 2) Unmatched tool_use — pair by id. Walks tail only so performance
  // stays bounded. When Claude Code emits parallel tool_uses in one
  // assistant message, each has a distinct id; tool_results come back
  // in the next user message, one block per pending id.
  const pending = new Map<string, { name: string; input: Record<string, unknown> }>();
  const resultIds = new Set<string>();
  for (let i = start; i < messages.length; i++) {
    const m = messages[i];
    if (!m) continue;
    for (const b of m.content) {
      if (b.type === 'tool_use' && b.id) {
        pending.set(b.id, { name: b.name, input: b.input });
      } else if (b.type === 'tool_result' && b.toolUseId) {
        resultIds.add(b.toolUseId);
      }
    }
  }
  const unmatched: Array<{ name: string; input: Record<string, unknown> }> = [];
  // Preserve insertion order so single-tool rich labels use the most
  // recently-dispatched tool's input.
  for (const [id, info] of pending) {
    if (!resultIds.has(id)) unmatched.push(info);
  }

  if (unmatched.length === 1) {
    const u = unmatched[unmatched.length - 1]!;
    return {
      isWorking: true,
      currentTool: u.name,
      label: labelForTool(u.name, u.input),
      subtype: 'tool_exec',
    };
  }
  if (unmatched.length >= 2) {
    return {
      isWorking: true,
      currentTool: unmatched.map((u) => u.name),
      label: synthesizeParallelLabel(unmatched),
      subtype: 'tool_exec',
    };
  }

  // 3) Composing — last assistant message's final block is text AND
  // `useChat` reports its content is still actively streaming (i.e.
  // `streamingAssistantId` matches this tail id). A settled text tail
  // (streamingAssistantId===null, or pointing at an older id after a
  // newer message arrived) falls through to idle — Rotation 1.5 Fix C,
  // closes Class 1 stuck-composing evidence.
  const last = messages[messages.length - 1];
  if (last?.role === 'assistant' && last.content.length > 0) {
    const lastBlock: ContentBlock | undefined = last.content[last.content.length - 1];
    if (lastBlock?.type === 'text' && streamingAssistantId === last.id) {
      return {
        isWorking: true,
        currentTool: null,
        label: 'Composing response...',
        subtype: 'composing',
      };
    }
  }

  // 4) Idle.
  return IDLE_STATE;
};

// React hook wrapper. Memoizes the pure derivation against `messages`
// reference identity — `useChat`'s mergeDelta keeps the reference
// stable when nothing changed, so this `useMemo` only re-runs when
// the tail actually moves. `sessionId` is carried for the parallel-run
// diff logger's payload (the hook itself doesn't branch on it; pure
// derivation + per-session isolation comes from the `messages` input
// scope already).
//
// Per-session isolation (dispatch §1.1 "Crucial isolation"):
//   - Pure function, no module-level state. Two hook instances with
//     different sessionIds each receive their own `messages` array
//     (typically from their own `useChat(sessionId)` call) and
//     compute independently. Verified by the React-tree test
//     substitute in `useToolExecutionState.test.ts`.
export const useToolExecutionState = (
  _sessionId: string | undefined,
  messages: ChatMessage[],
  streamingAssistantId: string | null = null,
): ToolExecutionState => {
  return useMemo(
    () => deriveToolExecutionState(messages, TAIL_SCAN_WINDOW, streamingAssistantId),
    [messages, streamingAssistantId],
  );
};
