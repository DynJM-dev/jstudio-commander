# Plan — Commander Native Desktop App (Phase Z)

**Status:** Proposal for Commander CTO track
**Authored:** 2026-04-20 by Migration CTO
**Scope:** Transform the Command Center from localhost-in-browser to a native desktop application, preserving 100% of current UX/functionality while adopting better platform architecture
**Timeline:** Post-migration, post-Phase Y, not urgent. Exploratory planning document.
**Decision status:** Not approved — this is a strategic brief for consideration

---

## 1. Context and framing

Commander currently runs as:
- Fastify server on port 3002 (Node.js)
- Vite-built React 19 + TypeScript client served by that server
- Accessed via `http://localhost:3002` in Chrome (or whichever browser is open)
- SQLite database at `~/.jstudio-commander/commander.db`
- tmux process management via `node-pty`-equivalent spawning

The existing architecture is functional but has structural overhead from running in a browser context: Chrome allocates 500MB-2GB of RAM for a tab-group it considers a web app, DevTools/extensions can interfere, and the "it's just a website" framing limits OS integration depth (dedicated Dock icon, native notifications, global shortcuts, menu bar, etc.).

BridgeSpace (bridgemind.ai/products/bridgespace) demonstrated that a Tauri-based native desktop app with similar feature surface consumes dramatically less memory, starts faster, and feels materially more native. Their stack: Tauri v2 + React 19 + node-pty + xterm.js with WebGL + OSC 133 shell integration. They achieve this without rewriting their UI logic — they just picked a better shell.

**This plan proposes the same for Commander:** keep all current JStudio-specific semantics (PM/Coder personas, manual-bridge model, canonical file integration, effort defaults, session types, state machine discipline), adopt Tauri v2 as the shell + add xterm.js with WebGL for real terminal rendering, and use node-pty for proper shell spawning.

**What this is NOT:**
- Not a rewrite of Commander's business logic
- Not a replacement of the Fastify server architecture wholesale
- Not an adoption of BridgeSpace or any third-party product
- Not a new product line — it's a better shell for the existing Commander

**What this IS:**
- A native desktop app wrapper over Commander's existing React frontend
- An upgrade from browser-tab-in-Chrome to dedicated OS-level application
- An opportunity to replace the "tmux mirror" read-only text tail (Phase T) with actual interactive terminal rendering via xterm.js+WebGL
- A platform that enables future features that are awkward in a browser (native notifications, tray icons, global shortcuts, multi-window)

---

## 2. Why do this at all

### 2.1 Measured benefits from research

Data from Tauri v2 benchmarks across multiple 2025 production migrations:

- **Memory footprint:** Tauri apps idle at 30-50MB. Chrome with Commander open uses 400-800MB in typical cases. **~10x reduction.**
- **Startup time:** Tauri apps launch in <500ms. Opening a Chrome tab to localhost:3002 is typically 1-3 seconds depending on tab state. **~3-5x faster.**
- **Installer size:** Tauri bundles at 3-10MB. Not relevant for local-only, but matters if Commander ever gets packaged for distribution.
- **Native WebView vs Chromium:** macOS uses WebKit (Safari engine) natively. Smaller attack surface, lower CPU when idle, better battery on laptops.

### 2.2 Qualitative benefits

