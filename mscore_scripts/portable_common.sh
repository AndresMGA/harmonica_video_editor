#!/usr/bin/env bash
set -euo pipefail

scripts_dir() {
    local source_path="${BASH_SOURCE[0]}"
    while [ -L "$source_path" ]; do
        local link_dir
        link_dir="$(cd "$(dirname "$source_path")" && pwd)"
        source_path="$(readlink "$source_path")"
        [[ "$source_path" != /* ]] && source_path="$link_dir/$source_path"
    done
    cd "$(dirname "$source_path")" && pwd
}

find_musescore_cmd() {
    local candidates=()

    if command -v musescore >/dev/null 2>&1; then
        candidates+=("$(command -v musescore)")
    fi
    if command -v mscore >/dev/null 2>&1; then
        candidates+=("$(command -v mscore)")
    fi
    if command -v MuseScore >/dev/null 2>&1; then
        candidates+=("$(command -v MuseScore)")
    fi

    if [[ "$(uname -s)" == "Darwin" ]]; then
        candidates+=("/Applications/MuseScore 4.app/Contents/MacOS/mscore")
        candidates+=("/Applications/MuseScore 4.app/Contents/MacOS/MuseScore")
    fi

    local candidate
    for candidate in "${candidates[@]}"; do
        if [ -x "$candidate" ]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done

    echo "Could not find a MuseScore CLI executable. Tried musescore, mscore, MuseScore and the default macOS app path." >&2
    return 1
}

find_extensions_dir() {
    local home_dir=${HOME:?}
    local candidates=()

    if [[ "$(uname -s)" == "Darwin" ]]; then
        candidates+=("$home_dir/Library/Application Support/MuseScore/MuseScore4/extensions")
    else
        candidates+=("$home_dir/snap/musescore/current/.local/share/MuseScore/MuseScore4/extensions")
        candidates+=("$home_dir/.local/share/MuseScore/MuseScore4/extensions")
    fi

    local candidate
    for candidate in "${candidates[@]}"; do
        if [ -d "$candidate" ]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done

    printf '%s\n' "${candidates[0]}"
}

find_plugins_dir() {
    local home_dir=${HOME:?}
    local candidates=()

    if [[ "$(uname -s)" == "Darwin" ]]; then
        candidates+=("$home_dir/Library/Application Support/MuseScore/MuseScore4/plugins")
        candidates+=("$home_dir/Documents/MuseScore4/Plugins")
        candidates+=("$home_dir/Documents/MuseScore3/Plugins")
    else
        candidates+=("$home_dir/snap/musescore/current/.local/share/MuseScore/MuseScore4/plugins")
        candidates+=("$home_dir/.local/share/MuseScore/MuseScore4/plugins")
        candidates+=("$home_dir/Documents/MuseScore4/Plugins")
        candidates+=("$home_dir/Documents/MuseScore3/Plugins")
    fi

    local candidate
    for candidate in "${candidates[@]}"; do
        if [ -d "$candidate" ]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done

    printf '%s\n' "${candidates[0]}"
}

install_extension() {
    local extension_name=$1
    local root_dir
    root_dir="$(scripts_dir)"
    local source_dir="$root_dir/extensions/$extension_name"
    local target_root
    target_root="$(find_extensions_dir)"
    local target_dir="$target_root/$extension_name"

    if [ ! -d "$source_dir" ]; then
        echo "Missing bundled extension directory: $source_dir" >&2
        return 1
    fi

    mkdir -p "$target_root"
    rm -rf "$target_dir"
    mkdir -p "$target_dir"
    cp -R "$source_dir"/. "$target_dir"/
}

install_plugin() {
    local plugin_name=$1
    local root_dir
    root_dir="$(scripts_dir)"
    local source_dir="$root_dir/plugins/$plugin_name"
    local target_root
    target_root="$(find_plugins_dir)"
    local target_dir="$target_root/$plugin_name"

    if [ ! -d "$source_dir" ]; then
        echo "Missing bundled plugin directory: $source_dir" >&2
        return 1
    fi

    mkdir -p "$target_root"
    rm -rf "$target_dir"
    mkdir -p "$target_dir"
    cp -R "$source_dir"/. "$target_dir"/
}
