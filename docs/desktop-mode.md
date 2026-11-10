# Desktop mode

The Electron shell runs the same UI and manages the Python service for the user.

## Responsibilities of the shell

- Resolve a Python interpreter (`KLYRAUDIO_PYTHON`, the repository `.venv`,
  then `PATH`).
- Start the service on `127.0.0.1` and wait for `/api/health`.
- Show a startup page, then the studio.
- Monitor the service and restart it after repeated health failures.
- Stop the service when the app quits.
- Keep the renderer sandboxed and restricted to the local origin.

## Development

```bash
npm run dev:desktop
```

The launcher:

1. Starts `npm run dev --workspace @klyraudio/web`.
2. Waits for port `5173`.
3. Starts Electron with `KLYRAUDIO_WEB_URL=http://127.0.0.1:5173`.

Electron still starts the Python service. Port `8765` must be free; the launcher
does not change ports in development so the Vite proxy stays valid. Stop any
other Klyraudio service first.

To run Electron against an already running backend without spawning another:
set `KLYRAUDIO_SKIP_BACKEND=1`.

## Packaged build

```bash
npm run build
npm run build:desktop
```

This produces an unpacked app under `apps/desktop/release/`. Installers:

```bash
npm run dist --workspace @klyraudio/desktop
```

Configured targets:

- Windows: NSIS
- macOS: DMG
- Linux: AppImage

Packaged builds include `apps/web/dist` and the Python package source under
`resources/`. They do **not** include model weights or a Python interpreter.
The user must have Python with the API requirements installed, or set
`KLYRAUDIO_PYTHON` to a suitable interpreter.

Packaged builds may use a free port if `8765` is occupied. The window loads the
service URL reported by the backend manager.

## Signing

Code signing and notarization are not configured. Unsigned builds may trigger
operating-system warnings. Do not claim a release is signed unless the build
pipeline actually signed it.

## Security settings

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- `webviewTag: false`
- Permission requests and checks denied
- New windows denied; HTTPS links open in the default browser
- Navigation restricted to the allowed local origin
- Single-instance lock

The preload bridge exposes only platform/version data, service status, restart,
and a status subscription.

## Troubleshooting

The window shows captured service logs when startup fails. Common causes:

- Python is not installed or missing API dependencies.
- Port `8765` is occupied during development.
- The backend source is missing from the packaged `resources/` directory.

Use the **Retry** button after fixing the cause. See
[troubleshooting.md](troubleshooting.md).
