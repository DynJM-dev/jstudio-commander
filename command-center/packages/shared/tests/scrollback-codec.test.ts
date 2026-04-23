import { describe, expect, it } from 'vitest';
import {
  decodeScrollbackBase64,
  encodeScrollbackBase64,
  roundTripBase64,
} from '../src/scrollback-codec';

/**
 * Byte-for-byte round-trip cases drawn from the v1 N2.1.6 Bug K mojibake
 * signature — em-dash, bullet, box-drawing, Braille, CJK. If ANY case fails,
 * the codec is corrupting UTF-8 bytes somewhere in the chain.
 */
const CASES: Array<{ label: string; content: string }> = [
  { label: 'ascii', content: 'hello world\n' },
  { label: 'em-dash', content: 'one — two — three' },
  { label: 'bullet', content: '• item 1\n• item 2' },
  { label: 'box-drawing', content: '┌─┐\n│█│\n└─┘' },
  { label: 'braille (Claude spinner chars)', content: '⠁⠂⠄⠈⠐⠠⡀⢀' },
  { label: 'CJK', content: '你好世界 こんにちは 안녕하세요' },
  { label: 'emoji (surrogate pairs)', content: '🚀 shipped 🎉 launched' },
  {
    label: 'mixed ANSI + UTF-8',
    content: '\x1b[1;32m✓\x1b[0m done — pending: \x1b[33m⚠\x1b[0m',
  },
];

describe('scrollback-codec (KB-P4.2 mojibake discipline)', () => {
  for (const { label, content } of CASES) {
    it(`round-trips "${label}" byte-for-byte`, () => {
      const input = new TextEncoder().encode(content);
      const output = roundTripBase64(input);
      expect(output.length).toBe(input.length);
      for (let i = 0; i < input.length; i += 1) {
        expect(output[i]).toBe(input[i]);
      }
      const decoded = new TextDecoder('utf-8').decode(output);
      expect(decoded).toBe(content);
    });
  }

  it('encode produces ASCII-only base64 safe for SQLite TEXT binding', () => {
    const bytes = new TextEncoder().encode('unsafe\x00bytes\xff\xfe');
    const encoded = encodeScrollbackBase64(bytes);
    expect(encoded).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('decode returns a Uint8Array (not a string) — load-bearing for term.write', () => {
    const encoded = encodeScrollbackBase64(new Uint8Array([0xe2, 0x80, 0x94])); // em-dash in UTF-8
    const decoded = decodeScrollbackBase64(encoded);
    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(Array.from(decoded)).toEqual([0xe2, 0x80, 0x94]);
  });
});
