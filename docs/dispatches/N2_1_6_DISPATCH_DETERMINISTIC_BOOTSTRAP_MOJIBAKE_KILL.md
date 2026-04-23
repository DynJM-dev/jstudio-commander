# N2.1.6 Hotfix Dispatch — Deterministic Bootstrap + Mojibake Fix + Kill-Session

**Dispatch ID:** N2.1.6
**From:** CTO
**To:** PM → continuing CODER
**Depends on:** N2.1.5 PARTIAL, SMOKE_DISCIPLINE.md v1.0, ARCHITECTURE_SPEC v1.2
**Triggered by:** Jose's N2.1.5 smoke — Bug D timer still races on cold boot, Bug K mojibake surfaces with progressive degradation, kill-session gap blocks dogfood readiness.

---

## §0 — Pre-dispatch reality check (PM action before CODER spawns)

Before forwarding this to CODER, PM runs `pnpm build:app:debug` and verifies:

1. `sessions.scrollbackBlob` column exists in the live schema (confirm via `sqlite3 ~/.jstudio-commander-v1/commander.db ".schema sessions"`).
2. DELETE /api/sessions/:id endpoint exists OR is flagged missing (check Fastify route registration in sidecar).
3. OSC 133 parser emits `command:started` event at markers other than `B` — specifically, does it detect `A` (PromptStart) from Claude Code's inner shell context, not just the outer zsh?

If any of these assumptions are wrong, flag to CTO before CODER spawns. First use of the pre-dispatch reality check I committed to. Five minutes, saves a rotation if I'm drafting against stale state.

---

## §0.1 — PM reality-check findings (2026-04-22, Jose pre-approved the §2 patch below)

1. **HOLDS (minor note)** — live schema column is snake_case `scrollback_blob BLOB`; Drizzle likely exposes it as `scrollbackBlob` at the TS layer. Flagging for CODER's search literals.
2. **HOLDS** — DELETE endpoint exists at `apps/sidecar/src/routes/sessions.ts:128` but is the "incomplete / orphan-leaving" branch CTO's §2 Task 3 already anticipates. `orchestrator.stopSession()` only calls `handle.kill('SIGTERM')` — no await-exit, no SIGKILL fallback, no DB row removal, no `session:stopped` emission. Task 3 scope unchanged.
3. **DOES NOT HOLD** — `resources/osc133-hook.sh` installs into the outer zsh's `precmd`/`preexec` via `add-zsh-hook`. Claude Code is a child TUI inside zsh and does not source the hook. Observable 133 sequence during a session is: `A`/`D` from outer zsh BEFORE `claude` execs, `B` from outer zsh after Enter runs `claude`, then silence for the lifetime of Claude Code, then `D`+`A` again after claude exits. "Wait for OSC 133 A from Claude's inner shell" is not an available signal.

**PM-authored patch to §2 Task 1** (Jose pre-approved, CTO notified for ratification in next sync): deterministic-signal preference ordering revised to demote the non-available option and promote the already-listed fallback. Change is noted inline in §2 Task 1 below. No other sections patched.

---

## §1 — Acceptance criteria

**1.1 — Bootstrap autosends on first cold-launch, deterministic.** Full machine cold-boot. `pnpm build:app:debug`. Finder-launch. Spawn PM session immediately. Bootstrap autosends regardless of Claude Code boot latency (tested 5+ cold spawns across varied system load).

**1.2 — No character mojibake in any session, at any point.** Spawn session. Let Claude Code produce output with special characters (em-dashes, bullets, bracket glyphs, box-drawing). Switch to another session. Switch back. Close app. Reopen. Scrollback contents display identical characters to original render. No `â` / `â¢` / `âµ` sequences anywhere, ever.

**1.3 — Kill session from UI.** Each session has a visible kill affordance (× button on SessionCard, or menu item on right-click, or pane header control — CODER picks). Clicking it: confirmation modal appears ("Stop and remove session X? Cannot be undone."). On confirm: pty SIGTERMed, DB row removed, session disappears from sidebar + any pane it was assigned to. No orphans remain.

**1.4 — N2.1.1 §3.3 16-step smoke passes.**

**1.5 — No regression** on N2.1.4 pane input routing, N2.1.5 layout-race fix, or any prior held behavior.

---

## §2 — Tasks

### Task 1 — Bug D: deterministic bootstrap-ready signal

Replace time-based `onQuiet` timer with signal-based "Claude Code ready" detection.

**Diagnostic first (G10, empty evidence commit):**
- Spawn PM session in build:app:debug. Capture sidecar debug log of every pty output byte from spawn to first-Enter.
- Identify a deterministic signal that fires AFTER Claude Code is ready for paste-buffer commit.

