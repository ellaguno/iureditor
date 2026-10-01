#!/usr/bin/env bash
# Turns the raw captures into the README media in docs/media/:
# screenshots downscaled to 1600 px and compressed with pngquant, and the
# hero GIF assembled from the frames with an ffmpeg two-pass palette.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=scripts/readme-media/out
for f in docs/media/*-en.png docs/media/*-es.png; do
  [ -f "$f" ] || continue
  w=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$f")
  if [ "$w" -gt 1600 ]; then
    ffmpeg -loglevel error -y -i "$f" -vf "scale=1600:-1:flags=lanczos" "$f.tmp.png" && mv "$f.tmp.png" "$f"
  fi
  pngquant --quality 70-90 --force --skip-if-larger --output "$f" "$f" || true
done
for lang in en es; do
  d=$OUT/gif-$lang
  [ -f "$d/frames.txt" ] || continue
  ffmpeg -loglevel error -y -f concat -safe 0 -i "$d/frames.txt" \
    -vf "fps=15,scale=900:-1:flags=lanczos,palettegen=stats_mode=diff" "$d/palette.png"
  ffmpeg -loglevel error -y -f concat -safe 0 -i "$d/frames.txt" -i "$d/palette.png" \
    -lavfi "fps=15,scale=900:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5" \
    -loop 0 "docs/media/hero-$lang.gif"
done
ls -la docs/media
