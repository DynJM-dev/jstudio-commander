import { dirname, basename } from 'node:path';
import { fileWatcherService } from './file-watcher.service.js';
import { jsonlParserService } from './jsonl-parser.service.js';
import { projectScannerService } from './project-scanner.service.js';
import { eventBus } from '../ws/event-bus.js';
import { getDb } from '../db/connection.js';

export const setupWatcherBridge = (): void => {
  // Wire JSONL file changes → parse new lines → emit chat messages
  fileWatcherService.onJsonlChange((filePath, newLines) => {
    const messages = jsonlParserService.parseLines(newLines);
    if (messages.length === 0) return;

    // Try to find which session this JSONL file belongs to
    // JSONL path: ~/.claude/projects/{encoded-path}/{session-uuid}.jsonl
    const jsonlFilename = basename(filePath, '.jsonl');
    const encodedProjectDir = basename(dirname(filePath));

    // Look up session by claude_session_id or by matching project path
    const db = getDb();
    let session = db.prepare('SELECT id FROM sessions WHERE claude_session_id = ?')
      .get(jsonlFilename) as { id: string } | undefined;

    if (!session) {
      // Try to match via project path — decode the encoded path
      const decodedPath = '/' + encodedProjectDir.slice(1).replace(/-/g, '/');
      session = db.prepare('SELECT id FROM sessions WHERE project_path = ?')
        .get(decodedPath) as { id: string } | undefined;
    }

    if (session) {
      eventBus.emitChatMessages(session.id, messages);
    }
  });

  // Wire STATE.md/PM_HANDOFF.md changes → re-scan project → emit update
  fileWatcherService.onProjectFileChange((filePath, type) => {
    // filePath is like ~/Desktop/Projects/foo/STATE.md
    const projectDir = dirname(filePath);
    const project = projectScannerService.getProjectByPath(projectDir);

    if (project) {
      // Re-scan just this project
      const scanned = projectScannerService.scanDirectories([dirname(projectDir)]);
      const updated = scanned.find((p) => p.path === projectDir);
      if (updated) {
        updated.id = project.id;
        projectScannerService.syncToDb([updated]);
        const refreshed = projectScannerService.getProject(project.id);
        if (refreshed) {
          eventBus.emitProjectUpdated(refreshed);
        }
      }
    }
  });

  console.log('[bridge] File watcher → event bus bridge connected');
};