**[PM-PATCHED 2026-04-22 per §0.1 reality-check]** Signal preference ordering (revised after PM confirmed OSC 133 A is not emitted by Claude's inner shell — hook installs into outer zsh only, claude-TUI lifetime is OSC-silent):

1. **PRIMARY — Claude Code's bracketed-paste-mode enable sequence (`\e[?2004h`).** Claude Code emits this when the TUI is ready to accept input. Deterministic, upstream-owned, well-defined. Match byte-exact in the pty output stream.
2. **SECONDARY — specific boot-complete text pattern** (e.g., `"Welcome to Claude"`, model banner line, or `"/effort"` footer render). CODER picks most stable upstream string at diagnosis time.
3. **NOT AVAILABLE — OSC 133 A from Claude's inner shell.** Do not pursue. PM-verified in §0.1: hook is outer-zsh-only; claude doesn't source it. 133 A only fires before claude exec'd or after claude exits — too early and too late respectively.

**Fix:**
- Implement `waitForClaudeReady(pty, timeoutMs = 30000)` helper. Returns when deterministic signal observed. Falls back to timeout with `system:warning` event ("Claude Code boot signal not observed within 30s; attempting bootstrap write anyway — report to Jose if bootstrap fails").
- Bootstrap inject sequence becomes: pty spawn → `waitForClaudeReady()` → bracketed-paste bootstrap write → `\r`.

**If Task 1 diagnosis reveals `\e[?2004h` doesn't reliably fire at paste-ready time:** fall back to Secondary (boot-complete text pattern) with PHASE_REPORT §8 note for CTO ratification.

### Task 2 — Bug K: UTF-8 mojibake fix

**Diagnostic first (G10, empty evidence commit, G14 permitted):**
- Reproduce mojibake: spawn session, output special chars, switch sessions, observe corruption, restart app, observe worsening.
- Audit scrollback serialize/deserialize path: `apps/sidecar/src/pty/` OR wherever `scrollbackBlob` is written/read. Check encoding explicitness at every `Buffer` → `string` conversion.
- G14 search: "xterm.js serialize-addon UTF-8 encoding" + "better-sqlite3 BLOB utf8" for upstream patterns.

**Narrowed candidates per PM analysis:**
- (a) scrollback_blob encoding round-trip — PRIMARY lean.
- (d) sidecar pty-output Buffer→string conversion — SECONDARY, may amplify (a).
- (b) PTY locale/charset — verify `LANG=en_US.UTF-8` and `LC_ALL=en_US.UTF-8` are set on pty spawn env; if not, add.

**Fix per evidence:**
- Likely: explicit `.toString('utf8')` at read, `Buffer.from(string, 'utf8')` at write for scrollback. Verify xterm.js `serialize-addon` output is UTF-8 (should be; verify).
- If PTY locale missing: add to spawn env.

**Acceptance:** per §1.2. Progressive degradation eliminated.

### Task 3 — Kill-session functional affordance

**Backend:**
- Verify `DELETE /api/sessions/:id` endpoint exists. If missing, add: SIGTERM pty, await exit up to 5s then SIGKILL, remove DB row, emit `session:stopped` event, return 200.
- If the endpoint exists but was incomplete (orphan-leaving), fix it to be complete.

**Frontend:**
- Add kill button to SessionCard (small × or "Stop" menu item) AND to pane header (× button with tooltip "Stop and remove session").
- Click → confirmation modal ("Stop session X? The terminal process will be killed and the session removed. Cannot be undone.") → confirm → DELETE call → optimistic UI removal → server reconcile.
- Session stays in sidebar briefly with "Stopping..." state if SIGTERM takes >1s; removes on server confirmation.

**Acceptance:** per §1.3.

### Task 4 — Smoke-readiness + PHASE_REPORT

Standard. CODER verifies build:app:debug reproduces a clean kill→respawn cycle, verifies no mojibake across 3 session-switches + 1 app-restart, verifies cold-launch bootstrap autosend across 3 machine reboots.

Jose runs 16-step smoke. PM appends outcome.

---

## §3 — Non-scope

- Bug J (cross-instance leak) — N3 Task 1 still.
- Bug F (away_summary), Obs G (plain-zsh UI) — N3.
- Any UI polish beyond kill-session functional affordance — N3 or UI phase.

---

## §4 — Guardrails

G1-G14 inherited. Particularly G10 (root-cause before fix), G11 (layer-naming in commits), G14 (G14 web search permitted on Bug K; state intent in §10).

---

## §5 — Required reading

1. This dispatch.
2. SMOKE_DISCIPLINE.md v1.0.
3. PHASE_N2.1.5_REPORT §3.
4. `apps/sidecar/src/pty/` (bootstrap + scrollback paths).
5. xterm.js serialize-addon docs on encoding.

---

**End of dispatch.**
