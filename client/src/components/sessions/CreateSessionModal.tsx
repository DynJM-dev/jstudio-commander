import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Users, Terminal, Code } from 'lucide-react';
import type { Project, SessionType } from '@commander/shared';
import { MODEL_PRICING, DEFAULT_MODEL, normalizeModelId, getContextLimit } from '@commander/shared';
import { api } from '../../services/api';
import { getProjectsCache, setProjectsCache } from '../../services/projectsCache';
import { useModalA11y } from '../../hooks/useModalA11y';

const M = 'Montserrat, sans-serif';

// Pull pricing from the shared MODEL_PRICING constant so changes there
// flow through the picker automatically.
//
// Issue 16.1.1 — `priceDetail` now resolves context via `getContextLimit`
// (which handles the `[1m]` suffix branch) and keys pricing via
// `normalizeModelId` (which strips the suffix). Pre-fix the helper did
// a raw `MODEL_CONTEXT_LIMITS[modelId]` lookup that returned undefined
// for `[1m]` variants — prior to Issue 16.1's table correction this was
// masked because the base-ID entries were 1_000_000 AND every `[1m]`
// MODEL_OPTIONS row passed the BASE id to priceDetail (not its own
// `[1m]` id). Post-16.1 the base IDs correctly return 200K so the two
// drift points surfaced together as the modal showing "200K ctx" for
// every `[1m]` variant. Fixing both in one commit: priceDetail uses
// the getContextLimit SSOT, MODEL_OPTIONS passes its own `value` so
// the suffix reaches the helper.
export const priceDetail = (modelId: string): string => {
  const p = MODEL_PRICING[normalizeModelId(modelId)];
  const ctx = getContextLimit(modelId);
  const ctxLabel = ctx === 1_000_000 ? '1M' : ctx === 200_000 ? '200K' : `${Math.round(ctx / 1_000)}K`;
  return p
    ? `${ctxLabel} ctx · $${p.input}/$${p.output}`
    : `${ctxLabel} ctx`;
};

// Issue 8 Part 1 — full model roster including 1M-context variants.
// Claude Code's `--model` accepts the `[1m]` suffix to opt a model
// into its 1M-token context window. Commander exposed only the
// standard variants pre-Issue-8, which meant Jose had to manually
// type `claude-opus-4-7[1m]` to use the 1M window. Ordering: Opus →
// Sonnet → Haiku, within family newest first, standard before [1m]
// variant. Labels are distinct — no two items share a display name.
//
// Issue 16.1.1 — every entry's `detail` now reads `priceDetail(value)`
// (previously several `[1m]` entries passed the base id, which was a
// silent drift exposed by 16.1's correction of base-ID context limits).
export const MODEL_OPTIONS = [
  { value: 'claude-opus-4-7',       label: 'Opus 4.7',                 detail: priceDetail('claude-opus-4-7'),       tier: 'premium' },
  { value: 'claude-opus-4-7[1m]',   label: 'Opus 4.7 [1M context]',    detail: priceDetail('claude-opus-4-7[1m]'),   tier: 'premium' },
  { value: 'claude-sonnet-4-6',     label: 'Sonnet 4.6',               detail: priceDetail('claude-sonnet-4-6'),     tier: 'balanced' },
  { value: 'claude-sonnet-4-6[1m]', label: 'Sonnet 4.6 [1M context]',  detail: priceDetail('claude-sonnet-4-6[1m]'), tier: 'balanced' },
  { value: 'claude-haiku-4-5',      label: 'Haiku 4.5',                detail: priceDetail('claude-haiku-4-5'),      tier: 'fast' },
  { value: 'claude-opus-4-6',       label: 'Opus 4.6 (legacy)',        detail: priceDetail('claude-opus-4-6'),       tier: 'legacy' },
  { value: 'claude-opus-4-6[1m]',   label: 'Opus 4.6 [1M context] (legacy)', detail: priceDetail('claude-opus-4-6[1m]'), tier: 'legacy' },
];

interface CreateSessionModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (opts: { name?: string; projectPath?: string; model?: string; sessionType?: SessionType }) => Promise<void>;
}

