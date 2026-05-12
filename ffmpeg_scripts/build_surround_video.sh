#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 5 ]; then
    echo "usage: $0 TMP_DIR EXISTING_VIDEO_PATH UPDATE_HARMONICA UPDATE_ACCOMPANIMENT UPDATE_METRONOME" >&2
    exit 1
fi

tmp_dir=$1
existing_video=${2:-}
update_harmonica=$3
update_accompaniment=$4
update_metronome=$5

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/ffmpeg_common.sh"

ffmpeg_bin=$FFMPEG_BIN
ffprobe_bin=${FFPROBE_BIN:-ffprobe}
work_dir="$tmp_dir/ffmpeg_build"
output_video="$tmp_dir/video.mp4"
target_peak_db=-6

harmonica_wav="$tmp_dir/harmonica.wav"
accompaniment_wav="$tmp_dir/accompaniment.wav"
metronome_wav="$tmp_dir/metronome.wav"
harmonica_norm_wav="$work_dir/harmonica.normalized.wav"
accompaniment_norm_wav="$work_dir/accompaniment.normalized.wav"
metronome_norm_wav="$work_dir/metronome.normalized.wav"

run_ffmpeg() {
    local label=$1
    shift

    echo "ffmpeg: $label"
    "$ffmpeg_bin" \
        -hide_banner \
        -stats_period 0.5 \
        -progress pipe:2 \
        "$@"
}

peak_normalize_wav() {
    local in_path=$1
    local out_path=$2
    local detect_output
    local max_volume
    local gain_db

    if [ ! -f "$in_path" ]; then
        return
    fi

    echo "ffmpeg: peak analyze $(basename "$in_path")"
    detect_output=$(
        "$ffmpeg_bin" -hide_banner -i "$in_path" -af volumedetect -f null - 2>&1
    )

    max_volume=$(printf '%s\n' "$detect_output" | awk -F': ' '/max_volume/ { print $2 }' | tail -n1 | tr -d '[:space:]')

    if [ -z "$max_volume" ] || [ "$max_volume" = "-inf dB" ]; then
        echo "ffmpeg: no measurable peak in $(basename "$in_path"), copying without gain"
        cp "$in_path" "$out_path"
        return
    fi

    gain_db=$(printf '%s\n' "$max_volume" | sed 's/ dB$//')
    gain_db=$(awk "BEGIN { printf \"%.6f\", $target_peak_db - ($gain_db) }")

    echo "ffmpeg: peak normalize $(basename "$in_path") by ${gain_db} dB"
    run_ffmpeg "normalize $(basename "$in_path")" -y \
        -i "$in_path" \
        -af "volume=${gain_db}dB" \
        -c:a pcm_s16le \
        "$out_path"
}

