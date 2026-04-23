// PTY spawn environment — UTF-8 locale mandated per KB-P4.2 (secondary mojibake
// candidate) and baked in from N1 so the N3 PTY spawn path never launches with
// a C/POSIX inherited locale. Not exercised by a real PTY in N1; unit-tested
// only. Wrap user-supplied env last so callers can't accidentally override.

export interface PtySpawnEnv {
  LANG: string;
  LC_ALL: string;
  [key: string]: string;
}

/**
 * Build the canonical PTY spawn env. UTF-8 locale is non-overridable — callers
 * who need a different locale should file a deviation; broken mojibake on
 * xterm is not a regression worth the flexibility.
 *
 * @param extra Additional env entries. UTF-8 locale keys are always enforced
 *   regardless of what `extra` contains.
 */
export function buildPtyEnv(extra: Record<string, string | undefined> = {}): PtySpawnEnv {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(extra)) {
    if (typeof v === 'string') merged[k] = v;
  }
  return {
    ...merged,
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
  };
}
