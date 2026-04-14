import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { ArrowDown, Loader2 } from 'lucide-react';
import type { ChatMessage } from '@commander/shared';
import { UserMessage } from './UserMessage';
import { AssistantMessage } from './AssistantMessage';
import { formatTime } from '../../utils/format';

const M = 'Montserrat, sans-serif';

const FIVE_MINUTES = 5 * 60 * 1000;

interface MessageGroup {
  role: 'user' | 'assistant' | 'system';
  messages: ChatMessage[];
  timestamp: string;
  model?: string;
}

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

  // Build tool_result lookup: map tool_use_id -> { content, isError }
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

  // Group consecutive messages by role
  // tool_result-only user messages are folded into the preceding assistant group
  // (they're system bookkeeping, not real user messages)
  const groups = useMemo<MessageGroup[]>(() => {
    const result: MessageGroup[] = [];

    const isToolResultOnly = (msg: ChatMessage) =>
      msg.role === 'user' &&
      msg.content.length > 0 &&
      msg.content.every((b) => b.type === 'tool_result');

    for (const msg of messages) {
      // Skip tool_result-only user messages — fold into current assistant group
      if (isToolResultOnly(msg)) {
        const last = result[result.length - 1];
        if (last && last.role === 'assistant') {
          // Add to the assistant group so tool results are available
          last.messages.push(msg);
        }
        continue;
      }

      const last = result[result.length - 1];
      if (last && last.role === msg.role && msg.role === 'assistant') {
        // Extend existing assistant group
        last.messages.push(msg);
        if (!last.model && msg.model) last.model = msg.model;
      } else {
        // New group
        result.push({
          role: msg.role as 'user' | 'assistant' | 'system',
          messages: [msg],
          timestamp: msg.timestamp,
          model: msg.model,
        });
      }
    }
    return result;
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

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-2 lg:px-4 py-4"
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

        {/* Message groups with timeline */}
        <div className="flex flex-col relative" style={{ marginLeft: 12 }}>
          {/* Continuous vertical timeline line */}
          <div
            className="absolute top-0 bottom-0"
            style={{
              left: 0,
              width: 1,
              background: 'rgba(255, 255, 255, 0.06)',
            }}
          />

          {groups.map((group, gi) => {
            const prevGroup = gi > 0 ? groups[gi - 1] : undefined;
            const isLast = gi === groups.length - 1;

            // Timestamp separator between groups
            let timestampSep = false;
            if (prevGroup) {
              const prevTime = new Date(prevGroup.timestamp).getTime();
              const currTime = new Date(group.timestamp).getTime();
              timestampSep = currTime - prevTime > FIVE_MINUTES;
            }

            // Model change separator
            let modelSep = false;
            if (group.role === 'assistant' && group.model && prevGroup) {
              let prevModel: string | undefined;
              for (let j = gi - 1; j >= 0; j--) {
                if (groups[j]?.role === 'assistant' && groups[j]?.model) {
                  prevModel = groups[j]!.model;
                  break;
                }
              }
              modelSep = !!(prevModel && prevModel !== group.model);
            }

            return (
              <div key={gi} className="relative" style={{ paddingLeft: 16 }}>
                {/* Timeline dot — one per assistant group */}
                {group.role === 'assistant' && (
                  <div
                    className={`absolute ${isLast ? 'animate-pulse' : ''}`}
                    style={{
                      left: isLast ? -4 : -3,
                      top: 16,
                      width: isLast ? 8 : 6,
                      height: isLast ? 8 : 6,
                      borderRadius: '50%',
                      background: 'var(--color-accent)',
                      boxShadow: isLast ? '0 0 8px rgba(14, 124, 123, 0.4)' : 'none',
                    }}
                  />
                )}

                {timestampSep && <TimestampSeparator timestamp={group.timestamp} />}
                {modelSep && group.model && <ModelChangeSeparator model={group.model} />}

                {/* Divider between groups */}
                {prevGroup && !timestampSep && (
                  <div
                    className="my-1"
                    style={{ borderTop: '0.5px solid rgba(255, 255, 255, 0.04)' }}
                  />
                )}

                {/* Render the group */}
                {group.role === 'user' && (
                  <UserMessage message={group.messages[0]!} />
                )}

                {group.role === 'assistant' && (
                  <AssistantMessage
                    messages={group.messages}
                    toolResults={toolResultMap}
                  />
                )}

                {group.role === 'system' && (
                  <div className="flex justify-center py-2">
                    <span
                      className="text-xs px-3 py-1 rounded-full"
                      style={{
                        fontFamily: M,
                        background: 'rgba(255, 255, 255, 0.04)',
                        color: 'var(--color-text-tertiary)',
                        border: '1px solid rgba(255, 255, 255, 0.04)',
                      }}
                    >
                      {group.messages[0]?.content[0]?.type === 'system_note'
                        ? group.messages[0].content[0].text
                        : 'System event'}
                    </span>
                  </div>
                )}
              </div>
            );
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
