import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { Project, PhaseStatus, StackPill, RecentCommit } from '@commander/shared';
import { getDb } from '../db/connection.js';
import { config } from '../config.js';
import { detectStack, getRecentCommits } from './project-stack.service.js';

const safeParseJson = <T>(raw: unknown, fallback: T): T => {
  if (typeof raw !== 'string') return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as unknown as T) : fallback;
  } catch {
    return fallback;
  }
};

interface ParsedState {
  currentPhase: string | null;
  currentPhaseStatus: PhaseStatus | null;
  totalPhases: number;
  completedPhases: number;
}

interface ParsedHandoff {
  modules: Array<{ name: string; priority: string; description: string }>;
  phases: Array<{ number: number; name: string; complete: boolean }>;
}

const rowToProject = (row: Record<string, unknown>): Project => ({
  id: row.id as string,
  name: row.name as string,
  path: row.path as string,
  hasStateMd: (row.has_state_md as number) === 1,
  hasHandoffMd: (row.has_handoff_md as number) === 1,
  currentPhase: row.current_phase as string | null,
  currentPhaseStatus: row.current_phase_status as PhaseStatus | null,
  totalPhases: (row.total_phases as number) ?? 0,
  completedPhases: (row.completed_phases as number) ?? 0,
  stack: safeParseJson<StackPill[]>(row.stack_json, []),
  recentCommits: safeParseJson<RecentCommit[]>(row.recent_commits_json, []),
  lastScannedAt: row.last_scanned_at as string,
  createdAt: row.created_at as string,
});

