# App icon

`glyph-navy.svg` is the source of the app icon (a pulse line on a navy rounded tile), chosen by the owner on 2026-10-15. To rebuild after editing it:

```
magick -background none -density 768 build/icon-src/glyph-navy.svg -resize 1024x1024 -strip PNG32:build/icon.png
for s in 256 512; do magick build/icon.png -filter Lanczos -resize ${s}x${s} -strip PNG32:build/icon-$s.png; done
magick build/icon.png -define icon:auto-resize=256,128,64,48,32,24,16 build/icon.ico
```

The in-app mark on the lock, setup and About screens is a separate image (`src/renderer/components/ui/PulseMark.tsx`).