// Phase M1 — three session kinds. Order matches left-to-right layout and
// is also the order we cycle radio buttons with arrow keys. PM auto-
// injects the PM bootstrap at /effort high; Coder auto-injects the Coder
// bootstrap at /effort medium; Raw is plain Claude Code at /effort medium.
const SESSION_TYPE_OPTIONS: Array<{
  value: SessionType;
  label: string;
  icon: typeof Users;
  // Teal = PM (strategic), amber = Coder (execution), neutral = Raw.
  selectedBg: string;
  selectedColor: string;
  selectedBorder: string;
}> = [
  {
    value: 'pm',
    label: 'PM',
    icon: Users,
    selectedBg: 'rgba(14, 124, 123, 0.18)',
    selectedColor: 'var(--color-accent-light)',
    selectedBorder: 'var(--color-accent)',
  },
  {
    value: 'coder',
    label: 'Coder',
    icon: Code,
    selectedBg: 'rgba(234, 179, 8, 0.18)',
    selectedColor: 'rgb(250, 204, 21)',
    selectedBorder: 'rgba(234, 179, 8, 0.7)',
  },
  {
    value: 'raw',
    label: 'Raw',
    icon: Terminal,
    selectedBg: 'rgba(255, 255, 255, 0.08)',
    selectedColor: 'var(--color-text-primary)',
    selectedBorder: 'rgba(255, 255, 255, 0.2)',
  },
];

