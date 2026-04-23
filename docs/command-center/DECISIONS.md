# Decisions — Command-Center

**Purpose:** Append-only record of architectural + operational decisions ratified for the Command-Center rebuild. New decisions added at top. Rationale captured alongside each entry so context travels with the record.

**Scope:** Command-Center rebuild only. Commander native-v1 decisions (D1-D31 through 2026-04-22) live at `~/Desktop/Projects/jstudio-commander/DECISIONS.md` and are frozen at the native-v1 archive (commit dc8a0f6).

**Cross-references:**
- ARCHITECTURE_SPEC.md §10 ratifies **D-N1-01 through D-N1-10** (initial stack picks + monorepo layout, 2026-04-23). Not duplicated here — spec §10 is the canonical location for those.
- KB v1.3 at `~/Desktop/Projects/jstudio-meta/research/COMMANDER_KNOWLEDGE_BASE.md` cites **KB-P#.#** subsection numbers. Decisions below reference the relevant KB subsection for traceability.

**Numbering:** `D-KB-##` prefix for decisions ratifying KB principles. `D-N#-##` prefix (in spec §10 today; future phase DECISIONS entries here) for phase-specific decisions. Keep prefixes stable to avoid collisions as new categories land.

---

## 2026-04-23 — KB v1.4 + ARCHITECTURE_SPEC v1.3 calibration patch ratifications

Four entries paired. Claude Code v2.1.118 runtime drift vs prior KB/spec wording caught during Jose's N2 smoke. All four recovered by PM-shipped fixes in-rotation (PHASE_N2_REPORT §4 D6). Folded into KB v1.4 + SPEC v1.3 as the post-N2-close calibration pass per CTO 2026-04-23. First time runtime-calibration discipline is formally applied to this KB — expect further drift cycles as Claude Code versions advance, and re-verify before wiring new plugin/MCP integration surfaces.

### D-KB-09 — Hook transport: command-type only (2026-04-23)

KB-P3.1 amended v1.4: Claude Code v2.1+ hooks support `type: "command"` only. `type: "http"` does not exist for hooks (MCP servers only). Host apps ship command-type shims that forward to their HTTP API. Commander ships `apps/plugin/hooks/forward.sh` (~50 LOC bash, reads `~/.commander/config.json` dynamically per invocation, POSTs stdin to sidecar, fails-open). Supersedes v1.3 KB-P3.1 HTTP-hook guidance. Source: N2 smoke step 4 failure (URL validator rejected `${COMMANDER_PORT}` placeholder pre-expansion); PM fix at commit `c429e5a`.

### D-KB-10 — Hook event catalog: runtime-calibrated at 9 events (2026-04-23)

