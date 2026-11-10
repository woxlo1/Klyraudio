# Troubleshooting

## First checks

1. Is the local service running? Open <http://127.0.0.1:8765/api/health>. A
   healthy service returns JSON with `"status":"ok"` and `"local_only":true`.
2. Check the logs in `<data>/logs/`. The data directory defaults to
   `%LOCALAPPDATA%\Klyraudio` on Windows,
   `~/Library/Application Support/Klyraudio` on macOS, and
   `~/.local/share/klyraudio` on Linux.
3. In desktop mode, a startup failure page shows captured service output.

## The service does not start

Run it manually to see the error:

```bash
python -m uvicorn klyraudio_api.app:create_app --factory \
  --host 127.0.0.1 --port 8765 --app-dir services/api
```

Common causes:

- **Missing Python packages:** activate the virtualenv and run
  `python -m pip install -r services/api/requirements.txt`.
- **Wrong interpreter:** `python` may point at a different environment. Use the
  virtualenv's interpreter or set `KLYRAUDIO_PYTHON`.
- **Port already in use:** see below.
- **Python not found on Windows:** install from python.org with "Add python.exe
  to PATH", or use the `py` launcher.
- **Damaged config:** the service moves a corrupt `config.json` aside and starts
  with defaults. Check for `config.broken.json`.

## Port 8765 is already in use

Find and stop the other process:

Windows PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 8765 -State Listen |
  Select-Object OwningProcess
Stop-Process -Id <pid>
```

macOS/Linux:

```bash
lsof -iTCP:8765 -sTCP:LISTEN
kill <pid>
```

Desktop development deliberately refuses to change ports so the Vite proxy
remains correct. Packaged desktop builds and web mode can use `--port` or
`KLYRAUDIO_PORT`.

## The web UI is blank or API calls fail in development

- Confirm the API is running on `127.0.0.1:8765`.
- Vite proxies `/api` there; changing the API port breaks the proxy.
- Open the browser console and network tab for the failing request.
- If the API is healthy but the UI is stale, restart `npm run dev`.

## The production UI does not load

The service serves the UI only when a built `index.html` exists.

```bash
npm run build
```

or point at a build explicitly:

```bash
KLYRAUDIO_WEB_DIR=/path/to/dist klyraudio-api
```

## FFmpeg is not detected

```bash
ffmpeg -version
ffprobe -version
```

- Install FFmpeg and ensure it is on `PATH`, or set `KLYRAUDIO_FFMPEG` and
  `KLYRAUDIO_FFPROBE`.
- Restart the service after changing the environment.
- WAV, FLAC, and AIFF export do not need FFmpeg. Lossy export needs the specific
  encoder (for example `libmp3lame`).
- Check available encoders with `ffmpeg -encoders`.

## An import fails

- The per-file upload limit is 1 GB.
- The extension must be in the supported list.
- Compressed formats need FFmpeg.
- The file must actually be audio; a renamed file fails validation.

## Export fails or reports verification failure

- Confirm the target folder is writable and has free space.
- For lossy formats, confirm FFmpeg and the encoder are present.
- Try WAV first to separate codec problems from source problems.
- A failed verification means the written file could not be decoded or was
  empty; the export is not recorded as successful.

## Model download fails

- **401/403 on Stable Audio Open:** accept the license on the Hugging Face model
  page and set `HF_TOKEN` before starting the service.
- **Checksum mismatch:** retry. If it persists, the mirror or network is
  altering the file; try another network or a later time.
- **Not enough disk space:** free space in the data directory. Klyraudio
  requires the download size plus a safety margin.
- **Another download running:** only one model download is allowed at a time.
  Cancel the active one or wait.
- **Missing optional packages:** install
  `services/api/requirements-models.txt` in the service environment.

## Model fails to load or generation runs out of memory

- Lower duration or variations.
- Choose MusicGen Small instead of Medium.
- Set GPU preference to `cpu` to confirm whether the GPU is the problem.
- Install a PyTorch build that matches your CUDA driver.
- On Apple Silicon, MPS may not support every operation. Try `cpu` if MPS
  errors persist.
- Close other GPU-heavy applications.

## A job stays queued

- The service may have been started with `--no-workers`.
- `max_concurrent_jobs` limits parallel work (1–4).
- Check `/api/jobs` and the logs for a failed worker.
- Restart the service; interrupted running jobs are marked failed on startup and
  can be retried.

## Desktop app shows a startup error

- Read the captured service logs on the error page.
- Verify Python and the API requirements in the environment the app will use.
- During development, free port `8765` first.
- Packaged builds need the Python API source under `resources/services/api`.
- Set `KLYRAUDIO_PYTHON` to a known-good interpreter and press **Retry**.

## Resetting local data

Stop the service, then move or delete the data directory. Klyraudio recreates
it with default settings. This removes projects, assets, exports, downloads, and
acknowledgements. Back up anything you want to keep first.

## Reporting a bug

Include:

- Klyraudio version and platform
- Mode (web or desktop)
- Steps to reproduce
- The relevant log lines with tokens and personal paths removed
- Whether FFmpeg and a GPU are present

Do not attach private prompts, personal audio, model weights, or access tokens.
Follow [SECURITY.md](../SECURITY.md) for vulnerabilities.
