# Klyraudio third-party notices

Klyraudio, a local-first AI audio creation studio.

Copyright (C) 2026 Klyraudio contributors.

Klyraudio is free software licensed under the GNU General Public License,
version 3 only. See [LICENSE](LICENSE) for the complete license text.

This file records the third-party components the project builds on and the
licenses that apply to them. It is an inventory for transparency; the license
text shipped by each upstream project governs that component.

## Dependency license inventory

### Python service (runtime)

| Component | Version | License |
| --- | --- | --- |
| FastAPI | 0.115.6 | MIT |
| Uvicorn | 0.34.0 | BSD-3-Clause |
| Pydantic | 2.10.4 | MIT |
| NumPy | 1.26.4 | BSD-3-Clause |
| soundfile | 0.12.1 | BSD-3-Clause |
| HTTPX | 0.28.1 | BSD-3-Clause |
| python-multipart | 0.0.20 | Apache-2.0 |

### Web and desktop (runtime)

| Component | Version | License |
| --- | --- | --- |
| React | 18.3.1 | MIT |
| React DOM | 18.3.1 | MIT |
| React Router | 6.28.0 | MIT |
| lucide-react | 0.468.0 | ISC |
| Electron | 45.2.3 | MIT |

Electron distributions include Chromium and Node.js. Their license texts
(`LICENSE`, `LICENSES.chromium.html`, `LICENSE.electron.txt`) are part of the
Electron distribution and must remain in packaged builds.

### Development and test tooling

| Component | Version | License |
| --- | --- | --- |
| Vite | 6.0.7 | MIT |
| TypeScript | 5.7.2 | Apache-2.0 |
| Vitest | 2.1.8 | MIT |
| @testing-library/react | 16.1.0 | MIT |
| jsdom | 25.0.1 | MIT |
| ESLint | 9.17.0 | MIT |
| Prettier | 3.4.2 | MIT |
| electron-builder | 26.18.0 | MIT |
| pytest | 8.3.4 | MIT |
| Ruff | 0.8.4 | MIT |

The exact resolved dependency graph is recorded in `package-lock.json`.
Python versions are pinned in `services/api/requirements*.txt` and
`services/api/pyproject.toml`.

### Optional neural model runtime

These packages are not required for the built-in Sketch engine. They are
installed by users only when they want to run downloaded neural models.

| Component | Version constraint | License |
| --- | --- | --- |
| PyTorch | >=2.2,<3 | BSD-3-Clause |
| Transformers | >=4.44,<5 | Apache-2.0 |
| Diffusers | >=0.31,<1 | Apache-2.0 |
| Accelerate | >=1.0,<2 | Apache-2.0 |
| safetensors | >=0.4,<1 | Apache-2.0 |

## External tools

- **FFmpeg / FFprobe** are optional external programs used to decode imported
  formats and to encode MP3, Ogg Vorbis, Opus, AAC, and M4A. Klyraudio does not
  bundle FFmpeg. Users install it and remain responsible for the license of the
  build they install. Many FFmpeg builds are LGPL-2.1-or-later; some builds are
  GPL. Patent and codec licensing for MP3/AAC depends on the jurisdiction and
  distribution model. WAV, FLAC, and AIFF export use libsndfile and do not
  require FFmpeg.

## Model license inventory

Klyraudio does not bundle model weights. Every neural model is an optional,
user-initiated download. The application shows the license and requires an
acknowledgement before downloading a model that needs one.

| Model | Size (approx.) | License | Commercial use | Redistribution |
| --- | --- | --- | --- | --- |
| Klyraudio Sketch (`klyraudio-sketch`) | built in, 0 bytes | GPL-3.0-only (part of Klyraudio) | Permitted | Permitted |
| MusicGen Small (`musicgen-small`) | 3.5 GB | CC BY-NC 4.0 (weights); MIT (code) | Not permitted | Permitted |
| MusicGen Medium (`musicgen-medium`) | 12.2 GB | CC BY-NC 4.0 (weights); MIT (code) | Not permitted | Permitted |
| Stable Audio Open 1.0 (`stable-audio-open-1.0`) | 10.5 GB | Stability AI Community License | Conditional (revenue and terms apply) | Not permitted |

Model files are downloaded from Hugging Face into the user's Klyraudio data
directory. Stable Audio Open 1.0 is a gated repository: users must accept its
license on Hugging Face and supply their own access token. Klyraudio never
ships those tokens.

Generated audio is not automatically GPL-3.0. Rights in generated output are
governed by the model license, the input material, and applicable law. The
in-app model details show the relevant terms for every model.

## Build and distribution notes

- Release builds must include `LICENSE`, this notice file, and the Electron
  distribution license texts.
- Release builds must not include model weights, user audio, local databases,
  access tokens, or caches.
- The GPL-3.0 Corresponding Source for a distributed binary is the source tree
  that produced it, including build scripts and patches.
- Packaged installers do not bundle FFmpeg. Lossy export is offered only when
  the user's FFmpeg provides the required encoder.
- Platform signing and notarization are not implied by this repository. A build
  is not a signed release unless the release process actually signed it.

## Reporting licensing concerns

Open an issue that describes the component and the license concern without
attaching private prompts, personal audio, model weights, or tokens.
