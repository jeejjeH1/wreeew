#!/usr/bin/env bash
# Full pipeline: soundtrack + 4 parallel video segments -> genlayer_disputes.mp4
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p out
python3 -m http.server 8765 --bind 127.0.0.1 >/dev/null 2>&1 & SRV=$!
trap 'kill $SRV' EXIT
sleep 1
node render.mjs --cues out/cues.json
python3 audio.py out/cues.json soundtrack.wav
TOTAL=$((72*60)); WORKERS=${WORKERS:-4}; CH=$(( (TOTAL + WORKERS - 1) / WORKERS ))
: > out/list.txt
for i in $(seq 0 $((WORKERS-1))); do
  S=$((i*CH)); E=$(( (i+1)*CH < TOTAL ? (i+1)*CH : TOTAL ))
  node render.mjs $S $E out/seg$i.mp4 &
  echo "file 'seg$i.mp4'" >> out/list.txt
done
wait
ffmpeg -y -loglevel error -f concat -safe 0 -i out/list.txt -i soundtrack.wav -c:v copy -c:a aac -b:a 256k -ar 44100 -shortest -movflags +faststart genlayer_disputes.mp4
ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height,r_frame_rate genlayer_disputes.mp4
