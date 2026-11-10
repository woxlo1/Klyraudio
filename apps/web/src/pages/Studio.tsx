import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ChevronLeft,
  Copy,
  Download,
  Music,
  Pause,
  Play,
  Plus,
  Save,
  SlidersHorizontal,
  Split,
  Square,
  Trash2,
  Wand2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { api } from "../api/client";
import type {
  AssetInfo,
  ClipSpec,
  EffectSpec,
  ProjectDocument,
  ProjectInfo,
  ProjectSummary,
  TrackSpec,
} from "../api/types";
import { AssetPicker } from "../components/AssetPicker";
import { ConfirmDialog, Modal } from "../components/Modal";
import { ExportDialog } from "../components/ExportDialog";
import {
  Button,
  EmptyState,
  Field,
  IconButton,
  InlineNotice,
  PageHeader,
  Panel,
  RangeField,
  Select,
  Spinner,
  Switch,
  TextInput,
} from "../components/ui";
import { useI18n } from "../i18n";
import { describeError } from "../lib/errors";
import { clamp, formatDuration, panLabel, uid } from "../lib/format";
import { useDocumentTitle } from "../lib/hooks";
import { useToast } from "../state/toast";

type EffectType = EffectSpec["type"];

const TRACK_HEADER = 190;
const ROW_HEIGHT = 76;
const SAMPLE_RATES = [22050, 32000, 44100, 48000, 96000];

const EFFECT_KEYS: Record<EffectType, string> = {
  eq: "studio.effectEq",
  compressor: "studio.effectCompressor",
  limiter: "studio.effectLimiter",
  reverb: "studio.effectReverb",
  delay: "studio.effectDelay",
};

const EFFECT_DEFAULTS: Record<EffectType, Record<string, number>> = {
  eq: { low_gain_db: 0, mid_gain_db: 0, high_gain_db: 0 },
  compressor: { threshold_db: -18, ratio: 3, attack_ms: 10, release_ms: 120, makeup_db: 0 },
  limiter: { ceiling_db: -1 },
  reverb: { decay_seconds: 1.8, mix: 0.2, damping: 0.5 },
  delay: { delay_ms: 300, feedback: 0.3, mix: 0.2 },
};

interface ParamRange {
  min: number;
  max: number;
  step: number;
  unit?: "db" | "ms" | "s";
}

const EFFECT_RANGES: Record<EffectType, Record<string, ParamRange>> = {
  eq: {
    low_gain_db: { min: -12, max: 12, step: 0.5, unit: "db" },
    mid_gain_db: { min: -12, max: 12, step: 0.5, unit: "db" },
    high_gain_db: { min: -12, max: 12, step: 0.5, unit: "db" },
  },
  compressor: {
    threshold_db: { min: -60, max: 0, step: 1, unit: "db" },
    ratio: { min: 1, max: 20, step: 0.5 },
    attack_ms: { min: 1, max: 200, step: 1, unit: "ms" },
    release_ms: { min: 20, max: 1000, step: 10, unit: "ms" },
    makeup_db: { min: 0, max: 12, step: 0.5, unit: "db" },
  },
  limiter: {
    ceiling_db: { min: -12, max: 0, step: 0.1, unit: "db" },
  },
  reverb: {
    decay_seconds: { min: 0.1, max: 10, step: 0.1, unit: "s" },
    mix: { min: 0, max: 1, step: 0.01 },
    damping: { min: 0, max: 1, step: 0.01 },
  },
  delay: {
    delay_ms: { min: 20, max: 1500, step: 10, unit: "ms" },
    feedback: { min: 0, max: 0.9, step: 0.01 },
    mix: { min: 0, max: 1, step: 0.01 },
  },
};

const PARAM_KEY: Record<string, string> = {
  low_gain_db: "studio.params.lowGain",
  mid_gain_db: "studio.params.midGain",
  high_gain_db: "studio.params.highGain",
  threshold_db: "studio.params.threshold",
  ratio: "studio.params.ratio",
  attack_ms: "studio.params.attack",
  release_ms: "studio.params.release",
  makeup_db: "studio.params.makeup",
  ceiling_db: "studio.params.ceiling",
  decay_seconds: "studio.params.decay",
  mix: "studio.params.mix",
  damping: "studio.params.damping",
  delay_ms: "studio.params.delayTime",
  feedback: "studio.params.feedback",
};

interface ClipRef {
  trackId: string;
  clipId: string;
}

interface DragState {
  trackId: string;
  clipId: string;
  startX: number;
  initialStart: number;
  moved: boolean;
}

function projectDuration(document: ProjectDocument | null): number {
  if (!document) return 0;
  let duration = 0;
  for (const track of document.tracks) {
    for (const clip of track.clips) {
      duration = Math.max(duration, clip.start + clip.duration);
    }
  }
  return duration;
}

function findClip(
  document: ProjectDocument | null,
  reference: ClipRef | null,
): { track: TrackSpec; clip: ClipSpec } | null {
  if (!document || !reference) return null;
  const track = document.tracks.find((item) => item.id === reference.trackId);
  const clip = track?.clips.find((item) => item.id === reference.clipId);
  return track && clip ? { track, clip } : null;
}

