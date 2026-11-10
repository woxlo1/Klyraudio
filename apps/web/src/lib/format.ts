export function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function uid(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${random}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, seconds);
  const whole = Math.floor(total);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = Math.floor(whole % 60);
  const tenths = Math.floor((total - whole) * 10);
  const mm = minutes.toString().padStart(hours > 0 ? 2 : 1, "0");
  const ss = secs.toString().padStart(2, "0");
  const base = hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
  return tenths > 0 && total < 60 ? `${base}.${tenths}` : base;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[index]}`;
}

export function formatMemoryMb(mb: number | null | undefined): string {
  if (mb === null || mb === undefined) return "—";
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB`;
  return `${Math.round(mb)} MB`;
}

export function formatMemoryPct(ratio: number | null | undefined): string {
  return formatPercent(ratio);
}

export function formatSampleRate(hz: number | null | undefined): string {
  if (!hz) return "—";
  return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)} kHz`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${Math.round(clamp(value, 0, 1) * 100)}%`;
}

export function signedDb(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} dB`;
}

export function panLabel(
  value: number,
  labels: { left: string; center: string; right: string },
): string {
  if (Math.abs(value) < 0.02) return labels.center;
  const side = value < 0 ? labels.left : labels.right;
  return `${side} ${Math.round(Math.abs(value) * 100)}%`;
}

export function downloadFileName(name: string, extension: string): string {
  const stem =
    name
      .replace(/[<>:"/\\|?*]/g, "")
      .replace(/\p{Cc}/gu, "")
      .trim() || "audio";
  return stem.toLowerCase().endsWith(`.${extension}`) ? stem : `${stem}.${extension}`;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}
