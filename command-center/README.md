# JStudio Command-Center

Tauri v2 + Bun sidecar monorepo. Replaces archived native-v1 (frozen at `dc8a0f6` in the parent repo's `native-v1/` archive).

## Layout

```
command-center/
  apps/
    shell/       # Tauri v2 Rust shell (≤150 LOC)
    frontend/    # React 19 + Vite + Tailwind v4 + shadcn/ui + TanStack Router
    sidecar/     # Bun + Fastify + Drizzle + bun:sqlite
  packages/
    shared/      # shared TS types, event schemas, constants
    ui/          # shared React components
  docs/
    phase-reports/  # PHASE_N1_REPORT.md, …
```

## Requirements

- Bun ≥ 1.3.5
- Rust ≥ 1.77
- macOS (v1 target)

## Scripts

- `bun run dev` — Tauri dev mode (frontend HMR, sidecar auto-reload)
- `bun run build:app` — production bundle (no DevTools)
- `bun run build:app:debug` — production bundle with right-click Inspect
- `bun run typecheck` — workspace-wide typecheck
- `bun run lint` — Biome check
- `bun run test` — workspace-wide tests

## State

- User data: `~/.jstudio-commander/commander.db` (SQLite) + `config.json` (bearer token, port) + `logs/<date>.log`.
- Sidecar ports: 11002..11011 (scanned at boot; first available claimed).

## Docs

- Architecture: `../docs/command-center/ARCHITECTURE_SPEC.md`
- Roadmap: `../docs/command-center/COMMAND_CENTER_ROADMAP.md`
- Dispatches: `../docs/dispatches/command-center/`
