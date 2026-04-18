// Chat pipeline event policy (Issue 5 — architecture lock).
//
// POLICY STATEMENT
//
//   Default = render. The drop list is an explicit noise-suppression
//   mechanism only — a denylist, not an allowlist. Every JSONL record
//   shape that is NOT on this list reaches a renderer: either a typed
//   component (text bubble, TodoWrite plan widget, Bash card, etc.) or
//   the debug placeholder chip (UnmappedEventChip). Unknowns are always
//   visible; silent vanishing is a bug. New Claude Code record shapes
//   surface immediately with the debug chip instead of requiring a
//   parser patch.
//
// WHY A DENYLIST, NOT AN ALLOWLIST
//
//   Earlier phases accreted silent exclusions because the pattern was
//   "only these specific shapes render." That flipped the invariant:
//   unknown future shapes vanished from the chat pane until someone
//   noticed and patched the allowlist. Jose's Issue 5 repro looked like
//   a parser filter narrowness bug for exactly this cultural reason —
//   the render pipeline had grown conservative without grounding the
//   drop decisions in an explicit, grep-able policy.
//
//   Inverting the default to "render, unless on this short list" means
//   new record shapes can never be invisible. The worst failure mode is
//   a debug chip the user files an issue about, not an empty pane.
//
// WHERE THIS LIVES
//
//   This module is the single source of truth. The parser consults it
//   to short-circuit known-noise records (efficiency), and the
//   renderer consults the same constants when it needs to reason
//   about drop intent. If you need to add a drop entry, add it here
//   with an inline rationale and cite the issue/observation that made
//   it noise.

// Top-level `record.type` values that are pure Claude Code bookkeeping.
// Dropped at the parser boundary since surfacing them would paper the
// chat with records that carry no content the user could act on.
export const DROP_RECORD_TYPES: ReadonlySet<string> = new Set([
  // The user changed permission mode (acceptEdits / dontAsk / …). UI
  // status bar handles this; chat surfacing would be chatter.
  'permission-mode',
  // File-history snapshots fire on every write. Strictly internal.
  'file-history-snapshot',
  // Command queue bookkeeping — the command itself is also logged as a
  // user/assistant turn; surfacing the queue event duplicates it.
  'queue-operation',
  // Auto-generated conversation titles. Rendered by the sidebar, not
  // the chat transcript.
  'ai-title',
  // User-set custom titles. Same rationale as ai-title.
  'custom-title',
  // Cached "last prompt" echo. The prompt itself lands as a user
  // record; this one is sidebar bookkeeping.
  'last-prompt',
  // Per-tool progress ticks. Visible via the live activity row while
  // the tool is running; in-transcript copies would be noise.
  'progress',
]);

// `system.subtype` values that are known noise. `compact_boundary` is
// NOT on this list — it maps to a dedicated ContentBlock with its own
// renderer.
export const DROP_SYSTEM_SUBTYPES: ReadonlySet<string> = new Set([
  // Fires on every pane stop (end of turn). Per-turn volume.
  'stop_hook_summary',
  // Per-turn duration tick. The live activity row already shows the
  // elapsed number; a duplicate in-chat banner after every turn would
  // bury the actual content.
  'turn_duration',
]);

// `attachment.attachment.type` values that are known noise. Known
// renderer-mapped types (`edited_text_file`, `task_reminder`) are
// handled by the parser directly; everything else either surfaces as
// the debug chip or lands on this list.
export const DROP_ATTACHMENT_TYPES: ReadonlySet<string> = new Set([
  // PostToolUse hook telemetry — 80%+ tail of attachment volume.
  'hook_success',
  // The skill-loading manifest Claude reads on session start; not
  // meaningful in the conversation view.
  'skill_listing',
  // Per-tool permission declarations; the permission prompt UI
  // handles the user-facing piece.
  'command_permissions',
  // Deferred-tool schema deltas; internal plumbing for tool search.
  'deferred_tools_delta',
  // Skills-invoked summary; implicit in tool_use blocks that follow.
  'invoked_skills',
]);
