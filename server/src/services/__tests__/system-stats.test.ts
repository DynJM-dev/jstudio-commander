import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSystemStatsSnapshot,
  computeCpuPctFromDeltas,
  CPU_PCT_CAP,
  __cpuTestSupport,
  type CpuSample,
} from '../system-stats.service.js';

// Phase O + Phase V — system-stats shape + math guard.
//
// Phase V replaces the loadavg-based CPU approximation with a real
// instantaneous CPU % derived from two consecutive os.cpus() samples.
// loadavg is a queue-depth metric: a system at 100% CPU for 10s still
// shows a small load average, so the header chip drifted far off what
// Activity Monitor reported. The new implementation keeps a module-local
// `lastCpuSample` and on each call computes:
//
//    pct = ((Δtotal − Δidle) / Δtotal) * 100
//
// averaged across all cores (sum before divide). First call returns 0
// because there is no prior sample to delta against.
//
// Memory math stays `(total - free) / total * 100`. See the service
// doc-comment for the macOS freemem caveat.

type CpuTimes = {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
};

type StubCpu = { times: CpuTimes };

const timesFromBusyIdle = (busy: number, idle: number): CpuTimes => ({
  user: busy,
  nice: 0,
  sys: 0,
  idle,
  irq: 0,
});

const makeOs = (opts: {
  cores?: number;
  // Test-friendly way to build os.cpus() output: supply `busy` and `idle`
  // counts. A 1-core stub with (busy=50, idle=50) is a 50% busy sample.
  cpus?: StubCpu[];
  totalMem?: number;
  freeMem?: number;
  uptime?: number;
  // Legacy Phase O snapshot field — ignored by new CPU path but kept
  // available for tests that don't care about CPU math.
  load1?: number;
}) => ({
  loadavg: () => [opts.load1 ?? 0, 0, 0] as [number, number, number],
  cpus: () =>
    (opts.cpus ?? new Array(opts.cores ?? 1).fill({
      times: timesFromBusyIdle(0, 100),
    })) as ReturnType<typeof import('node:os').cpus>,
  totalmem: () => opts.totalMem ?? 0,
  freemem: () => opts.freeMem ?? 0,
  uptime: () => opts.uptime ?? 0,
});

// Sum busy + idle across all stub cores into a CpuSample — mirrors what
// sampleCpu() does internally. Lets the delta-math tests assert without
// re-shimming the os layer.
const sampleFromCpus = (cpus: StubCpu[]): CpuSample => {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
};

describe('computeCpuPctFromDeltas — Phase V pure delta math', () => {
  test('100% idle window → 0%', () => {
    // No busy change, idle grew by whole delta.
    const prev: CpuSample = { idle: 100, total: 100 };
    const curr: CpuSample = { idle: 200, total: 200 };
    assert.equal(computeCpuPctFromDeltas(prev, curr), 0);
  });

  test('0% idle window (fully saturated) → 100%', () => {
    const prev: CpuSample = { idle: 50, total: 100 };
    const curr: CpuSample = { idle: 50, total: 200 };
    assert.equal(computeCpuPctFromDeltas(prev, curr), 100);
  });

  test('50% busy window → 50%', () => {
    const prev: CpuSample = { idle: 100, total: 100 };
    const curr: CpuSample = { idle: 150, total: 200 };
    assert.equal(computeCpuPctFromDeltas(prev, curr), 50);
  });

  test('totalDelta=0 (no time passed) → 0 (no divide-by-zero)', () => {
    const prev: CpuSample = { idle: 100, total: 100 };
    const curr: CpuSample = { idle: 100, total: 100 };
    assert.equal(computeCpuPctFromDeltas(prev, curr), 0);
  });

  test('negative totalDelta (counter reset) → 0', () => {
    // Shouldn't happen in practice, but guard so a counter wrap doesn't
    // produce a negative pct.
    const prev: CpuSample = { idle: 100, total: 200 };
    const curr: CpuSample = { idle: 50, total: 100 };
    assert.equal(computeCpuPctFromDeltas(prev, curr), 0);
  });

  test('caps at CPU_PCT_CAP when idleDelta exceeds totalDelta (clock skew)', () => {
    // Negative busy% bounded at 0 via Math.max.
    const prev: CpuSample = { idle: 100, total: 100 };
    const curr: CpuSample = { idle: 250, total: 200 };
    const pct = computeCpuPctFromDeltas(prev, curr);
    assert.ok(pct >= 0 && pct <= CPU_PCT_CAP, `expected [0, ${CPU_PCT_CAP}], got ${pct}`);
    assert.equal(pct, 0);
  });
});

