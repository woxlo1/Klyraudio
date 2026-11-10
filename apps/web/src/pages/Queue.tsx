import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Ban,
  ChevronDown,
  ChevronUp,
  FileAudio,
  ListMusic,
  Pencil,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { api } from "../api/client";
import type { AssetInfo, JobInfo, ModelInfo } from "../api/types";
import { ConfirmDialog } from "../components/Modal";
import { JobStatusBadge } from "../components/StatusBadge";
import {
  Badge,
  Button,
  EmptyState,
  InlineNotice,
  PageHeader,
  Panel,
  ProgressBar,
  Spinner,
} from "../components/ui";
import { useI18n } from "../i18n";
import { describeError } from "../lib/errors";
import { formatDuration } from "../lib/format";
import { useDocumentTitle, usePolling } from "../lib/hooks";
import { addAssetToNewProject } from "../lib/studioActions";
import { useToast } from "../state/toast";

export function QueuePage() {
  const { t, formatDate, formatRelative } = useI18n();
  const { notify } = useToast();
  const navigate = useNavigate();
  useDocumentTitle(t("queue.title"));

  const [jobs, setJobs] = useState<JobInfo[] | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [showFinished, setShowFinished] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<JobInfo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    try {
      const list = await api.jobs();
      setJobs(list);
      setError(null);
    } catch (caught) {
      setError(caught);
    }
  };

  useEffect(() => {
    void load();
    const loadModels = async () => {
      try {
        setModels(await api.models());
      } catch {
        // Model names are cosmetic; jobs still render with their identifiers.
      }
    };
    void loadModels();
  }, []);

  usePolling(load, 4000);

  const modelNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const model of models) map.set(model.id, model.name);
    return map;
  }, [models]);

  const active = (jobs ?? []).filter((job) => job.status === "queued" || job.status === "running");
  const finished = (jobs ?? []).filter(
    (job) => job.status === "completed" || job.status === "failed" || job.status === "cancelled",
  );

  const cancelJob = async (job: JobInfo) => {
    setBusy(job.id);
    try {
      await api.cancelJob(job.id);
      notify({ message: t("queue.cancelled"), tone: "info" });
      await load();
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const retryJob = async (job: JobInfo) => {
    setBusy(job.id);
    try {
      await api.retryJob(job.id);
      notify({ message: t("queue.retryCreated"), tone: "success" });
      await load();
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const deleteJob = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteJob(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
    } finally {
      setDeleting(false);
    }
  };

  const sendToStudio = async (assetId: string) => {
    setBusy(assetId);
    try {
      const asset: AssetInfo = await api.asset(assetId);
      const project = await addAssetToNewProject(asset);
      notify({ message: t("generate.sentToStudio"), tone: "success" });
      navigate(`/studio/${project.id}`);
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={t("queue.title")}
        subtitle={t("queue.subtitle")}
        actions={
          <>
            <Badge tone={active.length > 0 ? "accent" : "neutral"}>
              {t("nav.activeJobs", { count: active.length })}
            </Badge>
            <Button icon={<RefreshCw size={16} aria-hidden="true" />} onClick={() => void load()}>
              {t("common.refresh")}
            </Button>
            <Button variant="primary" onClick={() => navigate("/generate/music")}>
              {t("queue.createMusic")}
            </Button>
          </>
        }
      />

      {error ? <InlineNotice tone="danger">{describeError(error, t).message}</InlineNotice> : null}

      <Panel title={t("queue.active")} subtitle={t("queue.subtitle")}>
        {jobs === null ? (
          <div className="loading-row">
            <Spinner /> <span>{t("common.loading")}</span>
          </div>
        ) : active.length === 0 ? (
          <EmptyState
            compact
            icon={<ListMusic size={22} aria-hidden="true" />}
            title={t("queue.noJobsActive")}
            action={
              <Button size="sm" onClick={() => navigate("/generate/music")}>
                {t("queue.createMusic")}
              </Button>
            }
          />
        ) : (
          <ul className="job-list">
            {active.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                modelName={modelNames.get(job.model_id) ?? job.model_id}
                busy={busy === job.id}
                onCancel={() => void cancelJob(job)}
                onRetry={() => void retryJob(job)}
                onDelete={() => setDeleteTarget(job)}
                onOpenAsset={(assetId) => navigate(`/editor/${assetId}`)}
                onSendAsset={(assetId) => void sendToStudio(assetId)}
                formatDate={formatDate}
                formatRelative={formatRelative}
              />
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title={t("queue.history")}
        action={
          <Button
            size="sm"
            variant="ghost"
            icon={
              showFinished ? (
                <ChevronUp size={14} aria-hidden="true" />
              ) : (
                <ChevronDown size={14} aria-hidden="true" />
              )
            }
            onClick={() => setShowFinished((value) => !value)}
          >
            {showFinished ? t("queue.hideFinished") : t("queue.showFinished")}
          </Button>
        }
      >
        {showFinished ? (
          finished.length === 0 ? (
            <EmptyState compact title={t("queue.emptyTitle")} body={t("queue.emptyBody")} />
          ) : (
            <ul className="job-list">
              {finished.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  modelName={modelNames.get(job.model_id) ?? job.model_id}
                  busy={busy === job.id}
                  onCancel={() => void cancelJob(job)}
                  onRetry={() => void retryJob(job)}
                  onDelete={() => setDeleteTarget(job)}
                  onOpenAsset={(assetId) => navigate(`/editor/${assetId}`)}
                  onSendAsset={(assetId) => void sendToStudio(assetId)}
                  formatDate={formatDate}
                  formatRelative={formatRelative}
                />
              ))}
            </ul>
          )
        ) : null}
      </Panel>

      {deleteTarget ? (
        <ConfirmDialog
          title={t("queue.deleteTitle")}
          message={t("queue.deleteBody")}
          confirmLabel={t("queue.delete")}
          danger
          busy={deleting}
          onConfirm={() => void deleteJob()}
          onClose={() => setDeleteTarget(null)}
        />
      ) : null}
    </div>
  );
}

function JobCard({
  job,
  modelName,
  busy,
  onCancel,
  onRetry,
  onDelete,
  onOpenAsset,
  onSendAsset,
  formatDate,
  formatRelative,
}: {
  job: JobInfo;
  modelName: string;
  busy: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onDelete: () => void;
  onOpenAsset: (assetId: string) => void;
  onSendAsset: (assetId: string) => void;
  formatDate: (iso: string | null | undefined, withTime?: boolean) => string;
  formatRelative: (iso: string | null | undefined) => string;
}) {
  const { t } = useI18n();
  const isActive = job.status === "queued" || job.status === "running";
  const canRetry = job.status === "failed" || job.status === "cancelled";

  return (
    <li className={`job-card job-card--${job.status}`}>
      <div className="job-card__head">
        <div className="job-card__title">
          <JobStatusBadge status={job.status} />
          <Badge tone="neutral">{t(`task.${job.task}`)}</Badge>
          <strong>{job.prompt}</strong>
        </div>
        <span className="muted small" title={formatDate(job.created_at)}>
          {formatRelative(job.created_at)}
        </span>
      </div>

      {isActive ? (
        <ProgressBar
          value={job.status === "queued" ? 0 : job.progress}
          label={
            job.progress_label ??
            (job.progress === null ? t("queue.indeterminate") : t("queue.processing"))
          }
        />
      ) : null}

      <dl className="detail-list detail-list--inline job-card__meta">
        <div>
          <dt>{t("queue.model")}</dt>
          <dd>{modelName}</dd>
        </div>
        <div>
          <dt>{t("queue.task")}</dt>
          <dd>{t(`task.${job.task}`)}</dd>
        </div>
        <div>
          <dt>{t("queue.durationRequested")}</dt>
          <dd>{formatDuration(job.duration_requested)}</dd>
        </div>
        <div>
          <dt>{t("queue.variationsCount")}</dt>
          <dd>{job.requested_variations}</dd>
        </div>
        <div>
          <dt>{t("queue.seed")}</dt>
          <dd>{job.seed ?? "—"}</dd>
        </div>
        {job.backend ? (
          <div>
            <dt>{t("queue.backend")}</dt>
            <dd>{job.backend}</dd>
          </div>
        ) : null}
        <div>
          <dt>{t("common.created")}</dt>
          <dd>{formatDate(job.created_at)}</dd>
        </div>
        {job.started_at ? (
          <div>
            <dt>{t("queue.startedAt", { time: "" })}</dt>
            <dd>{formatDate(job.started_at)}</dd>
          </div>
        ) : null}
        {job.finished_at ? (
          <div>
            <dt>{t("queue.finishedAt", { time: "" })}</dt>
            <dd>{formatDate(job.finished_at)}</dd>
          </div>
        ) : null}
      </dl>

      {job.error ? (
        <div className="job-error" role="alert">
          <strong>{t("queue.errorTitle")}</strong>
          <p>{job.error.message ?? t("errors.generic")}</p>
          {job.error.code ? (
            <span className="muted small">{t("queue.errorCode", { code: job.error.code })}</span>
          ) : null}
          {job.error.remediation ? (
            <>
              <strong>{t("queue.errorRemediation")}</strong>
              <p>{job.error.remediation}</p>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="job-card__outputs">
        <span className="small-heading">{t("queue.outputs")}</span>
        {job.output_asset_ids.length === 0 ? (
          <span className="muted small">{t("queue.noOutputs")}</span>
        ) : (
          <ul className="output-list">
            {job.output_asset_ids.map((assetId, index) => (
              <li key={assetId}>
                <FileAudio size={14} aria-hidden="true" />
                <span className="muted small">
                  {t("queue.outputReady")} {index + 1}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Pencil size={13} aria-hidden="true" />}
                  onClick={() => onOpenAsset(assetId)}
                >
                  {t("generate.viewInEditor")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy}
                  onClick={() => onSendAsset(assetId)}
                >
                  {t("generate.addToStudio")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="job-card__actions">
        {isActive ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<Ban size={14} aria-hidden="true" />}
            loading={busy}
            onClick={onCancel}
          >
            {t("queue.cancel")}
          </Button>
        ) : null}
        {canRetry ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<RotateCcw size={14} aria-hidden="true" />}
            loading={busy}
            onClick={onRetry}
          >
            {t("queue.retry")}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          icon={<Trash2 size={14} aria-hidden="true" />}
          onClick={onDelete}
        >
          {t("queue.delete")}
        </Button>
      </div>
    </li>
  );
}
