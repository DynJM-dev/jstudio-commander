# JStudio Commander — Native v1

Native macOS rebuild of JStudio Commander. Tauri v2 shell + Node.js sidecar (Fastify + node-pty + Drizzle SQLite) + React 19 + xterm.js frontend.

**Status:** Phase N1 in flight. See `docs/phase-reports/` for phase acceptance tracking.

## Architectural contract

All architectural decisions derive from:

- `~/Desktop/Projects/jstudio-commander/docs/native-v1/ARCHITECTURE_SPEC.md` v1.2 (canonical)
- `~/Desktop/Projects/jstudio-commander/docs/native-v1/FEATURE_REQUIREMENTS_SPEC.md` v1
- `~/Desktop/Projects/jstudio-commander/docs/migration-v2/MIGRATION_V2_RETROSPECTIVE.md`
- `~/Desktop/Projects/jstudio-meta/OPERATING_SYSTEM.md` (§14.1, §15, §20.LL-L11–L14, §23.3, §24)

Runtime choice: **Node 22 LTS** (Bun failed N1 Task 1 verification — see `docs/n1-spikes/bun-verification-result.md`).

## Monorepo layout

```
native-v1/
├── apps/
│   ├── shell/          # Tauri v2 Rust shell (≤150 LOC budget per spec §2.5)
│   ├── sidecar/        # Fastify + node-pty + Drizzle (Node runtime)
│   └── frontend/       # React 19 + Vite + Tailwind v4 + xterm.js
├── packages/
│   ├── shared/         # Typed IPC events, session types, renderer registry
│   └── db/             # Drizzle schema + migrations + seed
├── resources/
│   └── osc133-hook.sh  # Bundled zsh shell integration hook
└── docs/
    ├── phase-reports/
    └── n1-spikes/
```

## Prerequisites

- Node 22.17+
- pnpm 10.5+
- Rust (stable) + `cargo-tauri` CLI
- macOS arm64 (v1 is macOS-only)

## Dev workflow (Tasks 2–9)

```bash
pnpm install        # install workspace deps
pnpm tauri:dev      # launch Tauri shell + sidecar + frontend in dev mode
```

## Production builds

```bash
pnpm build:app          # release build; Commander.app without DevTools
pnpm build:app:debug    # release build with WKWebView Inspector enabled
```

`build:app:debug` compiles the Rust shell with the `devtools` Cargo feature
(declared in `apps/shell/src-tauri/Cargo.toml` as an opt-in `features`
entry). The resulting `Commander.app` behaves identically to the release
build except right-click → Inspect Element opens Safari Web Inspector on
the webview. Use this variant for SMOKE_DISCIPLINE-compliant diagnostic
smoke — inspecting Network / Console tabs is how webview-fetch issues
(per N2.1.1) are diagnosed at the correct layer.

The plain `build:app` release does NOT ship DevTools; the feature is only
compiled in when `--features devtools` is passed. `pnpm build:app:debug`
passes the flag through Tauri CLI into cargo.

## SMOKE_DISCIPLINE.md compliance

Phase dispatches from N2.1.1 forward specify user-facing smoke scenarios at
the outermost layer (Finder-launched `.app`, UI interactions, pixel
observations) per `~/Desktop/Projects/jstudio-meta/standards/SMOKE_DISCIPLINE.md`.
CODER's automated smoke is diagnostic; Jose-run user-facing smoke is the
phase-close gate. The `build:app:debug` script exists to support that
observational path without shipping DevTools on in release builds.

## Per-spec invariants

- Rust scope tightly bounded to ARCHITECTURE_SPEC §2.1's five categories (LOC budget ≤150 for N1).
- Business logic is TypeScript, always.
- OSC 133 marker detection is byte-exact `\x1b]133;...` sequences (per OS §24 pattern-matching discipline).
- Per-session isolation is structural (TypeScript-enforced `sessionId`), not runtime-checked.
- Manual-bridge invariant preserved at UI level (OS §14.1).
