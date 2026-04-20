# Phase P Track B — Security Audit

**Date:** 2026-04-17
**Auditor:** /security (adversarial, read-only)
**Scope:** JStudio Commander server + hooks + statusline + client (loopback-only today; design must assume future exposure)
**HEAD:** from STATE.md, post-`a42cfb0`

---

## Verdict

⚠️ **CLEAR WITH FINDINGS for loopback-only use today.**
⛔ **BLOCKED for any exposure beyond `127.0.0.1`** — 1 Critical, 3 High findings would be actively exploitable once the listener reaches the LAN or the Cloudflare tunnel.

## Executive Summary

Commander binds to `0.0.0.0:11002` by default, ships with an empty PIN, and the local-request bypass is gated on the attacker-controlled `Host` header. Any device that can reach the laptop on the LAN can drive sessions, send tmux keystrokes, and read JSONL transcripts without authenticating. Subprocess usage is uniformly `execFileSync` with argv (no shell injection), SQL is fully parameterized, and the CSP/security headers are reasonable. The most urgent fixes are: (1) bind to `127.0.0.1` by default, (2) replace `request.hostname` with `request.ip` in `isLocalRequest`, (3) require a PIN before the server will boot on a non-loopback host, and (4) upgrade `fastify` + `@fastify/static`.

## Findings by Severity

Totals: **1 Critical · 3 High · 5 Medium · 3 Low · 2 Info**

---

## CRITICAL

### C1 — Host-header spoof defeats PIN auth; server binds all interfaces by default

**What.** `server/src/config.ts:41` sets `host: '0.0.0.0'`. `server/src/middleware/pin-auth.ts:41-44` treats a request as local when `request.hostname` (derived from the client-controlled `Host` header) is `localhost` / `127.0.0.1` / `localhost:<port>`. `server/src/middleware/pin-auth.ts:122-125` then unconditionally bypasses PIN auth for those requests. The default config also writes an empty PIN (`server/src/config.ts:22`, `server/src/middleware/pin-auth.ts:17`), so a fresh install has no authentication at all even against honest clients.

**Why.** An attacker on the same LAN (coffee-shop WiFi, office network, or any co-resident process on a shared host) who can reach `http://<laptop-ip>:11002/` can forge the Host header and bypass auth outright:

```
curl -H "Host: localhost" http://192.168.1.x:11002/api/sessions
curl -H "Host: localhost" -X POST http://192.168.1.x:11002/api/sessions/<id>/command \
     -d '{"command":"rm -rf ~/.claude"}' -H "content-type: application/json"
```

The `command` POST calls `tmuxService.sendKeys`, which sends the text into a live Claude session. The attacker can `/bash` anything, read any file the user can read, exfiltrate transcripts, install tunnels, etc. They can also hit `/api/hook-event` which has **no loopback check at all** and mutates the DB based on fully attacker-controlled input (see H1).

**Fix (direction, not code).** Three layers, all needed:
1. Default `config.host = '127.0.0.1'` unless an operator opts into LAN exposure via an explicit `bindHost` in `~/.jstudio-commander/config.json`.
2. Replace `isLocalRequest` with an `ip`-based check: `request.ip === '127.0.0.1' || request.ip === '::1' || request.ip === '::ffff:127.0.0.1'`. Do not trust `request.hostname` for security decisions. Fastify `trustProxy` stays disabled (default) so `request.ip` remains the raw socket peer.
3. Refuse to bind a non-loopback host with an empty PIN — same guard as `tunnelService.start` (`server/src/services/tunnel.service.ts:36-40`) but enforced at server boot, not just at tunnel start.

**Cite:** `server/src/config.ts:41`, `server/src/middleware/pin-auth.ts:17, 41-44, 122-125`, `server/src/routes/hook-event.routes.ts:182-197`.

---

## HIGH

### H1 — `/api/hook-event` has no loopback guard, mutates DB + writes attacker paths to `transcript_paths`

