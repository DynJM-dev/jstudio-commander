import { describe, expect, it } from 'vitest';
import { buildPtyEnv } from '../src/pty-env';

describe('buildPtyEnv (KB-P4.2 UTF-8 locale discipline)', () => {
  it('always sets LANG + LC_ALL to en_US.UTF-8 with no extras', () => {
    const env = buildPtyEnv();
    expect(env.LANG).toBe('en_US.UTF-8');
    expect(env.LC_ALL).toBe('en_US.UTF-8');
  });

  it('enforces UTF-8 locale even when caller tries to override', () => {
    const env = buildPtyEnv({ LANG: 'C', LC_ALL: 'POSIX', PATH: '/usr/bin' });
    expect(env.LANG).toBe('en_US.UTF-8');
    expect(env.LC_ALL).toBe('en_US.UTF-8');
    expect(env.PATH).toBe('/usr/bin');
  });

  it('preserves unrelated env entries passed in extra', () => {
    const env = buildPtyEnv({
      PATH: '/usr/local/bin:/usr/bin',
      CLAUDE_DEBUG: '1',
      HOME: '/tmp/jose',
    });
    expect(env.PATH).toBe('/usr/local/bin:/usr/bin');
    expect(env.CLAUDE_DEBUG).toBe('1');
    expect(env.HOME).toBe('/tmp/jose');
  });

  it('filters undefined env values (node Process.env shape)', () => {
    const env = buildPtyEnv({ DEFINED: 'yes', MISSING: undefined });
    expect(env.DEFINED).toBe('yes');
    expect(env.MISSING).toBeUndefined();
  });
});
