# Phase U.1 — Fix 2 OvaGas false-positive investigation

Date: 2026-04-17 (coder-16)
Capture: `audits/PHASE_U1_PANE_59_CAPTURE.txt` (pane `%59`, 123 lines via `tmux capture-pane -S -100`)

## Root cause

Classifier false-positives `working` on an idle prompt because the
**Commander-installed statusline chrome** matches
`/\d+%/` in `ACTIVE_INDICATORS`.

### Trace through `classifyStatusFromPane`

The poller calls `capturePane(name, 25)` — only the last ~25 lines enter
the classifier. Relevant tail (final 8 lines — `hasActiveInTail(text, 8)`
window):

```
────────────────────────────────────────────── @coder ──
❯
────────────────────────────────────────────────────────
  Opus 4.7 │ ctx 33% │ 5h 46% │ 7d 35% │ $26.54
  ⏵⏵ bypass permissions on · 1 shell
(blank)
(blank)
```

Branch-by-branch (`agent-status.service.ts:classifyStatusFromPane`):
1. `ERROR_PATTERNS` — no match.
2. `hasNumberedChoiceInTail` / `hasNumberedChoiceBlock` — no.
3. **`hasActiveInTail(text, 8)` — returns TRUE** via `/\d+%/` on the
   line `  Opus 4.7 │ ctx 33% │ 5h 46% │ 7d 35% │ $26.54` (matches three
   times: `33%`, `46%`, `35%`).
4. Inside the active branch: `detectActivity` walks the last 12 lines
   looking for a spinner-glyph + capitalized-verb pattern. None match
   (the `✻ Cooked for 2m 51s` is at line 56 — outside the 12-line tail).
   So `activity = null`.
5. Falls through all verb-aware overrides (IDLE_VERBS / COMPLETION_VERBS
   / stale-elapsed) because those all require `activity` to be non-null.
6. Returns `{ status: 'working', evidence: 'active-indicator in tail' }`.

That's the live evidence string the team-lead observed post-Phase-U
(`Patch 2 force-idle → classifier active-indicator in tail → back to
working → force-idle again every ~5s`).

### Why `hasIdleFooter` doesn't save us

`hasIdleFooter` would trigger on `⏵⏵ accept edits on`, `? for shortcuts`,
`new task?`, `/clear to save`, `shift+tab to cycle`. But:

- This pane shows `⏵⏵ bypass permissions on` — not `accept edits on`.
- Even if `hasIdleFooter` matched, it's only checked AFTER
  `hasActiveInTail` in the branch order (line 292 before line 319), so
  the active-indicator short-circuit wins.

## Proposed targeted fix (exclusion-list approach — team-lead preference)

Add a `STATUSLINE_CHROME_MARKERS` regex list matching the known
statusline cells, and have `hasActiveInTail` skip lines that match any
of them BEFORE testing against `ACTIVE_INDICATORS` / `SPINNER_CHARS`.

```ts
// Phase U.1 Fix 2 — Claude Code's Commander-installed statusline
// permanently renders two chrome lines at pane bottom:
//   "Opus 4.7 │ ctx 33% │ 5h 46% │ 7d 35% │ $26.54"
//   "⏵⏵ bypass permissions on · 1 shell"
// These match generic ACTIVE_INDICATORS (/\d+%/ fires three times on
// the ctx/5h/7d row) but carry zero active-work signal. Strip them
// from the active-indicator scan.
const STATUSLINE_CHROME_MARKERS = [
  /ctx\s*\d+%/i,               // ctx 33%
  /\b\d+h\s+\d+%/i,            // 5h 46%, 7d 35% — covers both "5h" and "7d" rate-limit cells
  /⏵⏵\s+bypass permissions on/i,
  /⏵⏵\s+accept edits on/i,     // mirror of IDLE_FOOTER_MARKERS entry
];

const isStatuslineChrome = (line: string): boolean =>
  STATUSLINE_CHROME_MARKERS.some((re) => re.test(line));
```

Then in `hasActiveInTail`:

```ts
const hasActiveInTail = (text: string, n = 8): boolean => {
  const lines = text.split('\n').slice(-n);
  for (const line of lines) {
    if (isStatuslineChrome(line)) continue;  // NEW — skip chrome
    if ([...line].some((ch) => SPINNER_CHARS.includes(ch))) return true;
    for (const pattern of ACTIVE_INDICATORS) {
      if (pattern.test(line)) return true;
    }
  }
  return false;
};
```

### Why this is narrow + safe

- Does NOT touch `ACTIVE_INDICATORS` itself — real active-work signals
  ("47% complete", "Reading 123", "Searching", "Editing", "Writing") are
  all unaffected.
- Skips ONLY the two specific chrome line shapes that appear in every
  Commander-managed Claude Code pane.
- `ctx \d+%` and `\bNh \d+%` are extremely specific patterns — no real
  Claude Code verb text matches.
- `⏵⏵ bypass permissions on` mirrors the existing idle-footer marker
  for `accept edits on`; the two are just different modes of the same
  permission-policy footer.

### Test fixture

`/Users/josemiguelbonilla/Desktop/Projects/jstudio-commander/audits/PHASE_U1_PANE_59_CAPTURE.txt`
→ `classifyStatusFromPane(fixture)` must return status=`idle` post-fix.
Before-fix: returns `working` with evidence `active-indicator in tail`.

## Scope for Phase U.1 continuation

- Fix 1 — `force_idled_at` column + 60s cooldown in poller (UNSTARTED;
  see CODER_BRAIN Phase U.1 section for design).
- Fix 3 — oscillation telemetry (UNSTARTED; see CODER_BRAIN).
- Fix 2 — implement the STATUSLINE_CHROME_MARKERS + test above.
- Integration test: force-idle → cooldown → hook takeover.
- Post-ship: server restart, verify zero oscillation logs on
  `coder@ovagas-r2` within 60s.
