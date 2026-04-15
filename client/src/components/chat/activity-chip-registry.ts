import { Brain, BookOpen, Users, UserMinus, Send, Search, ListChecks, ListTree, type LucideIcon } from 'lucide-react';
import type { ChipTone } from './ActivityChip';

// Dispatch table for compact tool-use affordances. Order matters: the
// renderer picks the first matching entry. Path-based Read entries go
// before the generic fallback so skill/memory classification wins over
// the generic ToolCallBlock render.

export interface ActivityChipConfig {
  /** Unique key for debugging / future enable-flags. */
  id: string;
  /** Returns true when this registry entry should handle the block. */
  match: (toolName: string, input?: Record<string, unknown>) => boolean;
  /** Visible label text — short verb-phrase ("Loaded skill", "Read memory"). */
  label: (input?: Record<string, unknown>) => string;
  /** Optional secondary noun — the thing being acted on. */
  target?: (input?: Record<string, unknown>) => string | undefined;
  icon: LucideIcon;
  tone: ChipTone;
}

const SKILL_PATH_RE = /\/\.claude\/skills\//;
const MEMORY_PATH_RE = /(\/\.claude\/(memory|projects\/[^/]+\/memory)\/)|\/memory\/[^/]+\.md$/;
const PROJECT_DOC_NAMES = /\b(CODER_BRAIN|PM_HANDOFF|STATE|CLAUDE|MEMORY)\.md$/;

const skillFromPath = (path: string): string => {
  const m = path.match(/\/skills\/([^/]+)/);
  return m?.[1] ?? 'skill';
};
const basename = (path: string): string => path.split('/').pop() ?? path;

export const chipRegistry: ActivityChipConfig[] = [
  {
    id: 'skill',
    match: (name) => name === 'Skill',
    label: () => 'Loaded skill',
    target: (input) => (input as { skill?: string } | undefined)?.skill ?? 'unknown',
    icon: Brain,
    tone: 'blue',
  },
  {
    id: 'send-message',
    match: (name) => name === 'SendMessage',
    label: (input) => `Messaged ${(input as { to?: string } | undefined)?.to ?? 'teammate'}`,
    target: (input) => {
      const i = input as { summary?: string; message?: string | Record<string, unknown> } | undefined;
      const msg = typeof i?.message === 'string' ? i.message : undefined;
      return i?.summary ?? (msg ? `${msg.length} chars` : undefined);
    },
    icon: Send,
    tone: 'cyan',
  },
  {
    id: 'team-create',
    match: (name) => name === 'TeamCreate',
    label: () => 'Created team',
    target: (input) => (input as { name?: string } | undefined)?.name,
    icon: Users,
    tone: 'purple',
  },
  {
    id: 'team-delete',
    match: (name) => name === 'TeamDelete',
    label: () => 'Dismissed team',
    target: (input) => (input as { name?: string } | undefined)?.name,
    icon: UserMinus,
    tone: 'purple',
  },
  {
    id: 'tool-search',
    match: (name) => name === 'ToolSearch',
    label: () => 'Searched tools',
    target: (input) => (input as { query?: string } | undefined)?.query,
    icon: Search,
    tone: 'muted',
  },
  {
    id: 'task-list',
    match: (name) => name === 'TaskList',
    label: () => 'Listed tasks',
    icon: ListTree,
    tone: 'muted',
  },
  {
    id: 'task-get',
    match: (name) => name === 'TaskGet',
    label: () => 'Inspected task',
    target: (input) => {
      const id = (input as { taskId?: string } | undefined)?.taskId;
      return id ? `#${id}` : undefined;
    },
    icon: ListChecks,
    tone: 'muted',
  },
  {
    id: 'task-stop',
    match: (name) => name === 'TaskStop',
    label: () => 'Stopped task',
    target: (input) => {
      const id = (input as { taskId?: string } | undefined)?.taskId;
      return id ? `#${id}` : undefined;
    },
    icon: ListChecks,
    tone: 'muted',
  },
  // Path-classified Read entries — order them by specificity so the
  // generic Read fallthrough is the LAST Read-matching config.
  {
    id: 'read-skill',
    match: (name, input) => {
      if (name !== 'Read') return false;
      const p = (input as { file_path?: string } | undefined)?.file_path ?? '';
      return SKILL_PATH_RE.test(p);
    },
    label: () => 'Read skill',
    target: (input) => skillFromPath((input as { file_path?: string } | undefined)?.file_path ?? ''),
    icon: Brain,
    tone: 'blue',
  },
  {
    id: 'read-memory',
    match: (name, input) => {
      if (name !== 'Read') return false;
      const p = (input as { file_path?: string } | undefined)?.file_path ?? '';
      return MEMORY_PATH_RE.test(p);
    },
    label: () => 'Read memory',
    target: (input) => basename((input as { file_path?: string } | undefined)?.file_path ?? ''),
    icon: BookOpen,
    tone: 'amber',
  },
  {
    id: 'read-project-doc',
    match: (name, input) => {
      if (name !== 'Read') return false;
      const p = (input as { file_path?: string } | undefined)?.file_path ?? '';
      return PROJECT_DOC_NAMES.test(p);
    },
    label: () => 'Read doc',
    target: (input) => basename((input as { file_path?: string } | undefined)?.file_path ?? ''),
    icon: BookOpen,
    tone: 'muted',
  },
];

// Returns the first matching chip config, or null when no registry entry
// claims the block — the caller falls back to the rich ToolCallBlock render
// so Read/Write/Edit/Bash/etc. keep their full file-path + result-preview
// treatment.
export const matchChip = (toolName: string, input?: Record<string, unknown>): ActivityChipConfig | null => {
  for (const cfg of chipRegistry) {
    if (cfg.match(toolName, input)) return cfg;
  }
  return null;
};
