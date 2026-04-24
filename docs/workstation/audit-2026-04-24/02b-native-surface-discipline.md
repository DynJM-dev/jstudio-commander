# Native Command Center audit — surface layer + execution discipline

**Scope:** frontend (`command-center/apps/frontend/src/`), UI primitives (`command-center/packages/ui/`), phase reports N1-N4a.1, CTO close briefs, DECISIONS.md. **Out of scope:** Rust shell, sidecar source, migrations, MCP server, PTY/hook pipeline.

**Tree snapshot:** 13 TSX/TS files, 2364 LOC total in `apps/frontend/src/` (kanban + run-viewer + task-card + add-task-modal + preferences + hooks + sidecar-client + state + app shell). `packages/ui/` is 1 component + barrel export. Native Command Center shipped N1 through N4a.1 in roughly 18 hours (2026-04-23 03:35 → 19:32 local).

---

## §1 — Frontend stack overview

**Runtime + build:** React 19.0.0 + Vite 6.0.3 + TypeScript 5.7.2 (strict) + Tailwind 4.0.0-beta.8 (`@tailwindcss/vite` plugin, no config file). `package.json` at `command-center/apps/frontend/package.json:14-35`.

**Data layer:** TanStack Query 5.62.11 for server state. TanStack Router 1.95.1 is declared (D-N1-02 forward-compat) but **never mounted** — Debt 4, carried from N1. Kanban is a single-route app; `app.tsx:36-48` renders `<KanbanPage />` + two conditional overlays (Preferences modal, RunViewer modal) with no router context.

**UI primitives:** Radix Dialog 1.1.4 + Radix Tabs 1.1.2 + Radix Slot 1.1.1. No shadcn CLI — in-repo Button/Dialog/Tabs primitives at `apps/frontend/src/components/ui/` (24 + 52 + 35 LOC = 111 total). Debt 5. `DialogShell` at `components/ui/dialog.tsx:14-52` is the reusable `<RadixDialog.Root + Portal + Overlay + Content>` wrapper.

**Terminal:** xterm.js (`@xterm/xterm` + `@xterm/addon-fit`) behind the `packages/ui` `XtermContainer` primitive. First real mount landed in N3 (`run-viewer.tsx`), not N1.

**Styling:** Tailwind v4 via `@tailwindcss/vite`, no separate config. All CSS utility classes, no `tailwind.config.js`. Zero glassmorphism — this is a dark-mode-only developer tool, not an ERP (`neutral-950` backgrounds, `neutral-800` borders throughout).

**State:** Zustand 5.0.2 for UI state (`state/preferences-store.ts`, 28 LOC). **NB: this deviates from the global JStudio "no Zustand" rule in user CLAUDE.md.** It's a Command Center-local decision; the store only holds `{open, activeTab, viewingRunId}` — three cross-cutting UI flags that App.tsx and Kanban/TaskCard both read.

**Icons:** `lucide-react` 0.469.0 (global rule honored).

**Lazy chunks:** `PreferencesModal` (46 kB) + `RunViewer` (~40 kB, excluding xterm) + `XtermProbe` (292 kB — xterm.js weight) code-split via `React.lazy`. Main bundle stays at 240 kB raw per N2 metrics. KB-P1.14 ≤500 kB budget honored across all phases.

**No react-router, no Next.js, no SSR, no StrictMode** (main.tsx:53 lines).

---

## §2 — Kanban + TaskCard + RunViewer architecture

**Component tree:**
```
App (app.tsx)
├── KanbanPage (pages/kanban.tsx) — single home route
│   ├── header: title + count + Add-task Button + Preferences Button
│   ├── 4× KanbanColumn (client-side bucketed)
│   │   └── TaskCard[] → onClick → setViewingRunId(latestRun.id)
│   └── AddTaskModal (open state local, status preseeded per column)
├── PreferencesModal (lazy) — three tabs: General / Plugin / Debug
└── RunViewer (lazy, portal-rendered) — conditional on viewingRunId
```

