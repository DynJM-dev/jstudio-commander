import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';

const home = homedir();
const dataDir = join(home, '.jstudio-commander');
const configPath = join(dataDir, 'config.json');

interface FileConfig {
  pin?: string;
  projectDirs?: string[];
  port?: number;
}

const loadFileConfig = (): FileConfig => {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  if (!existsSync(configPath)) {
    const defaults = {
      pin: '',
      projectDirs: [join(home, 'Desktop', 'Projects')],
      port: 11002,
    };
    writeFileSync(configPath, JSON.stringify(defaults, null, 2));
    return defaults;
  }

  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as FileConfig;
  } catch {
    return {};
  }
};

const fileConfig = loadFileConfig();

export const config = {
  port: fileConfig.port ?? 11002,
  host: '0.0.0.0',

  // Database
  dataDir,
  dbPath: join(dataDir, 'commander.db'),

  // Claude Code paths
  claudeDir: join(home, '.claude'),
  claudeProjectsDir: join(home, '.claude', 'projects'),

  // Project discovery directories
  projectDirs: fileConfig.projectDirs?.map((d) =>
    d.startsWith('~') ? d.replace('~', home) : d
  ) ?? [join(home, 'Desktop', 'Projects')],

  // Tunnel
  tunnelPin: fileConfig.pin ?? '',
};
