#!/usr/bin/env node
// Phase N.0 Patch 4 — install Commander's hook matchers into
// ~/.claude/settings.json without clobbering existing entries.
// Phase P.3 H3 — also deploy the Node-based hook script to
// ~/.claude/hooks/commander-hook.js (replaces the former .sh which
// shelled out to /usr/bin/python3 and silently dropped events when
// that path was broken on macOS 15.4). Any stale .sh matcher in
// settings.json is migrated to the .js path in the same run.
//
// Idempotent merge semantics:
//   - If settings.hooks[eventName] is missing → create it with our
//     matcher entry.
//   - If it exists, scan for any pre-existing entry that already
//     references commander-hook.js AT the expected path → skip
//     (install is a no-op).
//   - If it exists but references the LEGACY commander-hook.sh, the
//     entry is rewritten to point at the .js path.
//   - Otherwise append a new `{ matcher: '*', hooks: [commander-hook] }`
//     entry at the end so user-added matchers for that event type
//     stay intact.
//
// Writes atomically via temp file + rename; backs up settings.json to a
// timestamped sibling on every run that modifies state.

import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync, copyFileSync, chmodSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const settingsDir = join(homedir(), '.claude');
const settingsPath = join(settingsDir, 'settings.json');
const hooksDir = join(settingsDir, 'hooks');
const hookCommand = '~/.claude/hooks/commander-hook.js';
const legacyHookCommand = '~/.claude/hooks/commander-hook.sh';
const repoHookScript = join(__dirname, '..', 'hooks', 'commander-hook.js');
const installedHookScript = join(hooksDir, 'commander-hook.js');
const legacyInstalledHookScript = join(hooksDir, 'commander-hook.sh');

// Events Commander wants to observe. Stop + PostToolUse are pre-Patch-4
// hooks that existed since Phase J; SessionStart + SessionEnd were added
// in Phase N.0 Patch 4 so the server can flip status on turn boundaries
// AND session lifecycle boundaries (not just mid-turn tool events).
const HOOK_EVENTS = ['SessionStart', 'SessionEnd', 'Stop', 'PostToolUse'];

const readSettings = () => {
  if (!existsSync(settingsPath)) return {};
  try {
    const raw = readFileSync(settingsPath, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[install-hooks] could not parse ${settingsPath}: ${err instanceof Error ? err.message : err}`);
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

const writeSettingsAtomic = (obj) => {
  mkdirSync(settingsDir, { recursive: true });
  const tmp = `${settingsPath}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  renameSync(tmp, settingsPath);
};

// Deploy the hook script file itself. Idempotent: copy the repo's
// current version over whatever's installed, preserve execute permission.
// Also removes any stale .sh sibling so Claude Code can never pick up
// the legacy python-fallback hook. Deploys a minimal
// `~/.claude/hooks/package.json` alongside so Node treats the .js
// file as ESM natively (no `MODULE_TYPELESS_PACKAGE_JSON` reparse
// warning, no ~20ms per-invocation overhead).
export const deployHookScript = (opts = {}) => {
  const repo = opts.from ?? repoHookScript;
  const target = opts.to ?? installedHookScript;
  const legacy = opts.legacy ?? legacyInstalledHookScript;
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(repo, target);
  chmodSync(target, 0o755);
  // Write the sibling package.json; tiny + idempotent.
  writeFileSync(
    join(dirname(target), 'package.json'),
    JSON.stringify({ private: true, type: 'module' }, null, 2) + '\n',
  );
  if (existsSync(legacy)) {
    try { unlinkSync(legacy); } catch { /* already gone */ }
  }
  return { installed: target, removedLegacy: legacy };
};

// True iff this event-array already has an entry whose hooks list
// references the CURRENT commander-hook.js path. A legacy .sh entry
// returns false so it'll be migrated on merge.
export const entryHasCommanderHook = (entries) => {
  if (!Array.isArray(entries)) return false;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.hooks)) continue;
    for (const hook of entry.hooks) {
      if (!hook || typeof hook !== 'object') continue;
      if (typeof hook.command === 'string' && hook.command.includes('commander-hook.js')) {
        return true;
      }
    }
  }
  return false;
};