export function StudioPage() {
  const { projectId } = useParams();
  const { t, formatDate } = useI18n();
  const { notify } = useToast();
  const navigate = useNavigate();

  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [projectListError, setProjectListError] = useState<unknown>(null);
  const [document, setDocument] = useState<ProjectDocument | null>(null);
  const [assets, setAssets] = useState<Record<string, AssetInfo>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [dirty, setDirty] = useState(false);
  const [autosave, setAutosave] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);

  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedClip, setSelectedClip] = useState<ClipRef | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pps, setPps] = useState(60);
  const [snap, setSnap] = useState(true);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectRate, setProjectRate] = useState(44100);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [rendering, setRendering] = useState(false);
  const [renderedAsset, setRenderedAsset] = useState<AssetInfo | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [effectToAdd, setEffectToAdd] = useState<EffectType>("eq");

  const scrollRef = useRef<HTMLDivElement>(null);
  const revisionRef = useRef(0);
  const savingRef = useRef(false);
  const dragRef = useRef<DragState | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const frameRef = useRef(0);

  const duration = projectDuration(document);
  const timelineSeconds = Math.max(duration + 2, 10);
  const timelineWidth = timelineSeconds * pps;
  const selected = findClip(document, selectedClip);
  const clipCount = document
    ? document.tracks.reduce((total, track) => total + track.clips.length, 0)
    : 0;

  useDocumentTitle(document?.name ?? t("studio.title"));

  const refreshProjects = async () => {
    try {
      const list = await api.projects();
      setProjects(list);
      setProjectListError(null);
    } catch (caught) {
      setProjectListError(caught);
    }
  };

  const loadAssetMap = async (project: ProjectInfo) => {
    const map: Record<string, AssetInfo> = {};
    try {
      const response = await api.assets({ limit: 500, sort: "newest" });
      for (const asset of response.items) map[asset.id] = asset;
    } catch {
      // Individual clip assets are fetched below; a failed list is not fatal.
    }
    const missing = new Set<string>();
    for (const track of project.document.tracks) {
      for (const clip of track.clips) {
        if (!map[clip.asset_id]) missing.add(clip.asset_id);
      }
    }
    await Promise.all(
      Array.from(missing).map(async (assetId) => {
        try {
          map[assetId] = await api.asset(assetId);
        } catch {
          // The clip is shown as unavailable.
        }
      }),
    );
    setAssets(map);
  };

  useEffect(() => {
    void refreshProjects();
  }, []);

  useEffect(() => {
    if (!projectId) {
      setDocument(null);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setDocument(null);
    setSelectedClip(null);
    setSelectedTrackId(null);
    setRenderedAsset(null);
    const load = async () => {
      try {
        const project = await api.project(projectId);
        if (cancelled) return;
        setDocument(project.document);
        setSavedAt(project.updated_at);
        setDirty(false);
        setPlayhead(0);
        setSelectedTrackId(project.document.tracks[0]?.id ?? null);
        setLoadError(null);
        await loadAssetMap(project);
      } catch (caught) {
        if (!cancelled) setLoadError(caught);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      stopPreview();
    };
  }, [projectId]);

  const mutateDocument = (mutator: (draft: ProjectDocument) => void) => {
    setDocument((current) => {
      if (!current) return current;
      const draft = structuredClone(current);
      mutator(draft);
      return draft;
    });
    revisionRef.current += 1;
    setDirty(true);
    setRenderedAsset(null);
  };

  const mutateTrack = (trackId: string, mutator: (track: TrackSpec) => void) => {
    mutateDocument((draft) => {
      const track = draft.tracks.find((item) => item.id === trackId);
      if (track) mutator(track);
    });
  };

  const mutateClip = (reference: ClipRef, mutator: (clip: ClipSpec) => void) => {
    mutateDocument((draft) => {
      const track = draft.tracks.find((item) => item.id === reference.trackId);
      const clip = track?.clips.find((item) => item.id === reference.clipId);
      if (clip) mutator(clip);
    });
  };

  const saveProject = async (auto: boolean): Promise<boolean> => {
    if (!document || savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    const revision = revisionRef.current;
    try {
      const updated = await api.updateProject(document.id, {
        document,
        autosave: auto,
      });
      if (revisionRef.current === revision) {
        setDocument(updated.document);
        setDirty(false);
      }
      setSavedAt(updated.updated_at);
      void refreshProjects();
      return true;
    } catch (caught) {
      setSaveError(caught);
      notify({ message: describeError(caught, t).message, tone: "error" });
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!document || !dirty || !autosave) return;
    const timer = window.setTimeout(() => {
      void saveProject(true);
    }, 1800);
    return () => window.clearTimeout(timer);
    // Autosave intentionally depends on the document, the dirty flag, and the toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document, dirty, autosave]);

  const stopPreview = () => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    for (const source of sourcesRef.current) {
      try {
        source.stop();
      } catch {
        // A source that already ended cannot be stopped again.
      }
    }
    sourcesRef.current = [];
    setPlaying(false);
  };

  useEffect(() => {
    return () => {
      stopPreview();
      const context = audioContextRef.current;
      audioContextRef.current = null;
      if (context && context.state !== "closed") void context.close();
    };
  }, []);

  const ensureBuffer = async (context: AudioContext, assetId: string) => {
    const cached = buffersRef.current.get(assetId);
    if (cached) return cached;
    const response = await fetch(api.audioUrl(assetId));
    if (!response.ok) throw new Error(t("library.playError"));
    const data = await response.arrayBuffer();
    const buffer = await context.decodeAudioData(data);
    buffersRef.current.set(assetId, buffer);
    return buffer;
  };

  const startPreview = async (fromTime?: number) => {
    if (!document || clipCount === 0) return;
    stopPreview();
    const context = audioContextRef.current ?? new AudioContext();
    audioContextRef.current = context;
    try {
      await context.resume();
    } catch {
      // Some browsers keep the context suspended until the next gesture.
    }
    const ids = new Set<string>();
    for (const track of document.tracks) {
      for (const clip of track.clips) ids.add(clip.asset_id);
    }
    try {
      await Promise.all(Array.from(ids).map((assetId) => ensureBuffer(context, assetId)));
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
      return;
    }

    const startFrom = fromTime ?? (playhead >= duration - 0.05 ? 0 : playhead);
    setPlayhead(startFrom);
    const startAt = context.currentTime + 0.08;
    const soloActive = document.tracks.some((track) => track.solo);

    for (const track of document.tracks) {
      if (track.mute || (soloActive && !track.solo)) continue;
      for (const clip of track.clips) {
        const clipEnd = clip.start + clip.duration;
        if (clipEnd <= startFrom + 0.001) continue;
        const buffer = buffersRef.current.get(clip.asset_id);
        if (!buffer) continue;
        const localStart = Math.max(0, startFrom - clip.start);
        const playDuration = clip.duration - localStart;
        if (playDuration <= 0.001) continue;
        const when = startAt + Math.max(0, clip.start - startFrom);
        const offset = clip.offset + localStart;
        const available = Math.max(0, buffer.duration - offset);
        const outputDuration = Math.min(playDuration, available);
        if (outputDuration <= 0.001) continue;

        const source = context.createBufferSource();
        source.buffer = buffer;
        const gain = context.createGain();
        const level = Math.max(
          0,
          clip.gain * Math.max(0, track.volume) * Math.max(0, document.master.volume),
        );
        gain.gain.setValueAtTime(level, when);
        if (clip.fade_in > 0 && localStart <= 0.001) {
          gain.gain.setValueAtTime(0, when);
          gain.gain.linearRampToValueAtTime(level, when + Math.min(clip.fade_in, outputDuration));
        }
        if (clip.fade_out > 0) {
          const fadeStart = when + Math.max(0, outputDuration - clip.fade_out);
          if (fadeStart < when + outputDuration) {
            gain.gain.setValueAtTime(level, fadeStart);
            gain.gain.linearRampToValueAtTime(0, when + outputDuration);
          }
        }
        const panner = context.createStereoPanner();
        panner.pan.value = clamp(track.pan, -1, 1);
        source.connect(gain);
        gain.connect(panner);
        panner.connect(context.destination);
        source.start(when, offset, outputDuration);
        sourcesRef.current.push(source);
      }
    }

    setPlaying(true);
    let lastUpdate = 0;
    const tick = () => {
      if (!audioContextRef.current) return;
      const elapsed = audioContextRef.current.currentTime - startAt;
      if (elapsed >= 0) {
        const time = startFrom + elapsed;
        if (time >= duration) {
          setPlayhead(duration);
          stopPreview();
          return;
        }
        const now = performance.now();
        if (now - lastUpdate > 48) {
          setPlayhead(time);
          lastUpdate = now;
        }
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  };

  const seek = (time: number) => {
    const next = clamp(time, 0, Math.max(duration, 0));
    setPlayhead(next);
    if (playing) void startPreview(next);
  };

  const addTrack = () => {
    if (!document) return;
    const id = uid("trk");
    mutateDocument((draft) => {
      draft.tracks.push({
        id,
        name: t("studio.untitledTrack", { number: draft.tracks.length + 1 }),
        volume: 1,
        pan: 0,
        mute: false,
        solo: false,
        clips: [],
      });
    });
    setSelectedTrackId(id);
  };

  const addAssetToTimeline = (asset: AssetInfo) => {
    if (!document) return;
    const trackId = selectedTrackId ?? document.tracks[0]?.id ?? uid("trk");
    const clipId = uid("clip");
    let start = playhead;
    if (snap) start = Math.round(start * 2) / 2;
    mutateDocument((draft) => {
      let track = draft.tracks.find((item) => item.id === trackId);
      if (!track) {
        track = {
          id: trackId,
          name: t("studio.untitledTrack", { number: draft.tracks.length + 1 }),
          volume: 1,
          pan: 0,
          mute: false,
          solo: false,
          clips: [],
        };
        draft.tracks.push(track);
      }
      track.clips.push({
        id: clipId,
        asset_id: asset.id,
        start: Math.max(0, start),
        offset: 0,
        duration: Math.max(0.05, asset.duration),
        fade_in: 0,
        fade_out: 0,
        gain: 1,
      });
    });
    setAssets((current) => ({ ...current, [asset.id]: asset }));
    setSelectedTrackId(trackId);
    setSelectedClip({ trackId, clipId });
    setPickerOpen(false);
  };

  const removeClip = (reference: ClipRef) => {
    mutateDocument((draft) => {
      const track = draft.tracks.find((item) => item.id === reference.trackId);
      if (!track) return;
      track.clips = track.clips.filter((clip) => clip.id !== reference.clipId);
    });
    setSelectedClip(null);
  };

  const duplicateClip = (reference: ClipRef) => {
    const target = findClip(document, reference);
    if (!target) return;
    const newId = uid("clip");
    mutateDocument((draft) => {
      const track = draft.tracks.find((item) => item.id === reference.trackId);
      const clip = track?.clips.find((item) => item.id === reference.clipId);
      if (!track || !clip) return;
      track.clips.push({
        ...structuredClone(clip),
        id: newId,
        start: clip.start + clip.duration,
      });
    });
    setSelectedClip({ trackId: reference.trackId, clipId: newId });
    notify({ message: t("studio.clipDuplicated"), tone: "success" });
  };

  const splitClip = (reference: ClipRef) => {
    const target = findClip(document, reference);
    if (!target) return;
    const { clip } = target;
    const cut = playhead;
    if (cut <= clip.start + 0.01 || cut >= clip.start + clip.duration - 0.01) {
      notify({ message: t("studio.splitAtPlayhead"), tone: "warning" });
      return;
    }
    const newId = uid("clip");
    const leftDuration = cut - clip.start;
    mutateDocument((draft) => {
      const track = draft.tracks.find((item) => item.id === reference.trackId);
      const current = track?.clips.find((item) => item.id === reference.clipId);
      if (!track || !current) return;
      const right: ClipSpec = {
        ...structuredClone(current),
        id: newId,
        start: cut,
        offset: current.offset + leftDuration,
        duration: current.duration - leftDuration,
        fade_in: 0,
      };
      current.duration = leftDuration;
      current.fade_out = 0;
      track.clips.push(right);
    });
    setSelectedClip({ trackId: reference.trackId, clipId: newId });
  };

  const addEffect = () => {
    mutateDocument((draft) => {
      draft.master.effects.push({
        type: effectToAdd,
        enabled: true,
        params: { ...EFFECT_DEFAULTS[effectToAdd] },
      });
    });
    notify({ message: t("studio.effectAdded"), tone: "success" });
  };

  const renderMix = async () => {
    if (!document || rendering) return;
    setRendering(true);
    try {
      const saved = await saveProject(false);
      if (!saved) return;
      const asset = await api.renderProject(document.id, {
        format: "wav",
        normalize: document.master.normalize,
      });
      setRenderedAsset(asset);
      setAssets((current) => ({ ...current, [asset.id]: asset }));
      notify({ message: t("studio.renderDone"), tone: "success" });
      setExportOpen(true);
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
    } finally {
      setRendering(false);
    }
  };

  const createProject = async () => {
    if (projectName.trim().length === 0 || creating) return;
    setCreating(true);
    try {
      const project = await api.createProject({
        name: projectName.trim(),
        sample_rate: projectRate,
      });
      setCreateOpen(false);
      setProjectName("");
      await refreshProjects();
      navigate(`/studio/${project.id}`);
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
    } finally {
      setCreating(false);
    }
  };

  const deleteProject = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await api.deleteProject(deleteTarget.id);
      notify({ message: t("studio.projectDeleted"), tone: "success" });
      if (projectId === deleteTarget.id) navigate("/studio");
      setDeleteTarget(null);
      await refreshProjects();
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
    } finally {
      setDeleting(false);
    }
  };

  const tickStep = pps >= 150 ? 0.5 : pps >= 70 ? 1 : pps >= 32 ? 2 : 5;
  const ticks = useMemo(() => {
    const values: number[] = [];
    for (let time = 0; time <= timelineSeconds + 0.001; time += tickStep) {
      values.push(Math.round(time * 1000) / 1000);
    }
    return values;
  }, [timelineSeconds, tickStep]);

  const timeFromPointer = (event: ReactPointerEvent<HTMLElement>, width: number) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width || width), 0, 1);
    return ratio * timelineSeconds;
  };

  const handleClipPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    trackId: string,
    clip: ClipSpec,
  ) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      trackId,
      clipId: clip.id,
      startX: event.clientX,
      initialStart: clip.start,
      moved: false,
    };
    setSelectedTrackId(trackId);
    setSelectedClip({ trackId, clipId: clip.id });
  };

  const handleClipPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(delta) < 3) return;
    drag.moved = true;
    let next = drag.initialStart + delta / pps;
    if (snap) next = Math.round(next * 2) / 2;
    next = Math.max(0, next);
    const current = findClip(document, drag);
    if (current && Math.abs(current.clip.start - next) > 0.001) {
      mutateClip(drag, (clip) => {
        clip.start = next;
      });
    }
  };

  const finishClipDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };

  if (!projectId) {
    return (
      <div className="page">
        <PageHeader
          title={t("studio.title")}
          subtitle={t("studio.subtitle")}
          actions={
            <Button
              variant="primary"
              icon={<Plus size={16} aria-hidden="true" />}
              onClick={() => setCreateOpen(true)}
            >
              {t("studio.newProject")}
            </Button>
          }
        />
        {projectListError ? (
          <InlineNotice tone="danger">{describeError(projectListError, t).message}</InlineNotice>
        ) : null}
        <Panel title={t("studio.projects")}>
          {projects === null ? (
            <div className="loading-row">
              <Spinner /> <span>{t("common.loading")}</span>
            </div>
          ) : projects.length === 0 ? (
            <EmptyState
              icon={<SlidersHorizontal size={24} aria-hidden="true" />}
              title={t("studio.noProjects")}
              action={
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  {t("studio.newProject")}
                </Button>
              }
            />
          ) : (
            <div className="project-list">
              {projects.map((project) => (
                <article key={project.id} className="project-card">
                  <h3>{project.name}</h3>
                  <small>
                    {t("counts.tracks", { count: project.track_count })} ·{" "}
                    {formatDuration(project.duration)}
                  </small>
                  <small>{formatDate(project.updated_at)}</small>
                  <div className="project-card__actions">
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => navigate(`/studio/${project.id}`)}
                    >
                      {t("studio.openProject")}
                    </Button>
                    <IconButton
                      label={t("studio.deleteProject")}
                      size="sm"
                      onClick={() => setDeleteTarget(project)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </IconButton>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Panel>

        {createOpen ? (
          <Modal
            title={t("studio.newProject")}
            onClose={() => setCreateOpen(false)}
            size="sm"
            footer={
              <>
                <Button onClick={() => setCreateOpen(false)}>{t("common.cancel")}</Button>
                <Button
                  variant="primary"
                  loading={creating}
                  disabled={projectName.trim().length === 0}
                  onClick={() => void createProject()}
                >
                  {t("studio.createProject")}
                </Button>
              </>
            }
          >
            <div className="form-grid">
              <Field label={t("studio.projectName")} htmlFor="studio-project-name">
                <TextInput
                  id="studio-project-name"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  placeholder={t("studio.projectNamePlaceholder")}
                  maxLength={200}
                  autoFocus
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void createProject();
                  }}
                />
              </Field>
              <Field label={t("studio.sampleRate")} htmlFor="studio-project-rate">
                <Select
                  id="studio-project-rate"
                  value={projectRate}
                  onChange={(event) => setProjectRate(Number(event.target.value))}
                >
                  {SAMPLE_RATES.map((rate) => (
                    <option key={rate} value={rate}>
                      {rate} Hz
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Modal>
        ) : null}

        {deleteTarget ? (
          <ConfirmDialog
            title={t("studio.deleteProject")}
            message={t("studio.deleteProjectBody", { name: deleteTarget.name })}
            confirmLabel={t("common.delete")}
            danger
            busy={deleting}
            onConfirm={() => void deleteProject()}
            onClose={() => setDeleteTarget(null)}
          />
        ) : null}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="page">
        <PageHeader title={t("studio.title")} />
        <InlineNotice tone="danger">{describeError(loadError, t).message}</InlineNotice>
        <Button onClick={() => navigate("/studio")}>{t("studio.projects")}</Button>
      </div>
    );
  }

  if (loading || !document) {
    return (
      <div className="page">
        <div className="loading-row">
          <Spinner /> <span>{t("common.loading")}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title={document.name}
        subtitle={`${t("studio.projectDuration", { duration: formatDuration(duration) })} · ${t(
          "counts.tracks",
          { count: document.tracks.length },
        )} · ${t("counts.clips", { count: clipCount })}`}
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              icon={<ChevronLeft size={15} aria-hidden="true" />}
              onClick={() => navigate("/studio")}
            >
              {t("studio.projects")}
            </Button>
            <span className={`studio-status${dirty ? " is-dirty" : ""}`}>
              {saving
                ? t("common.saving")
                : dirty
                  ? t("studio.unsaved")
                  : savedAt
                    ? t("studio.savedAt", { time: formatDate(savedAt) })
                    : t("common.saved")}
            </span>
            <Button
              size="sm"
              icon={<Save size={15} aria-hidden="true" />}
              loading={saving}
              onClick={() => void saveProject(false)}
            >
              {t("studio.save")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<Wand2 size={15} aria-hidden="true" />}
              loading={rendering}
              onClick={() => void renderMix()}
            >
              {rendering ? t("studio.rendering") : t("studio.render")}
            </Button>
          </>
        }
      />

      {saveError ? (
        <InlineNotice tone="danger">
          <strong>{t("studio.saveFailed")}</strong>
          <span>{describeError(saveError, t).message}</span>
        </InlineNotice>
      ) : null}

      <div className="studio-layout">
        <div className="studio-main">
          <Panel
            title={t("studio.timeline")}
            subtitle={t("studio.previewNote")}
            action={
              <div className="row">
                <IconButton
                  label={t("studio.zoomOut")}
                  size="sm"
                  onClick={() => setPps((value) => clamp(value / 1.4, 20, 260))}
                  disabled={pps <= 20}
                >
                  <ZoomOut size={15} aria-hidden="true" />
                </IconButton>
                <span className="muted small">{Math.round(pps)} px/s</span>
                <IconButton
                  label={t("studio.zoomIn")}
                  size="sm"
                  onClick={() => setPps((value) => clamp(value * 1.4, 20, 260))}
                  disabled={pps >= 260}
                >
                  <ZoomIn size={15} aria-hidden="true" />
                </IconButton>
                <Button
                  size="sm"
                  variant={snap ? "success" : "ghost"}
                  onClick={() => setSnap((value) => !value)}
                  title={t("studio.snapHint")}
                >
                  {t("studio.snap")}
                </Button>
              </div>
            }
          >
            <div className="studio-toolbar">
              <Button
                size="sm"
                variant="primary"
                icon={
                  playing ? (
                    <Pause size={15} aria-hidden="true" />
                  ) : (
                    <Play size={15} aria-hidden="true" />
                  )
                }
                onClick={() => {
                  if (playing) stopPreview();
                  else void startPreview();
                }}
                disabled={clipCount === 0}
              >
                {playing ? t("studio.pause") : t("studio.play")}
              </Button>
              <Button
                size="sm"
                icon={<Square size={14} aria-hidden="true" />}
                onClick={() => {
                  stopPreview();
                  setPlayhead(0);
                }}
                disabled={clipCount === 0}
              >
                {t("studio.stop")}
              </Button>
              <span className="studio-status">
                {formatDuration(playhead)} / {formatDuration(duration)}
              </span>
              <span className="spacer" />
              <Button size="sm" icon={<Plus size={14} aria-hidden="true" />} onClick={addTrack}>
                {t("studio.addTrack")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<Music size={14} aria-hidden="true" />}
                onClick={() => setPickerOpen(true)}
              >
                {t("studio.addClip")}
              </Button>
            </div>

            <div className="studio-timeline">
              <div className="timeline-scroll" ref={scrollRef}>
                <div className="timeline-content" style={{ width: TRACK_HEADER + timelineWidth }}>
                  <div
                    className="timeline-ruler-row"
                    style={{ marginLeft: TRACK_HEADER, width: timelineWidth }}
                  >
                    <div
                      className="timeline-ruler"
                      style={{ width: timelineWidth }}
                      onPointerDown={(event) => seek(timeFromPointer(event, timelineWidth))}
                      role="presentation"
                    >
                      {ticks.map((time) => (
                        <div key={time} className="timeline-tick" style={{ left: time * pps }}>
                          <span>{formatDuration(time)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {document.tracks.map((track) => (
                    <div key={track.id} className="timeline-row" style={{ minHeight: ROW_HEIGHT }}>
                      <div
                        className="track-header"
                        style={{ width: TRACK_HEADER }}
                        onPointerDown={() => setSelectedTrackId(track.id)}
                      >
                        <div className="track-header__top">
                          <input
                            value={track.name}
                            aria-label={t("studio.trackName")}
                            onChange={(event) =>
                              mutateTrack(track.id, (draft) => {
                                draft.name = event.target.value;
                              })
                            }
                          />
                          <button
                            type="button"
                            className={`mini-toggle${track.mute ? " is-on" : ""}`}
                            aria-pressed={track.mute}
                            title={t("studio.mute")}
                            onClick={() =>
                              mutateTrack(track.id, (draft) => {
                                draft.mute = !draft.mute;
                              })
                            }
                          >
                            M
                          </button>
                          <button
                            type="button"
                            className={`mini-toggle${track.solo ? " is-solo" : ""}`}
                            aria-pressed={track.solo}
                            title={t("studio.solo")}
                            onClick={() =>
                              mutateTrack(track.id, (draft) => {
                                draft.solo = !draft.solo;
                              })
                            }
                          >
                            S
                          </button>
                        </div>
                        <div className="track-header__sliders">
                          <label title={t("studio.volume")}>
                            Vol
                            <input
                              type="range"
                              min={0}
                              max={2}
                              step={0.01}
                              value={track.volume}
                              aria-label={`${track.name} ${t("studio.volume")}`}
                              onChange={(event) =>
                                mutateTrack(track.id, (draft) => {
                                  draft.volume = Number(event.target.value);
                                })
                              }
                            />
                          </label>
                          <label title={t("studio.pan")}>
                            Pan
                            <input
                              type="range"
                              min={-1}
                              max={1}
                              step={0.01}
                              value={track.pan}
                              aria-label={`${track.name} ${t("studio.pan")}`}
                              onChange={(event) =>
                                mutateTrack(track.id, (draft) => {
                                  draft.pan = Number(event.target.value);
                                })
                              }
                            />
                          </label>
                        </div>
                      </div>

                      <div
                        className={`track-lane${
                          selectedTrackId === track.id ? " track-lane--selected" : ""
                        }`}
                        style={
                          {
                            width: timelineWidth,
                            "--beat": `${tickStep * pps}px`,
                          } as CSSProperties
                        }
                        onPointerDown={(event) => {
                          if (event.currentTarget === event.target) {
                            setSelectedTrackId(track.id);
                            setSelectedClip(null);
                            seek(timeFromPointer(event, timelineWidth));
                          }
                        }}
                      >
                        {track.clips.map((clip) => {
                          const asset = assets[clip.asset_id];
                          const width = Math.max(6, clip.duration * pps);
                          const isSelected =
                            selectedClip?.trackId === track.id && selectedClip?.clipId === clip.id;
                          const typeClass =
                            asset?.media_type === "sfx"
                              ? " timeline-clip--sfx"
                              : asset?.media_type === "ambient"
                                ? " timeline-clip--ambient"
                                : "";
                          return (
                            <div
                              key={clip.id}
                              className={`timeline-clip${isSelected ? " is-selected" : ""}${typeClass}`}
                              style={{ left: clip.start * pps, width }}
                              onPointerDown={(event) =>
                                handleClipPointerDown(event, track.id, clip)
                              }
                              onPointerMove={handleClipPointerMove}
                              onPointerUp={finishClipDrag}
                              onPointerCancel={finishClipDrag}
                              role="button"
                              tabIndex={0}
                              aria-label={asset?.name ?? t("studio.assetMissing")}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  setSelectedTrackId(track.id);
                                  setSelectedClip({ trackId: track.id, clipId: clip.id });
                                }
                              }}
                            >
                              <span>{asset?.name ?? t("studio.assetMissing")}</span>
                              <small>{formatDuration(clip.duration)}</small>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  <div
                    className="timeline-playhead"
                    style={{ left: TRACK_HEADER + playhead * pps }}
                    aria-hidden="true"
                  />
                </div>
              </div>

              {document.tracks.length === 0 ? (
                <div className="timeline-empty">
                  <strong>{t("studio.noClipsTitle")}</strong>
                  <p>{t("studio.noClipsBody")}</p>
                </div>
              ) : clipCount === 0 ? (
                <div className="timeline-empty">{t("studio.noClipsBody")}</div>
              ) : null}
            </div>

            <p className="muted small">{t("studio.realtimeNote")}</p>
          </Panel>
        </div>

        <aside className="studio-side">
          <Panel
            title={selected ? t("studio.track") : t("studio.effects")}
            action={
              selected ? (
                <div className="row">
                  <IconButton
                    label={t("studio.removeClip")}
                    size="sm"
                    onClick={() => removeClip(selectedClip as ClipRef)}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={t("studio.duplicateClip")}
                    size="sm"
                    onClick={() => duplicateClip(selectedClip as ClipRef)}
                  >
                    <Copy size={15} aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={t("studio.splitAtPlayhead")}
                    size="sm"
                    onClick={() => splitClip(selectedClip as ClipRef)}
                  >
                    <Split size={15} aria-hidden="true" />
                  </IconButton>
                </div>
              ) : null
            }
          >
            {selected && selectedClip ? (
              <div className="clip-inspector">
                <div>
                  <strong>
                    {assets[selected.clip.asset_id]?.name ?? t("studio.assetMissing")}
                  </strong>
                  <p className="muted small">
                    {selected.track.name} · {formatDuration(selected.clip.duration)}
                  </p>
                </div>
                {!assets[selected.clip.asset_id] ? (
                  <InlineNotice tone="warning">{t("studio.assetMissing")}</InlineNotice>
                ) : null}
                <RangeField
                  label={t("studio.clipGain")}
                  id="clip-gain"
                  value={selected.clip.gain}
                  min={0}
                  max={2}
                  step={0.01}
                  onChange={(value) =>
                    mutateClip(selectedClip, (clip) => {
                      clip.gain = value;
                    })
                  }
                  format={(value) => `${Math.round(value * 100)}%`}
                />
                <RangeField
                  label={t("studio.sourceOffset")}
                  id="clip-offset"
                  value={selected.clip.offset}
                  min={0}
                  max={Math.max(
                    0,
                    (assets[selected.clip.asset_id]?.duration ?? selected.clip.duration) -
                      selected.clip.duration,
                  )}
                  step={0.01}
                  onChange={(value) =>
                    mutateClip(selectedClip, (clip) => {
                      clip.offset = value;
                    })
                  }
                  format={(value) => formatDuration(value)}
                />
                <RangeField
                  label={t("studio.clipDuration")}
                  id="clip-duration"
                  value={selected.clip.duration}
                  min={0.1}
                  max={Math.max(
                    0.1,
                    (assets[selected.clip.asset_id]?.duration ?? selected.clip.duration) -
                      selected.clip.offset,
                  )}
                  step={0.01}
                  onChange={(value) =>
                    mutateClip(selectedClip, (clip) => {
                      clip.duration = value;
                      clip.fade_in = Math.min(clip.fade_in, value / 2);
                      clip.fade_out = Math.min(clip.fade_out, value / 2);
                    })
                  }
                  format={(value) => formatDuration(value)}
                />
                <div className="form-grid__two">
                  <RangeField
                    label={t("studio.fadeIn")}
                    id="clip-fade-in"
                    value={selected.clip.fade_in}
                    min={0}
                    max={selected.clip.duration / 2}
                    step={0.01}
                    onChange={(value) =>
                      mutateClip(selectedClip, (clip) => {
                        clip.fade_in = value;
                      })
                    }
                    format={(value) => `${value.toFixed(2)} s`}
                  />
                  <RangeField
                    label={t("studio.fadeOut")}
                    id="clip-fade-out"
                    value={selected.clip.fade_out}
                    min={0}
                    max={selected.clip.duration / 2}
                    step={0.01}
                    onChange={(value) =>
                      mutateClip(selectedClip, (clip) => {
                        clip.fade_out = value;
                      })
                    }
                    format={(value) => `${value.toFixed(2)} s`}
                  />
                </div>
              </div>
            ) : (
              <p className="muted small">{t("studio.noSelection")}</p>
            )}
          </Panel>

          <Panel title={t("studio.master")} subtitle={t("studio.renderNote")}>
            <div className="stack">
              <RangeField
                label={t("studio.masterVolume")}
                id="master-volume"
                value={document.master.volume}
                min={0}
                max={2}
                step={0.01}
                onChange={(value) =>
                  mutateDocument((draft) => {
                    draft.master.volume = value;
                  })
                }
                format={(value) => `${Math.round(value * 100)}%`}
              />
              <Switch
                checked={document.master.normalize}
                onChange={(checked) =>
                  mutateDocument((draft) => {
                    draft.master.normalize = checked;
                  })
                }
                label={t("export.normalize")}
                description={t("export.normalizeHint")}
              />
              <Switch
                checked={autosave}
                onChange={setAutosave}
                label={t("studio.autosave")}
                description={t("studio.autosaved")}
              />
              {renderedAsset ? (
                <div className="stack stack--tight">
                  <p className="inline-status">{formatDuration(renderedAsset.duration)}</p>
                  <Button
                    size="sm"
                    icon={<Download size={14} aria-hidden="true" />}
                    onClick={() => setExportOpen(true)}
                  >
                    {t("studio.exportAfterRender")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => navigate(`/editor/${renderedAsset.id}`)}
                  >
                    {t("studio.openInEditor")}
                  </Button>
                </div>
              ) : (
                <p className="muted small">{t("studio.renderFirst")}</p>
              )}
              <Button
                variant="primary"
                icon={<Wand2 size={15} aria-hidden="true" />}
                loading={rendering}
                disabled={clipCount === 0}
                onClick={() => void renderMix()}
              >
                {rendering ? t("studio.rendering") : t("studio.renderExport")}
              </Button>
            </div>
          </Panel>

          <Panel title={t("studio.effectChain")} subtitle={t("studio.effectsNotice")}>
            <div className="effect-list">
              <div className="add-effect-row">
                <Select
                  value={effectToAdd}
                  aria-label={t("studio.addEffect")}
                  onChange={(event) => setEffectToAdd(event.target.value as EffectType)}
                >
                  {(Object.keys(EFFECT_KEYS) as EffectType[]).map((type) => (
                    <option key={type} value={type}>
                      {t(EFFECT_KEYS[type])}
                    </option>
                  ))}
                </Select>
                <Button size="sm" icon={<Plus size={14} aria-hidden="true" />} onClick={addEffect}>
                  {t("studio.addEffect")}
                </Button>
              </div>

              {document.master.effects.length === 0 ? (
                <p className="muted small">{t("studio.addEffectHint")}</p>
              ) : (
                document.master.effects.map((effect, index) => (
                  <div className="effect-card" key={`${effect.type}-${index}`}>
                    <div className="effect-card__head">
                      <strong>{t(EFFECT_KEYS[effect.type])}</strong>
                      <div className="row">
                        <Switch
                          checked={effect.enabled}
                          onChange={(checked) =>
                            mutateDocument((draft) => {
                              const target = draft.master.effects[index];
                              if (target) target.enabled = checked;
                            })
                          }
                          label={t("studio.effectEnabled")}
                        />
                        <IconButton
                          label={t("studio.removeEffect")}
                          size="sm"
                          onClick={() =>
                            mutateDocument((draft) => {
                              draft.master.effects.splice(index, 1);
                            })
                          }
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </IconButton>
                      </div>
                    </div>
                    <div className="effect-params">
                      {Object.keys(EFFECT_RANGES[effect.type]).map((name) => {
                        const range = EFFECT_RANGES[effect.type][name];
                        const value =
                          effect.params[name] ?? EFFECT_DEFAULTS[effect.type][name] ?? 0;
                        return (
                          <RangeField
                            key={name}
                            label={t(PARAM_KEY[name] ?? name)}
                            value={value}
                            min={range.min}
                            max={range.max}
                            step={range.step}
                            onChange={(next) =>
                              mutateDocument((draft) => {
                                const target = draft.master.effects[index];
                                if (target) target.params[name] = next;
                              })
                            }
                            format={(next) =>
                              range.unit === "db"
                                ? `${next.toFixed(1)} dB`
                                : range.unit === "ms"
                                  ? `${Math.round(next)} ms`
                                  : range.unit === "s"
                                    ? `${next.toFixed(2)} s`
                                    : next.toFixed(2)
                            }
                          />
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
              <p className="muted small">{t("studio.effectPreviewUnavailable")}</p>
            </div>
          </Panel>

          <Panel title={t("studio.track")}>
            <p className="muted small">
              {t("studio.pan")}:{" "}
              {panLabel(selected?.track.pan ?? 0, {
                left: t("studio.left"),
                center: t("studio.panCenter"),
                right: t("studio.right"),
              })}
            </p>
            <p className="muted small">{t("studio.snapHint")}</p>
          </Panel>
        </aside>
      </div>

      {pickerOpen ? (
        <AssetPicker
          title={t("studio.chooseAsset")}
          confirmLabel={t("studio.addToTimeline")}
          onClose={() => setPickerOpen(false)}
          onPick={(assetsPicked) => {
            const asset = assetsPicked[0];
            if (asset) addAssetToTimeline(asset);
          }}
        />
      ) : null}

      {exportOpen && renderedAsset ? (
        <ExportDialog asset={renderedAsset} onClose={() => setExportOpen(false)} />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title={t("studio.deleteProject")}
          message={t("studio.deleteProjectBody", { name: deleteTarget.name })}
          confirmLabel={t("common.delete")}
          danger
          busy={deleting}
          onConfirm={() => void deleteProject()}
          onClose={() => setDeleteTarget(null)}
        />
      ) : null}

      {createOpen ? (
        <Modal
          title={t("studio.newProject")}
          onClose={() => setCreateOpen(false)}
          size="sm"
          footer={
            <>
              <Button onClick={() => setCreateOpen(false)}>{t("common.cancel")}</Button>
              <Button
                variant="primary"
                loading={creating}
                disabled={projectName.trim().length === 0}
                onClick={() => void createProject()}
              >
                {t("studio.createProject")}
              </Button>
            </>
          }
        >
          <div className="form-grid">
            <Field label={t("studio.projectName")} htmlFor="studio-project-name">
              <TextInput
                id="studio-project-name"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder={t("studio.projectNamePlaceholder")}
                maxLength={200}
                autoFocus
              />
            </Field>
            <Field label={t("studio.sampleRate")} htmlFor="studio-project-rate">
              <Select
                id="studio-project-rate"
                value={projectRate}
                onChange={(event) => setProjectRate(Number(event.target.value))}
              >
                {SAMPLE_RATES.map((rate) => (
                  <option key={rate} value={rate}>
                    {rate} Hz
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