- **Dedicated Dock icon** — Commander becomes a real app, not a tab Jose might accidentally close
- **Native menu bar** — File / Edit / View / Session / Window menus with native macOS keybindings (Cmd+Shift+N for new session, Cmd+W for close pane, etc.)
- **Global shortcuts** — Cmd+Option+C to toggle Commander from anywhere, Cmd+Shift+Space for command palette
- **Native notifications** — real macOS notifications when a session goes idle, a tool is awaiting approval, a phase completes. Respects Do Not Disturb, shows in Notification Center.
- **System tray / menu bar icon** — active session count, quick stop/pause, quick open
- **Multi-window support** — each session or project can have its own window if desired
- **No browser dependencies** — DevTools extensions, Chrome bugs, browser updates, tab restoration behavior all irrelevant
- **OS integration** — file associations (open a canonical STATE.md directly in Commander's project view), drag-drop project folders onto app icon to spawn session, Spotlight integration

### 2.3 What the current "localhost in browser" approach limits

- **"Feels like an app" gap** — everything works but it always feels like browsing to a website
- **Notification unreliability** — browser notifications require permissions, fail silently if browser is backgrounded
- **Subscription behavior oddities** — browser tab visibility APIs throttle timers when tab is inactive; can cause WS reconnect issues Commander has worked around in Phase P/U work
- **Performance ceilings** — Chrome is doing a LOT more than Commander needs (extensions, tab-switching logic, URL bar, bookmarks) which all costs CPU/RAM
- **No native UI affordances** — can't add a menu bar, can't add a tray icon, can't respond to OS-level events

### 2.4 Alignment with Commander's existing direction

Phase T shipped a tmux mirror pane. The mirror was a **read-only text tail** because doing a real interactive terminal emulator in the current stack is non-trivial. With xterm.js + WebGL in a Tauri shell, the mirror upgrades to a **real interactive terminal** — same code quality, vastly better capability. You could actually type into the pane if you wanted (with appropriate guards to avoid duplicating the Claude Code session's own PTY).

Phase Y (in flight) is establishing transcript-authoritative derivation — an architectural cleanup that will be much easier to iterate on in a native app where you're not fighting browser subscription model quirks.

---

## 3. Architecture — what changes and what doesn't

### 3.1 What stays identical

**100% of the JStudio-specific logic:**
- PM / Coder / Raw session types + their persona bootstraps
- `/effort` defaults and adjustment UI (M8)
- Canonical 4-file project view (M7)
- Manual-bridge model (OS v1.2 §3)
- STATE.md live file-watching (Phase L chokidar infrastructure)
- JSONL origin attribution (Phase L)
- tmux pane state isolation (Phase S.1)
- Bootstrap injection invariants (§23.3, Issue 10)
- Session DB schema (`~/.jstudio-commander/commander.db`)
- Transcript-authoritative state derivation (Phase Y)
- All standards files, all investigation discipline, all operating model

**React frontend largely unchanged:**
- Existing components (SessionCard, ChatPage, ContextBar, TmuxMirror, PaneContainer, etc.) keep working
- Existing state management (Zustand or equivalent) keeps working
- Existing WebSocket event subscriptions keep working
- Routing, modals, forms — all transferable

### 3.2 What changes

**Shell replacement:**

The browser becomes a Tauri window. Commander's React frontend is still served but no longer needs Fastify as the HTTP server — it can be bundled into the Tauri app directly and the Fastify backend becomes just a WebSocket + REST API server running as a Tauri-managed child process (or migrates into Rust, see 3.3 below).

**Terminal rendering upgrade:**

Phase T's `TmuxMirror` (read-only text tail via WebSocket `session:pane-capture` events) is replaced with xterm.js + WebGL terminal rendering. This gives:
- Real ANSI/terminal emulation (proper color, proper line wrapping, proper cursor positioning)
- GPU-accelerated rendering at 60fps even with heavy output
- Proper scrollback with selection and copy
- Option to make interactive (send input to tmux via node-pty) if ever wanted

The tmux process spawning can stay as-is (Commander already spawns tmux) OR migrate to node-pty directly (more native, better OSC sequence handling). Both paths work.

**Shell integration (OSC 133):**

Add OSC 133 prompt markers to the shell init scripts Commander injects into spawned sessions. This enables:
- Jump-to-previous-prompt keyboard shortcut
- Command block grouping (collapse verbose output)
- Exit code visibility per command (green/red indicator)
- Click-a-block-to-copy-command UX

Claude Code doesn't currently emit OSC 133 (there's an open feature request: anthropic/claude-code#26235) but that's orthogonal — Commander can add wrappers around shell invocations that do.

**Optional upgrades:**
- Command palette via Tauri global shortcut (Cmd+K opens project-wide command palette, works even when Commander isn't focused)
- Native tray icon showing session count + quick actions
- Native notifications for session-idle, tool-approval-needed, phase-complete events
- Menu bar with session/project navigation
- Multi-window (dedicated window for project view, dedicated window for a specific session)

### 3.3 What's optional: Rust backend migration

**Option A — Keep Fastify, wrap with Tauri (conservative, faster path):**

- Tauri app starts Fastify as a child process on port 3002
- React frontend calls the Fastify server via `localhost:3002` exactly as today
- Tauri handles window/menu/tray/notification, delegates everything else to Fastify
- Migration cost: days, not weeks
- Logic preserved 100%, zero rewrite

**Option B — Gradual migration to Rust backend (ambitious, faster runtime):**

- Start with Option A
- Incrementally migrate hot-path operations (session spawn, tmux management, file-watch) from Fastify to Rust via Tauri commands
- Keep Fastify for less-performance-critical operations (DB queries, bootstrap file serving)
- Over 6-12 months, migrate fully or stay hybrid
- Migration cost: months of incremental work
- Runtime wins: Rust is faster than Node.js for the CPU-bound work (tmux process management, file-watch debouncing, WS event dispatch), but Commander probably isn't CPU-bound enough for it to matter

**Recommendation: Start with Option A. Consider B only if specific bottlenecks emerge.**

Option A delivers 90% of the user-visible benefit (native feel, native UI affordances, lower RAM from native WebView vs Chrome) at 10% of the cost. Option B is an optimization play that can happen later if needed.

### 3.4 Terminal stack decision

Two paths for the terminal emulator:

**Path 1: xterm.js + @xterm/addon-webgl + node-pty**

- xterm.js is the de facto standard (VS Code, Replit, Hyper, electerm all use it)
- WebGL addon renders via GPU, handles thousands of lines smoothly
- node-pty is the Node.js native binding for PTY management
- Combined stack: proven in production, well-documented, tons of community support
- Commander already had xterm.js + node-pty deleted in Phase P.3 (commit `1f4235f`). Re-adding them is legitimate — the context is different now (native app, not browser)

**Path 2: Continue with tmux-capture + Phase T mirror style, upgraded**

- Keep the `tmux capture-pane` polling approach from Phase T
- Use xterm.js only for rendering the captured text (with ANSI color via `ansi_up` like Phase T)
- Don't actually do terminal emulation client-side — just render snapshots
- Simpler, less risky, but limits future features (no interactive terminal, no per-character scrollback)

**Recommendation: Path 1 for new terminal panes, Path 2 preserved for the mirror view.**

The mirror is specifically "read-only tail of what tmux is showing" — Phase T's pattern works for that use case. But if Commander adds any feature that wants to be a "real terminal" (standalone shell pane, interactive REPL for debugging), xterm.js + node-pty is the right tool.

### 3.5 File structure (proposed)

```
~/Desktop/Projects/jstudio-commander/
├── client/                       (React frontend — unchanged, Vite builds into Tauri)
├── server/                       (Fastify backend — unchanged)
├── src-tauri/                    (NEW — Tauri Rust app shell)
│   ├── src/
│   │   ├── main.rs               (entry point, minimal)
│   │   ├── lib.rs                (app setup, plugin registration)
│   │   ├── commands/             (Tauri commands exposed to React)
│   │   │   ├── fastify.rs        (manage Fastify child process lifecycle)
│   │   │   ├── tray.rs           (native tray icon)
│   │   │   ├── notifications.rs  (native notifications)
│   │   │   └── menus.rs          (native menu bar)
│   │   └── services/
│   ├── Cargo.toml                (Rust dependencies)
│   ├── tauri.conf.json           (Tauri app config)
│   └── icons/                    (app icons for Dock, tray, etc.)
├── packages/                     (shared types — unchanged)
└── package.json                  (top-level, adds @tauri-apps/cli dev dependency)
```

Separation of concerns:
- `client/` stays a plain Vite + React project. Can still be served via `localhost:3002` in a browser for debugging if needed.
- `server/` stays a plain Fastify + SQLite backend. Can still be run standalone for headless/test scenarios.
- `src-tauri/` is the new native shell. In production, Tauri launches both `server/` as a child process and serves `client/`'s built assets inside a WKWebView (macOS) / WebView2 (Windows) / WebKitGTK (Linux).

---

## 4. Feature opportunities (new capabilities unlocked)

### 4.1 Native integrations (should-have)

- **Dock icon with badge** — count of active sessions, red dot for sessions needing attention
- **Menu bar** — File (New Session, New Project, Quit), Session (Start, Stop, Restart, Kill), View (Split Pane, Mirror, Project View), Window (management), Help (Docs, Keyboard Shortcuts)
- **Global shortcuts** — Cmd+Option+C toggle Commander visibility, Cmd+Shift+N new session modal, Cmd+Shift+P command palette
- **Native notifications** — session idle, tool needs approval, phase completion, Codeman-style tool blocks finishing
- **Tray icon (macOS menu bar)** — quick glance at session states, quick actions (pause all, stop all, open Commander)
- **Drag-drop support** — drop a project folder on Commander icon to spawn session in that cwd
- **Spotlight integration** — "Open Commander" searchable

### 4.2 Terminal UX (nice-to-have)

- **OSC 133 command blocks** — commands and their output grouped into collapsible units
- **Inline command history navigation** — jump to previous prompt, previous output, etc.
- **Selection-aware copy** — copy command output without the prompt, copy prompt without output
- **Link detection** — URLs in terminal output become clickable
- **Search within session** — Cmd+F within a session's scrollback

### 4.3 Multi-window architecture (future consideration)

- **Dedicated project windows** — Cmd+Shift+P on a project opens that project's canonical file view in its own window
- **Popout terminal** — send a specific pane to its own window for full-screen focus mode
- **Multi-display awareness** — remember which window goes on which display

### 4.4 Multi-AI-terminal support (explicit future scope)

Jose mentioned possibly supporting multiple AI terminal agents (Claude Code, OpenCode, Gemini CLI, Cursor's CLI, etc.) in the future. The native app architecture makes this cleaner:

- **Per-agent bootstrap profiles** — PM-Claude, PM-GPT, PM-Gemini each with their own persona adjusted to that model's quirks
- **Agent comparison view** — spawn the same task to two different agents in side-by-side panes
- **Cost tracking per agent** — native tray indicator shows "Claude Code: $12.47 today, Codex: $3.21 today"
- **Routing rules** — "heavy refactor" tasks go to Opus, "simple edits" go to Haiku, "research" goes to Gemini's web search

This is explicitly future scope — don't build it in Phase Z. But Phase Z's architecture should not foreclose it. Session types are already extensible; adding "CoderGPT" or "CoderGemini" session types with their own personas is structurally similar to adding "CoderClaude" (already exists).

---

## 5. Risks and mitigations

### 5.1 Native WebView inconsistencies

**Risk:** macOS uses WebKit (Safari engine), Windows uses WebView2 (Chromium), Linux uses WebKitGTK. CSS/JS rendering can differ.

**For Commander's Mac-primary use case, this is minor:** macOS Safari engine is stable and capable. Commander's current UI is fairly standard (Tailwind v4, React 19, minimal browser-specific features). Expected rendering deltas: <5% of UI has any risk of subtle differences.

**Mitigation:** Test on actual Safari (not just Chrome DevTools simulating WebKit) during Phase Z development. Add -webkit- CSS prefixes where needed. Use feature detection over browser detection.

### 5.2 Rust learning curve

**Risk:** Team (you + Commander CTO track) aren't Rust experts. Tauri requires some Rust for OS integration.

**Mitigation:** Option A (Fastify stays, Tauri just wraps) minimizes Rust requirement. Most Rust code needed is boilerplate (Tauri commands, plugin setup). Rust for Commander-specific logic can stay in Node.js via IPC to child Fastify process.

Current Commander CTO track has demonstrated disciplined technical work (Phase U/V/Y). Rust learning is a project in itself but a manageable one. Don't need deep Rust expertise day one — can start with boilerplate-heavy approach and learn incrementally.

### 5.3 Switching cost during transition

**Risk:** While migrating, you might have two versions of Commander coexisting (old browser version, new Tauri version) and accidentally use the wrong one.

**Mitigation:** Single-repo development. Browser version and Tauri version build from same source. The Tauri version just adds a shell. You can `npm run tauri dev` for native or `npm run dev` for browser — choose per session. Both work against the same Fastify backend.

### 5.4 Tauri v2 beta maturity concerns

**Risk:** Tauri v2 released late 2024. Still newer than Electron. Plugin ecosystem less mature.

**As of 2026-04-20 data:**
- Tauri v2 is production-ready and stable per multiple production case studies
- 17,700+ Discord members, 35% YoY adoption growth
- Used in production by 1Password, AppFlowy, Hoppscotch, BridgeSpace, and many others
- Official plugins cover most needs (filesystem, shell, notifications, tray, global shortcut, fs-watch, etc.)

**Mitigation:** Start with official plugins only. Avoid leaning on niche community plugins. Migrate-friendly architecture if ever need to switch (Tauri → Electron is possible if ever necessary, though unlikely).

### 5.5 Code-signing and distribution complexity

**Risk:** Native apps need code-signing on macOS (Apple Developer account, $99/year) to not trigger Gatekeeper warnings.

**For JStudio-internal use, this is trivial:**
- Jose builds locally from source, runs unsigned — no issue for personal use
- If ever distributed externally, Jose already has Apple Developer account needs for App Store / Mac distribution
- Tauri handles code-signing via `tauri.conf.json` — straightforward config

**Mitigation:** Don't distribute externally. Or if doing so, Apple Developer + straightforward Tauri signing config.

### 5.6 Phase Y interaction risk

**Risk:** Phase Y (transcript-authoritative derivation) is in flight. Starting a Tauri migration now would create a two-front architectural change.

**Mitigation:** Phase Y MUST close before Phase Z starts. Non-negotiable. Plan explicitly sequences Phase Z as post-Phase-Y. Given Commander CTO's stated ~1 week to Phase Y close, Phase Z could start ~1-2 weeks after this plan is approved. No parallelism.

---

## 6. Proposed rollout phases

### Phase Z.0 — Discovery and planning (1-2 days)

Commander CTO track reviews this plan, iterates on scope, identifies specific concerns. No code.

Outputs:
- Approved / rejected / iterated scope
- Decision on Option A vs A-leading-to-B for backend
- Decision on xterm.js + node-pty vs keep-Phase-T-pattern for terminal rendering
- Commitment to post-Phase-Y sequencing

### Phase Z.1 — Tauri shell prototype (2-3 days)

Goal: Commander running as a Tauri app, identical UX to browser version.

- Add `src-tauri/` directory with Tauri v2 init
- Configure `tauri.conf.json` to build Vite client + spawn Fastify child process
- Window management (single main window, correct size, correct chrome)
- Basic build pipeline (`npm run tauri dev`, `npm run tauri build`)
- Smoke test: every existing Commander feature works exactly the same in the Tauri window

Acceptance: Jose uses Tauri version for a full day of work, reports no regressions.

### Phase Z.2 — Native integrations MVP (3-5 days)

Goal: Native features that distinguish from browser version.

- Dock icon + badge with active session count
- Native menu bar with core actions (New Session, Quit, Settings, Help)
- Native notifications for session state changes (idle, tool-approval, phase-complete)
- Tray icon (macOS menu bar) with quick session actions
- Global shortcut: Cmd+Option+C to toggle Commander window

Acceptance: These features feel right, not over-engineered. Native conventions respected.

### Phase Z.3 — Terminal rendering upgrade (3-5 days)

Goal: Real xterm.js + WebGL terminal rendering for pane mirrors.

- Re-add xterm.js + @xterm/addon-webgl + node-pty (per-pane, replacing Phase T text tail)
- Per-pane terminal state in client (scrollback buffer, theme, size)
- GPU-accelerated rendering (WebGL2 context, font atlas, glyph caching)
- ANSI color + cursor handling via xterm.js native capabilities
- OSC 133 markers in shell init for command block support
- Preserve Phase T mirror pattern as alternative view for read-only scenarios

Acceptance: Paste a huge log into a session pane, scroll through it smoothly. Real terminal behavior without regressions vs Phase T.

### Phase Z.4 — Polish, settings, distribution (2-3 days)

Goal: Settings UI, window state persistence, optional auto-update, build for distribution.

- Native settings window (Preferences pattern on macOS)
- Window state persistence (position, size, which sessions were open)
- Theme integration (match macOS system theme if desired)
- Auto-update via tauri-plugin-updater (if Jose wants to distribute outside his machine)
- Code signing (if distributing)

Acceptance: Feels like a real Mac app. First-launch UX, quit state, re-open behavior all natural.

### Phase Z — Total estimated duration: 10-18 days

Roughly 2-3 weeks of focused Commander CTO track work. Compared to the existing Phase A-Y work (~months), this is a modest investment with substantial structural returns.

---

## 7. Resource estimate

Developer time, assuming Commander CTO track executes:

- **Phase Z.0 (planning):** 1-2 days CTO writing time
- **Phase Z.1 (shell):** 2-3 days Coder dispatch + Jose smoke
- **Phase Z.2 (native features):** 3-5 days Coder + UX iterations
- **Phase Z.3 (terminal rendering):** 3-5 days Coder + careful testing
- **Phase Z.4 (polish):** 2-3 days Coder + Jose acceptance

**Total:** 11-18 days of Coder work, spread across perhaps 4-6 weeks of calendar time including review/iteration.

Cost comparison:
- BridgeSpace subscription to get equivalent platform: $16-40/month = $192-480/year
- Native Commander one-time build: ~3 weeks of work then ~0 ongoing maintenance (Tauri just works once set up)

Native Commander pays for itself in opportunity cost terms in ~1 year of equivalent BridgeSpace subscription. More importantly: keeps the JStudio-specific customization you'd lose with BridgeSpace.

---

## 8. What this plan explicitly does NOT do

- **Does not change PM/Coder/CTO operating model** — manual-bridge stays intact
- **Does not replace Commander with BridgeSpace or any other product** — Commander remains the product, Tauri is an implementation detail
- **Does not rewrite backend in Rust** — Fastify stays (unless incremental migration is desired later per Option B)
- **Does not fix stubborn bugs by itself** — Phase Y is still the fix for state-machine issues. Phase Z is a shell, not a logic fix.
- **Does not deliver multi-AI-terminal support** — that's future work (Phase AA or beyond)
- **Does not make Commander a public/commercial product** — internal JStudio tool stays internal
- **Does not rewrite the React frontend** — existing components continue working, just hosted in a different shell

---

## 9. Open questions for Commander CTO

1. **Priority?** Phase Z is compelling but Commander CTO already has queued: Phase Y Rotation 1+2, M8 Secondary, Candidate 30 (markdown render parity), plus the ~12 other candidates. Where does Phase Z slot in?

2. **Option A or B for backend?** Recommended A (keep Fastify, wrap with Tauri). Would Commander CTO prefer investigating B (gradual Rust migration) concurrently or defer?

3. **Terminal rendering — Path 1 or Path 2?** Recommended Path 1 (xterm.js + WebGL + node-pty) for new terminal panes, Path 2 (Phase T style) preserved for mirror view. Does Commander CTO agree?

4. **Any architectural conflicts with Phase Y or future candidates?** This plan was drafted with Phase Y context in mind but Commander CTO knows the codebase better. Any foreseen conflicts?

5. **Distribution plans?** If Commander ever gets shared with other developers/teams/clients, code-signing + distribution becomes relevant. If purely internal forever, simpler build process suffices.

6. **Timing?** Recommended post-Phase-Y. Any reason to accelerate or defer further?

---

## 10. Recommendation

**For Jose (migration CTO track's view):**

1. This plan is exploratory and low-urgency. Don't execute during migration closure. Don't execute during Phase Y.

2. After Phase Y stabilizes (Commander CTO estimates ~1 week to close), bring this plan to the Commander CTO for their review. They may accept, reject, or modify.

3. If Commander CTO accepts, Phase Z slots naturally into their queue — probably after M8 Secondary but before broader candidate cleanup, since the native app foundation benefits everything downstream.

4. Don't rush this. The browser version of Commander is functional. Phase Y will make it more functional. Phase Z is an upgrade, not an emergency.

5. The main win from Phase Z isn't the tech — it's that Commander becomes something Jose doesn't have to explain as "this web thing I run locally." It becomes just "Commander, my tool." That framing matters for how you relate to it over years of use.

**For Commander CTO (if this plan proceeds to them):**

1. Review scope carefully. Iterate with migration CTO via Jose if anything is unclear or mis-scoped.

2. Consider whether Phase Y + Phase Z could share an architectural benefit — if transcript-authoritative derivation frees up subscription complexity, Phase Z's terminal rendering becomes more straightforward.

3. Phase Z.1 is the make-or-break decision gate. Budget 2-3 days for it. If it goes smoothly, Z.2-Z.4 become incremental polish. If Z.1 hits structural issues (build system conflicts, unexpected Tauri bugs, Fastify child-process weirdness), reassess before committing more time.

4. Don't perfect-engineer. Ship Z.1 as soon as Commander runs in Tauri, even without native menu bar / tray / notifications. Then iterate.

---

## 11. Appendix — Research sources

Primary sources (all 2025):
- Tauri vs Electron benchmark (Hopp): `https://www.gethopp.app/blog/tauri-vs-electron`
- Tauri vs Electron (RaftLabs 2025 production case studies): `https://raftlabs.medium.com/`
- Tauri v2 official docs: `https://v2.tauri.app/`
- xterm.js + WebGL addon: `@xterm/addon-webgl` v0.19.0 (2025)
- OSC 133 spec (Contour terminal): `https://contour-terminal.org/vt-extensions/osc-133-shell-integration/`
- BridgeSpace architecture: `https://www.bridgemind.ai/products/bridgespace` (reference for target tech stack)
- Goose Electron-to-Tauri migration case study: `github.com/block/goose/discussions/7332`

Key data points:
- Tauri idle memory: 30-50MB (Electron: 150-300MB)
- Tauri startup: <500ms (Electron: 1-2s)
- Tauri installer: 3-10MB (Electron: 80-150MB)
- xterm.js + WebGL: 60fps rendering with GB18030 compliance
- OSC 133: supported by Ghostty, iTerm2, Kitty, WezTerm, VS Code Terminal, Windows Terminal

---

**End of plan.**

> **Suggested save location:** `~/Desktop/Projects/jstudio-commander/docs/briefs/PHASE_Z_NATIVE_APP_PLAN.md`
> **Next action:** When Phase Y closes and migration fully settles, share with Commander CTO via Jose for review.
