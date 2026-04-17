// Phase O — top-right header stats widget.
//
// SystemStatsPayload: live host stats sampled every 2s by the server's
// system-stats.service. Emitted over the `system` WS channel so the
// HeaderStatsWidget renders CPU + memory without polling.
//
// AggregateRateLimitsPayload: account-wide 5h / 7d usage picked from the
// freshest session_ticks row. Since Claude Code rate limits are
// account-scoped, ANY live session's tick is authoritative; we surface
// the most recent one. `sampleAgeMs` is the staleness dial the UI uses
// to render "—" when the source tick is older than its freshness window.

export interface SystemStatsPayload {
  // Load average (1-min) expressed as a percentage of total cores, e.g.
  // a 4-core host at 2.0 loadavg reports 50. Capped at 999 so a runaway
  // process doesn't blow the number up.
  cpuLoadPct: number;
  // Memory currently in use, expressed as a percentage of totalmem.
  memUsedPct: number;
  // Raw bytes for "12.3 GB / 32 GB" rendering — never trust the pct
  // alone for display precision.
  memUsedBytes: number;
  memTotalBytes: number;
  // Number of logical cores — the UI uses this to label the CPU chip
  // tooltip ("42% of 8 cores").
  coreCount: number;
  // Host uptime in seconds — informational only, rendered on hover.
  hostUptimeS: number;
  // Epoch-ms of the sample. Used by the client to detect a stalled
  // server (no stats for N seconds → muted widget).
  ts: number;
}

export interface RateLimitWindow {
  // 0-100 float; null means the server has no fresh sample.
  pct: number | null;
  // ISO-8601 reset timestamp as reported by Claude Code's statusline.
  // Null when pct is null.
  resetsAt: string | null;
}

export interface AggregateRateLimitsPayload {
  fiveHour: RateLimitWindow;
  sevenDay: RateLimitWindow;
  // Commander session id whose tick supplied the numbers. Null when no
  // session has ever posted a tick carrying rate-limit fields.
  sourceSessionId: string | null;
  // Age of the source tick in milliseconds. `Number.POSITIVE_INFINITY`
  // when no sample exists. The client treats > 10 min as stale.
  sampleAgeMs: number;
}
