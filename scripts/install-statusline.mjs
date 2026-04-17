#!/usr/bin/env node
// Install Commander's statusline into ~/.claude/settings.json.
//
// Safe by design:
//   - Timestamped backup before every write.
//   - If a `statusLine` already exists, preserve its `command` under
//     Commander's `statusLine.passThroughCommand` hint (MVP doesn't exec
//     the passthrough yet, but storing the field keeps a migration path
//     open and prints a warning so Jose knows the conflict was detected).
//   - Atomic write via temp-file + rename.
//   - Absolute path — no reliance on $PATH / cwd at Claude Code launch.

import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');
const statuslinePath = resolve(repoRoot, 'packages', 'statusline', 'statusline.mjs');
const settingsDir = join(homedir(), '.claude');
const settingsPath = join(settingsDir, 'settings.json');

const readSettings = () => {
  if (!existsSync(settingsPath)) return {};
  try {
    const raw = readFileSync(settingsPath, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[install-statusline] could not parse ${settingsPath}: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
};

const backupSettings = () => {
  if (!existsSync(settingsPath)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${settingsPath}.backup-${stamp}`;
  writeFileSync(backupPath, readFileSync(settingsPath, 'utf8'));
  return backupPath;
};

// Atomic write — temp file then rename so a crash mid-write never leaves
// settings.json half-written.
const writeSettingsAtomic = (obj) => {
  mkdirSync(settingsDir, { recursive: true });
  const tmp = `${settingsPath}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  renameSync(tmp, settingsPath);
};

const main = () => {
  if (!existsSync(statuslinePath)) {
    console.error(`[install-statusline] statusline binary not found at ${statuslinePath}`);
    process.exit(1);
  }

  const settings = readSettings();
  const prior = settings.statusLine;
  const priorWasCommander =
    prior && typeof prior === 'object' && typeof prior.command === 'string' && prior.command.includes('statusline.mjs');

  const commanderCommand = `node ${statuslinePath}`;
  const next = {
    type: 'command',
    command: commanderCommand,
    padding: 0,
  };

  // Preserve any pre-existing non-Commander statusline so a future
  // coexistence mode can delegate to it. MVP doesn't execute it; the
  // field is informational and a hint to the user that we saved their
  // prior setup.
  if (prior && !priorWasCommander && typeof prior.command === 'string') {
    next.passThroughCommand = prior.command;
    console.warn(
      `[install-statusline] WARN: existing statusLine preserved under passThroughCommand: ${prior.command}`,
    );
  }

  const backupPath = backupSettings();
  if (backupPath) console.log(`[install-statusline] backed up settings.json → ${backupPath}`);

  const updated = { ...settings, statusLine: next };
  writeSettingsAtomic(updated);

  console.log(`[install-statusline] installed → ${settingsPath}`);
  console.log(`[install-statusline] command: ${commanderCommand}`);
  if (priorWasCommander) {
    console.log('[install-statusline] (replaced existing Commander registration — path now absolute)');
  }
};

main();
