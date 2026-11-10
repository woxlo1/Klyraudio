# Installing on Windows

## Requirements

- Windows 10 or 11, 64-bit
- Node.js 20+ and npm 10+
- Python 3.9+ (3.11 or 3.12 recommended)
- Git (for source installs)
- Optional: FFmpeg for MP3/Ogg/Opus/AAC/M4A and compressed imports

## Install the tools

Using winget:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Python.Python.3.12
winget install Git.Git
winget install Gyan.FFmpeg
```

Close and reopen the terminal after installing so `PATH` is refreshed. Verify:

```powershell
node --version
npm --version
py --version
ffmpeg -version
```

FFmpeg is optional. Without it, WAV, FLAC, and AIFF still work.

## Source install

```powershell
git clone https://github.com/woxlo1/Klyraudio.git
cd Klyraudio

py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r services/api/requirements.txt

npm install
```

If PowerShell blocks activation, either use `.venv\Scripts\activate.bat` in
`cmd.exe` or allow the current user's scripts:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## Run

Web mode, two terminals:

```powershell
npm run api:dev
npm run dev
```

Open <http://127.0.0.1:5173>.

Desktop mode:

```powershell
npm run dev:desktop
```

Packaged layout:

```powershell
npm run build
npm run build:desktop
```

The unpacked app is written under `apps/desktop/release/`. Installers are
produced with `npm run dist --workspace @klyraudio/desktop`. Builds are not code
signed unless you configure signing; Windows SmartScreen may warn about
unsigned binaries.

## Data location

Default: `%LOCALAPPDATA%\Klyraudio`

Override with the `KLYRAUDIO_DATA_DIR` environment variable or `--data-dir`.

## Troubleshooting

- `python` opens the Microsoft Store: use the `py` launcher or install Python
  from python.org with "Add python.exe to PATH".
- Port 8765 is busy: stop the other process. Desktop development deliberately
  fails instead of changing ports.
- No lossy export formats: install FFmpeg and restart the service.

See [troubleshooting.md](troubleshooting.md) for more.
