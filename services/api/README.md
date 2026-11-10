# Klyraudio local API

FastAPI service for Klyraudio. It binds to loopback, stores its SQLite database
and media under the Klyraudio data directory, and serves the built web UI when
`apps/web/dist` exists.

## Install for development

```bash
python -m pip install -e "services/api[dev]"
```

## Run

```bash
klyraudio-api --open-browser
```

Or from the repository root without installing:

```bash
python -m uvicorn klyraudio_api.app:create_app --factory \
  --host 127.0.0.1 --port 8765 --app-dir services/api
```

## Test

```bash
python -m pytest services/api/tests -q
```

Licensed under GPL-3.0-only. See the repository `LICENSE` and `NOTICE.md`.
