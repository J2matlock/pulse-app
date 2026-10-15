#!/bin/bash
# Builds the Q8 app-icon candidates from the SVGs here and the existing artwork.
# Run from the repo root: bash build/icon-candidates/src/make.sh
# Nothing in build/icon*.png or build/icon.ico is touched; the owner picks first.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=src
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# The existing icon has a transparency checkerboard baked into its pixels.
# Cut the mark out: anything dark or coloured stays, light grey goes.
magick ../icon.png -alpha off -colorspace HCL -channel G -separate +channel -evaluate multiply 2 "$TMP/chroma.png"
magick ../icon.png -alpha off -colorspace Gray -negate "$TMP/dark.png"
magick "$TMP/dark.png" "$TMP/chroma.png" -compose Lighten -composite -level 18%,45% "$TMP/mask.png"
magick "$TMP/mask.png" -threshold 50% -morphology Open Disk:3 -morphology Dilate Disk:6 "$TMP/keep.png"
magick "$TMP/mask.png" "$TMP/keep.png" -compose Multiply -composite "$TMP/mask2.png"
BOX=$(magick "$TMP/mask.png" -threshold 50% -morphology Open Disk:3 -format "%@" info:)
magick ../icon.png -alpha off "$TMP/mask2.png" -compose CopyOpacity -composite -crop "$BOX" +repage "$TMP/mark.png"

# Candidate A, big sizes: the full mark on a white rounded tile with a light ring
magick -size 512x512 xc:none -fill white -stroke '#CBD5E1' -strokewidth 10 -draw "roundrectangle 6,6 505,505 112,112" "$TMP/tile-white.png"
magick "$TMP/mark.png" -resize 420x420 "$TMP/mark420.png"
magick "$TMP/tile-white.png" "$TMP/mark420.png" -gravity center -composite "$TMP/A-full-512.png"

# Small sizes come from the line-only glyph
magick -background none -density 384 "$SRC/glyph-light.svg" -resize 512x512 "$TMP/A-glyph-512.png"
magick -background none -density 384 "$SRC/glyph-navy.svg" -resize 512x512 "$TMP/B-512.png"

mkdir -p A-white-tile B-navy-tile
for s in 16 24 32 48 64 128 256 512; do
  if [ "$s" -le 32 ]; then a="$TMP/A-glyph-512.png"; else a="$TMP/A-full-512.png"; fi
  magick "$a" -filter Lanczos -resize ${s}x${s} -strip PNG32:A-white-tile/icon-$s.png
  magick "$TMP/B-512.png" -filter Lanczos -resize ${s}x${s} -strip PNG32:B-navy-tile/icon-$s.png
done
# 32-bit .ico with the frames Windows asks for
for c in A-white-tile B-navy-tile; do
  magick $c/icon-16.png $c/icon-24.png $c/icon-32.png $c/icon-48.png $c/icon-64.png $c/icon-128.png $c/icon-256.png $c/icon.ico
done

# Preview: every size, on a light and a dark strip, 3x so 16 px is visible; the current icon on top for comparison
row() { # $1 dir-or-current $2 bg
  local args=()
  for s in 16 24 32 48 64 128; do
    if [ "$1" = current ]; then f="$TMP/cur-$s.png"; magick ../icon-256.png -resize ${s}x${s} "$f"; else f="$1/icon-$s.png"; fi
    args+=("(" "$f" -background "$2" -gravity center -extent 136x136 -scale 300% ")")
  done
  magick "${args[@]}" +append "$TMP/row-$(basename "$1")-${2//#/}.png"
  echo "$TMP/row-$(basename "$1")-${2//#/}.png"
}
rows=()
for d in current A-white-tile B-navy-tile; do
  rows+=("$(row $d '#F1F5F9')" "$(row $d '#0F172A')")
done
magick "${rows[@]}" -append preview.png
echo "Done: A-white-tile/, B-navy-tile/, preview.png"
