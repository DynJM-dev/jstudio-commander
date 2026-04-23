# Command-Center Plugin

Claude Code plugin that streams hook events to the local Command-Center sidecar for multi-session orchestration, task/run tracking, and knowledge capture.

## Requirements

- Claude Code ≥ 2.1.0 (HTTP hook transport)
- Command-Center running locally (`Command Center.app` launched from `/Applications/` or the build dir).

## Install (local file:// path — N2)

Command-Center's Preferences → Plugin tab shows the exact install command, with the monorepo path resolved via the running shell's `get_resource_path` IPC. Copy it from there, then in a Claude Code session:

```
/plugin marketplace add file:///absolute/path/to/command-center/apps/plugin
/plugin install commander@jstudio
```

Verify with `/plugin` — `commander` should show in the installed list.

Published GitHub marketplace distribution is N7 hardening; for now the local `file://` path is the supported path.

## Environment variables

The plugin requires two env vars to reach the sidecar. Set them in the shell that launches Claude Code (or persist in `~/.zshrc`):

```bash
export COMMANDER_PORT=11003                            # shown in Command-Center Preferences → General
export COMMANDER_TOKEN=<paste-from-Preferences>        # bearer token from Preferences → General Copy button
```

Command-Center's Preferences → Plugin tab displays current values inline so you don't have to hunt for them. The sidecar rejects every hook request missing or mismatched on `COMMANDER_TOKEN`.

## What this plugin does

Registers HTTP hook handlers for 13 Claude Code lifecycle events:

`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Notification`, `Stop`, `SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted`, `SessionEnd`, `PreCompact`, `PostCompact`

Each event POSTs the raw payload to `http://127.0.0.1:${COMMANDER_PORT}/hooks/<event-kebab-case>`. The sidecar persists every payload to SQLite (schema-drift defense per KB-P1.1), de-dupes by `(session_id, event_uuid)` (KB-P4.3), and emits a typed event on the per-session WebSocket topic `hook:<session_id>` (KB-P1.13).

**PreToolUse auto-allows in N2** — the real approval-modal pipeline lands in N5. The plugin's PreToolUse hook POSTs, Command-Center persists + emits, and responds with `{ hookSpecificOutput: { permissionDecision: "allow" } }`. No user prompt yet.

## License

MIT.
