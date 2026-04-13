export type PhaseStatus = 'pending' | 'in_progress' | 'complete' | 'blocked';

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
