import { watch } from 'chokidar';
import { readFileSync, statSync, openSync, readSync, closeSync, watch as fsWatch } from 'node:fs';
import type { FSWatcher as NodeFSWatcher } from 'node:fs';
import { basename } from 'node:path';
import type { FSWatcher } from 'chokidar';
import { getDb } from '../db/connection.js';
import { config } from '../config.js';

type JsonlChangeHandler = (filePath: string, newLines: string[]) => void;
type ProjectFileChangeHandler = (filePath: string, type: 'state' | 'handoff') => void;

let jsonlWatcher: FSWatcher | null = null;
let projectWatcher: FSWatcher | null = null;
const jsonlHandlers: JsonlChangeHandler[] = [];
const projectHandlers: ProjectFileChangeHandler[] = [];
// Phase P.1 H1/M5 — LRU-capped fs.watch bag. The map is keyed by full
// path; JS Map iteration order is insertion, so the first key is the
// oldest and gets evicted when we breach the cap. Without this limit,
// a rogue `/api/hook-event` stream could allocate fs.watch FDs until
// the host runs out (easy local DoS).
export const SPECIFIC_WATCHER_CAP = 100;
const specificWatchers = new Map<string, NodeFSWatcher>();

const getIncrementalLines = (filePath: string): string[] => {
  const db = getDb();

  // Get last known offset
  const state = db.prepare('SELECT last_byte_offset FROM file_watch_state WHERE file_path = ?')
    .get(filePath) as { last_byte_offset: number } | undefined;

  const lastOffset = state?.last_byte_offset ?? 0;

  let fileSize: number;
  try {
    fileSize = statSync(filePath).size;
  } catch {
    return [];
  }

  if (fileSize <= lastOffset) return [];

  // Read new bytes from offset
  const bytesToRead = fileSize - lastOffset;
  const buffer = Buffer.alloc(bytesToRead);
  let fd: number;
  try {
    fd = openSync(filePath, 'r');
  } catch {
    return [];
  }

  try {
    readSync(fd, buffer, 0, bytesToRead, lastOffset);
  } finally {
    closeSync(fd);
  }

  const newContent = buffer.toString('utf-8');
  const lines = newContent.split('\n').filter((l) => l.trim().length > 0);

  // Update state
  db.prepare(`
    INSERT INTO file_watch_state (file_path, last_byte_offset, last_line_count, last_modified)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(file_path) DO UPDATE SET
      last_byte_offset = excluded.last_byte_offset,
      last_line_count = last_line_count + excluded.last_line_count,
      last_modified = datetime('now')
  `).run(filePath, fileSize, lines.length);

  return lines;
};

