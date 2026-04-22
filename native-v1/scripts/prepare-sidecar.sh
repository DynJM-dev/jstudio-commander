#!/usr/bin/env bash
# scripts/prepare-sidecar.sh
#
# Produces a staged sidecar bundle at apps/sidecar/bundle/ that Tauri can
# reference as an externalBin. Per Task 10 of N1 dispatch.
#
# Bundle layout (apps/sidecar/bundle/):
#   sidecar-bin-<triple>          — shell wrapper that execs Node against dist/index.js
#   dist/                          — tsc-compiled JS + sourcemaps
#   node_modules/                  — production deps only
#   package.json                   — sidecar package.json
#   resources/osc133-hook.sh       — bundled zsh hook (symlink or copy)
#
# N1 DEVIATION from dispatch §3 Task 10: "Sidecar → Bun single-executable OR
# pkg-Node binary" — we ship a shell wrapper + dist + pruned node_modules
# instead of a single SEA/pkg binary. Rationale:
#   - Bun was ruled out in Task 1 (node-pty.onData returns zero bytes on
#     macOS arm64).
#   - vercel/pkg is archived; @yao-pkg/pkg + Node SEA both require
#     significant native-module (node-pty, better-sqlite3) bundling work
#     that risks Task 10 schedule.
#   - Shell wrapper + staged node_modules works under Tauri's sidecar
#     model today and is easy to swap for a proper single-exe in N2/N6.
# Documented in PHASE_N1_REPORT §7 (tech debt).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NATIVE_V1_ROOT="$(cd "$HERE/.." && pwd)"
SIDECAR_DIR="$NATIVE_V1_ROOT/apps/sidecar"
BUNDLE_DIR="$SIDECAR_DIR/bundle"

# Target triple — tauri-plugin-shell requires externalBin filenames suffixed
# with the Rust target triple. macOS arm64 is aarch64-apple-darwin.
TARGET_TRIPLE="${JSTUDIO_TAURI_TARGET:-aarch64-apple-darwin}"
WRAPPER_NAME="sidecar-bin-${TARGET_TRIPLE}"

echo "==> prepare-sidecar: target=${TARGET_TRIPLE}"

# Build TypeScript → dist/
( cd "$SIDECAR_DIR" && pnpm build )

# Reset bundle dir
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR"

# Copy artifacts
cp -R "$SIDECAR_DIR/dist" "$BUNDLE_DIR/dist"
cp "$SIDECAR_DIR/package.json" "$BUNDLE_DIR/package.json"

# Copy bundled resources (OSC 133 hook)
mkdir -p "$BUNDLE_DIR/resources"
cp "$NATIVE_V1_ROOT/resources/osc133-hook.sh" "$BUNDLE_DIR/resources/osc133-hook.sh"

# Install production deps into the bundle via `npm install`, not pnpm.
# Rationale: pnpm's symlinked layout (including `pnpm deploy --legacy`) keeps
# transitive deps inside the `.pnpm/` virtual store and top-level packages as
# symlinks into it. Tauri's resource-copy does not follow symlinks (observed
# first-hand during Task 10 bringup — the bundled node_modules/ ended up
# empty). npm produces a flat, fully-copied node_modules tree that copies
# cleanly into Contents/Resources/sidecar/ with no further massaging.
#
# To do this we build the tsc output first (done above), then compute the
# shared + db packages as local file deps and write a tiny "install-only"
# package.json next to the existing bundle dist. npm install runs against
# that file and produces a complete tree.
echo "==> prepare-sidecar: resolving production deps via npm"

# Resolve shared + db to their built dist paths (main: ./dist/index.js in
# their package.json — main was moved in Task 10 to avoid runtime .ts
# resolution). We copy them into the bundle as file: deps so npm can link
# them without reaching back into the pnpm workspace.
rm -rf "$BUNDLE_DIR/.pkgs"
mkdir -p "$BUNDLE_DIR/.pkgs"
rsync -aL "$NATIVE_V1_ROOT/packages/shared/" "$BUNDLE_DIR/.pkgs/shared/" \
  --exclude node_modules --exclude src --exclude tsconfig.tsbuildinfo
