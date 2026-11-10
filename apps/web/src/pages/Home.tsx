import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Boxes,
  Cpu,
  FileAudio,
  FolderOpen,
  HardDrive,
  LayoutGrid,
  Music,
  ShieldCheck,
  Sparkles,
  Waves,
  WifiOff,
} from "lucide-react";
import { api } from "../api/client";
import type { AssetInfo, JobInfo, ModelInfo } from "../api/types";
import { JobStatusBadge } from "../components/StatusBadge";
import { Badge, Button, EmptyState, InlineNotice, PageHeader, Panel, Spinner } from "../components/ui";
import { useI18n } from "../i18n";
import { describeError } from "../lib/errors";
import { formatBytes, formatMemoryMb } from "../lib/format";
import { addAssetToNewProject } from "../lib/studioActions";
import { useSettings } from "../state/settings";
import { useToast } from "../state/toast";

export function HomePage() {
  const { t, formatRelative } = useI18n();
  const { settings, system, online } = useSettings();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<JobInfo[] | null>(null);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [assetTotal, setAssetTotal] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [jobList, modelList, assets] = await Promise.all([
          api.jobs(),
          api.models(),
          api.assets({ limit: 1 }),
        ]);
        if (cancelled) return;
        setJobs(jobList);
        setModels(modelList);
        setAssetTotal(assets.total);
        setLoadError(null);
      } catch (caught) {
        if (!cancelled) setLoadError(caught);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [online]);

  const recent = (jobs ?? [])
    .filter((job) => job.status === "completed" && job.output_asset_ids.length > 0)
    .slice(0, 6);
  const readyModels = (models ?? []).filter(
    (model) => !model.builtin && model.availability === "ready",
  );
  const gpu = system?.gpus[0];
  const warnings = system?.warnings ?? [];
  const loading = jobs === null && models === null && !loadError;

  const sendToStudio = async (assetId: string) => {
    setSendingId(assetId);
    try {
      const asset: AssetInfo = await api.asset(assetId);
      const project = await addAssetToNewProject(asset);
      notify({ message: t("generate.sentToStudio"), tone: "success" });
      navigate(`/studio/${project.id}`);
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
    } finally {
      setSendingId(null);
    }
  };

  return (
    <div className="page page--home">
      <PageHeader
        title={t("home.title")}
        subtitle={t("app.localFirst")}
        actions={
          <>
            <Button variant="primary" icon={<Music size={16} aria-hidden="true" />} onClick={() => navigate("/generate/music")}>
              {t("home.startMusic")}
            </Button>
            <Button icon={<LayoutGrid size={16} aria-hidden="true" />} onClick={() => navigate("/studio")}>
              {t("home.openStudio")}
            </Button>
          </>
        }
      />

      {loadError ? <InlineNotice tone="danger">{describeError(loadError, t).message}</InlineNotice> : null}

      <section className="hero" aria-labelledby="home-hero-title">
        <div className="hero__content">
          <Badge tone="accent">{t("home.sketchBadge")}</Badge>
          <h2 id="home-hero-title">{t("home.heroTitle")}</h2>
          <p>{t("home.heroBody")}</p>
          <div className="hero__actions">
            <Button variant="primary" onClick={() => navigate("/generate/music")}>
              {t("home.startMusic")}
            </Button>
            <Button onClick={() => navigate("/generate/sfx")}>{t("home.startSfx")}</Button>
            <Button onClick={() => navigate("/generate/ambient")}>{t("home.startAmbient")}</Button>
          </div>
        </div>
        <div className="hero__wave" aria-hidden="true">
          {Array.from({ length: 42 }).map((_, index) => (
            <span
              key={index}
              style={{
                height: `${18 + Math.abs(Math.sin(index * 0.55)) * 62 + (index % 5) * 4}%`,
                animationDelay: `${index * 28}ms`,
              }}
            />
          ))}
        </div>
      </section>

      <div className="stat-row">
        <button type="button" className="stat" onClick={() => navigate("/library")}>
          <FileAudio size={18} aria-hidden="true" />
          <span>
            <strong>{assetTotal ?? "—"}</strong>
            <small>{t("nav.library")}</small>
          </span>
        </button>
        <button type="button" className="stat" onClick={() => navigate("/queue")}>
          <LayoutGrid size={18} aria-hidden="true" />
          <span>
            <strong>{jobs?.filter((job) => job.status === "queued" || job.status === "running").length ?? "—"}</strong>
            <small>{t("queue.active")}</small>
          </span>
        </button>
        <button type="button" className="stat" onClick={() => navigate("/models")}>
          <Boxes size={18} aria-hidden="true" />
          <span>
            <strong>{readyModels.length}</strong>
            <small>{t("home.modelsReadyTitle")}</small>
          </span>
        </button>
        <div className="stat">
          <span className={`status-dot ${online ? "status-dot--online" : "status-dot--offline"}`} aria-hidden="true" />
          <span>
            <strong>{online ? t("settings.online") : t("settings.offline")}</strong>
            <small>{t("home.engine")}</small>
          </span>
        </div>
      </div>

      <div className="home-grid">
        <Panel
          title={t("home.quickStart")}
          subtitle={t("home.heroBody")}
          className="home-grid__create"
        >
          <div className="quick-grid">
            <Link className="quick-card quick-card--music" to="/generate/music">
              <Music size={20} aria-hidden="true" />
              <strong>{t("generate.musicTitle")}</strong>
              <span>{t("generate.musicSubtitle")}</span>
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
            <Link className="quick-card quick-card--sfx" to="/generate/sfx">
              <Sparkles size={20} aria-hidden="true" />
              <strong>{t("generate.sfxTitle")}</strong>
              <span>{t("generate.sfxSubtitle")}</span>
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
            <Link className="quick-card quick-card--ambient" to="/generate/ambient">
              <Waves size={20} aria-hidden="true" />
              <strong>{t("generate.ambientTitle")}</strong>
              <span>{t("generate.ambientSubtitle")}</span>
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </Panel>

        <Panel
          title={t("home.recent")}
          action={
            recent.length > 0 ? (
              <button type="button" className="text-button" onClick={() => navigate("/library")}>
                {t("home.viewAll")}
              </button>
            ) : undefined
          }
        >
          {loading ? (
            <div className="loading-row">
              <Spinner /> <span>{t("common.loading")}</span>
            </div>
          ) : recent.length === 0 ? (
            <EmptyState
              compact
              icon={<Music size={22} aria-hidden="true" />}
              title={t("home.recentEmpty")}
              action={
                <Button size="sm" onClick={() => navigate("/generate/music")}>
                  {t("home.startMusic")}
                </Button>
              }
            />
          ) : (
            <ul className="recent-list">
              {recent.map((job) => {
                const outputId = job.output_asset_ids[0];
                return (
                  <li key={job.id} className="recent-list__item">
                    <div className="recent-list__body">
                      <strong>{job.prompt}</strong>
                      <small>
                        {t(`task.${job.task}`)} · {formatRelative(job.finished_at ?? job.created_at)}
                      </small>
                    </div>
                    <JobStatusBadge status={job.status} />
                    <div className="recent-list__actions">
                      <Button size="sm" variant="ghost" onClick={() => navigate(`/editor/${outputId}`)}>
                        {t("generate.viewInEditor")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={sendingId === outputId}
                        onClick={() => void sendToStudio(outputId)}
                      >
                        {t("generate.addToStudio")}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title={t("home.engine")} subtitle={online ? t("home.engineHealthy") : t("home.engineUnavailable")}>
          <div className="status-block">
            <div className={`status-orb ${online ? "is-online" : "is-offline"}`} aria-hidden="true">
              {online ? <Cpu size={22} /> : <WifiOff size={22} />}
            </div>
            <div>
              <strong>{online ? t("nav.online") : t("nav.offline")}</strong>
              <p className="muted small">{online ? t("home.engineHealthy") : t("home.engineUnavailable")}</p>
            </div>
          </div>
          {system ? (
            <dl className="detail-list">
              <div>
                <dt>{t("settings.gpuDetected")}</dt>
                <dd>
                  {gpu
                    ? t("home.gpuDetected", {
                        name: gpu.name,
                        memory: gpu.total_vram_mb ? formatMemoryMb(gpu.total_vram_mb) : t("common.unknown"),
                      })
                    : t("home.noGpu")}
                </dd>
              </div>
              <div>
                <dt>{t("settings.ffmpeg")}</dt>
                <dd>{system.ffmpeg_available ? system.ffmpeg_version ?? t("common.available") : t("settings.ffmpegMissing")}</dd>
              </div>
              <div>
                <dt>{t("settings.storageFree")}</dt>
                <dd>
                  {system.storage_free_gb !== null
                    ? t("home.storageFree", { size: `${formatBytes(system.storage_free_gb * 1024 ** 3)}` })
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>{t("home.dataFolder")}</dt>
                <dd className="mono-break">{system.data_dir}</dd>
              </div>
            </dl>
          ) : (
            <div className="loading-row">
              <Spinner /> <span>{t("common.loading")}</span>
            </div>
          )}
        </Panel>

        <Panel
          title={t("home.systemCheck")}
          subtitle={warnings.length > 0 ? t("home.systemIssues") : t("home.systemHealthy")}
          action={
            <Link className="text-button" to="/settings">
              {t("nav.settings")}
            </Link>
          }
        >
          <ul className="check-list">
            <li className={system?.ffmpeg_available ? "is-ok" : "is-warn"}>
              <HardDrive size={16} aria-hidden="true" />
              <span>{system?.ffmpeg_available ? t("home.ffmpegReady") : t("home.ffmpegMissing")}</span>
            </li>
            <li className={gpu ? "is-ok" : "is-info"}>
              <Cpu size={16} aria-hidden="true" />
              <span>{gpu ? t("home.gpuDetected", { name: gpu.name, memory: gpu.total_vram_mb ? formatMemoryMb(gpu.total_vram_mb) : t("common.unknown") }) : t("home.noGpu")}</span>
            </li>
            <li className="is-ok">
              <ShieldCheck size={16} aria-hidden="true" />
              <span>{t("home.privacyBody")}</span>
            </li>
            {warnings.map((warning) => (
              <li key={warning} className="is-warn">
                <span className="badge badge--warning">{warning}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          title={t("home.modelsReadyTitle")}
          subtitle={
            readyModels.length > 0
              ? t("home.modelsReadyBody", { count: readyModels.length })
              : t("home.modelsNoneBody")
          }
          action={
            <Link className="text-button" to="/models">
              {t("home.manageModels")}
            </Link>
          }
        >
          <ul className="model-mini-list">
            {(models ?? []).slice(0, 4).map((model) => (
              <li key={model.id}>
                <div>
                  <strong>{model.name}</strong>
                  <small>{model.family}</small>
                </div>
                {model.builtin ? (
                  <Badge tone="accent">{t("models.sketchBadge")}</Badge>
                ) : (
                  <Badge tone={model.availability === "ready" ? "success" : "neutral"}>
                    {t(`status.${statusKey(model.availability)}`)}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </Panel>

        {settings && !settings.onboarding_complete ? (
          <Panel
            className="onboarding-banner"
            title={t("home.onboardingTitle")}
            subtitle={t("home.onboardingBody")}
            action={
              <Button variant="primary" onClick={() => navigate("/onboarding")}>
                {t("home.resumeSetup")}
              </Button>
            }
          >
            <div className="onboarding-steps">
              <span><FolderOpen size={15} aria-hidden="true" /> {t("onboarding.storageTitle")}</span>
              <span><Boxes size={15} aria-hidden="true" /> {t("onboarding.modelTitle")}</span>
              <span><Sparkles size={15} aria-hidden="true" /> {t("onboarding.testTitle")}</span>
            </div>
          </Panel>
        ) : null}
      </div>

      <Panel title={t("home.privacyTitle")} subtitle={t("home.privacyBody")}>
        <div className="feature-row">
          <div>
            <ShieldCheck size={18} aria-hidden="true" />
            <strong>{t("home.offlineTitle")}</strong>
            <p>{t("home.offlineBody")}</p>
          </div>
          <div>
            <FolderOpen size={18} aria-hidden="true" />
            <strong>{t("home.ownedTitle")}</strong>
            <p>{t("home.ownedBody")}</p>
          </div>
          <div>
            <Sparkles size={18} aria-hidden="true" />
            <strong>{t("home.noAccountTitle")}</strong>
            <p>{t("home.noAccountBody")}</p>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function statusKey(availability: ModelInfo["availability"]): string {
  switch (availability) {
    case "installed-missing-deps":
      return "installedMissingDeps";
    case "not-installed":
      return "notInstalled";
    default:
      return availability;
  }
}
