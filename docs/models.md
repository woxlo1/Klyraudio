# Models and licenses

Klyraudio ships one built-in engine and supports three optional neural models.
Model weights are never bundled. Every neural model is an explicit,
user-initiated download from Hugging Face.

## Model comparison

| Model | Tasks | Max duration | Parameters | Approx. size | Hardware |
| --- | --- | --- | --- | --- | --- |
| Klyraudio Sketch | music, sfx, ambient | 300 s | Rule-based DSP | 0 | CPU |
| MusicGen Small | music | 30 s | 300M | 3.5 GB | CUDA/MPS/CPU, ~4 GB VRAM |
| MusicGen Medium | music | 30 s | 1.5B | 12.2 GB | CUDA/MPS/CPU, ~9 GB VRAM |
| Stable Audio Open 1.0 | music, sfx, ambient | 47 s | Diffusion | 10.5 GB | CUDA/MPS/CPU, ~8 GB VRAM |

Sizes are estimates from the model registry and may change when the upstream
repository changes. The download manager reports the actual total before it
starts and checks free disk space plus a safety margin.

## Parameters

The UI shows only parameters a model declares support for.

- **MusicGen:** prompt, duration, seed, variations, guidance.
- **Stable Audio Open:** prompt, negative prompt, duration, seed, variations,
  guidance, steps.
- **Sketch:** prompt, duration, seed, variations, guidance, tempo, key, mood,
  style, instrumental, loop, quality.

Tempo, key, mood, and style are not honored by MusicGen or Stable Audio, so the
UI does not show them for those models.

## Sketch engine

`klyraudio-sketch` is a deterministic procedural synthesizer implemented with
NumPy. It is labeled as non-AI in the UI.

- Works offline and needs no download or GPU.
- Good for sketches, placeholders, loops, and sound design.
- Does not understand arbitrary descriptions as deeply as a neural model.
- Quality depends on synthesis parameters rather than training data.

## Licenses

| Model | Weights license | Commercial use | Redistribution |
| --- | --- | --- | --- |
| Klyraudio Sketch | GPL-3.0-only | Permitted | Permitted |
| MusicGen Small/Medium | CC BY-NC 4.0 | Not permitted | Permitted |
| Stable Audio Open 1.0 | Stability AI Community License | Conditional | Not permitted |

Important consequences:

- MusicGen weights are **non-commercial**. Do not use their output commercially
  without separate permission from the rights holder.
- Stable Audio Open is **gated** and its community license permits commercial
  use only under its revenue threshold and other terms. Read the license before
  commercial use.
- Generated audio is not automatically GPL-3.0. The model license, your input
  material, and local law govern the output.
- Klyraudio does not grant rights it does not hold.

The model details dialog links to the upstream license. Downloading a model that
requires acknowledgement records your acceptance time in
`<data>/config.json`.

## Downloading a model

1. Open **Model Manager**.
2. Review the model's size, hardware estimate, limitations, and license.
3. Accept the license when required.
4. Start the download and watch real byte progress.
5. Cancel at any time; partial files are cleaned up.
6. Klyraudio verifies SHA-256 checksums published by the host when available.

Only one model download runs at a time. Downloads use HTTPS with normal
certificate validation.

### Gated models (Stable Audio Open)

1. Create or sign in to a Hugging Face account.
2. Open the model page and accept its license.
3. Create a read access token.
4. Set `HF_TOKEN` (or `HUGGING_FACE_HUB_TOKEN`) in the environment that starts
   the service, then restart Klyraudio.
5. Retry the download.

Tokens are read from the environment, never stored by Klyraudio, and must not be
committed or shared in issues.

### Neural runtime packages

Adapters need optional Python packages in the same environment that runs the
service:

```bash
python -m pip install -r services/api/requirements-models.txt
```

If packages are missing, the Model Manager reports the missing dependency
instead of starting a job that cannot run. Install a CUDA build of PyTorch first
for NVIDIA acceleration.

## Removing a model

Removing a model deletes its files from `<data>/models/` and marks it not
installed. Projects that used it keep their rendered audio; new generation with
that model requires a new download. License acknowledgements remain recorded.

## Failure behavior

- Download errors are recorded with a message and can be retried.
- Checksum mismatches fail the download instead of accepting corrupt weights.
- Insufficient disk space is rejected before starting.
- Generation errors leave the job in a failed state with the adapter message.
- Cancellation is honored at adapter checkpoints; partially written audio is not
  registered as an asset.

## Testing without weights

The test suite exercises validation, queue transitions, cancellation, and
adapter metadata without downloading weights. Model-specific smoke tests are
optional and require the model to be installed locally.
