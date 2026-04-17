import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { ArrowDown, Loader2, Sparkles, Brain, Zap, BookOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ChatMessage, SessionActivity, SessionTick } from '@commander/shared';
import { UserMessage } from './UserMessage';
import { AssistantMessage } from './AssistantMessage';
import { TaskNotificationCard } from './TaskNotificationCard';
import { TeammateMessageCard } from './TeammateMessageCard';
import {
  ShutdownRequestCard,
  ShutdownResponseCard,
  PlanApprovalRequestCard,
  PlanApprovalResponseCard,
} from './ProtocolMessageCards';
import { SystemEventChip } from './SystemEventChip';
import { UnrecognizedProtocolCard } from './UnrecognizedProtocolCard';
import { LiveActivityRow } from './LiveActivityRow';
import { formatTime, formatTokens } from '../../utils/format';
import { parseChatMessage, type ParsedChatMessage } from '../../utils/chatMessageParser';
import {
  collapseConsecutiveIdles,
  isSystemEventFragment,
  useSystemEventsMode,
  type SystemEventsMode,
  type CollapsedChatMessage,
} from '../../utils/systemEvents';
import {
  buildToolResultMap,
  getActivePlan,
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

  // Compact boundary — dedicated banner with trigger + freed-token count
  if (firstBlock?.type === 'compact_boundary') {
    const { trigger, preTokens } = firstBlock;
    return (
      <div className="flex items-center gap-3 py-2">
        <div className="flex-1" style={{ borderTop: '1px solid rgba(14, 124, 123, 0.18)' }} />
        <span
          className="text-xs px-2.5 py-0.5 rounded-full shrink-0"
          style={{
            fontFamily: M,
            color: 'var(--color-accent-light)',
            background: 'rgba(14, 124, 123, 0.08)',
            border: '1px solid rgba(14, 124, 123, 0.15)',
          }}
        >
          Compacted ({trigger}) — freed {formatTokens(preTokens)} tokens
        </span>
        <div className="flex-1" style={{ borderTop: '1px solid rgba(14, 124, 123, 0.18)' }} />
      </div>
    );
  }

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

const LIVE_THINKING_CHARS = 280;
const LIVE_COMPOSING_CHARS = 320;

// Claude Code threads structured payloads (<task-notification>,
// <teammate-message>, raw JSON protocol) through the user role. Phase K
// scan now returns a full ordered fragment list so a single user message
// can surface multiple cards + prose segments in the order they were
// injected. Empty array → fall through to plain UserMessage rendering.
const detectFragments = (msg: ChatMessage): ParsedChatMessage[] => {
  const textBlocks = msg.content.filter((b) => b.type === 'text');
  if (textBlocks.length !== 1) return [];
  const first = textBlocks[0];
  if (first?.type !== 'text') return [];
  return parseChatMessage(first.text);
};

const ProseFragment = ({ text }: { text: string }) => (
  <div
    className="text-sm leading-relaxed whitespace-pre-wrap px-3 py-1.5"
    style={{
      fontFamily: M,
      color: 'var(--color-text-secondary)',
      opacity: 0.9,
    }}
  >
    {text}
  </div>
);

// Render a single fragment into its corresponding card/chip. Noise kinds
// (idle/terminated/approved) honor the caller-provided visibility mode;
// returning null means "drop this fragment".
const renderFragment = (
  frag: CollapsedChatMessage,
  key: string,
  mode: SystemEventsMode,
): React.ReactNode => {
  switch (frag.kind) {
    case 'prose':
      return <ProseFragment key={key} text={frag.text} />;
    case 'task-notification':
      return <TaskNotificationCard key={key} notification={frag.notification} />;
    case 'teammate-message':
      return <TeammateMessageCard key={key} message={frag.teammate} />;
    case 'shutdown-request':
      return <ShutdownRequestCard key={key} request={frag.request} />;
    case 'shutdown-response':
      return <ShutdownResponseCard key={key} response={frag.response} />;
    case 'plan-approval-request':
      return <PlanApprovalRequestCard key={key} request={frag.request} />;
    case 'plan-approval-response':
      return <PlanApprovalResponseCard key={key} response={frag.response} />;
    case 'idle-notification': {
      if (mode === 'hide') return null;
      return (
        <SystemEventChip
          key={key}
          kind="idle"
          from={frag.notification.from}
          count={frag.count}
          color={frag.context?.color}
          timestamp={frag.notification.timestamp ?? null}
          extra={frag.notification.idleReason ? frag.notification.idleReason : null}
          variant={mode === 'cards' ? 'card' : 'chip'}
        />
      );
    }
    case 'teammate-terminated': {
      if (mode === 'hide') return null;
      return (
        <SystemEventChip
          key={key}
          kind="terminated"
          from={frag.notification.from}
          color={frag.context?.color}
          timestamp={frag.notification.timestamp ?? null}
          variant={mode === 'cards' ? 'card' : 'chip'}
        />
      );
    }
    case 'shutdown-approved': {
      if (mode === 'hide') return null;
      return (
        <SystemEventChip
          key={key}
          kind="approved"
          from={frag.notification.from}
          color={frag.context?.color}
          timestamp={frag.notification.timestamp ?? null}
          extra={frag.notification.requestId ? `#${frag.notification.requestId.slice(0, 8)}` : null}
          variant={mode === 'cards' ? 'card' : 'chip'}
        />
      );
    }
    case 'unrecognized-protocol':
      return (
        <UnrecognizedProtocolCard
          key={key}
          protocolType={frag.protocolType}
          raw={frag.raw}
          context={frag.context}
          senderOverride={frag.senderOverride}
        />
      );
    default:
      return null;
  }
};

const renderUserFragments = (
  fragments: ParsedChatMessage[],
  mode: SystemEventsMode,
  groupIndex: number,
): React.ReactNode => {
  const visible = mode === 'hide' ? fragments.filter((f) => !isSystemEventFragment(f)) : fragments;
  const collapsed = collapseConsecutiveIdles(visible);
  return (
    <div className="flex flex-col gap-1.5">
      {collapsed.map((frag, idx) => renderFragment(frag, `g${groupIndex}-f${idx}`, mode))}
    </div>
  );
};

interface ChatThreadProps {
  messages: ChatMessage[];
  hasMore: boolean;
  onLoadMore: () => Promise<void>;
  isWorking?: boolean;
  actionLabel?: string | null;
  // Latest in-flight thinking text from the currently-generating assistant
  // message. Shown as a live italic preview under the working indicator.
  liveThinking?: string | null;
  // Latest streaming prose/code text. Shown as a rolling tail preview so
  // the user sees progress during 'Composing response...' windows. Takes
  // precedence over liveThinking when both are present.
  liveComposing?: string | null;
  // Currently-executing tool that's worth surfacing (skill load, agent
  // spawn, memory read). Shown as a prominent chip in the working indicator.
  liveActivity?: { kind: 'skill' | 'agent' | 'memory'; target: string } | null;
  // Drives the shimmer bar's color + speed: 'thinking' = calm accent,
  // 'tooling' = fast accent-light, 'waiting' = paused idle-yellow glow.
  shimmerState?: 'thinking' | 'tooling' | 'waiting';
  // Phase M — live session data used by LiveActivityRow. `activity` is
  // the Phase J pane-derived verb/spinner/elapsed; `tick` is the Phase M
  // statusline-derived tokens + context %. Either can be absent.
  sessionActivity?: SessionActivity | null;
  sessionTick?: SessionTick | null;
}

export const ChatThread = ({
  messages,
  hasMore,
  onLoadMore,
  isWorking = false,
  actionLabel,
  liveThinking,
  liveComposing,
  liveActivity,
  shimmerState = 'thinking',
  sessionActivity,
  sessionTick,
}: ChatThreadProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showNewMessages, setShowNewMessages] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const prevLengthRef = useRef(messages.length);

  const toolResultMap = useMemo(() => buildToolResultMap(messages), [messages]);
  const groups = useMemo<MessageGroup[]>(() => groupMessages(messages), [messages]);
  const systemEventsMode = useSystemEventsMode();
  // Single session-wide plan — shared by inline AgentPlan and StickyPlanWidget
  // so they can never disagree. The plan's anchor message id tells us which
  // assistant group hosts the inline card.
  const activePlan = useMemo(() => getActivePlan(messages), [messages]);

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

  // Follow streaming growth: when the messages reference changes but the
  // count didn't (Claude wrote more into an existing assistant message),
  // keep the viewport pinned to the bottom if the user was already there.
  // Fires on every useChat update so in-place block growth actually pushes
  // the scroll position with the content instead of letting it fall below.
  useEffect(() => {
    if (!isAtBottom) return;
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 300;
    if (near) el.scrollTop = el.scrollHeight;
  }, [messages, isAtBottom]);

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

            // Render the inline plan card only on the group that contains the
            // plan's anchor message (the one with the first TaskCreate). Other
            // groups — including those holding only TaskUpdates — render no plan.
            const anchorInGroup =
              activePlan !== null &&
              group.role === 'assistant' &&
              group.messages.some((m) => m.id === activePlan.key);
            const inlinePlan = anchorInGroup ? activePlan!.plan : [];
            const inlinePlanKey = anchorInGroup ? activePlan!.key : undefined;

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
                {group.role === 'user' && (() => {
                  const msg = group.messages[0]!;
                  const fragments = detectFragments(msg);
                  if (fragments.length === 0) return <UserMessage message={msg} />;
                  return renderUserFragments(fragments, systemEventsMode, gi);
                })()}

                {group.role === 'assistant' && (
                  <AssistantMessage
                    messages={group.messages}
                    toolResults={toolResultMap}
                    plan={inlinePlan}
                    planKey={inlinePlanKey}
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
                  {/* Live in-flight tool indicator — surfaces skill loads,
                      agent spawns, and memory reads WHILE they happen, not
                      only once the tool_result lands. */}
                  {liveActivity && (() => {
                    const cfgByKind = {
                      skill:  { icon: Brain,    label: 'Loading skill',   color: '#7DD3FC' },
                      agent:  { icon: Zap,      label: 'Spawning agent',  color: 'var(--color-accent-light)' },
                      memory: { icon: BookOpen, label: 'Reading memory',  color: 'var(--color-idle)' },
                    } as const;
                    const cfg = cfgByKind[liveActivity.kind];
                    const ActivityIcon = cfg.icon;
                    return (
                      <motion.div
                        key={`${liveActivity.kind}:${liveActivity.target}`}
                        initial={{ opacity: 0, x: -4 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.18 }}
                        className="flex items-center gap-1.5 mt-1"
                        style={{ fontFamily: M }}
                      >
                        <ActivityIcon size={13} style={{ color: cfg.color }} />
                        <span className="text-xs font-medium" style={{ color: cfg.color }}>
                          {cfg.label}
                        </span>
                        <span className="text-xs truncate" style={{ color: 'var(--color-text-secondary)', maxWidth: 360 }}>
                          {liveActivity.target}
                        </span>
                      </motion.div>
                    );
                  })()}

                  {/* Phase M — tick + pane-derived live activity row.
                      Shows verb/elapsed/tokens/effort + a tiny context-%
                      bar that colors by band. Hidden when neither tick
                      nor activity has content to surface. */}
                  <LiveActivityRow
                    activity={sessionActivity}
                    tick={sessionTick ?? null}
                    visible={isWorking}
                  />

                  <div
                    className={`thinking-shimmer h-1 rounded-full mt-1 ${shimmerState === 'tooling' ? 'tooling' : shimmerState === 'waiting' ? 'waiting' : ''}`}
                    style={{ maxWidth: 220 }}
                  />

                  {/* Live composing preview — streaming prose/code the user
                      is waiting on. Takes precedence over liveThinking since
                      composing supersedes thinking in the turn lifecycle. */}
                  <AnimatePresence mode="wait">
                    {liveComposing && (
                      <motion.div
                        key={`c:${liveComposing.slice(0, 40)}`}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18, ease: 'easeOut' as const }}
                        className="mt-2 text-xs leading-relaxed pl-2 py-1 pr-2 max-h-20 overflow-hidden"
                        style={{
                          borderLeft: '2px solid color-mix(in srgb, var(--color-accent) 55%, transparent)',
                          color: 'var(--color-text-secondary)',
                          maxWidth: 560,
                          display: '-webkit-box',
                          WebkitLineClamp: 4,
                          WebkitBoxOrient: 'vertical',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {liveComposing.length > LIVE_COMPOSING_CHARS
                          ? `…${liveComposing.slice(-LIVE_COMPOSING_CHARS)}`
                          : liveComposing}
                      </motion.div>
                    )}
                    {!liveComposing && liveThinking && liveThinking !== actionLabel && (
                      <motion.div
                        key={`t:${liveThinking.slice(0, 40)}`}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18, ease: 'easeOut' as const }}
                        className="mt-2 text-xs italic leading-relaxed pl-2 py-1 pr-2 max-h-20 overflow-hidden"
                        style={{
                          borderLeft: '2px solid color-mix(in srgb, var(--color-accent) 35%, transparent)',
                          color: 'var(--color-text-tertiary)',
                          maxWidth: 560,
                          display: '-webkit-box',
                          WebkitLineClamp: 4,
                          WebkitBoxOrient: 'vertical',
                        }}
                      >
                        {liveThinking.length > LIVE_THINKING_CHARS
                          ? `…${liveThinking.slice(-LIVE_THINKING_CHARS)}`
                          : liveThinking}
                      </motion.div>
                    )}
                  </AnimatePresence>
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
