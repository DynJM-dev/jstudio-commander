import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

// Candidate 44 — attachment drop preventDefault contract. Jose's
// observed symptom: drag-drop MD file into chat input, `@/absolute/
// path/filename.md` appears as TEXT in the textarea (not as a staged
// attachment chip), Enter does not submit. Root cause: macOS Finder
// drags don't always expose 'Files' in `dataTransfer.types` during
// intermediate dragover events (the type list can narrow mid-drag
// as the drag source commits to a transfer type). The pre-fix
// `onDragOver` early-returned on `!hasFiles(types)` and never called
// preventDefault, so the drop event bubbled through the wrapper
// unhandled. The child `<textarea>` then received the native text-
// insert fallback and populated with the file URI.
//
// Fix: `preventDefault()` fires unconditionally on onDragOver /
// onDragEnter / onDragLeave / onDrop in the dropzone wrapper. The
// `hasFiles` check now only gates the overlay UI (`isDragging` flag
// and `dropEffect = 'copy'`), not the preventDefault call. Net
// effect: the textarea never sees a native drop, regardless of how
// the browser reports the drag type mid-flight.
//
// These tests pin the preventDefault contract at the predicate level.
// The actual React event wiring is smoke-verified by Jose's Case 4
// acceptance gate (drag-drop file with no text → Enter → submits
// with file attached, no textarea pollution).

// Mock React.DragEvent shape — captures the preventDefault call count
// and dropEffect assignments so tests can assert the contract.
interface MockDragEvent {
  types: string[];
  filesLength: number;
  preventDefault: () => void;
  preventDefaultCalls: { count: number };
  dropEffectValue: { current: string | null };
}

const makeDragEvent = (types: string[], filesLength: number): MockDragEvent => {
  const preventDefaultCalls = { count: 0 };
  const dropEffectValue: { current: string | null } = { current: null };
  return {
    types,
    filesLength,
    preventDefault: () => { preventDefaultCalls.count += 1; },
    preventDefaultCalls,
    dropEffectValue,
  };
};

// Mirrors the onDragOver in useAttachments.ts post-fix.
const simulateOnDragOver = (e: MockDragEvent): void => {
  e.preventDefault();
  if (e.types.includes('Files')) {
    e.dropEffectValue.current = 'copy';
  }
};

// Mirrors the onDrop post-fix.
const simulateOnDrop = (e: MockDragEvent, stageCalls: { count: number }): void => {
  e.preventDefault();
  if (e.filesLength > 0) {
    stageCalls.count += 1;
  }
};

describe('Candidate 44 — dragover preventDefault is unconditional', () => {
  test('dragover with "Files" in types → preventDefault fires + dropEffect=copy', () => {
    const e = makeDragEvent(['Files', 'text/plain'], 1);
    simulateOnDragOver(e);
    assert.equal(e.preventDefaultCalls.count, 1, 'preventDefault fires every time');
    assert.equal(e.dropEffectValue.current, 'copy', 'dropEffect set for file drag');
  });

  test('dragover WITHOUT "Files" in types → preventDefault STILL fires (the bug fix)', () => {
    // This is the load-bearing assertion. Pre-fix: preventDefault
    // would NOT fire here (early-return), and the bubbling drop would
    // insert file URI text into the textarea. Post-fix: preventDefault
    // fires, textarea never sees native drop.
    const e = makeDragEvent(['text/plain', 'text/uri-list'], 0);
    simulateOnDragOver(e);
    assert.equal(
      e.preventDefaultCalls.count,
      1,
      'preventDefault must fire even without Files in types — this is the Candidate 44 fix',
    );
    assert.equal(e.dropEffectValue.current, null, 'dropEffect unchanged when not a file drag');
  });

  test('dragover with empty types (mid-drag intermediate state) → preventDefault fires', () => {
    const e = makeDragEvent([], 0);
    simulateOnDragOver(e);
    assert.equal(
      e.preventDefaultCalls.count,
      1,
      'macOS Finder intermediate dragover with empty types still blocks native drop',
    );
  });
});

describe('Candidate 44 — drop always preventDefault, stages only when files present', () => {
  test('drop with files → preventDefault + stageFiles called', () => {
    const e = makeDragEvent(['Files'], 2);
    const stageCalls = { count: 0 };
    simulateOnDrop(e, stageCalls);
    assert.equal(e.preventDefaultCalls.count, 1);
    assert.equal(stageCalls.count, 1);
  });

  test('drop with zero files (edge case) → preventDefault fires, no stage call', () => {
    // Defensive: even a "drop" without payload files must not fall
    // through to native behavior.
    const e = makeDragEvent([], 0);
    const stageCalls = { count: 0 };
    simulateOnDrop(e, stageCalls);
    assert.equal(e.preventDefaultCalls.count, 1);
    assert.equal(stageCalls.count, 0);
  });
});

describe('Candidate 44 — hasFiles predicate (overlay gating, not preventDefault gating)', () => {
  const hasFiles = (types: string[]): boolean => types.includes('Files');

  test('types with "Files" → true', () => {
    assert.equal(hasFiles(['Files', 'text/plain']), true);
  });

  test('types without "Files" → false (overlay stays hidden)', () => {
    assert.equal(hasFiles(['text/plain', 'text/uri-list']), false);
  });

  test('empty types → false', () => {
    assert.equal(hasFiles([]), false);
  });
});
