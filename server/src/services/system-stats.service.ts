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
//
// Phase V — CPU accuracy. Replaced the loadavg approximation
// ((loadavg[0] / cores) * 100) with sampled cpu.times delta. loadavg is
// a 1-minute queue-depth metric and lags actual CPU usage heavily —
// Activity Monitor showed Commander reporting 12% while the Mac was
// actually at 90% CPU for 10 seconds. The delta-based math mirrors what
// VS Code / bpytop / htop compute: idle ticks vs total ticks across all
// cores, windowed between two successive samples.
//
// Memory still uses (total - free) / total. On macOS this overstates
// usage because `freemem` counts only fully-free pages (not inactive
// cache pages Activity Monitor treats as available). Documented for
// future-us — shelling to vm_stat is a separate scope.

export const SAMPLE_INTERVAL_MS = 2000;
export const CPU_PCT_CAP = 999;

export interface CpuSample {
  idle: number;
  total: number;
}

const sampleCpu = (osImpl: Pick<typeof os, 'cpus'>): CpuSample => {
  const cpus = osImpl.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
};

// Pure delta math — exported so tests pin invariants without module state.
// prev/curr come from successive sampleCpu() calls.
export const computeCpuPctFromDeltas = (prev: CpuSample, curr: CpuSample): number => {
  const idleDelta = curr.idle - prev.idle;
  const totalDelta = curr.total - prev.total;
  if (totalDelta <= 0) return 0; // no time passed OR counter reset
  const busyDelta = totalDelta - idleDelta;
  if (busyDelta <= 0) return 0; // clock skew guard — idle "grew faster" than total
  const pct = (busyDelta / totalDelta) * 100;
  return Math.min(CPU_PCT_CAP, Math.max(0, pct));
};

// Module-local sample memo. buildSystemStatsSnapshot advances this on
// every call; first call seeds the sample and returns 0% (no prior delta).
let lastCpuSample: CpuSample | null = null;

const advanceCpuSample = (osImpl: Pick<typeof os, 'cpus'>): number => {
  const current = sampleCpu(osImpl);
  if (!lastCpuSample) {
    lastCpuSample = current;
    return 0;
  }
  const pct = computeCpuPctFromDeltas(lastCpuSample, current);
  lastCpuSample = current;
  return pct;
};

// Test-only handle to reset the module-local sample memo between cases.
// Never called from prod code paths.
export const __cpuTestSupport = {
  reset: (): void => {
    lastCpuSample = null;
  },
  getSample: (): CpuSample | null => lastCpuSample,
};

// Pure snapshot builder — no side effects on non-CPU fields, testable
// without fake timers. Exported so tests pin the payload shape against
// known os values by stubbing the `os` accessors. CPU path advances the
// module-local sample memo; reset via __cpuTestSupport between tests
// that care about the first-call=0 invariant.
export const buildSystemStatsSnapshot = (
  osImpl: Pick<typeof os, 'loadavg' | 'cpus' | 'totalmem' | 'freemem' | 'uptime'> = os,
  nowMs: number = Date.now(),
): SystemStatsPayload => {
  const cores = osImpl.cpus().length || 1;
  const totalMem = osImpl.totalmem();
  const freeMem = osImpl.freemem();
  const usedMem = Math.max(0, totalMem - freeMem);
  const cpuLoadPct = advanceCpuSample(osImpl);
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
