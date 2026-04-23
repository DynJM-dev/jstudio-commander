// scrollback_blob round-trip codec — prevents the v1 N2.1.6 Bug K mojibake
// class (UTF-8 bytes rendered as Latin-1 after DB round-trip). Keeps bytes-
// as-bytes through write → store → read → term.write. xterm.js v5+ decodes
// UTF-8 from Uint8Array natively.
//
// Two storage modes supported — BLOB (direct Uint8Array / Buffer) and base64
// TEXT. ARCHITECTURE_SPEC §3.2 specifies blob; N1 schema uses base64 TEXT
// because Drizzle's blob mode with bun:sqlite has a few open edges we don't
// exercise in N1. Either path round-trips byte-for-byte.

/**
 * Encode raw PTY byte output to base64 for TEXT storage.
 * Accepts either a Node Buffer or a Uint8Array. Output is ASCII — safe to
 * bind as a SQLite TEXT parameter regardless of driver.
 */
export function encodeScrollbackBase64(bytes: Uint8Array): string {
  // Buffer.from on a Uint8Array creates a view, not a copy (in Node/Bun).
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

/**
 * Decode base64-stored scrollback back to a Uint8Array suitable for
 * `term.write(bytes)` (xterm v5+ utf8-decodes Uint8Array internally).
 * Returning Uint8Array (not string) is the load-bearing discipline — this is
 * what prevents Bug K's "atob-then-term.write-string" pattern from resurfacing.
 */
export function decodeScrollbackBase64(blob: string): Uint8Array {
  const buf = Buffer.from(blob, 'base64');
  // Return a fresh copy, not a view into Buffer's pooled allocator.
  const out = new Uint8Array(buf.byteLength);
  out.set(buf);
  return out;
}

/**
 * Convenience helper for tests + debug introspection: encode-decode round
 * trip. If input == output byte-for-byte, the codec is safe for the bytes
 * you fed it.
 */
export function roundTripBase64(bytes: Uint8Array): Uint8Array {
  return decodeScrollbackBase64(encodeScrollbackBase64(bytes));
}
