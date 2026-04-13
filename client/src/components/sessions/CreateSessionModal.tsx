import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2 } from 'lucide-react';
import type { Project } from '@commander/shared';
import { api } from '../../services/api';

const M = 'Montserrat, sans-serif';

const MODEL_OPTIONS = [
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
];

interface CreateSessionModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (opts: { name?: string; projectPath?: string; model?: string }) => Promise<void>;
}

export const CreateSessionModal = ({ open, onClose, onCreate }: CreateSessionModalProps) => {
  const [name, setName] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [model, setModel] = useState('claude-opus-4-6');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Fetch project list for autocomplete
  useEffect(() => {
    if (!open) return;
    api.get<Project[]>('/projects').then(setProjects).catch(() => {});
  }, [open]);

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setName('');
      setProjectPath('');
      setModel('claude-opus-4-6');
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
                <div className="flex gap-2">
                  {MODEL_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setModel(opt.value)}
                      className="flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-all"
                      style={{
                        fontFamily: M,
                        background: model === opt.value ? 'var(--color-accent)' : 'rgba(255, 255, 255, 0.04)',
                        color: model === opt.value ? '#fff' : 'var(--color-text-secondary)',
                        border: `1px solid ${model === opt.value ? 'var(--color-accent)' : 'rgba(255, 255, 255, 0.08)'}`,
                      }}
                    >
                      {opt.label.split(' ').pop()}
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
                  className="px-5 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                  style={{
                    fontFamily: M,
                    background: 'var(--color-accent)',
                    color: '#fff',
                    opacity: isSubmitting ? 0.7 : 1,
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  }}
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
