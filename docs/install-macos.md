# Installing on macOS

## Requirements

- macOS 12 or newer
- Node.js 20+ and npm 10+
- Python 3.9+ (Homebrew Python or python.org)
- Xcode Command Line Tools for some Python packages
- Optional: FFmpeg for compressed import and lossy export

## Install the tools

With Homebrew:

```bash
brew install node python ffmpeg
xcode-select --install
```

FFmpeg is optional. Verify:

```bash
node --version
npm --version
python3 --version
ffmpeg -version
```

## Source install

```bash
git clone https://github.com/woxlo1/Klyraudio.git
cd Klyraudio

python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r services/api/requirements.txt

npm install
```

## Run

Web mode, two terminals:

```bash
npm run api:dev
npm run dev
```

Open <http://127.0.0.1:5173>.

Desktop mode:

```bash
npm run dev:desktop
```

Packaged layout:

```bash
npm run build
npm run build:desktop
```

Installers:

```bash
npm run dist --workspace @klyraudio/desktop
```

The DMG target is configured. Signing and notarization are not configured in
this repository. An unsigned app may require **System Settings → Privacy &
Security → Open Anyway** on first launch. Do not describe an unsigned build as
notarized.

## Apple Silicon and neural models

PyTorch can use the MPS backend on Apple Silicon, but support varies by model
and package version. MusicGen and Stable Audio may be slow or may fall back to
CPU. The Sketch engine always runs on CPU.

## Data location

Default: `~/Library/Application Support/Klyraudio`

Override with `KLYRAUDIO_DATA_DIR` or `--data-dir`.

## Troubleshooting

- `soundfile` fails to load: install FFmpeg or ensure libsndfile is available
  through the Python wheel.
- Gatekeeper blocks the app: verify you built it yourself, then allow it in
  Privacy & Security.
- Port 8765 is busy: stop the other process before desktop development.

See [troubleshooting.md](troubleshooting.md) for more.