export const projectScannerService = {
  parseStateMd(content: string): ParsedState {
    let currentPhase: string | null = null;
    let currentPhaseStatus: PhaseStatus | null = null;
    let totalPhases = 0;
    let completedPhases = 0;

    // Look for phase lines like "## Phase 3: Feature Module — IN_PROGRESS"
    // or "Phase: 3 Name — STATUS"
    const phasePattern = /##?\s*Phase\s+(\d+)[:\s]+(.+?)(?:\s*[-—]\s*(.*?))?$/gmi;
    let match;
    let lastPhase: string | null = null;
    let lastStatus: string | null = null;

    while ((match = phasePattern.exec(content)) !== null) {
      totalPhases++;
      const phaseName = `Phase ${match[1]}: ${match[2]!.trim()}`;
      const status = match[3]?.trim().toLowerCase() ?? '';

      if (status.includes('complete') || status.includes('done') || status.includes('✅')) {
        completedPhases++;
      }

      lastPhase = phaseName;
      lastStatus = status;
    }

    // Count checkbox items as fallback for phase counting
    const checkedMatches = content.match(/- \[x\]/gi);
    const uncheckedMatches = content.match(/- \[ \]/g);

    if (totalPhases === 0 && (checkedMatches || uncheckedMatches)) {
      completedPhases = checkedMatches?.length ?? 0;
      totalPhases = completedPhases + (uncheckedMatches?.length ?? 0);
    }

    // Find the current (last in-progress) phase
    if (lastPhase) {
      currentPhase = lastPhase;
      if (lastStatus?.includes('progress') || lastStatus?.includes('active')) {
        currentPhaseStatus = 'in_progress';
      } else if (lastStatus?.includes('complete') || lastStatus?.includes('done')) {
        currentPhaseStatus = 'complete';
      } else if (lastStatus?.includes('block')) {
        currentPhaseStatus = 'blocked';
      } else {
        currentPhaseStatus = 'in_progress';
      }
    }

    return { currentPhase, currentPhaseStatus, totalPhases, completedPhases };
  },

  parseHandoffMd(content: string): ParsedHandoff {
    const modules: ParsedHandoff['modules'] = [];
    const phases: ParsedHandoff['phases'] = [];

    // Parse module map table: | Module | Priority | Description |
    const modulePattern = /\|\s*\*?\*?(.+?)\*?\*?\s*\|\s*(P\d)\s*\|\s*(.+?)\s*\|/g;
    let match;
    while ((match = modulePattern.exec(content)) !== null) {
      const name = match[1]!.replace(/\*\*/g, '').trim();
      if (name.toLowerCase() === 'module' || name.includes('---')) continue;
      modules.push({
        name,
        priority: match[2]!.trim(),
        description: match[3]!.trim(),
      });
    }

    // Parse phase plan: ### Phase N: Name
    const phasePattern = /###\s*Phase\s+(\d+)[:\s]+(.+?)$/gm;
    while ((match = phasePattern.exec(content)) !== null) {
      phases.push({
        number: parseInt(match[1]!, 10),
        name: match[2]!.trim(),
        complete: false,
      });
    }

    return { modules, phases };
  },

  scanDirectories(dirs?: string[]): Project[] {
    const scanDirs = dirs ?? config.projectDirs;
    const projects: Project[] = [];

    for (const dir of scanDirs) {
      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          const fullPath = join(dir, entry);
          try {
            const stat = statSync(fullPath);
            if (!stat.isDirectory()) continue;
            // Skip hidden dirs and node_modules
            if (entry.startsWith('.') || entry === 'node_modules') continue;

            const hasStateMd = existsSync(join(fullPath, 'STATE.md'));
            const hasHandoffMd = existsSync(join(fullPath, 'PM_HANDOFF.md'));

            let stateData: ParsedState = {
              currentPhase: null,
              currentPhaseStatus: null,
              totalPhases: 0,
              completedPhases: 0,
            };

            if (hasStateMd) {
              try {
                const content = readFileSync(join(fullPath, 'STATE.md'), 'utf-8');
                stateData = this.parseStateMd(content);
              } catch {
                // Can't read STATE.md
              }
            }

            // Tech-stack detection (#230) — sync manifest read.
            let stack: StackPill[] = [];
            try {
              stack = detectStack(fullPath);
            } catch {
              // never let a bad manifest kill the scan
            }

            projects.push({
              id: '', // Will be assigned during sync
              name: entry,
              path: fullPath,
              hasStateMd,
              hasHandoffMd,
              currentPhase: stateData.currentPhase,
              currentPhaseStatus: stateData.currentPhaseStatus,
              totalPhases: stateData.totalPhases,
              completedPhases: stateData.completedPhases,
              stack,
              recentCommits: [],
              lastScannedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            });
          } catch {
            // Skip inaccessible directories
          }
        }
      } catch {
        // Skip inaccessible scan dirs
      }
    }

    return projects;
  },

  syncToDb(projects: Project[]): void {
    const db = getDb();
    const upsert = db.prepare(`
      INSERT INTO projects (id, name, path, has_state_md, has_handoff_md, current_phase, current_phase_status, total_phases, completed_phases, stack_json, recent_commits_json, last_scanned_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(path) DO UPDATE SET
        name = excluded.name,
        has_state_md = excluded.has_state_md,
        has_handoff_md = excluded.has_handoff_md,
        current_phase = excluded.current_phase,
        current_phase_status = excluded.current_phase_status,
        total_phases = excluded.total_phases,
        completed_phases = excluded.completed_phases,
        stack_json = excluded.stack_json,
        recent_commits_json = excluded.recent_commits_json,
        last_scanned_at = datetime('now')
    `);

    const transaction = db.transaction(() => {
      for (const project of projects) {
        const id = project.id || uuidv4();
        upsert.run(
          id, project.name, project.path,
          project.hasStateMd ? 1 : 0, project.hasHandoffMd ? 1 : 0,
          project.currentPhase, project.currentPhaseStatus,
          project.totalPhases, project.completedPhases,
          JSON.stringify(project.stack ?? []),
          JSON.stringify(project.recentCommits ?? []),
        );
      }
    });

    transaction();
  },

  // Async enrichment step: runs `git log` per project in parallel. Kept
  // separate from the sync scanDirectories so callers can pick which
  // pathway they need (e.g. the watcher-bridge STATE.md pulse doesn't
  // need to re-shell git if nothing there changed, but we do anyway
  // because it's cheap and keeps rows fresh).
  async enrichWithCommits(projects: Project[]): Promise<Project[]> {
    await Promise.all(
      projects.map(async (p) => {
        try {
          p.recentCommits = await getRecentCommits(p.path, 10);
        } catch {
          p.recentCommits = [];
        }
      }),
    );
    return projects;
  },

  listProjects(): Project[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM projects ORDER BY name').all() as Record<string, unknown>[];
    return rows.map(rowToProject);
  },

  getProject(id: string): Project | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToProject(row) : null;
  },

  getProjectByPath(path: string): Project | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM projects WHERE path = ?').get(path) as Record<string, unknown> | undefined;
    return row ? rowToProject(row) : null;
  },

  getProjectStateContent(id: string): string | null {
    const project = this.getProject(id);
    if (!project) return null;
    const statePath = join(project.path, 'STATE.md');
    try {
      return readFileSync(statePath, 'utf-8');
    } catch {
      return null;
    }
  },

  getProjectHandoffContent(id: string): string | null {
    const project = this.getProject(id);
    if (!project) return null;
    const handoffPath = join(project.path, 'PM_HANDOFF.md');
    try {
      return readFileSync(handoffPath, 'utf-8');
    } catch {
      return null;
    }
  },

  async runInitialScan(): Promise<void> {
    console.log('[scanner] Running initial project scan...');
    const projects = this.scanDirectories();
    await this.enrichWithCommits(projects);
    this.syncToDb(projects);
    console.log(`[scanner] Found ${projects.length} projects`);
  },
};
