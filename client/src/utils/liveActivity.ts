import type { ChatMessage, ContentBlock } from '@commander/shared';

// Phase Y Rotation 1.7 Fix 1.7.C — `liveThinking` scan narrowing.
//
// Candidate 42 surfaced during Rotation 1.6.B smoke: Claude sometimes
// emits a `thinking` block AFTER a `text` block within the same
// assistant message (post-text reasoning interleaved with composing).
// Pre-1.7 the scan walked backward through `last.content` and returned
// the first `thinking.text` it found — which was the POST-text thinking
// block — causing response-text bleed into the LiveActivityRow display.
//
// Fix: narrow the scan to thinking blocks that appear BEFORE the last
// `text` block in the message. Once composing text is underway, the
// text block is the current surface; thinking blocks that appear after
// it (internal post-text reasoning) are not the "live thinking" we want
// to surface in the activity row.
//
// Semantics:
//   - If a text block exists in the message, scan thinking blocks
//     ONLY in content[0..lastTextIndex - 1]. Return the latest such
//     thinking block's text (same "most recent within the valid range"
//     ordering as the pre-fix version).
//   - If no text block exists (thinking-only, mid-turn pre-text), the
//     scan walks the full content array unchanged. Non-regression for
//     the primary cogitating case.
//   - If no thinking block exists, return null.
//   - If `message` is null / undefined / not role='assistant', return
//     null. Matches the gating `ChatPage.tsx:472-481` already applies.
export const extractLiveThinkingText = (
  message: ChatMessage | undefined | null,
): string | null => {
  if (!message || message.role !== 'assistant') return null;
  const blocks = message.content;
  if (!blocks || blocks.length === 0) return null;

  // Find the index of the LAST text block. Scan thinking only strictly
  // before that index — any thinking block at or after `lastTextIndex`
  // is post-text reasoning that would bleed response content.
  let lastTextIndex = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i]?.type === 'text') {
      lastTextIndex = i;
      break;
    }
  }

  const scanUpperBound = lastTextIndex === -1 ? blocks.length : lastTextIndex;
  for (let i = scanUpperBound - 1; i >= 0; i--) {
    const b: ContentBlock | undefined = blocks[i];
    if (b?.type === 'thinking' && b.text) return b.text;
  }
  return null;
};
