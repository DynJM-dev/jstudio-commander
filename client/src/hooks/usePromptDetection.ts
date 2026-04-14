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
  clearPrompt: () => void;
}

const parseTerminalHint = (lines: string[]): string | null => {
  // Look at the last few lines for action clues
  const tail = lines.slice(-8).map((l) => l.trim()).filter(Boolean);
  const joined = tail.join(' ');

  // Thinking/reasoning
  if (joined.includes('Thinking') || joined.includes('Cogitating') || joined.includes('✻')) {
    return 'Cogitating...';
  }
  // Nesting/sub-agents
  if (joined.includes('Nesting') || joined.includes('Running') && joined.includes('agent')) {
    return 'Delegating to agent...';
  }
  // Bash/command
  if (joined.includes('$ ') && (joined.includes('Bash') || joined.includes('command'))) {
    return 'Running command...';
  }
  // Reading files
  if (joined.includes('Reading') || joined.includes('Listing')) {
    return 'Reading files...';
  }
  // Searching
  if (joined.includes('Searching') || joined.includes('Grep') || joined.includes('Glob')) {
    return 'Searching...';
  }
  // Editing/writing
  if (joined.includes('Editing') || joined.includes('Writing')) {
    return 'Writing code...';
  }
  // Generic working
  if (joined.includes('esc to interrupt') || joined.includes('ctrl+b')) {
    return 'Working...';
  }

  return null;
};

export const usePromptDetection = (
  sessionId: string | undefined,
  sessionStatus: string | undefined,
  messageCount: number,
): UsePromptDetectionReturn => {
  const [prompt, setPrompt] = useState<DetectedPrompt | null>(null);
  const [terminalHint, setTerminalHint] = useState<string | null>(null);
  const prevMessageCountRef = useRef(messageCount);
  const dismissedUntilRef = useRef(0);

  // Clear prompt when session goes idle or new messages arrive
  useEffect(() => {
    if (sessionStatus === 'idle' || sessionStatus === 'stopped') {
      setPrompt(null);
      setTerminalHint(null);
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

  // Poll for prompts + terminal hints when session is active
  useEffect(() => {
    if (!sessionId) return;
    if (sessionStatus !== 'working' && sessionStatus !== 'waiting') return;

    const poll = async () => {
      try {
        const res = await api.get<OutputResponse>(
          `/sessions/${sessionId}/output?lines=15`
        );

        // Prompts — only show if not within dismiss debounce window
        const isDismissed = Date.now() < dismissedUntilRef.current;
        if (!isDismissed && res.prompts && res.prompts.length > 0) {
          setPrompt(res.prompts[res.prompts.length - 1]!);
        } else if (isDismissed || !res.prompts || res.prompts.length === 0) {
          setPrompt(null);
        }

        // Terminal hint for ContextBar action status
        const hint = parseTerminalHint(res.lines);
        setTerminalHint(hint);
      } catch {
        // Silently fail
      }
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [sessionId, sessionStatus]);

  return { prompt, terminalHint, clearPrompt };
};
