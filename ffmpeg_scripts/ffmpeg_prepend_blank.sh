#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./ffmpeg_prepend_blank.sh <prepend_ms> <input_path> <output_path>

Prepends blank video to the start of a file while copying audio unchanged.

Arguments:
  prepend_ms   Milliseconds of blank video to add at the start. Must be >= 0.
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

PREPEND_MS="$1"
INPUT_PATH="$2"
OUTPUT_FILE="$3"

case "$PREPEND_MS" in
  ''|*[!0-9]*)
    echo "prepend_ms must be a non-negative integer" >&2
    exit 1
    ;;
esac

if [ ! -f "$INPUT_PATH" ]; then
  echo "Input file not found: $INPUT_PATH" >&2
  exit 1
fi

require_cmd ffmpeg
require_cmd awk

PREPEND_SEC="$(awk -v prepend_ms="$PREPEND_MS" 'BEGIN { printf "%.3f", prepend_ms / 1000 }')"

ffmpeg -y -i "$INPUT_PATH" \
  -filter:v "tpad=start_duration=${PREPEND_SEC}:start_mode=add:color=black,setpts=PTS-STARTPTS" \
  -map 0:v -map 0:a \
  -c:v libx264 -c:a copy \
  -avoid_negative_ts make_zero \
  "$OUTPUT_FILE"
