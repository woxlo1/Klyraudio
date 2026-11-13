import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Cpu,
  FolderOpen,
  HardDrive,
  Play,
  Rocket,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { api } from "../api/client";
import type { AssetInfo, JobInfo, ModelInfo } from "../api/types";
import { Badge, Button, InlineNotice, PageHeader, ProgressBar, Spinner } from "../components/ui";
import { useI18n } from "../i18n";
import { describeError } from "../lib/errors";
import { formatBytes, formatMemoryMb } from "../lib/format";
import { useDocumentTitle } from "../lib/hooks";
import { useSettings } from "../state/settings";
import { useToast } from "../state/toast";

const STEPS = [
  { id: "welcome", icon: Sparkles },
  { id: "system", icon: Cpu },
  { id: "storage", icon: FolderOpen },
  { id: "model", icon: Boxes },
  { id: "license", icon: ShieldCheck },
  { id: "test", icon: Play },
  { id: "done", icon: Rocket },
] as const;

type TestStatus = "idle" | "running" | "success" | "error";

const COMMERCIAL_KEYS: Record<ModelInfo["commercial_use"], string> = {
  permitted: "models.commercialPermitted",
  prohibited: "models.commercialProhibited",
  unclear: "models.commercialUnclear",
  varies: "models.commercialVaries",
};

const COMMERCIAL_TONES: Record<
  ModelInfo["commercial_use"],
  "success" | "danger" | "warning" | "info"
> = {
  permitted: "success",
  prohibited: "danger",
  unclear: "warning",
  varies: "info",
};

