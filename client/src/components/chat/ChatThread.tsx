import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { ArrowDown, Loader2, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ChatMessage } from '@commander/shared';
import { UserMessage } from './UserMessage';
import { AssistantMessage } from './AssistantMessage';
import { formatTime } from '../../utils/format';
import {
  buildPlanFromAssistantGroup,
  buildToolResultMap,
  groupMessages,
  type MessageGroup,
} from '../../utils/plans';

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

const SystemNote = ({ group }: { group: MessageGroup }) => {
  const firstBlock = group.messages[0]?.content[0];
  const text = firstBlock?.type === 'system_note'
    ? firstBlock.text
    : firstBlock?.type === 'text' && /interrupt/i.test(firstBlock.text)
      ? 'Interrupted'
      : 'System event';

  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="flex-1" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.04)' }} />
      <span
        className="text-xs shrink-0"
        style={{ fontFamily: M, color: 'var(--color-text-tertiary)' }}
      >
        {text}
      </span>
      <div className="flex-1" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.04)' }} />
    </div>
  );
};

interface ChatThreadProps {
  messages: ChatMessage[];
  hasMore: boolean;
  onLoadMore: () => Promise<void>;
  isWorking?: boolean;
  actionLabel?: string | null;
}

export const ChatThread = ({ messages, hasMore, onLoadMore, isWorking = false, actionLabel }: ChatThreadProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showNewMessages, setShowNewMessages] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const prevLengthRef = useRef(messages.length);

  const toolResultMap = useMemo(() => buildToolResultMap(messages), [messages]);
  const groups = useMemo<MessageGroup[]>(() => groupMessages(messages), [messages]);

  // Track scroll position
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    setIsAtBottom(atBottom);
    if (atBottom) setShowNewMessages(false);
  }, []);

  // Auto-scroll when working indicator appears
  useEffect(() => {
    if (isWorking && isAtBottom) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      });
    }
  }, [isWorking, isAtBottom]);

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

            // For assistant groups: build the plan from this group's tool calls
            const assistantPlan = group.role === 'assistant'
              ? buildPlanFromAssistantGroup(group, toolResultMap)
              : [];

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
                    plan={assistantPlan}
                    planKey={group.key}
                  />
                )}

                {group.role === 'system' && (
                  <SystemNote group={group} />
                )}
              </div>
            );
          })}

          {/* Live activity indicator — Claude is working */}
          <AnimatePresence>
            {isWorking && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: 'easeOut' as const }}
                className="relative pt-2 pb-4"
                style={{ paddingLeft: 16 }}
              >
                {/* Timeline dot — pulsing */}
                <div
                  className="absolute animate-pulse"
                  style={{
                    left: -4,
                    top: 24,
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: 'var(--color-accent)',
                    boxShadow: '0 0 8px rgba(14, 124, 123, 0.4)',
                  }}
                />
                <div className="px-3" style={{ fontFamily: M }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Sparkles size={14} style={{ color: 'var(--color-accent)' }} />
                    <span
                      className="text-xs font-semibold leading-none"
                      style={{ color: 'var(--color-accent-light)' }}
                    >
                      Claude
                    </span>
                  </div>
                  <div className="flex items-center gap-2 py-1">
                    <div
                      className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0"
                      style={{ background: 'var(--color-accent)' }}
                    />
                    <span
                      className="text-sm"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      {actionLabel || 'Thinking...'}
                    </span>
                  </div>
                  <div
                    className="thinking-shimmer h-0.5 rounded-full mt-1"
                    style={{ maxWidth: 180 }}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
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