export const CreateSessionModal = ({ open, onClose, onCreate }: CreateSessionModalProps) => {
  const [name, setName] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [sessionType, setSessionType] = useState<SessionType>('pm');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Phase P.2 C2 — focus trap + ESC + focus restore. Replaces the
  // ad-hoc ESC handler below.
  useModalA11y({ open, containerRef: dialogRef, onClose });

  // Fetch project list for autocomplete (#218 — TTL-cached in
  // services/projectsCache).
  useEffect(() => {
    if (!open) return;
    const cached = getProjectsCache();
    if (cached) {
      setProjects(cached);
      return;
    }
    api
      .get<Project[]>('/projects')
      .then((data) => {
        setProjectsCache(data);
        setProjects(data);
      })
      .catch(() => {});
  }, [open]);

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setName('');
      setProjectPath('');
      setModel(DEFAULT_MODEL);
      setSessionType('pm');
      setIsSubmitting(false);
    }
  }, [open]);

  // ESC is now handled by useModalA11y above.

  const filteredProjects = projects.filter((p) =>
    p.path.toLowerCase().includes(projectPath.toLowerCase()) ||
    p.name.toLowerCase().includes(projectPath.toLowerCase())
  );

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onCreate({
        name: name.trim() || undefined,
        projectPath: projectPath.trim() || undefined,
        model,
        sessionType,
      });
      onClose();
    } catch {
      setIsSubmitting(false);
    }
  }, [isSubmitting, name, projectPath, model, onCreate, onClose]);

  const inputStyle = {
    fontFamily: M,
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    color: 'var(--color-text-primary)',
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0"
            style={{ background: 'rgba(0, 0, 0, 0.5)', backdropFilter: 'blur(4px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-session-title"
            className="glass-modal relative w-full max-w-md p-6"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' as const }}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <h2
                id="create-session-title"
                className="text-lg font-semibold"
                style={{ fontFamily: M, color: 'var(--color-text-primary)' }}
              >
                New Session
              </h2>
              <button
                onClick={onClose}
                aria-label="Close dialog"
                className="flex items-center justify-center rounded-lg transition-colors"
                style={{
                  minWidth: 44,
                  minHeight: 44,
                  color: 'var(--color-text-tertiary)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {/* Session type — PM and Coder auto-inject their bootstrap
                  post-boot; Raw is plain. See SESSION_TYPE_EFFORT_DEFAULTS
                  for the /effort level each kind gets. */}
              <div>
                <label
                  className="block text-sm font-medium mb-1.5"
                  style={{ fontFamily: M, color: 'var(--color-text-secondary)' }}
                >
                  Session type
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {SESSION_TYPE_OPTIONS.map(({ value, label, icon: Icon, selectedBg, selectedColor, selectedBorder }) => {
                    const selected = sessionType === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setSessionType(value)}
                        className="flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm transition-all"
                        style={{
                          fontFamily: M,
                          background: selected ? selectedBg : 'rgba(255, 255, 255, 0.04)',
                          color: selected ? selectedColor : 'var(--color-text-secondary)',
                          border: `1px solid ${selected ? selectedBorder : 'rgba(255, 255, 255, 0.08)'}`,
                        }}
                      >
                        <Icon size={14} className="shrink-0" />
                        <span className="font-semibold">{label}</span>
                      </button>
                    );
                  })}
                </div>
                <p
                  className="text-xs mt-1.5"
                  style={{ fontFamily: M, color: 'var(--color-text-tertiary)' }}
                >
                  {sessionType === 'pm' && (
                    <>PM sessions auto-invoke the PM bootstrap at <code>/effort high</code> — strategic planning + orchestration.</>
                  )}
                  {sessionType === 'coder' && (
                    <>Coder sessions auto-invoke the Coder bootstrap at <code>/effort medium</code> — tactical execution of phase prompts and direct coding work.</>
                  )}
                  {sessionType === 'raw' && (
                    <>Raw sessions are plain Claude Code at <code>/effort medium</code> — no bootstrap.</>
                  )}
                </p>
              </div>

              {/* Name */}
              <div>
                <label
                  className="block text-sm font-medium mb-1.5"
                  style={{ fontFamily: M, color: 'var(--color-text-secondary)' }}
                >
                  Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Auto-generated if empty"
                  className="w-full rounded-lg px-3 py-2 text-base outline-none transition-colors"
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-accent)'; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)'; }}
                />
              </div>

              {/* Project path with autocomplete */}
              <div className="relative">
                <label
                  className="block text-sm font-medium mb-1.5"
                  style={{ fontFamily: M, color: 'var(--color-text-secondary)' }}
                >
                  Project Path
                </label>
                <input
                  type="text"
                  value={projectPath}
                  onChange={(e) => {
                    setProjectPath(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onFocus={(e) => {
                    setShowSuggestions(true);
                    e.currentTarget.style.borderColor = 'var(--color-accent)';
                  }}
                  onBlur={(e) => {
                    // Delay to allow click on suggestion
                    setTimeout(() => setShowSuggestions(false), 200);
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                  }}
                  placeholder="~/Desktop/Projects/..."
                  className="w-full rounded-lg px-3 py-2 text-base outline-none transition-colors"
                  style={inputStyle}
                />

                {/* Suggestions dropdown */}
                {showSuggestions && filteredProjects.length > 0 && (
                  <div
                    className="absolute left-0 right-0 top-full mt-1 z-10 rounded-lg overflow-hidden max-h-48 overflow-y-auto"
                    style={{
                      background: 'rgba(15, 20, 25, 0.95)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      backdropFilter: 'blur(16px)',
                    }}
                  >
                    {filteredProjects.slice(0, 8).map((project) => (
                      <button
                        key={project.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm transition-colors"
                        style={{
                          fontFamily: M,
                          color: 'var(--color-text-secondary)',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                          e.currentTarget.style.color = 'var(--color-text-primary)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                          e.currentTarget.style.color = 'var(--color-text-secondary)';
                        }}
                        onClick={() => {
                          setProjectPath(project.path);
                          setShowSuggestions(false);
                        }}
                      >
                        <div className="font-medium">{project.name}</div>
                        <div
                          className="font-mono-stats text-xs truncate"
                          style={{ color: 'var(--color-text-tertiary)' }}
                        >
                          {project.path}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Model selector */}
              <div>
                <label
                  className="block text-sm font-medium mb-1.5"
                  style={{ fontFamily: M, color: 'var(--color-text-secondary)' }}
                >
                  Model
                </label>
                <div className="flex flex-col gap-2">
                  {MODEL_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setModel(opt.value)}
                      className="flex items-center justify-between rounded-lg px-4 py-3 text-sm transition-all"
                      style={{
                        fontFamily: M,
                        background: model === opt.value ? 'rgba(14, 124, 123, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                        color: model === opt.value ? 'var(--color-accent-light)' : 'var(--color-text-secondary)',
                        border: `1px solid ${model === opt.value ? 'var(--color-accent)' : 'rgba(255, 255, 255, 0.08)'}`,
                      }}
                    >
                      <div className="flex flex-col items-start gap-0.5">
                        <span className="font-semibold" style={{ color: model === opt.value ? '#fff' : 'var(--color-text-primary)' }}>
                          {opt.label}
                        </span>
                        <span className="font-mono-stats text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                          {opt.detail}
                        </span>
                      </div>
                      {model === opt.value && (
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ background: 'var(--color-accent-light)' }}
                        />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Buttons */}
              <div className="flex items-center justify-end gap-3 mt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  style={{
                    fontFamily: M,
                    color: 'var(--color-text-secondary)',
                    background: 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="cta-btn-primary"
                  style={{ fontFamily: M }}
                >
                  {isSubmitting && <Loader2 size={14} className="animate-spin" />}
                  Create
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
