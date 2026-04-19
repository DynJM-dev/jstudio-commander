import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../services/api';
// Issue 8.1 P1 — parseTerminalHint moved to src/utils/ so its pattern-
// matching contract is unit-tested in isolation. The function here
// used to scan the pane-output tail with a blob-match that would
// false-fire on reply content containing `✻` / `✶` / the word
// "thinking". The extracted version requires a line-start anchor on
// the glyph AND a live verb (`-ing`/`-ed`/`Idle`) on the same line.
import { parseTerminalHint } from '../utils/parseTerminalHint';

interface DetectedPrompt {
  type: string;
  message: string;
  context?: string;
  options?: string[];
}

interface OutputResponse {
  output: string;
  lines: string[];
  alive: boolean;
  prompts: DetectedPrompt[];
}

interface UsePromptDetectionReturn {
  prompt: DetectedPrompt | null;
  terminalHint: string | null;
  messagesQueued: boolean;
  clearPrompt: () => void;
}

export const usePromptDetection = (
  sessionId: string | undefined,
  sessionStatus: string | undefined,
  messageCount: number,
  userJustSent = false,
): UsePromptDetectionReturn => {
  const [prompt, setPrompt] = useState<DetectedPrompt | null>(null);
  const [terminalHint, setTerminalHint] = useState<string | null>(null);
  const [messagesQueued, setMessagesQueued] = useState(false);
  const prevMessageCountRef = useRef(messageCount);
  const dismissedUntilRef = useRef(0);

  // Clear prompt when session goes idle or new messages arrive
  useEffect(() => {
    if (sessionStatus === 'idle' || sessionStatus === 'stopped') {
      setPrompt(null);
      setTerminalHint(null);
      setMessagesQueued(false);
    }
  }, [sessionStatus]);

  // Clear dismissed state when new messages arrive (allows re-detection)
  useEffect(() => {
    if (messageCount > prevMessageCountRef.current) {
      prevMessageCountRef.current = messageCount;
    }
  }, [messageCount]);

  const clearPrompt = useCallback(() => {
    setPrompt(null);
    dismissedUntilRef.current = Date.now() + 5000; // 5s debounce
  }, []);

  // Poll for prompts + terminal hints when session is active or user just sent
  useEffect(() => {
    if (!sessionId) return;
    const isActive = sessionStatus === 'working' || sessionStatus === 'waiting' || userJustSent;
    if (!isActive) return;

    // 1s when user just sent (instant echo) or the session is in 'waiting'
    // (permission prompts must surface fast — the 2s default left users
    // staring at a waiting tab with no prompt card for several ticks).
    // 2s for steady 'working' so the poll doesn't hammer tmux on long turns.
    const pollInterval = userJustSent || sessionStatus === 'waiting' ? 1000 : 2000;

    const poll = async () => {
      try {
        const res = await api.get<OutputResponse>(
          `/sessions/${sessionId}/output?lines=15`
        );

        // Trust the server — if it found a prompt, surface it regardless of
        // the current status classification (the status poller runs on a
        // separate 5s cadence, so it can lag behind a fresh prompt that's
        // already on the pane). Only suppress during the manual-dismiss
        // debounce window.
        const isDismissed = Date.now() < dismissedUntilRef.current;
        if (!isDismissed && res.prompts && res.prompts.length > 0) {
          setPrompt(res.prompts[res.prompts.length - 1]!);
        } else if (sessionStatus !== 'waiting') {
          // Not waiting and no prompt — clear any stale prompt card. When
          // we ARE waiting, keep the last-known prompt until the server
          // confirms it's gone, so brief detection misses don't blink.
          setPrompt(null);
        }

        // Terminal hint for ContextBar action status
        const hint = parseTerminalHint(res.lines);
        setTerminalHint(hint);

        // Detect queued messages
        const rawText = res.lines.join(' ');
        setMessagesQueued(rawText.includes('queued') || rawText.includes('Press up to edit'));
      } catch {
        // Silently fail
      }
    };

    poll();
    const interval = setInterval(poll, pollInterval);
    return () => clearInterval(interval);
  }, [sessionId, sessionStatus, userJustSent]);

  return { prompt, terminalHint, messagesQueued, clearPrompt };
};
