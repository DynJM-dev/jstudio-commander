// Unit tests for ensureZdotdir + generated .zshrc contents.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureZdotdir } from './hook-path.js';

describe('ensureZdotdir', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'hook-test-'));
    process.env.JSTUDIO_ZDOTDIR = tmp;
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.JSTUDIO_ZDOTDIR;
  });

  it('default mode (sourceUserRc=false) produces hook-only .zshrc', () => {
    const { zdotdir, hookPath } = ensureZdotdir();
    expect(zdotdir).toBe(tmp);
    const content = readFileSync(join(tmp, '.zshrc'), 'utf8');
    expect(content).toContain(hookPath);
    expect(content).not.toContain('$HOME/.zshrc');
  });

  it('sourceUserRc=true inlines ~/.zshrc guarded load', () => {
    const { hookPath } = ensureZdotdir({ sourceUserRc: true });
    const content = readFileSync(join(tmp, '.zshrc'), 'utf8');
    expect(content).toContain(hookPath);
    expect(content).toContain('if [ -f "$HOME/.zshrc" ]');
    expect(content).toContain('source "$HOME/.zshrc"');
    // Errors swallowed so fatal user rc doesn't kill the OSC 133 hook.
    expect(content).toContain('2>/dev/null || true');
  });

  it('is idempotent — second call with same opts does not rewrite', () => {
    ensureZdotdir({ sourceUserRc: true });
    const first = readFileSync(join(tmp, '.zshrc'), 'utf8');
    ensureZdotdir({ sourceUserRc: true });
    const second = readFileSync(join(tmp, '.zshrc'), 'utf8');
    expect(second).toBe(first);
  });

  it('rewrites when sourceUserRc flips', () => {
    ensureZdotdir({ sourceUserRc: false });
    const before = readFileSync(join(tmp, '.zshrc'), 'utf8');
    ensureZdotdir({ sourceUserRc: true });
    const after = readFileSync(join(tmp, '.zshrc'), 'utf8');
    expect(after).not.toBe(before);
    expect(after).toContain('source "$HOME/.zshrc"');
  });
});
