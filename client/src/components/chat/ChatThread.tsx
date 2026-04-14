import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { ArrowDown, Loader2 } from 'lucide-react';
import type { ChatMessage } from '@commander/shared';
import { UserMessage } from './UserMessage';
import { AssistantMessage } from './AssistantMessage';
import { formatTime } from '../../utils/format';

const M = 'Montserrat, sans-serif';

const FIVE_MINUTES = 5 * 60 * 1000;

const ModelChangeSeparator = ({ model }: { model: string }) => (
  <div className="flex items-center gap-3 py-1.5">
    <div className="flex-1" style={{ borderTop: '1px solid rgba(14, 124, 123, 0.15)' }} />
    <span
      className="text-xs px-2.5 py-0.5 rounded-full shrink-0"
      style={{
        color: 'var(--color-accent-light)',
        background: 'rgba(14, 124, 123, 0.08)',
        fontFamily: M,
      }}
    >
      switched to {model.replace('claude-', '')}
    </span>
    <div className="flex-1" style={{ borderTop: '1px solid rgba(14, 124, 123, 0.15)' }} />
  </div>
);

const TimestampSeparator = ({ timestamp }: { timestamp: string }) => (
  <div className="flex items-center gap-3 py-2">
    <div className="flex-1" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }} />
    <span
      className="text-xs shrink-0"
      style={{ color: 'var(--color-text-tertiary)', fontFamily: M }}
    >
      {formatTime(timestamp)}
    </span>
    <div className="flex-1" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }} />
  </div>
);

interface ChatThreadProps {
  messages: ChatMessage[];
  hasMore: boolean;
  onLoadMore: () => Promise<void>;
}

export const ChatThread = ({ messages, hasMore, onLoadMore }: ChatThreadProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showNewMessages, setShowNewMessages] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const prevLengthRef = useRef(messages.length);

  // Build tool_result lookup: map tool_use_id → { content, isError }
  const toolResultMap = useMemo(() => {
    const map = new Map<string, { content: string; isError?: boolean }>();
    for (const msg of messages) {
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          map.set(block.toolUseId, {
            content: block.content,
            isError: block.isError,
          });
        }
      }
    }
    return map;
  }, [messages]);

  // Track scroll position
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    setIsAtBottom(atBottom);
    if (atBottom) setShowNewMessages(false);
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    if (messages.length > prevLengthRef.current) {
      if (isAtBottom) {
        requestAnimationFrame(() => {
          scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
        });
      } else {
        setShowNewMessages(true);
      }
    }
    prevLengthRef.current = messages.length;
  }, [messages.length, isAtBottom]);

  // Initial scroll to bottom
  useEffect(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    setShowNewMessages(false);
  }, []);

  const handleLoadMore = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    const el = scrollRef.current;
    const prevScrollHeight = el?.scrollHeight ?? 0;

    await onLoadMore();

    requestAnimationFrame(() => {
      if (el) {
        const newScrollHeight = el.scrollHeight;
        el.scrollTop = newScrollHeight - prevScrollHeight;
      }
    });
    setLoadingMore(false);
  }, [loadingMore, onLoadMore]);

  const renderMessage = (message: ChatMessage) => {
    if (message.role === 'user') {
      return <UserMessage key={message.id} message={message} />;
    }

    if (message.role === 'assistant') {
      return (
        <AssistantMessage
          key={message.id}
          message={message}
          toolResults={toolResultMap}
        />
      );
    }

    // System messages
    if (message.role === 'system') {
      const text = message.content[0]?.type === 'system_note'
        ? message.content[0].text
        : 'System event';

      return (
        <div
          key={message.id}
          className="flex justify-center py-2"
        >
          <span
            className="text-xs px-3 py-1 rounded-full"
            style={{
              fontFamily: M,
              background: 'rgba(255, 255, 255, 0.04)',
              color: 'var(--color-text-tertiary)',
              border: '1px solid rgba(255, 255, 255, 0.04)',
            }}
          >
            {text}
          </span>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-4 lg:px-6 py-4"
      >
        {/* Load more */}
        {hasMore && (
          <div className="flex justify-center mb-4">
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors"
              style={{
                fontFamily: M,
                background: 'rgba(255, 255, 255, 0.04)',
                color: 'var(--color-text-secondary)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'; }}
            >
              {loadingMore && <Loader2 size={14} className="animate-spin" />}
              {loadingMore ? 'Loading...' : 'Load older messages'}
            </button>
          </div>
        )}

        {/* Messages with turn separators */}
        <div className="flex flex-col">
          {messages.map((message, index) => {
            const elements: React.ReactNode[] = [];
            const prevMsg = index > 0 ? messages[index - 1] : undefined;

            // Add timestamp separator for 5min+ gaps
            if (prevMsg) {
              const prevTime = new Date(prevMsg.timestamp).getTime();
              const currTime = new Date(message.timestamp).getTime();
              if (currTime - prevTime > FIVE_MINUTES) {
                elements.push(
                  <TimestampSeparator key={`sep-${message.id}`} timestamp={message.timestamp} />
                );
              }
            }

            // Add model-change separator
            if (message.model && prevMsg) {
              let prevModel: string | undefined;
              for (let j = index - 1; j >= 0; j--) {
                const m = messages[j];
                if (m && m.role === 'assistant' && m.model) {
                  prevModel = m.model;
                  break;
                }
              }
              if (prevModel && prevModel !== message.model) {
                elements.push(
                  <ModelChangeSeparator key={`model-${message.id}`} model={message.model} />
                );
              }
            }

            // Turn separator between different roles (not first message)
            if (prevMsg && prevMsg.role !== message.role && message.role !== 'system') {
              elements.push(
                <div key={`turn-${message.id}`} className="turn-separator" />
              );
            }

            elements.push(renderMessage(message));
            return elements;
          })}
        </div>
      </div>

      {/* New messages pill */}
      {showNewMessages && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium shadow-lg transition-transform hover:scale-105"
          style={{
            fontFamily: M,
            background: 'var(--color-accent)',
            color: '#fff',
          }}
        >
          <ArrowDown size={14} />
          New messages
        </button>
      )}
    </div>
  );
};
