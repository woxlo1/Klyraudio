# Hardware requirements

Requirements depend on whether you use the built-in Sketch engine or a neural
model.

## Minimum (Sketch engine and editing)

- 64-bit Windows 10/11, macOS 12+, or a modern Linux desktop
- Dual-core CPU
- 4 GB system RAM
- 2 GB free disk space for the app, Python environment, and a small library
- Any display capable of running a modern browser or Electron

Sketch and all editing, project rendering, and WAV/FLAC/AIFF export work on CPU.

## Recommended

- 8-core CPU
- 16 GB system RAM
- SSD with at least 20 GB free if you plan to try one neural model
- NVIDIA GPU with 8 GB+ VRAM, or Apple Silicon with 16 GB+ unified memory
- FFmpeg installed for compressed import and lossy export

## Neural model requirements

| Model | VRAM estimate | RAM estimate | Download | Practical note |
| --- | --- | --- | --- | --- |
| MusicGen Small | ~4 GB | ~6 GB | ~3.5 GB | Works on 8 GB GPUs; CPU is slow |
| MusicGen Medium | ~9 GB | ~16 GB | ~12.2 GB | 8 GB GPUs may not fit |
| Stable Audio Open 1.0 | ~8 GB | ~12 GB | ~10.5 GB | Gated; may need offloading on 8 GB GPUs |

These are estimates. Actual memory use depends on duration, variations,
precision, and driver/runtime versions.

## Backend selection

Klyraudio detects available hardware and recommends a backend:

- **CUDA** for NVIDIA GPUs with a working driver.
- **MPS** for Apple Silicon when PyTorch reports it.
- **CPU** otherwise.

Settings allow `auto`, `cuda`, `mps`, or `cpu`. Selecting an unavailable backend
causes the model load to fail with an error; `auto` is the safe choice.

## Warnings shown by the app

- Less than 8 GB system RAM: neural models may fail to load.
- No supported discrete GPU: CPU inference may be very slow.
- A CUDA GPU with 8 GB or less VRAM: large models may need lower-memory modes.
- Low free disk space in the data directory.
- Missing FFmpeg: compressed import and lossy export are unavailable.

Warnings are advisory. A blocking warning prevents starting a job that cannot
fit the detected hardware.

## Disk planning

The application and Python environment are small compared with models. Add:

- 3.5 GB for MusicGen Small
- 12.2 GB for MusicGen Medium
- 10.5 GB for Stable Audio Open

Model downloads require extra temporary space while files are written. Keep at
least 1 GB free beyond the download size. Generated and edited audio also
accumulates in the data directory; remove unused assets from the library.

## GPU notes

- NVIDIA: install a CUDA-enabled PyTorch build that matches your driver.
- Apple Silicon: MPS support varies by PyTorch and Diffusers versions; some
  operations fall back to CPU or fail with an unsupported-op error.
- AMD and Intel GPUs are not supported by the current adapters.
- CI runs without a GPU; neural smoke tests are optional and local.
