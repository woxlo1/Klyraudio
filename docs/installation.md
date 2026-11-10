# Installation

Klyraudio runs in two modes:

- **Web mode:** a local Python service serves the built UI at
  `http://127.0.0.1:8765`.
- **Desktop mode:** an Electron app starts and supervises that same service.

Both modes need the Python service dependencies. There is no hosted cloud
version.

## Platform guides

- [Windows](install-windows.md)
- [macOS](install-macos.md)
- [Linux](install-linux.md)

## Mode guides

- [Web mode](web-mode.md)
- [Desktop mode](desktop-mode.md)

## Hardware requirements

See [hardware.md](hardware.md). The Sketch engine runs on a modest CPU. Neural
models need substantially more RAM, disk, and ideally a supported GPU.

## What is not included

- Model weights. They are optional, user-initiated downloads with license
  acknowledgement.
- FFmpeg. It is optional and used for compressed import and lossy export.
- An account, cloud storage, or sync service.

## After installation

1. Open the app and complete the onboarding checks.
2. Confirm the data directory and available disk space.
3. Generate a short clip with the built-in Sketch engine.
4. Export it and verify the file plays.
5. Only then download a neural model if you need one.

If something fails, see [troubleshooting.md](troubleshooting.md).
