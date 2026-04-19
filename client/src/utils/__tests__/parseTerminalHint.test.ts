import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTerminalHint } from '../parseTerminalHint.js';

// Issue 8.1 Part 1 — defense-in-depth mirror of Issue 8 P0. Reply
// content that happens to contain the word "thinking" or glyphs
// `✻` / `✶` mid-line must NOT false-fire the "Thinking deeply..."
// hint. Real spinner lines (glyph at line start + live verb with
// -ing/-ed morphology on the same line) still do.

describe('parseTerminalHint — Issue 8.1 hardening', () => {
  test('real spinner line fires thinking hint', () => {
    const lines = ['✻ Cogitating (3s)', '', '  esc to interrupt'];
    assert.equal(parseTerminalHint(lines), 'Thinking deeply... (3s)');
  });

  test('real spinner line without duration still fires thinking hint', () => {
    const lines = ['✻ Thinking', 'some context'];
    assert.equal(parseTerminalHint(lines), 'Thinking deeply...');
  });

  test('reply content containing "thinking" mid-line does NOT leak hint', () => {
    // The exact leak shape: Claude's own reply mentions the word.
    // Pre-8.1 this returned "Thinking deeply..." because the blob
    // match hit the word. Post-8.1 no live spinner line exists,
    // so no thinking hint fires.
    const lines = [
      '❯ what are you thinking about?',
      '⏺ I was thinking through the problem earlier.',
      '',
    ];
    assert.equal(parseTerminalHint(lines), null);
  });

  test('reply content with standalone ✻ mid-line does NOT leak hint', () => {
    const lines = [
      '⏺ The spinner glyph ✻ is used by Claude Code as a thinking indicator.',
      '',
    ];
    assert.equal(parseTerminalHint(lines), null);
  });

  test('reply content with verb substring does NOT leak hint', () => {
    const lines = [
      '⏺ I am rethinking my approach.', // "thinking" is substring of "rethinking"
      '',
    ];
    // No live spinner line → no thinking hint. (Word-boundary in the
    // verb regex means "rethinking" doesn\'t match "Thinking" either.)
    assert.equal(parseTerminalHint(lines), null);
  });

  test('glyph at line start but verb has wrong morphology → no hint', () => {
    // Claude Code v-future decides to print `✻ Opus 4.7` as chrome.
    // We must not treat it as live thinking — "Opus" fails the
    // -ing/-ed morphology check.
    const lines = ['✻ Opus 4.7 status', ''];
    assert.equal(parseTerminalHint(lines), null);
  });

  test('Nesting hint requires a live signal, not prose mentioning it', () => {
    const lines = [
      '⏺ Nesting teammates is a common pattern in this codebase.',
      '',
    ];
    assert.equal(parseTerminalHint(lines), null);
  });

  test('Nesting hint with real paren signal still fires', () => {
    const lines = ['Nesting… (agent-abc)', ''];
    assert.equal(parseTerminalHint(lines), 'Nesting... (agent-abc)');
  });

  test('Compacting hint still fires on prose (syntactic pattern, acceptable scope)', () => {
    // Compacting is a very specific word Claude Code only uses when
    // actually compacting. Keeping the broad match.
    const lines = ['Compacting context...', ''];
    assert.equal(parseTerminalHint(lines), 'Compacting context...');
  });

  test('tool-call patterns (Bash(, Read(, etc.) still work', () => {
    assert.equal(parseTerminalHint(['Bash(ls -la)']), 'Running command...');
    assert.equal(parseTerminalHint(['Read(/tmp/foo.ts)']), 'Reading foo.ts...');
    assert.equal(parseTerminalHint(['Grep(pattern)']), 'Searching codebase...');
  });

  test('no signal → null', () => {
    assert.equal(parseTerminalHint(['hello', 'world']), null);
    assert.equal(parseTerminalHint([]), null);
  });
});
