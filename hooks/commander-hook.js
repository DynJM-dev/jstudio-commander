#!/usr/bin/env node
// JStudio Commander hook — forwards Claude Code lifecycle events to the
// local Commander server.
//
// Phase P.3 H3 — replaces the former commander-hook.sh. The shell
// version shelled out to /usr/bin/python3 three times per invocation;
// on macOS 15.4 that path can be missing or broken and the `|| echo
// '{"event":"unknown","data":{}}'` fallback silently dropped the real
// event. Pure-Node has no such pitfall — the stack already requires
// Node, the script reads stdin, JSON-parses it, reshapes into our
// hook-event POST body, and fires. Failures write to stderr (visible
// in Claude Code's hook log) rather than masking.
//
// Fire-and-forget by design: if the Commander server is down or the
// POST fails, we exit 0 so Claude Code never blocks on our endpoint.

const SERVER_URL = process.env.COMMANDER_HOOK_URL
  || 'http://127.0.0.1:11002/api/hook-event';
const POST_TIMEOUT_MS = 2000;

// Pure — reshape Claude Code's hook JSON into Commander's POST body.
// Exported so tests can pin the contract without mocking stdin.
export const buildHookPayload = (input) => {
  const obj = (input && typeof input === 'object') ? input : {};
  return {
    event: typeof obj.hook_event_name === 'string' ? obj.hook_event_name : 'unknown',
    sessionId: typeof obj.session_id === 'string' ? obj.session_id : '',
    data: {
      transcript_path: typeof obj.transcript_path === 'string' ? obj.transcript_path : '',
      cwd: typeof obj.cwd === 'string' ? obj.cwd : '',
      tool_name: typeof obj.tool_name === 'string' ? obj.tool_name : '',
    },
  };
};

const readStdin = () => new Promise((resolve) => {
  const chunks = [];
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  process.stdin.on('error', () => resolve(''));
});

const postPayload = async (payload) => {
  // AbortSignal.timeout is Node 18+; all target hosts run 20+ via
  // the project's engine lock. Still wrap in try/catch — network
  // failures are expected when the server is restarting.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), POST_TIMEOUT_MS);
  try {
    await fetch(SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } catch (err) {
    // fetch errors include "fetch failed" (server down), abort, DNS.
    // Stderr shows up in Claude's hook log; stdout is avoided because
    // Claude Code may interpret non-empty stdout as hook output.
    process.stderr.write(
      `[commander-hook] post to ${SERVER_URL} failed: ${err && err.message ? err.message : err}\n`,
    );
  } finally {
    clearTimeout(timer);
  }
};

const main = async () => {
  const raw = await readStdin();
  let parsed = {};
  if (raw.trim().length > 0) {
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      process.stderr.write(
        `[commander-hook] bad stdin JSON: ${err && err.message ? err.message : err}\n`,
      );
      // Emit with whatever we have — an `unknown` event is still
      // better than silently dropping the turn boundary.
      parsed = {};
    }
  }
  const payload = buildHookPayload(parsed);
  await postPayload(payload);
  process.exit(0);
};

// Only auto-run when invoked as a script. `import('...js')` in tests is
// safe because the fileURL === argv[1] comparison fails there.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
