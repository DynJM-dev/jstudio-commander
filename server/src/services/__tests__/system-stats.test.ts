import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemStatsSnapshot, CPU_PCT_CAP } from '../system-stats.service.js';

// Phase O — system-stats shape + math guard.
//
// buildSystemStatsSnapshot is the only piece worth pinning at unit
// scope: the interval + WS emit live entirely in os/eventBus code paths
// and belong to integration, not unit. The snapshot formula is pure
// and drives every chip rendered by the widget, so that's where tests
// go. We inject a stub `os` impl so the math is deterministic across
// the CI host's real load / memory.

const makeOs = (opts: {
  load1?: number;
  cores?: number;
  totalMem?: number;
  freeMem?: number;
  uptime?: number;
}) => ({
  loadavg: () => [opts.load1 ?? 0, 0, 0] as [number, number, number],
  cpus: () => new Array(opts.cores ?? 1).fill({}) as ReturnType<typeof import('node:os').cpus>,
  totalmem: () => opts.totalMem ?? 0,
  freemem: () => opts.freeMem ?? 0,
  uptime: () => opts.uptime ?? 0,
});

describe('buildSystemStatsSnapshot — Phase O', () => {
  test('cpuLoadPct = (load / cores) * 100, rounded to 1 decimal', () => {
    const snapshot = buildSystemStatsSnapshot(
      makeOs({ load1: 2.0, cores: 4, totalMem: 1, freeMem: 1 }),
      1_700_000_000_000,
    );
    assert.equal(snapshot.cpuLoadPct, 50);
    assert.equal(snapshot.coreCount, 4);
  });

  test('cpuLoadPct caps at CPU_PCT_CAP (999) when load dwarfs core count', () => {
    const snapshot = buildSystemStatsSnapshot(
      makeOs({ load1: 1000, cores: 1, totalMem: 1, freeMem: 1 }),
    );
    assert.equal(snapshot.cpuLoadPct, CPU_PCT_CAP);
  });

  test('memUsedPct = (total - free) / total * 100 + raw byte fields preserved', () => {
    const snapshot = buildSystemStatsSnapshot(
      makeOs({
        load1: 0,
        cores: 1,
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
    const snapshot = buildSystemStatsSnapshot(
      makeOs({ load1: 0.5, cores: 2, totalMem: 100, freeMem: 50 }),
      1_700_000_001_234,
    );
    assert.equal(snapshot.ts, 1_700_000_001_234);
  });

  test('totalmem=0 edge case → memUsedPct=0, no divide-by-zero', () => {
    const snapshot = buildSystemStatsSnapshot(
      makeOs({ load1: 0, cores: 1, totalMem: 0, freeMem: 0 }),
    );
    assert.equal(snapshot.memUsedPct, 0);
    assert.equal(snapshot.memTotalBytes, 0);
    assert.equal(snapshot.memUsedBytes, 0);
  });

  test('zero-core guard → cores defaults to 1 so cpuLoadPct never divides by 0', () => {
    const snapshot = buildSystemStatsSnapshot(
      makeOs({ load1: 1.5, cores: 0, totalMem: 1, freeMem: 1 }),
    );
    assert.equal(snapshot.coreCount, 1);
    assert.equal(snapshot.cpuLoadPct, 150);
  });
});
