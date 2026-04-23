# N2.1.5 Hotfix Dispatch — Bootstrap Race + xterm.js Rendering + Status Stale

**Dispatch ID:** N2.1.5
**From:** CTO
**To:** PM → continuing CODER
**Depends on:** N2.1.4 PARTIAL, SMOKE_DISCIPLINE.md v1.0, ARCHITECTURE_SPEC v1.2
**Triggered by:** Jose's N2.1.4 smoke — Bug D partial (first-launch race), Bug H new (xterm.js mount artifacts), Bug I pending (status stale on ESC).
**Duration:** 0.5-1.5 day continuing CODER at xhigh. Budget $300-700.

---

## §0 — Scope

Three bugs, all local to native v1:

- **Bug D residual** — bootstrap autosend fails on first cold-launch spawn only; subsequent spawns clean. Race between 200ms `onQuiet` timer and Claude-TUI paste-buffer-ready signal on cold boot.
- **Bug H** — xterm.js visual rendering artifacts on initial mount. Text overlaps, line breaks wrong, self-repairs on first keystroke. Likely WebGL + fit-addon resize race.
- **Bug I** — status indicator showed "working" after ESC interrupt; Jose re-testing. If reproduces in Task 1 diagnosis, fix in Task 4. If doesn't reproduce, closed-not-reproduced.

**Bug J (cross-instance JSONL leak) DEFERRED to N3 Task 1.** Reasoning: manifests through WEB Commander's watcher picking up native v1's JSONL writes. Native v1's own JSONL watcher doesn't exist yet (lands in N3). Bug J's architectural fix (filesystem isolation via `--config-dir` or env-filter) is the same code that establishes N3's watcher — folding into N3 is cheaper than separate dispatch.

**Dogfood caveat for Jose:** if `[Request interrupted]` text appears in web PM chat that you didn't send, that's Bug J leaking from native v1's ESC. Ignore it. PM execution is not actually interrupted. Same pattern for any other stray text appearing in web PM chat during native v1 use. Temporary until N3 lands.

Bugs F + G + UI polish items (Max effort, kill-session affordance, layout) continue routed to N3 / UI phase.

---

## §1 — Acceptance criteria (SMOKE_DISCIPLINE.md compliant)

**1.1 — Bootstrap autosends on first cold-launch spawn, every session type, every time.** Reboot machine (or force-quit Commander + kill all relevant processes). `pnpm build:app:debug`. Finder-launch. Spawn PM session immediately. Bootstrap autosends. Spawn Coder session. Autosends. Quit. Re-launch cold. Repeat. 5 consecutive cold-launch first-spawns succeed.

**1.2 — xterm.js renders correctly on initial mount, no artifacts.** Finder-launch. Spawn any session. Terminal content appears clean from first render: no overlapping text, no wrong line breaks, no garbled layout. Repeat across 3 cold spawns to rule out timing variance.

**1.3 — Bug I resolution:** either closed-not-reproduced (CODER attempts reproduction during Task 1, fails to trigger) OR fixed (if reproduces, Task 4 addresses).

**1.4 — N2.1.1 §3.3 16-step smoke passes** including previously-unverified steps 11-12.

**1.5 — No regression** on any prior-phase held behavior.

---

## §2 — Tasks

### Task 1 — Diagnose (all three bugs, evidence commits per G10)