**What.** `server/src/routes/hook-event.routes.ts:182-197` accepts `POST /api/hook-event` with an unvalidated `HookEventBody`. The only gatekeeping is the PIN middleware, which (per C1) is bypassable via the Host header. The handler:
- Calls `fileWatcherService.watchSpecificFile(transcriptPath)` at line 284 with the caller-supplied path, before `resolveOwner`. `fs.watch()` is invoked on whatever path the attacker chose. A non-existent path throws silently; an existing path starts a watcher and stores the FD in `specificWatchers` keyed by the attacker-controlled string (no size cap).
- Calls `resolveOwner` (line 291), which on step 1 matches `transcript_paths LIKE '%<escaped>%'`. The LIKE pattern uses `JSON.stringify(transcriptPath).slice(1,-1)` as a crude escape (`server/src/routes/hook-event.routes.ts:71-72`), but `%` and `_` in the attacker input remain LIKE metacharacters — an attacker can craft `%` to match any existing session row.
- On Stop/SessionEnd events (lines 211-218, 260-274), writes `status='stopped'` / `stopped_at=now()` to the matched session — an attacker can kill any user's session by guessing or enumerating IDs.
- `sessionService.appendTranscriptPath` (line 307) persists the attacker-supplied path into the victim session's `transcript_paths` JSON. The chat endpoint (`server/src/routes/chat.routes.ts:17-24`) later reads that array and `readFileSync`s every path. Any world-readable file on the system whose bytes happen to parse as JSONL would be dumped into the Commander chat UI.

**Why.** Three distinct impacts from one unauthenticated endpoint:
1. Arbitrary session DoS — flip any session to `stopped` by spoofing a `SessionEnd` hook with its Claude UUID.
2. Arbitrary file-read amplification — push paths like `/etc/hosts`, `/Users/…/.ssh/config`, etc. into a session's `transcript_paths`; the next `/api/chat/<id>` call returns the file content as (malformed) chat messages.
3. Unbounded FD growth — each `watchSpecificFile` allocates a native `fs.watch` handle. The map at `server/src/services/file-watcher.service.ts:16` has no eviction. Easy local DoS.

**Fix (direction).** Gate `/api/hook-event` on `request.ip` being loopback (same shape as `session-tick.routes.ts:19-22, 29-31`). Validate `transcript_path` against an allowlist prefix (`~/.claude/projects/**/*.jsonl` normalized + `path.resolve`d and compared to the canonical Claude dir from `config.claudeProjectsDir`). Escape `%` and `_` in the LIKE parameter, or (better) use `=` against the array serialization. Cap `specificWatchers` size and evict oldest.

**Cite:** `server/src/routes/hook-event.routes.ts:182-197, 211-229, 260-274, 284, 291, 307`; `server/src/routes/chat.routes.ts:17-24, 26-38`; `server/src/services/file-watcher.service.ts:16, 173-213`.

---

### H2 — No WebSocket Origin check; CORS trusts any `localhost:PORT` whose Host is spoofed

**What.** `server/src/ws/handler.ts:53-79` registers `/ws` with no `verifyClient` / Origin check. `server/src/index.ts:61-68` registers CORS with `origin: ['http://localhost:11573', …, 'http://localhost:5173', …]`. Browsers will enforce same-origin against those strings, but a malicious page served from `http://evil.localhost:5173` (requires DNS rebind or hosts-file control but not uncommon on shared machines) satisfies the substring match if the CORS comparator is lenient. More importantly, WebSocket has no CORS — any origin can upgrade and start receiving live session data.

**Why.** A malicious webpage the user visits in the same browser session can:
- Open `ws://localhost:11002/ws`
- Subscribe to `sessions`, `chat:<id>`, `system` channels
- Receive every tool call, every chat message, every context-tick (costs, tokens, cwd)
- Send `session:command` events and drive tmux (lines 38-41 of `handler.ts`)

PIN is not required for the WS path (`pinAuthMiddleware` runs on `onRequest` before the upgrade but is bypassed when `isLocalRequest` returns true). In local-only mode every browser tab qualifies.

**Fix (direction).** Add a `verifyClient` to the WS server that checks `req.headers.origin` against the same allowlist used by CORS. Reject the upgrade on mismatch. Per-channel, require the subscriber to have authenticated (PIN-verified session cookie) if `config.pin` is set.

**Cite:** `server/src/ws/handler.ts:53-79`; `server/src/index.ts:61-68`.

---

### H3 — `fastify@5.8.4` body-validation bypass (GHSA-247c-9743-5963, HIGH)

