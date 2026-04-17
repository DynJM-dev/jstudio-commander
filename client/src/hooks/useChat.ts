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
}

interface ChatResponse {
  messages: ChatMessage[];
  total: number;
  awaitingFirstTurn?: boolean;
}

const PAGE_SIZE = 500;

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

  return { messages, loading, error, hasMore, stats, loadMore, awaitingFirstTurn, refetch };
};
