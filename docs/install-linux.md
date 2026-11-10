# Installing on Linux

## Requirements

- A 64-bit desktop distribution with a modern glibc
- Node.js 20+ and npm 10+
- Python 3.9+ with venv support
- libsndfile
- Optional: FFmpeg for compressed import and lossy export
- A working X11 or Wayland session for the desktop app

## Install the tools

Debian/Ubuntu:

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip libsndfile1 ffmpeg git curl
```

Fedora:

```bash
sudo dnf install -y python3 python3-virtualenv libsndfile ffmpeg git
```

Arch:

```bash
sudo pacman -S python libsndfile ffmpeg git
```

Install Node.js 20+ from your distribution or the official NodeSource
instructions. Verify:

```bash
node --version
npm --version
python3 --version
```

FFmpeg is optional. WAV, FLAC, and AIFF work without it.

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

AppImage:

```bash
npm run dist --workspace @klyraudio/desktop
```

The AppImage target is configured. Code signing is not configured. Some
distributions require `--no-sandbox` for Electron in restricted containers; do
not use that on a normal desktop session.

## Data location

Default: `$XDG_DATA_HOME/klyraudio`, or `~/.local/share/klyraudio` when
`XDG_DATA_HOME` is unset.

Override with `KLYRAUDIO_DATA_DIR` or `--data-dir`.

## Troubleshooting

- `ModuleNotFoundError: soundfile`: install `libsndfile1` (Debian/Ubuntu) or
  `libsndfile` (Fedora/Arch).
- Electron fails under Wayland: try `--ozone-platform=wayland` or run under
  XWayland.
- Port 8765 is busy: stop the other process before desktop development.

See [troubleshooting.md](troubleshooting.md) for more.
