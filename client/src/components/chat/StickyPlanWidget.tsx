import { useState, useEffect, useMemo, useRef } from 'react';
import { ChevronDown, CheckCircle2, Circle, CircleDotDashed, CircleAlert, CircleX } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PlanTask } from './AgentPlan';

const M = 'Montserrat, sans-serif';

const EASE: [number, number, number, number] = [0.2, 0.65, 0.3, 0.9];

const ALL_DONE_HIDE_MS = 3000;

const STATUS_CONFIG = {
  completed: { icon: CheckCircle2, color: 'var(--color-working)' },
  in_progress: { icon: CircleDotDashed, color: 'var(--color-accent)' },
  pending: { icon: Circle, color: 'var(--color-stopped)' },
  need_help: { icon: CircleAlert, color: 'var(--color-idle)' },
  failed: { icon: CircleX, color: 'var(--color-error)' },
} as const;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface StickyPlanWidgetProps {
  plan: PlanTask[];
  planKey: string;
  allDone: boolean;
  title?: string;
}

export const StickyPlanWidget = ({ plan, planKey, allDone, title = 'Plan' }: StickyPlanWidgetProps) => {
  const [expanded, setExpanded] = useState(false);
  const [hiddenAfterDone, setHiddenAfterDone] = useState(false);
  const [inlineVisible, setInlineVisible] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Reset UI state when a new plan appears.
  useEffect(() => {
    setExpanded(false);
    setHiddenAfterDone(false);
    setInlineVisible(false);
  }, [planKey]);

  // Auto-hide 3s after all steps complete.
  useEffect(() => {
    if (!allDone) {
      setHiddenAfterDone(false);
      return;
    }
    const t = setTimeout(() => setHiddenAfterDone(true), ALL_DONE_HIDE_MS);
    return () => clearTimeout(t);
  }, [allDone, planKey]);

  // Observe the inline plan card. Sticky only surfaces when the inline card is
  // off-screen — no point duplicating what the user is already reading.
  useEffect(() => {
    observerRef.current?.disconnect();
    const target = document.querySelector<HTMLElement>(
      `[data-plan-group-key="${CSS.escape(planKey)}"]`,
    );
    if (!target) {
      setInlineVisible(false);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setInlineVisible(entry.isIntersecting);
      },
      { threshold: 0.5 },
    );
    observer.observe(target);
    observerRef.current = observer;
    return () => observer.disconnect();
  }, [planKey, plan.length]);

  const completed = useMemo(() => plan.filter((t) => t.status === 'completed').length, [plan]);
  const total = plan.length;
  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const current = useMemo(
    () => plan.find((t) => t.status === 'in_progress') ?? plan.find((t) => t.status !== 'completed'),
    [plan],
  );

  const visible = !hiddenAfterDone && !inlineVisible && total > 0;
  const reduced = prefersReducedMotion();

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          key={planKey}
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? undefined : { opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: EASE }}
          className="shrink-0 px-3 lg:px-6 pb-2"
          style={{ fontFamily: M }}
        >
          <div
            className="rounded-xl overflow-hidden"
            style={{
              background: 'rgba(14, 124, 123, 0.06)',
              border: '1px solid rgba(14, 124, 123, 0.18)',
              backdropFilter: 'blur(16px) saturate(180%)',
              WebkitBackdropFilter: 'blur(16px) saturate(180%)',
              boxShadow: '0 -6px 18px rgba(0, 0, 0, 0.22)',
            }}
          >
            {/* Collapsed header — always rendered, acts as the toggle */}
            <button
              onClick={() => setExpanded((v) => !v)}
              className="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors"
              style={{ fontFamily: M, background: 'transparent' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(14, 124, 123, 0.04)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span
                className="text-xs font-semibold shrink-0"
                style={{ color: 'var(--color-accent-light)' }}
              >
                {title}
              </span>

              <span
                className="font-mono-stats text-xs shrink-0"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                {completed}/{total}
              </span>

              <div
                className="w-14 h-1.5 rounded-full overflow-hidden shrink-0"
                style={{ background: 'rgba(255, 255, 255, 0.06)' }}
              >
                <motion.div
                  className="h-full rounded-full"
                  initial={false}
                  animate={{ width: `${progressPercent}%` }}
                  transition={{ duration: 0.4, ease: EASE }}
                  style={{
                    background: progressPercent === 100 ? 'var(--color-working)' : 'var(--color-accent)',
                  }}
                />
              </div>

              <span
                className="text-xs flex-1 min-w-0 truncate"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {allDone ? 'All steps complete' : current?.title ?? ''}
              </span>

              <motion.div
                animate={{ rotate: expanded ? 180 : 0 }}
                transition={{ duration: 0.2, ease: EASE }}
                className="shrink-0"
              >
                <ChevronDown size={14} style={{ color: 'var(--color-text-tertiary)' }} />
              </motion.div>
            </button>

            {/* Expanded list */}
            <AnimatePresence initial={false}>
              {expanded && (
                <motion.div
                  initial={reduced ? false : { height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={reduced ? undefined : { height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: EASE }}
                  className="overflow-hidden"
                  style={{ borderTop: '1px solid rgba(14, 124, 123, 0.08)' }}
                >
                  <div className="py-1 max-h-60 overflow-y-auto">
                    {plan.map((task) => {
                      const cfg = STATUS_CONFIG[task.status];
                      const Icon = cfg.icon;
                      return (
                        <div
                          key={task.id}
                          className="flex items-center gap-2 px-3 py-1.5"
                        >
                          <Icon size={14} className="shrink-0" style={{ color: cfg.color }} />
                          <span
                            className="text-sm flex-1 min-w-0 truncate"
                            style={{
                              fontFamily: M,
                              color: task.status === 'completed'
                                ? 'var(--color-text-tertiary)'
                                : 'var(--color-text-primary)',
                            }}
                          >
                            {task.title}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
