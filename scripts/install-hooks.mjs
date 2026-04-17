#!/usr/bin/env node
// Phase N.0 Patch 4 — install Commander's hook matchers into
// ~/.claude/settings.json without clobbering existing entries.
//
// Idempotent merge semantics:
//   - If settings.hooks[eventName] is missing → create it with our
//     matcher entry.
//   - If it exists, scan for any pre-existing entry that already
//     references commander-hook.sh → skip (install is a no-op).
//   - Otherwise append a new `{ matcher: '*', hooks: [commander-hook] }`
//     entry at the end so user-added matchers for that event type
//     (specific regex filters, different timeouts, different scripts)
//     stay intact.
//
// Writes atomically via temp file + rename; backs up settings.json to a
// timestamped sibling on every run that modifies state.
//
// Stop + PostToolUse are intentionally also covered so running this
// script on a fresh machine (or after a settings reset) lines up the
// full hook surface in one command. Re-runs are free — the scan-for-
// existing-commander-hook.sh branch above guarantees no duplicates.

import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const settingsDir = join(homedir(), '.claude');
const settingsPath = join(settingsDir, 'settings.json');
const hookCommand = '~/.claude/hooks/commander-hook.sh';

// Events Commander wants to observe. Stop + PostToolUse are pre-Patch-4
// hooks that existed since Phase J; SessionStart + SessionEnd are added
// in Patch 4 so the server can flip status on turn boundaries AND
// session lifecycle boundaries (not just mid-turn tool events).
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

// True iff this event-array already has an entry whose hooks list
// references the commander-hook.sh script. Tolerant of the full shell
// path (~/.claude/hooks/...) OR an absolute expansion.
export const entryHasCommanderHook = (entries) => {
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

// Returns the merged `hooks` object. Pure — does not read/write disk;
// exposed for tests so the merge invariants can be pinned without
// touching the real settings.json.
export const mergeHookEvents = (priorHooks, events = HOOK_EVENTS) => {
  const next = { ...(priorHooks ?? {}) };
  const additions = [];
  for (const eventName of events) {
    const existing = Array.isArray(next[eventName]) ? next[eventName] : [];
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
  return { next, additions };
};

const main = () => {
  const settings = readSettings();
  const { next: mergedHooks, additions } = mergeHookEvents(settings.hooks);

  if (additions.length === 0) {
    console.log('[install-hooks] already up to date — no changes');
    return;
  }

  const backupPath = backupSettings();
  if (backupPath) console.log(`[install-hooks] backed up settings.json → ${backupPath}`);

  const updated = { ...settings, hooks: mergedHooks };
  writeSettingsAtomic(updated);

  console.log(`[install-hooks] installed → ${settingsPath}`);
  for (const event of additions) {
    console.log(`[install-hooks] added ${event} matcher`);
  }
};

// Only run when invoked as a script; `import` is safe for tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
