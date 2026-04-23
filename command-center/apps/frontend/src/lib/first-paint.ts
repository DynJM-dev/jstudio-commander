// First-paint measurement — set in index.html pre-React bootstrap, updated
// in main.tsx after first rAF. Dispatch §1.1 acceptance: skeleton visible
// within 200ms of Finder launch. Debug tab surfaces the measured value so
// Jose can verify against the acceptance threshold rather than trust
// CODER's self-reporting.

interface BootTimestamps {
  started?: number;
  paintedAt?: number;
  firstPaintMs?: number;
}

interface CmdrBoot {
  __CMDR_BOOT__?: BootTimestamps;
}

export function getFirstPaintMs(): number | null {
  const boot = (window as unknown as CmdrBoot).__CMDR_BOOT__;
  if (!boot?.firstPaintMs) return null;
  return Math.round(boot.firstPaintMs * 10) / 10; // tenth-ms precision
}

export function getBootStartedMs(): number | null {
  const boot = (window as unknown as CmdrBoot).__CMDR_BOOT__;
  return boot?.started ?? null;
}