**TanStack Query key patterns:**
- `['sidecar', 'config']` — `readSidecarConfig()` once; gates every other query via `enabled: Boolean(config?.port)` (`kanban.tsx:32-45`, `run-viewer.tsx:57-73`).
- `['sidecar', 'tasks-with-latest-run']` — 3-second `refetchInterval` (`kanban.tsx:44`). Single round-trip drives all 4 columns; client-side `bucketTasksByStatus` at `kanban.tsx:50-53` + `:116-127`.
- `['sidecar', 'run', runId]` — polling with dynamic halt: `refetchInterval` returns `false` once status is terminal (`run-viewer.tsx:69-72`). This is a clean pattern.
- `['sidecar', 'knowledge', taskId]` — 5-second polling (`run-viewer.tsx:408`).
- `['sidecar', 'recent-events']` — 3-second polling in Preferences Debug tab (`preferences.tsx:289`).

**Optimistic updates:** zero. Every mutation ends with `queryClient.invalidateQueries(...)` and re-fetches (e.g. `run-viewer.tsx:150-154` cancel → 3 invalidations; `add-task-modal.tsx:44-51` create → 2 invalidations). Acceptable at this scale; explicitly a watchlist item in N4a §7.

**Missing (product-shape gaps noted in phase reports and UX observations):**

1. **No drag-and-drop between columns** (N4a §8 bullet 2). Moving a card requires opening the AddTaskModal's column selector, or PATCHing via MCP. HTML5 DnD or `@dnd-kit/*` is called out as a one-afternoon add.
2. **No status selector on the card itself** — just a status pill (`task-card.tsx:45-52`). Status changes only through the modal.
3. **No multi-pane concept.** RunViewer is a fullscreen modal (`w-[min(1100px,94vw)] h-[min(720px,88vh)]` at `run-viewer.tsx:165`). Opening a card replaces context entirely. KB-P1.15 hidden-workspace suspension is N4b-deferred and never shipped.
4. **No interactive input path.** See §3.
5. **No animations.** Jose flagged in N4a.1 step 8 smoke: "No move animation — transition was instant." `framer-motion` not installed. Bucketing is a pure React re-render on the next poll.
6. **Back button ≡ Close button** (`run-viewer.tsx:170-179` — Back → `onClose`). N4a §8 calls this out: "When N4b ships workspaces + N5+ ships card→viewer→card navigation, the two need to diverge." Currently identical.
7. **Non-chronological N3 Debug panel** (Debt 24) was **closed by replacement** in N4a — the Recent Agent Runs panel was deleted rather than fixed. Kanban is now the single surface for run visibility.

**Rendering weight:** task card is `button` when `latestRun` is non-null, plain `div` otherwise (`task-card.tsx:22-34`). Single query drives 4 columns — no N+1 on the frontend.

---

## §3 — XtermContainer contract

**File:** `command-center/packages/ui/src/xterm-container.tsx` (113 LOC). Export barrel at `packages/ui/src/index.ts:1-2`.

**What it wires:**
- New `Terminal` with `disableStdin: true` + `cursorBlink: false` + Menlo 13pt + dark theme (`xterm-container.tsx:57-64`).
- `FitAddon` applied + rAF-deferred `fit()` per KB-P4.2 WebGL/WKWebView initial-mount race (`:65-89`).
- Explicit-dispose lifecycle in the `useEffect` cleanup (`:91-99`): `fit.dispose()` then `term.dispose()`. This is KB-P4.2 v1.2 protected-principle conformance.
- Scrollbar-gutter CSS scoped via inline `<style>` using `.cmdr-xterm-host` class (`:9-21`) — eliminates the 14px right-side dead strip xterm otherwise produces.
- `onReady(term)` callback after first rAF so caller receives a mounted, fit-sized Terminal reference.
- `initialContent` prop for static probe content.

**What it DOES NOT wire — the central product-shape gap:**

**Line 61:** `disableStdin: true`. There is no `term.onData((data) => ...)` wiring anywhere in the file. The Terminal is a pure **output sink**: `useSessionStream.onPtyData` (`hooks/use-session-stream.ts:139-142`) calls `termRef.current?.write(bytes)` to display, but the opposite direction — keystrokes → sidecar stdin — has no path at all.

The sidecar has no stdin-forwarding route. N3's `agent-runs/lifecycle.ts` uses `stdout: 'pipe'` + `ReadableStream.getReader()` (from PHASE_N3 §4 D1 — the Bun.spawn `terminal` API probed broken in 1.3.13; fallback chosen). Bytes flow one way: PTY stdout → WS `pty:<session_id>` topic → `onPtyData` callback → `term.write`. There is no complementary `term.onData → WS publish → sidecar stdin write` loop.

