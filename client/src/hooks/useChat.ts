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
  // Phase Y Rotation 1.5 Fix C — streaming-vs-settled tracking.
  // `streamingAssistantId` holds the tail assistant id while its
  // content is still growing across polls; `null` once stable.
  // The snapshot + timer refs drive the transition; see the effect
  // below that reconciles on every `messages` change.
  const [streamingAssistantId, setStreamingAssistantId] = useState<string | null>(null);
  const streamingSnapshotRef = useRef<{ id: string | null; hash: string }>({ id: null, hash: '' });
  const streamingStabilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  useEffect(() => {
    if (!sessionId || loading) return;

    const isActive = sessionStatus === 'working' || sessionStatus === 'waiting';
    const pollInterval = isActive ? 1500 : 5000;

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
  }, [sessionId, loading, sessionStatus]);

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
    const clearTimerAndReset = () => {
      if (streamingStabilityTimerRef.current) {
        clearTimeout(streamingStabilityTimerRef.current);
        streamingStabilityTimerRef.current = null;
      }
      streamingSnapshotRef.current = { id: null, hash: '' };
      setStreamingAssistantId((prev) => (prev === null ? prev : null));
    };
    if (!last || last.role !== 'assistant' || last.content.length === 0) {
      clearTimerAndReset();
      return;
    }
    const lastBlock = last.content[last.content.length - 1];
    if (!lastBlock || lastBlock.type !== 'text') {
      clearTimerAndReset();
      return;
    }
    const hash = JSON.stringify(last.content);
    const prev = streamingSnapshotRef.current;
    if (prev.id === last.id && prev.hash === hash) {
      // No change since last reconciliation — leave the timer running.
      return;
    }
    streamingSnapshotRef.current = { id: last.id, hash };
    setStreamingAssistantId((current) => (current === last.id ? current : last.id));
    if (streamingStabilityTimerRef.current) {
      clearTimeout(streamingStabilityTimerRef.current);
    }
    streamingStabilityTimerRef.current = setTimeout(() => {
      streamingStabilityTimerRef.current = null;
      setStreamingAssistantId(null);
    }, STREAMING_STABILITY_MS);
  }, [messages]);

  // Unmount cleanup — prevent the stability timer from firing after
  // the hook tears down (would setState on an unmounted component).
  useEffect(() => {
    return () => {
      if (streamingStabilityTimerRef.current) {
        clearTimeout(streamingStabilityTimerRef.current);
        streamingStabilityTimerRef.current = null;
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
