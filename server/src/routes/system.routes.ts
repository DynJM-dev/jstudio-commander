import type { FastifyInstance } from 'fastify';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { config } from '../config.js';
import { getDb } from '../db/connection.js';
import { hookMatchStats } from './hook-event.routes.js';

const startTime = Date.now();

const isTmuxAvailable = (): boolean => {
  try {
    execFileSync('tmux', ['-V'], { encoding: 'utf-8', timeout: 2000 });
    return true;
  } catch {
    return false;
  }
};

const isDbConnected = (): boolean => {
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
};

export const systemRoutes = async (app: FastifyInstance) => {
  app.get('/api/system/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
      dbConnected: isDbConnected(),
      tmuxAvailable: isTmuxAvailable(),
      // Hook-event match distribution since boot — a rising unclaimed-cwd
      // count means multiple teammates are sharing a cwd faster than the
      // hook events can disambiguate them. Rising 'skipped' means hook
      // events arrive with no matchable Commander session at all.
      hookMatchStats: { ...hookMatchStats },
    };
  });

  app.get('/api/system/config', async () => {
    // Read effort level from Claude settings
    let effortLevel = 'medium';
    try {
      const settingsPath = join(homedir(), '.claude', 'settings.json');
      if (existsSync(settingsPath)) {
        const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as { effortLevel?: string };
        if (settings.effortLevel) effortLevel = settings.effortLevel;
      }
    } catch { /* default */ }

    return {
      projectDirs: config.projectDirs,
      dbPath: config.dbPath,
      serverPort: config.port,
      effortLevel,
      version: '0.1.0',
    };
  });

};
