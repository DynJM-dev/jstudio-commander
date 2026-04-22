# N2.1.4 Hotfix Dispatch — Bootstrap Autosend + Pane Input Routing

**Dispatch ID:** N2.1.4
**From:** CTO
**To:** PM → continuing CODER
**Depends on:** N2.1.3 PARTIAL (11 PASS + 1 PASS-with-bug + 1 PARTIAL + 2 UNVERIFIED), SMOKE_DISCIPLINE.md v1.0, ARCHITECTURE_SPEC v1.2
**Triggered by:** Jose's N2.1.3 smoke — Bug D (bootstrap doesn't autosend), Bug E (pane 2 input routes to chat textbox not terminal).
**Duration:** 0.25-0.5 day continuing CODER at xhigh. Budget $150-300.

---

## §0 — Scope rationale

Two bugs, different layers:
- **Bug D — sidecar-side.** Bootstrap content lands in terminal input line without auto-submit. Sidecar's `pty.stdin` write timing or newline shape is wrong.
- **Bug E — frontend-side.** Pane 2's typed input routes to wrong element. Frontend focus-state or event-routing wiring is wrong.

**PM considered fold-into-N3.** Rejected because:
1. D violates OS §23.3 bootstrap injection invariant (Item 3 sacred adjacent). Can't close before dogfood window.
2. E violates N2 §1.4 per-pane isolation acceptance. Regression against shipped acceptance.
3. Neither layer overlaps with N3's ChatThread/renderer/event-bus work. No structural coupling benefit from bundling.

Two bugs, two parallel diagnoses, two fixes, one smoke pass. Narrow.

---

## §1 — Acceptance criteria (SMOKE_DISCIPLINE.md compliant)

**1.1 — Bootstrap autosends on all PM and Coder session spawns.** Spawn PM session from Finder-launched `.app`. Observe: bootstrap content appears in terminal as if typed by user, ends with newline, AND submits to Claude Code WITHOUT Jose pressing Enter. Jose's first typed keystroke goes to Claude Code as a fresh message, NOT concatenated with bootstrap.

Same for Coder. Raw unchanged (no bootstrap, no autosend expected).

**1.2 — Per-pane input routing correct.** Open split view with 2-3 active sessions. Click pane 2's terminal area to focus it. Type. Text routes to pane 2's pty only. Pane 1 and pane 3 receive no keystrokes. Focus cycling via Cmd+Opt+→/← routes subsequent keystrokes to newly-focused pane.

**1.3 — N2.1.3 §3.3 16-step smoke passes including previously-blocked steps 11-12** (OSC 133 marker + sidebar live status, confounded by Bug D in N2.1.3).

**1.4 — No regression** on N1/N2/N2.1.1/N2.1.2/N2.1.3 held behaviors.

---

## §2 — Tasks

### Task 1 — Diagnose Bug D (bootstrap autosend)

**Evidence gathering:**
- Reproduce in `pnpm build:app:debug`. Open sidecar debug log + webview DevTools.
- Spawn PM session. Observe sidecar-side: what exact bytes are written to `pty.stdin`? Is there a trailing `\n`? What's the timing relative to OSC 133 `A` marker (zsh ready for input)?
- Observe terminal-side: where does the bootstrap content land? Input line (unsubmitted) or submitted to Claude Code?

**Hypotheses (likely root causes):**
- **H1 — Missing newline.** Bootstrap file content read, written to pty.stdin, but trailing `\n` stripped during read OR not appended. User's first Enter concatenates with buffered bootstrap input.
- **H2 — Bootstrap written before Claude Code ready.** Write lands in zsh input buffer but Claude Code not yet boot-complete → Enter triggers zsh to execute bootstrap AS A SHELL COMMAND, failing or racing.
- **H3 — Bootstrap written to zsh but Claude Code not yet invoked.** Wrong moment in the shell spawn → `claude` command invocation sequence. Bootstrap should land after `claude` exec's stdin is ready.
- **H4 — `\r\n` vs `\n` issue.** Bootstrap submitted but zsh line discipline treats it as input-line content not command.

**Task 1 completes with evidence commit** at `native-v1/docs/diagnostics/N2.1.4-bootstrap-autosend-evidence.md` per G10. Commit message per G11: "diagnostic: bootstrap content in terminal input line without autosend (pty.stdin timing/shape layer)".

**Effort:** 0.1 day.

### Task 2 — Fix Bug D

Fix per Task 1 evidence. Likely fix shapes:

- **If H1:** ensure bootstrap content ends with `\n` before pty.stdin.write. Defensive: trim trailing whitespace then append `\n`. One-line sidecar change.
- **If H2/H3:** fix the "activity-gap ready detection" for bootstrap injection timing. Bootstrap must write AFTER Claude Code is ready for input, not after zsh is ready. Signal: OSC 133 `A` marker emitted by Claude Code's inner shell, or specific output pattern indicating Claude Code boot complete.
- **If H4:** normalize line endings in bootstrap write.

**Acceptance per §1.1:** PM and Coder spawns autosend bootstrap reliably. Jose's first keystroke is a fresh message.

**Effort:** 0.1-0.2 day.

### Task 3 — Diagnose Bug E (pane input routing)

**Evidence gathering:**
- Reproduce in build:app:debug with 2 sessions in split view.
- Click pane 2 terminal area. Type. Observe where keystrokes land via webview DevTools event log.
- Check React component tree: which component has keyboard focus? What's the `onKeyDown` / `onData` handler bound to?

**Hypotheses:**
- **H1 — Focus state not propagating to xterm.js.** Zustand `focusedPaneIndex` is updated on pane click, but xterm.js `focus()` method not called OR called on wrong instance.
- **H2 — Global keydown listener capturing before xterm.js.** A window-level or app-level event handler (e.g., for global shortcuts, or a chat textbox that exists in the pane above xterm.js) is capturing keystrokes.
- **H3 — Chat textbox overlay.** If there's a ChatThread-precursor or placeholder textbox visible in pane 2's layout that shouldn't be focused by default, it may be stealing focus on pane activation.

**Task 3 completes with evidence commit** per G10/G11: "diagnostic: pane 2 keystrokes route to wrong element (frontend focus-propagation layer)".

**Effort:** 0.1 day.

### Task 4 — Fix Bug E

Fix per Task 3 evidence. Likely scope:
- Call `xterm.focus()` on focused pane's terminal instance when pane activates.
- Ensure no stray textbox elements intercept keystrokes when terminal is focused.
- Verify pane-click → focus propagation → xterm.js focus chain is unbroken.

**Acceptance per §1.2:** clicking pane 2 focuses pane 2's terminal; keystrokes route there only.

**Effort:** 0.1 day.

### Task 5 — PHASE_REPORT + Jose user-facing smoke

CODER files PHASE_N2.1.4_REPORT with SMOKE_DISCIPLINE §5 format. §3 PENDING for Jose smoke.

Jose runs N2.1.1 §3.3 16-step smoke. PM appends outcome.

**Effort:** 0.05 day CODER + ~15 min Jose.

---

## §3 — Explicit non-scope

- Bug F (unmapped `away_summary` system event subtype) → N3 renderer registry.
- Obs G (plain-zsh vs rich web-Commander UI) → N3 ChatThread.
- Any new UI polish surfaced during this rotation → N3 or dedicated UI polish phase.

If CODER encounters scope temptation, report in §4/§6, don't fix.

---

## §4 — Guardrails

Inherited G1-G12. Particularly:
- **G10 — Root-cause before fix.** Task 1 evidence commits before Task 2. Task 3 evidence before Task 4. Two separate diagnostic commits; two separate fix commits.
- **G11 — Smoke layer naming.** Bugs D and E are at different layers; diagnostic commits must name them distinctly.
- **G12 — Dep hygiene.** If any new deps added, same-commit declarations.

---

## §5 — Required reading

1. This dispatch.
2. SMOKE_DISCIPLINE.md v1.0.
3. `native-v1/docs/phase-reports/PHASE_N2.1.3_REPORT.md` §3 user-facing smoke outcome.
4. `apps/sidecar/src/pty/bootstrap.ts` (Bug D touch point).
5. `apps/frontend/src/components/SessionPane.tsx` + focus-related Zustand store (Bug E touch point).

---

## §6 — Jose's TODO

1. Save to `~/Desktop/Projects/jstudio-commander/docs/dispatches/N2_1_4_DISPATCH_BOOTSTRAP_AUTOSEND_AND_PANE_ROUTING.md`.
2. Paste in PM: "N2.1.4 dispatch saved."
3. PM produces paste-to-CODER.
4. Continuing CODER executes. ~0.25-0.5 day.
5. Jose runs 16-step smoke.
6. PM appends outcome.
7. **If 16/16 AND no new critical bugs from the exhaustive N2.1.3 Task 4 sweep findings:** dogfood window starts (3-5 days real use). N3 scope review after.
8. **If <16/16:** CTO scopes next move.

---

**End of dispatch.**
