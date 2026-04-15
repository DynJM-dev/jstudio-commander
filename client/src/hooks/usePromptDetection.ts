import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../services/api';

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

const parseTerminalHint = (lines: string[]): string | null => {
  const tail = lines.slice(-10).map((l) => l.trim()).filter(Boolean);
  const joined = tail.join(' ');

  // Compaction
  if (/[Cc]ompacting|[Ss]ummariz/i.test(joined)) {
    return 'Compacting context...';
  }

  // Explore/Agent subagents
  if (/Explore\s*\(/i.test(joined) || /Explore\s+\w+/i.test(joined)) {
    const desc = joined.match(/Explore\s+([^·]+)/i)?.[1]?.trim();
    return desc ? `Exploring: ${desc.slice(0, 50)}...` : 'Exploring codebase...';
  }
  if (/Agent\s*\(/i.test(joined) || /Running\s+\d+\s+.*agent/i.test(joined)) {
    return 'Running subagent...';
  }
  if (/Skill\s*\(/i.test(joined)) {
    return 'Loading skill...';
  }

  // Tool chain count
  const toolCountMatch = joined.match(/\+(\d+)\s+more\s+tool/i);
  if (toolCountMatch) {
    return `Running ${toolCountMatch[1]}+ tools...`;
  }

  // Extended thinking with duration
  const thinkMatch = joined.match(/(Hullaballoo|Cogitat|Herding|Pondering|Spinning|Mulling|Brewed|Crunched|Nesting)\w*[….]* *\((\dm?\s*\d+s|\d+s)/i);
  if (thinkMatch) {
    return `Thinking deeply... (${thinkMatch[2]})`;
  }

  // Thinking/reasoning (no duration)
  if (/✻|✶|Thinking|Cogitat|Hullaballoo|Herding|Pondering|Mulling|Spinning/i.test(joined)) {
    return 'Thinking deeply...';
  }

  // Nesting (subagent work)
  if (/Nesting/i.test(joined)) {
    const nestMatch = joined.match(/Nesting[….]* *\(([^)]+)\)/i);
    return nestMatch ? `Nesting... (${nestMatch[1]})` : 'Nesting...';
  }

  // Specific tool calls
  if (/Bash\s*\(/i.test(joined)) return 'Running command...';
  if (/Read\s*\(/i.test(joined)) {
    const file = joined.match(/Read\s*\(\s*([^)]+)\)/i)?.[1]?.split('/').pop();
    return file ? `Reading ${file}...` : 'Reading file...';
  }
  if (/Edit\s*\(/i.test(joined)) {
    const file = joined.match(/Edit\s*\(\s*([^)]+)\)/i)?.[1]?.split('/').pop();
    return file ? `Editing ${file}...` : 'Editing file...';
  }
  if (/Write\s*\(/i.test(joined)) {
    const file = joined.match(/Write\s*\(\s*([^)]+)\)/i)?.[1]?.split('/').pop();
    return file ? `Writing ${file}...` : 'Writing file...';
  }
  if (/Grep\s*\(|Glob\s*\(/i.test(joined)) return 'Searching codebase...';

  // Generic reading/listing/searching/editing/writing
  if (/Reading|Listing/i.test(joined)) return 'Reading files...';
  if (/Searching/i.test(joined)) return 'Searching...';
  if (/Editing/i.test(joined)) return 'Editing...';
  if (/Writing/i.test(joined)) return 'Writing...';

  // Generic working indicators
  if (/esc to interrupt|ctrl\+b/i.test(joined)) return 'Working...';

  return null;
};

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
