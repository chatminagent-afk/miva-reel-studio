#!/bin/bash
# Render final reel-edit: build_html -> check -> PNG sequence -> mix -> MP4 -> contact sheet + laporan level.
#   bash render.sh <folder_proyek> <nama> [--wa]
# --wa  : juga buat <nama>-wa.mp4 (crf 23, ±13 MB per 30 dtk) untuk dikirim lewat Kirimi.
# Kenapa PNG sequence: encoder MP4 HyperFrames 0.8.84 di Windows menghitamkan 8 kolom kanan (gotcha miva-motion).
set -e
PROJ="$1"; NAME="$2"; WA="$3"
[ -z "$NAME" ] && { echo "pakai: bash render.sh <folder_proyek> <nama> [--wa]"; exit 1; }
HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
export PATH="/d/Documents/Claude Cowork/MIVA/reels/motion/_tools/node:$PATH"
export PYTHONIOENCODING=utf-8
cd "$PROJ"
python "$HERE/build_html.py" . > /dev/null
npx.cmd --yes hyperframes@0.8.84 check
rm -rf renders/_frames
npx.cmd --yes hyperframes@0.8.84 render --format png-sequence -o renders/_frames --workers 5 --quiet
python "$HERE/mix.py" .
ffmpeg -v error -y -framerate 30 -start_number 1 -i "renders/_frames/frame_%06d.png" -i renders/_mix.wav \
  -map 0:v -map 1:a -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 192k -shortest "renders/$NAME.mp4"
ffmpeg -v error -y -i "renders/$NAME.mp4" -vf "fps=1,scale=216:-1,tile=9x4" -frames:v 1 "renders/_verify-$NAME.png"
if [ "$WA" = "--wa" ]; then
  ffmpeg -v error -y -i "renders/$NAME.mp4" -c:v libx264 -preset slow -crf 23 -maxrate 4M -bufsize 8M -pix_fmt yuv420p \
    -movflags +faststart -c:a aac -b:a 128k "renders/$NAME-wa.mp4"
fi
rm -rf renders/_frames
ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height -of compact "renders/$NAME.mp4"
echo "SELESAI $PROJ/renders/$NAME.mp4  (lihat renders/_verify-$NAME.png)"
