# Technology decisions

This page records the stack choices that shape the repository.

## UI: React 18 + TypeScript + Vite

**Chosen** for a shared web/desktop UI, strong typing across API contracts, fast
local development, and a large accessibility and testing ecosystem.

The UI is a plain single-page app. It has no server-side rendering, no remote
font or asset CDN, and no runtime configuration fetch. This keeps it usable
offline and avoids leaking project data to third parties.

## Local service: Python 3.9+ + FastAPI

**Chosen** because audio DSP, NumPy, soundfile, and the neural model ecosystem
(PyTorch, Transformers, Diffusers) are Python-first. FastAPI provides typed
request validation, dependency wiring, and automatic OpenAPI documentation
without a heavy framework.

The service is not a cloud backend. It binds to `127.0.0.1` by default, rejects
remote origins, and is expected to run on the same machine as the UI.

## Desktop shell: Electron

**Chosen** over Tauri for this environment because it provides a consistent
Chromium runtime on Windows, macOS, and Linux, and the Rust toolchain required
by Tauri was not available. Electron also ships mature packaging and signing
hooks.

The trade-offs are accepted explicitly:

- Larger installers because Chromium is bundled.
- A separate process model to harden: context isolation, sandbox, no Node
  integration, no webviews, denied permissions, and navigation restricted to the
  local origin.
- Electron and Chromium license texts must remain in packaged builds.

## Persistence: SQLite

**Chosen** for a zero-configuration, single-file database that works offline and
supports transactions and indexes. Audio payloads stay on disk; the database
stores metadata and references.

## Built-in generation: Klyraudio Sketch

The default engine is a deterministic procedural DSP synthesizer implemented in
the service with NumPy. It is labeled non-AI in the UI. It exists so the studio
is useful and testable without a multi-gigabyte download or a GPU.

Sketch is not a substitute for a neural model. It does not understand arbitrary
descriptions; the model metadata lists that limitation.

## Neural models: adapters, not a framework

Each supported model has an explicit adapter with:

- A declared parameter set, duration range, and task list.
- Hardware estimates and known limitations.
- License metadata and acknowledgement requirements.
- A download manifest with excludes for duplicate checkpoint formats.

The UI renders controls from capabilities, so unsupported controls are not shown
for a model. Adapters report real progress and honor cancellation checkpoints.

## Rejected alternatives

- **Tauri:** smaller binaries, but no Rust toolchain in the target environment.
- **A server-rendered web app:** unnecessary for a local single-user tool and
  would complicate offline use.
- **Bundled model weights:** incompatible with the license and distribution
  constraints; downloads stay user-initiated.
- **Cloud inference:** violates the local-first requirement.