// True iff this event-array carries a legacy .sh entry we should
// migrate. Needed separately from entryHasCommanderHook so the merger
// can rewrite rather than append.
const hasLegacyCommanderHook = (entries) => {
  if (!Array.isArray(entries)) return false;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.hooks)) continue;
    for (const hook of entry.hooks) {
      if (!hook || typeof hook !== 'object') continue;
      if (typeof hook.command === 'string' && hook.command.includes('commander-hook.sh')) {
        return true;
      }
    }
  }
  return false;
};

// Rewrite any commander-hook.sh command inside this event-array to
// point at the .js path. Preserves other fields (matcher, type, timeout,
// user-added siblings). Simple substring replace — Claude's settings.json
// stores the command as a literal path string, no templating.
const migrateLegacyEntries = (entries) => {
  if (!Array.isArray(entries)) return entries;
  return entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.hooks)) return entry;
    const rewritten = entry.hooks.map((hook) => {
      if (!hook || typeof hook !== 'object') return hook;
      if (typeof hook.command === 'string' && hook.command.includes('commander-hook.sh')) {
        return { ...hook, command: hook.command.replace('commander-hook.sh', 'commander-hook.js') };
      }
      return hook;
    });
    return { ...entry, hooks: rewritten };
  });
};

// Returns { next, additions, migrations } — the merged `hooks` object,
// the events we added fresh entries to, and the events we migrated
// from .sh → .js. Pure; exposed for tests.
export const mergeHookEvents = (priorHooks, events = HOOK_EVENTS) => {
  const next = { ...(priorHooks ?? {}) };
  const additions = [];
  const migrations = [];
  for (const eventName of events) {
    const existing = Array.isArray(next[eventName]) ? next[eventName] : [];
    // Legacy .sh → rewrite to .js in place; treat as covered.
    if (hasLegacyCommanderHook(existing) && !entryHasCommanderHook(existing)) {
      next[eventName] = migrateLegacyEntries(existing);
      migrations.push(eventName);
      continue;
    }
    if (entryHasCommanderHook(existing)) continue;
    next[eventName] = [
      ...existing,
      {
        matcher: '*',
        hooks: [{ type: 'command', command: hookCommand, timeout: 5 }],
      },
    ];
    additions.push(eventName);
  }
  return { next, additions, migrations };
};

const main = () => {
  // Deploy the Node hook script first. If the user had a .sh at the
  // same location, deployHookScript's legacy-cleanup removes it before
  // settings.json gets rewritten, so there's no window where Claude
  // Code could execute the stale .sh after we pointed it at .js.
  const { installed, removedLegacy } = deployHookScript();
  console.log(`[install-hooks] deployed → ${installed}`);
  if (!existsSync(removedLegacy)) {
    // Only log if we actually removed a legacy file during this run;
    // a fresh machine never had one.
  }

  const settings = readSettings();
  const { next: mergedHooks, additions, migrations } = mergeHookEvents(settings.hooks);

  if (additions.length === 0 && migrations.length === 0) {
    console.log('[install-hooks] settings.json already up to date — no changes');
    return;
  }

  const backupPath = backupSettings();
  if (backupPath) console.log(`[install-hooks] backed up settings.json → ${backupPath}`);

  const updated = { ...settings, hooks: mergedHooks };
  writeSettingsAtomic(updated);

  console.log(`[install-hooks] settings → ${settingsPath}`);
  for (const event of additions) {
    console.log(`[install-hooks] added ${event} matcher`);
  }
  for (const event of migrations) {
    console.log(`[install-hooks] migrated ${event} matcher: .sh → .js`);
  }
};

// Only run when invoked as a script; `import` is safe for tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
