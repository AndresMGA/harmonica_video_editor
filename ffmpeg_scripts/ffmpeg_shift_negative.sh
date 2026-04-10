#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./ffmpeg_shift_negative.sh <shift_ms> <input_path> <output_path>

Shifts only the FC, SL, and SR channels earlier in a 5.1 file.

Arguments:
  shift_ms     Milliseconds to shift FC/SL/SR earlier. Positive and negative
               values are both accepted and treated as the same shift amount.
  input_path   Source media file.
  output_path  Destination media file.
EOF
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

if [ "$#" -ne 3 ]; then
  usage >&2
  exit 1
fi

SHIFT_MS="$1"
INPUT_PATH="$2"
OUTPUT_FILE="$3"

case "$SHIFT_MS" in
  ''|*[!0-9-]*|-*-[0-9]*|--)
    echo "shift_ms must be an integer" >&2
    exit 1
    ;;
esac

if [ ! -f "$INPUT_PATH" ]; then
  echo "Input file not found: $INPUT_PATH" >&2
  exit 1
fi

require_cmd ffmpeg
require_cmd awk

ABS_SHIFT_MS=$(( SHIFT_MS < 0 ? -SHIFT_MS : SHIFT_MS ))
SHIFT_SEC="$(awk -v shift_ms="$ABS_SHIFT_MS" 'BEGIN { printf "%.3f", shift_ms / 1000 }')"

ffmpeg -y -i "$INPUT_PATH" -filter_complex "
[0:a]channelsplit=channel_layout=5.1[FL][FR][FC][LFE][SL][SR];
[FC]atrim=start=${SHIFT_SEC},asetpts=PTS-STARTPTS[FCs];
[SL]atrim=start=${SHIFT_SEC},asetpts=PTS-STARTPTS[SLs];
[SR]atrim=start=${SHIFT_SEC},asetpts=PTS-STARTPTS[SRs];
[FL][FR][FCs][LFE][SLs][SRs]join=inputs=6:channel_layout=5.1[a]
" \
  -map 0:v -map "[a]" \
  -c:v copy -c:a aac -b:a 384k \
  "$OUTPUT_FILE"
