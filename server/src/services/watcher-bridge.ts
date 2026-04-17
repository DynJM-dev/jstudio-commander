import { dirname, basename } from 'node:path';
import { fileWatcherService } from './file-watcher.service.js';
import { jsonlParserService } from './jsonl-parser.service.js';
import { jsonlDiscoveryService } from './jsonl-discovery.service.js';
import { tokenTrackerService } from './token-tracker.service.js';
import { projectScannerService } from './project-scanner.service.js';
import { sessionService } from './session.service.js';
import { eventBus } from '../ws/event-bus.js';
import { getDb } from '../db/connection.js';
import { resolveOwner } from '../routes/hook-event.routes.js';
import { readJsonlOrigin, isCoderJsonl } from './jsonl-origin.service.js';

export const setupWatcherBridge = (): void => {
  // Wire JSONL file changes → parse new lines → emit chat messages
  fileWatcherService.onJsonlChange((filePath, newLines) => {
    const messages = jsonlParserService.parseLines(newLines);
    if (messages.length === 0) return;

    // JSONL path: ~/.claude/projects/{encoded-path}/{session-uuid}.jsonl
    const jsonlFilename = basename(filePath, '.jsonl');
    const encodedProjectDir = basename(dirname(filePath));

    // Phase L — matcher cascade aligned with hook-event.resolveOwner so
    // chokidar-discovered files survive PM/lead transcript rotation even
    // when the hook event was dropped or arrived before the row existed.
    // B2 refinement: consults the JSONL origin so the cwd fallback never
    // false-attributes a coder's events to a PM in the same cwd.
    const db = getDb();

    //   1. claude_session_id OR id matches the JSONL filename (covers
    //      teammate-coder sessions + PM on first registration).
    let session = db.prepare(
      'SELECT id FROM sessions WHERE claude_session_id = ? OR id = ?'
    ).get(jsonlFilename, jsonlFilename) as { id: string } | undefined;

    // Read the JSONL origin once — used both to scope the cwd fallback
    // below AND to enable resolveOwner's coder-team-rotation branch.
    const origin = readJsonlOrigin(filePath);
    const originIsCoder = isCoderJsonl(origin);

    //   2. Encoded-project-path match → fully resolved cwd. The cwd
    //      fallback scopes by the origin's role: coder JSONLs only match
    //      non-lead-pm rows; PM JSONLs only match lead-pm rows. Rows whose
    //      agent_role is NULL are eligible either way (legacy rows).
    let matchedCwd: string | null = null;
    if (!session) {
      const rolePredicate = originIsCoder
        ? "AND (agent_role IS NULL OR agent_role != 'lead-pm')"
        : origin && origin.agentName === null
          ? "AND (agent_role IS NULL OR agent_role = 'lead-pm')"
          : '';
      const rows = db.prepare(
        `SELECT id, project_path FROM sessions
         WHERE project_path IS NOT NULL
           AND status != 'stopped'
           ${rolePredicate}`
      ).all() as { id: string; project_path: string }[];

      for (const row of rows) {
        const encoded = jsonlDiscoveryService.encodeProjectPath(row.project_path);
        if (encoded === encodedProjectDir) {
          matchedCwd = row.project_path;
          // Keep the FIRST match (within the role-scoped subset) for
          // bug-compat with pre-Phase-L code, then upgrade below via
          // resolveOwner which disambiguates further (pm-cwd-rotation
          // vs coder-team-rotation) now that it sees the origin too.
          if (!session) session = { id: row.id };
        }
      }
    }

    //   3. Phase L — hand off to hook-event.resolveOwner so the
    //      pm-cwd-rotation + coder-team-rotation + cwd-exclusive rules
    //      apply here too. resolveOwner reads the JSONL origin itself so
    //      the coder-vs-PM discriminator is enforced a second time.
    if (matchedCwd) {
      const better = resolveOwner({
        event: 'jsonl-discovery',
        sessionId: jsonlFilename,
        data: { transcript_path: filePath, cwd: matchedCwd },
      });
      if (better) session = { id: better.id };
    }

    if (session) {
      // Phase L — persist the new transcript file to the session's
      // transcript_paths list so `/api/chat/:sessionId` reads fresh
      // content on the next REST call. Without this, WS events delivered
      // chat updates to a live client but any reload / cross-tab open /
      // delta poll served stale JSONL content.
      try {
        const appended = sessionService.appendTranscriptPath(session.id, filePath);
        if (appended) {
          console.log(
            `[bridge] JSONL discovery → session ${session.id.slice(0, 30)} appended ${basename(filePath)}`,
          );
          const updatedSession = sessionService.getSession(session.id);
          if (updatedSession) eventBus.emitSessionUpdated(updatedSession);
        }
      } catch (err) {
        console.error('[bridge] appendTranscriptPath error:', err);
      }

      console.log(`[bridge] JSONL change → session ${session.id}, ${messages.length} new messages`);
      eventBus.emitChatMessages(session.id, messages);

      // Track token usage from assistant messages
      try {
        tokenTrackerService.recordUsage(session.id, null, messages);
      } catch (err) {
        console.error('[bridge] Token tracking error:', err);
      }
    } else {
      console.log(`[bridge] JSONL change at ${encodedProjectDir} — no matching session found`);
    }
  });

  // Wire STATE.md/PM_HANDOFF.md changes → re-scan project → emit update
  fileWatcherService.onProjectFileChange((filePath, type) => {
    // filePath is like ~/Desktop/Projects/foo/STATE.md
    const projectDir = dirname(filePath);
    const project = projectScannerService.getProjectByPath(projectDir);

    if (project) {
      // Re-scan just this project. Fire-and-forget async enrich for
      // recent commits (#230) — git log is cheap but we don't want to
      // block the watcher callback.
      const scanned = projectScannerService.scanDirectories([dirname(projectDir)]);
      const updated = scanned.find((p) => p.path === projectDir);
      if (updated) {
        updated.id = project.id;
        void projectScannerService.enrichWithCommits([updated]).then(() => {
          projectScannerService.syncToDb([updated]);
          const refreshed = projectScannerService.getProject(project.id);
          if (refreshed) eventBus.emitProjectUpdated(refreshed);
        });
      }
    }
  });

  console.log('[bridge] File watcher → event bus bridge connected');
};
