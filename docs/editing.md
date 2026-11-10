# Audio editing

Klyraudio edits are non-destructive. An operation reads the selected asset,
writes a new 24-bit WAV, registers it as a new asset, and records the source as
its parent. The original file is never modified.

## Importing audio

Supported extensions: `.wav`, `.wave`, `.flac`, `.mp3`, `.ogg`, `.oga`, `.opus`,
`.m4a`, `.aac`, `.aiff`, `.aif`, `.aifc`, `.caf`, `.webm`.

- The upload limit is 1 GB per file.
- Extensions are hints; the decoder validates the actual content.
- WAV, FLAC, and AIFF decode without FFmpeg. Other formats need FFmpeg.
- Imported files are copied into the local data directory.
- Audio is normalized to mono or stereo for processing.

Imported assets appear in the library with origin `imported`, and can be edited,
used in projects, or exported.

## Operations

| Operation | Parameters | Behavior |
| --- | --- | --- |
| Trim | start, end (seconds) | Keeps only the selected range |
| Split | start (seconds) | Produces two assets (A and B) with short boundary fades |
| Insert silence | start, end | Replaces the range with silence |
| Fade in | duration | Linear fade from silence |
| Fade out | duration | Linear fade to silence |
| Gain | amount in dB | −60 dB to +24 dB |
| Normalize | none | Peak-normalizes to −1 dBFS |
| Reverse | none | Reverses the audio |
| Loop | crossfade seconds | Crossfades the end into the start for seamless looping |
| Duplicate | none | Copies the asset as a new edit |
| Join | 2–50 assets, crossfade 0–10 s | Concatenates assets, resampling to the highest source rate |

Fades must be greater than zero and fit within the audio. Loop crossfade
defaults to `min(1 second, duration / 4)` when not specified.

Join resamples parts to the highest sample rate among the selected assets. A
crossfade of zero gives a hard butt splice.

## Editor workflow

1. Choose an asset from the library or open one directly.
2. Pick the operation and set its parameters.
3. Apply. The result becomes the working copy and is saved in the library.
4. Use the in-session history controls to move between working copies. Every
   step remains a normal asset with its own id and parent.
5. Rename, tag, favorite, or export the result from the library.

The editor does not delete intermediate assets automatically. Remove them from
the library when they are no longer needed.

## Multitrack Studio

The Studio page arranges assets into a project:

- **Tracks:** volume (0–4×), pan (−1 left to +1 right), mute, solo.
- **Clips:** source asset, timeline start, source offset, duration, fade in,
  fade out, gain (0–4×).
- **Master:** volume, optional EQ/effects, normalization, limiter.

Rendering mixes the audible clips at their positions and applies clip gain and
fades, then track volume and pan, optional master effects, and master volume.
When normalization is off, a limiter at −0.3 dBFS is applied. Rendering creates
a normal library asset.

Autosave writes the project document through the same API as the explicit save
button. Autosave can be disabled per session. The project stores asset ids, not
audio copies, so moving or deleting a source asset can leave a clip unresolved.

## Tips

- Keep source audio in the library; edits reference the data directory.
- Use duplicate before destructive experiments (the original is still safe,
  but a duplicate keeps a clear named starting point).
- Insert silence rather than trimming when you need timing preserved.
- Normalize after joining if the parts have different loudness.
