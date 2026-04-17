import * as os from 'node:os';
import type { SystemStatsPayload } from '@commander/shared';
import { eventBus } from '../ws/event-bus.js';

// Phase O — host CPU + memory sampler. Runs a 2s setInterval and emits
// a `system:stats` WS event on every tick. Native `os` module only so
// we stay dep-free on the server.
//
// Why 2s: VS Code's built-in perf widget samples around this cadence; it
// keeps the chart fluid enough to feel live without spamming the WS.
// Clients that miss an event just wait 2s for the next one — no retry
// logic needed.

export const SAMPLE_INTERVAL_MS = 2000;
export const CPU_PCT_CAP = 999;

// Pure snapshot builder — no side effects, testable without fake timers.
// Exported so tests can pin the payload shape against known os values
// by stubbing the `os` accessors.
export const buildSystemStatsSnapshot = (
  osImpl: Pick<typeof os, 'loadavg' | 'cpus' | 'totalmem' | 'freemem' | 'uptime'> = os,
  nowMs: number = Date.now(),
): SystemStatsPayload => {
  const load1 = osImpl.loadavg()[0] ?? 0;
  const cores = osImpl.cpus().length || 1;
  const totalMem = osImpl.totalmem();
  const freeMem = osImpl.freemem();
  const usedMem = Math.max(0, totalMem - freeMem);
  const cpuLoadPct = Math.min(
    CPU_PCT_CAP,
    Math.max(0, (load1 / cores) * 100),
  );
  const memUsedPct = totalMem > 0 ? (usedMem / totalMem) * 100 : 0;
  return {
    cpuLoadPct: Number(cpuLoadPct.toFixed(1)),
    memUsedPct: Number(memUsedPct.toFixed(1)),
    memUsedBytes: usedMem,
    memTotalBytes: totalMem,
    coreCount: cores,
    hostUptimeS: Math.floor(osImpl.uptime()),
    ts: nowMs,
  };
};

let timer: NodeJS.Timeout | null = null;

export const systemStatsService = {
  start(intervalMs: number = SAMPLE_INTERVAL_MS): void {
    if (timer) return;
    const tick = () => {
      const snapshot = buildSystemStatsSnapshot();
      eventBus.emitSystemStats(snapshot);
    };
    // Emit one sample immediately so a client that subscribes right at
    // boot doesn't wait the full interval to populate the widget.
    tick();
    timer = setInterval(tick, intervalMs);
    // Don't hold the event loop open — the server's graceful shutdown
    // still calls stop(), but unref lets node exit if someone kills the
    // server abnormally.
    timer.unref?.();
    console.log(`[system-stats] sampling every ${intervalMs}ms`);
  },

  stop(): void {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  },
};
