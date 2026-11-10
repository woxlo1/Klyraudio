# Web mode

Web mode runs the FastAPI service and serves the built React UI from the same
loopback origin. It is the simplest way to use Klyraudio.

## Development mode

Run two processes:

```bash
npm run api:dev
npm run dev
```

- API: `http://127.0.0.1:8765`
- Vite: `http://127.0.0.1:5173`

Vite proxies `/api` to the API, so the UI always uses a relative base URL.
Changes to the UI hot-reload; changes to Python need a service restart.

## Production mode

```bash
npm run build
python -m pip install -e services/api   # once
klyraudio-api --open-browser
```

Without installing the package:

```bash
python -m uvicorn klyraudio_api.app:create_app --factory \
  --host 127.0.0.1 --port 8765 --app-dir services/api
```

Open <http://127.0.0.1:8765>. The service only mounts the UI when
`apps/web/dist/index.html` exists (or `KLYRAUDIO_WEB_DIR` points to a built UI).

## Options

```text
--host 127.0.0.1      bind address
--port 8765           port
--data-dir PATH       data directory
--no-workers          do not process the generation queue
--open-browser        open the UI after startup
```

Environment equivalents: `KLYRAUDIO_HOST`, `KLYRAUDIO_PORT`,
`KLYRAUDIO_DATA_DIR`.

## Exposing to the LAN

Loopback is the default and the supported configuration. Binding elsewhere
requires `KLYRAUDIO_ALLOW_LAN=1`, and the origin middleware still rejects
non-loopback request origins. Do not expose the service to an untrusted network:
it has no user authentication.

## API documentation

While the service runs, interactive OpenAPI docs are available at
`/api/docs` and the schema at `/api/openapi.json`. Set
`KLYRAUDIO_DISABLE_DOCS=1` to disable both.
