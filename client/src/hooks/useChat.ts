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

  // Adaptive polling — fast when working (1.5s), slow when idle (5s)
  useEffect(() => {
    if (!sessionId || loading) return;

    const isActive = sessionStatus === 'working' || sessionStatus === 'waiting';
    const pollInterval = isActive ? 1500 : 5000;

    const poll = async () => {
      try {
        const [chatRes, statsRes] = await Promise.all([
          api.get<ChatResponse>(`/chat/${sessionId}?limit=${PAGE_SIZE}`),
          api.get<ChatStats>(`/chat/${sessionId}/stats`).catch(() => null),
        ]);
        setMessages((prev) => {
          // Server is source of truth. Keep ref stability when nothing
          // changed, but don't stop at matching IDs — Claude Code streams
          // new content blocks INTO an existing assistant message during
          // a composing phase, so the length + last id can be identical
          // while the content is growing. The old id-only comparison
          // froze the UI and broke every downstream useMemo([messages]).
          if (chatRes.messages.length === 0) return prev;
          if (chatRes.messages.length !== prev.length) return chatRes.messages;
          const lastNew = chatRes.messages[chatRes.messages.length - 1];
          const lastOld = prev[prev.length - 1];
          if (lastNew?.id !== lastOld?.id) return chatRes.messages;
          // Same last id — check block count + last-block deep-equality
          // so in-place growth is detected. JSON.stringify is cheap at
          // our block sizes and avoids missing tool_use/tool_result
          // updates that mutate existing block input/content.
          if ((lastNew?.content?.length ?? 0) !== (lastOld?.content?.length ?? 0)) {
            return chatRes.messages;
          }
          const tailNew = lastNew?.content[lastNew.content.length - 1];
          const tailOld = lastOld?.content[lastOld.content.length - 1];
          if (JSON.stringify(tailNew) !== JSON.stringify(tailOld)) {
            return chatRes.messages;
          }
          return prev;
        });
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