export function OnboardingPage() {
  const { t } = useI18n();
  const { settings, system, online, update } = useSettings();
  const { notify } = useToast();
  const navigate = useNavigate();
  useDocumentTitle(t("onboarding.title"));

  const [step, setStep] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [modelsError, setModelsError] = useState<unknown>(null);
  const [storageBytes, setStorageBytes] = useState<number | null>(null);
  const [openingFolder, setOpeningFolder] = useState(false);

  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testJob, setTestJob] = useState<JobInfo | null>(null);
  const [testAsset, setTestAsset] = useState<AssetInfo | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const pollRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    const load = async () => {
      const [modelResult, storageResult] = await Promise.allSettled([api.models(), api.storage()]);
      if (cancelled) return;
      if (modelResult.status === "fulfilled") {
        setModels(modelResult.value);
        setModelsError(null);
      } else {
        setModelsError(modelResult.reason);
      }
      if (storageResult.status === "fulfilled") setStorageBytes(storageResult.value.managed_bytes);
    };
    void load();
    return () => {
      cancelled = true;
      mountedRef.current = false;
      pollRef.current = false;
    };
  }, []);

  const builtinModel = models?.find((model) => model.builtin) ?? null;
  const neuralModels = models?.filter((model) => !model.builtin) ?? [];
  const installedNeural = neuralModels.filter((model) => model.installed).length;
  const dataDir = system?.data_dir ?? "—";
  const storageFree = system?.storage_free_gb ?? null;

  const finishSetup = async (skipped: boolean) => {
    if (finishing) return;
    setFinishing(true);
    try {
      await update({ onboarding_complete: true });
      notify({
        message: skipped ? t("onboarding.skipConfirm") : t("onboarding.completed"),
        tone: "success",
      });
      navigate("/");
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
    } finally {
      setFinishing(false);
    }
  };

  const openDataFolder = async () => {
    if (openingFolder) return;
    setOpeningFolder(true);
    try {
      await api.openFolder("data");
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
    } finally {
      setOpeningFolder(false);
    }
  };

  const runTest = async () => {
    if (testStatus === "running") return;
    setTestStatus("running");
    setTestError(null);
    setTestAsset(null);
    setTestJob(null);
    pollRef.current = true;
    try {
      const response = await api.generate({
        model_id: builtinModel?.id ?? "klyraudio-sketch",
        task: "sfx",
        prompt: t("onboarding.testPrompt"),
        duration: 3,
        variations: 1,
        params: { quality: "fast" },
      });
      let job = response.jobs[0];
      if (!job) throw new Error(t("onboarding.testFailed"));
      if (mountedRef.current) setTestJob(job);
      while (pollRef.current && (job.status === "queued" || job.status === "running")) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 800));
        if (!pollRef.current) return;
        job = await api.job(job.id);
        if (mountedRef.current) setTestJob(job);
      }
      if (job.status !== "completed") throw new Error(t("onboarding.testFailed"));
      const assetId = job.output_asset_ids[0];
      if (!assetId) throw new Error(t("onboarding.testFailed"));
      const asset = await api.asset(assetId);
      if (!mountedRef.current) return;
      setTestAsset(asset);
      setTestStatus("success");
      notify({ message: t("onboarding.testSuccess"), tone: "success" });
    } catch (caught) {
      if (!mountedRef.current) return;
      setTestError(describeError(caught, t).message);
      setTestStatus("error");
    }
  };

  const systemChecks = [
    {
      ok: online === true,
      pending: online === null,
      label: t("settings.serviceStatus"),
      detail:
        online === null
          ? t("onboarding.checking")
          : online
            ? t("settings.online")
            : t("settings.offline"),
    },
    {
      ok: Boolean(system?.ffmpeg_available),
      pending: !system,
      label: t("settings.ffmpeg"),
      detail: system
        ? system.ffmpeg_available
          ? (system.ffmpeg_version ?? t("common.available"))
          : t("settings.ffmpegMissing")
        : t("onboarding.checking"),
    },
    {
      ok: storageFree === null || storageFree >= 2,
      pending: !system,
      label: t("settings.storageFree"),
      detail: storageFree !== null ? `${storageFree.toFixed(1)} GB` : "—",
    },
    {
      ok: Boolean(system),
      pending: !system,
      label: t("settings.cpu"),
      detail: system ? `${system.cpu_model} (${system.cpu_count})` : t("onboarding.checking"),
    },
    {
      ok: Boolean(system),
      pending: !system,
      label: t("settings.memory"),
      detail: system ? formatMemoryMb(system.ram_total_mb) : t("onboarding.checking"),
    },
  ];

  const stepContent = (): ReactNode => {
    switch (STEPS[step].id) {
      case "welcome":
        return (
          <>
            <div className="onboarding-option">
              <HardDrive size={18} aria-hidden="true" />
              <div>
                <strong>{t("app.localFirst")}</strong>
                <p>{t("onboarding.localFirstBody")}</p>
              </div>
            </div>
            <div className="onboarding-option">
              <Boxes size={18} aria-hidden="true" />
              <div>
                <strong>{t("onboarding.modelTitle")}</strong>
                <p>{t("onboarding.modelBody")}</p>
              </div>
            </div>
            <div className="onboarding-option">
              <ShieldCheck size={18} aria-hidden="true" />
              <div>
                <strong>{t("settings.privacy")}</strong>
                <p>{t("settings.privacyBody")}</p>
              </div>
            </div>
          </>
        );
      case "system":
        return (
          <>
            <ul className="onboarding-checklist">
              {systemChecks.map((check) => (
                <li
                  key={check.label}
                  className={check.pending ? undefined : check.ok ? "is-ok" : "is-warn"}
                >
                  {check.pending ? (
                    <Spinner size={15} />
                  ) : check.ok ? (
                    <CheckCircle2 size={16} aria-hidden="true" />
                  ) : (
                    <AlertTriangle size={16} aria-hidden="true" />
                  )}
                  <span>
                    <strong>{check.label}</strong> · {check.detail}
                  </span>
                  <span className="spacer" />
                  <Badge tone={check.pending ? "neutral" : check.ok ? "success" : "warning"}>
                    {check.pending
                      ? t("onboarding.checking")
                      : check.ok
                        ? t("onboarding.ready")
                        : t("onboarding.issue")}
                  </Badge>
                </li>
              ))}
            </ul>
            {system && system.warnings.length > 0 ? (
              <InlineNotice tone="warning">
                <strong>{t("generate.warnings")}</strong>
                <ul className="bullet-list small">
                  {system.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </InlineNotice>
            ) : null}
          </>
        );
      case "storage":
        return (
          <>
            <div className="onboarding-option">
              <FolderOpen size={18} aria-hidden="true" />
              <div>
                <strong>{t("settings.dataDir")}</strong>
                <p className="mono-break">{dataDir}</p>
              </div>
            </div>
            <dl className="detail-list detail-list--inline">
              <div>
                <dt>{t("settings.managedStorage")}</dt>
                <dd>{storageBytes === null ? "—" : formatBytes(storageBytes)}</dd>
              </div>
              <div>
                <dt>{t("settings.storageFree")}</dt>
                <dd>{storageFree !== null ? `${storageFree.toFixed(1)} GB` : "—"}</dd>
              </div>
            </dl>
            <div className="row row--wrap">
              <Button
                icon={<FolderOpen size={15} aria-hidden="true" />}
                loading={openingFolder}
                onClick={() => void openDataFolder()}
              >
                {t("settings.openDataFolder")}
              </Button>
              <Button variant="ghost" onClick={() => navigate("/settings")}>
                {t("onboarding.openSettings")}
              </Button>
            </div>
            <p className="muted small">{t("onboarding.storageHint")}</p>
          </>
        );
      case "model":
        return (
          <>
            {modelsError ? (
              <InlineNotice tone="warning">{describeError(modelsError, t).message}</InlineNotice>
            ) : null}
            {models === null ? (
              <div className="loading-row">
                <Spinner /> <span>{t("common.loading")}</span>
              </div>
            ) : null}
            <div className="onboarding-option">
              <Sparkles size={18} aria-hidden="true" />
              <div>
                <strong>{builtinModel?.name ?? "Klyraudio Sketch"}</strong>
                <p>{t("models.builtinNotice")}</p>
                <div className="row row--wrap">
                  <Badge tone="accent">{t("models.sketchBadge")}</Badge>
                  <Badge tone={builtinModel?.availability === "ready" ? "success" : "warning"}>
                    {builtinModel?.availability === "ready"
                      ? t("onboarding.ready")
                      : t("onboarding.issue")}
                  </Badge>
                </div>
              </div>
            </div>
            <div className="onboarding-option">
              <Boxes size={18} aria-hidden="true" />
              <div>
                <strong>{t("models.installedModels")}</strong>
                <p>
                  {installedNeural} / {neuralModels.length || 0}
                </p>
                <Badge tone="info">{t("models.neuralBadge")}</Badge>
              </div>
            </div>
            <div className="row row--wrap">
              <Button
                variant="primary"
                icon={<Sparkles size={15} aria-hidden="true" />}
                onClick={() => setStep((value) => value + 1)}
              >
                {t("onboarding.useSketch")}
              </Button>
              <Button
                icon={<Boxes size={15} aria-hidden="true" />}
                onClick={() => navigate("/models")}
              >
                {t("onboarding.openModels")}
              </Button>
            </div>
          </>
        );
      case "license":
        return (
          <>
            <InlineNotice tone="info" icon={<ShieldCheck size={16} aria-hidden="true" />}>
              <strong>{t("settings.license")}</strong>
              <p>{t("models.licenseNotice")}</p>
            </InlineNotice>
            {models === null ? (
              <div className="loading-row">
                <Spinner /> <span>{t("common.loading")}</span>
              </div>
            ) : (
              <div className="stack stack--tight">
                {neuralModels.map((model) => (
                  <div className="onboarding-option" key={model.id}>
                    <Boxes size={18} aria-hidden="true" />
                    <div>
                      <strong>{model.name}</strong>
                      <p>{model.license_name}</p>
                      <div className="row row--wrap">
                        <Badge tone={COMMERCIAL_TONES[model.commercial_use]}>
                          {t(COMMERCIAL_KEYS[model.commercial_use])}
                        </Badge>
                        {model.gated ? (
                          <Badge tone="warning">{t("models.gatedTitle")}</Badge>
                        ) : null}
                        <a
                          className="text-button"
                          href={model.license_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t("models.licenseLink")}
                        </a>
                      </div>
                    </div>
                  </div>
                ))}
                {neuralModels.length === 0 ? (
                  <p className="muted small">{t("models.noModels")}</p>
                ) : null}
              </div>
            )}
          </>
        );
      case "test":
        return (
          <>
            <div className="onboarding-option">
              <Play size={18} aria-hidden="true" />
              <div>
                <strong>{t("onboarding.testTitle")}</strong>
                <p>{t("onboarding.testPrompt")}</p>
              </div>
            </div>
            {testStatus === "running" ? (
              <ProgressBar
                value={testJob?.progress ?? null}
                label={testJob?.progress_label ?? t("onboarding.testing")}
              />
            ) : null}
            {testStatus === "success" && testAsset ? (
              <div className="onboarding-test-result">
                <CheckCircle2 size={17} aria-hidden="true" />
                <span>
                  {t("onboarding.testSuccess")} · {testAsset.name}
                </span>
              </div>
            ) : null}
            {testStatus === "error" && testError ? (
              <InlineNotice tone="danger">{testError}</InlineNotice>
            ) : null}
            <div className="row row--wrap">
              <Button
                variant={testStatus === "success" ? "secondary" : "primary"}
                icon={<Play size={15} aria-hidden="true" />}
                loading={testStatus === "running"}
                onClick={() => void runTest()}
              >
                {testStatus === "running" ? t("onboarding.testing") : t("onboarding.runTest")}
              </Button>
            </div>
          </>
        );
      case "done":
        return (
          <>
            <ul className="onboarding-checklist">
              <li className={online ? "is-ok" : "is-warn"}>
                {online ? (
                  <CheckCircle2 size={16} aria-hidden="true" />
                ) : (
                  <AlertTriangle size={16} aria-hidden="true" />
                )}
                <span>{t("settings.serviceStatus")}</span>
              </li>
              <li className={builtinModel?.availability === "ready" ? "is-ok" : "is-warn"}>
                {builtinModel?.availability === "ready" ? (
                  <CheckCircle2 size={16} aria-hidden="true" />
                ) : (
                  <AlertTriangle size={16} aria-hidden="true" />
                )}
                <span>{t("onboarding.modelTitle")}</span>
              </li>
              <li className={testStatus === "success" ? "is-ok" : "is-warn"}>
                {testStatus === "success" ? (
                  <CheckCircle2 size={16} aria-hidden="true" />
                ) : (
                  <AlertTriangle size={16} aria-hidden="true" />
                )}
                <span>{t("onboarding.testTitle")}</span>
              </li>
            </ul>
            <div className="onboarding-option">
              <Rocket size={18} aria-hidden="true" />
              <div>
                <strong>{t("onboarding.doneTitle")}</strong>
                <p>{t("onboarding.doneBody")}</p>
              </div>
            </div>
          </>
        );
      default:
        return null;
    }
  };

  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  return (
    <div className="page">
      <PageHeader
        title={t("onboarding.title")}
        subtitle={t("onboarding.subtitle")}
        actions={
          settings?.onboarding_complete ? (
            <Badge tone="success">{t("onboarding.complete")}</Badge>
          ) : null
        }
      />

      <div className="onboarding">
        <div className="onboarding-progress" aria-hidden="true">
          {STEPS.map((item, index) => (
            <div key={item.id} className="onboarding-progress__step">
              <span style={{ width: index <= step ? "100%" : "0%" }} />
            </div>
          ))}
        </div>

        <section className="onboarding-card" aria-labelledby="onboarding-heading">
          <span className="onboarding-card__icon">
            <Icon size={26} aria-hidden="true" />
          </span>
          <div>
            <p className="muted small">
              {t("onboarding.step", { current: step + 1, total: STEPS.length })}
            </p>
            <h2 id="onboarding-heading">{t(`onboarding.${current.id}Title`)}</h2>
            <p>{t(`onboarding.${current.id}Body`)}</p>
          </div>

          {stepContent()}

          <div className="onboarding-actions">
            {step > 0 ? (
              <Button
                onClick={() => setStep((value) => Math.max(0, value - 1))}
                disabled={finishing}
              >
                {t("onboarding.back")}
              </Button>
            ) : null}
            {!isLast ? (
              <Button variant="ghost" loading={finishing} onClick={() => void finishSetup(true)}>
                {t("onboarding.skip")}
              </Button>
            ) : null}
            <span className="spacer" />
            {isLast ? (
              <Button
                variant="primary"
                icon={<Rocket size={15} aria-hidden="true" />}
                loading={finishing}
                onClick={() => void finishSetup(false)}
              >
                {t("onboarding.startCreating")}
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => setStep((value) => Math.min(STEPS.length - 1, value + 1))}
              >
                {t("onboarding.next")}
              </Button>
            )}
          </div>
          <p className="muted small">{t("onboarding.later")}</p>
        </section>
      </div>
    </div>
  );
}
