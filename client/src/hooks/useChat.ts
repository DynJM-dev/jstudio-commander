import { useState, useEffect, useCallback, useRef } from 'react';
import type { ChatMessage, WSEvent } from '@commander/shared';
import { api } from '../services/api';
import { useWebSocket } from './useWebSocket';

interface ChatStats {
  totalTokens: number;
  totalCost: number;
  // Tokens/cost accumulated AFTER the most recent compact_boundary — what's
  // currently sitting in Claude's context window. Equal to totalTokens when
  // no compaction has occurred in this session.
  contextTokens: number;
  contextCost: number;
  byModel: Record<string, { tokens: number; cost: number }>;
}

interface UseChatReturn {
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  stats: ChatStats | null;
  loadMore: () => Promise<void>;
  // True when the session has no transcript bound yet — post-#204 the
  // chat endpoint reports this and the UI shows a "Waiting for first
  // turn…" placeholder instead of a generic empty state.
  awaitingFirstTurn: boolean;
  // User-driven force-refresh — re-runs the initial fetch, bypassing
  // the poll's ref-stability check. Exposed for the ContextBar refresh
  // button (#237); use sparingly since it blocks the UI while the
  // fetch resolves.
  refetch: () => Promise<void>;
  // Phase Y Rotation 1.5 Fix C — streaming-vs-settled signal for the
  // transcript-authoritative `composing` subtype (Investigation C,
  // un-deferred after Class 1 evidence in `~/.jstudio-commander/
  // codeman-diff.jsonl` entries 1-5, 8, 12, 14). Holds the id of the
  // last assistant message whose `content` is still growing across
  // poll ticks. Cleared (`null`) when content has stabilized for
  // STREAMING_STABILITY_MS (~2 poll cadences). `useToolExecutionState`
  // gates its `composing` detection on `streamingAssistantId === tail
  // assistant id` so a settled text tail falls through to idle instead
  // of sticking on "Composing response..."
  streamingAssistantId: string | null;
}

interface ChatResponse {
  messages: ChatMessage[];
  total: number;
  awaitingFirstTurn?: boolean;
}

const PAGE_SIZE = 500;

// Phase Y Rotation 1.5 Fix C — stability window for the
// streamingAssistantId signal. `useChat`'s poll cadence is 1.5s active
// / 5s idle; 3000ms (~2 active polls) balances: short enough that a
// settled text tail transitions to "idle" quickly after the turn ends
// (well under the 5s R2-2 criterion budget), long enough that a brief
// inter-chunk pause doesn't prematurely flip the signal to null and
// drop `composing` mid-stream. If Class 1 re-emerges at this value,
// bump to 4500ms (~3 active polls) rather than adding a new signal.
const STREAMING_STABILITY_MS = 3_000;

// Phase Y Rotation 1.6.B Fix E — active-poll window after user send.
// Per 1.6 diagnostic: server `session.status` classifier can lag on real
// streaming, dropping the poll to the idle 5s cadence and missing most
// of Claude's text-block growth. Widen the active-poll predicate to
// fire for 30s after the most recent user message, regardless of
// `sessionStatus`. 30s matches the dispatch spec — do NOT bikeshed
// without flagging per rejection trigger (h).
export const ACTIVE_AFTER_SEND_MS = 30_000;
export const ACTIVE_POLL_INTERVAL_MS = 1_500;
export const IDLE_POLL_INTERVAL_MS = 5_000;

// Phase Y Rotation 1.6.B Fix D — role-stability tuple for the
// streaming reconciler. Pre-1.6.B, the reconciler relied on
// (snapshot.id, snapshot.hash) equality to short-circuit the "stable"
// branch. A role/block transition within the same message id (e.g.
// assistant text → assistant tool_use during a turn) could slip
// through under reference-equality false negatives. The tuple sig
// `(tail.id, tail.role, lastBlock.type)` forces an explicit clear +
// re-arm on ANY of those axes changing, closing the 1.6 diagnostic's
// Failure Mode A where `setStreamingAssistantId` did not propagate
// after a rapid role flip.
export const computeTailSignature = (last: ChatMessage | undefined): string => {
  const lastBlock = last?.content?.[last.content.length - 1];
  return `${last?.id ?? '∅'}|${last?.role ?? '∅'}|${lastBlock?.type ?? '∅'}`;
};

