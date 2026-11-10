import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Cpu,
  FolderOpen,
  HardDrive,
  Info,
  Languages,
  MemoryStick,
  RefreshCw,
  Shield,
  Sparkles,
} from "lucide-react";
import { api } from "../api/client";
import type {
  ExportCapabilities,
  HealthResponse,
  RuntimeSettingsUpdate,
  StorageInfo,
} from "../api/types";
import {
  Badge,
  Button,
  InlineNotice,
  PageHeader,
  Panel,
  RangeField,
  Select,
  Spinner,
  Switch,
} from "../components/ui";
import { useI18n } from "../i18n";
import type { Locale } from "../i18n/types";
import { describeError } from "../lib/errors";
import { formatBytes, formatMemoryMb, formatMemoryPct } from "../lib/format";
import { useDocumentTitle } from "../lib/hooks";
import { useSettings } from "../state/settings";
import { useToast } from "../state/toast";

const SAMPLE_RATES = [22050, 32000, 44100, 48000, 96000];
const FALLBACK_FORMATS = ["wav", "flac", "aiff", "mp3", "ogg", "opus"];

export function SettingsPage() {
  const { t, language } = useI18n();
  const {
    settings,
    system,
    online,
    loading,
    loadError,
    refresh,
    update,
    setLanguage,
  } = useSettings();
  const { notify } = useToast();
  const navigate = useNavigate();
  useDocumentTitle(t("settings.title"));

  const [capabilities, setCapabilities] = useState<ExportCapabilities | null>(null);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [exportFolder, setExportFolder] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const results = await Promise.allSettled([
        api.exportCapabilities(),
        api.storage(),
        api.health(),
        api.exportFolder(),
      ]);
      if (cancelled) return;
      if (results[0].status === "fulfilled") setCapabilities(results[0].value);
      if (results[1].status === "fulfilled") setStorage(results[1].value);
      if (results[2].status === "fulfilled") setHealth(results[2].value);
      if (results[3].status === "fulfilled") setExportFolder(results[3].value.path);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = async (patch: RuntimeSettingsUpdate, key: string) => {
    setBusyKey(key);
    try {
      await update(patch);
      notify({ message: t("settings.saved"), tone: "success" });
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
    } finally {
      setBusyKey(null);
    }
  };

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await refresh();
      const [caps, info, healthInfo, folder] = await Promise.allSettled([
        api.exportCapabilities(),
        api.storage(),
        api.health(),
        api.exportFolder(),
      ]);
      if (caps.status === "fulfilled") setCapabilities(caps.value);
      if (info.status === "fulfilled") setStorage(info.value);
      if (healthInfo.status === "fulfilled") setHealth(healthInfo.value);
      if (folder.status === "fulfilled") setExportFolder(folder.value.path);
    } finally {
      setRefreshing(false);
    }
  };

  const openFolder = async (kind: "data" | "exports" | "models") => {
    setBusyKey(`folder-${kind}`);
    try {
      await api.openFolder(kind);
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
    } finally {
      setBusyKey(null);
    }
  };

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      notify({ message: t("settings.pathCopied"), tone: "success" });
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
    }
  };

  if (loading && !settings) {
    return (
      <div className="page">
        <PageHeader title={t("settings.title")} />
        <div className="loading-row">
          <Spinner /> <span>{t("common.loading")}</span>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="page">
        <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />
        <InlineNotice tone="danger">
          <strong>{t("errors.backendOffline")}</strong>
          <p>{t("errors.backendOfflineBody")}</p>
        </InlineNotice>
        <div>
          <p className="muted small">{t("settings.startServiceHint")}</p>
          <code className="command-code">
            python -m uvicorn klyraudio_api.app:create_app --factory --host 127.0.0.1 --port 8765
            --app-dir services/api
          </code>
        </div>
        <div>
          <Button
            icon={<RefreshCw size={15} aria-hidden="true" />}
            loading={refreshing}
            onClick={() => void refreshAll()}
          >
            {t("common.retry")}
          </Button>
        </div>
        {loadError ? <p className="muted small">{describeError(loadError, t).message}</p> : null}
      </div>
    );
  }

  const formats =
    capabilities?.formats.filter((item) => item.available).map((item) => item.id) ?? FALLBACK_FORMATS;
  const memoryTotal = system?.ram_total_mb ?? null;
  const memoryAvailable = system?.ram_available_mb ?? null;
  const memoryUsedPct =
    memoryTotal && memoryAvailable !== null
      ? Math.max(0, Math.min(1, (memoryTotal - memoryAvailable) / memoryTotal))
      : 0;

  return (
    <div className="page">
      <PageHeader
        title={t("settings.title")}
        subtitle={t("settings.subtitle")}
        actions={
          <Button
            icon={<RefreshCw size={15} aria-hidden="true" />}
            loading={refreshing}
            onClick={() => void refreshAll()}
          >
            {t("common.refresh")}
          </Button>
        }
      />

      {loadError ? (
        <InlineNotice tone="warning">
          <strong>{t("settings.serviceStatus")}</strong>
          <span>{describeError(loadError, t).message}</span>
        </InlineNotice>
      ) : null}

      <div className="settings-grid">
        <div className="settings-main">
          <Panel title={t("settings.appearance")}>
            <div className="settings-row">
              <div className="settings-row__text">
                <strong>{t("settings.language")}</strong>
                <small>{t("settings.languageHint")}</small>
              </div>
              <div className="settings-row__control">
                <Select
                  value={language}
                  aria-label={t("settings.language")}
                  onChange={(event) => void setLanguage(event.target.value as Locale)}
                >
                  <option value="en">{t("settings.languageEnglish")}</option>
                  <option value="ja">{t("settings.languageJapanese")}</option>
                </Select>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row__text">
                <strong>{t("settings.theme")}</strong>
              </div>
              <div className="settings-row__control">
                <Select
                  value={settings.theme}
                  aria-label={t("settings.theme")}
                  disabled={busyKey === "theme"}
                  onChange={(event) => void persist({ theme: event.target.value }, "theme")}
                >
                  <option value="dark">{t("settings.themeDark")}</option>
                  <option value="light">{t("settings.themeLight")}</option>
                  <option value="system">{t("settings.themeSystem")}</option>
                </Select>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row__text">
                <strong>{t("settings.reduceMotion")}</strong>
                <small>{t("settings.reduceMotionHint")}</small>
              </div>
              <div className="settings-row__control">
                <Switch
                  checked={settings.reduce_motion}
                  label={t("settings.reduceMotion")}
                  disabled={busyKey === "motion"}
                  onChange={(checked) => void persist({ reduce_motion: checked }, "motion")}
                />
              </div>
            </div>
          </Panel>

          <Panel title={t("settings.audio")}>
            <div className="settings-row">
              <div className="settings-row__text">
                <strong>{t("settings.defaultFormat")}</strong>
                <small>{t("settings.defaultFormatHint")}</small>
              </div>
              <div className="settings-row__control">
                <Select
                  value={settings.default_export_format}
                  aria-label={t("settings.defaultFormat")}
                  disabled={busyKey === "format"}
                  onChange={(event) =>
                    void persist({ default_export_format: event.target.value }, "format")
                  }
                >
                  {Array.from(new Set([settings.default_export_format, ...formats])).map((format) => (
                    <option key={format} value={format}>
                      {format.toUpperCase()}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row__text">
                <strong>{t("settings.defaultSampleRate")}</strong>
              </div>
              <div className="settings-row__control">
                <Select
                  value={settings.default_sample_rate}
                  aria-label={t("settings.defaultSampleRate")}
                  disabled={busyKey === "rate"}
                  onChange={(event) =>
                    void persist({ default_sample_rate: Number(event.target.value) }, "rate")
                  }
                >
                  {SAMPLE_RATES.map((rate) => (
                    <option key={rate} value={rate}>
                      {rate} Hz
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row__text">
                <strong>{t("settings.gpu")}</strong>
                <small>{t("settings.gpuHint")}</small>
              </div>
              <div className="settings-row__control">
                <Select
                  value={settings.gpu_preference}
                  aria-label={t("settings.gpu")}
                  disabled={busyKey === "gpu"}
                  onChange={(event) =>
                    void persist({ gpu_preference: event.target.value }, "gpu")
                  }
                >
                  <option value="auto">{t("settings.gpuAuto")}</option>
                  <option value="cuda">{t("settings.gpuCuda")}</option>
                  <option value="mps">{t("settings.gpuMps")}</option>
                  <option value="cpu">{t("settings.gpuCpu")}</option>
                </Select>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row__text">
                <strong>{t("settings.maxJobs")}</strong>
                <small>{t("settings.maxJobsHint")}</small>
              </div>
              <div className="settings-row__control">
                <RangeField
                  label={t("settings.maxJobs")}
                  id="settings-max-jobs"
                  value={settings.max_concurrent_jobs}
                  min={1}
                  max={4}
                  step={1}
                  disabled={busyKey === "jobs"}
                  onChange={(value) => void persist({ max_concurrent_jobs: value }, "jobs")}
                />
              </div>
            </div>
            <p className="muted small">{t("settings.restartNote")}</p>
          </Panel>

          <Panel
            title={t("settings.data")}
            subtitle={t("settings.dataHint")}
            action={
              <Badge tone="info">
                <HardDrive size={12} aria-hidden="true" />
                {formatBytes(storage?.managed_bytes ?? 0)}
              </Badge>
            }
          >
            <div className="stack">
              <div>
                <h4 className="small-heading">{t("settings.dataDir")}</h4>
                <div className="path-box">
                  <code>{system?.data_dir ?? "—"}</code>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Copy size={14} aria-hidden="true" />}
                    onClick={() => void copyPath(system?.data_dir ?? "")}
                  >
                    {t("settings.copyPath")}
                  </Button>
                  <Button
                    size="sm"
                    icon={<FolderOpen size={14} aria-hidden="true" />}
                    loading={busyKey === "folder-data"}
                    onClick={() => void openFolder("data")}
                  >
                    {t("settings.openDataFolder")}
                  </Button>
                </div>
              </div>

              <div>
                <h4 className="small-heading">{t("settings.exportsFolder")}</h4>
                <div className="path-box path-box--muted">
                  <code>{exportFolder ?? "—"}</code>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Copy size={14} aria-hidden="true" />}
                    onClick={() => void copyPath(exportFolder ?? "")}
                  >
                    {t("settings.copyPath")}
                  </Button>
                  <Button
                    size="sm"
                    icon={<FolderOpen size={14} aria-hidden="true" />}
                    loading={busyKey === "folder-exports"}
                    onClick={() => void openFolder("exports")}
                  >
                    {t("settings.openExportsFolder")}
                  </Button>
                </div>
              </div>

              <div>
                <h4 className="small-heading">{t("models.modelFiles")}</h4>
                <Button
                  size="sm"
                  icon={<FolderOpen size={14} aria-hidden="true" />}
                  loading={busyKey === "folder-models"}
                  onClick={() => void openFolder("models")}
                >
                  {t("models.openFolder")}
                </Button>
              </div>

              <dl className="detail-list detail-list--inline">
                <div>
                  <dt>{t("settings.managedStorage")}</dt>
                  <dd>{formatBytes(storage?.managed_bytes ?? 0)}</dd>
                </div>
                <div>
                  <dt>{t("settings.storageFree")}</dt>
                  <dd>
                    {system?.storage_free_gb !== null && system?.storage_free_gb !== undefined
                      ? `${system.storage_free_gb.toFixed(1)} GB`
                      : "—"}
                  </dd>
                </div>
              </dl>
            </div>
          </Panel>

          <Panel title={t("settings.privacy")}>
            <div className="stack">
              <InlineNotice tone="success" icon={<Shield size={16} aria-hidden="true" />}>
                <strong>{t("settings.noTelemetry")}</strong>
                <p>{t("settings.privacyBody")}</p>
              </InlineNotice>
              <p className="muted small">{t("settings.localOnly")}</p>
              <p className="muted small">{t("settings.diagnosticsHelp")}</p>
            </div>
          </Panel>
        </div>

        <aside className="settings-side">
          <Panel
            title={t("settings.serviceStatus")}
            action={
              <Badge tone={online ? "success" : "danger"}>
                {online ? t("settings.online") : t("settings.offline")}
              </Badge>
            }
          >
            <div className="stack stack--tight">
              <p className="muted small">{t("settings.serviceNote")}</p>
              <p className="muted small">{t("settings.startServiceHint")}</p>
              <code className="command-code">
                python -m uvicorn klyraudio_api.app:create_app --factory --host 127.0.0.1 --port
                8765 --app-dir services/api
              </code>
            </div>
          </Panel>

          <Panel title={t("settings.diagnostics")}>
            <dl className="diagnostic-grid">
              <div>
                <dt>{t("settings.appVersion")}</dt>
                <dd>{system?.app_version ?? health?.version ?? "—"}</dd>
              </div>
              <div>
                <dt>{t("settings.platform")}</dt>
                <dd>
                  {system ? `${system.platform} ${system.platform_release}` : "—"}
                </dd>
              </div>
              <div>
                <dt>{t("settings.architecture")}</dt>
                <dd>{system?.architecture ?? "—"}</dd>
              </div>
              <div>
                <dt>{t("settings.cpu")}</dt>
                <dd>
                  {system ? `${system.cpu_model} (${system.cpu_count})` : "—"}
                </dd>
              </div>
              <div>
                <dt>{t("settings.memory")}</dt>
                <dd>
                  {memoryTotal !== null
                    ? `${formatMemoryMb(memoryAvailable)} / ${formatMemoryMb(memoryTotal)}`
                    : "—"}
                  {memoryTotal !== null ? (
                    <span className="memory-bar" aria-hidden="true">
                      <span style={{ width: formatMemoryPct(memoryUsedPct) }} />
                    </span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>{t("settings.gpuDetected")}</dt>
                <dd>
                  {system && system.gpus.length > 0
                    ? system.gpus
                        .map(
                          (gpu) =>
                            `${gpu.name} · ${gpu.backend} · ${formatMemoryMb(gpu.total_vram_mb)}`,
                        )
                        .join(", ")
                    : t("settings.noGpuDetected")}
                </dd>
              </div>
              <div>
                <dt>{t("settings.backends")}</dt>
                <dd>
                  {system && system.available_backends.length > 0
                    ? system.available_backends.join(", ")
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>{t("settings.ffmpeg")}</dt>
                <dd>{system?.ffmpeg_available ? system.ffmpeg_version ?? "—" : t("settings.ffmpegMissing")}</dd>
              </div>
              <div>
                <dt>{t("settings.ffprobe")}</dt>
                <dd>
                  {system?.ffprobe_available ? (
                    <span className="inline-status">
                      <CheckCircle2 size={13} aria-hidden="true" /> {t("common.available")}
                    </span>
                  ) : (
                    <span className="inline-status" style={{ color: "var(--warning)" }}>
                      <AlertTriangle size={13} aria-hidden="true" /> {t("settings.ffmpegMissing")}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("settings.python")}</dt>
                <dd>{system?.python_version ?? "—"}</dd>
              </div>
              <div>
                <dt>{t("settings.database")}</dt>
                <dd>{health ? `v${health.database_version}` : "—"}</dd>
              </div>
              <div>
                <dt>{t("settings.storageFree")}</dt>
                <dd>
                  {system?.storage_free_gb !== null && system?.storage_free_gb !== undefined
                    ? `${system.storage_free_gb.toFixed(1)} GB`
                    : "—"}
                </dd>
              </div>
            </dl>
            {system && system.warnings.length > 0 ? (
              <div className="stack stack--tight">
                <h4 className="small-heading">{t("generate.warnings")}</h4>
                <ul className="bullet-list small">
                  {system.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Panel>

          <Panel title={t("settings.onboarding")} subtitle={t("settings.onboardingHint")}>
            <div className="stack stack--tight">
              <Button
                icon={<Sparkles size={15} aria-hidden="true" />}
                onClick={() => navigate("/onboarding")}
              >
                {t("settings.rerunOnboarding")}
              </Button>
              <div className="row row--wrap">
                <Badge tone="accent">
                  <Languages size={12} aria-hidden="true" /> EN / JA
                </Badge>
                <Badge tone="info">
                  <Cpu size={12} aria-hidden="true" /> {system?.recommended_backend ?? "CPU"}
                </Badge>
                <Badge>
                  <MemoryStick size={12} aria-hidden="true" /> {formatMemoryMb(memoryTotal)}
                </Badge>
              </div>
            </div>
          </Panel>

          <Panel title={t("settings.about")}>
            <div className="stack stack--tight">
              <p className="small">{t("settings.license")}</p>
              <p className="small muted">{t("settings.thirdParty")}</p>
              <p className="small muted">{t("app.tagline")}</p>
              <InlineNotice tone="info" icon={<Info size={15} aria-hidden="true" />}>
                {t("settings.serviceNote")}
              </InlineNotice>
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
