import { join } from 'node:path';
import { homedir } from 'node:os';

const home = homedir();

export const config = {
  port: 3001,
  host: '0.0.0.0',

  // Database
  dataDir: join(home, '.jstudio-commander'),
  dbPath: join(home, '.jstudio-commander', 'commander.db'),

  // Claude Code paths
  claudeDir: join(home, '.claude'),
  claudeProjectsDir: join(home, '.claude', 'projects'),

  // Project discovery directories
  projectDirs: [
    join(home, 'Desktop', 'Projects'),
  ],

  // Tunnel
  tunnelEnabled: false,
  tunnelPin: '',
};