This makes Command Center a **one-way observer**: Jose can watch agent runs spawned via external Claude Code MCP sessions or via spawn_agent_run RPCs. He cannot type into them. Combined with the `tasks.status` being user-authoritative (N4a §8 bullet 1) and no interactive REPL wiring, the product is architecturally a **kanban + run viewer monitor**, not the "interactive multi-session workspace" the reset targets.

**What's reusable for JS WorkStation:**
- The scrollbar-gutter CSS pattern (`:9-21`) — xterm always leaks 14px without this.
- The rAF-deferred `fit()` before atlas cache (`:82-89`) — KB-P4.2 WebGL race-fix.
- Explicit-dispose discipline in the cleanup return (`:91-99`).
- The `onReady(term)` handshake so callers can hold a stable `termRef` for subsequent writes without re-creating the Terminal.

**What to change for JS WorkStation:**
- Flip `disableStdin: false`.
- Add `onInput?: (data: string) => void` prop; wire `term.onData(onInput)` inside the useEffect.
- Add a sidecar stdin-write route (out of this audit's scope, but the frontend contract change is the 10-line diff above).

---

## §4 — TanStack + React hooks patterns (incl. the N2.1.2 trap)

**`useSessionStream(opts)`** at `apps/frontend/src/hooks/use-session-stream.ts:61-146`:
- Takes `{sessionId, port, bearer, onPtyData, hookEventCap}`.
- Opens one WebSocket per hook instance (line 86: `new WebSocket(wsUrl)`) — not pooled.
- Authenticates via `?access_token=` query param (§4 D2 of N2 phase report — Bun's WHATWG WebSocket has no custom-header escape hatch).
- Subscribes to `hook:<session_id>` + `pty:<session_id>` per KB-P1.13 per-session-channel discipline.
- Returns `{status, hookEvents, reset}` with hook events as React state (capped, default 50).
- Routes PTY bytes through a **ref-backed callback** (`onPtyDataRef` at `:73-76`) so `onPtyData` can change across renders without tearing down the WebSocket. This is the identity-stability pattern.
- Cleanup on unmount: unsubscribe + close (`:130-140`).

**The `liveStreamReceivedRef` + `scrollbackBlobRef` pattern in RunViewer** (`components/run-viewer.tsx:83-131`):

Three refs encode a race-free seed-then-stream contract:
1. `scrollbackBlobRef` — latest poll-refetched `scrollbackBlob` (updated by effect at `:87-89`, read by `onTermReady`).
2. `scrollbackSeededRef` — one-shot guard; once the blob is written OR the live stream has landed, skip further seeds.
3. `liveStreamReceivedRef` — flipped to `true` on the first PTY byte from the WS (`:140`). If live bytes arrived first, skip the blob-seed entirely to avoid duplication.

**`onTermReady` uses empty-dep `useCallback`** (`:93-110`) — stable identity per render. This is the **Debt 23 fix**. Pre-fix, `onTermReady` was `useCallback(..., [run?.scrollbackBlob])`, so every poll refetch after `running → completed` produced a new callback identity, `XtermContainer`'s `useEffect([..., onReady, ...])` (at `xterm-container.tsx:100`) re-ran, cleanup disposed the old Terminal, a new empty one mounted — visual "buffer cleared" artifact. The scrollback WAS preserved on disk (close + reopen restored content), so it was a UI lifecycle bug, not data loss. See N3 §7 Debt 23 + N4a §2 T5.

**N2.1.2 wrapper-identity trap (MEMORY.md pin, separate from this Command Center work but load-bearing pattern):** `useMutation` / `useQuery` wrappers return a **fresh object identity per render**. Including them in `useEffect` deps causes the effect to fire on every render. Memory flag references commit f4e6cea in the prior web Commander codebase. The solution is either (a) empty-dep `useCallback` with ref-backed payload reads (the N4a Debt 23 fix pattern), or (b) destructure only the stable methods (`mutate`, not the wrapper) if the outer hook's identity is stable. In Command Center, `useSessionStream`'s `onPtyDataRef` pattern is the preferred shape: ref-backed callback, WS reconnection only on primitive-identity keys `[sessionId, port, bearer, hookEventCap]`.

**Summary of hooks patterns worth preserving:**
1. Config gate via `enabled: Boolean(configQuery.data?.port)` before any other query fires (kanban.tsx, run-viewer.tsx, add-task-modal.tsx, preferences.tsx all use it).
2. Dynamic `refetchInterval` that halts on terminal state (`run-viewer.tsx:69-72`).
3. Ref-backed per-render callback so WS/effect lifecycle is bound to primitive identity only.
4. Single round-trip + client-side bucketing for categorized views (kanban pattern).
5. Fire-and-forget invalidation on mutation settle — no optimistic updates, acceptable at this scale.

---

## §5 — Phase report lessons — deviations + issues + tech debt

### Scope + deviation counts per phase

| Phase | Scope (one-line) | §4 Deviations | §5 Issues | §7 Debt added / closed |
|---|---|---|---|---|
| N1 | Foundation — Tauri shell + Bun sidecar + React + 9-table schema + ⌘, Preferences. | 8 (D1 bun:test, D2 bun.lock, D3 Biome, D4 `~/.commander/`, D5 Router unused, D6 shadcn in-repo, D7 Fastify logger, D8 read_config IPC) | 5 (jsdom shims, externalBin triple, state-dir collision, RunEvent::ExitRequested flake, Biome autofix) | +7 (Debt 1-7) |
| N1.1 | Codesign pass + Commander→Command Center rename. | 4 (D1 script placement, D2 string audit scope, D3 spctl gate, D4 post-filing visible:true/center:true) | 1 (AppleScript quit target) | +1 (Debt 8), 0 closed |
| N2 | Plugin + MCP dual-protocol — 13 hooks + 6-step pipeline + 10 MCP CRUD tools. | 6 (D1 hand-rolled MCP, D2 WS query-param bearer, D3 composite PK, D4 hyphen fix, D5 plugin bundled in .app, D6 a-d four Claude Code runtime compat fixes) | 3 (Fastify/Pino types, Bun WS custom-header, Biome import-sort) | +7 (Debt 9-15), 0 closed |
| N2.1 | Bearer persistence hotfix (Debt 15). | 4 (D1 Option A, D2 hardening beyond minimum, D3 version bump, D4 Logger bridge cast) | 2 (Rotation-didn't-reproduce — CODER-induced; temp-HOME isolation) | +2 (Debt 16-17), -1 (Debt 15 closed) |
| N3 | PTY spawn + worktree + 5-state FSM + PTY→WS streaming + first real xterm mount. | 4 (D1 Bun.spawn terminal API broken → stream-pipe fallback, D2 shallow-copy fallback, D3 spawn_agent_run auto-chain, D4 shell metachar detection) | 4 (Bun terminal API probe, Pino→Fastify type, a11y lint, test assertion rewrite) | +7 (Debt 18-24), -2 (Debt 16, 17 closed) |
| N4a | Kanban + task CRUD + identity migration + RunViewer Radix + knowledge panel. | 3 (D1 deleted-on-disk policy, D2 no projectId filter, D3 Debt 24 discovered mid-smoke) | 0 named (Debt 24 root-causing folded into next rotation) | 0 new, -3 (Debt 22/23/24 all closed in scope or by replacement) |
| N4a.1 | Identity-file consumer hotfix — resolveProjectRoot + dual-form lookup + UNIQUE-collision dedup. | 3 (D1 cwd-missing fallback, D2 race-reconciliation best-effort, D3 N4a test updates) | 3 (state-isolation breach, tmp-file collision, PTY callback post-teardown) | 0 new, -1 (Debt 24 closed pending smoke — now passing) + Debt 26 queued (no animation) |

### Aggregate tech-debt table (Debts 1 through 26)

| # | Short name | Severity | Open/Closed | Closed-by-what | Carryable to JS WorkStation? |
|---|---|---|---|---|---|
| 1 | Boot-time `CREATE TABLE IF NOT EXISTS` instead of drizzle-kit migrator | LOW | OPEN | — | partial — drizzle-kit preferred; pattern transfers |
| 2 | `scrollback_blob` TEXT (base64) not BLOB | LOW | OPEN | — | no — WorkStation rethinks storage |
| 3 | Rust `RunEvent::ExitRequested` SIGTERM flake — parent-death watchdog masks | LOW | OPEN | — | yes — watchdog pattern is cheap belt-and-suspenders |
| 4 | TanStack Router declared but unused | LOW | OPEN | — | yes — WorkStation will multi-route |
| 5 | shadcn CLI not wired — 3 primitives authored in-repo | LOW | OPEN | — | partial — keep if ≤8 primitives |
| 6 | Bundle 65 MB (Bun runtime dominates) | LOW | OPEN | — | yes — accept; carry forward |
| 7 | No Win/Linux CI matrix (macOS-only) | LOW | OPEN | — | yes — same v1 posture |
| 8 | Tauri v2 `signingIdentity:null` doesn't auto-codesign | LOW | OPEN | — | yes — `post-tauri-sign.sh` pattern keeps |
| 9 | Hand-rolled MCP (no resources/prompts/SSE) | LOW | OPEN | — | reassess — WorkStation scope may not need MCP |
| 10 | `hook_events.id` composite PK shape | LOW | OPEN | — | reassess with schema rewrite |
| 11 | Plugin marketplace local-only | LOW | OPEN | — | yes if WorkStation keeps plugin |
| 12 | JSONL secondary indexer not shipped | LOW | OPEN | — | yes — defer to v2 as before |
| 13 | MCP `initialize` version not negotiated | LOW | OPEN | — | partial — trivial fix |
| 14 | Debug "Recent hook events" unvirtualized | LOW | OPEN | — | yes — virtualize when lists grow |
| 15 | Bearer rotation risk | MED | CLOSED | N2.1 regression test + atomic write + readOutcome trace | yes — pattern is load-bearing |
| 16 | Pino/FastifyBaseLogger type bridge | LOW | CLOSED | N3 T0 — shared `Logger` type in `packages/shared/src/logger.ts` | yes — same structural-interface pattern |
| 17 | CODER smoke-readiness clobbered Jose's `~/.commander/` | LOW | CLOSED | SMOKE_DISCIPLINE v1.2 §3.4.2 + N3 mktemp+trap pattern | yes — NON-NEGOTIABLE |
| 18 | Bun.spawn `terminal` API unused (stream-pipe fallback) | LOW | OPEN | — | reassess — WorkStation may need real TTY |
| 19 | No WS back-pressure | LOW | OPEN | — | yes — defer to N7 hardening |
| 20 | RunViewer no cross-restart hydration | LOW | OPEN | — | yes — Zustand persist on `viewingRunId` |
| 21 | Non-git shallow-copy has no size cap | LOW | OPEN | — | yes — add byte probe |
| 22 | a11y biome-ignore on RunViewer backdrop | LOW | CLOSED | N4a T5 Radix Dialog replaced raw divs | yes — Radix is the answer |
| 23 | RunViewer clears xterm on running→completed | LOW | CLOSED | N4a T5 `scrollbackBlobRef` + empty-dep `useCallback` + `liveStreamReceivedRef` | yes — load-bearing pattern |
| 24 | Debt 24 root cause: two consumers of `projects.identity_file_path` missed the column-semantics flip | MED | CLOSED | N4a.1 `resolveProjectRoot` helper + `ensureProjectByCwd` dual-form + migration UNIQUE-collision dedup with forensic trail | yes — migration discipline + back-compat helper |
| 25 | (Reserved / not allocated) | — | — | — | — |
| 26 | Kanban column-move has no animation (Jose flagged N4a.1 step 8) | LOW | OPEN | — | yes — `framer-motion` `layout` or `layoutId` |

**Key closed-in-scope learnings:**
- **Debt 15 bearer rotation** closed by regression test + atomic write + `readOutcome` trace. Zero-change fix was possible; CODER shipped **hardening beyond minimum** (4 defensive improvements independently revertable). PM accepted §4 D2. Precedent for JS WorkStation: investigation-that-finds-no-bug still ships durable defenses (OS §20.LL folded into MEMORY.md "Phantom-bug investigations still ship durable defenses").
- **Debt 23 xterm clear** closed by React identity-stability refactor. Root cause (callback identity churn on polling refetch) identified from first principles, not from instrumentation — but live-transition validation in N4a.1 step 7 was the first real test (N4a step 7 had been blocked by Debt 24's ENOTDIR).
- **Debt 24 identity-file consumers** closed with a canonical pattern: (a) `resolveProjectRoot(identityFilePath)` back-compat helper, (b) `ensureProjectByCwd` dual-form lookup with atomic file-first write, (c) migration-level UNIQUE-collision dedup with `system:migration-dedup` forensic hook_events row, (d) zero-dependent vs has-dependent branches (halt loudly on has-dependent, never auto-delete user data). This is the **persist-before-destructive** pattern (OS §20.LL-L16) plus **schema-invariant-aware fallback**.

---

## §6 — Guardrails G1-G14 observed in action

Guardrails as applied in this arc (from reports + briefs):
- **G5 (Rust ≤150 LOC):** Never breached. Stayed at 149/150 across N1→N4a.1. The `read_config` IPC (N1 §4 D8) was added deliberately at a 4-LOC cost rather than shipping `@tauri-apps/plugin-fs` which would have consumed a capability scope + more LOC. Bearer never leaves Rust's process boundary unless the frontend explicitly asks via IPC.
- **G8 (no schema changes in hotfix):** N2.1 (bearer) added zero schema. N4a.1 added zero DDL — only type-level `MigrationSummary.deduplicated` bump. Explicitly called out at N4a.1 §4 end.
- **G10 (instrumentation-first when symptom unchanged):** N3 Issue 1 fired a clean G10 probe against Bun.spawn terminal API — three inline test scripts, ~10 min investigation, then §4 D1 fallback decision. NO second speculative iteration. N2.1 almost fired G10 on the rotation bug, but §5 Issue 1 revealed the "bug" was CODER-induced via prior N2 T11 `rm -rf` — root-caused via transcript re-read rather than instrumentation (same discipline, different probe shape).
- **G12 (dep hygiene — deps commit with importing code):** Every phase closes with `bun install --frozen-lockfile` clean assertion. Only new dep across all 6 phases was `@fastify/websocket@11.2.0` in N2, committed alongside `ws-bus.ts` that imported it. N2.1 / N3 / N4a / N4a.1 all shipped zero new deps.
- **G11 (mentioned in N4a.1 §4 end** "No G5 / G8 / G10 / G12 violations" but not fired): covers commit hygiene generally.

Most under-used: **G14** (unclear; no rotation fired it). Most load-bearing: **G5 + G12** as structural constraints, **G10** as pattern enforcement.

---

## §7 — Execution discipline patterns worth carrying forward

1. **SMOKE_DISCIPLINE v1.0 → v1.1 → v1.2.** Rule: user-facing smoke is specified at the outermost user-experience layer (Finder → pixels), not at any intermediate layer. v1.1 added §3.4.1 window-presence triad (process tree + window count + window geometry) after N1.1 zombie-window escape. v1.2 added §3.4.2 state-isolation **NON-NEGOTIABLE** after N2.1 discovered CODER's N2 T11 smoke had `rm -rf`'d Jose's real `~/.commander/`, inducing a fresh-bearer mint later misread as a production bug (one full hotfix rotation of false-lead investigation). **Prevents:** API-layer smoke shipping a broken UI; process-layer smoke shipping a zombie-window app; smoke scripts clobbering user state. **JS WorkStation inherits verbatim** — smoke-spec checkpoint must be the Finder-launched `.app` with Jose's pixels, state-isolated via mktemp+trap. File: `~/Desktop/Projects/jstudio-meta/standards/SMOKE_DISCIPLINE.md`.

2. **OS §20.LL-L14 ground-truth over derivation.** Rule: when a signal can be observed directly, subscribe to it; don't derive it from a proxy. The N1.1 zombie-window escape fit this: CODER checked AX `background only is false` (process-layer derivation) when pixel-window presence was the ground truth. Fix was `visible: true` + `center: true` in `tauri.conf.json` + a §3.4.1 window-count check that measures windows-in-AX-list, not process visibility. **JS WorkStation inherits** — any smoke check is framed as "what does Jose observe?" not "what does the underlying system report?"

3. **OS §20.LL-L15 smoke as layer specification.** Rule: §9 smoke scenarios in phase dispatches name the outermost user-experience layer explicitly, then decompose downward only as needed to describe what Jose interacts with. Codified as the `standards/SMOKE_DISCIPLINE.md` §3.1 right/wrong examples. **JS WorkStation inherits** — CTO dispatches specify §9 at the outermost layer only.

4. **OS §20.LL-L16 persist-before-destructive-action.** Rule: write to persistence BEFORE any destructive state change. Instances: (a) N2.1 `config.json` atomic `writeFile(tmp) → rename(tmp, file)` pattern (torn-write elimination); (b) N3 T3 pre-kill scrollback flush before SIGTERM (so cancel/timeout don't lose user-visible output); (c) N4a T1 identity migration `writeFile → rename → db.update` per row; (d) N4a.1 `ensureProjectByCwd` first-create `writeFile(tmp) → rename → db.insert`. **JS WorkStation inherits** — every destructive op (delete, kill, rename, replace) is preceded by its persistence twin.

5. **PHASE_REPORT §3.3 is PM-owned after Jose's smoke.** Rule: CODER authors §1-§2 + §3.1-§3.2 + §4-§10; §3.3 is blank until Jose dogfoods + PM appends. Before 2026-04-22, CODER self-certified; post-SMOKE_DISCIPLINE v1.0, CODER cannot self-certify user-facing smoke. **Prevents:** CODER declaring done when live pixels disagree. **JS WorkStation inherits** — all PHASE_REPORTs use the 10-section template at `~/Desktop/Projects/jstudio-meta/templates/phase-report-template.md`.

6. **Pre-dispatch reality check (2026-04-22 CTO operating change).** Rule: before writing a dispatch, CTO reads the last N PHASE_REPORTs + current DECISIONS + current code state. Applied explicitly in N4a §3.4: "Every acceptance point corresponds to a code path exercised by the automated suite OR observable in the production bundle build output." **Prevents:** dispatches specifying acceptance for speculative infrastructure that doesn't exist. **JS WorkStation inherits** — CTO dispatches cite file:line for every code path named.

7. **Diagnostic empty-commit before fix (G10/G11/G12 composite).** Rule: when root cause requires instrumentation, commit evidence first (empty commit or docs-only commit with diagnostic output), then ship the fix in a subsequent commit. Not fired in this arc because all root causes were identified from first principles or transcript re-reads. Pattern preserved from prior web Commander debug arcs (G10/G11/G12 diagnostic-then-fix pairs, MEMORY.md pin). **JS WorkStation inherits** if a rotation surfaces instrumentation-dependent symptoms.

8. **Phantom-bug investigations still ship durable defenses.** Rule: an investigation that concludes "no bug here" still ships regression test + hardening + discipline fold. N2.1 is the textbook case — "bearer rotation" turned out to be CODER-induced, but shipped atomic-write + `readOutcome` trace + ENOENT discrimination + empty-bearer rejection + T3 regression test anyway. §4 D2 explicitly named: "each is independently revertable if PM prefers the minimum-change shape." PM accepted. **JS WorkStation inherits** — investigation cost is sunk; defensibility gained is durable.

9. **CODER authorized autonomous rotations on finalizer/closeout.** MEMORY.md pin. Late-stage rotations can self-instrument, spawn sub-agents, self-dogfood, multi-commit to compress decision latency. **JS WorkStation inherits** for native rebuild final phase.

10. **Split large rotation on context pressure.** MEMORY.md pin — N4a pre-split into N4a + N4b before any rotation fired because T10 workspace + T11 ContextBar + T12 smoke-ext were too much scope for one CODER window. N4a shipped 10 tasks; T10+T12 explicitly deferred to N4b; T11 deferred to N5+ after T9 discovery showed no token signal. **JS WorkStation inherits** — CTO dispatches specify explicit sub-phase boundaries when scope exceeds one CODER rotation's context comfortably.

---

## §8 — Keep-vs-scrap for JS WorkStation

| Module | Verdict | One-line reason |
|---|---|---|
| Kanban home-page concept | KEEP+EXTEND | Four columns + single query + client-bucket is the right skeleton; extend with drag-and-drop + status-selector-on-card + animated bucket transitions (Debt 26). |
| TaskCard click→open-viewer | KEEP | Clean click → `setViewingRunId` → portal-rendered RunViewer. Pattern scales. |
| RunViewer as Radix Dialog modal | REPHRASE | Radix Dialog is right; fullscreen modal shape is wrong for "interactive multi-session workspace." Re-cast as a **pane** in a multi-pane layout, not a dialog-over-kanban. The Back/Close equivalence (N4a §8) self-diagnoses this — the modal is never "navigated away from," it's "dismissed." |
| XtermContainer primitive | KEEP+EXTEND | Keep scrollbar-gutter CSS + rAF fit + explicit-dispose. Extend with `onInput` prop + `disableStdin: false` + sidecar stdin-write route (see §3). |
| TanStack Query data layer | KEEP | Config-gate pattern + dynamic `refetchInterval` halt + ref-backed callbacks + invalidation-on-settle all work at this scale. Re-use as-is. |
| `liveStreamReceivedRef` / scrollback-blob seed pattern | KEEP | Load-bearing race-free seed-then-stream contract. Port verbatim to any future run-viewer shape. |
| Knowledge panel (append-only) | KEEP | KB-P1.3 append-only + per-task scope + close/reopen persistence. Good pattern. Adds markdown rendering in WorkStation scope (N4a §8 bullet 3). |
| Add-task modal with status pre-seed | KEEP | Per-column "+" preseeds status; good ergonomic. Extend with keyboard shortcut to focus the modal. |
| 10-section PHASE_REPORT template | KEEP | Stable across 6+ rotations. Inherits at `~/Desktop/Projects/jstudio-meta/templates/phase-report-template.md`. |
| SMOKE_DISCIPLINE.md v1.2 doc | KEEP | NON-NEGOTIABLE §3.4.2 state isolation + §3.4.1 window triad. Verbatim to WorkStation. |
| Guardrails G1-G14 | KEEP | Structural constraints that prevented regressions across arc. Port whole set. |
| Pre-dispatch reality check discipline | KEEP | 2026-04-22 CTO operating change. Verbatim. |
| Zustand for 3 cross-cutting UI flags | KEEP (Command Center-local) | Violates global JStudio rule but the alternative (prop-drill + Context at App root) is worse here. Treat as scoped exception. |
| TanStack Router declared-but-unused | SCRAP | Debt 4 carried from N1. Either mount it or drop the dep. WorkStation is multi-route → mount it. |
| shadcn CLI (not installed, in-repo primitives) | REPHRASE | At 3 primitives, in-repo is fine. At >8 primitives, adopt the CLI. WorkStation likely crosses that threshold. |
| Recent Agent Runs Debug panel | SCRAP (already scrapped) | Debt 24 closed by replacement in N4a. Kanban is the primary surface. |
| Hand-rolled MCP server | REASSESS | 182 LOC covers initialize + tools/list + tools/call. If WorkStation wants Resources/Prompts/SSE, swap in `@modelcontextprotocol/sdk`. If it stays CRUD-only, keep hand-roll. |
| Plugin dir bundled into `.app` via `bundle.resources` | KEEP | Simplest install path. `get_resource_path('plugin')` IPC gives absolute filesystem path; Claude Code loads from there. Dev iteration pain (rebuild per hooks.json edit) is acceptable. |
| `post-tauri-sign.sh` codesign pass | KEEP | Debt 8 mitigation. Until Tauri v2 upstream fix, load-bearing. |
| Parent-death watchdog in sidecar | KEEP | Cheap belt-and-suspenders for Rust `RunEvent::ExitRequested` flake (Debt 3). Keep even after root-cause fix. |

---

## Closing note

The Command Center frontend **executes its current product shape cleanly** — kanban + modal RunViewer + append-only knowledge + D-KB-07 narrow MCP tool surface — but the product shape itself is MCP-observer, not interactive workspace. The central missing piece is at `packages/ui/src/xterm-container.tsx:61` (`disableStdin: true`) + no `term.onData()` wiring + no sidecar stdin-write route. Everything else in the surface layer (data flow, query patterns, ref-backed callbacks, Radix primitives, lazy chunks, persistence discipline) is reusable; the xterm input gap is the decisive architectural flip for JS WorkStation.

Every execution-discipline pattern from N1 through N4a.1 is worth inheriting verbatim. The rotations shipped 60/60 tests, zero guardrail breaches, 8 deviations per phase max, and closed every debt raised within the same arc (15, 16, 17, 22, 23, 24) — the discipline artifacts (SMOKE_DISCIPLINE v1.2, OS §20.LL-L14/L15/L16, PHASE_REPORT §3.3 PM-owned, pre-dispatch reality check) are the load-bearing process layer.
