# Commander E2E tests

Playwright specs that drive the real Fastify server + Vite + Chromium
to cover flows unit tests can't — session creation, hook-stop flip,
statusline tick, page renders.

## Running locally

The suite expects **both the Fastify server and Vite to already be
running** — it has no `webServer` block. Start them from the repo root:

```bash
pnpm dev   # from jstudio-commander/ — launches server + Vite in parallel
```

Then, from `client/`:

```bash
# Default: assumes server on :11002, Vite on :11573
pnpm exec playwright test

# Override when the server binds a non-default port (e.g. config.json
# sets port: 3002):
COMMANDER_API=http://localhost:3002 pnpm exec playwright test

# Run a single spec:
COMMANDER_API=http://localhost:3002 pnpm exec playwright test session-creation.spec.ts
```

### Env vars

| Var | Default | Purpose |
|-----|---------|---------|
| `COMMANDER_URL` | `http://localhost:11573` | Vite dev URL — Playwright's `baseURL`. |
| `COMMANDER_API` | `http://localhost:11002` | Fastify server URL — used by helpers + request fixtures. Override when `~/.jstudio-commander/config.json` changes the port. |
| `COMMANDER_PIN` | *unset* | Only needed if the server is PIN-gated. Tests soft-skip the PIN gate when unset. |

## Why no `webServer` block?

Playwright's `webServer` config can auto-spawn the dev server, but Jose's
typical workflow already has `pnpm dev` running in a separate tmux pane.
Adding a webServer with `reuseExistingServer: true` worked for a bit,
but when the port is bound by the user's pane AND Playwright's spawn
disagrees on Vite/server port pairing, startup races become a pain.
Keeping E2E a "server must already be running" contract matches how the
rest of Commander treats dev concerns (`preflight.ts` does the
duplicate-server detection, not the test harness).

If you're running E2E in CI, add a `webServer` block at that time with
the concrete port the CI image uses.

## Side effects

- **Real tmux spawns.** Specs that create sessions via the UI or REST
  spawn real `jsc-<8char>` tmux panes on the host. Cleanup via
  `DELETE /api/sessions/:id` in `afterEach` kills the pane; crashes
  leave orphans that the next server boot's `[startup]` sweep handles.
- **Real DB writes.** Specs write to the live `~/.jstudio-commander/commander.db`.
  Rows created during the run are marked `stopped` (soft-delete), not
  hard-deleted; they appear in the Stopped fold afterward. To hard-reset,
  archive the DB file between runs.
- **No WS assertions from outside the browser.** The specs poll REST for
  state changes rather than opening a second WS client. Real WS fan-out
  is covered by the `session:created` / `session:status` assertions inside
  the Fastify integration suite (`server/src/__tests__/integration/`).

## Counts (HEAD as of Phase P.4)

- `core-flows.spec.ts` — 2 tests (sessions page smoke, preferences round-trip)
- `session-creation.spec.ts` — 1 test
- `hook-stop-flip.spec.ts` — 1 test
- `statusline-tick.spec.ts` — 1 test

Total: 5 E2E tests running against a live stack.

## Related

- Fastify integration tests: `server/src/__tests__/integration/` —
  `app.inject()`-based route tests; no browser.
- Unit tests: `server/src/services/__tests__/` +
  `client/src/utils/__tests__/` — SQL-mirror + pure function coverage.
