# Developer setup

## Prerequisites

- Node.js 20+ with npm 10+
- Python 3.9+
- Git
- Optional: FFmpeg/FFprobe for compressed import and lossy export
- Optional: CUDA or Apple MPS for neural models

## First-time setup

```bash
git clone https://github.com/woxlo1/Klyraudio.git
cd Klyraudio

python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1
# Windows cmd: .venv\Scripts\activate.bat
# macOS/Linux: source .venv/bin/activate

python -m pip install --upgrade pip
python -m pip install -r services/api/requirements.txt
npm install
```

Backend development tools:

```bash
python -m pip install -r services/api/requirements-dev.txt
```

Neural model runtime (only if you will run downloaded models):

```bash
python -m pip install -r services/api/requirements-models.txt
```

Install a CUDA build of PyTorch first if you need NVIDIA acceleration; see the
official PyTorch selector.

## Running

| Mode | Command | Notes |
| --- | --- | --- |
| API only | `npm run api:dev` | `127.0.0.1:8765`, serves built UI if present |
| Web UI | `npm run dev` | Vite on `127.0.0.1:5173`, proxies `/api` |
| Desktop | `npm run dev:desktop` | Starts Vite, then Electron and the API |

Run `npm run api:dev` and `npm run dev` in separate terminals for web
development. The desktop launcher needs port `8765` free.

## Checks

```bash
npm run typecheck
npm run lint
npm run test
npm run format:check
npm run build

python -m pytest services/api/tests -q
python -m ruff check services/api
```

Desktop checks:

```bash
npm run typecheck --workspace @klyraudio/desktop
npm run test --workspace @klyraudio/desktop
```

The UI test runner uses Vitest and jsdom. The desktop tests use Node's built-in
test runner and do not launch a window.

## Repository layout

```text
apps/web/          Shared React UI
apps/desktop/      Electron main process, preload, dev launcher, tests
services/api/
  klyraudio_api/   FastAPI service
  tests/           pytest suite and small audio fixtures
docs/              User and contributor documentation
```

## Configuration

The service reads environment variables at startup:

| Variable | Purpose |
| --- | --- |
| `KLYRAUDIO_DATA_DIR` | Override the data directory |
| `KLYRAUDIO_HOST` | Bind host; loopback by default |
| `KLYRAUDIO_PORT` | Bind port; `8765` by default |
| `KLYRAUDIO_ALLOW_LAN` | Allow a non-loopback bind; default off |
| `KLYRAUDIO_WEB_DIR` | Serve a specific built UI directory |
| `KLYRAUDIO_DISABLE_DOCS` | Disable `/api/docs` and OpenAPI |
| `KLYRAUDIO_LOG_LEVEL` | `INFO` by default |
| `KLYRAUDIO_FFMPEG` | Explicit FFmpeg path |
| `KLYRAUDIO_FFPROBE` | Explicit FFprobe path |
| `KLYRAUDIO_PYTHON` | Interpreter used by the desktop shell |
| `KLYRAUDIO_SKIP_BACKEND` | Desktop development without spawning the service |
| `KLYRAUDIO_WEB_URL` | Desktop development UI URL |
| `HF_TOKEN` / `HUGGING_FACE_HUB_TOKEN` | Token for gated model downloads |

Settings are stored in `<data>/config.json`. The settings API validates values
and rejects unknown fields, unsupported languages, invalid sample rates,
telemetry, and concurrency outside 1–4.

## Adding an audio operation

1. Add the DSP primitive under `services/api/klyraudio_api/audio/`.
2. Extend the operation enum and validation in `schemas.py` and
   `assets_service.py`.
3. Write the result as a new asset; never overwrite the source.
4. Add API tests with a small fixture.
5. Add UI controls and translations in `apps/web/src/pages/Editor.tsx` and both
   i18n trees.
6. Document the operation in `docs/editing.md`.

## Adding a model

1. Add a `ModelDefinition` in `models/registry.py` with honest capabilities,
   limits, hardware estimates, license data, and download excludes.
2. Implement an adapter in `models/adapters.py` with real progress and
   cancellation checkpoints.
3. Register the adapter.
4. Add adapter tests that do not require the weights.
5. Update `NOTICE.md`, `docs/models.md`, and UI translations if the parameter
   set differs.
6. Document any gating, token, or commercial-use restrictions.

## Adding an export format

1. Extend `ExportService.capabilities()` so the format appears only when the
   encoder is present.
2. Add encoding and verification logic.
3. Test both the success path and the missing-codec path.
4. Update `docs/export.md`.

## Resetting local data

Stop the service, then move or delete the data directory (see
`docs/installation.md` for platform paths). Klyraudio recreates the directory,
database, and default settings on the next start.

## Working with the UI

- All HTTP calls go through `src/api/client.ts`.
- Every visible string must exist in `src/i18n/en.ts` and `src/i18n/ja.ts`.
  `src/i18n/i18n.test.ts` checks key parity.
- Use the shared components in `src/components/` before adding new primitives.
- Avoid storing audio blobs in React state; use asset ids and URLs.
- Keep autosave debounced and cancel pending writes when the project changes or
  the component unmounts.
