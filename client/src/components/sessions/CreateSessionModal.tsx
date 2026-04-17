import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Users, Terminal } from 'lucide-react';
import type { Project } from '@commander/shared';
import { api } from '../../services/api';
import { getProjectsCache, setProjectsCache } from '../../services/projectsCache';

const M = 'Montserrat, sans-serif';

const MODEL_OPTIONS = [
  { value: 'claude-opus-4-6', label: 'Opus 4.6', detail: '1M ctx · $15/$75', tier: 'premium' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6', detail: '200K ctx · $3/$15', tier: 'balanced' },
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5', detail: '200K ctx · $0.80/$4', tier: 'fast' },
];

interface CreateSessionModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (opts: { name?: string; projectPath?: string; model?: string; sessionType?: 'pm' | 'raw' }) => Promise<void>;
}

export const CreateSessionModal = ({ open, onClose, onCreate }: CreateSessionModalProps) => {
  const [name, setName] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [model, setModel] = useState('claude-opus-4-6');
  const [sessionType, setSessionType] = useState<'pm' | 'raw'>('pm');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

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
      setModel('claude-opus-4-6');
      setSessionType('pm');
      setIsSubmitting(false);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

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
            className="glass-modal relative w-full max-w-md p-6"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' as const }}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <h2
                className="text-lg font-semibold"
                style={{ fontFamily: M, color: 'var(--color-text-primary)' }}
              >
                New Session
              </h2>
              <button
                onClick={onClose}
                className="flex items-center justify-center rounded-lg transition-colors"
                style={{ width: 32, height: 32, color: 'var(--color-text-tertiary)' }}
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
              {/* Session type — PM auto-invokes /pm bootstrap; Raw is plain. */}
              <div>
                <label
                  className="block text-sm font-medium mb-1.5"
                  style={{ fontFamily: M, color: 'var(--color-text-secondary)' }}
                >
                  Session type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['pm', 'raw'] as const).map((kind) => {
                    const Icon = kind === 'pm' ? Users : Terminal;
                    const label = kind === 'pm' ? 'PM Session' : 'Raw Session';
                    const selected = sessionType === kind;
                    return (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => setSessionType(kind)}
                        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all"
                        style={{
                          fontFamily: M,
                          background: selected
                            ? (kind === 'pm' ? 'rgba(14, 124, 123, 0.18)' : 'rgba(255, 255, 255, 0.08)')
                            : 'rgba(255, 255, 255, 0.04)',
                          color: selected
                            ? (kind === 'pm' ? 'var(--color-accent-light)' : 'var(--color-text-primary)')
                            : 'var(--color-text-secondary)',
                          border: `1px solid ${selected
                            ? (kind === 'pm' ? 'var(--color-accent)' : 'rgba(255, 255, 255, 0.2)')
                            : 'rgba(255, 255, 255, 0.08)'}`,
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
                  PM sessions auto-invoke <code>/pm</code> with JStudio context. Raw sessions are plain Claude Code.
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
