#!/bin/bash
# JStudio Commander — macOS .app launcher runtime.
# 1. If the signed health endpoint already responds, just open the URL.
# 2. Else boot via Terminal.app (visible log window) and poll for health
#    up to 30s, then open the URL anyway so the UI can show its own
#    loading state if boot is still in flight.
set -e

# Read port from user config (same override chain as the server). Fall
# back to the new default if the file is missing or malformed.
CONFIG="$HOME/.jstudio-commander/config.json"
PORT=11002
if [ -f "$CONFIG" ]; then
  FROM_CFG=$(/usr/bin/python3 -c "
import json, sys
try:
    with open('$CONFIG') as f:
        v = json.load(f).get('port')
    if isinstance(v, int):
        print(v)
except Exception:
    pass
" 2>/dev/null || true)
  if [ -n "$FROM_CFG" ]; then
    PORT="$FROM_CFG"
  fi
fi

URL="http://localhost:$PORT"
REPO="$HOME/Desktop/Projects/jstudio-commander"
SIG='"service":"jstudio-commander"'

ping_signed() {
  curl -s --max-time 1 "$URL/api/system/health" 2>/dev/null | grep -q "$SIG"
}

# Already running — just open it.
if ping_signed; then
  open "$URL"
  exit 0
fi

# Boot via Terminal.app so the user has a visible log window.
osascript <<APPLESCRIPT
tell application "Terminal"
  activate
  do script "cd '$REPO' && pnpm dev"
end tell
APPLESCRIPT

# Wait up to 30s for health to come up.
for _ in $(seq 1 30); do
  if ping_signed; then
    open "$URL"
    exit 0
  fi
  sleep 1
done

# Timeout fallback — open anyway so the UI can show its own load state.
open "$URL"