export const fileWatcherService = {
  start(): void {
    // Watch Claude JSONL directory
    const claudeProjectsDir = config.claudeProjectsDir;
    console.log(`[watcher] Watching JSONL files in ${claudeProjectsDir}`);

    // Watch the directory itself — chokidar v4 glob matching fails on directory
    // names starting with '-' (Claude's encoded project paths like
    // -Users-jose-Desktop-Projects-Foo). Filtering for .jsonl in handlers instead.
    jsonlWatcher = watch(claudeProjectsDir, {
      persistent: true,
      ignoreInitial: true,
      depth: 2,
      usePolling: true,
      interval: 500,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    jsonlWatcher.on('ready', () => {
      console.log('[watcher] JSONL watcher ready');
    });

    jsonlWatcher.on('error', (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[watcher] JSONL watcher error:', msg);
    });

    const handleJsonlEvent = (filePath: string) => {
      if (!filePath.endsWith('.jsonl')) return;
      console.log(`[watcher] JSONL change: ${basename(filePath)}`);

      const newLines = getIncrementalLines(filePath);
      if (newLines.length > 0) {
        for (const handler of jsonlHandlers) {
          try {
            handler(filePath, newLines);
          } catch (err) {
            console.error('[watcher] JSONL handler error:', err);
          }
        }
      }
    };

    jsonlWatcher.on('change', handleJsonlEvent);
    jsonlWatcher.on('add', handleJsonlEvent);

    // Watch project directories for STATE.md / PM_HANDOFF.md changes
    // Watch each project dir with depth:1 to avoid scanning node_modules/dist/etc
    if (config.projectDirs.length > 0) {
      console.log(`[watcher] Watching project files in ${config.projectDirs.join(', ')}`);

      // Use polling to avoid EMFILE — FSEvent watchers exhaust file handles
      // on large project directories. Polling every 10s is sufficient for STATE.md changes.
      projectWatcher = watch(config.projectDirs, {
        persistent: true,
        ignoreInitial: true,
        depth: 1,
        ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/.next/**', '**/.vite/**'],
        usePolling: true,
        interval: 10000,
      });

      projectWatcher.on('change', (filePath: string) => {
        const name = basename(filePath);
        if (name !== 'STATE.md' && name !== 'PM_HANDOFF.md') return;
        const type = name === 'STATE.md' ? 'state' : 'handoff';
        for (const handler of projectHandlers) {
          try {
            handler(filePath, type);
          } catch (err) {
            console.error('[watcher] Project handler error:', err);
          }
        }
      });
    }
  },

  stop(): void {
    if (jsonlWatcher) {
      jsonlWatcher.close();
      jsonlWatcher = null;
    }
    if (projectWatcher) {
      projectWatcher.close();
      projectWatcher = null;
    }
    for (const [, w] of specificWatchers) {
      try { w.close(); } catch { /* already closed */ }
    }
    specificWatchers.clear();
    jsonlHandlers.length = 0;
    projectHandlers.length = 0;
    console.log('[watcher] File watchers stopped');
  },

  onJsonlChange(callback: JsonlChangeHandler): void {
    jsonlHandlers.push(callback);
  },

  onProjectFileChange(callback: ProjectFileChangeHandler): void {
    projectHandlers.push(callback);
  },

  // Watch a specific JSONL file using fs.watch (triggered by Claude Code hooks)
  // Much more reliable than directory-level watching for individual files
  watchSpecificFile(filePath: string): void {
    if (specificWatchers.has(filePath)) return; // Already watching

    // Phase P.1 H1/M5 — LRU evict before allocating the new FD. Map
    // iteration is insertion order, so `.keys().next().value` gives the
    // oldest entry. Close its FD and drop it so the incoming watcher
    // stays below SPECIFIC_WATCHER_CAP.
    if (specificWatchers.size >= SPECIFIC_WATCHER_CAP) {
      const oldestKey = specificWatchers.keys().next().value;
      if (oldestKey !== undefined) {
        const oldest = specificWatchers.get(oldestKey);
        try { oldest?.close(); } catch { /* already closed */ }
        specificWatchers.delete(oldestKey);
        console.log(`[watcher] LRU-evicted specific watcher: ${basename(oldestKey)}`);
      }
    }

    try {
      const watcher = fsWatch(filePath, { persistent: false }, (eventType) => {
        if (eventType !== 'change') return;

        const newLines = getIncrementalLines(filePath);
        if (newLines.length > 0) {
          for (const handler of jsonlHandlers) {
            try {
              handler(filePath, newLines);
            } catch (err) {
              console.error('[watcher] Specific file handler error:', err);
            }
          }
        }
      });

      watcher.on('error', () => {
        specificWatchers.delete(filePath);
      });

      specificWatchers.set(filePath, watcher);
      console.log(`[watcher] Watching specific file: ${basename(filePath)}`);

      // Also trigger an immediate read for any unprocessed data
      const newLines = getIncrementalLines(filePath);
      if (newLines.length > 0) {
        for (const handler of jsonlHandlers) {
          try {
            handler(filePath, newLines);
          } catch (err) {
            console.error('[watcher] Specific file handler error:', err);
          }
        }
      }
    } catch (err) {
      console.error(`[watcher] Failed to watch ${basename(filePath)}:`, err);
    }
  },

  getIncrementalLines,
};
