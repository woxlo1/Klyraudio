import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useI18n } from "../i18n";
import { clamp } from "../lib/format";

export interface Selection {
  start: number;
  end: number;
}

export function Waveform({
  peaks,
  duration,
  selection,
  playhead,
  onSelect,
  onSeek,
  height = 120,
  loading = false,
  label,
  className,
}: {
  peaks: number[][] | null;
  duration: number;
  selection?: Selection | null;
  playhead?: number;
  onSelect?: (selection: Selection | null) => void;
  onSeek?: (time: number) => void;
  height?: number;
  loading?: boolean;
  label?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);
  const dragRef = useRef<{ anchor: number; moved: boolean } | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next) setWidth(Math.max(120, next));
    });
    observer.observe(element);
    setWidth(Math.max(120, element.clientWidth));
    return () => observer.disconnect();
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const cssWidth = width;
    const cssHeight = height;
    canvas.width = Math.floor(cssWidth * ratio);
    canvas.height = Math.floor(cssHeight * ratio);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);

    const styles = getComputedStyle(canvas);
    const waveColor = styles.getPropertyValue("--wave-color").trim() || "rgba(140, 165, 255, 0.8)";
    const selectedColor = styles.getPropertyValue("--wave-selected").trim() || "rgba(111, 227, 255, 0.95)";
    const gridColor = styles.getPropertyValue("--wave-grid").trim() || "rgba(255, 255, 255, 0.08)";

    context.strokeStyle = gridColor;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, cssHeight / 2);
    context.lineTo(cssWidth, cssHeight / 2);
    context.stroke();

    if (!peaks || peaks.length === 0) {
      return;
    }

    const channel = peaks[0];
    const points = Math.floor(channel.length / 2);
    if (points === 0) return;
    const step = cssWidth / points;
    const selectedStart = selection ? Math.min(selection.start, selection.end) / Math.max(duration, 0.0001) : -1;
    const selectedEnd = selection ? Math.max(selection.start, selection.end) / Math.max(duration, 0.0001) : -1;
    const mid = cssHeight / 2;
    const amplitude = cssHeight * 0.42;

    if (selection && selectedEnd > selectedStart) {
      context.fillStyle = "rgba(111, 227, 255, 0.09)";
      context.fillRect(
        selectedStart * cssWidth,
        0,
        (selectedEnd - selectedStart) * cssWidth,
        cssHeight,
      );
    }

    for (let index = 0; index < points; index += 1) {
      const minimum = channel[index * 2] ?? 0;
      const maximum = channel[index * 2 + 1] ?? 0;
      const position = index / points;
      const isSelected = position >= selectedStart && position <= selectedEnd;
      context.strokeStyle = isSelected ? selectedColor : waveColor;
      context.lineWidth = Math.max(1, step * 0.62);
      const x = index * step + step / 2;
      const top = mid - clamp(maximum, -1, 1) * amplitude;
      const bottom = mid - clamp(minimum, -1, 1) * amplitude;
      context.beginPath();
      context.moveTo(x, top);
      context.lineTo(x, Math.max(bottom, top + 1));
      context.stroke();
    }

    if (playhead !== undefined && duration > 0) {
      const x = clamp(playhead / duration, 0, 1) * cssWidth;
      context.strokeStyle = styles.getPropertyValue("--wave-playhead").trim() || "#f2f6ff";
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, cssHeight);
      context.stroke();
    }

    if (hover !== null && duration > 0) {
      const x = clamp(hover / duration, 0, 1) * cssWidth;
      context.strokeStyle = "rgba(255, 255, 255, 0.16)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, cssHeight);
      context.stroke();
    }
  }, [duration, height, hover, peaks, playhead, selection, width]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new MutationObserver(() => draw());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [draw]);

  const timeFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>): number => {
    const rectangle = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - rectangle.left) / Math.max(1, rectangle.width), 0, 1);
    return ratio * duration;
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (duration <= 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const time = timeFromEvent(event);
    if (onSelect) {
      dragRef.current = { anchor: time, moved: false };
      onSelect({ start: time, end: time });
    } else {
      onSeek?.(time);
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (duration <= 0) return;
    const time = timeFromEvent(event);
    setHover(time);
    const drag = dragRef.current;
    if (!drag || !onSelect) return;
    if (Math.abs(time - drag.anchor) > duration * 0.002) drag.moved = true;
    onSelect({ start: Math.min(drag.anchor, time), end: Math.max(drag.anchor, time) });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (!drag.moved) {
      const time = timeFromEvent(event);
      onSeek?.(time);
      onSelect?.(null);
    }
  };

  return (
    <div
      ref={wrapperRef}
      className={["waveform", loading && "is-loading", className].filter(Boolean).join(" ")}
      style={{ height }}
      aria-busy={loading || undefined}
    >
      <canvas
        ref={canvasRef}
        className="waveform__canvas"
        role="img"
        aria-label={label ?? t("a11y.waveform")}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          setHover(null);
          dragRef.current = null;
        }}
        onKeyDown={(event) => {
          if (!onSeek || duration <= 0) return;
          if (event.key === "ArrowRight") {
            event.preventDefault();
            onSeek(Math.min(duration, (playhead ?? 0) + duration * 0.01));
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            onSeek(Math.max(0, (playhead ?? 0) - duration * 0.01));
          }
        }}
      />
      {loading ? <div className="waveform__loading" aria-hidden="true" /> : null}
    </div>
  );
}