KB-P3.1 amended v1.4: Claude Code v2.1.118 supports 9 hook events (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Notification`, `Stop`, `SubagentStop`, `PreCompact`, `SessionStart`, `SessionEnd`). Wiring unsupported event names (`SubagentStart`, `TaskCreated`, `TaskCompleted`, `PostCompact`, `PermissionRequest`) aborts all hook registration for that plugin — one bad event takes down everything. KB catalog is now explicitly calibrated against a Claude Code version at a date; verify against current runtime before wiring new surfaces. Source: N2 PM fix commit `74af4df` (initial prune; later proven not-the-root-cause but prune still correct).

### D-KB-11 — Plugin install URI: no `file://`; `manifest.hooks` omitted for standard paths (2026-04-23)

KB-P3.2 amended v1.4 + ARCHITECTURE_SPEC §8.1 amended v1.3: Claude Code "Add Marketplace" dialog accepts `owner/repo`, `git@…`, `https://…/marketplace.json`, `./relative`, or raw absolute paths. `file://` URIs rejected at dialog layer with "Invalid marketplace source format". Separately: `plugin.json manifest.hooks` must be OMITTED when using the standard `./hooks/hooks.json` location (auto-loaded by convention); declaring it triggers "Duplicate hooks file detected" abort. Same fail-at-plugin-load pattern as D-KB-10. Source: N2 smoke step 3 failure (file:// rejection) + PM fix at `c429e5a` + `441e007`; PHASE_N2_REPORT §4 D6a + D6c.

### D-KB-12 — MCP configuration: project-root `.mcp.json` wrapped shape (2026-04-23)

ARCHITECTURE_SPEC §7.3 amended v1.3: External Claude Code sessions access Commander MCP via project-root `.mcp.json` with REQUIRED `{"mcpServers": {...}}` wrapper. Flat shape rejected at project root ("mcpServers: Does not adhere to MCP server configuration schema"). Flat shape IS accepted for plugin-bundled `.mcp.json` inside plugin packages — the distinction is location-dependent. `~/.claude/settings.json` does NOT take an `mcpServers` field (schema validator rejects). No live-reload — session restart required to re-parse `.mcp.json`. Port + bearer copy-paste target: `~/.commander/config.json`. Source: N2 smoke step 8 failures; PHASE_N2_REPORT §4 D6d.

### Calibration discipline note

KB plugin/MCP sections now carry "Calibrated against Claude Code v<X.Y.Z> at <date>" markers. Drift is expected as Claude Code versions advance. Re-verify before wiring new integration surfaces. When drift is found, file a calibration patch at `~/Desktop/Projects/jstudio-meta/research/archives/KB_V*_SPEC_V*_CALIBRATION_PATCH.md` with fold instructions + DECISIONS entries — same pattern v1.4 used. This is the second time runtime-vs-spec drift has bitten Commander (first was N2.1-era Bug J JSONL cross-instance leak); formalizing the discipline prevents a third round of "PM-shipped fixes during smoke" friction.

---

## 2026-04-23 — KB v1.2 + v1.3 fold ratifications

Eight entries. KB v1.2 additions and v1.3 additions folded same-day into canonical `COMMANDER_KNOWLEDGE_BASE.md` (v1.1 → v1.3, skipping 1.2 intermediate). Four v1.2 Part-1 additions + two v1.3 Part-1 additions + two v1.3 corrections to v1.2 content = eight load-bearing principle ratifications. All protected per KB v1.3 "named architectural principles" unless noted.

### D-KB-01 — UI-process / pane-host-process split (KB-P1.12, added v1.2, corrected v1.3)

Commander's UI process (Tauri shell + webview + React) and its pane-host sidecar (Fastify + Bun PTY + agent children + persistence) are separate OS processes connected by IPC. Agent sessions live in the sidecar and survive UI restarts, HMR, auto-updates, and shell crashes. **Protected architectural principle** — relaxation requires invalidating the principle first, not local override. Command-Center's Tauri v2 + Bun-sidecar architecture satisfies this by construction.

### D-KB-02 — Per-session IPC channels, never a shared bus (KB-P1.13, added v1.2)

Every long-running data stream (PTY output, hook events, approval events, status transitions, tool-result events) flows on a per-session WebSocket topic identified by `session_id`. No global `terminal-data` or `hook-events` channel. Frontend subscribes only to topics for currently-mounted panes. **Protected architectural principle** — ARCHITECTURE_SPEC §5.1 topology carries this; BridgeSpace's Day 132/133 identified the shared-bus anti-pattern as the #1 production perf killer.

### D-KB-03 — Boot-path discipline (KB-P1.14, added v1.2)

Route-level code splitting (main bundle ≤500 KB), no sync keychain/IPC/disk work at module init, `ready-to-show` paired with window creation, skeleton UI within 200ms of Finder launch. **Protected architectural principle** — lands in N1 foundation (not N7 hardening) per ARCHITECTURE_SPEC §2.4. Deferring reproduces Matt's retrofit-pain pattern.

### D-KB-04 — Hidden workspace suspension (KB-P1.15, added v1.2)

Inactive workspaces suspend xterm render loops + unsubscribe WS topics for their panes; underlying PTY processes and agent runs continue untouched. Scrollback restores on workspace switch via serialized blob (KB-P4.2). Per-session-channel pattern (KB-P1.13) in action.

### D-KB-05 — Persistent state placement — flow-gating state in DB, localStorage transient-only (KB-P1.16, added v1.3)

Any persistent state that gates app flow lives in sidecar SQLite; localStorage reserved for transient UI preferences (panel widths, collapse states, last-filter). Gate test: *if this state vanishes, does the user lose work or hit a confusing redirect?* — yes → DB. **Protected architectural principle** — applies from N1 schema design (`onboarding_state` table per ARCHITECTURE_SPEC §3.2).

### D-KB-06 — Context degradation cliff at ~75% window (KB-P1.17, added v1.3)

Agent quality degrades sharply approaching context limit BEFORE auto-compact triggers. Commander surfaces `{used_tokens} / {window_limit}` with color-coded threshold warning (green <60%, yellow 60-75%, red >75%) and "Consider handoff" toast at 75% crossing. Soft advisory, not hard bound — hard token limit (KB-P1.6) is separate. N3 run viewer implements primitive; N4 ContextBar surfaces the full pattern + one-click handoff-prompt action.

### D-KB-07 — Write-gate CORRECTION: narrow-primitive tool surface regardless of model tier (KB-P1.7 amended v1.3, supersedes v1.2 write-gate rule)

v1.2 specified cheap/fast models need a diff-review gate for filesystem writes; v1.3 widens: **any model, regardless of tier, needs a narrow-primitive tool surface for destructive operations.** Evidence: Opus 4.6 ran `seed` instead of `insert` against prod DB, wiping rows (~1hr downtime). Tool surface is primary defense; `agents.capability_class` column (from v1.2, lands N1 schema) demoted to secondary defense / insurance. **Affects N2 MCP tool spec:** CRUD primitives only (`create_task`, `update_task`, `add_knowledge_entry`, `spawn_agent_run`, `cancel_agent_run`, etc.) — **no `execute_sql`, no `run_migration`, no raw `shell_exec`.** Codified as KB-P6.17 anti-pattern. **Protected architectural principle.**

### D-KB-08 — Tauri perf CORRECTION: runtime choice matters when paired with banked fixes (KB-P1.12 amended v1.3, supersedes v1.2 negative-result framing)

v1.2 cited Matt's early Tauri-port attempt as a negative result ("runtime doesn't dominate"). v1.3 corrects via Day 134 shipped build: Tauri + banked fixes (per-session IPC / xterm `dispose()` / workspace suspension / boot-path discipline) delivers **~10× responsiveness improvement** over Electron + same fixes. Tauri alone without the fixes still regressed in the earlier attempt. Corrected framing: runtime choice does matter, but only when paired with the discipline fixes. Command-Center's Tauri v2 + N1-baked fixes (KB-P1.13 / P4.2 / P1.15 / P1.14 all in foundation) is validated, not invalidated.

---

**End of DECISIONS.md. New decisions append at top.**
