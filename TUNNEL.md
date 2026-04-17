# Accessing JStudio Command Center from your phone

JStudio Command Center runs on your laptop. To reach it from your phone (on the
go, on cellular, on a different Wi-Fi network), Command Center spins up a
Cloudflare quick tunnel that gives you a public `https://*.trycloudflare.com`
URL guarded by a PIN you set.

## One-time setup

1. **Install cloudflared.**

   ```bash
   brew install cloudflared
   ```

2. **Set a PIN.** Edit `~/.jstudio-commander/config.json`:

   ```json
   {
     "pin": "1234",
     "projectDirs": ["/Users/you/Desktop/Projects"],
     "port": 11002
   }
   ```

   Pick a numeric PIN at least 4 digits long. **Command Center refuses to start the
   tunnel without one** — without a PIN, anyone with the URL could drive your
   sessions and run shell commands.

3. **Restart Command Center** so it reads the new PIN: `lsof -ti:11002 | xargs kill -9 && pnpm dev`.

## Starting the tunnel

From Command Center's UI: open the top command bar (or settings) and hit
**Start Tunnel**. Within ~5 seconds you'll see a URL like
`https://crispy-lemur-1234.trycloudflare.com`.

From the CLI:
```bash
curl -X POST http://localhost:11002/api/tunnel/start
```

Stop it:
```bash
curl -X POST http://localhost:11002/api/tunnel/stop
```

## On your phone

1. Open the URL in Safari (iOS) or Chrome (Android).
2. Enter your PIN. Command Center remembers it for the tab session
   (sessionStorage — clears when you fully close the browser).
3. **Add to Home Screen** for a near-native feel: Safari → Share → Add to
   Home Screen. The PWA manifest gives Command Center a standalone app shell
   without browser chrome.

## Troubleshooting

- **"Cloudflared is not installed"**: run `brew install cloudflared`.
- **"Refusing to start tunnel: no PIN configured"**: set a PIN in
  `~/.jstudio-commander/config.json` and restart the server.
- **Tunnel URL works but PIN fails**: you've hit the brute-force lockout
  (5 wrong attempts in 5 minutes → 15-min lockout per IP). Wait or restart
  Command Center to clear the in-memory counter.
- **Phone shows "Server restarting…" banner**: the laptop's Command Center
  server is restarting — banner auto-clears within ~12s when the WS
  heartbeat resumes. If it persists, your laptop went to sleep — wake it.
- **Tunnel URL changed after restart**: free trycloudflare URLs rotate on
  every cloudflared restart. Bookmark the new one. For a stable URL you
  need a named tunnel (`cloudflared tunnel create <name>` + DNS) — not
  set up by Command Center out of the box.
- **WS keeps disconnecting on cellular**: Cloudflare quick tunnels can be
  flaky over high-latency links. The WS client auto-reconnects; the
  banner will surface if it can't.

## Security notes

- PIN is verified with `crypto.timingSafeEqual` and rate-limited per IP.
- All responses carry CSP, X-Frame-Options DENY, nosniff, Referrer-Policy,
  and Permissions-Policy headers.
- Cloudflared logs URLs at the proxy layer — Command Center rejects PIN passed
  via query string on remote requests for that reason. Use the header path
  (the UI handles this for you).
- The PIN guards the WebSocket upgrade as well as REST. Once a tab is
  authenticated, its WS connection is trusted for the lifetime of that
  socket. Close the tab to invalidate.
