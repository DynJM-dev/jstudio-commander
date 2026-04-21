import type { ChatMessage } from '@commander/shared';

// Candidate 38/41 — pending-local message filter. Extracted from the
// inline predicate in `ChatPage.tsx` so the retention rules are unit-
// testable without React + have a single documented source of truth.
//
// Context: when a user submits a prompt, ChatPage inserts a local
// `ChatMessage` into `localCommands` immediately (optimistic render)
// before the server's JSONL capture echoes it back as a canonical
// user-role `ChatMessage` through `useChat`. The filter decides when
// to drop the local entry — normally when the canonical text match
// lands, or when a safety-valve ceiling elapses so a never-echoed
// local doesn't stick at the bottom of the chat forever.
//
// Observed failure modes addressed:
//
//   Mode 1 — slash commands typed in the chat input. Claude Code
//   routes slash commands through `system.subtype='local_command'`
//   records (per `jsonl-parser.service.ts:351`), NOT user-role
//   records. `jsonlUserTexts` never contains a match; the previous
//   10s+sessionAck safety valve never fires because slash commands
//   don't transition `session.status` to `'working'`. Pre-fix: the
//   local bubble stuck forever.
//
//   Mode 2 — transcript pipeline lag on pure-text turns. Server's
//   JSONL watcher may surface records only at turn-end (documented
//   in `docs/phase-y-closeout.md`). During the lag, the 10s+sessionAck
//   rule CAN fire if server flipped `working` — good. But on turns
//   where `session.status` stays `idle` (classifier lag) throughout,
//   the local bubble lingers until the full turn's records batch-
//   land.
//
//   Mode 3 — api.post failure. When the send-command POST fails
//   (network flap, server restart, wifi glitch), the local entry is
//   still added to state but no server record ever lands. Silent
//   catch + no cleanup = permanently-stuck bubble.
//
//   Mode 4 — refresh-driven "disappearance." On page refresh the
//   `localCommands` state resets to `[]`. Any entries that haven't
//   been ingested server-side are lost. User perceives this as
//   "messages disappeared."
//
// Fix posture:
//   - Add an UNCONDITIONAL hard ceiling (`PENDING_LOCAL_MAX_AGE_MS`)
//     that drops the entry regardless of `sessionAck`. Closes modes
//     1, 2, and 3 without churning on healthy fast-path sends.
//   - ChatPage's send handler is updated separately (see call site)
//     to delete the local entry on api.post failure, addressing the
//     mode-3 disappearance symptom explicitly.
//   - Mode 4 (refresh) is inherent to the optimistic-rendering
//     design; true fix is server-ack-before-display, which is larger
//     than this rotation's scope. Hard ceiling limits the window of
//     loss to PENDING_LOCAL_MAX_AGE_MS.

// Fast-drop window for the ack-based safety valve (pre-existing —
// preserved for fast-path healthy sends). When the session has
// transitioned to `working` or `waiting`, we know Claude received the
// input; a 10s+ local that hasn't matched via text-normalization is
// almost certainly stuck on a normalization drift and should drop.
export const PENDING_LOCAL_ACK_AGE_MS = 10_000;

// Hard upper bound — drop ANY local that's older than this regardless
// of session state. Closes Modes 1/2/3 above. 60s is conservative:
// healthy sends clear within 1-3s (server-confirmed user record lands
// via WS append + text-normalization match); slash-command sticky
// bubbles stop being a permanent UX issue after 60s in the worst case.
// Tradeoff: if the post truly is in flight for > 60s (very slow
// network), the local bubble vanishes before the server echo arrives.
// The server echo IS visible once it lands, so no content is truly
// lost — just the optimistic bubble.
export const PENDING_LOCAL_MAX_AGE_MS = 60_000;

// Text normalization — lowercase, trim, collapse every whitespace
// run to a single space. Matches #224's hardening: exact-trim equality
// produced duplicates when Claude Code mangled whitespace / case /
// newlines during ingest. Exported so the consumer uses the SAME
// normalization when building the jsonl-user-texts set.
export const normalizePendingLocalText = (s: string): string =>
  s.trim().toLowerCase().replace(/\s+/g, ' ');

// Build the set of normalized user-role text payloads that Claude
// Code has ingested into JSONL. Used by the filter predicate to
// short-circuit-drop locals whose canonical server echo has arrived.
export const buildJsonlUserTextsSet = (
  messages: ReadonlyArray<ChatMessage>,
): Set<string> => {
  const out = new Set<string>();
  for (const m of messages) {
    if (m.role !== 'user') continue;
    for (const b of m.content) {
      if (b.type !== 'text') continue;
      out.add(normalizePendingLocalText(b.text));
    }
  }
  return out;
};

// Filter predicate — TRUE to keep the local entry, FALSE to drop.
// Contract (evaluate in order):
//
//   1. Canonical text match → DROP. The server echoed it, the
//      primary source is authoritative.
//   2. Age >= PENDING_LOCAL_MAX_AGE_MS → DROP unconditionally. The
//      hard ceiling that closes Modes 1-3.
//   3. Age > PENDING_LOCAL_ACK_AGE_MS AND session is working/waiting
//      → DROP. Pre-existing fast-path safety valve, preserved.
//   4. Otherwise KEEP.
//
// `nowMs` is passed in so tests can walk the time axis deterministically.
// `sessionStatus` is the session's current status string (`idle` /
// `working` / `waiting` / `stopped` / undefined).
export const shouldKeepPendingLocalEntry = (args: {
  entry: ChatMessage;
  jsonlUserTexts: ReadonlySet<string>;
  sessionStatus: string | undefined;
  nowMs: number;
}): boolean => {
  const { entry, jsonlUserTexts, sessionStatus, nowMs } = args;

  // Extract the entry's text payload — expected shape is the first
  // content block of type `text`. Other shapes (attachments, etc.)
  // aren't produced by ChatPage's pendingLocal creator, but defend
  // anyway so a future shape change doesn't regress this predicate.
  const firstBlock = entry.content[0];
  const text = firstBlock?.type === 'text' ? firstBlock.text : '';
  const normalized = normalizePendingLocalText(text);

  // Gate 1 — canonical match.
  if (jsonlUserTexts.has(normalized)) return false;

  // Gate 2 — unconditional hard-age ceiling. Closes Modes 1-3.
  const entryTs = Date.parse(entry.timestamp);
  const age = Number.isFinite(entryTs) ? nowMs - entryTs : 0;
  if (age >= PENDING_LOCAL_MAX_AGE_MS) return false;

  // Gate 3 — fast-path safety valve.
  const sessionAck = sessionStatus === 'working' || sessionStatus === 'waiting';
  if (age > PENDING_LOCAL_ACK_AGE_MS && sessionAck) return false;

  // Gate 4 — keep.
  return true;
};
