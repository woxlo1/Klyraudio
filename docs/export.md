# Export formats

Klyraudio exports an asset (generated, imported, edited, or rendered) from the
library. The export dialog lists only formats this machine can actually encode.

## Always available (libsndfile)

| Format | Extensions | Bit depths | Notes |
| --- | --- | --- | --- |
| WAV | `.wav` | 16, 24, 32-bit float | Lossless PCM / float |
| FLAC | `.flac` | 16, 24 | Lossless compressed |
| AIFF | `.aiff` | 16, 24 | Lossless PCM, big-endian container |

## Requires FFmpeg

These appear only when FFmpeg is available and reports the needed encoder.

| Format | Extension | Codec | Default bitrate |
| --- | --- | --- | --- |
| MP3 | `.mp3` | libmp3lame | 192 kbps |
| Ogg Vorbis | `.ogg` | libvorbis | 192 kbps |
| Opus | `.opus` | libopus | 128 kbps |
| AAC | `.aac` | aac (ADTS) | 192 kbps |
| M4A | `.m4a` | aac (MP4) | 192 kbps |

FFmpeg is not bundled. Install it and restart the service. If the encoder is
missing, the app reports the missing dependency instead of producing a broken
file.

## Options

- **Sample rate:** 22050, 32000, 44100, 48000, or 96000 Hz. Defaults to the
  source rate.
- **Channels:** mono or stereo. Defaults to the source channel count.
- **Bit depth:** built-in formats only; defaults to 24-bit.
- **Bitrate:** lossy formats only, 32–512 kbps.
- **Dither:** applied when exporting 16-bit.
- **Peak normalization:** optional target peak in dBFS.
- **Filename:** sanitized; the correct extension is added automatically, and an
  existing name is made unique instead of overwritten.

## Verification

After encoding, Klyraudio decodes the exported file and checks it before
recording the export as successful. A corrupt or empty output is reported as a
failure. The export history records the output path, format, settings, size, and
timestamp.

## Where files go

Exports are written to `<data>/exports/`. The export dialog shows the folder and
can open it in the system file manager.

## Format advice

- **WAV 24-bit** for further editing or archiving.
- **FLAC** for lossless distribution at a smaller size.
- **MP3/AAC/M4A** for broad playback compatibility.
- **Opus** for small files at good quality, if your target supports it.
- **Ogg Vorbis** for open, patent-light distribution.

Lossy codecs discard data. Keep a lossless master and export lossy copies from
it rather than re-encoding a lossy file repeatedly.

## Licensing note

The export container and codec are independent of Klyraudio's GPL-3.0 license.
FFmpeg builds and MP3/AAC patent licensing vary by distribution and
jurisdiction. Review [NOTICE.md](../NOTICE.md) before distributing builds or
commercial audio.
