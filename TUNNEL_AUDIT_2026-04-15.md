# Cloudflare Tunnel Audit — 2026-04-15

Issue: #229. Auditor: coder-10. Server live on :3002.

---

## Backend

| Area | Status | Notes |
|---|---|---|
| Tunnel target port | **FIXED** | Was hardcoded `localhost:3001`; user runs on `3002`. Tunnel never reached the server. Now reads `config.port`. (commit `24e7320`) |
| PIN gate on entry | **PASS** | `pinAuthMiddleware` runs as `onRequest` hook; rejects remote requests without a valid PIN. WS upgrade goes through the same hook. |
| PIN required for tunnel | **FIXED** | `tunnelService.start()` now refuses to start when `config.pin` is empty. Previously: open tunnel + open server = RCE. (`24e7320`) |
| Timing-safe PIN compare | **FIXED** | Was `===`; now `crypto.timingSafeEqual` with a constant-time length check. (`24e7320`) |
| Brute-force protection | **FIXED** | Per-IP fail2ban: 5 wrong attempts in 5 min → 15-min lockout. 429 + `retryAfterMs`. (`24e7320`) |
| `/api/auth/verify-pin` honesty | **FIXED** | Was returning `{valid:true}` when no PIN configured (lied about protection). Returns 403 now. (`24e7320`) |
| Query-param PIN over tunnel | **FIXED** | Was accepted; Cloudflare/proxy URL logs leak it. Header-only on remote; localhost still accepts query. (`24e7320`) |
| CSP / X-Frame-Options / nosniff / Referrer-Policy / Permissions-Policy | **FIXED** | New `securityHeadersMiddleware`. CSP locked to `'self'` + `'unsafe-inline'` for Tailwind v4 inline styles. (`24e7320`) |
| HSTS | **N/A** | Cloudflare terminates TLS upstream; trycloudflare.com is on the HSTS preload list, browsers enforce regardless. |
| WS upgrade through tunnel | **PASS** | `connect-src 'self' ws: wss:` in CSP; fastify-websocket runs onRequest hook so PIN gate applies. |
| WS upgrade auth | **CONCERN** | Once a WS connects, no per-message PIN verification. PIN guards the upgrade only. Acceptable given short-lived tab sessions, but document. |
| CSRF | **PASS-by-design** | Same-origin SPA with custom `x-commander-pin` header. Browsers don't auto-attach this header on cross-origin requests, so a forged form/img can't perform a PIN-authenticated action. No cookie auth = no classic CSRF surface. |
| Cloudflared zombies | **FIXED** | `stop()` now sends SIGTERM, falls back to SIGKILL after 2s if no `exit` event. (`24e7320`) |
| Tunnel URL persistence across server restart | **DOCUMENTED** | Free `trycloudflare.com` URLs change every cloudflared restart. Persistence requires a named tunnel via `cloudflared tunnel create` + DNS. Out of scope for the quick-tunnel feature. |
| Multi-instance lockfile | **PASS** | Already shipped in `4d0403e`. Second instance refuses boot with clear message. |

## Client

| Area | Status | Notes |
|---|---|---|
| `PinGate` UX | **PASS** | Numeric inputMode, glass modal, autofocus, error/disabled states clean. |
| PIN input iOS auto-zoom | **PASS** | Input uses `text-2xl` (24px) — above the 16px threshold. |
| Tunnel URL display + copy | **CONCERN — coder-9 lane** | Lives in `TopCommandBar` / `MobileOverflowDrawer` (coder-9's files). Surface the URL with a copy button + QR for phone scanning. Logged for coder-9. |
| Connection status indicator | **PASS** | `HealthBanner` (commit `6350628`) handles WS disconnect + heartbeat-stale window. |
| Graceful reconnect | **PASS** | `wsClient` already auto-reconnects on close (existing). |

## Mobile / PWA

| Area | Status | Notes |
|---|---|---|
| Viewport meta | **FIXED** | Added `viewport-fit=cover` for iOS notch. (`24e7320`) |
| `theme-color` meta | **FIXED** | `#0A0E14` matches dark surface — iOS Safari uses for status bar tint. (`24e7320`) |
| `color-scheme` meta | **FIXED** | `dark` so form controls render dark. (`24e7320`) |
| Apple PWA capability | **FIXED** | `apple-mobile-web-app-capable=yes`, status-bar-style `black-translucent`, app title "Commander". (`24e7320`) |
| `manifest.webmanifest` | **FIXED** | Added with `display:standalone`, theme/bg colors, app name, icons. PWA installable. (`24e7320`) |
| Touch targets ≥44px | **PASS (CSP-checked snippets)** | Existing button styles use `cta-btn-primary` and similar. Coder-9's #225 button-style tabs already hit min height. |
| Bottom-tab vs iOS home indicator | **CONCERN — coder-9 lane** | `MobileNav` lives in coder-9's layouts. Confirm `padding-bottom: env(safe-area-inset-bottom)` is set; flagged for coder-9 in delta. |
| iOS keyboard scroll-jump on chat input | **REQUIRES USER VERIFICATION** | Cannot test without device. Chat input is in coder-9's lane. |
| Split-screen collapse on mobile | **REQUIRES USER VERIFICATION** | `SplitChatLayout` (coder-9). Existing `md:` breakpoints suggest it does collapse — verify on phone. |
| Orientation change | **REQUIRES USER VERIFICATION** | Layout uses Tailwind responsive classes; should adapt. Verify rotation behavior on phone. |

## Live tests

| # | Test | Result |
|---|---|---|
| Smoke | Security headers present on `/api/system/health` | **PASS** — CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy all returned |
| Smoke | `verify-pin` with no PIN configured returns 403 with explanatory error | **PASS** |
| Smoke | Tunnel start without cloudflared installed returns clean error | **PASS** |
| Smoke | Lockfile blocks second instance | **PASS** (verified earlier in `4d0403e`) |
| Manual | Start tunnel → URL format / WS port | **REQUIRES cloudflared** — not installed on this machine |
| Manual | Phone PIN entry + auth | **REQUIRES USER VERIFICATION** |
| Manual | Phone chat streaming | **REQUIRES USER VERIFICATION** |
| Manual | Phone permission prompt visible | **REQUIRES USER VERIFICATION** |
| Manual | Phone orientation change | **REQUIRES USER VERIFICATION** |
| Manual | Phone background → resume → WS reconnect | **REQUIRES USER VERIFICATION** |
| Manual | Server restart → tunnel auto-restart? URL persists? | **DOCUMENTED** — tunnel does not auto-restart with the server today (manual `/api/tunnel/start` required). URL rotates on every cloudflared restart (free tier). |

## Outstanding before user testing

1. **Install cloudflared** — `brew install cloudflared`. Verified script path checks for it.
2. **Set a PIN** — edit `~/.jstudio-commander/config.json`, set `"pin": "<numeric pin>"`. Server refuses to start the tunnel without one.
3. **Restart server** — config is read at boot.
4. **Start tunnel** from the UI (TopCommandBar / settings) or `curl -X POST http://localhost:3002/api/tunnel/start`.
5. **Open URL on phone** — enter PIN, run the manual checks above.

## Coder-9 follow-ups

- `TopCommandBar`: add visible tunnel URL chip + copy/QR control (P1).
- `MobileNav`: confirm `env(safe-area-inset-bottom)` padding for iOS home indicator (P1).
- `SplitChatLayout`: verify it collapses to single-pane below `md:` breakpoint on real phones (P2).
- Optional: per-message WS auth handshake. Today PIN guards the upgrade only — fine if tab sessions are short, worth revisiting if WS sessions get reused across days.
