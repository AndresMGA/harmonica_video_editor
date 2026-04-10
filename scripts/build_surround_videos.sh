#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/output_files"
MSCORE_BIN="/home/andres/MuseScore4.3/MuseScore/builds/Linux-Qt-usr-Make-Release/install/bin/mscore"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
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

require_cmd curl
require_cmd ffmpeg
require_cmd ffprobe

if [[ ! -x "$MSCORE_BIN" ]]; then
  echo "MuseScore binary not found: $MSCORE_BIN" >&2
  exit 1
fi

usage() {
  cat <<'EOF'
Usage: scripts/build_surround_videos.sh exercise/path [...]

Downloads song.mscz and video.mp4 from each exercise path in Supabase storage,
renders MuseScore audio assets, creates a 5.1 video.mp4, and uploads it back
to the same storage path.
EOF
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

clear_output_dir() {
  mkdir -p "$OUTPUT_DIR"
  find "$OUTPUT_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
}

ensure_audio_stream() {
  local video_path="$1"
  ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of csv=p=0 "$video_path" | grep -q '^audio$'
}

build_surround_video() {
  local source_video="$1"
  local metronome_audio="$2"
  local accompaniment_audio="$3"
  local destination_video="$4"

  if [[ -n "$accompaniment_audio" ]]; then
    ffmpeg -y \
      -i "$source_video" \
      -i "$metronome_audio" \
      -i "$accompaniment_audio" \
      -filter_complex "\
[0:a]aformat=channel_layouts=stereo,aresample=48000,channelsplit=channel_layout=stereo[orig_l][orig_r];\
[orig_l]apad[fl];\
[orig_r]apad[fr];\
[1:a]pan=mono|c0=c0,aresample=48000,apad[fc];\
anullsrc=channel_layout=mono:sample_rate=48000,apad[lfe];\
[2:a]aformat=channel_layouts=stereo,aresample=48000,channelsplit=channel_layout=stereo[rear_l_src][rear_r_src];\
[rear_l_src]apad[bl];\
[rear_r_src]apad[br];\
[fl][fr][fc][lfe][bl][br]join=inputs=6:channel_layout=5.1[aout]" \
      -map 0:v:0 \
      -map "[aout]" \
      -c:v copy \
      -c:a aac \
      -b:a 384k \
      -movflags +faststart \
      -shortest \
      "$destination_video"
  else
    ffmpeg -y \
      -i "$source_video" \
      -i "$metronome_audio" \
      -filter_complex "\
[0:a]aformat=channel_layouts=stereo,aresample=48000,channelsplit=channel_layout=stereo[orig_l][orig_r];\
[orig_l]apad[fl];\
[orig_r]apad[fr];\
[1:a]pan=mono|c0=c0,aresample=48000,apad[fc];\
anullsrc=channel_layout=mono:sample_rate=48000,apad[lfe];\
anullsrc=channel_layout=mono:sample_rate=48000,apad[bl];\
anullsrc=channel_layout=mono:sample_rate=48000,apad[br];\
[fl][fr][fc][lfe][bl][br]join=inputs=6:channel_layout=5.1[aout]" \
      -map 0:v:0 \
      -map "[aout]" \
      -c:v copy \
      -c:a aac \
      -b:a 384k \
      -movflags +faststart \
      -shortest \
      "$destination_video"
  fi
}

process_exercise() {
  local exercise_path="$1"
  local source_song="$OUTPUT_DIR/song.mscz"
  local source_video="$OUTPUT_DIR/source_video.mp4"
  local metronome_audio="$OUTPUT_DIR/metronome.mp3"
  local accompaniment_audio="$OUTPUT_DIR/accompaniment.mp3"
  local output_video="$OUTPUT_DIR/video.mp4"

  echo "Processing $exercise_path"
  clear_output_dir

  download_object "$exercise_path/song.mscz" "$source_song"
  download_object "$exercise_path/video.mp4" "$source_video"

  ensure_audio_stream "$source_video" || {
    echo "Source video has no audio stream: $exercise_path/video.mp4" >&2
    exit 1
  }

  QT_QPA_PLATFORM=offscreen "$MSCORE_BIN" chromatic 100 "$OUTPUT_DIR" audio

  if [[ ! -f "$metronome_audio" ]]; then
    echo "MuseScore did not create metronome.mp3 for $exercise_path" >&2
    exit 1
  fi

  local accompaniment_input=""
  if [[ -f "$accompaniment_audio" ]]; then
    accompaniment_input="$accompaniment_audio"
  fi

  build_surround_video "$source_video" "$metronome_audio" "$accompaniment_input" "$output_video"
  upload_object "$exercise_path/video.mp4" "$output_video" "video/mp4"
  echo "Uploaded $exercise_path/video.mp4"
}

if [[ "$#" -eq 0 ]]; then
  usage >&2
  exit 1
fi

for exercise_path in "$@"; do
  process_exercise "$exercise_path"
done
