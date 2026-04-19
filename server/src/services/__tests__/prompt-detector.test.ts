import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPrompts } from '../prompt-detector.service.js';

// Issue 9 Part 2 — prompt-detector pane-pattern tests. The
// must-reject list is the false-fire surface that Jose hit in
// production (`/status` and other Claude Code viewer modals). The
// must-accept list is the full inventory of real approval-prompt
// shapes Claude Code emits — removing the fallback must NOT drop
// any of these.

describe('detectPrompts — Issue 9 P2 false-positive rejections', () => {
  test('/status output with "Esc to cancel" footer → NO prompt', () => {
    // Verbatim repro of Jose's pane, captured from a live raw session.
    const lines = [
      '❯ /status',
      '',
      '─'.repeat(80),
      '   Status   Config   Usage   Stats',
      '',
      '  Version:          2.1.114',
      '  Session name:     /rename to add a name',
      '  Session ID:       3b2ab105-3efd-434c-80a2-e6baac3b8f1a',
      '  cwd:              /Users/josemiguelbonilla/Desktop/Projects/jstudio-commander/',
      '  Login method:     Claude Max account',
      '  Organization:     Jose Bonilla',
      '  Email:            jm.bonilla22@gmail.com',
      '',
      '  Model:            claude-opus-4-7',
      '  MCP servers:      3 need auth, 1 failed · /mcp',
      '  Setting sources:  User settings',
      '  Esc to cancel',
    ];
    assert.deepEqual(detectPrompts(lines), []);
  });

  test('/compact preview viewer with "Enter to confirm" footer → NO prompt', () => {
    const lines = [
      '❯ /compact',
      '─'.repeat(80),
      'Compaction preview:',
      'Pre-compact tokens: 85000',
      'Post-compact tokens: 12000',
      'Savings: 73000 tokens',
      'Enter to confirm',
      'Esc to cancel',
    ];
    assert.deepEqual(detectPrompts(lines), []);
  });

  test('chat content ending with "?" → NO prompt (removed fallback)', () => {
    // Tabular tool output with a question mark somewhere shouldn\'t
    // false-fire. This is the regex-fallback surface.
    const lines = [
      '⏺ The answer depends on context.',
      '',
      '  Would you like more detail?',
      '',
    ];
    assert.deepEqual(detectPrompts(lines), []);
  });

  test('tabular numbered rows with ")" → NO prompt (removed regex fallback)', () => {
    // Example: script output with numbered data rows.
    const lines = [
      'Results:',
      ' 1) First item',
      ' 2) Second item',
      ' 3) Third item',
      '',
    ];
    assert.deepEqual(detectPrompts(lines), []);
  });

  test('bypass-permissions mode → NO prompt even if approval-shaped text present', () => {
    // Kill-switch: `⏵⏵ bypass permissions on` means no prompt can fire.
    const lines = [
      'Do you want to make this edit to /tmp/foo.ts?',
      '❯ 1. Yes',
      '  2. No',
      '  3. No, and…',
      '⏵⏵ bypass permissions on · 1 shell',
    ];
    assert.deepEqual(detectPrompts(lines), []);
  });
});

describe('detectPrompts — Issue 9 P2 real-approval regression', () => {
  test('numbered-choice approval → choice prompt fires (regression guard)', () => {
    const lines = [
      '⏺ Edit(/Users/x/foo.ts)',
      '─'.repeat(80),
      'Do you want to make this edit to foo.ts?',
      '❯ 1. Yes',
      '  2. No',
      '  3. No, and tell Claude what to do differently',
      'Esc to cancel',
    ];
    const prompts = detectPrompts(lines);
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0]!.type, 'choice');
    assert.ok(prompts[0]!.options?.length === 3);
  });

  test('Allow / Deny permission prompt → permission prompt fires', () => {
    const lines = [
      'PyPI 📦 to run: pip install requests',
      '',
      'Allow once',
      'Allow always',
      'Deny',
    ];
    const prompts = detectPrompts(lines);
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0]!.type, 'permission');
  });

  test('y/n confirm → confirm prompt fires', () => {
    const lines = [
      'Run migration now?',
      '  Continue? (y/n)',
    ];
    const prompts = detectPrompts(lines);
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0]!.type, 'confirm');
    assert.match(prompts[0]!.message, /y\/n/i);
  });

  test('trust-folder prompt → trust prompt fires', () => {
    const lines = [
      'Do you trust this folder?',
      '  Yes, I trust this folder',
      '  No, exit',
    ];
    const prompts = detectPrompts(lines);
    assert.ok(prompts.some((p) => p.type === 'trust'));
  });
});