**What.** `pnpm audit --prod` reports `fastify` vulnerable to a body-schema validation bypass via a leading space in the Content-Type header. Affects `>=5.3.2 <=5.8.4`; fixed in `5.8.5+`.

**Why.** Commander doesn't declare schemas on its routes (no Zod, no Fastify route schemas), so this CVE has no exploitable handler here today. It becomes a high-value bypass the moment any route adopts `schema: { body: … }` for DGII-style validation. Low effort to upgrade, zero API change.

**Fix (direction).** Bump `fastify` to `^5.8.5` in `server/package.json`, run `pnpm install`.

**Cite:** `pnpm audit --prod` output; advisory <https://github.com/advisories/GHSA-247c-9743-5963>.

---

## MEDIUM

### M1 — `@fastify/static@8.3.0` path-traversal + route-guard bypass (2× GHSA, MODERATE)

**What.** `@fastify/static@8.3.0` is vulnerable to (a) path traversal in directory listing (GHSA-pr96-94w5-mx2h) and (b) route-guard bypass via encoded path separators (GHSA-x428-ghpx-8j92). Fixed in `9.1.1+`.

**Why.** Not exploitable today because `fastify-static` only registers when `NODE_ENV === 'production' && existsSync(client/dist)` (`server/src/index.ts:77-91`), and dev mode is the common runtime. Becomes relevant the moment a production `.app` bundle is shipped.

**Fix.** Bump `@fastify/static` to `^9.1.1`.

**Cite:** `pnpm audit --prod` output; `server/src/index.ts:79-85`.

---

### M2 — PIN stored in `sessionStorage`, exfiltrable through any future XSS

**What.** `client/src/services/api.ts:23, 31, 39, 48` and `client/src/services/ws.ts:20-21` store and read the PIN from `sessionStorage`, and the WS client appends it as a query parameter.

