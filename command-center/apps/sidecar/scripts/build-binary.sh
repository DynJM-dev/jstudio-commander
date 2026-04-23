#!/usr/bin/env bash
# Build the sidecar as a single static binary suffixed with the Rust host
# target triple — Tauri v2's `externalBin` looks up `<base>-<target>`.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v rustc >/dev/null 2>&1; then
  echo "build-binary: rustc required for target-triple detection" >&2
  exit 1
fi

TARGET=$(rustc -vV | awk '/^host:/{print $2}')
if [[ -z "$TARGET" ]]; then
  echo "build-binary: could not determine host target triple" >&2
  exit 1
fi

mkdir -p bin
OUT="bin/commander-sidecar-${TARGET}"

echo "build-binary: target=${TARGET}"
bun build src/index.ts \
  --compile \
  --outfile "$OUT" \
  --minify

# Symlink the un-suffixed name for local dev convenience + smoke shells.
ln -sf "commander-sidecar-${TARGET}" bin/commander-sidecar

echo "build-binary: produced $OUT"
