import type { Page } from '@playwright/test';

// Most E2E flows depend on the Fastify server being up at :3002. Skip tests
// cleanly when it isn't — the suite runs alongside `pnpm dev` which may or
// may not have the server leg alive on a given machine. Better to soft-
// skip than to flood CI with false-positive failures.
export const COMMANDER_API = process.env.COMMANDER_API ?? 'http://localhost:3002';

export async function serverUp(): Promise<boolean> {
  try {
    const res = await fetch(`${COMMANDER_API}/api/system/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function dismissPinIfPresent(page: Page): Promise<void> {
  // If the PinGate is open, enter dev PIN. The default test pin is pulled
  // from COMMANDER_PIN env; if missing, skip — the test will abort cleanly
  // on the next navigation check.
  const pin = process.env.COMMANDER_PIN;
  if (!pin) return;
  const input = page.locator('input[placeholder*="PIN" i]');
  if (await input.isVisible().catch(() => false)) {
    await input.fill(pin);
    await page.keyboard.press('Enter');
    await page.waitForLoadState('networkidle');
  }
}
