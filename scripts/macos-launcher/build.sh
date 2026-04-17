#!/bin/bash
# Build Commander.app — a macOS desktop launcher bundle.
# Input: repo-relative paths only (no external fetches). Uses macOS
# built-ins by default (sips + iconutil + qlmanage); falls back to
# Homebrew `rsvg-convert` if sips can't rasterize the SVG on this
# macOS version.
# Output: ~/Desktop/Commander.app
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
FAVICON_SVG="$REPO_ROOT/client/public/favicon.svg"
DEST="$HOME/Desktop/Commander.app"
WORK="$(mktemp -d "/tmp/commander-launcher.XXXXXX")"
trap "rm -rf '$WORK'" EXIT

if [ ! -f "$FAVICON_SVG" ]; then
  echo "✗ favicon not found at $FAVICON_SVG" >&2
  exit 1
fi

VERSION="$(/usr/bin/python3 -c "
import json
with open('$REPO_ROOT/server/package.json') as f:
    print(json.load(f).get('version', '0.0.0'))
" 2>/dev/null || echo '0.0.0')"

echo "→ Building Commander.app v$VERSION"

# ── Step 1: rasterize SVG to 1024×1024 PNG ────────────────────────────
PNG_BASE="$WORK/icon_1024.png"

rasterize_via_sips() {
  sips -s format png -z 1024 1024 "$FAVICON_SVG" --out "$PNG_BASE" >/dev/null 2>&1
}

rasterize_via_qlmanage() {
  # qlmanage produces an oversized thumbnail we then size down.
  local tmp="$WORK/ql"
  mkdir -p "$tmp"
  qlmanage -t -s 1024 -o "$tmp" "$FAVICON_SVG" >/dev/null 2>&1
  # qlmanage names the output after the source + .png
  local produced
  produced="$(ls "$tmp"/*.png 2>/dev/null | head -n1)"
  [ -n "$produced" ] && cp "$produced" "$PNG_BASE"
  [ -f "$PNG_BASE" ]
}

rasterize_via_rsvg() {
  if command -v rsvg-convert >/dev/null 2>&1; then
    rsvg-convert -w 1024 -h 1024 "$FAVICON_SVG" -o "$PNG_BASE"
    return 0
  fi
  return 1
}

if rasterize_via_sips; then
  echo "  • rasterized via sips"
elif rasterize_via_qlmanage; then
  echo "  • rasterized via qlmanage (sips declined SVG)"
elif rasterize_via_rsvg; then
  echo "  • rasterized via rsvg-convert"
else
  cat >&2 <<EOF

✗ Couldn't rasterize $FAVICON_SVG to PNG.
  Tried: sips, qlmanage, rsvg-convert.
  Install rsvg-convert via Homebrew to proceed:
    brew install librsvg

EOF
  exit 1
fi

# ── Step 2: iconset with every required size + @2x ───────────────────
ICONSET="$WORK/icon.iconset"
mkdir -p "$ICONSET"

declare -a SIZES=(16 32 128 256 512)
for s in "${SIZES[@]}"; do
  sips -z "$s" "$s" "$PNG_BASE" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s*2))
  sips -z "$d" "$d" "$PNG_BASE" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
echo "  • iconset generated"

# ── Step 3: iconutil → .icns ──────────────────────────────────────────
ICNS="$WORK/icon.icns"
iconutil -c icns "$ICONSET" -o "$ICNS"
echo "  • icon.icns packed"

# ── Step 4: assemble bundle ───────────────────────────────────────────
BUNDLE="$WORK/Commander.app"
mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources"

# Info.plist with version substituted
/usr/bin/sed "s/__VERSION__/$VERSION/g" "$HERE/Info.plist" > "$BUNDLE/Contents/Info.plist"

# Launcher script — named 'launcher' to match CFBundleExecutable
cp "$HERE/launcher.sh" "$BUNDLE/Contents/MacOS/launcher"
chmod +x "$BUNDLE/Contents/MacOS/launcher"

cp "$ICNS" "$BUNDLE/Contents/Resources/icon.icns"

# ── Step 5: install to ~/Desktop ──────────────────────────────────────
rm -rf "$DEST"
cp -R "$BUNDLE" "$DEST"

# Nudge Finder / LaunchServices to refresh the dock/Finder icon cache.
touch "$DEST"
if command -v /System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister >/dev/null 2>&1; then
  /System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister \
    -f "$DEST" >/dev/null 2>&1 || true
fi

echo ""
echo "✓ Commander.app installed at $DEST"
echo "  Double-click it on your desktop to launch Commander."
