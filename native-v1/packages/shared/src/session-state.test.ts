// Unit tests for the pure-function SessionState helpers. These live in
// packages/shared so both sidecar and frontend consume the same verified
// mapping.
/// <reference types="vitest" />
import { describe, it, expect } from 'vitest';
import {
  resolveActionLabel,
  stateKindToColor,
  type SessionState,
} from './session-state.js';

describe('resolveActionLabel', () => {
  it('active → "Ready"', () => {
    expect(resolveActionLabel({ kind: 'active', since: 0 })).toBe('Ready');
  });

  it('working without tool → "Running command"', () => {
    expect(
      resolveActionLabel({ kind: 'working', commandStartedAt: 0 }),
    ).toBe('Running command');
  });

  it('working with tool → "Running <tool>"', () => {
    expect(
      resolveActionLabel({ kind: 'working', commandStartedAt: 0, toolInProgress: 'bash' }),
    ).toBe('Running bash');
  });

  it('waiting → "Waiting for approval"', () => {
    expect(resolveActionLabel({ kind: 'waiting', since: 0 })).toBe(
      'Waiting for approval',
    );
  });

  it('idle → "Idle at prompt"', () => {
    expect(resolveActionLabel({ kind: 'idle', sinceCommandEndedAt: 0 })).toBe(
      'Idle at prompt',
    );
  });

  it('stopped exit 0 → "Stopped"', () => {
    expect(resolveActionLabel({ kind: 'stopped', exitCode: 0, at: 0 })).toBe(
      'Stopped',
    );
  });

  it('stopped exit non-zero → "Stopped (exit N)"', () => {
    expect(resolveActionLabel({ kind: 'stopped', exitCode: 127, at: 0 })).toBe(
      'Stopped (exit 127)',
    );
  });

  it('error → "Error: <message>"', () => {
    expect(resolveActionLabel({ kind: 'error', message: 'oops', at: 0 })).toBe(
      'Error: oops',
    );
  });
});

describe('stateKindToColor', () => {
  it('maps kinds to semantic colors', () => {
    expect(stateKindToColor('active')).toBe('neutral');
    expect(stateKindToColor('working')).toBe('active');
    expect(stateKindToColor('waiting')).toBe('warning');
    expect(stateKindToColor('idle')).toBe('success');
    expect(stateKindToColor('stopped')).toBe('neutral');
    expect(stateKindToColor('error')).toBe('danger');
  });
});

describe('SessionState exhaustiveness', () => {
  // If a new kind is added, TypeScript will fail to compile this file because
  // the switch falls through. This is the OS §24 exhaustive-union discipline
  // applied to the state machine.
  it('resolveActionLabel exhaustively covers every kind', () => {
    const kinds: Array<SessionState['kind']> = [
      'active',
      'working',
      'waiting',
      'idle',
      'stopped',
      'error',
    ];
    for (const kind of kinds) {
      const state = sampleForKind(kind);
      expect(typeof resolveActionLabel(state)).toBe('string');
      expect(typeof stateKindToColor(state.kind)).toBe('string');
    }
  });
});

function sampleForKind(kind: SessionState['kind']): SessionState {
  switch (kind) {
    case 'active':
      return { kind: 'active', since: 0 };
    case 'working':
      return { kind: 'working', commandStartedAt: 0 };
    case 'waiting':
      return { kind: 'waiting', since: 0 };
    case 'idle':
      return { kind: 'idle', sinceCommandEndedAt: 0 };
    case 'stopped':
      return { kind: 'stopped', exitCode: 0, at: 0 };
    case 'error':
      return { kind: 'error', message: '', at: 0 };
  }
}
