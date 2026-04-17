// Phase S — tests for attachment staging logic.
//
// node:test + node 22's built-in File/Blob APIs are enough to cover
// the validation + payload-building helpers exported from
// useAttachments. The drag/paste handlers and React state transitions
// live inside the hook — a full render test would need jsdom +
// react-testing-library, which isn't in the project's test stack. We
// cover them instead via the Playwright E2E suite (separate phase).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateStagedFile,
  buildInjectedPayload,
  isImage,
  ACCEPTED_MIME,
  IMAGE_MAX_BYTES,
  FILE_MAX_BYTES,
} from '../../hooks/useAttachments.js';

describe('validateStagedFile', () => {
  test('accepts a valid image under the image cap', () => {
    assert.equal(validateStagedFile({ type: 'image/png', size: 100_000 }), null);
    assert.equal(validateStagedFile({ type: 'image/jpeg', size: IMAGE_MAX_BYTES }), null);
  });

  test('accepts a valid non-image text file under the file cap', () => {
    assert.equal(validateStagedFile({ type: 'text/plain', size: 50_000 }), null);
    assert.equal(validateStagedFile({ type: 'application/json', size: FILE_MAX_BYTES }), null);
  });

  test('rejects an image one byte over the image cap', () => {
    const err = validateStagedFile({ type: 'image/png', size: IMAGE_MAX_BYTES + 1 });
    assert.ok(err);
    assert.match(err!, /too large/i);
    // Error message must quote the correct limit — 5 MB for images.
    assert.match(err!, /5 MB/);
  });

  test('rejects a non-image file over the 10 MB file cap', () => {
    const err = validateStagedFile({ type: 'application/pdf', size: FILE_MAX_BYTES + 1 });
    assert.ok(err);
    assert.match(err!, /too large/i);
    assert.match(err!, /10 MB/);
  });

  test('rejects a file with a mime type not in the allowlist', () => {
    // Same class of attacker payload as the server's 415 test.
    const err = validateStagedFile({ type: 'application/x-msdownload', size: 100 });
    assert.ok(err);
    assert.match(err!, /unsupported type/i);
  });

  test('rejects a file with an empty mime type', () => {
    // Browsers occasionally hand us empty strings for unknown
    // extensions (no .extension mapping). We shouldn't silently let
    // them through — the server's allowlist would reject them anyway.
    const err = validateStagedFile({ type: '', size: 100 });
    assert.ok(err);
    assert.match(err!, /unsupported type/i);
  });
});

describe('isImage', () => {
  test('returns true for every image mime in the allowlist', () => {
    for (const mime of ACCEPTED_MIME) {
      if (mime.startsWith('image/')) {
        assert.equal(isImage(mime), true, `expected ${mime} to classify as image`);
      }
    }
  });

  test('returns false for non-image mimes', () => {
    assert.equal(isImage('application/pdf'), false);
    assert.equal(isImage('text/plain'), false);
    assert.equal(isImage(''), false);
  });
});

describe('buildInjectedPayload', () => {
  test('single path + message → `@path message`', () => {
    const out = buildInjectedPayload(['/tmp/foo.png'], 'Describe this screenshot');
    assert.equal(out, '@/tmp/foo.png Describe this screenshot');
  });

  test('multiple paths + message → each prefixed with @, space-joined', () => {
    const out = buildInjectedPayload(
      ['/a.png', '/b.pdf', '/c.txt'],
      'Compare these three',
    );
    assert.equal(out, '@/a.png @/b.pdf @/c.txt Compare these three');
  });

  test('paths only, no message → bare @paths string', () => {
    const out = buildInjectedPayload(['/tmp/only.png'], '   ');
    assert.equal(out, '@/tmp/only.png');
  });

  test('message only, no paths → trimmed message', () => {
    const out = buildInjectedPayload([], '  just text  ');
    assert.equal(out, 'just text');
  });

  test('empty paths + empty message → empty string', () => {
    assert.equal(buildInjectedPayload([], ''), '');
    assert.equal(buildInjectedPayload([], '   '), '');
  });

  test('message trimmed before joining — leading/trailing whitespace stripped', () => {
    const out = buildInjectedPayload(['/x.md'], '   hello   ');
    assert.equal(out, '@/x.md hello');
  });
});

// Integration-ish sanity check: we should be able to construct a
// browser-standard File + pass it through validation. Covers the
// "client-side reject before upload" contract the team-lead spec
// asked for.
describe('client-side pre-upload reject', () => {
  test('a 6 MB image File fails validateStagedFile before any network call', () => {
    const blob = new Blob([new Uint8Array(6 * 1024 * 1024)], { type: 'image/png' });
    const file = new File([blob], 'big.png', { type: 'image/png' });
    const err = validateStagedFile(file);
    assert.ok(err, 'oversized file must not be accepted');
    assert.match(err!, /too large/i);
  });

  test('a 3 KB text File passes validateStagedFile', () => {
    const file = new File(['hello world'], 'notes.txt', { type: 'text/plain' });
    assert.equal(validateStagedFile(file), null);
  });
});
