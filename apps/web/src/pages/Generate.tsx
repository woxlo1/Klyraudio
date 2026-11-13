import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { Boxes, Info, ListMusic, Music, Play, Sparkles, Wand2, Waves } from "lucide-react";
import { api } from "../api/client";
import type {
  AssetInfo,
  GenerationRequest,
  JobInfo,
  ModelCapability,
  ModelInfo,
  TaskType,
} from "../api/types";
import { JobStatusBadge } from "../components/StatusBadge";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  InlineNotice,
  PageHeader,
  Panel,
  ProgressBar,
  RangeField,
  Select,
  Spinner,
  Switch,
  Textarea,
  TextInput,
} from "../components/ui";
import { useI18n } from "../i18n";
import { describeError } from "../lib/errors";
import { formatDuration } from "../lib/format";
import { useDocumentTitle } from "../lib/hooks";
import { addAssetToNewProject } from "../lib/studioActions";
import { useSettings } from "../state/settings";
import { useToast } from "../state/toast";

const DEFAULT_DURATION: Record<TaskType, number> = { music: 12, sfx: 4, ambient: 20 };

function isTask(value: string | undefined): value is TaskType {
  return value === "music" || value === "sfx" || value === "ambient";
}

export function GeneratePage() {
  const { task: taskParam } = useParams();
  const task = isTask(taskParam) ? taskParam : "music";
  const { t, tList } = useI18n();
  const { system } = useSettings();
  const { notify } = useToast();
  const navigate = useNavigate();

  useDocumentTitle(t(`generate.${task}Title`));

  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [modelsError, setModelsError] = useState<unknown>(null);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [duration, setDuration] = useState(DEFAULT_DURATION[task]);
  const [variations, setVariations] = useState(1);
  const [seed, setSeed] = useState("");
  const [tempo, setTempo] = useState(110);
  const [musicalKey, setMusicalKey] = useState("");
  const [mood, setMood] = useState("");
  const [style, setStyle] = useState("");
  const [instrumental, setInstrumental] = useState(true);
  const [loop, setLoop] = useState(false);
  const [quality, setQuality] = useState<"fast" | "balanced" | "high">("balanced");
  const [guidance, setGuidance] = useState(3);
  const [steps, setSteps] = useState(60);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [queued, setQueued] = useState<{ jobs: JobInfo[]; warnings: string[] } | null>(null);
  const [recent, setRecent] = useState<JobInfo[]>([]);
  const [sendingId, setSendingId] = useState<string | null>(null);

  useEffect(() => {
    setPrompt("");
    setNegativePrompt("");
    setQueued(null);
    setFormError(null);
    setDuration(DEFAULT_DURATION[task]);
  }, [task]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const list = await api.models();
        if (!cancelled) {
          setModels(list);
          setModelsError(null);
        }
      } catch (caught) {
        if (!cancelled) {
          setModelsError(caught);
          // Render the form instead of an endless loading row so the user can
          // still read the error and open the Model Manager.
          setModels([]);
        }
      }
    };
    const loadJobs = async () => {
      try {
        const jobs = await api.jobs();
        if (!cancelled) setRecent(jobs.slice(0, 5));
      } catch {
        // Recent jobs are supplementary; the form remains usable.
      }
    };
    void load();
    void loadJobs();
    return () => {
      cancelled = true;
    };
  }, [task]);

  const matchingModels = useMemo(
    () => (models ?? []).filter((model) => model.tasks.includes(task)),
    [models, task],
  );

  useEffect(() => {
    if (matchingModels.length === 0) return;
    setSelectedModelId((current) => {
      if (current && matchingModels.some((model) => model.id === current)) return current;
      const preferred =
        matchingModels.find((model) => model.builtin && model.availability === "ready") ??
        matchingModels.find((model) => model.availability === "ready") ??
        matchingModels[0];
      return preferred.id;
    });
  }, [matchingModels]);

  const selectedModel = matchingModels.find((model) => model.id === selectedModelId) ?? null;
  const capability: ModelCapability | null =
    selectedModel?.capabilities.find((item) => item.task === task) ?? null;
  const params = new Set(capability?.supported_parameters ?? []);
  const supports = (name: string) => params.has(name);

  useEffect(() => {
    if (!capability) return;
    setDuration((current) =>
      Math.min(capability.duration_max, Math.max(capability.duration_min, current)),
    );
    setVariations((current) => Math.min(capability.max_variations, Math.max(1, current)));
  }, [capability]);

  const ready = selectedModel?.availability === "ready";
  const licenseBlocked = Boolean(
    selectedModel?.requires_license_acknowledgement && !selectedModel.license_acknowledged,
  );
  const canGenerate = Boolean(
    selectedModel && capability && ready && !licenseBlocked && !submitting,
  );
  const suggestions = tList(`prompts.${task}`);
  const cpuOnly = Boolean(
    system && !system.available_backends.some((backend) => backend === "cuda" || backend === "mps"),
  );

  const submit = async () => {
    setFormError(null);
    if (!selectedModel || !capability) return;
    if (prompt.trim().length < 2) {
      setFormError(t("generate.invalidPrompt"));
      return;
    }
    if (duration < capability.duration_min || duration > capability.duration_max) {
      setFormError(
        t("generate.durationLimit", { min: capability.duration_min, max: capability.duration_max }),
      );
      return;
    }
    if (variations > capability.max_variations) {
      setFormError(t("generate.variationsLimit", { max: capability.max_variations }));
      return;
    }
    if (licenseBlocked) {
      setFormError(t("generate.licenseNotAcknowledged"));
      return;
    }
    const payload: GenerationRequest = {
      model_id: selectedModel.id,
      task,
      prompt: prompt.trim(),
      negative_prompt: capability.supports_negative_prompt ? negativePrompt.trim() : "",
      duration,
      seed: seed.trim() === "" ? null : Math.max(0, Math.trunc(Number(seed))),
      variations,
      params: {
        tempo: supports("tempo") ? tempo : null,
        musical_key: supports("musical_key") && musicalKey.trim() ? musicalKey.trim() : null,
        mood: supports("mood") && mood.trim() ? mood.trim() : null,
        style: supports("style") && style.trim() ? style.trim() : null,
        instrumental: supports("instrumental") ? instrumental : null,
        loop: supports("loop") ? loop : false,
        quality: supports("quality") ? quality : undefined,
        guidance: supports("guidance") ? guidance : null,
        steps: supports("steps") ? steps : null,
      },
    };
    if (Number.isNaN(payload.seed)) {
      setFormError(t("generate.seedHint"));
      return;
    }
    setSubmitting(true);
    try {
      const response = await api.generate(payload);
      setQueued({
        jobs: response.jobs,
        warnings: response.warnings.map((warning) => warning.message),
      });
      notify({ message: t("generate.queuedTitle"), tone: "success" });
      try {
        const jobs = await api.jobs();
        setRecent(jobs.slice(0, 5));
      } catch {
        // The queue link still works if this refresh fails.
      }
    } catch (caught) {
      setFormError(describeError(caught, t).message);
    } finally {
      setSubmitting(false);
    }
  };

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

  if (!isTask(taskParam)) return <Navigate to="/generate/music" replace />;

  const TaskIcon = task === "music" ? Music : task === "sfx" ? Sparkles : Waves;

  return (
    <div className="page">
      <PageHeader
        title={t(`generate.${task}Title`)}
        subtitle={t(`generate.${task}Subtitle`)}
        actions={
          <>
            <Link className="text-button" to="/models">
              <Boxes size={15} aria-hidden="true" /> {t("generate.openModels")}
            </Link>
            <Link className="text-button" to="/queue">
              <ListMusic size={15} aria-hidden="true" /> {t("generate.openQueue")}
            </Link>
          </>
        }
      />

      {modelsError ? (
        <InlineNotice tone="danger">{describeError(modelsError, t).message}</InlineNotice>
      ) : null}

      <div className="generate-layout">
        <div className="generate-layout__main">
          {queued ? (
            <Panel
              title={t("generate.queuedTitle")}
              subtitle={t("generate.queuedBody")}
              action={
                <Button size="sm" onClick={() => navigate("/queue")}>
                  {t("generate.openQueue")}
                </Button>
              }
            >
              <ul className="queued-list">
                {queued.jobs.map((job) => (
                  <li key={job.id}>
                    <JobStatusBadge status={job.status} />
                    <span>{job.prompt}</span>
                    <span className="muted small">{formatDuration(job.duration_requested)}</span>
                  </li>
                ))}
              </ul>
              {queued.warnings.length > 0 ? (
                <InlineNotice tone="warning">
                  <strong>{t("generate.warnings")}</strong>
                  <ul>
                    {queued.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </InlineNotice>
              ) : null}
            </Panel>
          ) : null}

          <Panel
            title={
              <span className="title-with-icon">
                <TaskIcon size={18} aria-hidden="true" /> {t(`generate.${task}Title`)}
              </span>
            }
            subtitle={t("generate.promptHint")}
          >
            {models === null ? (
              <div className="loading-row">
                <Spinner /> <span>{t("common.loading")}</span>
              </div>
            ) : (
              <div className="stack">
                <Field
                  label={t("generate.prompt")}
                  htmlFor="generate-prompt"
                  hint={t("generate.promptHint")}
                  error={formError && prompt.trim().length < 2 ? formError : undefined}
                >
                  <Textarea
                    id="generate-prompt"
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    rows={5}
                    maxLength={2000}
                    placeholder={t(
                      `generate.promptPlaceholder${task === "music" ? "Music" : task === "sfx" ? "Sfx" : "Ambient"}`,
                    )}
                  />
                </Field>

                <div className="suggestions">
                  <span className="field__label">{t("generate.suggestionsTitle")}</span>
                  <div className="suggestion-row">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        className="suggestion"
                        onClick={() => setPrompt(suggestion)}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>

                {capability?.supports_negative_prompt ? (
                  <Field
                    label={t("generate.negativePrompt")}
                    htmlFor="generate-negative"
                    optional={t("common.optional")}
                  >
                    <TextInput
                      id="generate-negative"
                      value={negativePrompt}
                      onChange={(event) => setNegativePrompt(event.target.value)}
                      placeholder={t("generate.negativePlaceholder")}
                    />
                  </Field>
                ) : null}

                <div className="form-grid__two">
                  <Field
                    label={t("generate.model")}
                    htmlFor="generate-model"
                    hint={t("generate.modelHint", { task: t(`task.${task}`).toLowerCase() })}
                  >
                    <Select
                      id="generate-model"
                      value={selectedModelId}
                      onChange={(event) => setSelectedModelId(event.target.value)}
                    >
                      {matchingModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name}
                          {model.builtin
                            ? ` — ${t("models.sketchBadge")}`
                            : ` — ${t(`status.${model.availability === "installed-missing-deps" ? "installedMissingDeps" : model.availability === "not-installed" ? "notInstalled" : model.availability}`)}`}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("generate.variations")} htmlFor="generate-variations">
                    <Select
                      id="generate-variations"
                      value={variations}
                      onChange={(event) => setVariations(Number(event.target.value))}
                      disabled={!capability?.supports_variations}
                    >
                      {Array.from(
                        { length: capability?.max_variations ?? 1 },
                        (_, index) => index + 1,
                      ).map((count) => (
                        <option key={count} value={count}>
                          {count}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                <div className="form-grid__two">
                  <RangeField
                    label={t("generate.duration")}
                    id="generate-duration"
                    value={duration}
                    min={capability?.duration_min ?? 1}
                    max={capability?.duration_max ?? 30}
                    step={1}
                    onChange={setDuration}
                    format={(value) => t("generate.durationValue", { seconds: value })}
                  />
                  <Field
                    label={t("generate.seed")}
                    htmlFor="generate-seed"
                    hint={t("generate.seedHint")}
                  >
                    <div className="inline-field">
                      <TextInput
                        id="generate-seed"
                        value={seed}
                        onChange={(event) => setSeed(event.target.value.replace(/[^0-9]/g, ""))}
                        placeholder={t("generate.seedPlaceholder")}
                        inputMode="numeric"
                      />
                      <Button
                        variant="ghost"
                        onClick={() => setSeed(String(Math.floor(Math.random() * 2_147_483_647)))}
                        title={t("generate.randomize")}
                      >
                        {t("generate.randomize")}
                      </Button>
                    </div>
                  </Field>
                </div>

                <Panel
                  title={t("generate.advanced")}
                  subtitle={t("generate.supportedHint")}
                  action={
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowAdvanced((value) => !value)}
                    >
                      {showAdvanced ? t("common.hideAdvanced") : t("common.showAdvanced")}
                    </Button>
                  }
                  className="panel--nested"
                >
                  {showAdvanced ? (
                    <div className="stack">
                      <div className="form-grid__two">
                        {supports("tempo") ? (
                          <RangeField
                            label={t("generate.tempo")}
                            id="generate-tempo"
                            value={tempo}
                            min={40}
                            max={220}
                            step={1}
                            onChange={setTempo}
                            format={(value) => `${value} ${t("generate.bpm")}`}
                          />
                        ) : null}
                        {supports("quality") ? (
                          <Field label={t("generate.quality")} htmlFor="generate-quality">
                            <Select
                              id="generate-quality"
                              value={quality}
                              onChange={(event) => setQuality(event.target.value as typeof quality)}
                            >
                              <option value="fast">{t("generate.qualityFast")}</option>
                              <option value="balanced">{t("generate.qualityBalanced")}</option>
                              <option value="high">{t("generate.qualityHigh")}</option>
                            </Select>
                          </Field>
                        ) : null}
                      </div>
                      <div className="form-grid__two">
                        {supports("musical_key") ? (
                          <Field
                            label={t("generate.key")}
                            htmlFor="generate-key"
                            optional={t("common.optional")}
                          >
                            <TextInput
                              id="generate-key"
                              value={musicalKey}
                              onChange={(event) => setMusicalKey(event.target.value)}
                              placeholder={t("generate.keyPlaceholder")}
                            />
                          </Field>
                        ) : null}
                        {supports("mood") ? (
                          <Field
                            label={t("generate.mood")}
                            htmlFor="generate-mood"
                            optional={t("common.optional")}
                          >
                            <TextInput
                              id="generate-mood"
                              value={mood}
                              onChange={(event) => setMood(event.target.value)}
                              placeholder={t("generate.moodPlaceholder")}
                            />
                          </Field>
                        ) : null}
                      </div>
                      <div className="form-grid__two">
                        {supports("style") ? (
                          <Field
                            label={t("generate.style")}
                            htmlFor="generate-style"
                            optional={t("common.optional")}
                          >
                            <TextInput
                              id="generate-style"
                              value={style}
                              onChange={(event) => setStyle(event.target.value)}
                              placeholder={t("generate.stylePlaceholder")}
                            />
                          </Field>
                        ) : null}
                        {supports("instrumental") ? (
                          <Switch
                            checked={instrumental}
                            onChange={setInstrumental}
                            label={t("generate.instrumental")}
                          />
                        ) : null}
                      </div>
                      <div className="form-grid__two">
                        {supports("guidance") ? (
                          <RangeField
                            label={t("generate.guidance")}
                            id="generate-guidance"
                            value={guidance}
                            min={1}
                            max={20}
                            step={0.5}
                            onChange={setGuidance}
                            format={(value) => value.toFixed(1)}
                          />
                        ) : null}
                        {supports("steps") ? (
                          <RangeField
                            label={t("generate.steps")}
                            id="generate-steps"
                            value={steps}
                            min={10}
                            max={200}
                            step={1}
                            onChange={setSteps}
                          />
                        ) : null}
                      </div>
                      {capability?.supports_loop && supports("loop") ? (
                        <Switch
                          checked={loop}
                          onChange={setLoop}
                          label={t("generate.loopPost")}
                          description={t("generate.loopHint")}
                        />
                      ) : null}
                    </div>
                  ) : (
                    <p className="muted small">
                      {t("generate.supportedControls")}: {Array.from(params).join(", ")}
                    </p>
                  )}
                </Panel>

                {!ready && selectedModel ? (
                  <InlineNotice tone="warning">
                    <strong>{t("generate.modelNotReady")}</strong>
                    <p>{selectedModel.availability_detail ?? t("generate.modelNotReady")}</p>
                    <Button size="sm" onClick={() => navigate("/models")}>
                      {t("generate.openModels")}
                    </Button>
                  </InlineNotice>
                ) : null}

                {licenseBlocked && selectedModel ? (
                  <InlineNotice tone="warning">
                    <strong>{t("generate.licenseNotAcknowledged")}</strong>
                    <p>{selectedModel.license_name}</p>
                    <Button size="sm" onClick={() => navigate("/models")}>
                      {t("generate.acknowledge")}
                    </Button>
                  </InlineNotice>
                ) : null}

                {formError ? <InlineNotice tone="danger">{formError}</InlineNotice> : null}

                <div className="form-actions">
                  <Button
                    variant="primary"
                    size="md"
                    icon={<Wand2 size={16} aria-hidden="true" />}
                    loading={submitting}
                    disabled={!canGenerate}
                    onClick={() => void submit()}
                  >
                    {submitting ? t("generate.generating") : t("generate.generate")}
                  </Button>
                  <span className="muted small">{t("generate.queueNote")}</span>
                </div>
              </div>
            )}
          </Panel>
        </div>

        <aside className="generate-layout__side">
          <Panel title={t("generate.model")} subtitle={selectedModel?.family}>
            {selectedModel ? (
              <div className="stack">
                <div className="row row--wrap">
                  <Badge tone={selectedModel.builtin ? "accent" : "info"}>
                    {selectedModel.builtin ? t("models.sketchBadge") : t("models.neuralBadge")}
                  </Badge>
                  <Badge tone={ready ? "success" : "warning"}>
                    {t(
                      `status.${selectedModel.availability === "installed-missing-deps" ? "installedMissingDeps" : selectedModel.availability === "not-installed" ? "notInstalled" : selectedModel.availability}`,
                    )}
                  </Badge>
                </div>
                <p className="muted small">{selectedModel.description}</p>
                {selectedModel.builtin ? (
                  <InlineNotice tone="info" icon={<Info size={16} aria-hidden="true" />}>
                    {t("generate.sketchNote")}
                  </InlineNotice>
                ) : null}
                {cpuOnly ? (
                  <InlineNotice tone="warning">{t("generate.cpuOnlyNote")}</InlineNotice>
                ) : null}
                {selectedModel.known_limitations.length > 0 ? (
                  <div>
                    <h4 className="small-heading">{t("models.limitations")}</h4>
                    <ul className="bullet-list small">
                      {selectedModel.known_limitations.map((limitation) => (
                        <li key={limitation}>{limitation}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <EmptyState compact title={t("models.noModels")} />
            )}
          </Panel>

          <Panel
            title={t("generate.recent")}
            action={
              <Link className="text-button" to="/queue">
                {t("common.more")}
              </Link>
            }
          >
            {recent.length === 0 ? (
              <EmptyState compact title={t("generate.recentEmpty")} />
            ) : (
              <ul className="recent-list recent-list--compact">
                {recent.map((job) => (
                  <li key={job.id} className="recent-list__item">
                    <div className="recent-list__body">
                      <strong>{job.prompt}</strong>
                      <small>{t(`task.${job.task}`)}</small>
                    </div>
                    <JobStatusBadge status={job.status} />
                    {job.status === "running" && job.progress !== null ? (
                      <ProgressBar value={job.progress} />
                    ) : null}
                    {job.output_asset_ids.length > 0 ? (
                      <div className="recent-list__actions">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => navigate(`/editor/${job.output_asset_ids[0]}`)}
                        >
                          {t("generate.viewInEditor")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={sendingId === job.output_asset_ids[0]}
                          onClick={() => void sendToStudio(job.output_asset_ids[0])}
                        >
                          {t("generate.addToStudio")}
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={t("generate.jobOutputs")}>
            <p className="muted small">{t("generate.noOutputsYet")}</p>
            <Button
              variant="ghost"
              size="sm"
              icon={<Play size={14} aria-hidden="true" />}
              onClick={() => navigate("/queue")}
            >
              {t("generate.openQueue")}
            </Button>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
