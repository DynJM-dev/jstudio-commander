// Byte-exact OSC 133 parser per ARCHITECTURE_SPEC v1.2 §5.2 + OS §24.1.
//
// Semantic shape constraint (OS §24.1 — state at match site):
//   OSC 133 markers are structural signals emitted by the bundled zsh hook
//   (resources/osc133-hook.sh). The parser matches BYTE-EXACT sequences:
//     ESC ']' '1' '3' '3' ';' <marker> (';' <params>)? ST
//   where:
//     ESC = 0x1b, ']' = 0x5d, ';' = 0x3b
//     <marker> ∈ { 'A', 'B', 'C', 'D' }  (VSCode shell-integration flavor)
//     ST      = BEL (0x07) OR ESC '\' (0x1b 0x5c)
//
//   There is no "shape matching" against arbitrary prompt text. If upstream
//   emits different glyphs, we simply don't match — the parser is invulnerable
//   to the Candidate 26 / Issue 8 P0 glyph-drift class by construction.
//
// The parser is stateful because data arrives in arbitrary chunks — an OSC
// sequence can be split mid-sequence across two pty.onData calls. We buffer
// the partial prefix across calls.

export type OscMarker = 'A' | 'B' | 'C' | 'D';

export interface Osc133Event {
  marker: OscMarker;
  params: string; // raw parameter string after the marker (e.g. "0" for D;0)
  exitCode: number | null; // parsed from D;<n>; null for A/B/C
  raw: string; // full matched sequence including ESC/ST, for tests + debugging
  byteOffset: number; // offset into the cumulative stream where the sequence started
}

const ESC = 0x1b;
const OPEN = 0x5d; // ']'
const BEL = 0x07;
const BACKSLASH = 0x5c;
const SEMI = 0x3b;

const OSC133_PREFIX = Buffer.from('133;', 'ascii');

enum State {
  Idle = 0, // scanning for ESC
  AfterEsc, // saw ESC, expecting ']'
  Collecting, // inside OSC, collecting bytes until ST
}

export interface ParserOptions {
  maxOscBytes?: number; // hard cap to avoid runaway buffers (default 4096)
}

export class Osc133Parser {
  private state = State.Idle;
  private buf: number[] = [];
  private startOffset = 0;
  private globalOffset = 0;
  private pendingEscInBuf = false; // last byte in buf was ESC, possibly start of ESC\ ST
  private readonly maxOscBytes: number;

  constructor(opts: ParserOptions = {}) {
    this.maxOscBytes = opts.maxOscBytes ?? 4096;
  }

  /**
   * Feeds a chunk of pty output. Returns the list of complete OSC 133 events
   * detected within this chunk (plus any previously-buffered partial).
   * Markers remain in the forwarded data stream — this parser does NOT strip
   * them (xterm.js ignores them for rendering per §6.3).
   */
  feed(chunk: Buffer | string): Osc133Event[] {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    const events: Osc133Event[] = [];

    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]!;
      const offset = this.globalOffset + i;

      switch (this.state) {
        case State.Idle: {
          if (b === ESC) {
            this.state = State.AfterEsc;
            this.startOffset = offset;
          }
          break;
        }
        case State.AfterEsc: {
          if (b === OPEN) {
            this.state = State.Collecting;
            this.buf.length = 0;
            this.pendingEscInBuf = false;
          } else if (b === ESC) {
            // consecutive ESCs — reset anchor, stay in AfterEsc
            this.startOffset = offset;
          } else {
            // not an OSC start — abandon.
            this.state = State.Idle;
          }
          break;
        }
        case State.Collecting: {
          // Detect String Terminator: BEL or ESC \.
          if (b === BEL) {
            const evt = this.tryFinish();
            if (evt) events.push(evt);
            this.state = State.Idle;
            this.buf.length = 0;
            this.pendingEscInBuf = false;
            break;
          }
          if (this.pendingEscInBuf && b === BACKSLASH) {
            // Two-byte ST sequence; drop the trailing ESC we already pushed.
            this.buf.pop();
            const evt = this.tryFinish();
            if (evt) events.push(evt);
            this.state = State.Idle;
            this.buf.length = 0;
            this.pendingEscInBuf = false;
            break;
          }
          this.buf.push(b);
          this.pendingEscInBuf = b === ESC;
          if (this.buf.length > this.maxOscBytes) {
            // Give up on a runaway sequence — clear state.
            this.state = State.Idle;
            this.buf.length = 0;
            this.pendingEscInBuf = false;
          }
          break;
        }
      }
    }

    this.globalOffset += bytes.length;
    return events;
  }

  /** Called at end of chunk when ST (BEL or ESC\) was just consumed. */
  private tryFinish(): Osc133Event | null {
    const body = Buffer.from(this.buf);
    if (body.length < OSC133_PREFIX.length) return null;
    for (let i = 0; i < OSC133_PREFIX.length; i++) {
      if (body[i] !== OSC133_PREFIX[i]) return null;
    }
    // body: "133;<marker>[;<params>]"
    const rest = body.subarray(OSC133_PREFIX.length);
    if (rest.length === 0) return null;
    const markerByte = rest[0]!;
    const marker = String.fromCharCode(markerByte);
    if (marker !== 'A' && marker !== 'B' && marker !== 'C' && marker !== 'D') return null;
    let params = '';
    if (rest.length >= 2 && rest[1] === SEMI) {
      params = rest.subarray(2).toString('ascii');
    } else if (rest.length > 1) {
      // Extra bytes without a ';' separator — unexpected. Reject.
      return null;
    }
    let exitCode: number | null = null;
    if (marker === 'D' && params.length > 0) {
      // D;<exit>;<optional more> — we take the first ';'-delimited field.
      const first = params.split(';')[0] ?? '';
      const parsed = Number.parseInt(first, 10);
      if (Number.isFinite(parsed)) exitCode = parsed;
    }
    return {
      marker: marker as OscMarker,
      params,
      exitCode,
      raw: `\x1b]${body.toString('ascii')}\x07`,
      byteOffset: this.startOffset,
    };
  }

  reset(): void {
    this.state = State.Idle;
    this.buf.length = 0;
    this.pendingEscInBuf = false;
    this.startOffset = 0;
  }
}
