import { useEffect, useState } from 'react';
import type { WSEvent } from '@commander/shared';
import { useWebSocket } from './useWebSocket';
import { api } from '../services/api';

// M7 MVP — per-session subscription to STATE.md content for the live
// drawer. Structurally independent of chat state: does NOT share any
// hook, memo, or context with ChatPage's isSessionWorking / session
// state / message pipeline. Subscription firewall per dispatch —
// STATE.md updates must never cause chat renderer churn.
//
// Flow:
//   1. On mount / sessionId change, fetch initial content via REST
//      (`GET /sessions/:id/project-state-md`). Sets `content` +
//      `isLoading` transitions.
//   2. Subscribe to the session-scoped WS channel
//      `project-state:<sessionId>`. Each `project:state-md-updated`
//      event replaces `content` and bumps `lastUpdated`.
//   3. Unsubscribe + reset on sessionId change or unmount.
//
// Return shape matches the dispatch contract.

export interface ProjectStateMdSnapshot {
  /** Current STATE.md body; null = no STATE.md or not loaded yet. */
  content: string | null;
  /** True between mount and first response; false otherwise. */
  isLoading: boolean;
  /** Wall-clock ms of the most recent content update. null until first load. */
  lastUpdated: number | null;
}

export const useProjectStateMd = (sessionId: string | undefined): ProjectStateMdSnapshot => {
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const { lastEvent, subscribe, unsubscribe } = useWebSocket();

  // Reset + initial fetch on sessionId change.
  useEffect(() => {
    setContent(null);
    setLastUpdated(null);
    if (!sessionId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    let cancelled = false;
    api
      .get<{ content: string | null }>(`/sessions/${sessionId}/project-state-md`)
      .then((res) => {
        if (cancelled) return;
        setContent(res.content);
        setIsLoading(false);
        setLastUpdated(Date.now());
      })
      .catch(() => {
        if (cancelled) return;
        // Treat failure as "no content" — drawer shows the empty state.
        setContent(null);
        setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [sessionId]);

  // WS subscribe scoped to this session. Using a per-session channel
  // name `project-state:<sessionId>` isolates the subscription from
  // chat channels; no cross-renderer coupling.
  useEffect(() => {
    if (!sessionId) return;
    const channel = `project-state:${sessionId}`;
    subscribe([channel]);
    return () => unsubscribe([channel]);
  }, [sessionId, subscribe, unsubscribe]);

  // React to incoming events. Only commit state on matching sessionId
  // + event type so any other WS traffic is ignored here.
  useEffect(() => {
    if (!sessionId || !lastEvent) return;
    const event = lastEvent as WSEvent;
    if (event.type !== 'project:state-md-updated') return;
    if (event.sessionId !== sessionId) return;
    setContent(event.content);
    setLastUpdated(Date.now());
  }, [lastEvent, sessionId]);

  return { content, isLoading, lastUpdated };
};
