// Detects user-facing approval / permission / choice prompts on a
// tmux pane's output. Extracted from session.routes.ts `/output`
// handler so the matching rules are unit-testable.
//
// PATTERN-MATCHING CONSTRAINT (Issue 9 Part 2, cross-refs Issue 8 P0 + 8.1):
// Approval-prompt classifiers MUST match on explicit option tokens
// — numbered list + Yes/No/Custom options, exact Allow/Deny buttons,
// exact (y/n) parenthetical, the literal "trust this folder" phrase.
// NEVER on tabular shape, broad trailing `?`, or "Esc to cancel" /
// "Enter to confirm" alone (Claude Code uses those for viewer modals
// like `/status`, `/compact` preview, etc., which are NOT actionable
// approvals).
//
// Issue 9 Part 2 removed two broad fallbacks that previously fired on
// `/status` tabular output:
//   - `Esc to cancel` / `Enter to confirm` as a standalone trigger.
//     Covered for real approvals by the Allow/Deny or numbered-choice
//     branches; as a standalone it matched every viewer modal.
//   - Question-mark-ending + `\d+)` numbered-option regex. Matched
//     tabular output lines ending in `?` or numbered data rows.

export interface Prompt {
  type: 'trust' | 'permission' | 'choice' | 'confirm';
  message: string;
  context?: string;
  options?: string[];
}

// Pulls the block between a `────` separator and the prompt-option
// lines. Used to surface the tool-call context (file path, command,
// etc.) alongside the prompt message so the UI can show what Claude
// is asking about.
const extractToolContext = (outputLines: string[]): string | undefined => {
  let sepIdx = -1;
  for (let k = outputLines.length - 1; k >= 0; k--) {
    if (/^─{4,}/.test((outputLines[k] ?? '').trim())) { sepIdx = k; break; }
  }
  if (sepIdx < 0) return undefined;

  const contextLines: string[] = [];
  for (let j = sepIdx + 1; j < outputLines.length; j++) {
    const line = outputLines[j]?.trim() ?? '';
    if (/^\s*[❯>]\s*\d+\./.test(outputLines[j] ?? '')) break;
    if (line.startsWith('Esc to cancel')) break;
    if (/^Do you want/.test(line)) break;
    if (line === '') continue;
    contextLines.push(line);
  }
  return contextLines.length > 0 ? contextLines.join('\n') : undefined;
};

// Kill-switches. These pane states CONCLUSIVELY rule out an active
// approval prompt — running detection anyway would cascade false
// positives (e.g. `⏵⏵ bypass permissions on` means Claude Code will
// NEVER emit a permission prompt, so anything prompt-shaped is chrome
// or chat content).
const isPromptImpossible = (outputLines: string[]): boolean => {
  const footerTail = outputLines.slice(-15).join('\n');
  const hasBypassPermissions = /⏵⏵\s*bypass permissions on/i.test(footerTail);
  const waitingOnTeammate =
    /\b\d+\s+teammates?\b/i.test(footerTail) &&
    /Waiting on input/i.test(footerTail);
  return hasBypassPermissions || waitingOnTeammate;
};

export const detectPrompts = (outputLines: string[]): Prompt[] => {
  if (isPromptImpossible(outputLines)) return [];

  const prompts: Prompt[] = [];
  const bottomLines = outputLines.slice(-5).filter((l) => l.trim().length > 0).slice(-3);
  const bottomRaw = bottomLines.join('\n');

  // 1. Workspace-trust prompt — exact literal phrase Claude Code uses.
  if (bottomRaw.includes('trust this folder') || bottomRaw.includes('Yes, I trust')) {
    prompts.push({
      type: 'trust',
      message: 'Claude Code is asking if you trust this workspace folder.',
      options: ['Yes, I trust this folder', 'No, exit'],
    });
  }

  // 2. Numbered-choice block — `❯ 1.` on the currently-focused option,
  //    `  2.` / `  3.` as siblings. Numbers followed by `.` (dot),
  //    NOT `)` (paren) — dot is Claude Code's strict convention.
  const tailLines = outputLines.slice(-10);
  const markerIdx = tailLines.findIndex((l) => /^\s*❯\s*\d+\./.test(l));
  if (markerIdx >= 0) {
    const options = tailLines
      .filter((l) => /^\s*[❯ ]\s*\d+\./.test(l))
      .map((l) => l.replace(/^\s*[❯ ]\s*/, '').trim());
    if (options.length > 1) {
      const fullMarkerIdx = outputLines.length - 10 + markerIdx;
      let contextMsg = 'Choose an option';
      for (let j = fullMarkerIdx - 1; j >= Math.max(0, fullMarkerIdx - 5); j--) {
        const line = outputLines[j]?.trim();
        if (line && line.length > 5 && !line.startsWith('─') && !line.startsWith('⎿') && !/^\s*[❯ ]\s*\d+\./.test(line)) {
          contextMsg = line;
          break;
        }
      }
      prompts.push({
        type: 'choice',
        message: contextMsg,
        context: extractToolContext(outputLines),
        options,
      });
    }
  }

  // 3. Allow / Allow always / Deny permission prompt. Requires BOTH
  //    "Allow" and ("Deny" or "allow always") — no broad match.
  if (!prompts.some((p) => p.type === 'choice') &&
      (bottomRaw.includes('Allow') && (bottomRaw.includes('Deny') || bottomRaw.includes('allow always')))) {
    const contextLine = outputLines.find((l) =>
      l.includes('Allow') && (l.includes('run:') || l.includes('to run') || l.includes('to execute'))
    );
    const actionLine = outputLines.find((l) =>
      l.includes('Allow') && !l.includes('run:') && !l.includes('to run')
    );
    const message = contextLine?.trim() ?? actionLine?.trim() ?? 'Permission requested';
    const hasAlwaysOpt = bottomRaw.includes('always') || bottomRaw.includes('Allow always');
    prompts.push({
      type: 'permission',
      message,
      context: extractToolContext(outputLines),
      options: hasAlwaysOpt ? ['Allow', 'Allow always', 'Deny'] : ['Allow', 'Deny'],
    });
  }

  // 4. (y/n) literal parenthetical — Claude Code's lowest-level
  //    confirm. Explicit token, safe to match broadly within tail.
  if (prompts.length === 0 && /\(y\/n\)/i.test(bottomRaw)) {
    const lastYn = bottomLines.filter((l) => /\(y\/n\)/i.test(l)).pop();
    if (lastYn) {
      prompts.push({ type: 'confirm', message: lastYn.trim(), context: extractToolContext(outputLines) });
    }
  }

  // Issue 9 Part 2: `Esc to cancel` / `Enter to confirm` as a standalone
  // trigger REMOVED. Claude Code prints those footers in every viewer
  // modal (`/status`, `/compact` preview, `/login`, `/model`, file
  // preview, etc.) — NOT just in approval prompts. Any real actionable
  // approval has already matched one of branches 1–4 above (trust /
  // numbered / Allow-Deny / y-n). The catch-all was the primary false-
  // fire on `/status` tabular output.
  //
  // Also removed: the trailing-`?` + `\d+)` regex fallback. It matched
  // tabular numbered rows and any chat prose line ending with `?`. No
  // real approval prompt relies on that shape; every one carries an
  // explicit option vocabulary that the branches above already catch.

  return prompts;
};
