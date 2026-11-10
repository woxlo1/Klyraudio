# Klyraudio

**A local-first AI audio creation studio.** Generate, edit, arrange, and export
audio on your own computer. Audio, prompts, projects, and models stay on your
device.

Klyraudio is free software under the GNU GPL v3.0 only. It runs as a web app
served by a loopback-only local service, or as an Electron desktop app that
manages that service for you.

[日本語版 README はこちら](README.ja.md)

> **Status:** early development (`0.1.0`). The built-in Sketch engine, editing,
> multitrack arrangement, rendering, and export work end to end. Neural model
> support is implemented but requires optional Python packages and a model
> download.

## What it does

- **Generate audio** with the built-in **Klyraudio Sketch** DSP engine. It is
  rule-based, dependency-free, and clearly labeled as non-AI. It works offline
  on any machine that runs Klyraudio.
- **Generate with neural models** after an explicit, checksum-protected
  download: MusicGen Small/Medium and Stable Audio Open 1.0. Model weights are
  never bundled.
- **Queue and monitor jobs** with real progress from the model adapter,
  cancellation, retry, and explicit error reporting.
- **Edit non-destructively**: trim, split, join, insert silence, fade in/out,
  gain, normalize, reverse, and loop crossfades. Every operation creates a new
  asset and records its history; sources are never overwritten.
- **Arrange a multitrack project** with tracks (volume, pan, mute, solo) and
  clips (gain, fades), optional master EQ/effects and normalization, autosave,
  explicit save, and dry-mix rendering.
- **Export** WAV, FLAC, and AIFF offline, plus MP3, Ogg Vorbis, Opus, AAC, and
  M4A when FFmpeg with the required encoder is installed. Exports are decoded
  and verified before success is reported.
- **Manage a local library** with tags, search, filtering, waveform previews,
  and storage usage.
- **Work in English or Japanese.** The UI falls back to English if a Japanese
  string is missing.

## Local-first by design

- The service binds to `127.0.0.1` only and refuses non-loopback hosts unless
  the operator explicitly sets `KLYRAUDIO_ALLOW_LAN=1`.
- There is no telemetry, analytics, account, or cloud sync. The settings API
  rejects attempts to enable telemetry.
- Requests from non-loopback origins are rejected by middleware, and CORS is
  limited to loopback origins.
- The only network access is an optional model download from Hugging Face that
  you start yourself.
- The database is SQLite. Generated audio, imports, renders, and exports live
  in the Klyraudio data directory.

## Architecture

```text
apps/web        React 18 + TypeScript + Vite UI (shared by web and desktop)
apps/desktop    Electron shell: owns service lifecycle, hardening, preload API
services/api    Python FastAPI service: REST API, SQLite, jobs, DSP, export
  klyraudio_api/
    models/     Model registry, download manager, adapters, Sketch engine
```

The browser and desktop app use the same UI. In web mode the UI talks to
`/api` on the same origin. In desktop mode Electron starts the Python service
on `127.0.0.1:8765` (development) or a free loopback port (packaged), waits for
its health check, then loads the UI.

See [docs/architecture.md](docs/architecture.md) for boundaries and data flow.

## Requirements

- **Node.js 22.22 or newer** and npm 10+.
- **Python 3.10 or newer** for the local service (3.11 or 3.12 recommended).

- **Optional:** FFmpeg + FFprobe for importing compressed formats and exporting
  MP3/Ogg/Opus/AAC/M4A. WAV, FLAC, and AIFF work without FFmpeg.
- **Optional:** an NVIDIA GPU (CUDA) or Apple Silicon GPU (MPS) for neural
  models. The Sketch engine needs no GPU.

There are no bundled model weights. Disk use starts small; each neural model
adds roughly 3.5 GB to 12.2 GB in your data directory.

## Quick start (development)

```bash
git clone https://github.com/woxlo1/Klyraudio.git
cd Klyraudio

# Python service
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
python -m pip install -r services/api/requirements.txt

# Web UI dependencies
npm install
```

Run the web UI with the API in two terminals:

```bash
npm run api:dev
npm run dev
```

Open <http://127.0.0.1:5173>. Vite proxies `/api` to
`http://127.0.0.1:8765`.

Run the desktop app in one command (it starts Vite and the Python service):

```bash
npm run dev:desktop
```

Desktop development requires port `8765` to be free; the launcher fails rather
than silently changing ports so the Vite proxy remains valid.

## Production web mode

Build the UI, then let the API serve it:

```bash
npm run build
python -m pip install -e services/api   # once, installs the klyraudio-api command
klyraudio-api --open-browser
```

Alternatively, run the service without installing it:

```bash
python -m uvicorn klyraudio_api.app:create_app --factory \
  --host 127.0.0.1 --port 8765 --app-dir services/api
```

The service mounts `apps/web/dist` at `/` and exposes the API under `/api`.
Useful flags:

```text
--host 127.0.0.1      bind address (loopback by default)
--port 8765           port
--data-dir PATH       override the data directory
--no-workers          start the API without processing the job queue
--open-browser        open the UI after startup
```

## Desktop builds

```bash
npm run build          # build the web UI first
npm run build:desktop  # electron-builder --dir (unpacked app)
npm run dist --workspace @klyraudio/desktop  # installers
```

Packaged builds include the built UI and the Python API source, but not model
weights. Users still need a Python installation with the API requirements, or
`KLYRAUDIO_PYTHON` pointing at a suitable interpreter. Platform signing and
notarization are not configured; do not treat an unsigned build as a signed
release.

## Models and licenses

Klyraudio shows model licenses and requires acknowledgement before download.
Model files are stored under your local data directory and can be removed from
the Model Manager.

| Model | Download | License | Commercial use |
| --- | --- | --- | --- |
| Klyraudio Sketch | built in | GPL-3.0-only | Permitted |
| MusicGen Small | ~3.5 GB | CC BY-NC 4.0 (weights), MIT (code) | Not permitted |
| MusicGen Medium | ~12.2 GB | CC BY-NC 4.0 (weights), MIT (code) | Not permitted |
| Stable Audio Open 1.0 | ~10.5 GB, gated | Stability AI Community License | Conditional |

See [docs/models.md](docs/models.md) and [NOTICE.md](NOTICE.md) for details.
Generated audio is not automatically GPL-3.0; the model license and your input
material govern the output.

## Data location

| Platform | Default directory |
| --- | --- |
| Windows | `%LOCALAPPDATA%\Klyraudio` |
| macOS | `~/Library/Application Support/Klyraudio` |
| Linux | `$XDG_DATA_HOME/klyraudio` or `~/.local/share/klyraudio` |

Override it with `KLYRAUDIO_DATA_DIR` or `--data-dir`. The directory contains
`klyraudio.sqlite3`, `config.json`, `media/`, `imports/`, `projects/`,
`exports/`, `models/`, and `logs/`.

## Development checks

```bash
npm run typecheck
npm run lint
npm run test
npm run format:check
npm run build

# Backend (after activating the virtualenv)
python -m pytest services/api/tests -q
python -m ruff check services/api
```

## Documentation

- [Developer setup](docs/development.md)
- [Architecture](docs/architecture.md)
- [Models and licenses](docs/models.md)
- [Audio editing](docs/editing.md)
- [Export formats](docs/export.md)
- [Installation](docs/installation.md)
- [Hardware requirements](docs/hardware.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Automation and AI-assisted review](docs/automation.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## License

Klyraudio is licensed under the **GNU General Public License, version 3 only**.
See [LICENSE](LICENSE). Third-party components and model licenses are listed in
[NOTICE.md](NOTICE.md).
