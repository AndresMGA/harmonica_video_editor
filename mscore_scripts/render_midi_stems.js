#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { parseMidi, writeMidi } from "midi-file";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SF3 = path.resolve(__dirname, "..", "MuseScore_General.sf3");
const FLUIDSYNTH_BIN = "fluidsynth";

function trackName(track) {
  const event = track.find((item) => item.type === "trackName" && item.text);
  return event ? String(event.text) : "";
}

function setTrackName(track, name) {
  const existingEvent = track.find((item) => item.type === "trackName");

  if (existingEvent) {
    existingEvent.text = name;
    return;
  }

  let insertIndex = track.findIndex((item) => item.type !== "sequenceNumber");
  if (insertIndex < 0) {
    insertIndex = 0;
  }

  track.splice(insertIndex, 0, {
    deltaTime: 0,
    meta: true,
    type: "trackName",
    text: name,
  });
}

function trackChannels(track) {
  return Array.from(
    new Set(track.filter((event) => typeof event.channel === "number").map((event) => event.channel))
  ).sort((a, b) => a - b);
}

function isMetronomeTrack(track) {
  const name = trackName(track).toLowerCase();
  const channels = trackChannels(track);

  return (
    name.includes("metronome") ||
    name.includes("wood block") ||
    name.includes("woodblock") ||
    channels.includes(9)
  );
}

function splitMidiByTrackIndex(midi, targetTrackIndex) {
  const split = {
    header: { ...midi.header },
    tracks: [],
  };

  for (const [trackIndex, track] of midi.tracks.entries()) {
    const outTrack = [];
    let carryDelta = 0;

    for (const event of track) {
      carryDelta += event.deltaTime || 0;

      const isChannelEvent = typeof event.channel === "number";
      const keep = !isChannelEvent || trackIndex === targetTrackIndex;

      if (!keep) {
        continue;
      }

      outTrack.push({
        ...event,
        deltaTime: carryDelta,
      });
      carryDelta = 0;
    }

    split.tracks.push(outTrack);
  }

  return split;
}

function classifyStemTracks(midi) {
  const musicalTracks = [];
  let metronomeTrack = null;

  midi.tracks.forEach((track, index) => {
    const channels = trackChannels(track);
    if (!channels.length) {
      return;
    }

    const info = {
      index,
      name: trackName(track),
      channels,
    };

    if (isMetronomeTrack(track)) {
      metronomeTrack = info;
      return;
    }

    musicalTracks.push(info);
  });

  const stems = [];

  if (musicalTracks[0]) {
    stems.push({
      name: "harmonica",
      trackIndex: musicalTracks[0].index,
      dry: false,
      sourceName: musicalTracks[0].name,
      channels: musicalTracks[0].channels,
    });
  }

  if (musicalTracks[1]) {
    stems.push({
      name: "accompaniment",
      trackIndex: musicalTracks[1].index,
      dry: false,
      sourceName: musicalTracks[1].name,
      channels: musicalTracks[1].channels,
    });
  }

  if (metronomeTrack) {
    stems.push({
      name: "metronome",
      trackIndex: metronomeTrack.index,
      dry: true,
      sourceName: metronomeTrack.name,
      channels: metronomeTrack.channels,
    });
  }

  return stems;
}

function canonicalTrackName(stemName) {
  switch (stemName) {
    case "harmonica":
      return "Harmonica";
    case "accompaniment":
      return "Accompaniment";
    case "metronome":
      return "Metronome";
    default:
      return stemName;
  }
}

function runFluidsynth({ soundFontPath, inputMidiPath, outPath, dry }) {
  const args = ["-ni", "-F", outPath, "-T", "wav"];

  if (dry) {
    args.push(
      "-o",
      "synth.reverb.active=0",
      "-o",
      "synth.chorus.active=0"
    );
  }

  args.push(soundFontPath, inputMidiPath);

  const result = spawnSync(FLUIDSYNTH_BIN, args, {
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `fluidsynth failed for ${inputMidiPath} with exit code ${result.status}`
    );
  }
}

async function main() {
  const inputMidi = process.argv[2];
  const outputDir = process.argv[3]
    ? path.resolve(process.argv[3])
    : path.dirname(path.resolve(inputMidi || "."));
  const soundFontPath = process.argv[4]
    ? path.resolve(process.argv[4])
    : DEFAULT_SF3;

  if (!inputMidi) {
    console.error(
      "usage: node render_midi_stems_fluidsynth.js INPUT_MIDI [OUTPUT_DIR] [SOUNDFONT_SF3]"
    );
    process.exit(1);
  }

  const inputMidiPath = path.resolve(inputMidi);
  const midiFile = await fs.readFile(inputMidiPath);
  const midi = parseMidi(midiFile);
  const stemLayout = classifyStemTracks(midi);

  if (stemLayout.length < 2) {
    throw new Error(
      "expected at least harmonica and metronome tracks in the MIDI export"
    );
  }

  await fs.mkdir(outputDir, { recursive: true });

  for (const stem of stemLayout) {
    setTrackName(midi.tracks[stem.trackIndex], canonicalTrackName(stem.name));
    stem.sourceName = canonicalTrackName(stem.name);
  }

  await fs.writeFile(inputMidiPath, Buffer.from(writeMidi(midi)));

  console.log(`input midi: ${inputMidiPath}`);
  console.log(`soundfont: ${soundFontPath}`);
  console.log(`renderer: ${FLUIDSYNTH_BIN}`);
  console.log(
    `stems: ${stemLayout
      .map((stem) => `${stem.name}<-${stem.sourceName || `track ${stem.trackIndex}`} ch=${stem.channels.join(",")}`)
      .join(" | ")}`
  );

  for (const stem of stemLayout) {
    const splitMidi = splitMidiByTrackIndex(midi, stem.trackIndex);
    const name = stem.name;
    const splitMidiPath = path.join(outputDir, `${name}.mid`);
    const splitWavPath = path.join(outputDir, `${name}.wav`);

    await fs.writeFile(splitMidiPath, Buffer.from(writeMidi(splitMidi)));
    runFluidsynth({
      soundFontPath,
      inputMidiPath: splitMidiPath,
      outPath: splitWavPath,
      dry: stem.dry,
    });

    console.log(
      `${name}: track ${stem.trackIndex} (${stem.sourceName || "unnamed"}) -> ${splitMidiPath} / ${splitWavPath}`
    );
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
