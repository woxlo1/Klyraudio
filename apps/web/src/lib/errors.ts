import { ApiError } from "../api/client";
import type { TranslateVars } from "../i18n";

export interface DescribedError {
  code: string;
  message: string;
  remediation?: string | null;
  requestId?: string;
  offline: boolean;
}

type Translate = (key: string, vars?: TranslateVars) => string;

export function describeError(error: unknown, t: Translate): DescribedError {
  if (error instanceof ApiError) {
    const key = `errors.${error.code}`;
    const translated = t(key);
    const message = translated === key ? error.message : translated;
    return {
      code: error.code,
      message,
      remediation: error.remediation,
      requestId: error.requestId,
      offline: error.isOffline,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: "unknown",
    message: t("errors.unknown", { message }),
    offline: false,
  };
}

export function errorCode(error: unknown): string {
  return error instanceof ApiError ? error.code : "unknown";
}

export function truncate(value: string, length: number): string {
  if (value.length <= length) return value;
  return `${value.slice(0, Math.max(0, length - 1))}…`;
}
