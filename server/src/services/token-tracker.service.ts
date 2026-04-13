import { MODEL_PRICING } from '@commander/shared';
import type { ChatMessage, TokenUsage, DailyStats } from '@commander/shared';
import { getDb } from '../db/connection.js';

const calculateCost = (model: string, usage: TokenUsage): number => {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;

  return (
    (usage.inputTokens * pricing.input +
      usage.outputTokens * pricing.output +
      usage.cacheReadTokens * pricing.cacheRead +
      usage.cacheCreationTokens * pricing.cacheCreation) /
    1_000_000
  );
};

export const tokenTrackerService = {
  calculateCost,

  extractUsage(messages: ChatMessage[]): Array<{ model: string; usage: TokenUsage; messageId: string; timestamp: string }> {
    const results: Array<{ model: string; usage: TokenUsage; messageId: string; timestamp: string }> = [];
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.usage && msg.model) {
        results.push({
          model: msg.model,
          usage: msg.usage,
          messageId: msg.id,
          timestamp: msg.timestamp,
        });
      }
    }
    return results;
  },

  recordUsage(sessionId: string, projectId: string | null, messages: ChatMessage[]): void {
    const db = getDb();
    const usageEntries = this.extractUsage(messages);
    if (usageEntries.length === 0) return;

    const insertUsage = db.prepare(`
      INSERT OR IGNORE INTO token_usage (session_id, project_id, message_id, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const upsertDaily = db.prepare(`
      INSERT INTO cost_entries (date, session_id, project_id, model, total_input_tokens, total_output_tokens, total_cache_read_tokens, total_cache_creation_tokens, total_cost_usd, message_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(date, session_id, model) DO UPDATE SET
        total_input_tokens = total_input_tokens + excluded.total_input_tokens,
        total_output_tokens = total_output_tokens + excluded.total_output_tokens,
        total_cache_read_tokens = total_cache_read_tokens + excluded.total_cache_read_tokens,
        total_cache_creation_tokens = total_cache_creation_tokens + excluded.total_cache_creation_tokens,
        total_cost_usd = total_cost_usd + excluded.total_cost_usd,
        message_count = message_count + 1
    `);

    const transaction = db.transaction(() => {
      for (const entry of usageEntries) {
        const cost = calculateCost(entry.model, entry.usage);
        const date = entry.timestamp.slice(0, 10); // YYYY-MM-DD

        insertUsage.run(
          sessionId, projectId, entry.messageId, entry.model,
          entry.usage.inputTokens, entry.usage.outputTokens,
          entry.usage.cacheReadTokens, entry.usage.cacheCreationTokens,
          cost, entry.timestamp,
        );

        upsertDaily.run(
          date, sessionId, projectId, entry.model,
          entry.usage.inputTokens, entry.usage.outputTokens,
          entry.usage.cacheReadTokens, entry.usage.cacheCreationTokens,
          cost,
        );
      }
    });

    transaction();
  },

  aggregateBySession(sessionId: string): { totalTokens: number; totalCost: number; byModel: Record<string, { tokens: number; cost: number }> } {
    const db = getDb();
    const rows = db.prepare(`
      SELECT model, SUM(input_tokens + output_tokens) as tokens, SUM(cost_usd) as cost
      FROM token_usage WHERE session_id = ? GROUP BY model
    `).all(sessionId) as Array<{ model: string; tokens: number; cost: number }>;

    const byModel: Record<string, { tokens: number; cost: number }> = {};
    let totalTokens = 0;
    let totalCost = 0;

    for (const row of rows) {
      byModel[row.model] = { tokens: row.tokens, cost: row.cost };
      totalTokens += row.tokens;
      totalCost += row.cost;
    }

    return { totalTokens, totalCost, byModel };
  },

  aggregateDaily(date?: string): DailyStats {
    const db = getDb();
    const targetDate = date ?? new Date().toISOString().slice(0, 10);

    const rows = db.prepare(`
      SELECT model, SUM(total_input_tokens) as input, SUM(total_output_tokens) as output,
             SUM(total_cost_usd) as cost, SUM(message_count) as msgs
      FROM cost_entries WHERE date = ? GROUP BY model
    `).all(targetDate) as Array<{ model: string; input: number; output: number; cost: number; msgs: number }>;

    const byModel: Record<string, { costUsd: number; inputTokens: number; outputTokens: number }> = {};
    let totalCostUsd = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let messageCount = 0;

    for (const row of rows) {
      byModel[row.model] = { costUsd: row.cost, inputTokens: row.input, outputTokens: row.output };
      totalCostUsd += row.cost;
      totalInputTokens += row.input;
      totalOutputTokens += row.output;
      messageCount += row.msgs;
    }

    return { date: targetDate, totalCostUsd, totalInputTokens, totalOutputTokens, messageCount, byModel };
  },

  getDailyRange(days: number): DailyStats[] {
    const db = getDb();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startStr = startDate.toISOString().slice(0, 10);

    const rows = db.prepare(`
      SELECT date, model, SUM(total_input_tokens) as input, SUM(total_output_tokens) as output,
             SUM(total_cost_usd) as cost, SUM(message_count) as msgs
      FROM cost_entries WHERE date >= ? GROUP BY date, model ORDER BY date
    `).all(startStr) as Array<{ date: string; model: string; input: number; output: number; cost: number; msgs: number }>;

    // Group by date
    const dayMap = new Map<string, DailyStats>();
    for (const row of rows) {
      if (!dayMap.has(row.date)) {
        dayMap.set(row.date, {
          date: row.date,
          totalCostUsd: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          messageCount: 0,
          byModel: {},
        });
      }
      const day = dayMap.get(row.date)!;
      day.byModel[row.model] = { costUsd: row.cost, inputTokens: row.input, outputTokens: row.output };
      day.totalCostUsd += row.cost;
      day.totalInputTokens += row.input;
      day.totalOutputTokens += row.output;
      day.messageCount += row.msgs;
    }

    return Array.from(dayMap.values());
  },

  getSessionCosts(): Array<{ sessionId: string; sessionName: string; totalCost: number; totalTokens: number; messageCount: number }> {
    const db = getDb();
    return db.prepare(`
      SELECT ce.session_id as sessionId, s.name as sessionName,
             SUM(ce.total_cost_usd) as totalCost,
             SUM(ce.total_input_tokens + ce.total_output_tokens) as totalTokens,
             SUM(ce.message_count) as messageCount
      FROM cost_entries ce
      LEFT JOIN sessions s ON ce.session_id = s.id
      GROUP BY ce.session_id
      ORDER BY totalCost DESC
    `).all() as Array<{ sessionId: string; sessionName: string; totalCost: number; totalTokens: number; messageCount: number }>;
  },

  getProjectCosts(): Array<{ projectId: string; projectName: string; totalCost: number; totalTokens: number; messageCount: number }> {
    const db = getDb();
    return db.prepare(`
      SELECT ce.project_id as projectId, p.name as projectName,
             SUM(ce.total_cost_usd) as totalCost,
             SUM(ce.total_input_tokens + ce.total_output_tokens) as totalTokens,
             SUM(ce.message_count) as messageCount
      FROM cost_entries ce
      LEFT JOIN projects p ON ce.project_id = p.id
      WHERE ce.project_id IS NOT NULL
      GROUP BY ce.project_id
      ORDER BY totalCost DESC
    `).all() as Array<{ projectId: string; projectName: string; totalCost: number; totalTokens: number; messageCount: number }>;
  },
};
