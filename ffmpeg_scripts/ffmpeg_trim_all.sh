#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./ffmpeg_trim_all.sh <trim_ms> <input_path> <output_path> [duration_ms]

Trims the start of the whole media file by the given number of milliseconds.
This affects video and all audio channels equally.

Arguments:
  trim_ms      Milliseconds to remove from the start. Positive and negative
               values are both accepted and treated as the same trim amount.
  input_path   Source media file.
  output_path  Destination media file.
  duration_ms  Optional duration to keep after trimming.
EOF
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

if [ "$#" -ne 3 ] && [ "$#" -ne 4 ]; then
  usage >&2
  exit 1
fi

TRIM_MS="$1"
INPUT_PATH="$2"
OUTPUT_FILE="$3"
DURATION_MS="${4:-}"

case "$TRIM_MS" in
  ''|*[!0-9-]*|-*-[0-9]*|--)
    echo "trim_ms must be an integer" >&2
    exit 1
    ;;
esac

if [ ! -f "$INPUT_PATH" ]; then
  echo "Input file not found: $INPUT_PATH" >&2
  exit 1
fi

if [ -n "$DURATION_MS" ]; then
  case "$DURATION_MS" in
    ''|*[!0-9-]*|-*-[0-9]*|--)
      echo "duration_ms must be an integer" >&2
      exit 1
      ;;
  esac
fi

require_cmd ffmpeg
require_cmd awk

ABS_TRIM_MS=$(( TRIM_MS < 0 ? -TRIM_MS : TRIM_MS ))
TRIM_SEC="$(awk -v trim_ms="$ABS_TRIM_MS" 'BEGIN { printf "%.3f", trim_ms / 1000 }')"

if [ -n "$DURATION_MS" ]; then
  ABS_DURATION_MS=$(( DURATION_MS < 0 ? -DURATION_MS : DURATION_MS ))
  DURATION_SEC="$(awk -v duration_ms="$ABS_DURATION_MS" 'BEGIN { printf "%.3f", duration_ms / 1000 }')"

  ffmpeg -y -i "$INPUT_PATH" -filter_complex "
[0:v]trim=start=${TRIM_SEC}:duration=${DURATION_SEC},setpts=PTS-STARTPTS[v];
[0:a]atrim=start=${TRIM_SEC}:duration=${DURATION_SEC},asetpts=PTS-STARTPTS[a]
" \
    -map "[v]" -map "[a]" \
    -c:v libx264 -c:a aac -b:a 384k \
    -avoid_negative_ts make_zero \
    "$OUTPUT_FILE"
else
  ffmpeg -y -i "$INPUT_PATH" -filter_complex "
[0:v]trim=start=${TRIM_SEC},setpts=PTS-STARTPTS[v];
[0:a]atrim=start=${TRIM_SEC},asetpts=PTS-STARTPTS[a]
" \
    -map "[v]" -map "[a]" \
    -c:v libx264 -c:a aac -b:a 384k \
    -avoid_negative_ts make_zero \
    "$OUTPUT_FILE"
fi
