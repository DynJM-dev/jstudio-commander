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
  clearPrompt: () => void;
}

export const usePromptDetection = (
  sessionId: string | undefined,
  sessionStatus: string | undefined,
  messageCount: number,
): UsePromptDetectionReturn => {
  const [prompt, setPrompt] = useState<DetectedPrompt | null>(null);
  const prevMessageCountRef = useRef(messageCount);
  const dismissedRef = useRef(false);

  // Clear prompt when session goes idle or new messages arrive
  useEffect(() => {
    if (sessionStatus === 'idle' || sessionStatus === 'stopped') {
      setPrompt(null);
    }
  }, [sessionStatus]);

  // Clear dismissed flag when new messages arrive (allows re-detection)
  useEffect(() => {
    if (messageCount > prevMessageCountRef.current) {
      dismissedRef.current = false;
      prevMessageCountRef.current = messageCount;
    }
  }, [messageCount]);

  const clearPrompt = useCallback(() => {
    setPrompt(null);
    dismissedRef.current = true;
  }, []);

  // Poll for prompts when session is active
  useEffect(() => {
    if (!sessionId) return;
    if (sessionStatus !== 'working' && sessionStatus !== 'waiting') return;

    const poll = async () => {
      if (dismissedRef.current) return;
      try {
        const res = await api.get<OutputResponse>(
          `/sessions/${sessionId}/output?lines=15`
        );
        if (res.prompts && res.prompts.length > 0) {
          // Show the latest prompt
          setPrompt(res.prompts[res.prompts.length - 1]!);
        } else {
          setPrompt(null);
        }
      } catch {
        // Silently fail
      }
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [sessionId, sessionStatus]);

  return { prompt, clearPrompt };
};
