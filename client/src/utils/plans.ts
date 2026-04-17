import type { ChatMessage } from '@commander/shared';
import type { PlanTask } from '../components/chat/AgentPlan';

export interface MessageGroup {
  role: 'user' | 'assistant' | 'system';
  messages: ChatMessage[];
  timestamp: string;
  model?: string;
  // Stable key — first message id in the group. Used by the sticky widget
  // to target a specific plan's inline card via IntersectionObserver.
  key: string;
}

// Matches Claude Code's TaskCreate tool_result: "Task #<N> created successfully: ..."
const TASK_ID_FROM_RESULT = /Task #(\d+) created/;

// Builds the session's CURRENT plan — the plan whose TaskCreate bundles live
// in the most recent assistant group. Earlier plans are historical; once
// Claude has moved on to a new assistant turn with fresh TaskCreates, the
// prior plan is no longer "active" regardless of its completion state.
// Rationale: the old "reset when everything completes" heuristic mis-fires
// on plans that were abandoned mid-phase (some incomplete tasks leftover)
// and got merged into the next plan, making the widget report stale phases
// long after Claude moved on (Phase H bug).
//
// Rules:
// 1. Latest assistant group containing at least one TaskCreate defines the
//    plan's identity (firstCreateMessageId) and its task set.
// 2. Multiple TaskCreate bundles inside the same group merge into one plan.
// 3. TaskUpdates from that group and any subsequent groups apply to those
//    task IDs — completed tasks still belong to this plan, which lets the
//    widget run its allDone auto-fade without a lie about recency.
export const buildPlanFromMessages = (
  messages: ChatMessage[],
  toolResults: Map<string, { content: string; isError?: boolean }>,
): { plan: PlanTask[]; firstCreateMessageId: string | null; allDone: boolean } => {
  const groups = groupMessages(messages);

  let latestGroupIdx = -1;
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g || g.role !== 'assistant') continue;
    const hasCreate = g.messages.some(
      (m) =>
        m.role === 'assistant' &&
        m.content.some((b) => b.type === 'tool_use' && b.name === 'TaskCreate'),
    );
    if (hasCreate) {
      latestGroupIdx = i;
      break;
    }
  }

  if (latestGroupIdx === -1) {
    return { plan: [], firstCreateMessageId: null, allDone: false };
  }

  const tasks = new Map<string, PlanTask>();
  let firstCreateMessageId: string | null = null;

  for (let i = latestGroupIdx; i < groups.length; i++) {
    const g = groups[i]!;
    for (const msg of g.messages) {
      if (msg.role !== 'assistant') continue;
      for (const block of msg.content) {
        if (block.type !== 'tool_use') continue;

        // TaskCreate is only accepted from the latest group. Older groups'
        // TaskCreates are historical — they belong to prior plans that are
        // no longer current.
        if (block.name === 'TaskCreate' && i === latestGroupIdx) {
          const input = block.input as { subject?: string; description?: string };
          const result = toolResults.get(block.id);
          const match = result?.content.match(TASK_ID_FROM_RESULT);
          if (!match) continue;
          const id = match[1]!;

          if (!firstCreateMessageId) firstCreateMessageId = msg.id;
          tasks.set(id, {
            id,
            title: input.subject ?? 'Task',
            description: input.description,
            status: 'pending',
          });
        }

        if (block.name === 'TaskUpdate') {
          const input = block.input as { taskId?: string; status?: string; subject?: string };
          const taskId = input.taskId;
          if (!taskId || !tasks.has(taskId)) continue;
          // Claude Code emits 'deleted' when a task is permanently removed —
          // drop it from the plan so it never hits the renderer (which only
          // knows about the PlanTask['status'] union).
          if (input.status === 'deleted') {
            tasks.delete(taskId);
            continue;
          }
          const task = tasks.get(taskId)!;
          if (input.status) task.status = input.status as PlanTask['status'];
          if (input.subject) task.title = input.subject;
        }
      }
    }
  }

  const plan = Array.from(tasks.values());
  const allDone = plan.length > 0 && plan.every((t) => t.status === 'completed');
  return { plan, firstCreateMessageId, allDone };
};

// Group consecutive messages by role. tool_result-only user messages fold into
// the preceding assistant group (they're system bookkeeping, not user turns).
// Matches ChatThread's rendering logic so inline & sticky plans stay in sync.
export const groupMessages = (messages: ChatMessage[]): MessageGroup[] => {
  const result: MessageGroup[] = [];

  const isToolResultOnly = (msg: ChatMessage) =>
    msg.role === 'user' &&
    msg.content.length > 0 &&
    msg.content.every((b) => b.type === 'tool_result');

  const isInternalCommand = (msg: ChatMessage) =>
    msg.role === 'user' &&
    msg.content.length > 0 &&
    msg.content.every((b) =>
      b.type === 'text' && /^[\s]*<(command-name|command-message|command-args|local-command-stdout)>/m.test(b.text)
    );

  const isInterruptMessage = (msg: ChatMessage) =>
    msg.role === 'user' &&
    msg.content.length > 0 &&
    msg.content.every((b) =>
      b.type === 'text' && /interrupt/i.test(b.text)
    );

  for (const msg of messages) {
    if (isInternalCommand(msg)) continue;

    if (isInterruptMessage(msg)) {
      result.push({ role: 'system', messages: [msg], timestamp: msg.timestamp, key: msg.id });
      continue;
    }

    if (isToolResultOnly(msg)) {
      const last = result[result.length - 1];
      if (last && last.role === 'assistant') last.messages.push(msg);
      continue;
    }

    const last = result[result.length - 1];
    if (last && last.role === msg.role && msg.role === 'assistant') {
      last.messages.push(msg);
      if (!last.model && msg.model) last.model = msg.model;
    } else {
      result.push({
        role: msg.role as 'user' | 'assistant' | 'system',
        messages: [msg],
        timestamp: msg.timestamp,
        model: msg.model,
        key: msg.id,
      });
    }
  }
  return result;
};

export const buildToolResultMap = (
  messages: ChatMessage[],
): Map<string, { content: string; isError?: boolean }> => {
  const map = new Map<string, { content: string; isError?: boolean }>();
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === 'tool_result') {
        map.set(block.toolUseId, { content: block.content, isError: block.isError });
      }
    }
  }
  return map;
};

export interface ActivePlan {
  plan: PlanTask[];
  key: string;
  allDone: boolean;
}

// Returns the currently-active plan (or most-recently-completed one so the
// widget can run its fade-out). The key is the id of the message that
// contained the plan's first TaskCreate — inline anchor for the sticky
// IntersectionObserver and identity for "same plan vs new plan" decisions.
export const getActivePlan = (messages: ChatMessage[]): ActivePlan | null => {
  const toolResults = buildToolResultMap(messages);
  const { plan, firstCreateMessageId, allDone } = buildPlanFromMessages(messages, toolResults);
  if (plan.length === 0 || !firstCreateMessageId) return null;
  return { plan, key: firstCreateMessageId, allDone };
};
