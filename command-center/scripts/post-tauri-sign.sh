#!/usr/bin/env bash
# Post-`tauri build` ad-hoc codesign pass.
#
# Why this exists: Tauri v2 with `signingIdentity: null` + the Bun-workspace
# `bun run build:app` pipeline does NOT run a bundle-level codesign pass
# (PHASE_N1_REPORT §3.3). The linker injects an ad-hoc Mach-O signature on
# `commander-shell` that claims resources exist, but without `codesign
# --force --deep --sign - "$APP"` the bundle never gets
# `Contents/_CodeSignature/CodeResources`. macOS Sequoia + Apple Silicon's
# strict verification silently rejects launch on the inconsistent state.
#
# This script closes that gap. D5 indefinite defer (Developer-ID signing +
# notarization) remains; this is ad-hoc local-only signing for dev + personal
# distribution.
#
# Tech debt: root-causing why Tauri v2's `signingIdentity: null` path doesn't
# auto-run bundle codesign is filed as N7 hardening per N1.1 dispatch §3.

set -euo pipefail

# Compute the macOS bundle path from our known Tauri output layout.
MONOREPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE_DIR="${MONOREPO_ROOT}/apps/shell/src-tauri/target/release/bundle/macos"

if [[ ! -d "$BUNDLE_DIR" ]]; then
  echo "post-tauri-sign: expected bundle dir does not exist — run 'bun --filter @commander/shell tauri:build' first" >&2
  echo "  expected: $BUNDLE_DIR" >&2
  exit 1
fi

# Pick up whichever .app Tauri produced — productName drives the filename
# (e.g. "Command Center.app"). One .app per build; glob tolerates the rename.
shopt -s nullglob
APPS=( "$BUNDLE_DIR"/*.app )
shopt -u nullglob

if [[ ${#APPS[@]} -eq 0 ]]; then
  echo "post-tauri-sign: no .app bundle in $BUNDLE_DIR" >&2
  exit 1
fi
if [[ ${#APPS[@]} -gt 1 ]]; then
  echo "post-tauri-sign: multiple .app bundles in $BUNDLE_DIR — expected exactly one" >&2
  printf '  %s\n' "${APPS[@]}" >&2
  exit 1
fi

APP="${APPS[0]}"
echo "post-tauri-sign: target = $APP"

# Ad-hoc sign the bundle. --deep signs every nested Mach-O (the embedded
# commander-sidecar binary too). --force re-signs if a partial signature is
# already present (subsequent builds). -s - picks the ad-hoc identity.
codesign --force --deep --sign - "$APP"

# Verification gates per dispatch §2 T1 acceptance.

RES_FILE="$APP/Contents/_CodeSignature/CodeResources"
if [[ ! -s "$RES_FILE" ]]; then
  echo "post-tauri-sign: FAIL — $RES_FILE missing or empty after codesign" >&2
  exit 2
fi
echo "post-tauri-sign: OK — CodeResources exists ($(wc -c < "$RES_FILE" | tr -d ' ') bytes)"

# spctl returns non-zero on Gatekeeper reject; --assess on an unsigned
# (ad-hoc) bundle is expected to print "rejected" with "Unnotarized
# Developer ID" BUT should no longer carry the "code has no resources but
# signature indicates they must be present" error. We can't assert clean
# exit without Developer-ID signing, so we grep for the specific malformed-
# bundle message.
SPCTL_OUT=$(spctl -a -vvv "$APP" 2>&1 || true)
echo "post-tauri-sign: spctl output:"
echo "$SPCTL_OUT" | sed 's/^/  /'
if grep -q "code has no resources but signature indicates they must be present" <<< "$SPCTL_OUT"; then
  echo "post-tauri-sign: FAIL — spctl still reports malformed bundle (resources/signature mismatch)" >&2
  exit 3
fi

# codesign -dv must show non-zero sealed-resource hashes. N1 build had
# "CodeDirectory hashes=1169+0" — the "+0" means zero sealed resources.
DV_OUT=$(codesign -dv --verbose=4 "$APP" 2>&1)
if ! grep -qE 'hashes=[0-9]+\+[1-9][0-9]*' <<< "$DV_OUT"; then
  echo "post-tauri-sign: FAIL — codesign -dv reports zero sealed resource hashes" >&2
  echo "$DV_OUT" | sed 's/^/  /' >&2
  exit 4
fi

HASHES_LINE=$(grep -E 'CodeDirectory' <<< "$DV_OUT" | head -1)
echo "post-tauri-sign: OK — $HASHES_LINE"
echo "post-tauri-sign: bundle is ad-hoc-signed + launchable (no Developer-ID notarization)"
