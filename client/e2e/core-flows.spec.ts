import { test, expect } from '@playwright/test';
import { COMMANDER_API, serverUp, dismissPinIfPresent } from './helpers';

test.beforeEach(async ({ page }) => {
  if (!(await serverUp())) test.skip(true, 'Commander API unavailable');
  await page.goto('/sessions');
  await dismissPinIfPresent(page);
});

test('1. sessions page renders without error', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /sessions/i })).toBeVisible();
  // New Session button is the canonical entry point
  await expect(page.getByRole('button', { name: /new session/i })).toBeVisible();
});

test('2. /api/system/health returns expected shape', async ({ request }) => {
  const res = await request.get(`${COMMANDER_API}/api/system/health`);
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body).toMatchObject({
    status: expect.any(String),
    dbConnected: expect.any(Boolean),
    tmuxAvailable: expect.any(Boolean),
  });
  // Post-#204: hook matcher stats surface the new deterministic strategies
  expect(body.hookMatchStats).toBeTruthy();
  expect(body.hookMatchStats).toHaveProperty('claudeSessionId');
  expect(body.hookMatchStats).toHaveProperty('transcriptUUID');
  expect(body.hookMatchStats).toHaveProperty('cwd-exclusive');
  expect(body.hookMatchStats).toHaveProperty('skipped');
});

test('3. teammates endpoint returns array for any session id', async ({ request }) => {
  const res = await request.get(`${COMMANDER_API}/api/sessions/non-existent-id/teammates`);
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(Array.isArray(body)).toBeTruthy();
});

test('4. chat endpoint serves messages for an active session (soft-skip)', async ({ request }) => {
  const sessionsRes = await request.get(`${COMMANDER_API}/api/sessions`);
  const sessions: Array<{ id: string; status: string }> = await sessionsRes.json();
  const candidate = sessions.find((s) => s.status !== 'stopped');
  if (!candidate) test.skip(true, 'no active sessions to probe');

  const chatRes = await request.get(`${COMMANDER_API}/api/chat/${candidate.id}?limit=10`);
  expect(chatRes.ok()).toBeTruthy();
  const body = await chatRes.json();
  expect(body).toHaveProperty('messages');
  expect(Array.isArray(body.messages)).toBeTruthy();
  expect(body).toHaveProperty('total');
});

test('5. preferences round-trip — put then get', async ({ request }) => {
  const key = `e2e-probe-${Date.now()}`;
  const payload = { marker: 'playwright', n: 42 };
  const put = await request.put(`${COMMANDER_API}/api/preferences/${encodeURIComponent(key)}`, {
    data: { value: payload },
  });
  expect(put.ok()).toBeTruthy();
  const get = await request.get(`${COMMANDER_API}/api/preferences/${encodeURIComponent(key)}`);
  expect(get.ok()).toBeTruthy();
  const body = await get.json();
  expect(body.value).toEqual(payload);
});