// Snapshot the reconciler stores in a ref between passes. `tupleSig`
// is the Fix D addition; `id` + `hash` preserve the Fix C content-
// change re-arm behavior.
export interface StreamingSnapshot {
  id: string | null;
  hash: string;
  tupleSig: string;
}

export const INITIAL_STREAMING_SNAPSHOT: StreamingSnapshot = {
  id: null,
  hash: '',
  tupleSig: '',
};

// Directive the reconciler returns per pass. `kind='stable'` means no
// action; `kind='clear'` means flip streamingAssistantId to null and
// cancel any pending timer; `kind='set'` means flip to the new id and
// (re)arm the stability timer.
export type StreamingReconcileDirective =
  | { kind: 'stable' }
  | { kind: 'clear'; snapshot: StreamingSnapshot; reason: 'non-assistant' | 'non-text' }
  | {
      kind: 'set';
      id: string;
      snapshot: StreamingSnapshot;
      armTimer: true;
      reason: 'tail-changed' | 'hash-changed' | 'tuple-changed';
    };

// Pure reconciler — exported for test isolation (no React needed).
// Closes Fix D: a tuple-sig change between passes is an immediate
// clear-or-set signal independent of the id+hash comparison.
export const reconcileStreamingState = (
  last: ChatMessage | undefined,
  prevSnapshot: StreamingSnapshot,
): StreamingReconcileDirective => {
  const tupleSig = computeTailSignature(last);
  const lastBlock = last?.content?.[last.content.length - 1];

  // Non-assistant tail (or empty content) — immediate clear. Fix D (a).
  if (!last || last.role !== 'assistant' || last.content.length === 0) {
    return {
      kind: 'clear',
      snapshot: { id: null, hash: '', tupleSig },
      reason: 'non-assistant',
    };
  }
  // Assistant tail but non-text block — immediate clear. Fix D (b).
  if (!lastBlock || lastBlock.type !== 'text') {
    return {
      kind: 'clear',
      snapshot: { id: null, hash: '', tupleSig },
      reason: 'non-text',
    };
  }

  // Assistant/text tail.
  const hash = JSON.stringify(last.content);
  const idChanged = prevSnapshot.id !== last.id;
  const hashChanged = prevSnapshot.hash !== hash;
  const tupleChanged = prevSnapshot.tupleSig !== tupleSig;

  if (!idChanged && !hashChanged && !tupleChanged) {
    return { kind: 'stable' };
  }
  // Any change → set + re-arm. Reason prefers the most specific
  // discriminator for diagnostic clarity.
  const reason: 'tail-changed' | 'hash-changed' | 'tuple-changed' = idChanged
    ? 'tail-changed'
    : tupleChanged
      ? 'tuple-changed'
      : 'hash-changed';
  return {
    kind: 'set',
    id: last.id,
    snapshot: { id: last.id, hash, tupleSig },
    armTimer: true,
    reason,
  };
};

// Fix E predicates — pure.
export const computeActivePollWindow = (
  lastUserMessageAt: number | null,
  now: number = Date.now(),
): boolean => {
  if (!lastUserMessageAt || lastUserMessageAt <= 0) return false;
  return now - lastUserMessageAt < ACTIVE_AFTER_SEND_MS;
};

export const selectPollInterval = (
  sessionStatus: string | undefined,
  activePollWindow: boolean,
): number => {
  const isActive =
    sessionStatus === 'working' || sessionStatus === 'waiting' || activePollWindow;
  return isActive ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS;
};

// Extract the most-recent user-message timestamp from `messages` tail.
// In-useChat detection path for Fix E — avoids a ChatPage prop
// (scope-locked to `useChat.ts + useToolExecutionState.ts` for this
// rotation). Returns null when no user message is visible or timestamp
// is unparseable.
export const mostRecentUserMessageAt = (messages: ChatMessage[]): number | null => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    if (m.role !== 'user') continue;
    const t = Date.parse(m.timestamp);
    return Number.isFinite(t) ? t : null;
  }
  return null;
};

