import type { JobStatus } from "../api/types";
import { useI18n } from "../i18n";
import { Badge } from "./ui";

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const { t } = useI18n();
  const tone =
    status === "completed"
      ? "success"
      : status === "failed"
        ? "danger"
        : status === "running"
          ? "accent"
          : status === "cancelled"
            ? "warning"
            : "neutral";
  return <Badge tone={tone}>{t(`status.${status}`)}</Badge>;
}
