#!/usr/bin/env bash
# Regenerate PWA icons and OG image from kcal-logo-blue.png.
# See CLAUDE.md "PWA / installability" for design rationale.
set -euo pipefail

cd "$(dirname "$0")/.."

SRC="kcal-logo-blue.png"
OUT="public"
BG="#1d2021"

[[ -f "$SRC" ]] || { echo "Source not found: $SRC" >&2; exit 1; }
command -v convert >/dev/null || { echo "ImageMagick 'convert' not found" >&2; exit 1; }

# Transparent icons (manifest "purpose: any" keeps the rounded-corner alpha).
convert "$SRC" -resize 192x192 -strip "$OUT/icon-192.png"
convert "$SRC" -resize 512x512 -strip "$OUT/icon-512.png"
convert "$SRC" -resize  32x32  -strip "$OUT/favicon.png"

# Flattened icons (maskable + iOS — full-bleed dark, no alpha at the edges).
convert "$SRC" -resize 512x512 -background "$BG" -flatten -strip "$OUT/icon-512-maskable.png"
convert "$SRC" -resize 180x180 -background "$BG" -flatten -strip "$OUT/apple-touch-icon.png"

# OG card: 1200x630 dark canvas with the logo centered at 360x360.
convert -size 1200x630 "xc:$BG" \( "$SRC" -resize 360x360 \) -gravity center -composite -strip "$OUT/og-image.png"

echo "Regenerated 6 icons in $OUT/ from $SRC"
