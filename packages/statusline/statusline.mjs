#!/usr/bin/env node
// Commander statusline — Phase M (F1).
//
// Invoked by Claude Code via ~/.claude/settings.json `statusLine.command`.
// Receives a JSON payload on stdin every ~300ms (throttled by Claude
// Code) describing the current session state; forwards it to Commander's
// ingest endpoint; prints a single-line status string to stdout.
//
// Contract:
//   - MUST finish in <100ms. Claude Code blocks its UI on slow scripts.
//   - MUST NOT throw if the server is down / endpoint missing. Silent
//     catch; the terminal display still renders.
//   - MUST be zero-dep (no pnpm / node_modules resolution). Uses Node's
//     native `fetch` (Node 22+) + stdin streaming only.
//   - Exit code 0 always. stderr writes are tolerated by Claude Code but
//     we avoid them to keep the tick cheap.

const FORWARD_URL = process.env.JSC_TICK_URL ?? 'http://127.0.0.1:3002/api/session-tick';
const FORWARD_TIMEOUT_MS = 100;

const readStdin = () =>
  new Promise((resolve) => {
    let buf = '';
    const to = setTimeout(() => resolve(buf), 80); // hard cap: 80ms to read stdin
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { buf += chunk; });
    process.stdin.on('end', () => { clearTimeout(to); resolve(buf); });
    process.stdin.on('error', () => { clearTimeout(to); resolve(buf); });
  });

const forward = async (raw) => {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), FORWARD_TIMEOUT_MS);
  try {
    await fetch(FORWARD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw,
      signal: ctl.signal,
    });
  } catch {
    // Server may be down; never block the terminal UI on it.
  } finally {
    clearTimeout(to);
  }
};

// Compact status line. ANSI codes are skipped — Claude Code renders the
// string as-is, and some terminals mangle raw ANSI in the footer. Plain
// text is portable. A future flavor pass can detect TERM/COLORTERM and
// opt in to color; that's cosmetic, not required for the tick to work.
const formatStatus = (payload) => {
  const model = payload?.model?.display_name ?? payload?.model?.id ?? 'claude';
  const shortModel = String(model).replace(/^claude-/, '');
  const ctx = payload?.context_window?.used_percentage;
  const ctxLabel = Number.isFinite(ctx) ? `ctx ${Math.round(ctx)}%` : 'ctx —';
  const cost = payload?.cost?.total_cost_usd;
  const costLabel = Number.isFinite(cost) ? `$${Number(cost).toFixed(2)}` : null;
  const rl5 = payload?.rate_limits?.five_hour?.used_percentage;
  const rl7 = payload?.rate_limits?.seven_day?.used_percentage;
  const rl5Label = Number.isFinite(rl5) ? `5h ${Math.round(rl5)}%` : null;
  const rl7Label = Number.isFinite(rl7) ? `7d ${Math.round(rl7)}%` : null;
  const worktree = payload?.workspace?.git_worktree || null;
  const parts = [shortModel, ctxLabel];
  if (rl5Label) parts.push(rl5Label);
  if (rl7Label) parts.push(rl7Label);
  if (costLabel) parts.push(costLabel);
  if (worktree) parts.push(String(worktree).split('/').pop());
  return parts.join(' │ ');
};

const main = async () => {
  const raw = await readStdin();
  let payload = null;
  if (raw && raw.trim()) {
    try { payload = JSON.parse(raw); } catch { payload = null; }
    // Fire-and-forget — we don't await so the stdout write can start
    // immediately; Node won't exit until the fetch settles or times out.
    forward(raw).catch(() => {});
  }
  const line = payload ? formatStatus(payload) : 'claude │ ctx —';
  process.stdout.write(line + '\n');
};

main().catch(() => { process.stdout.write('claude │ ctx —\n'); });
