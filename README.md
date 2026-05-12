# Harmonica Video Editor

React/Vite renderer with an Electron desktop shell for editing harmonica exercise media.

## Requirements

### MuseScore 4

Install MuseScore 4 / MuseScore Studio. The app uses MuseScore to open `.mscz`
scores and to run the batch plugin that exports JSON, SVG, MIDI, and tabbed
score files.

Expected macOS app path:

```sh
/Applications/MuseScore 4.app
```

On Linux, make sure one of these commands is available on `PATH`:

```sh
musescore
mscore
MuseScore4
MuseScore
```

### FFmpeg

On macOS, place the `ffmpeg` executable in the project root:

```sh
./ffmpeg
```

It must be executable:

```sh
chmod +x ./ffmpeg
./ffmpeg -version
```

On Linux, the scripts use the system `ffmpeg` from `PATH`.

### FluidSynth

FluidSynth is required when rendering MIDI stems for harmonica, accompaniment,
and metronome audio.

On macOS, the easiest install is Homebrew:

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install fluid-synth
fluidsynth --version
```

The renderer also supports a bundled binary at either:

```sh
./fluidsynth
./bin/fluidsynth
```

On Linux, install FluidSynth with your package manager and make sure
`fluidsynth` is available on `PATH`.

## Development

```sh
npm install
npm run dev:electron
```

`npm run dev` runs only the Vite web app. `npm run dev:electron` runs the Vite
dev server and launches Electron against it.

## Production Build

```sh
npm run build
npm run build:electron
```

`npm run build` builds the web renderer into `dist/`. `npm run build:electron`
builds the renderer and packages the Electron app with `electron-builder`.