**Bug D residual — cold-launch race diagnosis:**
- Reproduce: fully quit Commander + all Claude processes, `pnpm build:app:debug`, Finder-launch, spawn PM session immediately, observe bootstrap fails to autosend.
- Trace in sidecar debug log: what order do events fire on cold-launch vs subsequent-launch? The `onQuiet` 200ms timer fires, but does `\r` commit write arrive BEFORE Claude-TUI is ready for paste-buffer commit?
- Likely root: Claude-TUI's paste-buffer-ready signal is downstream of pre-warm pool initialization, filesystem cache warmup, or Claude Code config load. On first launch these take longer; 200ms timer races them.
- **Hypothesis to verify:** replace time-based `onQuiet` with deterministic signal — wait for specific Claude-TUI output pattern (e.g., first `OSC 133 A` marker emitted from Claude's inner shell, or specific boot-complete text). If verified, `waitForClaudeReady()` helper replaces timer.

**Bug H — xterm.js rendering diagnosis:**
- Reproduce: Finder-launch, spawn session, immediately observe terminal for artifacts.
- Webview DevTools: inspect xterm.js DOM structure + canvas layer. Any resize events firing after initial render? fit-addon dimensions match actual container dimensions?
- Check: WebGL addon DPR (device-pixel-ratio) handling on initial mount. WKWebView DPR reporting may differ from standard Chromium; xterm.js WebGL addon may initialize with wrong cell metrics then correct on first redraw trigger.
- **External tooling permitted** (see §3 guardrails): xterm.js GitHub issues search for "WKWebView" OR "Tauri" OR "WebGL addon initial render". Known-issue search before reinventing diagnosis.
- Suggested diagnostic: temporarily disable `@xterm/addon-webgl`, verify canvas-renderer (default) doesn't exhibit artifacts. If canvas clean and WebGL artifacted → WebGL addon is root cause. If both artifacted → fit-addon or cell-metrics issue.

**Bug I — status stale on ESC:**
- Attempt reproduction: active session, send Claude a long-running prompt, press ESC during output. Observe status indicator immediately after ESC.
- If reproduces: trace typed state machine transitions. Does ESC emit an event that transitions session state to `{kind: 'idle'}` OR does state stay at `{kind: 'working'}` because the transition triggers on pty output cessation which happens after some latency?
- If doesn't reproduce after 3-5 attempts across different conditions: close as not-reproduced in PHASE_REPORT §5, no fix task.

**Separate diagnostic commits per bug** at `native-v1/docs/diagnostics/N2.1.5-{bug-d|bug-h|bug-i}-evidence.md`. Commit messages per G11 name the layer: "sidecar pty-write timing layer", "xterm.js WebGL render layer", "typed state machine layer".

**Sub-agent authorization:** CODER may spawn diagnostic sub-agents for Bug H (WebGL + WKWebView specificity may benefit from parallel investigation: one sub-agent inspects xterm.js source for DPR handling, another probes upstream issue tracker, main CODER runs reproduction). Sub-agent use is at CODER discretion; no pre-approval needed; report in PHASE_REPORT §10 metrics.

**Effort:** 0.25-0.5 day. Bug H may extend if WebGL/WKWebView interaction is novel.

### Task 2 — Fix Bug D residual

Fix per Task 1 evidence. Likely fix: replace `onQuiet` 200ms timer with deterministic "Claude-TUI ready" signal. Probably waits for first OSC 133 `A` from Claude's inner shell, or observable boot-complete pattern.

Preserve subsequent-launch behavior (current 200ms timer works there — don't break it).

**Acceptance per §1.1:** 5 consecutive cold-launch first-spawns autosend cleanly.

**Effort:** 0.1-0.2 day.

### Task 3 — Fix Bug H xterm.js rendering

Fix per Task 1 evidence. Likely fix shapes:

- **If WebGL DPR issue:** explicit DPR set on WebGL addon init, OR trigger `term.refresh(0, term.rows - 1)` after first mount, OR delay WebGL addon attach until after first render frame.
- **If fit-addon timing:** call `fitAddon.fit()` inside `requestAnimationFrame` or after initial render settles, not synchronously on mount.
- **If CSS layout:** ensure terminal container has stable dimensions before xterm.js mount (flex/grid containers sometimes report 0-dimension during mount).

**External tool permitted:** xterm.js issue tracker scrape via web search if CODER needs upstream reference patterns. State intent in PHASE_REPORT §10: "Invoked web search for xterm.js + WKWebView WebGL addon init patterns" before doing so.

**Acceptance per §1.2:** terminal renders clean from first mount across 3 cold spawns, no artifacts, no manual keystroke needed to redraw.

**Effort:** 0.15-0.3 day. May extend if root cause is novel WebGL + WKWebView interaction.

### Task 4 — Fix Bug I (if reproduced in Task 1)

Only if Task 1 reproduced Bug I. Otherwise close as not-reproduced.

If fix needed: ensure ESC handler transitions state machine to `{kind: 'idle', sinceCommandEndedAt: <timestamp>}` immediately, not dependent on pty-output-cessation detection.

**Effort:** 0.05-0.1 day if needed.

### Task 5 — Smoke-readiness verify + PHASE_REPORT

CODER launches build:app:debug, spawns PM + Coder + Raw sessions, verifies bootstrap autosend + terminal rendering clean on cold launch. NOT user-facing smoke substitute per SMOKE_DISCIPLINE §3.4 — smoke-readiness only.

Files PHASE_N2.1.5_REPORT. Jose runs N2.1.1 §3.3 16-step user-facing smoke. PM appends outcome.

**Effort:** 0.1 day CODER + ~15 min Jose.

---

## §3 — Guardrails

Inherited G1-G12. Additions for this dispatch:

**G13 — Sub-agent authorization.** CODER may spawn parallel diagnostic sub-agents when a bug's investigation surface is wide (multiple candidate root causes at different layers, or when external-reference scraping benefits from parallel execution). No pre-approval; report invocation + sub-agent scope in PHASE_REPORT §10 metrics.

**G14 — External tool use with stated intent.** CODER may invoke web search, upstream issue tracker probes, or external documentation scraping when implementation reality requires information beyond local code + Tauri/xterm.js/Node docs CODER already has. Before invoking, CODER states intent in PHASE_REPORT §10: what tool, what question, expected evidence shape. Reports outcome.

Rationale for G13/G14: accumulated hotfix rotation cost (five rotations, N2.1 through N2.1.5) exceeds the cost of giving CODER better tooling for genuinely hard bugs. xterm.js + WebGL + WKWebView interaction is the kind of problem where upstream issue search may resolve in 10 minutes what local debugging takes hours.

Not a license for unbounded tool use. Intent-stated-first discipline keeps it transparent.

---

## §4 — Non-scope

Explicitly NOT in N2.1.5:

- Bug J (cross-instance JSONL leak) — deferred to N3 Task 1, absorbed into JSONL parser + watcher architecture.
- Bug F (away_summary) + Obs G (plain-zsh UI) — N3.
- Max effort option, kill-session affordance, UI layout polish — N3 / dedicated UI phase.
- Any N3 scope (JSONL parser, renderer registry, ChatThread, approval modal, cost extraction).

---

## §5 — Required reading

1. This dispatch.
2. SMOKE_DISCIPLINE.md v1.0.
3. `native-v1/docs/phase-reports/PHASE_N2.1.4_REPORT.md` §3 outcome.
4. `apps/sidecar/src/pty/bootstrap.ts` (Bug D).
5. `apps/frontend/src/components/TerminalPane.tsx` (Bug H).
6. `packages/shared/src/session-state.ts` (Bug I, if applicable).

---

## §6 — Jose's TODO

1. Save to `~/Desktop/Projects/jstudio-commander/docs/dispatches/N2_1_5_DISPATCH_BOOTSTRAP_RACE_XTERM_RENDER.md`.
2. Paste in PM: "N2.1.5 dispatch saved."
3. PM produces paste-to-CODER with G13 + G14 reminders + dogfood caveat (Bug J ignorable until N3).
4. Continuing CODER executes. 0.5-1.5 day window. Longer than typical hotfix because Bug H may require upstream investigation.
5. Jose runs N2.1.1 §3.3 16-step smoke.
6. PM appends outcome.
7. **If 16/16:** dogfood window begins (3-5 days real use) with Bug J caveat documented. N3 scope review after dogfood.
8. **If <16/16:** CTO scopes next move.

---

**End of dispatch.**
