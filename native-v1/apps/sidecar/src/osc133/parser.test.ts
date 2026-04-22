// Byte-exact OSC 133 parser tests. Every case spells the byte sequence
// explicitly so a reader can see exactly what the parser is required to accept
// or reject. Per OS §24 discipline: tests state semantic shape up front.

import { describe, it, expect } from 'vitest';
import { Osc133Parser } from './parser.js';

const ESC = '\x1b';
const BEL = '\x07';
const ST = ESC + '\\';

describe('Osc133Parser — byte-exact matching', () => {
  it('parses A marker terminated by BEL', () => {
    const p = new Osc133Parser();
    const out = p.feed(`${ESC}]133;A${BEL}`);
    expect(out).toHaveLength(1);
    expect(out[0]!.marker).toBe('A');
    expect(out[0]!.exitCode).toBeNull();
  });

  it('parses A marker terminated by ESC \\', () => {
    const p = new Osc133Parser();
    const out = p.feed(`${ESC}]133;A${ST}`);
    expect(out).toHaveLength(1);
    expect(out[0]!.marker).toBe('A');
  });

  it('parses B marker (command-start) BEL-terminated', () => {
    const p = new Osc133Parser();
    const out = p.feed(`${ESC}]133;B${BEL}`);
    expect(out).toHaveLength(1);
    expect(out[0]!.marker).toBe('B');
  });

  it('parses D;0 marker with exit code', () => {
    const p = new Osc133Parser();
    const out = p.feed(`${ESC}]133;D;0${BEL}`);
    expect(out).toHaveLength(1);
    expect(out[0]!.marker).toBe('D');
    expect(out[0]!.exitCode).toBe(0);
  });

  it('parses D;127 marker with nonzero exit code', () => {
    const p = new Osc133Parser();
    const out = p.feed(`${ESC}]133;D;127${BEL}`);
    expect(out).toHaveLength(1);
    expect(out[0]!.marker).toBe('D');
    expect(out[0]!.exitCode).toBe(127);
  });

  it('handles sequence split across two feeds', () => {
    const p = new Osc133Parser();
    const a = p.feed(`${ESC}]133;D`);
    expect(a).toHaveLength(0);
    const b = p.feed(`;5${BEL}`);
    expect(b).toHaveLength(1);
    expect(b[0]!.marker).toBe('D');
    expect(b[0]!.exitCode).toBe(5);
  });

  it('handles sequence split at every byte boundary', () => {
    const p = new Osc133Parser();
    const s = `${ESC}]133;D;42${BEL}`;
    const events = [];
    for (const ch of s) events.push(...p.feed(ch));
    expect(events).toHaveLength(1);
    expect(events[0]!.exitCode).toBe(42);
  });

  it('emits A then B then D in the natural prompt→command→done sequence', () => {
    const p = new Osc133Parser();
    const stream = [
      `${ESC}]133;A${BEL}`,
      'ls\r\n',
      `${ESC}]133;B${BEL}`,
      'file1 file2\r\n',
      `${ESC}]133;D;0${BEL}`,
    ].join('');
    const out = p.feed(stream);
    expect(out.map((e) => e.marker)).toEqual(['A', 'B', 'D']);
    expect(out[2]!.exitCode).toBe(0);
  });

  it('ignores OSC sequences that are not 133', () => {
    const p = new Osc133Parser();
    // OSC 0 (window title) is extremely common and must not fire our parser.
    const out = p.feed(`${ESC}]0;my terminal title${BEL}`);
    expect(out).toHaveLength(0);
  });

  it('ignores unknown 133 sub-markers (e.g. 133;Z)', () => {
    const p = new Osc133Parser();
    const out = p.feed(`${ESC}]133;Z${BEL}`);
    expect(out).toHaveLength(0);
  });

  it('rejects a standalone `]133;A` without leading ESC', () => {
    const p = new Osc133Parser();
    const out = p.feed(`]133;A${BEL}`);
    expect(out).toHaveLength(0);
  });

  it('recovers from an interrupted OSC sequence followed by a clean one', () => {
    const p = new Osc133Parser();
    // Start an OSC, abandon with a lone ESC that re-anchors, then clean A.
    const events = p.feed(`${ESC}]garbage`);
    expect(events).toHaveLength(0);
    // Feed a full, clean A. Parser must still accept it.
    const later = p.feed(`${BEL}${ESC}]133;A${BEL}`);
    expect(later).toHaveLength(1);
    expect(later[0]!.marker).toBe('A');
  });

  it('drops runaway OSC exceeding maxOscBytes and resynchronizes', () => {
    const p = new Osc133Parser({ maxOscBytes: 16 });
    const junk = 'x'.repeat(100);
    const out1 = p.feed(`${ESC}]${junk}`); // never terminates, gets cleared
    expect(out1).toHaveLength(0);
    // Followup clean sequence should still parse.
    const out2 = p.feed(`${BEL}${ESC}]133;B${BEL}`);
    expect(out2).toHaveLength(1);
    expect(out2[0]!.marker).toBe('B');
  });

  it('tracks byteOffset of the OSC start in the cumulative stream', () => {
    const p = new Osc133Parser();
    const prefix = 'hello world';
    const sequence = `${ESC}]133;A${BEL}`;
    const out = p.feed(prefix + sequence);
    expect(out).toHaveLength(1);
    expect(out[0]!.byteOffset).toBe(prefix.length);
  });
});
