#!/bin/bash
# JStudio Commander hook — forwards Claude Code events to Commander server
# Receives JSON via stdin with session_id, transcript_path, hook_event_name, etc.

HOOK_DATA=$(cat 2>/dev/null || echo '{}')

# Extract key fields
EVENT=$(echo "$HOOK_DATA" | /usr/bin/python3 -c "import sys,json; print(json.load(sys.stdin).get('hook_event_name','unknown'))" 2>/dev/null || echo 'unknown')
TRANSCRIPT=$(echo "$HOOK_DATA" | /usr/bin/python3 -c "import sys,json; print(json.load(sys.stdin).get('transcript_path',''))" 2>/dev/null || echo '')

# Build minimal payload
PAYLOAD=$(/usr/bin/python3 -c "
import json, sys
data = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
print(json.dumps({
    'event': data.get('hook_event_name', 'unknown'),
    'sessionId': data.get('session_id', ''),
    'data': {
        'transcript_path': data.get('transcript_path', ''),
        'cwd': data.get('cwd', ''),
        'tool_name': data.get('tool_name', ''),
    }
}))
" "$HOOK_DATA" 2>/dev/null || echo '{"event":"unknown","data":{}}')

# POST to Commander (fire-and-forget, don't block Claude Code)
curl -s -X POST http://localhost:3002/api/hook-event \
  -H "Content-Type: application/json" \
  --data "$PAYLOAD" \
  --connect-timeout 1 \
  --max-time 2 \
  2>/dev/null || true

exit 0
