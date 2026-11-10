import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Pause, Play, Repeat, Square, Volume2, VolumeX } from "lucide-react";
import { useI18n } from "../i18n";
import { clamp, formatDuration } from "../lib/format";
import { IconButton } from "./ui";

export interface AudioPlayerHandle {
  play: () => Promise<void>;
  pause: () => void;
  toggle: () => void;
  stop: () => void;
  seek: (time: number) => void;
  playRange: (start: number, end: number) => void;
  getCurrentTime: () => number;
}

interface AudioPlayerProps {
  src: string | null;
  title?: string;
  durationHint?: number;
  compact?: boolean;
  initialLoop?: boolean;
  onTimeUpdate?: (time: number) => void;
  onEnded?: () => void;
  onError?: () => void;
  className?: string;
}

export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(function AudioPlayer(
  {
    src,
    title,
    durationHint,
    compact = false,
    initialLoop = false,
    onTimeUpdate,
    onEnded,
    onError,
    className,
  },
  ref,
) {
  const { t } = useI18n();
  const audioRef = useRef<HTMLAudioElement>(null);
  const rangeEndRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(durationHint ?? 0);
  const [volume, setVolume] = useState(0.9);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(initialLoop);
  const [error, setError] = useState(false);

  useEffect(() => {
    setTime(0);
    setError(false);
    setPlaying(false);
    setDuration(durationHint ?? 0);
    rangeEndRef.current = null;
  }, [src, durationHint]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = muted ? 0 : volume;
    audio.loop = loop;
  }, [volume, muted, loop]);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      audio?.pause();
    };
  }, []);

  const play = async () => {
    const audio = audioRef.current;
    if (!audio || !src) return;
    try {
      await audio.play();
      setPlaying(true);
      setError(false);
    } catch {
      setPlaying(false);
      setError(true);
      onError?.();
    }
  };

  const pause = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setPlaying(false);
    rangeEndRef.current = null;
  };

  const stop = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    rangeEndRef.current = null;
    setPlaying(false);
    setTime(0);
  };

  const seek = (next: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const target = clamp(next, 0, duration || audio.duration || 0);
    audio.currentTime = target;
    setTime(target);
    onTimeUpdate?.(target);
  };

  useImperativeHandle(ref, () => ({
    play,
    pause,
    toggle: () => {
      if (playing) pause();
      else void play();
    },
    stop,
    seek,
    playRange: (start: number, end: number) => {
      const audio = audioRef.current;
      if (!audio || !src) return;
      audio.currentTime = Math.max(0, start);
      rangeEndRef.current = end > start ? end : null;
      void play();
    },
    getCurrentTime: () => audioRef.current?.currentTime ?? 0,
  }));

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const end = rangeEndRef.current;
    if (end !== null && audio.currentTime >= end) {
      audio.pause();
      setPlaying(false);
      setTime(end);
      rangeEndRef.current = null;
      onEnded?.();
      return;
    }
    setTime(audio.currentTime);
    onTimeUpdate?.(audio.currentTime);
  };

  return (
    <div className={["player", compact && "player--compact", className].filter(Boolean).join(" ")}>
      <audio
        ref={audioRef}
        src={src ?? undefined}
        preload="metadata"
        onLoadedMetadata={() => {
          const audio = audioRef.current;
          if (audio && Number.isFinite(audio.duration)) setDuration(audio.duration);
        }}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setTime(0);
          onEnded?.();
        }}
        onError={() => {
          setError(true);
          onError?.();
        }}
      />
      <div className="player__controls">
        <IconButton
          label={playing ? t("common.pause") : t("common.play")}
          onClick={() => (playing ? pause() : void play())}
          disabled={!src}
          active={playing}
        >
          {playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
        </IconButton>
        <IconButton label={t("common.stop")} onClick={stop} disabled={!src} size="sm">
          <Square size={14} aria-hidden="true" />
        </IconButton>
        <div className="player__timeline">
          <input
            type="range"
            className="player__seek"
            min={0}
            max={duration || 1}
            step={0.01}
            value={Math.min(time, duration || 1)}
            onChange={(event) => seek(Number(event.target.value))}
            disabled={!src}
            aria-label={t("a11y.seek")}
          />
          <div className="player__time" aria-live="off">
            <span>{formatDuration(time)}</span>
            <span className="muted">/ {formatDuration(duration)}</span>
          </div>
        </div>
        {compact ? null : (
          <>
            <IconButton
              label={loop ? t("common.loop") : t("common.loop")}
              onClick={() => setLoop((value) => !value)}
              active={loop}
              size="sm"
            >
              <Repeat size={15} aria-hidden="true" />
            </IconButton>
            <div className="player__volume">
              <IconButton
                label={muted ? t("common.unmute") : t("common.mute")}
                onClick={() => setMuted((value) => !value)}
                size="sm"
              >
                {muted || volume === 0 ? (
                  <VolumeX size={15} aria-hidden="true" />
                ) : (
                  <Volume2 size={15} aria-hidden="true" />
                )}
              </IconButton>
              <input
                type="range"
                className="player__volume-range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={(event) => {
                  setVolume(Number(event.target.value));
                  setMuted(false);
                }}
                aria-label={t("common.volume")}
              />
            </div>
          </>
        )}
      </div>
      {title ? <span className="player__title">{title}</span> : null}
      {error ? <span className="player__error">{t("library.playError")}</span> : null}
    </div>
  );
});
