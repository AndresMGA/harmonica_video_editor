#!/usr/bin/env bash

ffmpeg_scripts_dir() {
  local source_path="${BASH_SOURCE[0]}"

  while [ -L "$source_path" ]; do
    local link_dir
    link_dir="$(cd "$(dirname "$source_path")" && pwd)"
    source_path="$(readlink "$source_path")"
    [[ "$source_path" != /* ]] && source_path="$link_dir/$source_path"
  done

  cd "$(dirname "$source_path")" && pwd
}

resolve_project_ffmpeg() {
  local script_dir
  script_dir="$(ffmpeg_scripts_dir)"
  local project_root
  project_root="$(cd "$script_dir/.." && pwd)"

  if [[ "$(uname -s)" == "Darwin" ]] && [ -x "$project_root/ffmpeg" ]; then
    printf '%s\n' "$project_root/ffmpeg"
    return
  fi

  printf '%s\n' "ffmpeg"
}

resolve_project_ffprobe() {
  local script_dir
  script_dir="$(ffmpeg_scripts_dir)"
  local project_root
  project_root="$(cd "$script_dir/.." && pwd)"

  if [[ "$(uname -s)" == "Darwin" ]] && [ -x "$project_root/ffprobe" ]; then
    printf '%s\n' "$project_root/ffprobe"
    return
  fi

  printf '%s\n' "ffprobe"
}

export FFMPEG_BIN="${FFMPEG_BIN:-$(resolve_project_ffmpeg)}"
export FFPROBE_BIN="${FFPROBE_BIN:-$(resolve_project_ffprobe)}"
