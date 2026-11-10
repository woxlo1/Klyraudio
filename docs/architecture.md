# Architecture

Klyraudio is a local-first audio studio with one shared UI and a loopback-only
Python service.

## Components

```text
┌─────────────────────────────────────────────────────────────┐
│ apps/web (React 18 + TypeScript + Vite)                     │
│  pages, components, i18n, typed API client                  │
└───────────────┬───────────────────────────────┬─────────────┘
                │ /api (web mode)               │ window.klyraudioDesktop
                │                               │ (preload bridge)
┌───────────────▼───────────────────────────────▼─────────────┐
│ apps/desktop (Electron main process)                        │
│  service lifecycle, port selection, health monitor,         │
│  session hardening, navigation policy                       │
└───────────────┬─────────────────────────────────────────────┘
                │ spawn + HTTP health check
┌───────────────▼─────────────────────────────────────────────┐
│ services/api (FastAPI)                                      │
│  routes → services → repositories → SQLite                  │
│  jobs: queue, worker, cancellation, retry                   │
│  audio: io, dsp, effects                                    │
│  models: registry, downloads, adapters, Sketch engine       │
│  export: libsndfile + optional FFmpeg, verification         │
└─────────────────────────────────────────────────────────────┘
```

### apps/web

- `src/pages/` contains the dashboard, generation, library, editor, studio,
  queue, models, settings, and onboarding screens.
- `src/api/client.ts` is the only HTTP layer. It uses a relative `/api` base in
  both modes, so no environment-specific URL is compiled into the UI.
- `src/state/` holds settings and toast state. Project autosave lives in the
  Studio page and calls the same project API as explicit saves.
- `src/i18n/` contains typed English and Japanese trees plus a parity test.
  Missing Japanese keys fall back to English at runtime.

### apps/desktop

- `src/backend.cjs` owns exactly one Python child process. It resolves a Python
  interpreter (`KLYRAUDIO_PYTHON`, the project virtualenv, then `PATH`), checks
  the preferred port, starts the service with a restricted environment, waits
  for `/api/health`, and monitors it every few seconds. Three consecutive
  failures trigger a restart, with a bounded retry count.
- Development must use port `8765` because Vite proxies `/api` there. Packaged
  builds may fall back to a free port.
- `src/main.cjs` creates the window only after the service is ready and displays
  a startup or error page with captured service logs. Navigation is restricted
  to the local origin; HTTPS links open externally. Permissions and webviews are
  denied.
- `src/preload.cjs` exposes only platform/version information, service status,
  restart, and a status subscription.

### services/api

| Module | Responsibility |
| --- | --- |
| `app.py` | FastAPI factory, middleware, error handlers, static UI mount |
| `routes.py` | HTTP contracts and request validation |
| `schemas.py` | Pydantic request/response models |
| `services.py` | Dependency container wiring |
| `config.py` | Data paths, settings store, FFmpeg discovery, loopback rules |
| `repositories.py` | SQLite access, projects, assets, jobs, downloads, exports |
| `jobs.py` | Persistent generation queue and worker thread |
| `assets_service.py` | Import, metadata, non-destructive operations, join |
| `projects_service.py` | Project documents, autosave-compatible updates, render |
| `export_service.py` | Format capabilities, encoding, output verification |
| `hardware.py` | CPU/GPU/RAM/disk detection and warnings |
| `security.py` | Local-only request middleware |
| `models/registry.py` | Model definitions and honest capability metadata |
| `models/downloads.py` | Opt-in HTTPS downloads, progress, cancel, checksums |
| `models/adapters.py` | Sketch, MusicGen, and Stable Audio adapters |
| `audio/` | WAV I/O, DSP primitives, effect chain |

## Data flow

### Generation

1. The UI submits prompt, model, task, duration, and model-specific parameters.
2. The API validates the model, capability, duration, and parameter set, then
   stores a queued job in SQLite.
3. The worker picks the job, marks it running, and calls the model adapter. Only
   adapter-reported progress is shown; there is no simulated progress bar.
4. The adapter writes a WAV into the media directory. The API registers an
   asset and marks the job complete with the asset id.
5. Cancellation marks queued jobs immediately; running jobs are cancelled at
   the adapter's next checkpoint.

### Editing

Every edit reads the source asset, applies a DSP operation, writes a new
24-bit WAV, registers it as a new asset, and records the operation. Sources are
never modified. Split produces two assets; join combines two or more.

### Rendering

The project document stores tracks, clips, and master settings. Rendering mixes
clips at their offsets with clip gain and fades, applies track volume and pan,
optionally applies enabled master effects, applies master volume, then either
normalizes or applies a limiter. The result is registered as a normal asset so
it can be edited or exported.

### Export

The API reports only formats the current machine can actually encode. WAV,
FLAC, and AIFF use libsndfile. Lossy formats use FFmpeg and require the matching
encoder. After encoding, the output is decoded and its duration and signal are
checked before the export is recorded as successful.

## Persistence

SQLite stores assets, projects, jobs, downloads, model installs, exports, and
metadata. Files live under the data directory:

```text
<data>/
  klyraudio.sqlite3
  config.json
  media/          generated and edited audio
  imports/        user imports
  projects/       project documents
  exports/        exported files
  models/         downloaded model weights
  cache/          waveforms and temporary files
  logs/           structured logs
```

Writes use temporary files and atomic replacement where practical. Corrupt
configuration is moved aside instead of blocking startup.

## Security boundaries

- Loopback binding by default; non-loopback requires an explicit environment
  flag.
- Origin middleware rejects non-loopback requests.
- Paths are resolved and checked against allowed data roots.
- Uploads are capped at 1 GB.
- Downloads use HTTPS with normal certificate verification and checksum checks
  when the host publishes hashes.
- The desktop renderer has no Node.js access and a minimal preload surface.

## Error model

API errors use a stable envelope:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "The request contained invalid values.",
    "details": {},
    "request_id": "..."
  }
}
```

The UI shows the message in the user's language for known codes and falls back
to the server message otherwise. The request id is displayed for support.