rsync -aL "$NATIVE_V1_ROOT/packages/db/" "$BUNDLE_DIR/.pkgs/db/" \
  --exclude node_modules --exclude tsconfig.tsbuildinfo

# Rewrite `workspace:*` → `file:./.pkgs/shared` in the db copy's package.json
# (and similar for shared if it ever picks up a workspace dep). Without this,
# npm fails with EUNSUPPORTEDPROTOCOL.
node -e "
const fs = require('fs');
for (const p of ['$BUNDLE_DIR/.pkgs/db/package.json', '$BUNDLE_DIR/.pkgs/shared/package.json']) {
  try {
    const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const k of Object.keys(pkg.dependencies || {})) {
      if (pkg.dependencies[k] === 'workspace:*') {
        pkg.dependencies[k] = 'file:../' + k.split('/').pop();
      }
    }
    fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
  } catch (e) { /* optional file */ }
}
"

# Write install-only package.json. Versions pinned to the sidecar's own
# declared deps so npm picks an exact resolution.
SIDECAR_PKG="$SIDECAR_DIR/package.json"
node -e "
const pkg = require('$SIDECAR_PKG');
const out = {
  name: 'jstudio-commander-sidecar-bundle',
  version: pkg.version,
  private: true,
  type: 'module',
  main: './dist/index.js',
  dependencies: {
    ...pkg.dependencies,
    '@jstudio-commander/shared': 'file:./.pkgs/shared',
    '@jstudio-commander/db': 'file:./.pkgs/db',
  },
};
require('fs').writeFileSync('$BUNDLE_DIR/package.json', JSON.stringify(out, null, 2) + '\n');
"

# Run npm install in the bundle dir. --omit=dev stays lean; --install-links
# ensures file: deps are copied (not symlinked) into node_modules/.
( cd "$BUNDLE_DIR" && npm install --omit=dev --install-links --no-audit --no-fund --loglevel=error )

# npm's node-pty prebuilds also include non-darwin targets; re-apply prune.
rm -rf "$BUNDLE_DIR/.pkgs"

# Ensure node-pty spawn-helper is executable — pnpm strips the exec bit on
# prebuild extraction (root cause of Task 6 posix_spawnp failure).
find "$BUNDLE_DIR/node_modules" -name spawn-helper -type f -exec chmod 755 {} +

# Prune non-target prebuilds from node-pty (58MB win32 payload would ship
# into a macOS bundle otherwise).
case "$TARGET_TRIPLE" in
  aarch64-apple-darwin) KEEP="darwin-arm64" ;;
  x86_64-apple-darwin)  KEEP="darwin-x64" ;;
  aarch64-pc-windows-msvc) KEEP="win32-arm64" ;;
  x86_64-pc-windows-msvc)  KEEP="win32-x64" ;;
  *) KEEP="" ;;
esac
if [ -n "$KEEP" ]; then
  find "$BUNDLE_DIR/node_modules" -type d -path '*/node-pty/prebuilds/*' -not -name "$KEEP" -not -path "*/$KEEP/*" -exec rm -rf {} + 2>/dev/null || true
fi

# Prune better-sqlite3 C sources and sqlite amalgamation — the compiled
# better_sqlite3.node lives under build/Release/ and is all we need at runtime.
find "$BUNDLE_DIR/node_modules" -type d -path '*/better-sqlite3/deps' -exec rm -rf {} + 2>/dev/null || true
find "$BUNDLE_DIR/node_modules" -type d -path '*/better-sqlite3/src' -exec rm -rf {} + 2>/dev/null || true

# Strip node-pty build artifacts that aren't needed at runtime (source, deps
# C headers, scripts). prebuilds/<target> already contains pty.node +
# spawn-helper.
find "$BUNDLE_DIR/node_modules" -type d -path '*/node-pty/deps' -exec rm -rf {} + 2>/dev/null || true
find "$BUNDLE_DIR/node_modules" -type d -path '*/node-pty/src' -exec rm -rf {} + 2>/dev/null || true
find "$BUNDLE_DIR/node_modules" -type d -path '*/node-pty/third_party' -exec rm -rf {} + 2>/dev/null || true
find "$BUNDLE_DIR/node_modules" -type d -path '*/node-pty/scripts' -exec rm -rf {} + 2>/dev/null || true

