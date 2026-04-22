# N3 Dispatch — JSONL Parser + Renderer Registry + ChatThread + Approval Modal + ContextBar Live Data + Frontend Test Coverage

**Dispatch ID:** N3
**From:** CTO (Claude.ai)
**To:** PM (Commander) → continuing CODER spawn
**Phase:** N3 — Native Commander v1 chat surface + live metrics + test hardening
**Depends on:** N2 CLOSED (`native-v1/docs/phase-reports/PHASE_N2_REPORT.md` + N2 acceptance ratifications from CTO thread), `docs/native-v1/ARCHITECTURE_SPEC.md` v1.2 (canonical, with v1.3 + v1.4 correction queue pending PM fold per N2 acceptance ratifications §7), `docs/native-v1/FEATURE_REQUIREMENTS_SPEC.md` v1, prior dispatches N1 + N2
**Template reference:** `~/Desktop/Projects/jstudio-meta/templates/phase-report-template.md` (CODER produces PHASE_N3_REPORT in this format at completion)
**Estimated duration:** 5-8 working days at xhigh effort continuing spawn (calibrated against N2's actual 2.5h delivery with similar regime; CODER's per-rotation velocity + Jose's effort invocation drive actual wall-clock)
**Model/effort:** Opus 4.7 (1M context) / effort=xhigh recommended; architectural novelty in Task 1 (JSONL parser) + Task 5 (approval modal Item 3 sacred) warrant high baseline
**Status:** Ready to fire

---

## §0 — Dispatch purpose in one sentence

Make Commander v1 usable as a daily driver — implement the JSONL event parser that turns Claude Code's transcript stream into typed events, build the exhaustive renderer registry (tool chips, markdown, system events), ship the ChatThread component with message grouping + scroll anchor + compact-boundary handling, wire the approval modal with Item-3-sacred byte-identical semantics, wire ContextBar placeholders to live cost/context/teammate data, and establish the frontend test coverage baseline that N2 deferred.

N3 is the phase where Commander starts feeling like Commander — not just infrastructure, but the actual chat experience Jose interacts with across every session.

---

## §1 — Non-negotiable acceptance criteria

The phase is complete when all of the following observable behaviors are demonstrable:

### 1.1 — JSONL parser ingests Claude Code transcripts into typed events

Sidecar watches each active session's JSONL transcript at `~/.claude/sessions/<claude-session-id>/messages.jsonl` (path verified per current Claude Code version at N3 start; if Claude Code changed the path, CODER escalates before implementing against wrong target). Every new line appended triggers parse → typed event → WS emit.

**Event types produced (exhaustive union, per ARCHITECTURE_SPEC v1.2 §11.2):**
- `user_message` — user turn start + content.
- `assistant_message` — assistant text + usage stats (input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, thinking_tokens, model, cost_usd).
- `tool_use` — tool_use_id + tool name + tool input.
- `tool_result` — tool_use_id reference + result content + status.
- `thinking_block` — duration + (optional) content visibility flag.
- `system_event` super-type dispatching to subtype registry: `compact`, `api_error`, `task_reminder`, `skill_listing`, `invoked_skills`, `queued_command`, `compact_boundary`, `compact_summary`, `edited_text_file`, `file_attachment`, `compact_file_ref`.
- `approval_prompt` — tool_use_id + prompt payload (when Claude Code requests permission before a tool runs).

**Parser contract:**
- Byte-exact line-by-line parsing. Each JSONL line is one event; no multi-line events.
- Exhaustiveness enforced in TypeScript: adding a new type to `ClaudeEventType` union forces matching parser + registry entry. Unknown types do NOT parse to a generic fallback at parser level — they parse as `{type: 'unknown', raw: <line>}` and flow through to renderer registry's unmapped-chip handler (§1.4).
- File watching via FSEvents (Node fs.watch on macOS delegates to FSEvents natively per N2 D4 precedent).
- Per-session isolation: each session's JSONL is watched in an isolated channel; cross-session leakage structurally impossible per required sessionId on every subscription.

**Acceptance:**
- Start a PM session. Run Claude Code. Verify sidecar emits typed events for every JSONL entry via WS debug inspector.
- 58+ sidecar tests include ≥15 new parser tests covering: each event type happy path, malformed JSON graceful handling, path-not-exist handling, rapid append handling (100 lines in 1s), and exhaustiveness enforcement via TypeScript compile-time check.

### 1.2 — Cost extraction to `cost_entries` table per turn

On each `assistant_message` event with usage metadata, sidecar writes one row to `cost_entries`:
- `sessionId`, `model`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `thinkingTokens`, `costUsd`, `turnIndex` (monotonic per session), `timestamp`.
- UNIQUE constraint on (sessionId, turnIndex) per ARCHITECTURE_SPEC v1.2 §10 prevents C26-class duplicates.

**Acceptance:**
- Run a PM session with 3 turns. Query `sqlite3 commander.db "SELECT session_id, turn_index, input_tokens, output_tokens, cost_usd FROM cost_entries ORDER BY turn_index"` → 3 rows with monotonic turn_index, reasonable token/cost values, no duplicates.
- Re-parse the same JSONL (simulate sidecar restart): no duplicate rows inserted (UNIQUE constraint holds).

### 1.3 — ContextBar placeholders wire to live data

The four N2 placeholders (tok / cost / ctx% / teammate) wire to real data via TanStack Query selectors:

- **Token counter:** `useSessionCosts(sessionId)` aggregates `cost_entries` for session → displays cumulative input/output with per-turn delta visible on hover.
- **Cost counter:** same query → displays cumulative cost_usd.
- **Context-window %:** computes `(cumulative_input_tokens_in_current_context_window / MODEL_CONTEXT_LIMITS[model]) * 100`. Colored band per OS §20.RL thresholds (green <50%, yellow 50-70%, orange 70-85%, red >85%).
- **Teammate count:** `useQuery(['session', sessionId, 'teammates'])` counts sessions where `parentSessionId = sessionId` OR where this session's `parentSessionId` matches another session's id (siblings). Display-only count.

**`MODEL_CONTEXT_LIMITS` registry** (new, in `packages/shared/src/model-limits.ts`):
```ts
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'claude-opus-4-7': 1_000_000,  // 1M context
  'claude-opus-4-6': 200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
  // Add more as Claude Code adds models
};
```
CODER verifies actual context limits at dispatch start (may have changed since this dispatch was drafted). Registry is a typed record enforcing every key/value pair is known.

**Context-window window computation:**
- "Current context window" is NOT cumulative input tokens since session start. It's the last assistant_message's input_tokens (which reflects what Claude Code actually fed the model for that turn).
- This distinction is load-bearing: cumulative-since-session-start is meaningless (wraps around compaction boundaries); last-turn-input-tokens is what "how full is my context window" actually means.
- Context-window % recomputes on every new `assistant_message` event.

**Acceptance:**
- ContextBar shows real numbers within 500ms of any new assistant_message event.
- Cost counter increments monotonically across turns.
- Context % band transitions colors correctly as context fills (test: dispatch messages until band flips to yellow, then orange, then red).
- Teammate count reflects actual sibling/parent relationships from DB.

### 1.4 — Renderer registry exhaustive + compile-time enforced

`packages/shared/src/renderer-registry.ts` implements the exhaustive registry per ARCHITECTURE_SPEC v1.2 §11:

- **Top-level `ClaudeEventType` union:** user_message, assistant_message, tool_use, tool_result, thinking_block, system_event, approval_prompt.
- **`SystemEventSubtype` union:** compact, api_error, task_reminder, skill_listing, invoked_skills, queued_command, compact_boundary, compact_summary, edited_text_file, file_attachment, compact_file_ref.
- **`ToolName` union:** Read, Edit, Write, Bash, BashOutput, KillShell, Grep, Glob, Agent, Task, TodoWrite, WebFetch, WebSearch, NotebookEdit, ExitPlanMode, Skill (per N0 v1.2 §11.3 PM fold).

Each union member has exactly one registered renderer. TypeScript enforces via `Record<TUnion, ComponentType<Props>>` pattern. Adding a new union member without matching renderer = compile error.

**Unmapped-event chip:** if parser emits `{type: 'unknown'}` OR a future Claude Code version adds an event type not in the union, renderer dispatcher falls through to `UnmappedEventChip` which displays:
- Event type (if typed), OR "unknown" badge.
- Raw JSON payload in a monospace collapsible view.
- Warning icon + tooltip "This event type is not yet supported in Commander. Raw content shown below."

**No silent dropping.** Every JSONL line renders something visible — a typed chip OR an unmapped chip — never disappears.

**Acceptance:**
- TypeScript compile-time test: comment out one registry entry → `tsc` fails with "Property X is missing in type..." error.
- Runtime test: inject a mock `{type: 'future_unknown_type'}` event → UnmappedEventChip renders with raw payload visible.
- Every known event type has a registered renderer; tests assert exhaustiveness via iteration over union.

### 1.5 — Approval modal (Item 3 sacred, byte-identical semantics)

When an `approval_prompt` event fires, Commander displays an approval modal that Jose must explicitly resolve before the session proceeds.

**Item 3 sacred means:** byte-for-byte identical behavior to web Commander's approval path. Specifically:

- Modal displays immediately on approval_prompt event (≤100ms from event to visible).
- Modal content: prompt text from Claude Code's payload, tool name, tool input (JSON formatted), "Allow", "Deny", "Custom..." buttons.
- Session state transitions to `{kind: 'waiting', approvalPromptId}` until resolution.
- ContextBar reflects "Waiting for approval" action label during this state.
- Resolution writes to `approval_prompts` table with `resolution: 'allow' | 'deny' | 'custom'` + `resolvedAt`.
- Resolution posts back to sidecar via HTTP POST /api/sessions/:id/approval with resolution + optional custom text.
- Sidecar writes resolution to pty.stdin in the exact shape Claude Code expects (literal "yes" / "no" / custom text + newline).
- Modal closes. Session state transitions back to `{kind: 'working'}` until next turn completes.

**No auto-resolution.** No timeout-based auto-allow or auto-deny. If Jose ignores the modal for an hour, session waits an hour.

**No persona bypass.** PM, Coder, Raw sessions all trigger approval modals identically.

**Cross-pane modal behavior:** if Jose has split view with 3 sessions and session 2 fires an approval_prompt, the modal appears ON session 2's pane (not globally overlaying all panes). Jose's work on sessions 1 and 3 is unaffected.

**Global notification on background:** if session 2 fires approval while Commander is backgrounded (Cmd+H or not focused), native macOS notification fires (tauri-plugin-notification, already configured N1). Click notification → focus Commander + select session 2 + surface modal.

**Acceptance:**
- Trigger a known-approval-requiring tool call in a session (e.g., Bash with elevated command). Modal appears within 100ms.
- Click Allow. Sidecar writes "yes\n" to pty.stdin. Claude Code resumes. Session state transitions working → idle correctly.
- Click Deny. Sidecar writes "no\n". Claude Code cancels. Same state transition.
- Click Custom with text "let me think about this". Sidecar writes "let me think about this\n". Claude Code interprets as user response.
- Cross-pane test with 3 sessions: approval on session 2 does not block sessions 1 and 3 input.
- Background test: background Commander, trigger approval, native notification fires, click → Commander foregrounds with modal on correct session.

### 1.6 — ChatThread component with message grouping + scroll behavior

`ChatThread.tsx` renders the session's event stream above the xterm.js terminal pane OR in place of it (Jose's choice via drawer toggle; N3 ships both renderings, Jose chooses via `preferences.chatThread.visibleMode = 'thread' | 'terminal' | 'split'`).

