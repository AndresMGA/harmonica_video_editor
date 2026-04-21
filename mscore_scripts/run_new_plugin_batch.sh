#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/portable_common.sh"

plugin_source="$SCRIPT_DIR/new.qml"
plugin_target="/home/andres/Documents/MuseScore4/Plugins/new.qml"

if [ ! -f "$plugin_source" ]; then
    echo "plugin source not found: $plugin_source" >&2
    exit 1
fi

mkdir -p "$(dirname "$plugin_target")"
cp "$plugin_source" "$plugin_target"
echo "installed MuseScore plugin: $plugin_target"

if [ "$#" -ne 8 ]; then
    echo "usage: $0 INPUT_SCORE EXISTING_VIDEO NHOLES UPDATE_JSON UPDATE_SVG UPDATE_HARMONICA UPDATE_ACCOMPANIMENT UPDATE_METRONOME" >&2
    exit 1
fi

input_score=$1
existing_video=$2
nholes=$3
update_json=$4
update_svg=$5
update_harmonica=$6
update_accompaniment=$7
update_metronome=$8

case "$nholes" in
    10|12)
        ;;
    *)
        echo "unsupported NHOLES: $nholes (expected 10 or 12)" >&2
        exit 1
        ;;
esac

for flag in \
    "$update_json" \
    "$update_svg" \
    "$update_harmonica" \
    "$update_accompaniment" \
    "$update_metronome"
do
    case "$flag" in
        true|false)
            ;;
        *)
            echo "invalid boolean flag: $flag (expected true or false)" >&2
            exit 1
            ;;
    esac
done

if [ ! -f "$input_score" ]; then
    echo "input score not found: $input_score" >&2
    exit 1
fi

if [[ "$input_score" != /* ]]; then
    input_score="$(cd "$(dirname "$input_score")" && pwd)/$(basename "$input_score")"
fi

tmp_dir="$HOME/harmonica_video_editor/tmp"
job_json="$SCRIPT_DIR/job.json"
status_json="$SCRIPT_DIR/status.json"
musescore_cmd="$(find_musescore_cmd)"
song_with_tabs="$tmp_dir/song_with_tabs.mscz"

mkdir -p "$tmp_dir"

echo "preparing job.json for $input_score"

cat > "$job_json" <<JOBEOF
[
  {
    "in": "$input_score",
    "out": "$song_with_tabs"
  },
  {
    "in": "$input_score",
    "out": "$tmp_dir/positions.spos"
  },
  {
    "in": "$input_score",
    "out": "$tmp_dir/countInAndMetronome.mid"
  }
]
JOBEOF

echo "writing status.json"
cat > "$status_json" <<STATUSEOF
{
  "nHoles": $nholes,
  "jobsDone": 0,
  "countInOffset": 0,
  "updateJson": $update_json,
  "updateSvg": $update_svg,
  "updateHarmonica": $update_harmonica,
  "updateAccompaniment": $update_accompaniment,
  "updateMetronome": $update_metronome
}
STATUSEOF

echo "calling musescore batch export"
"$musescore_cmd" -j "$job_json" --extension musescore://extensions/v1/new.qml
echo "musescore batch export completed"
echo "song_with_tabs.mscz generated at $song_with_tabs"
echo "events.json generated at $tmp_dir/events.json"
echo "positions.spos generated at $tmp_dir/positions.spos"
echo "countInAndMetronome.mid generated at $tmp_dir/countInAndMetronome.mid"

if [ "$update_svg" = true ]; then
    echo "clearing previous score*.svg outputs"
    rm -f "$tmp_dir"/score.svg "$tmp_dir"/score-*.svg
    echo "exporting multi-page SVG from song_with_tabs.mscz"
    "$musescore_cmd" "$song_with_tabs" -o "$tmp_dir/score.svg"
    echo "svg export completed"
    if ls "$tmp_dir"/score*.svg >/dev/null 2>&1; then
        echo "generated SVG files:"
        ls -1 "$tmp_dir"/score*.svg
    fi
fi

if [ "$update_harmonica" = false ] && [ "$update_accompaniment" = false ] && [ "$update_metronome" = false ]; then
    echo "all audio updates are unchecked; skipping stem rendering and video assembly"
    exit 0
fi

echo "rendering audio stems from countInAndMetronome.mid"
echo "accompaniment.wav will only be generated when the score has more than one musical part"
node "$SCRIPT_DIR/render_midi_stems.js" "$tmp_dir/countInAndMetronome.mid"
echo "harmonica.wav generated at $tmp_dir/harmonica.wav"
if [ -f "$tmp_dir/accompaniment.wav" ]; then
    echo "accompaniment.wav generated at $tmp_dir/accompaniment.wav"
else
    echo "accompaniment.wav skipped because no accompaniment part was present"
fi
echo "metronome.wav generated at $tmp_dir/metronome.wav"

echo "building 5.1 video.mp4"
if [ -n "$existing_video" ] && [ -f "$existing_video" ]; then
    echo "using existing video source $existing_video"
else
    echo "no existing video source found, creating a new video.mp4"
fi
"$HOME/harmonica_video_editor/ffmpeg_scripts/build_surround_video.sh" \
    "$tmp_dir" \
    "$existing_video" \
    "$update_harmonica" \
    "$update_accompaniment" \
    "$update_metronome"