# Wrapper script: tauri externalBin executes this as a child process.
# `exec node` replaces the shell so signals (SIGTERM on Cmd+Q) reach Node.
#
# Detection: inside a packaged .app, the wrapper lives at Contents/MacOS/
# and dist+node_modules are bundled into Contents/Resources/sidecar/ via
# tauri.conf.json's bundle.resources map. In dev (running the staged bundle
# directly), everything sits in the same directory. The wrapper tests for
# the Resources layout first and falls back to the local layout.
#
# Node discovery (N2.1 hotfix): Finder-launched macOS apps inherit only
# PATH=/usr/bin:/bin:/usr/sbin:/sbin, so `node` via $PATH fails when the
# user installed Node under NVM / Homebrew / Volta / etc. The wrapper
# walks the common install paths before giving up. If none match, it
# prints a user-facing guidance message to stderr and exits 127 — the
# Rust shell logs that, and the frontend's "Sidecar unreachable" banner
# points at a clear cause.
cat > "$BUNDLE_DIR/$WRAPPER_NAME" <<'WRAPPER_EOF'
#!/usr/bin/env bash
WRAPPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_RESOURCES="$(cd "$WRAPPER_DIR/../Resources/sidecar" 2>/dev/null && pwd || true)"
if [ -n "$APP_RESOURCES" ] && [ -f "$APP_RESOURCES/dist/index.js" ]; then
  SIDECAR_DIR="$APP_RESOURCES"
else
  SIDECAR_DIR="$WRAPPER_DIR"
fi

# Respect an explicit override first — Jose can point at a specific Node
# via the env if he has an unusual layout (and tests can do the same).
if [ -n "$JSTUDIO_NODE_BIN" ] && [ -x "$JSTUDIO_NODE_BIN" ]; then
  NODE_BIN="$JSTUDIO_NODE_BIN"
fi

# Otherwise try PATH (works in dev-terminal launches) ...
if [ -z "$NODE_BIN" ]; then
  if command -v node >/dev/null 2>&1; then
    NODE_BIN="$(command -v node)"
  fi
fi

# ... then walk standard install locations. First match wins.
if [ -z "$NODE_BIN" ]; then
  for candidate in \
    "/opt/homebrew/bin/node" \
    "/usr/local/bin/node" \
    "/opt/local/bin/node" \
    "/usr/local/opt/node/bin/node" \
    "$HOME/.volta/bin/node" \
    "$HOME/.fnm/current/bin/node" \
    "$HOME/n/bin/node"; do
    if [ -x "$candidate" ]; then
      NODE_BIN="$candidate"
      break
    fi
  done
fi

# ... finally probe NVM, picking the highest installed version.
if [ -z "$NODE_BIN" ]; then
  nvm_root="${NVM_DIR:-$HOME/.nvm}"
  if [ -d "$nvm_root/versions/node" ]; then
    latest="$(ls -1 "$nvm_root/versions/node" 2>/dev/null | sort -V | tail -1)"
    if [ -n "$latest" ] && [ -x "$nvm_root/versions/node/$latest/bin/node" ]; then
      NODE_BIN="$nvm_root/versions/node/$latest/bin/node"
    fi
  fi
fi

if [ -z "$NODE_BIN" ]; then
  cat >&2 <<'ERR'
[commander-sidecar] Node >= 22 not found on PATH or standard install locations.
[commander-sidecar] Install via `brew install node` (Apple Silicon) or from
[commander-sidecar] https://nodejs.org/en/download/prebuilt-installer, then
[commander-sidecar] relaunch Commander. (N1 ships with a Node-prereq sidecar —
[commander-sidecar] SEA self-contained sidecar is tracked in PHASE_N2_REPORT §8
[commander-sidecar] for a future phase.)
ERR
  exit 127
fi

export NODE_PATH="$SIDECAR_DIR/node_modules"
exec "$NODE_BIN" "$SIDECAR_DIR/dist/index.js" "$@"
WRAPPER_EOF
chmod 755 "$BUNDLE_DIR/$WRAPPER_NAME"

echo "==> prepare-sidecar: bundle staged at $BUNDLE_DIR"
du -sh "$BUNDLE_DIR"
