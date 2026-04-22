# N1 Task 1 — Bun Verification Spike: Result

**Date:** 2026-04-22
**Spike dir:** `~/tmp/bun-verification/`
**Dispatch:** `N1_DISPATCH_NATIVE_V1_FOUNDATION.md` Task 1
**Host:** macOS 25.3.0 (Darwin), arm64, Xcode CLT 16.3

## TL;DR

- **Bun:** FAIL — `node-pty.onData` never fires under Bun 1.3.13.
- **Node 22 (standalone):** PASS 7/7 assertions.
- **Node + `@yao-pkg/pkg` bundle:** node-pty `posix_spawnp` fails; vanilla `child_process.spawn` works. pkg + node-pty has a native-addon incompatibility that needs deeper work in Task 10.

**Decision:** Sidecar runtime is **Node 22 LTS**. Dev mode runs sidecar via direct `node` invocation. Production single-exec bundling is deferred to Task 10 (filed as PM question in PHASE_REPORT §8).

## Smoke assertions

7 checks in `smoke-cjs.cjs` / `smoke.ts`:

1. `node-pty` spawn `/bin/zsh -c 'echo HELLO_FROM_PTY && exit 0'`
2. `node-pty` reads "HELLO_FROM_PTY" from `onData`
3. `better-sqlite3` open DB
4. `better-sqlite3` CREATE TABLE
5. `better-sqlite3` INSERT x2
6. `better-sqlite3` SELECT (verify rows)
7. `better-sqlite3` close

## Results table

| Runtime                        | node-pty spawn | node-pty onData | better-sqlite3 | Overall |
| ------------------------------ | -------------- | --------------- | -------------- | ------- |
| Bun 1.3.13 (smoke.ts)          | PASS¹          | FAIL (0 bytes)  | n/a (aborted)  | FAIL    |
| Node 22.17 (smoke-cjs.cjs)     | PASS           | PASS (16 bytes) | PASS           | 7/7     |
| Node 22.22 via pkg binary      | FAIL²          | n/a             | n/a (aborted)  | FAIL    |
| Control: vanilla `child_process.spawn` inside pkg binary | PASS | PASS | n/a | PASS |

¹ After rebuilding node-pty native addon via `node-gyp rebuild`. Initial Bun install left the addon unbuilt (postinstall skipped).
² `posix_spawnp failed` even with `spawn-helper` extracted to `/tmp`, chmod 0755, xattr cleared, valid codesign. Vanilla `child_process.spawn('/bin/zsh', ...)` succeeds in the same pkg binary → issue is node-pty-specific.

## Bun failure detail

Under Bun 1.3.13, `node-pty@1.1.0`'s `pty.onData` handler never fires. The pty process spawns successfully, reaches completion (`exitCode=0`), and exits — but zero bytes are ever delivered to JavaScript. Under Node with identical code, 16 bytes arrive.

Root cause is Bun's N-API/libuv compatibility layer for node-pty's kevent-based data read loop. This is a documented class of Bun ↔ Node-native-addon gap (as of Bun 1.3.x). pty data streaming is THE core mechanism of Commander v1 — xterm.js rendering, OSC 133 marker parsing, and Claude Code observation all ride on pty.onData. No data = no Commander. Architectural reject.

## pkg + node-pty failure detail

Inside an `@yao-pkg/pkg` v6.18.1 single-exec bundle, `pty.fork()` → `posix_spawnp` fails with the generic "posix_spawnp failed" error. Tried workarounds:

1. Extract `spawn-helper` from pkg snapshot to `/tmp` with `fs.copyFileSync` → binary is executable standalone, still fails under node-pty.
2. `chmod 0755` on extracted path → no effect.
3. `xattr -c` to clear `com.apple.provenance` attribute → no effect.
4. `codesign -vv` verifies the extracted helper is valid and satisfies its Designated Requirement.

Control: vanilla `child_process.spawn('/bin/zsh', ['-c', 'echo ...'])` inside the same pkg binary returns exit 0 with correct output. So pkg's process-spawn plumbing works; the failure is specific to node-pty's native code path through `posix_spawnp`.

Likely root cause: node-pty's compiled native addon (`pty.node`), when loaded from pkg's virtual filesystem snapshot, has dyld or entitlement context that the child process cannot inherit for exec. Deeper debugging would require `dtruss` (needs root + SIP) or custom patches to node-pty's native code.

## Production bundling path (Task 10)

Three viable options, to be evaluated in Task 10:

1. **Node SEA (Single Executable Application)** — Node 20+ built-in feature. Different asset model than pkg. Worth a second spike before falling back to pkg patches.
2. **Patched `@yao-pkg/pkg` with native-addon extraction** — involves modifying pkg's snapshot handling OR forking node-pty to use a different exec primitive.
3. **Tauri-bundled-runtime directory** — ship Node binary + `apps/sidecar/dist/*.js` + `node_modules/` trimmed to essentials, launched by Tauri as a sidecar directory. Larger bundle but known-working.

Recommendation: try Node SEA first in Task 10. If SEA also fails, option 3.

## Dev mode plan for Tasks 2–9

Sidecar runs as `node apps/sidecar/src/index.ts` (via `tsx` or equivalent TS loader) during development. Tauri's `tauri-plugin-shell` points the sidecar binary at the node entry in dev; the production bundling flip happens in Task 10.

## Package manager decision

Bun out as runtime → **pnpm workspaces** (already used in the parent `jstudio-commander` repo). Turborepo on top per dispatch §2.

## Files in this spike dir

- `package.json` — deps + pkg config.
- `smoke.ts` — original Bun-targeted TS smoke (ESM).
- `smoke-cjs.cjs` — CJS equivalent for pkg bundling; includes pkg helperPath extraction.
- `smoke-bun-persistent.ts` — secondary Bun probe with persistent pty + sleep to rule out immediate-exit event race.
- `dist/smoke-pkg` — pkg-built binary (137 MB; pkg's base Node binary).
- `RESULT.md` — this file.

## References

- ARCHITECTURE_SPEC v1.2 §2.1 (runtime decision + Bun-pass-or-pkg-Node-fallback).
- Dispatch §3 Task 1 acceptance.
