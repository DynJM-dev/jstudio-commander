import { getDb } from '../db/connection.js';

// Single-snapshot aggregator for the gamified city view (#214). The view
// renders a busy dashboard of dozens of districts/buildings — calling 5
// separate REST endpoints would multiply both the request load and the
// re-render churn when the WS event-bus already tells us when to refresh.
//
// Keep this CHEAP — one DB hit, no tmux probes, no JSONL parsing. The
// status poller (5s) keeps the cached `status` column fresh enough for a
// city-view paint cadence.

export interface CityStateSnapshot {
  generatedAt: string;
  sessions: {
    total: number;
    topLevel: number;
    teammates: number;
    byStatus: Record<string, number>;
    byTeam: Record<string, number>;
  };
  activeMessages: number;     // sessions currently in 'working' status
  permissionPrompts: number;  // sessions currently in 'waiting' status
  idle: number;
  stopped: number;
}

interface AggregateRow {
  status: string;
  is_teammate: number;
  team_name: string | null;
  count: number;
}

export const cityStateService = {
  getSnapshot(): CityStateSnapshot {
    const db = getDb();
    const rows = db.prepare(`
      SELECT
        status,
        CASE WHEN parent_session_id IS NULL THEN 0 ELSE 1 END AS is_teammate,
        team_name,
        COUNT(*) AS count
      FROM sessions
      GROUP BY status, is_teammate, team_name
    `).all() as AggregateRow[];

    const byStatus: Record<string, number> = {};
    const byTeam: Record<string, number> = {};
    let total = 0;
    let topLevel = 0;
    let teammates = 0;

    for (const row of rows) {
      total += row.count;
      byStatus[row.status] = (byStatus[row.status] ?? 0) + row.count;
      if (row.is_teammate === 1) {
        teammates += row.count;
        const team = row.team_name ?? 'unassigned';
        byTeam[team] = (byTeam[team] ?? 0) + row.count;
      } else {
        topLevel += row.count;
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      sessions: { total, topLevel, teammates, byStatus, byTeam },
      activeMessages: byStatus['working'] ?? 0,
      permissionPrompts: byStatus['waiting'] ?? 0,
      idle: byStatus['idle'] ?? 0,
      stopped: byStatus['stopped'] ?? 0,
    };
  },
};
