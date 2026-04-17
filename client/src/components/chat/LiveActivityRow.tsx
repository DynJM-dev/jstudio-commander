import { motion, AnimatePresence } from 'framer-motion';
import type { SessionActivity, SessionTick } from '@commander/shared';
import { bandColor, bandForPercentage } from '../../utils/contextBands';

const M = 'Montserrat, sans-serif';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Pure helper exposed for unit tests. Compiles the list of " · "-joined
// parts the row displays. Isolates the data-merge logic (tick vs pane
// fallback ordering) from the render so tests don't need a DOM.
export const buildLiveActivityParts = (
  activity: SessionActivity | null | undefined,
  tick: SessionTick | null,
): { parts: string[]; ctxPct: number | null } => {
  const verb = activity?.verb ?? null;
  const spinner = activity?.spinner ?? '';
  const elapsed = activity?.elapsed ?? null;
  const effort = activity?.effort ?? null;
  const tokens = tick?.contextWindow.totalInputTokens ?? activity?.tokens ?? null;
  const tokenLabel = tokens !== null ? `${tokens.toLocaleString('en-US')} tokens` : null;

  const parts: string[] = [];
  if (verb) parts.push(`${spinner ? `${spinner} ` : ''}${verb}`);
  if (elapsed) parts.push(elapsed);
  if (tokenLabel) parts.push(tokenLabel);
  if (effort) parts.push(effort);

  const ctxPct = tick?.contextWindow.usedPercentage ?? null;
  return { parts, ctxPct };
};

interface LiveActivityRowProps {
  // Existing Phase J pane-derived activity. Carries spinner glyph + verb
  // + elapsed (text form) + tokens. Always the primary source for the
  // HUMAN-READABLE verb (ticks don't carry the `✻ Ruminating…` word).
  activity: SessionActivity | null | undefined;
  // Phase M statusline tick. When present, overrides the pane's token
  // count with the authoritative `total_input_tokens` and adds a tiny
  // context-% progress bar driven by `context_window.used_percentage`.
  tick: SessionTick | null;
  // True when the session is actively working. Parent component gates
  // on this; we render inline and rely on the parent's AnimatePresence
  // for enter/exit.
  visible: boolean;
}

// Phase M Bundle 3 — live activity row rendered at the bottom of the
// chat stream while Claude is mid-turn. Combines the pane-derived verb
// with tick-derived tokens + context-%, preferring tick data when both
// are available (the tick counts system-prompt + tools + memory which
// the pane cannot).
export const LiveActivityRow = ({ activity, tick, visible }: LiveActivityRowProps) => {
  const reduced = prefersReducedMotion();

  // Delegates to the pure helper so render + tests share one impl of
  // the tick-over-pane preference for tokens + context %.
  const { parts, ctxPct } = buildLiveActivityParts(activity, tick);
  const ctxBand = bandForPercentage(ctxPct);
  const ctxBarColor = bandColor(ctxBand);
  const pctDisplay = ctxPct !== null ? Math.round(ctxPct) : null;

  return (
    <AnimatePresence>
      {visible && parts.length > 0 && (
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? undefined : { opacity: 0, y: -2 }}
          transition={{ duration: 0.18, ease: 'easeOut' as const }}
          className="flex items-center gap-2 pl-3 pr-3 py-1"
          style={{
            fontFamily: M,
            borderLeft: '2px solid color-mix(in srgb, var(--color-accent) 35%, transparent)',
          }}
        >
          <span
            className="text-xs truncate"
            style={{ color: 'var(--color-text-secondary)', maxWidth: 520 }}
          >
            {parts.join(' · ')}
          </span>

          {/* Mini context-% progress bar. Only rendered when the tick
              has delivered a real percentage. Color tracks the band so
              a glance tells the user "the live turn is burning into
              orange territory". */}
          {pctDisplay !== null && (
            <span
              className="ml-auto flex items-center gap-1.5 shrink-0"
              title={`Context ${pctDisplay}% — band ${ctxBand}`}
            >
              <span
                className="font-mono-stats text-[11px]"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                ctx {pctDisplay}%
              </span>
              <span
                className="relative overflow-hidden rounded-full"
                style={{
                  width: 32,
                  height: 3,
                  background: 'rgba(255, 255, 255, 0.08)',
                }}
              >
                <span
                  className="absolute left-0 top-0 h-full rounded-full"
                  style={{
                    width: `${Math.max(4, Math.min(100, pctDisplay))}%`,
                    background: ctxBarColor,
                    transition: 'width 220ms ease-out, background 220ms ease-out',
                  }}
                />
              </span>
            </span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