describe('buildSystemStatsSnapshot — Phase O + V integration', () => {
  before(() => {
    __cpuTestSupport.reset();
  });

  test('first call returns cpuLoadPct=0 (no prior sample to delta)', () => {
    __cpuTestSupport.reset();
    const snap = buildSystemStatsSnapshot(
      makeOs({
        cpus: [{ times: timesFromBusyIdle(25, 75) }],
        totalMem: 100,
        freeMem: 50,
      }),
    );
    assert.equal(snap.cpuLoadPct, 0);
    assert.equal(snap.coreCount, 1);
  });

  test('second call returns delta-based percentage across all cores', () => {
    __cpuTestSupport.reset();
    // Sample 1: two cores, each idle=100, total=100 → idle=200, total=200.
    buildSystemStatsSnapshot(
      makeOs({
        cpus: [
          { times: timesFromBusyIdle(0, 100) },
          { times: timesFromBusyIdle(0, 100) },
        ],
        totalMem: 1,
        freeMem: 1,
      }),
    );
    // Sample 2: two cores, one went 50-busy / 50-idle, other stayed.
    // Core 1: idle=100→150, busy=0→50 → idle=150, total=200.
    // Core 2: idle=100→200 (100 more idle, 0 more busy) → idle=200, total=200.
    // Totals: idle=350 (prev=200 → Δ=150), total=400 (prev=200 → Δ=200).
    // busy% = (200-150)/200 * 100 = 25.
    const snap = buildSystemStatsSnapshot(
      makeOs({
        cpus: [
          { times: timesFromBusyIdle(50, 150) },
          { times: timesFromBusyIdle(0, 200) },
        ],
        totalMem: 1,
        freeMem: 1,
      }),
    );
    assert.equal(snap.cpuLoadPct, 25);
  });

  test('reset() clears prior sample so next call is treated as first', () => {
    __cpuTestSupport.reset();
    buildSystemStatsSnapshot(
      makeOs({ cpus: [{ times: timesFromBusyIdle(10, 90) }], totalMem: 1, freeMem: 1 }),
    );
    __cpuTestSupport.reset();
    const snap = buildSystemStatsSnapshot(
      makeOs({ cpus: [{ times: timesFromBusyIdle(80, 20) }], totalMem: 1, freeMem: 1 }),
    );
    assert.equal(snap.cpuLoadPct, 0, 'post-reset call must behave like first call');
  });

  test('sampleFromCpus matches internal sampling shape (docs-as-test)', () => {
    const cpus: StubCpu[] = [
      { times: timesFromBusyIdle(50, 50) },
      { times: timesFromBusyIdle(30, 70) },
    ];
    const sample = sampleFromCpus(cpus);
    assert.equal(sample.idle, 120);
    assert.equal(sample.total, 200);
  });

  test('memUsedPct = (total - free) / total * 100 + raw byte fields preserved', () => {
    __cpuTestSupport.reset();
    const snapshot = buildSystemStatsSnapshot(
      makeOs({
        cpus: [{ times: timesFromBusyIdle(0, 100) }],
        totalMem: 32 * 1024 * 1024 * 1024,
        freeMem: 20 * 1024 * 1024 * 1024,
        uptime: 3600,
      }),
    );
    assert.equal(snapshot.memTotalBytes, 32 * 1024 * 1024 * 1024);
    assert.equal(snapshot.memUsedBytes, 12 * 1024 * 1024 * 1024);
    assert.equal(snapshot.memUsedPct, 37.5);
    assert.equal(snapshot.hostUptimeS, 3600);
  });

  test('ts defaults to Date.now() but respects the injected nowMs for determinism', () => {
    __cpuTestSupport.reset();
    const snapshot = buildSystemStatsSnapshot(
      makeOs({
        cpus: [{ times: timesFromBusyIdle(0, 100) }],
        totalMem: 100,
        freeMem: 50,
      }),
      1_700_000_001_234,
    );
    assert.equal(snapshot.ts, 1_700_000_001_234);
  });

  test('totalmem=0 edge case → memUsedPct=0, no divide-by-zero', () => {
    __cpuTestSupport.reset();
    const snapshot = buildSystemStatsSnapshot(
      makeOs({
        cpus: [{ times: timesFromBusyIdle(0, 100) }],
        totalMem: 0,
        freeMem: 0,
      }),
    );
    assert.equal(snapshot.memUsedPct, 0);
    assert.equal(snapshot.memTotalBytes, 0);
    assert.equal(snapshot.memUsedBytes, 0);
  });

  test('zero-core guard → cores defaults to 1 so coreCount never zero', () => {
    // Even with zero cores the snapshot still returns coreCount=1. The
    // first call will still return cpuLoadPct=0 (no prior sample); subsequent
    // calls on a 0-core stub would produce totalDelta=0 and return 0
    // (handled by computeCpuPctFromDeltas).
    __cpuTestSupport.reset();
    const snapshot = buildSystemStatsSnapshot(
      makeOs({ cpus: [], totalMem: 1, freeMem: 1 }),
    );
    assert.equal(snapshot.coreCount, 1);
    assert.equal(snapshot.cpuLoadPct, 0);
  });
});
