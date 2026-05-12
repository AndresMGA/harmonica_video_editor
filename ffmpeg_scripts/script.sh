#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/ffmpeg_common.sh"

if [[ -f "$PROJECT_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
  set +a
fi

: "${VITE_SUPABASE_URL:?Missing VITE_SUPABASE_URL in .env}"
: "${VITE_SUPABASE_ANON_KEY:?Missing VITE_SUPABASE_ANON_KEY in .env}"
: "${BUCKET:?Missing BUCKET in .env}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

download_object() {
  local object_path="$1"
  local output_path="$2"

  curl -fL \
    -H "apikey: $VITE_SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY" \
    "$VITE_SUPABASE_URL/storage/v1/object/$BUCKET/$object_path" \
    -o "$output_path"
}

upload_object() {
  local object_path="$1"
  local input_path="$2"
  local content_type="$3"

  curl -fL -X POST \
    "$VITE_SUPABASE_URL/storage/v1/object/$BUCKET/$object_path" \
    -H "apikey: $VITE_SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY" \
    -H "x-upsert: true" \
    -H "Content-Type: $content_type" \
    --data-binary "@$input_path"
}

usage() {
  cat <<'EOF'
Usage: ./ffmpeg_scripts/script.sh <delay_ms> <bucket_video_path> [end_cut_ms]

Arguments:
  delay_ms          Positive: shift FC/SL/SR later, then trim delay_ms from
                    the start of all audio/video.
                    Negative: prepend blank video, then shift FL/FR later.
  bucket_video_path Object path in the Supabase bucket, or a full public
                    Supabase storage URL, for example:
                    exercises/foo/bar/video.mp4
                    https://.../storage/v1/object/public/<bucket>/exercises/foo/bar/video.mp4
  duration_ms        Optional duration in milliseconds for the output file. Output keeps media from delay_ms to delay_ms + duration_ms.

Behavior:
  1. Downloads the source video from Supabase storage.
  2. Uploads a sibling backup as BKP_video.mp4.
  3. Runs the helper scripts according to the sign of delay_ms.
  4. Trims the final file when delay_ms is positive.
  5. Saves the processed result locally as tst.mp4.
  6. Uploads the processed result back over the original object path.
EOF
}

require_cmd curl
require_cmd "$FFMPEG_BIN"
require_cmd awk
require_cmd sed

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  usage >&2
  exit 1
fi

DELAY_MS="$1"
INPUT_PATH="$2"
DURATION_MS="${3:-}"

WORK_DIR="$(mktemp -d)"
INPUT_FILE="$WORK_DIR/input.mp4"
PASS1_FILE="$WORK_DIR/pass1.mp4"
SHIFTED_FILE="$WORK_DIR/shifted.mp4"
OUTPUT_FILE="$WORK_DIR/output.mp4"
LOCAL_OUTPUT="$PROJECT_ROOT/tst.mp4"
ABS_DELAY_MS=$(( DELAY_MS < 0 ? -DELAY_MS : DELAY_MS ))
START_SEC="$(awk -v delay_ms="$DELAY_MS" 'BEGIN { printf "%.3f", delay_ms / 1000 }')"
FC_SL_SR_SHIFT_SCRIPT="$SCRIPT_DIR/ffmpeg_shift_positive_FC_SL_SR.sh"
FL_FR_SHIFT_SCRIPT="$SCRIPT_DIR/ffmpeg_shift_positive_FL_FR.sh"
PREPEND_SCRIPT="$SCRIPT_DIR/ffmpeg_prepend_blank.sh"
TRIM_ALL_SCRIPT="$SCRIPT_DIR/ffmpeg_trim_all.sh"
require_cmd "$FC_SL_SR_SHIFT_SCRIPT"
require_cmd "$FL_FR_SHIFT_SCRIPT"
require_cmd "$PREPEND_SCRIPT"
require_cmd "$TRIM_ALL_SCRIPT"

normalize_object_path() {
  local input_path="$1"
  local public_prefix="$VITE_SUPABASE_URL/storage/v1/object/public/$BUCKET/"
  local private_prefix="$VITE_SUPABASE_URL/storage/v1/object/$BUCKET/"

  if [[ "$input_path" == "$public_prefix"* ]]; then
    printf '%s\n' "${input_path#$public_prefix}"
    return
  fi

  if [[ "$input_path" == "$private_prefix"* ]]; then
    printf '%s\n' "${input_path#$private_prefix}"
    return
  fi

  printf '%s\n' "$input_path" | sed 's#^/*##'
}

OBJECT_PATH="$(normalize_object_path "$INPUT_PATH")"
OBJECT_DIR="$(dirname "$OBJECT_PATH")"
BACKUP_PATH="$OBJECT_DIR/BKP_video.mp4"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

echo "Downloading $OBJECT_PATH"
download_object "$OBJECT_PATH" "$INPUT_FILE"

echo "Uploading backup to $BACKUP_PATH"
upload_object "$BACKUP_PATH" "$INPUT_FILE" "video/mp4"

echo "Pass 1/2"
if [ "$DELAY_MS" -ge 0 ]; then
  "$FC_SL_SR_SHIFT_SCRIPT" "$DELAY_MS" "$INPUT_FILE" "$PASS1_FILE"
else
  "$PREPEND_SCRIPT" "$ABS_DELAY_MS" "$INPUT_FILE" "$PASS1_FILE"
fi

echo "Pass 2/2"
if [ "$DELAY_MS" -ge 0 ]; then
  if [ -n "$DURATION_MS" ]; then
    DURATION_SEC="$(awk -v duration_ms="$DURATION_MS" 'BEGIN { printf "%.3f", duration_ms / 1000 }')"

    if awk "BEGIN { exit !(${DURATION_SEC} <= 0) }"; then
      echo "Error: duration_ms must be a positive integer" >&2
      exit 1
    fi

    "$TRIM_ALL_SCRIPT" "$DELAY_MS" "$PASS1_FILE" "$OUTPUT_FILE" "$DURATION_MS"
  else
    "$TRIM_ALL_SCRIPT" "$DELAY_MS" "$PASS1_FILE" "$OUTPUT_FILE"
  fi
else
  "$FL_FR_SHIFT_SCRIPT" "$DELAY_MS" "$PASS1_FILE" "$SHIFTED_FILE"

  if [ -n "$DURATION_MS" ]; then
    DURATION_SEC="$(awk -v duration_ms="$DURATION_MS" 'BEGIN { printf "%.3f", duration_ms / 1000 }')"

    if awk "BEGIN { exit !(${DURATION_SEC} <= 0) }"; then
      echo "Error: end_cut_ms must be greater than delay_ms" >&2
      exit 1
    fi

    "$FFMPEG_BIN" -y -i "$SHIFTED_FILE" -t "$DURATION_SEC" \
      -map 0:v -map 0:a -c:v copy -c:a copy \
      -avoid_negative_ts make_zero "$OUTPUT_FILE"
  else
    cp "$SHIFTED_FILE" "$OUTPUT_FILE"
  fi
fi

cp "$OUTPUT_FILE" "$LOCAL_OUTPUT"
echo "Saved local copy to $LOCAL_OUTPUT"

echo "Uploading processed video to $OBJECT_PATH"
upload_object "$OBJECT_PATH" "$OUTPUT_FILE" "video/mp4"

echo "Done"
