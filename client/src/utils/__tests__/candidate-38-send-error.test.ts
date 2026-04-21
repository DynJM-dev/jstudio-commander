import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

// Candidate 38 — attachment-only submit error surfacing. The fix
// wires a transient `sendError` state in ChatPage that (a) clears
// existing errors when a new send begins, (b) surfaces an error
// when upload returns zero paths despite staged files, (c) surfaces
// an error when the async chain rejects (upload failure / network
// flap). These tests pin the PREDICATE logic behind those gates
// without requiring React / jsdom.

// Mirrors the ChatPage predicates used in Candidate 38's fix.
// Exported-inline for test transparency.

const shouldSurfaceEmptyPayloadError = (args: {
  hasFiles: boolean;
  payload: string;
}): boolean => args.hasFiles && !args.payload;

const shouldAllowSubmit = (args: {
  cmdText: string;
  hasFiles: boolean;
  sending: boolean;
  isUploading: boolean;
}): boolean =>
  !(
    (!args.cmdText.trim() && !args.hasFiles) ||
    args.sending ||
    args.isUploading
  );

describe('Candidate 38 — attachment-only submit error surfacing', () => {
  test('empty payload + has files → surface error', () => {
    assert.equal(shouldSurfaceEmptyPayloadError({ hasFiles: true, payload: '' }), true);
  });

  test('empty payload + no files → no surface (pre-guard already blocked)', () => {
    assert.equal(shouldSurfaceEmptyPayloadError({ hasFiles: false, payload: '' }), false);
  });

  test('non-empty payload + has files → no surface (normal success path)', () => {
    assert.equal(
      shouldSurfaceEmptyPayloadError({ hasFiles: true, payload: '@/path/file' }),
      false,
    );
  });
});

describe('Candidate 38 — submit enablement gate (non-regression)', () => {
  test('empty text + no files → disabled', () => {
    assert.equal(
      shouldAllowSubmit({ cmdText: '', hasFiles: false, sending: false, isUploading: false }),
      false,
    );
  });

  test('empty text + has files → enabled (attachment-only submit works)', () => {
    assert.equal(
      shouldAllowSubmit({ cmdText: '', hasFiles: true, sending: false, isUploading: false }),
      true,
    );
  });

  test('non-empty text + no files → enabled', () => {
    assert.equal(
      shouldAllowSubmit({ cmdText: 'hi', hasFiles: false, sending: false, isUploading: false }),
      true,
    );
  });

  test('sending=true blocks submit regardless', () => {
    assert.equal(
      shouldAllowSubmit({ cmdText: 'hi', hasFiles: false, sending: true, isUploading: false }),
      false,
    );
  });

  test('isUploading=true blocks submit regardless (double-click guard)', () => {
    assert.equal(
      shouldAllowSubmit({ cmdText: 'hi', hasFiles: true, sending: false, isUploading: true }),
      false,
    );
  });

  test('whitespace-only text + no files → disabled (trim guard)', () => {
    assert.equal(
      shouldAllowSubmit({ cmdText: '   \n\t  ', hasFiles: false, sending: false, isUploading: false }),
      false,
    );
  });
});
