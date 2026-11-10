import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  HardDrive,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { api } from "../api/client";
import type { DownloadInfo, LicenseCommercial, ModelInfo } from "../api/types";
import { ConfirmDialog, Modal } from "../components/Modal";
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
import { formatBytes, formatMemoryMb } from "../lib/format";
import { useDocumentTitle, usePolling } from "../lib/hooks";
import { useToast } from "../state/toast";

const INSTALL_COMMAND = "python -m pip install -r services/api/requirements-models.txt";

function commercialKey(value: LicenseCommercial): string {
  return `commercial${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function redistributionKey(value: LicenseCommercial): string {
  return `redistribution${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function availabilityKey(model: ModelInfo): string {
  switch (model.availability) {
    case "installed-missing-deps":
      return "installedMissingDeps";
    case "not-installed":
      return "notInstalled";
    default:
      return model.availability;
  }
}

export function ModelsPage() {
  const { t } = useI18n();
  const { notify } = useToast();
  useDocumentTitle(t("models.title"));

  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [downloads, setDownloads] = useState<DownloadInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [installTarget, setInstallTarget] = useState<ModelInfo | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ModelInfo | null>(null);
  const [removing, setRemoving] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const previousStatus = useRef<Map<string, string>>(new Map());

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const list = await api.models();
      setModels(list);
      setError(null);
    } catch (caught) {
      if (!quiet) setError(caught);
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  const loadDownloads = async () => {
    try {
      const list = await api.downloads();
      setDownloads(list);
      let needsModelRefresh = false;
      for (const download of list) {
        const previous = previousStatus.current.get(download.id);
        if (previous && previous !== download.status) {
          if (download.status === "completed") {
            notify({ message: t("models.downloadComplete"), tone: "success" });
            needsModelRefresh = true;
          } else if (download.status === "failed") {
            notify({ message: t("models.downloadFailed"), tone: "error" });
          } else if (download.status === "cancelled") {
            notify({ message: t("models.downloadCancelled"), tone: "info" });
          }
        }
        previousStatus.current.set(download.id, download.status);
      }
      if (needsModelRefresh) await load(true);
    } catch {
      // Keep the last known download list while the service is unavailable.
    }
  };

  useEffect(() => {
    void load();
    void loadDownloads();
    // The model list is loaded once when the page opens; downloads poll separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeDownloads = downloads.filter(
    (download) => download.status === "queued" || download.status === "running",
  );

  usePolling(loadDownloads, 2500, activeDownloads.length > 0);

  const installed = useMemo(
    () => (models ?? []).filter((model) => model.builtin || model.installed),
    [models],
  );
  const available = useMemo(
    () => (models ?? []).filter((model) => !model.builtin && !model.installed),
    [models],
  );
  const activeByModel = useMemo(() => {
    const map = new Map<string, DownloadInfo>();
    for (const download of activeDownloads) map.set(download.model_id, download);
    return map;
  }, [activeDownloads]);

  const startInstall = async () => {
    if (!installTarget) return;
    if (installTarget.requires_license_acknowledgement && !accepted) {
      notify({ message: t("models.licenseRequired"), tone: "warning" });
      return;
    }
    setInstalling(true);
    try {
      await api.installModel(installTarget.id, accepted);
      notify({ message: t("models.downloadStarted"), tone: "success" });
      setInstallTarget(null);
      setAccepted(false);
      await loadDownloads();
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
    } finally {
      setInstalling(false);
    }
  };

  const removeModel = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await api.removeModel(removeTarget.id);
      notify({ message: t("models.removed"), tone: "success" });
      setRemoveTarget(null);
      await load();
      await loadDownloads();
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
    } finally {
      setRemoving(false);
    }
  };

  const cancelDownload = async (download: DownloadInfo) => {
    setCancelling(download.id);
    try {
      await api.cancelDownload(download.id);
      notify({ message: t("models.downloadCancelled"), tone: "info" });
      await loadDownloads();
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
    } finally {
      setCancelling(null);
    }
  };

  const openModelsFolder = async () => {
    try {
      await api.openFolder("models");
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
    }
  };

  const copyCommand = async () => {
    await navigator.clipboard?.writeText(INSTALL_COMMAND);
    notify({ message: t("models.commandCopied"), tone: "success" });
  };

  return (
    <div className="page">
      <PageHeader
        title={t("models.title")}
        subtitle={t("models.subtitle")}
        actions={
          <>
            <Button
              icon={<FolderOpen size={16} aria-hidden="true" />}
              onClick={() => void openModelsFolder()}
            >
              {t("models.openFolder")}
            </Button>
            <Button
              icon={<RefreshCw size={16} aria-hidden="true" />}
              onClick={() => {
                void load();
                void loadDownloads();
              }}
            >
              {t("models.refresh")}
            </Button>
          </>
        }
      />

      {error ? <InlineNotice tone="danger">{describeError(error, t).message}</InlineNotice> : null}

      {activeDownloads.length > 0 ? (
        <Panel title={t("models.downloading")}>
          <ul className="download-list">
            {activeDownloads.map((download) => {
              const model = models?.find((item) => item.id === download.model_id);
              return (
                <li key={download.id} className="download-row">
                  <div className="download-row__head">
                    <strong>{model?.name ?? download.model_id}</strong>
                    <span className="muted small">
                      {download.total_bytes
                        ? `${formatBytes(download.downloaded_bytes)} / ${formatBytes(download.total_bytes)}`
                        : formatBytes(download.downloaded_bytes)}
                    </span>
                  </div>
                  <ProgressBar
                    value={download.progress}
                    label={
                      download.progress > 0
                        ? t("models.downloadProgress", { percent: Math.round(download.progress * 100) })
                        : t("models.downloadUnknown")
                    }
                  />
                  {download.current_file ? (
                    <span className="muted small mono-break">{download.current_file}</span>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={cancelling === download.id}
                    onClick={() => void cancelDownload(download)}
                  >
                    {t("models.cancelDownload")}
                  </Button>
                </li>
              );
            })}
          </ul>
        </Panel>
      ) : null}

      {loading && !models ? (
        <div className="loading-row">
          <Spinner /> <span>{t("common.loading")}</span>
        </div>
      ) : (
        <>
          <Panel title={t("models.installedModels")} subtitle={t("models.builtinNotice")}>
            {installed.length === 0 ? (
              <EmptyState compact title={t("models.noModels")} />
            ) : (
              <div className="model-grid">
                {installed.map((model) => (
                  <ModelCard
                    key={model.id}
                    model={model}
                    download={activeByModel.get(model.id) ?? null}
                    onInstall={() => {
                      setAccepted(false);
                      setInstallTarget(model);
                    }}
                    onRemove={() => setRemoveTarget(model)}
                    onCancel={(download) => void cancelDownload(download)}
                    onCopyCommand={() => void copyCommand()}
                    cancelling={Boolean(cancelling)}
                  />
                ))}
              </div>
            )}
          </Panel>

          <Panel title={t("models.availableModels")} subtitle={t("models.subtitle")}>
            {available.length === 0 ? (
              <EmptyState compact title={t("models.noModels")} />
            ) : (
              <div className="model-grid">
                {available.map((model) => (
                  <ModelCard
                    key={model.id}
                    model={model}
                    download={activeByModel.get(model.id) ?? null}
                    onInstall={() => {
                      setAccepted(false);
                      setInstallTarget(model);
                    }}
                    onRemove={() => setRemoveTarget(model)}
                    onCancel={(download) => void cancelDownload(download)}
                    onCopyCommand={() => void copyCommand()}
                    cancelling={Boolean(cancelling)}
                  />
                ))}
              </div>
            )}
          </Panel>

          <Panel title={t("models.license")} subtitle={t("models.licenseNotice")}>
            <p className="muted small">{t("models.installNotes")}</p>
          </Panel>
        </>
      )}

      {installTarget ? (
        <Modal
          title={t("models.installTitle", { name: installTarget.name })}
          description={t("models.installBody")}
          onClose={() => {
            setInstallTarget(null);
            setAccepted(false);
          }}
          size="lg"
          dismissible={!installing}
          footer={
            <>
              <Button
                onClick={() => {
                  setInstallTarget(null);
                  setAccepted(false);
                }}
                disabled={installing}
              >
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                icon={<Download size={15} aria-hidden="true" />}
                loading={installing}
                disabled={installTarget.requires_license_acknowledgement && !accepted}
                onClick={() => void startInstall()}
              >
                {t("models.confirmLicense")}
              </Button>
            </>
          }
        >
          <div className="stack">
            <div className="license-box">
              <div className="license-box__head">
                <ShieldAlert size={18} aria-hidden="true" />
                <strong>{installTarget.license_name}</strong>
              </div>
              <p className="muted small">
                <a href={installTarget.license_url} target="_blank" rel="noreferrer">
                  {t("models.licenseLink")} <ExternalLink size={12} aria-hidden="true" />
                </a>
              </p>
              <dl className="detail-list detail-list--inline">
                <div>
                  <dt>{t("models.commercialUse")}</dt>
                  <dd>{t(`models.${commercialKey(installTarget.commercial_use)}`)}</dd>
                </div>
                <div>
                  <dt>{t("models.redistribution")}</dt>
                  <dd>{t(`models.${redistributionKey(installTarget.redistribution)}`)}</dd>
                </div>
                <div>
                  <dt>{t("models.size")}</dt>
                  <dd>{installTarget.size_bytes ? formatBytes(installTarget.size_bytes) : "—"}</dd>
                </div>
                <div>
                  <dt>{t("models.vram")}</dt>
                  <dd>{installTarget.vram_estimate_mb ? formatMemoryMb(installTarget.vram_estimate_mb) : "—"}</dd>
                </div>
                <div>
                  <dt>{t("models.ram")}</dt>
                  <dd>{installTarget.ram_estimate_mb ? formatMemoryMb(installTarget.ram_estimate_mb) : "—"}</dd>
                </div>
                <div>
                  <dt>{t("models.os")}</dt>
                  <dd>{installTarget.operating_systems.join(", ")}</dd>
                </div>
              </dl>
            </div>

            {installTarget.gated ? (
              <InlineNotice tone="warning">
                <strong>{t("models.gatedTitle")}</strong>
                <p>{t("models.gatedBody")}</p>
                <a href={installTarget.source_url} target="_blank" rel="noreferrer" className="text-button">
                  {t("models.openModelPage")} <ExternalLink size={13} aria-hidden="true" />
                </a>
              </InlineNotice>
            ) : null}

            {installTarget.known_limitations.length > 0 ? (
              <div>
                <h4 className="small-heading">{t("models.limitations")}</h4>
                <ul className="bullet-list small">
                  {installTarget.known_limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {installTarget.requires_license_acknowledgement ? (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(event) => setAccepted(event.target.checked)}
                />
                <span>{t("models.acceptLicense")}</span>
              </label>
            ) : null}

            <div className="path-box path-box--muted">
              <HardDrive size={15} aria-hidden="true" />
              <code>{installTarget.source_url}</code>
            </div>
          </div>
        </Modal>
      ) : null}

      {removeTarget ? (
        <ConfirmDialog
          title={t("models.removeTitle", { name: removeTarget.name })}
          message={t("models.removeBody")}
          confirmLabel={t("models.removeConfirm")}
          danger
          busy={removing}
          onConfirm={() => void removeModel()}
          onClose={() => setRemoveTarget(null)}
        />
      ) : null}
    </div>
  );
}

function ModelCard({
  model,
  download,
  onInstall,
  onRemove,
  onCancel,
  onCopyCommand,
  cancelling,
}: {
  model: ModelInfo;
  download: DownloadInfo | null;
  onInstall: () => void;
  onRemove: () => void;
  onCancel: (download: DownloadInfo) => void;
  onCopyCommand: () => void;
  cancelling: boolean;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  return (
    <article className="model-card">
      <header className="model-card__head">
        <div>
          <h3>{model.name}</h3>
          <span className="muted small">{model.family}</span>
        </div>
        <Badge tone={model.builtin ? "accent" : "info"}>
          {model.builtin ? t("models.sketchBadge") : t("models.neuralBadge")}
        </Badge>
      </header>

      <p className="model-card__description">{model.description}</p>

      <div className="row row--wrap">
        <Badge tone={model.availability === "ready" ? "success" : model.availability === "installed-missing-deps" ? "danger" : model.availability === "unsupported" ? "warning" : "neutral"}>
          {t(`status.${availabilityKey(model)}`)}
        </Badge>
        {model.requires_license_acknowledgement && model.license_acknowledged ? (
          <Badge tone="info">{t("models.licenseAck")}</Badge>
        ) : null}
        {model.size_bytes !== null && !model.builtin ? (
          <span className="muted small">{t("models.downloadSize", { size: formatBytes(model.size_bytes) })}</span>
        ) : null}
      </div>

      {download ? (
        <div className="stack stack--tight">
          <ProgressBar
            value={download.progress}
            label={
              download.progress > 0
                ? t("models.downloadProgress", { percent: Math.round(download.progress * 100) })
                : t("models.downloadUnknown")
            }
          />
          <Button size="sm" variant="ghost" loading={cancelling} onClick={() => onCancel(download)}>
            {t("models.cancelDownload")}
          </Button>
        </div>
      ) : null}

      {model.availability === "installed-missing-deps" ? (
        <InlineNotice tone="danger">
          <strong>{t("models.missingDepsTitle")}</strong>
          <p>{model.availability_detail ?? t("models.missingDepsBody")}</p>
          <div className="inline-field">
            <code className="command-code">{INSTALL_COMMAND}</code>
            <Button size="sm" variant="ghost" icon={<Copy size={14} aria-hidden="true" />} onClick={onCopyCommand}>
              {t("models.copyCommand")}
            </Button>
          </div>
        </InlineNotice>
      ) : null}

      {model.availability === "unsupported" && model.availability_detail ? (
        <InlineNotice tone="warning">{model.availability_detail}</InlineNotice>
      ) : null}

      {expanded ? (
        <div className="model-card__details">
          <dl className="detail-list detail-list--inline">
            <div><dt>{t("models.vram")}</dt><dd>{model.vram_estimate_mb ? formatMemoryMb(model.vram_estimate_mb) : "—"}</dd></div>
            <div><dt>{t("models.ram")}</dt><dd>{model.ram_estimate_mb ? formatMemoryMb(model.ram_estimate_mb) : "—"}</dd></div>
            <div><dt>{t("models.runtime")}</dt><dd>{model.runtime.join(", ")}</dd></div>
            <div><dt>{t("models.acceleration")}</dt><dd>{model.acceleration.join(", ")}</dd></div>
            <div><dt>{t("models.os")}</dt><dd>{model.operating_systems.join(", ")}</dd></div>
            <div><dt>{t("models.license")}</dt><dd>{model.license_name}</dd></div>
            <div><dt>{t("models.commercialUse")}</dt><dd>{t(`models.${commercialKey(model.commercial_use)}`)}</dd></div>
            <div><dt>{t("models.redistribution")}</dt><dd>{t(`models.${redistributionKey(model.redistribution)}`)}</dd></div>
            {model.installed_path ? (
              <div><dt>{t("models.installLocation")}</dt><dd className="mono-break">{model.installed_path}</dd></div>
            ) : null}
          </dl>
          <p className="muted small">
            <a href={model.license_url} target="_blank" rel="noreferrer">
              {model.license_name} <ExternalLink size={12} aria-hidden="true" />
            </a>{" "}
            ·{" "}
            <a href={model.source_url} target="_blank" rel="noreferrer">
              {t("models.source")} <ExternalLink size={12} aria-hidden="true" />
            </a>
          </p>
          {model.known_limitations.length > 0 ? (
            <div>
              <h4 className="small-heading">{t("models.limitations")}</h4>
              <ul className="bullet-list small">
                {model.known_limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <footer className="model-card__actions">
        <Button size="sm" variant="ghost" onClick={() => setExpanded((value) => !value)}>
          {expanded ? t("common.less") : t("common.details")}
        </Button>
        <span className="spacer" />
        {model.builtin ? (
          <span className="inline-status">
            <CheckCircle2 size={14} aria-hidden="true" /> {t("models.builtinNotice")}
          </span>
        ) : model.installed ? (
          <Button size="sm" variant="danger" icon={<Trash2 size={14} aria-hidden="true" />} onClick={onRemove}>
            {t("models.removeModel")}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            icon={<Download size={14} aria-hidden="true" />}
            onClick={onInstall}
            disabled={Boolean(download)}
          >
            {t("models.install")}
          </Button>
        )}
      </footer>
    </article>
  );
}
