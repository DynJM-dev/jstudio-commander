import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';

export interface SessionFile {
  sessionId: string;
  filePath: string;
  modifiedAt: Date;
}

const encodeProjectPath = (absolutePath: string): string => {
  // Claude encodes paths by replacing '/' with '-'
  return absolutePath.replace(/\//g, '-');
};

export const jsonlDiscoveryService = {
  encodeProjectPath,

  getClaudeProjectsDir(): string {
    return config.claudeProjectsDir;
  },

  findSessionFiles(projectPath: string): SessionFile[] {
    const encoded = encodeProjectPath(projectPath);
    const dir = join(config.claudeProjectsDir, encoded);

    try {
      const files = readdirSync(dir);
      return files
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => {
          const filePath = join(dir, f);
          const stat = statSync(filePath);
          return {
            sessionId: f.replace('.jsonl', ''),
            filePath,
            modifiedAt: stat.mtime,
          };
        })
        .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
    } catch {
      return [];
    }
  },

  findLatestSessionFile(projectPath: string): string | null {
    const files = this.findSessionFiles(projectPath);
    return files[0]?.filePath ?? null;
  },

  findAllSessionFiles(): SessionFile[] {
    const projectsDir = config.claudeProjectsDir;
    try {
      const dirs = readdirSync(projectsDir);
      const allFiles: SessionFile[] = [];
      for (const dir of dirs) {
        const fullDir = join(projectsDir, dir);
        try {
          const stat = statSync(fullDir);
          if (!stat.isDirectory()) continue;
          const files = readdirSync(fullDir);
          for (const f of files) {
            if (!f.endsWith('.jsonl')) continue;
            const filePath = join(fullDir, f);
            const fstat = statSync(filePath);
            allFiles.push({
              sessionId: f.replace('.jsonl', ''),
              filePath,
              modifiedAt: fstat.mtime,
            });
          }
        } catch {
          // Skip inaccessible dirs
        }
      }
      return allFiles.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
    } catch {
      return [];
    }
  },
};
