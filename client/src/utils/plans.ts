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

// Walks an assistant group's TaskCreate/TaskUpdate tool calls to produce a plan.
// Task IDs are monotonic across the session so we key each task by the real ID
// parsed from TaskCreate's tool_result, not a per-group counter.
export const buildPlanFromAssistantGroup = (
  group: MessageGroup,
  toolResults: Map<string, { content: string; isError?: boolean }>,
): PlanTask[] => {
  if (group.role !== 'assistant') return [];
  const tasks = new Map<string, PlanTask>();

  for (const msg of group.messages) {
    for (const block of msg.content) {
      if (block.type !== 'tool_use') continue;

      if (block.name === 'TaskCreate') {
        const input = block.input as { subject?: string; description?: string };
        const result = toolResults.get(block.id);
        const match = result?.content.match(TASK_ID_FROM_RESULT);
        if (!match) continue;
        const id = match[1]!;
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
        if (taskId && tasks.has(taskId)) {
          const task = tasks.get(taskId)!;
          if (input.status) task.status = input.status as PlanTask['status'];
          if (input.subject) task.title = input.subject;
        }
      }
    }
  }

  return Array.from(tasks.values());
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

// Returns the most recent plan in the conversation. "Active" = any step not
// completed. When every step is done we still return it so the widget can run
// its 3s hide animation instead of vanishing on the final TaskUpdate.
export const getActivePlan = (messages: ChatMessage[]): ActivePlan | null => {
  const toolResults = buildToolResultMap(messages);
  const groups = groupMessages(messages);

  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]!;
    if (g.role !== 'assistant') continue;
    const plan = buildPlanFromAssistantGroup(g, toolResults);
    if (plan.length === 0) continue;
    const allDone = plan.every((t) => t.status === 'completed');
    return { plan, key: g.key, allDone };
  }
  return null;
};
