#!/usr/bin/env bash
# forward.sh — Commander plugin hook forwarder.
#
# Claude Code invokes this with one positional arg: the kebab-case hook event
# name (e.g. "session-start"). Hook payload arrives on stdin as JSON. We POST
# it to the Commander sidecar at the port + bearer from ~/.commander/config.json
# and echo the sidecar's response back so Claude Code can act on it.
#
# Why a shell shim instead of `"type": "http"` hooks: Claude Code v2.1+ validates
# the URL field of http-type hooks at plugin-load time with strict URL format
# validation — env-var placeholders like ${COMMANDER_PORT} fail validation
# before any expansion happens. Command-type hooks accept arbitrary shell and
# are the working pattern across the installed marketplace.
#
# Config read at every invocation (not cached) so port changes across sidecar
# launches are picked up without reinstall. Fail-open on every error path —
# hook failures must never block Claude Code.

set -u

EVENT_NAME="${1:-}"
CONFIG="${HOME}/.commander/config.json"

# Any error: emit {"continue":true} so Claude Code proceeds without blocking.
if [[ -z "$EVENT_NAME" || ! -f "$CONFIG" ]]; then
  echo '{"continue":true}'
  exit 0
fi

# Extract port + bearerToken from config.json using pure bash (no jq dep).
PORT=$(grep -oE '"port"[[:space:]]*:[[:space:]]*[0-9]+' "$CONFIG" | grep -oE '[0-9]+$')
TOKEN=$(grep -oE '"bearerToken"[[:space:]]*:[[:space:]]*"[^"]+"' "$CONFIG" \
  | sed -E 's/.*"([^"]+)"$/\1/')

if [[ -z "$PORT" || -z "$TOKEN" ]]; then
  echo '{"continue":true}'
  exit 0
fi

# POST the stdin payload to the sidecar. Hard timeout prevents a stuck sidecar
# from blocking Claude Code's hook pipeline. Sidecar response is echoed so
# blocking hooks (PreToolUse) can return decisions to Claude Code.
RESPONSE=$(curl -sS --max-time 4 -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @- \
  "http://127.0.0.1:${PORT}/hooks/${EVENT_NAME}" 2>/dev/null)

if [[ -z "$RESPONSE" ]]; then
  echo '{"continue":true}'
  exit 0
fi

echo "$RESPONSE"
