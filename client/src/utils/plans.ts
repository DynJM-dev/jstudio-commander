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

// Walks the full message stream and builds the session's active plan.
// Per-group walking (old impl) breaks the moment an approval/"Proceed" message
// splits the assistant turn: TaskCreates end up in one group and subsequent
// TaskUpdates in later groups, so the per-group plan for each is incomplete.
// A session-wide walk keeps one running Map of tasks keyed by real ID, and
// resets it only when a NEW TaskCreate appears after all existing tasks are
// completed — that's how we distinguish "next phase" from "update to the
// current plan".
export const buildPlanFromMessages = (
  messages: ChatMessage[],
  toolResults: Map<string, { content: string; isError?: boolean }>,
): { plan: PlanTask[]; firstCreateMessageId: string | null; allDone: boolean } => {
  let tasks = new Map<string, PlanTask>();
  let firstCreateMessageId: string | null = null;

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    for (const block of msg.content) {
      if (block.type !== 'tool_use') continue;

      if (block.name === 'TaskCreate') {
        const input = block.input as { subject?: string; description?: string };
        const result = toolResults.get(block.id);
        const match = result?.content.match(TASK_ID_FROM_RESULT);
        if (!match) continue;
        const id = match[1]!;

        // New-plan detection: if everything in the running plan is already
        // completed, the next TaskCreate starts a fresh plan. Without this,
        // two sequential plans would visually merge into one growing list.
        if (tasks.size > 0) {
          const allComplete = Array.from(tasks.values()).every((t) => t.status === 'completed');
          if (allComplete) {
            tasks = new Map();
            firstCreateMessageId = null;
          }
        }

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