mkdir -p "$work_dir"
rm -f \
    "$work_dir"/*.wav \
    "$output_video"

duration_of() {
    local file_path=$1
    if [ -z "$file_path" ] || [ ! -f "$file_path" ]; then
        echo "0"
        return
    fi

    "$ffprobe_bin" -v error -show_entries format=duration -of csv=p=0 "$file_path" 2>/dev/null || echo "0"
}

max_duration() {
    awk '
        BEGIN { max = 0 }
        {
            value = $1 + 0
            if (value > max) {
                max = value
            }
        }
        END { printf "%.6f\n", max }
    '
}

make_silence_mono() {
    local out_path=$1
    local duration=$2
    run_ffmpeg "create silence $(basename "$out_path")" -y \
        -f lavfi -i "anullsrc=channel_layout=mono:sample_rate=48000" \
        -t "$duration" \
        -c:a pcm_s16le \
        "$out_path"
}

ensure_mono_wav() {
    local in_path=$1
    local out_path=$2
    local duration=$3

    if [ -f "$in_path" ]; then
        run_ffmpeg "normalize mono $(basename "$out_path")" -y \
            -i "$in_path" \
            -ac 1 \
            -ar 48000 \
            -c:a pcm_s16le \
            "$out_path"
    else
        make_silence_mono "$out_path" "$duration"
    fi
}

split_stereo_to_mono() {
    local in_path=$1
    local left_path=$2
    local right_path=$3
    local duration=$4

    if [ -f "$in_path" ]; then
        run_ffmpeg "split stereo $(basename "$in_path")" -y \
            -i "$in_path" \
            -filter_complex "[0:a]channelsplit=channel_layout=stereo[left][right]" \
            -map "[left]" -ac 1 -ar 48000 -c:a pcm_s16le "$left_path" \
            -map "[right]" -ac 1 -ar 48000 -c:a pcm_s16le "$right_path"
    else
        make_silence_mono "$left_path" "$duration"
        make_silence_mono "$right_path" "$duration"
    fi
}

extract_existing_5_1_channels() {
    local video_path=$1
    local duration=$2
    local channel_count
    local pan_filter

    channel_count=$("$ffprobe_bin" -v error -select_streams a:0 -show_entries stream=channels -of csv=p=0 "$video_path" 2>/dev/null || echo "0")

    case "$channel_count" in
        0|'')
            echo "existing video has no audio stream to preserve"
            return 0
            ;;
        1)
            pan_filter='pan=5.1(side)|FL=0*c0|FR=0*c0|FC=c0|LFE=0*c0|SL=0*c0|SR=0*c0'
            ;;
        2)
            pan_filter='pan=5.1(side)|FL=c0|FR=c1|FC=0*c0|LFE=0*c0|SL=0*c0|SR=0*c0'
            ;;
        3)
            pan_filter='pan=5.1(side)|FL=c0|FR=c1|FC=c2|LFE=0*c0|SL=0*c0|SR=0*c0'
            ;;
        4)
            pan_filter='pan=5.1(side)|FL=c0|FR=c1|FC=c2|LFE=c3|SL=0*c0|SR=0*c0'
            ;;
        5)
            pan_filter='pan=5.1(side)|FL=c0|FR=c1|FC=c2|LFE=0*c0|SL=c3|SR=c4'
            ;;
        *)
            pan_filter='pan=5.1(side)|FL=c0|FR=c1|FC=c2|LFE=c3|SL=c4|SR=c5'
            ;;
    esac

    run_ffmpeg "extract existing 5.1 channels" -y \
        -i "$video_path" \
        -vn \
        -filter_complex "\
[0:a]${pan_filter},channelsplit=channel_layout=5.1(side)[fl][fr][fc][lfe][sl][sr]" \
        -map "[fl]" -ac 1 -ar 48000 -c:a pcm_s16le "$work_dir/existing_FL.wav" \
        -map "[fr]" -ac 1 -ar 48000 -c:a pcm_s16le "$work_dir/existing_FR.wav" \
        -map "[fc]" -ac 1 -ar 48000 -c:a pcm_s16le "$work_dir/existing_FC.wav" \
        -map "[lfe]" -ac 1 -ar 48000 -c:a pcm_s16le "$work_dir/existing_LFE.wav" \
        -map "[sl]" -ac 1 -ar 48000 -c:a pcm_s16le "$work_dir/existing_SL.wav" \
        -map "[sr]" -ac 1 -ar 48000 -c:a pcm_s16le "$work_dir/existing_SR.wav"

    echo "existing video audio prepared for preservation"
}

harmonica_duration=$(duration_of "$harmonica_wav")
accompaniment_duration=$(duration_of "$accompaniment_wav")
metronome_duration=$(duration_of "$metronome_wav")
existing_video_duration=$(duration_of "$existing_video")

total_duration=$(
    printf '%s\n' \
        "$harmonica_duration" \
        "$accompaniment_duration" \
        "$metronome_duration" \
        "$existing_video_duration" | max_duration
)

if awk 'BEGIN { exit !('"$total_duration"' <= 0) }'; then
    echo "could not determine media duration" >&2
    exit 1
fi

if [ -n "$existing_video" ] && [ -f "$existing_video" ]; then
    echo "using existing video source $existing_video"
    extract_existing_5_1_channels "$existing_video" "$total_duration"
else
    echo "no existing video found, creating a new black video"
fi

peak_normalize_wav "$harmonica_wav" "$harmonica_norm_wav"
peak_normalize_wav "$accompaniment_wav" "$accompaniment_norm_wav"
peak_normalize_wav "$metronome_wav" "$metronome_norm_wav"

if [ "$update_harmonica" = "true" ]; then
    echo "placing harmonica.wav into FL/FR"
    split_stereo_to_mono "$harmonica_norm_wav" "$work_dir/FL.wav" "$work_dir/FR.wav" "$total_duration"
else
    echo "preserving FL/FR from existing video when available"
    ensure_mono_wav "$work_dir/existing_FL.wav" "$work_dir/FL.wav" "$total_duration"
    ensure_mono_wav "$work_dir/existing_FR.wav" "$work_dir/FR.wav" "$total_duration"
fi

if [ "$update_metronome" = "true" ]; then
    echo "placing metronome.wav into FC"
    ensure_mono_wav "$metronome_norm_wav" "$work_dir/FC.wav" "$total_duration"
else
    echo "preserving FC from existing video when available"
    ensure_mono_wav "$work_dir/existing_FC.wav" "$work_dir/FC.wav" "$total_duration"
fi

if [ "$update_accompaniment" = "true" ]; then
    echo "placing accompaniment.wav into SL/SR when present"
    split_stereo_to_mono "$accompaniment_norm_wav" "$work_dir/SL.wav" "$work_dir/SR.wav" "$total_duration"
else
    echo "preserving SL/SR from existing video when available"
    ensure_mono_wav "$work_dir/existing_SL.wav" "$work_dir/SL.wav" "$total_duration"
    ensure_mono_wav "$work_dir/existing_SR.wav" "$work_dir/SR.wav" "$total_duration"
fi

make_silence_mono "$work_dir/LFE.wav" "$total_duration"
echo "leaving LFE empty"

if [ -n "$existing_video" ] && [ -f "$existing_video" ]; then
    extra_duration=$(awk 'BEGIN { printf "%.6f\n", ('"$total_duration"' > '"$existing_video_duration"' ? '"$total_duration"' - '"$existing_video_duration"' : 0) }')

    run_ffmpeg "assemble surround video from existing source" -y \
        -i "$existing_video" \
        -i "$work_dir/FL.wav" \
        -i "$work_dir/FR.wav" \
        -i "$work_dir/FC.wav" \
        -i "$work_dir/LFE.wav" \
        -i "$work_dir/SL.wav" \
        -i "$work_dir/SR.wav" \
        -filter_complex "[1:a][2:a][3:a][4:a][5:a][6:a]join=inputs=6:channel_layout=5.1(side):map=0.0-FL|1.0-FR|2.0-FC|3.0-LFE|4.0-SL|5.0-SR[aout]" \
        -map 0:v:0 \
        -map "[aout]" \
        -vf "tpad=stop_mode=clone:stop_duration=$extra_duration" \
        -t "$total_duration" \
        -c:v libx264 \
        -pix_fmt yuv420p \
        -c:a aac \
        -ac 6 \
        -b:a 384k \
        -movflags +faststart \
        "$output_video"
else
    run_ffmpeg "assemble surround video from black background" -y \
        -f lavfi -i "color=c=black:s=1920x1080:r=30:d=$total_duration" \
        -i "$work_dir/FL.wav" \
        -i "$work_dir/FR.wav" \
        -i "$work_dir/FC.wav" \
        -i "$work_dir/LFE.wav" \
        -i "$work_dir/SL.wav" \
        -i "$work_dir/SR.wav" \
        -filter_complex "[1:a][2:a][3:a][4:a][5:a][6:a]join=inputs=6:channel_layout=5.1(side):map=0.0-FL|1.0-FR|2.0-FC|3.0-LFE|4.0-SL|5.0-SR[aout]" \
        -map 0:v:0 \
        -map "[aout]" \
        -c:v libx264 \
        -pix_fmt yuv420p \
        -tune stillimage \
        -c:a aac \
        -ac 6 \
        -b:a 384k \
        -movflags +faststart \
        "$output_video"
fi

echo "video.mp4 generated at $output_video"
