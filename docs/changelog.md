# Changelog

All notable changes are recorded here. The project follows semantic versioning
for releases; during early development, minor versions may include breaking
changes.

## Unreleased

### Fixed

- The built-in Sketch engine now derives tempo, key, scale, chord progression,
  timbre, rhythm pattern, and layer mix from the prompt, so distinct prompts no
  longer reuse one fallback arrangement. Variations of the same prompt remain
  deterministic and recognisably related to each other.

## 0.1.0 — 2026-11-14

First end-to-end development release.

### Added

- FastAPI local service bound to `127.0.0.1`, with origin middleware, structured
  logs, request ids, and a stable error envelope.
- SQLite storage for assets, projects, jobs, model downloads, installs, and
  export history.
- Built-in Klyraudio Sketch procedural engine for music, sound effects, and
  ambience, clearly labeled non-AI.
- Optional model support for MusicGen Small, MusicGen Medium, and Stable Audio
  Open 1.0 through explicit adapters.
- Model Manager with license display and acknowledgement, gated-model guidance,
  real byte progress, cancellation, checksum verification, and removal.
- Persistent generation queue with capability validation, hardware warnings,
  cancellation, retry, and honest adapter-reported progress.
- Audio library with import, tags, favorites, search, waveform previews, and
  storage usage.
- Non-destructive editor: trim, split, join, silence, fades, gain, normalize,
  reverse, loop crossfade, and duplicate, with in-session history.
- Multitrack Studio with track volume/pan/mute/solo, clip gain/fades, master
  effects and normalization, autosave, and dry-mix rendering.
- Export to WAV, FLAC, and AIFF; MP3, Ogg Vorbis, Opus, AAC, and M4A when FFmpeg
  provides the encoder. Outputs are verified before success is reported.
- English and Japanese UI with typed keys, fallback to English, and parity
  tests.
- Guided onboarding with system, storage, model, license, and test-generation
  checks.
- Electron desktop shell that starts, monitors, and stops the local service,
  with context isolation, sandboxing, denied permissions, and navigation
  restrictions.
- Desktop development launcher and backend unit tests.
- Continuous integration on Linux, Windows, and macOS: the API and desktop
  shell suites run on all three platforms, and each platform's unpacked
  desktop package is built and layout-checked.
- GPL-3.0-only license, third-party notices, README files, setup guides, and
  architecture documentation.

### Known limitations

- FFmpeg is not bundled; compressed import and lossy export depend on a user
  installation.
- Neural models require optional Python packages and a manual model download.
- MusicGen weights are non-commercial; Stable Audio Open is gated and
  conditionally commercial.
- No GPU CI. Neural smoke tests are optional and local.
- Platform packages are not code signed or notarized.
- Desktop packages require a user-provided Python environment.