**Message grouping:**
- User messages: standalone blocks with user avatar/icon + timestamp + markdown-rendered content.
- Assistant messages: grouped by turn. One turn = one contiguous assistant response with any interleaved tool_use / tool_result events rendered as chips inline.
- System events: rendered inline at their chronological position (not grouped with user/assistant turns).

**Markdown rendering:**
- Full parity with VSCode Claude sidebar (addresses C30 from Phase Y arc).
- react-markdown + remark-gfm + rehype-highlight + rehype-raw + @tailwindcss/typography.
- Code blocks: syntax highlighted (rehype-highlight with language detection).
- Tables: responsive, scroll horizontally on narrow panes.
- Links: external links open in default browser via Tauri shell plugin.
- Images: rendered inline with max-width respecting pane width.

**Scroll behavior:**
- Auto-scroll to bottom on new message arrival BY DEFAULT.
- If Jose scrolled up to read older messages, auto-scroll is suppressed (preserve Jose's scroll position). "New messages below" indicator appears at bottom.
- Jose scrolls back to bottom OR clicks indicator → auto-scroll re-enables.
- **C39 preserved:** if Jose just sent a user message (user-send override), always scroll to bottom regardless of prior scroll position. This is the "I just spoke, show me what comes next" behavior.

**Compact-boundary rendering:**
- When a `compact_boundary` system event fires, ChatThread renders a visible divider with "Context compacted at <timestamp> (N tokens freed)" label.
- Subsequent `compact_summary` event renders as a collapsible block ("Summary of previous conversation" header, click to expand).

**LiveActivityRow:**
- When session state is `{kind: 'working', toolInProgress: X}` OR `{kind: 'working'}` (no specific tool), a row at the bottom of ChatThread shows:
  - Animated dots + "Claude is working..." OR "Claude is running {toolInProgress}..." label.
  - Elapsed timer since command:started.
  - NOT rendered from text-shape matching (addresses C42 from Phase Y arc). Purely driven by typed session state.

**Acceptance:**
- Run a real Claude Code session with varied content: user message → assistant response with 2 tool_use/result pairs → assistant final text → user follow-up → assistant with a long markdown table + code block.
- ChatThread renders all content grouped correctly, markdown full parity, syntax highlighting works.
- Scroll up during live turn → auto-scroll suspended, indicator visible. Scroll back → resumes.
- Send user message while scrolled up → auto-scroll to bottom (C39).
- Compact boundary event renders divider. Compact summary renders collapsible.
- LiveActivityRow appears on working state, disappears on idle.

### 1.7 — Preference: ChatThread visibility mode

`preferences.chatThread.visibleMode` ∈ `'thread' | 'terminal' | 'split'` (default `'split'`).

- **`'thread'`:** ChatThread takes full pane height. Terminal drawer collapsed.
- **`'terminal'`:** Terminal takes full pane height. ChatThread drawer collapsed (matches N1 + N2 behavior).
- **`'split'`:** ChatThread top 60%, terminal bottom 40% (resizable via drag handle). Default.

Preference toggled via View menu or per-pane menu. Persists globally (not per-session; changing it changes all panes).

**Acceptance:**
- View menu has three mutually-exclusive radio items for mode selection.
- Mode change reflects in all panes within 200ms.
- Mode persists across app restart.

### 1.8 — Frontend test coverage baseline (N2 debt + N3 targets)

N2 deferred all frontend unit tests. N3 ships the baseline + covers N3 additions.

**Required RTL tests:**
- **ContextBar:** state → UI mapping for all `SessionState` kinds. Effort dropdown interaction. Stop button visibility. Cost counter increment on event. Context % band color transitions.
- **SessionPane:** drawer resize interaction, tab selection persistence, collapse/expand.
- **WorkspaceLayout:** focus cycle (Cmd+Opt+→/←), pane close leaves session alive, split view transitions (1→2→3 panes and back).
- **ChatThread:** message grouping (user / assistant / tool chips), scroll anchor with user-send override, compact boundary rendering.
- **ApprovalModal:** mount on approval_prompt event, Allow/Deny/Custom resolution → correct API call, session state transition.
- **Renderer registry:** exhaustive coverage — every `ClaudeEventType` member has a rendering test, UnmappedEventChip renders for unknown types, every `SystemEventSubtype` rendering test, every `ToolName` rendering test.

**Target coverage:** 70%+ frontend statements/branches. Sidecar coverage maintains 75%+ from N2 baseline (58 tests) + new parser/cost tests (≥15 per §1.1 acceptance + ≥5 per §1.2 acceptance + ≥5 per §1.5 approval path) → ≥83 sidecar tests total at N3 close.

**Acceptance:**
- `pnpm test` from monorepo root passes all suites.
- Coverage report generated via `vitest --coverage`; frontend ≥70%, sidecar ≥75%.

### 1.9 — All N1 + N2 behavior preserved

N3 regression on any N1 or N2 §1 criterion is a release blocker. Phase does not close until N1 + N2 + N3 criteria all pass simultaneously.

Specifically verify:
- Commander.app still launches, bundle ≤55 MB (N2 was 35 MB; N3 additions should add <5 MB).
- All N2 surfaces (ContextBar shape, STATE.md drawer, split view, workspace persistence, scrollback restore, preferences modal, .zshrc opt-in, durationMs tracking, WS heartbeat) still work.
- All N1 surfaces (session spawn, bootstrap injection, OSC 133, pre-warm pool, single-instance, clean quit) still work.

---

## §2 — Architectural contract + event-shape specification (per N2 Q2 ratification)

CODER treats ARCHITECTURE_SPEC v1.2 as canonical, with v1.3 + v1.4 corrections noted (pending PM fold). Load-bearing sections for N3:

- **§5 Real-time pipeline** — FSEvents for JSONL watching (Node fs.watch via sidecar, per N2 D4 precedent).
- **§7 IPC contracts** — three-layer split preserved. Approval resolution over HTTP POST, not WS.
- **§10 Drizzle schema** — `cost_entries`, `tool_events`, `approval_prompts` all already exist. `sessionEvents` stores JSONL parsed events for historical query + FTS5 search.
- **§11 Renderer registry** — this is the phase that builds §11.

**Explicit contract per N2 Q2 ratification — event shape → cost_entries mapping:**

```ts
// JSONL assistant_message event from Claude Code (Claude Code JSONL schema)
interface ClaudeJsonlAssistantMessage {
  type: 'assistant';
  message: {
    id: string;
    role: 'assistant';
    model: string;  // e.g. 'claude-opus-4-7'
    content: Array<ContentBlock>;
    stop_reason: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;  // aka cache_write
      // thinking_tokens TBD — may be in output_tokens or separate; CODER verifies at dispatch start
    };
  };
  // ... other fields
}

// Sidecar parser extracts this into:
interface AssistantMessageEvent {
  type: 'assistant_message';
  sessionId: string;
  turnIndex: number;  // monotonic per session
  claudeMessageId: string;
  model: string;
  contentBlocks: ContentBlock[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    thinkingTokens: number;  // 0 if not applicable
  };
  costUsd: number;  // computed via model × token counts (see pricing table below)
  timestamp: number;
}

// Sidecar writes on every assistant_message:
INSERT INTO cost_entries (
  id, session_id, model, input_tokens, output_tokens,
  cache_read_tokens, cache_write_tokens, thinking_tokens,
  cost_usd, turn_index, timestamp, created_at
) VALUES (...);
// UNIQUE (session_id, turn_index) prevents duplicates on re-parse.
```

**Pricing table (as of dispatch draft — CODER verifies at start):**

```ts
export const MODEL_PRICING: Record<string, {
  inputPer1M: number;
  outputPer1M: number;
  cacheReadPer1M: number;
  cacheWritePer1M: number;
}> = {
  'claude-opus-4-7': { inputPer1M: 15, outputPer1M: 75, cacheReadPer1M: 1.5, cacheWritePer1M: 18.75 },
  'claude-opus-4-6': { inputPer1M: 15, outputPer1M: 75, cacheReadPer1M: 1.5, cacheWritePer1M: 18.75 },
  'claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75 },
  'claude-haiku-4-5-20251001': { inputPer1M: 1, outputPer1M: 5, cacheReadPer1M: 0.1, cacheWritePer1M: 1.25 },
};
// CODER verifies current pricing at Anthropic's pricing page at dispatch start.
// If costUsd is provided directly by Claude Code JSONL, prefer that over computed cost.
```

**Context-window calculation:**
- On each assistant_message: the `input_tokens` value is "what Claude Code fed the model for this turn." That's the current context fill.
- `contextUsedPercent = (last_assistant_message.input_tokens / MODEL_CONTEXT_LIMITS[model]) * 100`.
- Compaction resets this naturally: after a compact event, next turn's input_tokens is small (just the summary + recent exchanges).
- No cumulative-since-session logic. Always last turn only.

**If CODER finds Claude Code's JSONL schema differs from the assumption above:** CODER reports in PHASE_N3_REPORT §4 and §8, adjusts implementation to actual schema, does NOT guess.

---

## §3 — Task breakdown (10 tasks, ordered)

Ordered by dependency. Task 1 (parser) is foundational; Tasks 2-8 are independent UI + data work layering on Task 1; Tasks 9-10 are test hardening + smoke.

### Task 1 — JSONL parser + typed event emission (HIGH effort, foundational)

Implement the JSONL parser in `apps/sidecar/src/jsonl/`.

**Concrete scope:**
- `JsonlWatcher` class: watches a single session's transcript file via `fs.watch` (macOS FSEvents native).
- On file append: read new bytes since last position, split by newline, parse each line as JSON, dispatch to typed event builder.
- `parseClaudeJsonlLine(line: string, sessionId: string): ClaudeEvent | UnknownEvent`: returns typed event or `{type: 'unknown', raw: line}`.
- Typed event builders per event type; handle Claude Code's actual JSONL schema (verify at dispatch start by reading a real JSONL file from a recent Claude Code session).
- Emit events to WS channel `session:<sessionId>` as typed `parsed:<type>` events (e.g., `parsed:assistant_message`).
- Error handling: malformed JSON → log warning + emit `system:error` with raw line + continue parsing remaining lines.
- Crash recovery: if parser crashes, sidecar logs error but does not tear down the session pty (JSONL parsing is auxiliary, not required for session function).

**Per-session isolation:** each session's JsonlWatcher runs independently. Cross-session leakage impossible by construction (per-session subscription channels).

**Acceptance per §1.1 + §1.2:**
- JSONL events flow to WS debug inspector during live session.
- `cost_entries` rows written per assistant_message with correct values.
- 15+ parser tests + 5+ cost extraction tests passing.
- Malformed JSONL line doesn't crash parser.

**Effort:** HIGH. Parser + schema verification + event type mapping is architecturally novel. Budget 1-1.5 days.

### Task 2 — `ClaudeEventType` + `SystemEventSubtype` + `ToolName` unions in shared package

Formalize the exhaustive type system in `packages/shared/src/`.

**Files:**
- `packages/shared/src/claude-events.ts` — `ClaudeEventType` union + per-type payload interfaces.
- `packages/shared/src/system-events.ts` — `SystemEventSubtype` union + per-subtype payloads.
- `packages/shared/src/tool-events.ts` — `ToolName` union + per-tool input/output shapes.
- `packages/shared/src/model-limits.ts` — `MODEL_CONTEXT_LIMITS` + `MODEL_PRICING` registries.

**Exhaustiveness enforcement:** `Record<ClaudeEventType, ...>` pattern used in renderer registry (§3 Task 4) forces compile-time coverage. Test: `packages/shared/src/__tests__/exhaustiveness.test.ts` asserts every union member is a key in each registry.

**Acceptance:**
- `pnpm tsc --noEmit` passes across all packages.
- Exhaustiveness tests pass.
- Parser (Task 1) imports these types for event construction.

**Effort:** Medium. Type-authoring work; mechanical once union shape is decided.

### Task 3 — ContextBar placeholders → live data

Wire the four N2 placeholders (tok / cost / ctx% / teammate).

**Concrete scope:**
- `useSessionCosts(sessionId)` TanStack Query hook: fetches `GET /api/sessions/:id/costs` → returns cumulative tokens + cumulative cost + last-turn input tokens (for context %).
- Sidecar route `GET /api/sessions/:id/costs`: aggregates `cost_entries` WHERE session_id + returns summary.
- ContextBar selector reads `useSessionCosts(sessionId)` → displays cumulative tokens + cumulative cost + context %.
- Context % colored band: component switches between 4 Tailwind color classes based on threshold.
- Teammate count: `useQuery(['session', sessionId, 'teammates'])` → GET /api/sessions/:id/teammates returns count.

**Real-time updates:**
- On `parsed:assistant_message` WS event → `queryClient.invalidateQueries(['session', sessionId, 'costs'])` → ContextBar refetches + re-renders.
- Latency target: ≤500ms from assistant_message to ContextBar visible update.

**Acceptance per §1.3:**
- ContextBar shows real numbers during live session.
- Cost counter increments correctly across turns.
- Context % colored band transitions through green → yellow → orange → red as context fills.

**Effort:** Medium. N2 already built the ContextBar shape; N3 connects the wires.

### Task 4 — Renderer registry implementation

Build `packages/shared/src/renderer-registry.ts` exhaustive + compile-time enforced per ARCHITECTURE_SPEC v1.2 §11.2.

**Top-level registry:**
```ts
type RendererMap = {
  user_message: ComponentType<RendererProps<UserMessagePayload>>;
  assistant_message: ComponentType<RendererProps<AssistantMessagePayload>>;
  tool_use: ComponentType<RendererProps<ToolUsePayload>>;
  tool_result: ComponentType<RendererProps<ToolResultPayload>>;
  thinking_block: ComponentType<RendererProps<ThinkingBlockPayload>>;
  system_event: ComponentType<RendererProps<SystemEventPayload>>;  // dispatches to SYSTEM_EVENT_REGISTRY
  approval_prompt: ComponentType<RendererProps<ApprovalPromptPayload>>;
};

export const RENDERER_REGISTRY: RendererMap = {
  user_message: UserMessageRenderer,
  assistant_message: AssistantMessageRenderer,
  tool_use: ToolUseRenderer,  // dispatches to TOOL_RENDERERS
  tool_result: ToolResultRenderer,
  thinking_block: ThinkingBlockRenderer,
  system_event: SystemEventDispatcher,  // dispatches to SYSTEM_EVENT_REGISTRY
  approval_prompt: ApprovalPromptInlineRenderer,  // inline in ChatThread; modal handled separately in Task 5
};
```

**System event subtype registry:**
```ts
type SystemEventRenderers = {
  compact: ComponentType<RendererProps<CompactEventPayload>>;
  compact_boundary: ComponentType<RendererProps<CompactBoundaryPayload>>;
  compact_summary: ComponentType<RendererProps<CompactSummaryPayload>>;
  api_error: ComponentType<RendererProps<ApiErrorPayload>>;
  task_reminder: ComponentType<RendererProps<TaskReminderPayload>>;
  skill_listing: ComponentType<RendererProps<SkillListingPayload>>;
  invoked_skills: ComponentType<RendererProps<InvokedSkillsPayload>>;
  queued_command: ComponentType<RendererProps<QueuedCommandPayload>>;
  edited_text_file: ComponentType<RendererProps<EditedTextFilePayload>>;
  file_attachment: ComponentType<RendererProps<FileAttachmentPayload>>;
  compact_file_ref: ComponentType<RendererProps<CompactFileRefPayload>>;
};

export const SYSTEM_EVENT_REGISTRY: SystemEventRenderers = { ... };
```

**Tool renderer registry:**
```ts
type ToolRenderers = Record<ToolName, ComponentType<ToolRendererProps>>;

export const TOOL_RENDERERS: ToolRenderers = {
  Read: ReadToolChip,
  Edit: EditToolChip,
  Write: WriteToolChip,
  Bash: BashToolChip,
  BashOutput: BashOutputChip,
  KillShell: KillShellChip,
  Grep: GrepToolChip,
  Glob: GlobToolChip,
  Agent: AgentToolCard,
  Task: TaskToolCard,
  TodoWrite: TodoWriteCard,
  WebFetch: WebFetchToolChip,
  WebSearch: WebSearchToolChip,
  NotebookEdit: NotebookEditChip,
  ExitPlanMode: ExitPlanModeChip,
  Skill: SkillChip,
};
```

**Unmapped-event fallback:**
- `UnmappedEventChip`: component rendered when event type OR tool name OR system subtype is unknown.
- Displays: badge ("Unknown event" / "Unknown tool: X" / "Unknown system event: X"), raw JSON payload in collapsible `<pre>` block, warning icon.
- Never silently drops.

**Acceptance per §1.4:**
- Compile-time: comment one registry entry → `tsc` fails with missing property error.
- Runtime: every typed event type has a rendering test; unknown types render UnmappedEventChip.
- Every tool in `ToolName` has a rendered chip with correct visual identity (Read chip looks different from Bash chip, etc.).

**Effort:** Medium-high. Writing ~25 renderer components is mechanical but voluminous. Each renderer is simple; the volume is the cost.

### Task 5 — Approval modal (Item 3 sacred)

Implement `ApprovalModal.tsx` in `apps/frontend/src/components/approval/`.

**Concrete scope:**
- Subscribes to `approval:prompt` events per session (TanStack Query cache + Zustand mount state).
- On event: modal mounts within 100ms of event arrival.
- Modal UI: prompt text, tool name, tool input (JSON formatted, collapsible), three buttons (Allow / Deny / Custom).
- Custom button reveals text input for custom response text.
- Resolution on button click:
  1. Frontend posts `POST /api/sessions/:id/approval` with `{resolution: 'allow' | 'deny' | 'custom', customText?: string}`.
  2. Sidecar writes `approval_prompts` row with resolution + resolvedAt.
  3. Sidecar writes resolution to pty.stdin in Claude Code's expected format ("yes\n" / "no\n" / "{customText}\n").
  4. Modal closes on successful POST response.
- State machine: `approval:prompt` → `{kind: 'waiting', approvalPromptId}`; resolution → `{kind: 'working'}` until next command ends.

**Cross-pane behavior:**
- Modal renders IN the pane where the approval-requesting session is mounted, not globally.
- If session is in split view pane 2, modal appears centered over pane 2's area.
- Other panes remain interactable.

**Background notification:**
- If Commander window is not focused when approval_prompt fires: fire native notification (tauri-plugin-notification from N1) with title "Approval needed in {sessionName}" + body (first 100 chars of prompt).
- Click notification → Commander foregrounds + focuses target pane + modal already mounted.

**No auto-resolution.** No timeout, no default choice. Modal stays until Jose resolves.

**Acceptance per §1.5:**
- Modal mounts on approval_prompt within 100ms.
- Allow / Deny / Custom all resolve correctly to pty.
- Cross-pane: approval on session 2 doesn't block sessions 1 and 3.
- Background: notification fires, click brings Commander + modal forward.
- No auto-resolution after any duration.
- Byte-identical to web Commander approval semantics (if Jose recalls specific web behavior variants, test those specifically).

**Effort:** HIGH. This is the Item 3 sacred flow. Must be byte-identical, not "close enough." Budget 1-1.5 days.

### Task 6 — ChatThread component

Build `ChatThread.tsx` in `apps/frontend/src/components/chat/`.

**Concrete scope per §1.6:**
- Subscribes to session's event stream via `useSessionEvents(sessionId)` (TanStack Query).
- Message grouping: user / assistant / tool chips / system events rendered with correct hierarchy.
- Renderers from §3 Task 4 registry.
- Markdown parity: `react-markdown` + `remark-gfm` + `rehype-highlight` + `rehype-raw` + `@tailwindcss/typography`.
- Scroll anchor logic with user-send override (C39 preserved).
- "New messages below" indicator when auto-scroll suspended.
- Compact boundary divider + compact summary collapsible.
- LiveActivityRow at bottom when session state is working.

**Performance:**
- Virtualization if event count exceeds 200 (via `react-window` or `@tanstack/react-virtual`). 200+ events in a single session is unusual but happens in long debug sessions.
- Event re-rendering: individual events memoized; new event arrival doesn't cause full-list re-render.

**Acceptance per §1.6:**
- Live session shows grouped messages correctly.
- Markdown parity with VSCode Claude sidebar (visual diff test on 10+ real Claude responses).
- Scroll behavior correct including user-send override.
- Compact events render correctly.
- LiveActivityRow appears/disappears on state transitions.

**Effort:** HIGH. ChatThread is the main surface Jose looks at all day. Polish matters. Budget 1.5-2 days.

### Task 7 — ChatThread visibility mode preference

Wire `preferences.chatThread.visibleMode` per §1.7.

**Concrete scope:**
- Add preference row with default `'split'` in first-run seed.
- View menu adds three radio items: Chat Only / Terminal Only / Split (Chat + Terminal).
- Active mode stored in Zustand; persisted via preferences API.
- SessionPane component reads Zustand state and renders ChatThread / TerminalPane / both with resize handle per mode.

**Acceptance per §1.7:**
- Mode switching works in View menu.
- All panes reflect mode change within 200ms.
- Mode persists across restart.

**Effort:** Low. Mechanical preference wiring.

### Task 8 — Frontend test suite (N2 debt + N3 targets)

Build comprehensive RTL test suite per §1.8.

**Test files:**
- `apps/frontend/src/components/__tests__/ContextBar.test.tsx` — state → UI mapping, effort dropdown, stop button, cost counter, context % band.
- `apps/frontend/src/components/__tests__/SessionPane.test.tsx` — drawer resize, tab selection, collapse.
- `apps/frontend/src/components/__tests__/WorkspaceLayout.test.tsx` — focus cycle, pane close, split transitions.
- `apps/frontend/src/components/chat/__tests__/ChatThread.test.tsx` — grouping, scroll anchor with user-send override, compact rendering.
- `apps/frontend/src/components/approval/__tests__/ApprovalModal.test.tsx` — mount on event, Allow/Deny/Custom → correct API + state transition.
- `packages/shared/src/__tests__/renderer-registry.test.tsx` — exhaustive coverage: every event type renders, UnmappedEventChip for unknowns.

**Target 70%+ frontend coverage.**

**Acceptance per §1.8:**
- All test files exist and pass.
- `vitest --coverage` reports ≥70% frontend.
- Sidecar maintains ≥75% (58 baseline + N3 additions = ~83+).

**Effort:** Medium. Test authoring is mechanical once components are built; scope is the voluminous part.

### Task 9 — Integration + regression smoke

Full end-to-end smoke covering N1 + N2 + N3:

**Scenario:**
1. Launch Commander.app from Finder.
2. Spawn PM session on `~/Desktop/Projects/jstudio-meta/`. Verify: bootstrap injects, ContextBar live data wiring shows tokens/cost after first turn, STATE.md drawer shows content.
3. Run Claude Code prompt requiring tool use: "Read the OPERATING_SYSTEM.md file." Verify: Read tool chip renders in ChatThread, ContextBar updates, LiveActivityRow appears during working state then disappears on idle.
4. Run Claude Code prompt requiring approval: "Run `rm -rf /tmp/commander-test-dir`" (create dir first). Verify: approval modal appears within 100ms, Allow writes "yes\n" to pty, Claude Code executes, modal closes, state transitions correctly.
5. Split view 3 panes with 3 different sessions. Fire approval in middle pane. Verify: other panes still interactable, modal only on middle pane.
6. Background Commander, fire approval in any session. Verify: notification fires, click → Commander foregrounds + modal visible.
7. Toggle ChatThread visibility mode through all 3 options. Verify: each mode renders correctly.
8. Long session (50+ messages) → scroll up → new message arrives → "New messages below" indicator. Click indicator → scroll resumes.
9. Trigger compact in a session (enough context). Verify: compact_boundary divider renders, compact_summary collapsible.
10. Close Commander with 3 active sessions. Reopen. Verify: all N1 + N2 + N3 state restored (workspace layout, scrollback, ContextBar data, STATE.md drawer tabs, chat history).
11. Regression: verify every N1 + N2 §1 criterion still passes.

**Acceptance:**
- All 11 smoke steps pass.
- No N1 or N2 regression.
- Bundle ≤55 MB.

**Effort:** Medium. Smoke is exercising; fixes for regressions (if any) add time.

### Task 10 — PHASE_N3_REPORT

Canonical 10-section format per template. Filed at `native-v1/docs/phase-reports/PHASE_N3_REPORT.md`. Target 1000-1800 words.

**Effort:** Low. 0.5 day.

---

## §4 — Explicit non-scope for N3

Phase N4+ covers:

- **Command palette (Cmd+Shift+P).** → N4.
- **Named workspaces + Cmd+Shift+W switcher.** → N4.
- **Dedicated analytics page** (per-model, per-project, optimization insights). → N4.
- **Three-role UI (brief / dispatch / report panes).** → N5.
- **Full OS integrations** beyond single-instance + approval notifications (Dock badge, menu bar beyond basic, tray icon, global shortcuts beyond N1, Spotlight, drag-drop). → N5.
- **Auto-updater endpoint config.** → N6.
- **Code signing + notarization.** Deferred per N1 acceptance memo §4.
- **Multi-AI terminals (Codex, Cursor, Aider).** → v2+.

If CODER finds themselves building any above in N3, stop and flag in PHASE_N3_REPORT §4.

---

## §5 — Guardrails carried forward

Same as N2 dispatch §5:

1. No unilateral architectural decisions. Spec ambiguity → PHASE_REPORT §8.
2. No silent scope expansion. "While I'm here" → §6 (Deferred items).
3. No workarounds without reporting. Spec infeasible → §4 + §5 + flag for CTO ratification.
4. No "I'll clean it up later." Every commit ship-quality. Debt in §7.
5. Strict §2.3 Rust scope boundary.
6. OS §24 pattern-matching discipline. Typed events only.
7. No partial completion claims. Every §1 criterion tested before report.
8. **Surface better approaches with deviation report, never silently second-guess.** N2 D3 / D4 / D5 / D6 precedent established this pattern. Continue.

**Addition specific to N3:** approval modal is Item 3 sacred. If CODER believes a change to web Commander's approval semantics would be an improvement, CODER MUST NOT implement the change. File as §8 question. Approval behavior is byte-identical to web; improvements are out of scope without explicit CTO ratification.

---

## §6 — Testing discipline for N3

Per §1.8 acceptance:

- Frontend target: 70%+ statements/branches.
- Sidecar target: maintain 75%+; add ≥25 new tests for parser + cost extraction + approval path.
- `pnpm test` from monorepo root passes all suites with coverage report ≥ targets.
- Frontend test files listed in §3 Task 8 all exist and pass.

---

## §7 — Commit discipline

Minimum 10 commits. Same format as N1 / N2:

```
<scope>: <imperative summary>

<body>

Refs: ARCHITECTURE_SPEC.md v1.2 §<section>, N3_DISPATCH §<task>
```

Scopes: `shell`, `sidecar`, `frontend`, `db`, `shared`, `build`, `test`, `prefs`, `jsonl`, `registry`, `chat`, `approval`.

---

## §8 — PHASE_REPORT template reference

Same as N1 / N2. Canonical 10-section format. Filed at `native-v1/docs/phase-reports/PHASE_N3_REPORT.md`.

---

## §9 — What PM does

1. Read end-to-end against ARCHITECTURE_SPEC v1.2 (+ v1.3/v1.4 corrections pending fold) + N2 acceptance ratifications.
2. Verify §2 event-shape → cost_entries mapping matches Claude Code's actual JSONL schema (CODER verifies at dispatch start; PM can pre-verify if uncertain).
3. Verify each §1 criterion maps to one or more tasks.
4. Verify §4 non-scope is complete.
5. Verify §5 guardrails carry N1 + N2 lessons + new Item 3 sacred addition.
6. Produce paste-to-CODER prompt:
   - Full dispatch content.
   - Continuing spawn (not architectural reset).
   - Required reading: N1 acceptance memo, N2 report, ARCHITECTURE_SPEC v1.2 (or v1.3/v1.4 if folded), FEATURE_REQUIREMENTS_SPEC, MIGRATION_V2_RETROSPECTIVE §4 + §10.
   - OS reading: §14.1, §15, §20.LL-L11 through L14, §24.
   - PHASE_REPORT template reference.
   - **Explicit "Item 3 approval modal is byte-identical, not improved"** warning.
   - **Explicit "verify Claude Code JSONL schema at start before implementing parser"** reminder.

If PM finds scope gaps, ambiguous effort calibrations, or spec corrections needed: flag for CTO round-trip. Otherwise fire.

---

## §10 — What Jose does

1. Save dispatch to `~/Desktop/Projects/jstudio-commander/docs/dispatches/N3_DISPATCH_CHAT_SURFACE.md`.
2. Paste in PM: "N3 dispatch saved at `docs/dispatches/N3_DISPATCH_CHAT_SURFACE.md`."
3. Wait for PM review + paste-to-CODER prompt OR flag-for-CTO.
4. (Parallel work anytime during wait: dogfood N2 build per PM's list.)
5. Spawn continuing CODER (no architectural reset).
6. Paste PM's prompt into CODER.
7. CODER executes. At xhigh continuing spawn regime, wall-clock likely 1-3 days per N2 calibration; full estimate envelope 5-8 days if unexpected complexity surfaces.
8. PHASE_N3_REPORT → Jose carries to PM → PM review → CTO ratification → N4 dispatch.
9. Optional dogfood between N3 close and N4 start.

---

## §11 — Estimated duration + effort

**Calibrated against N2's actual delivery regime (continuing spawn + xhigh + mostly additive with architectural novelty in parser + approval):**

- **Optimistic:** 3 days wall-clock (if CODER hits parser + registry quickly, N2-like acceleration).
- **Realistic:** 5-6 days.
- **Pessimistic:** 7-8 days (JSONL schema surprises, approval modal edge cases, test suite authoring time).

**Per-task effort:**
- Task 1 (JSONL parser): 1-1.5 days, HIGH.
- Task 2 (type unions): 0.5 day, medium.
- Task 3 (ContextBar wiring): 0.5 day, medium.
- Task 4 (renderer registry): 1-1.5 days, medium-high (volume).
- Task 5 (approval modal): 1-1.5 days, HIGH.
- Task 6 (ChatThread): 1.5-2 days, HIGH.
- Task 7 (visibility mode pref): 0.25 day, low.
- Task 8 (frontend test suite): 1 day, medium (voluminous).
- Task 9 (smoke): 0.5 day, medium.
- Task 10 (report): 0.25 day, low.

Total: 7.5-9.75 days nominal; compression factor from continuing spawn + xhigh typically 0.3-0.5x → actual wall-clock 3-5 days likely.

**Token budget:** $1000-2000 estimated. N3 is larger than N2 in scope (more surfaces, more tests). Cost scales accordingly.

---

## §12 — Closing instructions to CODER

N3 builds on N1 + N2 working foundation. Do not regress any N1 or N2 behavior.

Read in order before writing a line of code:

1. This dispatch (start to finish).
2. `~/Desktop/Projects/jstudio-commander/native-v1/docs/phase-reports/N1_ACCEPTANCE_MEMO.md`.
3. `~/Desktop/Projects/jstudio-commander/native-v1/docs/phase-reports/PHASE_N1_REPORT.md`.
4. `~/Desktop/Projects/jstudio-commander/native-v1/docs/phase-reports/PHASE_N2_REPORT.md`.
5. `~/Desktop/Projects/jstudio-commander/docs/native-v1/ARCHITECTURE_SPEC.md` v1.2 (with v1.3 + v1.4 corrections pending fold).
6. `~/Desktop/Projects/jstudio-commander/docs/native-v1/FEATURE_REQUIREMENTS_SPEC.md`.
7. `~/Desktop/Projects/jstudio-commander/docs/migration-v2/MIGRATION_V2_RETROSPECTIVE.md` §4 + §10.
8. `~/Desktop/Projects/jstudio-meta/OPERATING_SYSTEM.md` §14.1, §15, §20.LL-L11 through L14, §24.
9. `~/Desktop/Projects/jstudio-meta/templates/phase-report-template.md`.

**Before writing parser (Task 1):** read a real Claude Code JSONL file from a recent session. Verify actual event schema matches §2 assumptions. If schema differs, implement against actual, report discrepancies in PHASE_REPORT §4.

**Item 3 sacred reminder:** approval modal is byte-identical to web Commander semantics. No improvements. File improvement ideas as §8 questions.

Execute 10 tasks in order. Commit at task boundaries. Test as you build. Ask PM for ambiguity — do not guess.

When all 10 §1 criteria + N1 9 criteria + N2 9 criteria pass simultaneously: write PHASE_N3_REPORT.md, file at `native-v1/docs/phase-reports/PHASE_N3_REPORT.md`, notify Jose.

---

**End of N3 dispatch. Ready to fire.**
