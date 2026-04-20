import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../services/api';
// Issue 8.1 P1 — parseTerminalHint moved to src/utils/ so its pattern-
// matching contract is unit-tested in isolation. The function here
// used to scan the pane-output tail with a blob-match that would
// false-fire on reply content containing `✻` / `✶` / the word
// "thinking". The extracted version requires a line-start anchor on
// the glyph AND a live verb (`-ing`/`-ed`/`Idle`) on the same line.
import { parseTerminalHint } from '../utils/parseTerminalHint';

// Issue 15.3 Tier A Item 3 — exported pure cadence. Pre-fix the hook
// gated polling on `isActive = working|waiting|userJustSent` at line
// 68, so any spell of client-side status=idle (stop-hook race, 15.1-F
// subscription miss, cooldown-induced force-idle while an approval
// prompt was on pane) silently stopped all polling. That's the "modal
// doesn't mount until I refresh" class (v5 §11.3). Fix: always poll
// when `sessionId` is set; scale cadence so idle polling stays cheap.
//
// Cadence table:
//   userJustSent || sessionStatus === 'waiting'  → 1_000 ms
//   sessionStatus === 'working'                   → 2_000 ms
//   idle / stopped / unknown                      → 8_000 ms
//
// 8s idle cadence justified: Class A (v5 §11.0) is the "status-idle
// occlusion" class — when the client incorrectly believes the session
// is idle during an approval window, a wrong cadence is the cost of
// eventually catching up. 8s means ≤ 8s worst-case mount delay for
// the pathological case AND ≤ 1-2s in the common case once status
// flips to working/waiting and the effect re-runs at the tighter
// cadence. Range per dispatch is 5-10s; 8 is mid-range and avoids
// the perception that idle is sluggish while keeping CPU cost bounded.
export const computePromptDetectionCadence = (
  sessionStatus: string | undefined,
  userJustSent: boolean,
): number => {
  if (userJustSent || sessionStatus === 'waiting') return 1_000;
  if (sessionStatus === 'working') return 2_000;
  return 8_000;
};

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

  // Poll for prompts + terminal hints. Issue 15.3 Tier A Item 3 — no
  // `isActive` gate: the pre-fix guard silently killed polling whenever
  // the client believed the session was idle, which is exactly when a
  // force-idled-mid-approval prompt needs the poll MOST (v5 §11.3
  // Class A). Scale cadence via `computePromptDetectionCadence` so the
  // idle path stays cheap (8s) while active paths keep 1-2s tightness
  // for the ≤3s modal-mount contract.
  useEffect(() => {
    if (!sessionId) return;

    const pollInterval = computePromptDetectionCadence(sessionStatus, userJustSent);

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
