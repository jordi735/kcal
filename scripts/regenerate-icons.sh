#!/usr/bin/env bash
# Regenerate PWA icons and OG image from kcal-logo-blue.png.
# See AGENTS.md "PWA and Generated Assets" for design rationale.
set -euo pipefail

cd "$(dirname "$0")/.."

SRC="kcal-logo-blue.png"
OUT="public"
BG="#000000"

[[ -f "$SRC" ]] || { echo "Source not found: $SRC" >&2; exit 1; }
command -v convert >/dev/null || { echo "ImageMagick 'convert' not found" >&2; exit 1; }

# Map the original palette to Carbon OLED before resizing. This affine RGB
# transform maps #1d2021 -> #000000, #fbf1c7 -> #e6e9ee, #83a598 -> #78b7ff.
# It projects colors onto the two source-color vectors relative to #1d2021,
# then applies the target vectors, preserving antialiased color transitions.
# ImageMagick's 6x6 matrix uses R/G/B/black/alpha/offset; leave alpha unchanged.
CARBON_MATRIX="
  0.701739949880  0.284029658231 0.089467063592 0 0 -0.127026747876
 -0.512974953927  0.793082854619 1.091121223834 0 0 -0.182389717923
 -1.880092973015  1.370054401010 2.223128133725 0 0 -0.245812835403
  0 0 0 1 0 0
  0 0 0 0 1 0
  0 0 0 0 0 1"
CARBON_SRC="$(mktemp "${TMPDIR:-/tmp}/kcal-carbon-logo.XXXXXX.miff")"
trap 'rm -f "$CARBON_SRC"' EXIT
convert "$SRC" -color-matrix "$CARBON_MATRIX" "$CARBON_SRC"

# Transparent icons (manifest "purpose: any" keeps the rounded-corner alpha).
convert "$CARBON_SRC" -resize 192x192 -strip "$OUT/icon-192.png"
convert "$CARBON_SRC" -resize 512x512 -strip "$OUT/icon-512.png"
convert "$CARBON_SRC" -resize  32x32  -strip "$OUT/favicon.png"

# Flattened icons (maskable + iOS — full-bleed dark, no alpha at the edges).
convert "$CARBON_SRC" -resize 512x512 -background "$BG" -flatten -strip "$OUT/icon-512-maskable.png"
convert "$CARBON_SRC" -resize 180x180 -background "$BG" -flatten -strip "$OUT/apple-touch-icon.png"

# OG card: 1200x630 dark canvas with the logo centered at 360x360.
convert -size 1200x630 "xc:$BG" \( "$CARBON_SRC" -resize 360x360 \) -gravity center -composite -strip "$OUT/og-image.png"

echo "Regenerated 6 icons in $OUT/ from $SRC"
