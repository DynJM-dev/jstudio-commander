// Sidecar-side FSEvents watcher for the four canonical project files per
// project. Subscribes on session spawn, emits ProjectFileChangedEvent on the
// project channel so the frontend's drawer can invalidate its TanStack
// Query cache.
//
// Uses Node's `fs.watch` which on macOS delegates to FSEvents — matches the
// v1.3 spec correction (§5.4) and the dispatch's "tauri-plugin-fs"
// direction in spirit (Tauri v2's fs plugin exposes file reads; watching is
// cleanest in Node since the sidecar already owns file I/O).
//
// Ref-counted per (projectId, filename) so multiple sessions on the same
// project share one watcher. Caller provides addWatch/removeWatch bracketing.

import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { EventBus, channelForProject } from '../ws/event-bus.js';
import type { ProjectFileName } from '../routes/projects.js';

export class ProjectFileWatcher {
  private readonly watchers = new Map<string, { watcher: FSWatcher; refcount: number }>();

  constructor(private readonly bus: EventBus) {}

  addWatch(projectId: string, projectPath: string, name: ProjectFileName): void {
    const key = watchKey(projectId, name);
    const existing = this.watchers.get(key);
    if (existing) {
      existing.refcount++;
      return;
    }
    const absolute = join(projectPath, name);
    let w: FSWatcher | null = null;
    try {
      w = watch(absolute, { persistent: false }, () => this.emitChange(projectId, name));
      w.on('error', (err) => {
        // File may not exist yet; ENOENT watchers fire errors on macOS. Just
        // drop the watcher — the drawer's GET on initial load will see the
        // absent file; a later create won't re-arm automatically. Acceptable
        // for N2; re-arm-on-create deferred to N3.
        console.warn(`[fs-watch] ${absolute}: ${err.message}`);
        this.dropKey(key);
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        console.error(`[fs-watch] ${absolute} watch failed:`, (err as Error).message);
      }
      return; // silently skip missing files
    }
    this.watchers.set(key, { watcher: w, refcount: 1 });
  }

  removeWatch(projectId: string, name: ProjectFileName): void {
    const key = watchKey(projectId, name);
    const entry = this.watchers.get(key);
    if (!entry) return;
    entry.refcount--;
    if (entry.refcount <= 0) this.dropKey(key);
  }

  removeAllForProject(projectId: string): void {
    for (const key of [...this.watchers.keys()]) {
      if (key.startsWith(`${projectId}::`)) this.dropKey(key);
    }
  }

  shutdown(): void {
    for (const key of [...this.watchers.keys()]) this.dropKey(key);
  }

  private dropKey(key: string): void {
    const entry = this.watchers.get(key);
    if (!entry) return;
    try {
      entry.watcher.close();
    } catch {
      /* best-effort */
    }
    this.watchers.delete(key);
  }

  private emitChange(projectId: string, name: ProjectFileName): void {
    this.bus.emit(channelForProject(projectId), {
      type: 'project:file-changed',
      projectId,
      file: name,
      timestamp: Date.now(),
    });
  }
}

function watchKey(projectId: string, name: string): string {
  return `${projectId}::${name}`;
}