// Tail-delta merge: replace messages with matching id when content has
// changed (captures #193 in-place block growth) and append truly new
// ids. Returns prev unchanged when nothing differs so React keeps a
// stable reference and downstream useMemo([messages]) chains don't fire.
const mergeDelta = (prev: ChatMessage[], delta: ChatMessage[]): ChatMessage[] => {
  if (delta.length === 0) return prev;
  const indexById = new Map<string, number>();
  prev.forEach((m, i) => indexById.set(m.id, i));
  let next: ChatMessage[] | null = null;
  for (const incoming of delta) {
    const i = indexById.get(incoming.id);
    if (i === undefined) {
      if (!next) next = [...prev];
      next.push(incoming);
    } else {
      const existing = (next ?? prev)[i]!;
      if (JSON.stringify(existing) !== JSON.stringify(incoming)) {
        if (!next) next = [...prev];
        next[i] = incoming;
      }
    }
  }
  return next ?? prev;
};

export const useChat = (sessionId: string | undefined, sessionStatus?: string): UseChatReturn => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<ChatStats | null>(null);
  const [awaitingFirstTurn, setAwaitingFirstTurn] = useState<boolean>(false);
  // Phase Y Rotation 1.5 Fix C + 1.6.B Fix D — streaming-vs-settled
  // tracking. `streamingAssistantId` holds the tail assistant id while
  // its content is still growing across polls; `null` once stable OR
  // when the tail transitions to a non-assistant / non-text block.
  // The snapshot + timer refs drive the transition; see the effect
  // below that reconciles on every `messages` change via the pure
  // `reconcileStreamingState` helper.
  const [streamingAssistantId, setStreamingAssistantId] = useState<string | null>(null);
  const streamingSnapshotRef = useRef<StreamingSnapshot>(INITIAL_STREAMING_SNAPSHOT);
  const streamingStabilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Phase Y Rotation 1.6.B Fix E — active-poll window state. Driven by
  // the most recent user message's timestamp; flips off after
  // ACTIVE_AFTER_SEND_MS via setTimeout. Threaded into the poll
  // useEffect's pollInterval selection so we stay on the active
  // cadence (1.5s) for 30s post-send regardless of `sessionStatus`.
  const [activePollWindow, setActivePollWindow] = useState(false);
  const activePollWindowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { subscribe, unsubscribe, lastEvent } = useWebSocket();
  const mountedRef = useRef(true);
  const prevSessionRef = useRef<string | undefined>(undefined);
  // #216 — tail-delta cursor. We send `?since=<id>` on steady-state polls
  // so the server returns only messages strictly after that id. To keep
  // #193's in-place message growth detection intact (Claude Code streams
  // new content blocks INTO an existing assistant message), the cursor
  // points at the SECOND-to-last message — the actual last is always
  // re-fetched and merged so growth is captured.
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Fetch initial messages when sessionId changes
  useEffect(() => {
    mountedRef.current = true;

    if (!sessionId) {
      setMessages([]);
      setLoading(false);
      setError(null);
      setTotal(0);
      setStats(null);
      return () => { mountedRef.current = false; };
    }

    // Reset state for new session
    setMessages([]);
    setLoading(true);
    setError(null);
    setStats(null);

    const fetchData = async () => {
      try {
        const [chatRes, statsRes] = await Promise.all([
          api.get<ChatResponse>(`/chat/${sessionId}?limit=${PAGE_SIZE}`),
          api.get<ChatStats>(`/chat/${sessionId}/stats`).catch(() => null),
        ]);

        if (mountedRef.current) {
          setMessages(chatRes.messages);
          setTotal(chatRes.total);
          setStats(statsRes);
          setAwaitingFirstTurn(!!chatRes.awaitingFirstTurn);
          setLoading(false);
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : 'Failed to fetch messages');
          setLoading(false);
        }
      }
    };

    fetchData();
    return () => { mountedRef.current = false; };
  }, [sessionId]);

  // Subscribe to chat channel
  useEffect(() => {
    if (!sessionId) return;

    // Unsubscribe from previous session
    if (prevSessionRef.current && prevSessionRef.current !== sessionId) {
      unsubscribe([`chat:${prevSessionRef.current}`]);
    }

    subscribe([`chat:${sessionId}`]);
    prevSessionRef.current = sessionId;

    return () => {
      unsubscribe([`chat:${sessionId}`]);
    };
  }, [sessionId, subscribe, unsubscribe]);

  // Handle WebSocket events
  useEffect(() => {
    if (!lastEvent || !sessionId) return;

    const event = lastEvent as WSEvent;

    if (event.type === 'chat:message' && event.sessionId === sessionId) {
      setMessages((prev) => {
        if (prev.some((m) => m.id === event.message.id)) return prev;
        return [...prev, event.message];
      });
      setTotal((prev) => prev + 1);
    }

    if (event.type === 'chat:messages' && event.sessionId === sessionId) {
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const newMsgs = event.messages.filter((m) => !existingIds.has(m.id));
        return newMsgs.length > 0 ? [...prev, ...newMsgs] : prev;
      });
      setTotal((prev) => prev + event.messages.length);
    }
  }, [lastEvent, sessionId]);

  // Adaptive polling — fast when working (1.5s), slow when idle (5s).
  // #216 — steady-state polls use ?since=<cursorId> where cursor is the
  // SECOND-to-last message id so the actual last message (which may
  // still be growing in-place) is always re-fetched and merged. When
  // the list has < 2 messages we fall back to a full fetch.
  //
  // Phase Y Rotation 1.6.B Fix E — `activePollWindow` is OR'd into the
  // active predicate so a freshly-sent user message keeps the poll on
  // the 1.5s cadence for 30s even when the server classifier is still
  // stuck on `idle`. This closes the 1.6 diagnostic's under-fire
  // composing where useChat missed streaming content between 5s polls.
  useEffect(() => {
    if (!sessionId || loading) return;

    const pollInterval = selectPollInterval(sessionStatus, activePollWindow);
    const isActive = pollInterval === ACTIVE_POLL_INTERVAL_MS;

    const poll = async () => {
      try {
        const current = messagesRef.current;
        const cursorId = current.length >= 2 ? current[current.length - 2]!.id : undefined;
        const url = cursorId
          ? `/chat/${sessionId}?since=${encodeURIComponent(cursorId)}&limit=${PAGE_SIZE}`
          : `/chat/${sessionId}?limit=${PAGE_SIZE}`;

        const [chatRes, statsRes] = await Promise.all([
          api.get<ChatResponse>(url),
          api.get<ChatStats>(`/chat/${sessionId}/stats`).catch(() => null),
        ]);

        if (cursorId) {
          // Delta path — merge into existing list to capture in-place
          // growth on the cursor message (#193 invariant) and append
          // any newer messages.
          setMessages((prev) => mergeDelta(prev, chatRes.messages));
        } else {
          // Full-fetch fallback — replace, but stay ref-stable when the
          // server's tail matches what we already have so downstream
          // useMemo chains don't fire on every poll.
          setMessages((prev) => {
            if (chatRes.messages.length === 0) return prev;
            if (chatRes.messages.length !== prev.length) return chatRes.messages;
            const lastNew = chatRes.messages[chatRes.messages.length - 1];
            const lastOld = prev[prev.length - 1];
            if (lastNew?.id !== lastOld?.id) return chatRes.messages;
            if (JSON.stringify(lastNew) !== JSON.stringify(lastOld)) return chatRes.messages;
            return prev;
          });
        }
        setTotal(chatRes.total);
        setAwaitingFirstTurn(!!chatRes.awaitingFirstTurn);
        if (statsRes) setStats(statsRes);
      } catch {
        // Silently fail on poll
      }
    };

    // Fire immediately on status change to working
    if (isActive) poll();

    const interval = setInterval(poll, pollInterval);
    return () => clearInterval(interval);
  }, [sessionId, loading, sessionStatus, activePollWindow]);

  // Phase Y Rotation 1.5 Fix C — streaming-vs-settled reconciler. Fires
  // on every `messages` reference change (i.e. every poll tick that
  // produced a delta, plus any WS append / initial fetch). If the tail
  // is an assistant text block, we mark it streaming and (re)arm a
  // STREAMING_STABILITY_MS timer; the timer's expiry flips the signal
  // to null, which downstream gates `composing` off in
  // `useToolExecutionState`. Any further content change before the
  // timer fires re-arms it — naturally extending the streaming window
  // as long as Claude keeps adding chunks.
  //
  // Scope: only the ASSISTANT text tail is tracked. Non-text tails
  // (tool_use, tool_result, compact blocks, user messages) clear the
  // signal immediately — those states are handled by their own
  // branches in the derivation.
  useEffect(() => {
    const last = messages[messages.length - 1];
    const directive = reconcileStreamingState(last, streamingSnapshotRef.current);

    if (directive.kind === 'stable') return;

    if (directive.kind === 'clear') {
      streamingSnapshotRef.current = directive.snapshot;
      if (streamingStabilityTimerRef.current) {
        clearTimeout(streamingStabilityTimerRef.current);
        streamingStabilityTimerRef.current = null;
      }
      setStreamingAssistantId((prev) => (prev === null ? prev : null));
      return;
    }

    // kind === 'set' — new assistant/text tail (role-changed, tuple-
    // changed, or hash-changed). Flip streamingAssistantId + (re)arm
    // the 3s stability timer.
    streamingSnapshotRef.current = directive.snapshot;
    setStreamingAssistantId((current) => (current === directive.id ? current : directive.id));
    if (streamingStabilityTimerRef.current) {
      clearTimeout(streamingStabilityTimerRef.current);
    }
    streamingStabilityTimerRef.current = setTimeout(() => {
      streamingStabilityTimerRef.current = null;
      setStreamingAssistantId(null);
    }, STREAMING_STABILITY_MS);
  }, [messages]);

  // Phase Y Rotation 1.6.B Fix E — track most-recent user-message
  // timestamp. In-useChat detection path (no ChatPage prop required
  // per this rotation's scope). When a new user message appears in
  // the tail (WS append or poll merge), activate the 30s post-send
  // poll window. Pure `computeActivePollWindow` predicate seeds the
  // initial state; the timer flips the window off at expiry.
  useEffect(() => {
    const at = mostRecentUserMessageAt(messages);
    const shouldBeActive = computeActivePollWindow(at);
    setActivePollWindow((prev) => (prev === shouldBeActive ? prev : shouldBeActive));

    if (activePollWindowTimerRef.current) {
      clearTimeout(activePollWindowTimerRef.current);
      activePollWindowTimerRef.current = null;
    }
    if (!shouldBeActive || at === null) return;

    const remainingMs = ACTIVE_AFTER_SEND_MS - (Date.now() - at);
    if (remainingMs <= 0) {
      setActivePollWindow((prev) => (prev === false ? prev : false));
      return;
    }
    activePollWindowTimerRef.current = setTimeout(() => {
      activePollWindowTimerRef.current = null;
      setActivePollWindow(false);
    }, remainingMs);
  }, [messages]);

  // Unmount cleanup — prevent the stability timer AND the active-poll
  // window timer from firing after the hook tears down (would setState
  // on an unmounted component).
  useEffect(() => {
    return () => {
      if (streamingStabilityTimerRef.current) {
        clearTimeout(streamingStabilityTimerRef.current);
        streamingStabilityTimerRef.current = null;
      }
      if (activePollWindowTimerRef.current) {
        clearTimeout(activePollWindowTimerRef.current);
        activePollWindowTimerRef.current = null;
      }
    };
  }, []);

  const hasMore = messages.length < total;

  // Force re-fetch of the current session's messages + stats. Clears
  // state first so any stale dedup cache in the poll useEffect can't
  // resurrect the old list; the next poll tick will refill normally.
  const refetch = useCallback(async () => {
    if (!sessionId) return;
    try {
      const [chatRes, statsRes] = await Promise.all([
        api.get<ChatResponse>(`/chat/${sessionId}?limit=${PAGE_SIZE}`),
        api.get<ChatStats>(`/chat/${sessionId}/stats`).catch(() => null),
      ]);
      if (mountedRef.current) {
        setMessages(chatRes.messages);
        setTotal(chatRes.total);
        setAwaitingFirstTurn(!!chatRes.awaitingFirstTurn);
        if (statsRes) setStats(statsRes);
      }
    } catch {
      /* silent — user can retry */
    }
  }, [sessionId]);

  const loadMore = useCallback(async () => {
    if (!sessionId || !hasMore) return;

    try {
      const res = await api.get<ChatResponse>(
        `/chat/${sessionId}?limit=${PAGE_SIZE}&offset=${messages.length}`
      );

      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const newMsgs = res.messages.filter((m) => !existingIds.has(m.id));
        return [...prev, ...newMsgs];
      });
    } catch {
      // silently fail on load more
    }
  }, [sessionId, hasMore, messages.length]);

  return { messages, loading, error, hasMore, stats, loadMore, awaitingFirstTurn, refetch, streamingAssistantId };
};
