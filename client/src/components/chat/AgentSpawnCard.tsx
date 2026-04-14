import { Zap, Check, CircleX } from 'lucide-react';
import { motion } from 'framer-motion';

const M = 'Montserrat, sans-serif';

interface AgentSpawnCardProps {
  description: string;
  prompt?: string;
  result?: string;
  isError?: boolean;
}

// Rich affordance for Agent spawns — worth the extra pixels because subagents
// have noticeable latency and a meaningful result payload. Chips for
// everything smaller.
export const AgentSpawnCard = ({ description, prompt, result, isError }: AgentSpawnCardProps) => {
  const status = result ? (isError ? 'error' : 'done') : 'working';

  return (
    <div
      className="flex items-start gap-2 py-1.5 px-2 my-1 rounded-md"
      style={{
        background: 'rgba(14, 124, 123, 0.06)',
        border: '1px solid rgba(14, 124, 123, 0.12)',
        fontFamily: M,
      }}
    >
      <div className="shrink-0 mt-0.5 flex items-center justify-center" style={{ width: 16, height: 16 }}>
        <Zap size={12} style={{ color: 'var(--color-accent)' }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold" style={{ color: 'var(--color-accent-light)' }}>
            Agent: {description}
          </span>
          {status === 'working' && (
            <motion.span
              className="inline-block rounded-full"
              style={{ width: 6, height: 6, background: 'var(--color-accent)' }}
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
              title="Working..."
            />
          )}
          {status === 'done' && (
            <Check size={12} style={{ color: 'var(--color-working)' }} />
          )}
          {status === 'error' && (
            <CircleX size={12} style={{ color: 'var(--color-error)' }} />
          )}
        </div>
        {prompt && (
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-text-tertiary)', maxWidth: 480 }}>
            {prompt.slice(0, 140)}{prompt.length > 140 ? '…' : ''}
          </p>
        )}
        {result && (
          <p
            className="text-xs mt-0.5"
            style={{
              color: isError ? 'var(--color-error)' : 'var(--color-text-tertiary)',
              // Two-line clamp for the preview so large result blobs don't
              // swallow the stream.
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {result.slice(0, 240)}{result.length > 240 ? '…' : ''}
          </p>
        )}
      </div>
    </div>
  );
};