**Why.** Defense-in-depth concern. Commander renders Claude transcripts (`CodeBlock.tsx:148` uses `dangerouslySetInnerHTML` for shiki-highlighted code; shiki output is HTML-escaped, so today's usage is safe). Any future component that renders unescaped tool output, a user-configurable project name, or a markdown link with a `javascript:` href would allow `sessionStorage.getItem('commander-pin')` exfiltration. The same HTML-escape of `shiki` applies to `react-markdown` which defaults to safe rendering — don't regress it. The `ws.ts` `?pin=…` query approach also leaks to logs exactly as `pin-auth.ts:50-58` warns — that warning is about server-side extraction but the same risk applies client-side to URL referer headers and browser history.

**Fix (direction).** Keep PIN in an `httpOnly` cookie set by `/api/auth/verify-pin`. Stop appending `?pin=` in the WS URL — send it inside the first message on the socket after open, or rely on the cookie. Add an explicit strict CSP `connect-src 'self'` without `ws:` / `wss:` wildcard (the current CSP allows `ws:` globally — limit to `'self'`).

**Cite:** `client/src/services/api.ts:23, 31, 39, 48`; `client/src/services/ws.ts:20-21`; `server/src/middleware/security-headers.ts:14-24`; `server/src/middleware/pin-auth.ts:50-58`.

---

### M3 — No rate limiting on state-changing routes

**What.** The PIN-verify endpoint throttles attempts (`server/src/middleware/pin-auth.ts:79-102`), but every other route — `POST /api/sessions`, `DELETE /api/sessions/:id`, `POST /api/sessions/:id/command`, `POST /api/sessions/:id/key`, `POST /api/sessions/:id/system-notice`, `POST /api/hook-event`, `POST /api/projects/scan` — has no rate limiter. Fastify has no registered `@fastify/rate-limit` plugin.

**Why.** A PIN-authenticated remote attacker (or a local attacker after C1/H1 bypass) can spam `POST /api/sessions` to spawn tmux processes until the host runs out of PIDs, or blast `POST /api/hook-event` to grow the `transcript_paths` JSON unboundedly. `POST /api/projects/scan` is especially expensive (it shells out `git log` per project via `execFileAsync` with a 3 s timeout each — 3 × N seconds at worst).

**Fix (direction).** Add `@fastify/rate-limit` globally with a default like 100 req/min per IP, tighter on `/api/sessions` (POST), `/api/hook-event`, `/api/projects/scan`.

**Cite:** `server/src/routes/session.routes.ts:47, 61, 115, 133`; `server/src/routes/project.routes.ts:26`; `server/src/routes/hook-event.routes.ts:182`; `server/src/services/project-stack.service.ts:300-305`.

---

### M4 — `transcript_paths LIKE` uses unescaped attacker-controlled pattern

**What.** `server/src/routes/hook-event.routes.ts:70-73` builds the LIKE value as `%${JSON.stringify(transcriptPath).slice(1,-1)}%`. `JSON.stringify` escapes backslashes and quotes but does not escape the SQL-LIKE metacharacters `%` and `_`. `LIKE` pattern injection lets a caller match rows they don't own — a `transcript_path` of `%` matches every session row.

**Why.** Feeds H1 — an attacker can target a specific victim row by supplying a LIKE wildcard that matches only that row's `transcript_paths` content.

**Fix (direction).** Escape `%`, `_`, and `\` in the LIKE input, or replace the LIKE with a JSON1 query (`json_each` / `json_extract`) that compares for exact-path membership.

**Cite:** `server/src/routes/hook-event.routes.ts:70-73`.

---

### M5 — Unbounded `specificWatchers` map → FD exhaustion DoS

**What.** `server/src/services/file-watcher.service.ts:16` declares `specificWatchers = new Map<string, NodeFSWatcher>()` with no size cap and no TTL. Every new `transcript_path` seen by `/api/hook-event` (attacker-controllable — see H1) allocates a `fs.watch` FD that lives until `fileWatcherService.stop()` (only called on shutdown).

**Why.** Local or authenticated remote attacker can exhaust the OS FD limit (macOS default 256 for user processes, 10240 hard) in seconds by POSTing distinct paths.

**Fix (direction).** Cap the map at ~500 entries; LRU-evict + `watcher.close()` on eviction. Or, skip the watcher entirely for paths outside `config.claudeProjectsDir`.

**Cite:** `server/src/services/file-watcher.service.ts:16, 173-213`.

---

## LOW

### L1 — Statusline default URL points at pre-migration port 3002

**What.** `packages/statusline/statusline.mjs:18` has `FORWARD_URL = process.env.JSC_TICK_URL ?? 'http://127.0.0.1:3002/api/session-tick'`. The server now binds 11002 (STATE.md). Ticks to the dead 3002 port silently fail (line 41-42 catches). Not a security issue; it's a silent freshness regression and a minor phishing opportunity — a local process listening on 3002 would capture every statusline payload (cost, tokens, cwd, session UUIDs) the user types.

**Fix.** Change the default to `11002`, or read `~/.jstudio-commander/config.json` at forwarder start.

**Cite:** `packages/statusline/statusline.mjs:18`.

---

### L2 — No HSTS header (acceptable per comment, but re-evaluate if custom-domain tunnel is added)

**What.** `server/src/middleware/security-headers.ts:36-38` explicitly omits HSTS because Cloudflare terminates TLS on `trycloudflare.com` (whose preload list they own). Rational today. Flag for reevaluation if a custom tunnel domain or Tailscale HTTPS front is introduced.

**Fix.** Add a conditional HSTS header when `request.headers.host` is a custom domain. Skip on `trycloudflare.com`.

**Cite:** `server/src/middleware/security-headers.ts:36-38`.

---

### L3 — `console.log` of session IDs, transcript basenames in server logs

**What.** Multiple places log `session.id.slice(0, 8)` / basename of transcript — low sensitivity, but logs go to the Fastify logger and potentially to any log-shipping sidecar a user bolts on. Not directly exploitable.

**Fix.** Fine for now. If log shipping is added, scrub or truncate further.

**Cite:** `server/src/routes/hook-event.routes.ts:227, 250, 273, 277, 294, 308`; `server/src/services/session.service.ts:310-315`.

---

## INFO (positives)

### I1 — Subprocess usage is uniformly safe

Every child-process call uses `execFileSync` / `execFile` / `spawn` with argv arrays, never `exec` or a shell string. The one `execSync('which cloudflared', …)` in `tunnel.service.ts:14` is a hardcoded command. No user input crosses a shell boundary anywhere. This is the single strongest security property of the codebase — keep it.

**Cite:** `server/src/services/tmux.service.ts:10-26`; `server/src/services/terminal.service.ts:82, 89, 104, 139`; `server/src/services/project-stack.service.ts:301-305`; `server/src/services/tunnel.service.ts:14, 45`.

### I2 — SQL is fully parameterized

Every `db.prepare()` call takes a SQL string with `?` placeholders and runs values through `.run(...)` / `.get(...)` / `.all(...)`. The two `${sets.join(...)}` interpolations in `session.service.ts:211, 973` build a whitelisted column list from `SESSION_COL_MAP` + hardcoded update keys — never user input. No concat, no template-literal SQL with attacker-controlled values.

**Cite:** `server/src/services/session.service.ts:167-183, 211, 973`.

### I3 — CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy present

`securityHeadersMiddleware` sets a conservative CSP with no `unsafe-eval`, `frame-ancestors 'none'`, strict `form-action 'self'`, and the full set of baseline hardening headers. The only soft spot is `style-src 'unsafe-inline'` (needed by Tailwind v4 inline styles — documented). Good baseline.

**Cite:** `server/src/middleware/security-headers.ts:14-39`.

### I4 — Timing-safe PIN compare + per-IP lockout

`server/src/middleware/pin-auth.ts:65-74, 79-102` uses `crypto.timingSafeEqual`, handles length mismatch without leaking, and locks out IPs for 15 min after 5 wrong PINs in 5 min. Exactly right for a 4-6 digit PIN.

**Cite:** `server/src/middleware/pin-auth.ts:65-102`.

### I5 — Tunnel refuses to expose the server without a PIN

`server/src/services/tunnel.service.ts:36-40` refuses to start cloudflared when `config.pin` is empty. This is the pattern that should be extended to the server boot itself (see C1 fix #3).

**Cite:** `server/src/services/tunnel.service.ts:36-40`.

---

## Remediation Priority Matrix

| # | Finding | Severity | Effort | Owner | Deadline |
|---|---|---|---|---|---|
| C1 | Host bind + Host-header bypass + empty-PIN boot | CRITICAL | M (3 touches) | coder | before any LAN/tunnel usage |
| H1 | `/api/hook-event` unauthenticated write surface | HIGH | M | coder | before any LAN/tunnel usage |
| H2 | WS Origin check + CORS tighten | HIGH | S | coder | before any LAN/tunnel usage |
| H3 | `fastify` → 5.8.5 | HIGH | XS | coder | this week |
| M1 | `@fastify/static` → 9.1.1 | MED | XS | coder | before production `.app` ships |
| M2 | PIN in httpOnly cookie, drop `?pin=` URL | MED | M | coder | before LAN/tunnel |
| M3 | `@fastify/rate-limit` globally | MED | S | coder | before LAN/tunnel |
| M4 | Escape `%`/`_` in LIKE pattern | MED | XS | coder | bundled with H1 |
| M5 | Cap `specificWatchers` | MED | XS | coder | bundled with H1 |
| L1 | statusline default port 3002 → 11002 | LOW | XS | coder | next housekeeping pass |
| L2 | HSTS gated on custom domain | LOW | XS | coder | when custom domain is planned |
| L3 | log scrubbing | LOW | — | — | only if log-ship added |

---

## Retest Checklist

Before the next audit clears:

- [ ] `curl http://<laptop-LAN-ip>:11002/api/sessions` returns connection refused (or 403) with default config
- [ ] `curl -H 'Host: localhost' http://<laptop-LAN-ip>:11002/api/sessions` returns 401 (not 200)
- [ ] `curl -X POST http://127.0.0.1:11002/api/hook-event` from a different UID returns 403
- [ ] `pnpm audit --prod` reports 0 HIGH, 0 MODERATE
- [ ] WS upgrade with `Origin: http://evil.example` returns 403 on the handshake
- [ ] PIN no longer present in `window.sessionStorage` after login (cookie instead)
- [ ] `/api/hook-event` with `transcript_path: '/etc/passwd'` is rejected (not appended to any session)
- [ ] `/api/sessions` can be rate-limited: 200 POSTs in 10 s returns 429 somewhere in the burst
- [ ] Starting the server with `host != '127.0.0.1'` AND empty PIN exits with a clear error (matches tunnel.service.ts:36-40 pattern)

---

*End of report.*
