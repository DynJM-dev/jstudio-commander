export type PhaseStatus = 'pending' | 'in_progress' | 'complete' | 'blocked';

export type StackCategory = 'framework' | 'language' | 'tool' | 'backend' | 'database';

export interface StackPill {
  label: string;
  category: StackCategory;
}

export interface RecentCommit {
  sha: string;
  subject: string;
  date: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  hasStateMd: boolean;
  hasHandoffMd: boolean;
  currentPhase: string | null;
  currentPhaseStatus: PhaseStatus | null;
  totalPhases: number;
  completedPhases: number;
  stack: StackPill[];
  recentCommits: RecentCommit[];
  lastScannedAt: string;
  createdAt: string;
}

export interface PhaseLog {
  id: number;
  projectId: string;
  phaseNumber: number;
  phaseName: string;
  status: PhaseStatus;
  startedAt: string | null;
  completedAt: string | null;
  durationMinutes: number | null;
  filesCreated: number;
  filesModified: number;
  migrationsRun: number;
  totalCostUsd: number;
  notes: string | null;
}
