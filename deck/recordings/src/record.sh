#!/usr/bin/env bash
# record.sh <demo-script> <out-basename>: run a demo script in a recorded terminal, then render it to 1920x1080 MP4.
# Needs ffmpeg, uv (for asciinema) and agg (github.com/asciinema/agg) on PATH.
# Nothing is sped up: --idle-time-limit is set high so pauses stay at real length.
set -euo pipefail
SCRIPT="$(realpath "$1")"; OUT="$(realpath -m "$2")"
script -qec "uv tool run --from asciinema asciinema rec -q --overwrite --cols 110 --rows 26 -c 'bash $SCRIPT' '$OUT.cast'" /dev/null >/dev/null
THEME=0f2838,f4f7f7,0f2838,e5534b,34a1a0,eab000,6ab0f3,c792ea,34a1a0,d8e0e2,4a5a66,ff7b72,5fd3d2,ffcc33,9ecbff,d6b3ff,8ff0ef,ffffff
agg --theme "$THEME" --font-size 28 --idle-time-limit 1000 --last-frame-duration 3 "$OUT.cast" "$OUT.gif" >/dev/null 2>&1
ffmpeg -y -loglevel error -i "$OUT.gif" -vf "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0f2838,fps=30,format=yuv420p" -c:v libx264 -crf 20 -preset slow -movflags +faststart "$OUT.mp4"
rm -f "$OUT.gif"
ffprobe -v error -show_entries format=duration,size -show_entries stream=width,height -of csv=p=0 "$OUT.mp4"
