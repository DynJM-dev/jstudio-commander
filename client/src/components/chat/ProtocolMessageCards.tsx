import { PowerOff, CheckCircle2, XCircle, ClipboardCheck } from 'lucide-react';
import { motion } from 'framer-motion';
import type {
  ShutdownRequest,
  ShutdownResponse,
  PlanApprovalRequest,
  PlanApprovalResponse,
} from '../../utils/chatMessageParser';
import { renderTextContent } from '../../utils/text-renderer';

const M = 'Montserrat, sans-serif';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Shared wrapper — every card uses the same left-border-accent + tight
// padding pattern established by TaskNotificationCard / TeammateMessageCard
// in Phase F. Keeps the chat-message cards visually related so a reader
// can tell "this is a structured card" at a glance vs inline user prose.
interface CardShellProps {
  borderColor: string;
  tintBg?: string;
  icon: React.ReactNode;
  title: string;
  subtitle?: string | null;
  children?: React.ReactNode;
  timestamp?: string | null;
}

const CardShell = ({ borderColor, tintBg, icon, title, subtitle, children, timestamp }: CardShellProps) => {
  const reduced = prefersReducedMotion();
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' as const }}
    >
      <div
        className="w-full py-2.5 px-4"
        style={{
          fontFamily: M,
          background: tintBg ?? 'rgba(255, 255, 255, 0.02)',
          borderLeft: `3px solid ${borderColor}`,
          borderRadius: 8,
        }}
      >
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="shrink-0" style={{ color: borderColor }}>{icon}</span>
          <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {title}
          </span>
          {subtitle && (
            <span
              className="text-xs italic truncate"
              style={{ color: 'var(--color-text-tertiary)', maxWidth: 420 }}
              title={subtitle}
            >
              {subtitle}
            </span>
          )}
          {timestamp && (
            <span
              className="ml-auto text-[11px] shrink-0 font-mono-stats"
              style={{ color: 'var(--color-text-tertiary)' }}
              title={timestamp}
            >
              {new Date(timestamp).toLocaleTimeString()}
            </span>
          )}
        </div>
        {children && (
          <div
            className="text-sm leading-relaxed"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {children}
          </div>
        )}
      </div>
    </motion.div>
  );
};

// ============================================================================
// Shutdown request — informational. Team-lead or a teammate asked for a
// stand-down. No action buttons; the response card (below) records whether
// the recipient accepted.
// ============================================================================
interface ShutdownRequestCardProps { request: ShutdownRequest }
export const ShutdownRequestCard = ({ request }: ShutdownRequestCardProps) => (
  <CardShell
    borderColor="#F59E0B"
    tintBg="rgba(245, 158, 11, 0.05)"
    icon={<PowerOff size={13} />}
    title={`Shutdown requested${request.from ? ` by ${request.from}` : ''}`}
    subtitle={request.requestId ? `#${request.requestId.slice(0, 8)}` : null}
    timestamp={request.timestamp ?? null}
  >
    {request.reason && <p>{renderTextContent(request.reason)}</p>}
  </CardShell>
);

// ============================================================================
// Shutdown response — teal if approved, rose if rejected. The reason is
// optional (rejects usually include one; approvals often don't).
// ============================================================================
interface ShutdownResponseCardProps { response: ShutdownResponse }
export const ShutdownResponseCard = ({ response }: ShutdownResponseCardProps) => {
  const approved = response.approve;
  return (
    <CardShell
      borderColor={approved ? 'var(--color-accent-light)' : '#F43F5E'}
      tintBg={approved ? 'rgba(20, 184, 166, 0.05)' : 'rgba(244, 63, 94, 0.05)'}
      icon={approved ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
      title={`Shutdown ${approved ? 'approved' : 'rejected'}${response.from ? ` by ${response.from}` : ''}`}
      subtitle={response.requestId ? `#${response.requestId.slice(0, 8)}` : null}
    >
      {response.reason && <p>{renderTextContent(response.reason)}</p>}
    </CardShell>
  );
};

// ============================================================================
// Plan-approval request — blue clipboard. The plan text (when included) is
// rendered verbatim via the markdown renderer, so code fences + bullet lists
// look right. No collapse UI — we let the prose be as long as it needs to
// be; the transcript is the source of truth.
// ============================================================================
interface PlanApprovalRequestCardProps { request: PlanApprovalRequest }
export const PlanApprovalRequestCard = ({ request }: PlanApprovalRequestCardProps) => (
  <CardShell
    borderColor="#60A5FA"
    tintBg="rgba(96, 165, 250, 0.05)"
    icon={<ClipboardCheck size={13} />}
    title={`Plan approval requested${request.from ? ` by ${request.from}` : ''}`}
    subtitle={request.requestId ? `#${request.requestId.slice(0, 8)}` : null}
    timestamp={request.timestamp ?? null}
  >
    {request.plan && <div>{renderTextContent(request.plan)}</div>}
  </CardShell>
);

// ============================================================================
// Plan-approval response — teal / rose per approve; feedback text rendered
// if present. This is the form a reviewer uses to send "looks good" or
// "change these three things" back up the chain.
// ============================================================================
interface PlanApprovalResponseCardProps { response: PlanApprovalResponse }
export const PlanApprovalResponseCard = ({ response }: PlanApprovalResponseCardProps) => {
  const approved = response.approve;
  return (
    <CardShell
      borderColor={approved ? 'var(--color-accent-light)' : '#F43F5E'}
      tintBg={approved ? 'rgba(20, 184, 166, 0.05)' : 'rgba(244, 63, 94, 0.05)'}
      icon={approved ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
      title={`Plan ${approved ? 'approved' : 'rejected'}${response.from ? ` by ${response.from}` : ''}`}
      subtitle={response.requestId ? `#${response.requestId.slice(0, 8)}` : null}
    >
      {response.feedback && <div>{renderTextContent(response.feedback)}</div>}
    </CardShell>
  );
};
