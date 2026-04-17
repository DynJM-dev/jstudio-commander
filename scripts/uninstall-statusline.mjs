#!/usr/bin/env node
// Revert Commander's statusline installation.
//
// Two modes:
//   - Default: remove the `statusLine` key from ~/.claude/settings.json.
//   - `--restore`: restore the newest backup that install-statusline wrote.
//
// Backup file is timestamped `settings.json.backup-<iso>`; we pick the
// newest matching one in the ~/.claude directory.

import { readFileSync, writeFileSync, existsSync, readdirSync, renameSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const settingsDir = join(homedir(), '.claude');
const settingsPath = join(settingsDir, 'settings.json');

const writeSettingsAtomic = (raw) => {
  mkdirSync(settingsDir, { recursive: true });
  const tmp = `${settingsPath}.tmp-${process.pid}`;
  writeFileSync(tmp, raw);
  renameSync(tmp, settingsPath);
};

const findNewestBackup = () => {
  if (!existsSync(settingsDir)) return null;
  const files = readdirSync(settingsDir)
    .filter((f) => f.startsWith('settings.json.backup-'))
    .map((f) => ({ name: f, path: join(settingsDir, f), mtime: statSync(join(settingsDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] ?? null;
};

const main = () => {
  const restore = process.argv.includes('--restore');

  if (restore) {
    const backup = findNewestBackup();
    if (!backup) {
      console.error('[uninstall-statusline] no backup found; use without --restore to just drop the key');
      process.exit(1);
    }
    writeSettingsAtomic(readFileSync(backup.path, 'utf8'));
    console.log(`[uninstall-statusline] restored ${backup.name} → settings.json`);
    return;
  }

  if (!existsSync(settingsPath)) {
    console.log('[uninstall-statusline] no settings.json — nothing to do');
    return;
  }
  const raw = readFileSync(settingsPath, 'utf8');
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (err) {
    console.error(`[uninstall-statusline] could not parse settings.json: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  if (!parsed.statusLine) {
    console.log('[uninstall-statusline] no statusLine configured; nothing to do');
    return;
  }
  const { statusLine, ...rest } = parsed;
  void statusLine;
  writeSettingsAtomic(JSON.stringify(rest, null, 2) + '\n');
  console.log('[uninstall-statusline] removed statusLine key from settings.json');
};

main();
