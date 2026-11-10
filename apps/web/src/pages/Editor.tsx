import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowUpDown,
  Copy,
  Download,
  Eraser,
  FileAudio,
  FolderPlus,
  Link2,
  Play,
  RefreshCcw,
  Repeat,
  Scissors,
  Split,
  TrendingDown,
  TrendingUp,
  Undo2,
  Redo2,
  Upload,
  Volume2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { api } from "../api/client";
import type { AssetInfo, AudioOperation, AudioOperationRequest } from "../api/types";
import { AssetPicker } from "../components/AssetPicker";
import { AudioPlayer, type AudioPlayerHandle } from "../components/AudioPlayer";
import { ExportDialog } from "../components/ExportDialog";
import { Modal } from "../components/Modal";
import {
  Button,
  EmptyState,
  IconButton,
  InlineNotice,
  PageHeader,
  Panel,
  RangeField,
  Spinner,
} from "../components/ui";
import { Waveform, type Selection } from "../components/Waveform";
import { useI18n } from "../i18n";
import { describeError } from "../lib/errors";
import { clamp, formatDuration } from "../lib/format";
import { useDocumentTitle } from "../lib/hooks";
import { addAssetToNewProject } from "../lib/studioActions";
import { useToast } from "../state/toast";

interface HistoryEntry {
  asset: AssetInfo;
  labelKey: string;
  at: number;
}

const OPERATION_KEYS: Record<AudioOperation, string> = {
  trim: "editor.trim",
  silence: "editor.silence",
  fade_in: "editor.fadeIn",
  fade_out: "editor.fadeOut",
  gain: "editor.gain",
  normalize: "editor.normalize",
  reverse: "editor.reverse",
  loop: "editor.loopCrossfade",
  split: "editor.split",
  duplicate: "editor.duplicate",
};

export function EditorPage() {
  const { assetId } = useParams();
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const navigate = useNavigate();

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const current = history[historyIndex]?.asset ?? null;
  const currentId = current?.id ?? null;

  const [peaks, setPeaks] = useState<number[][] | null>(null);
  const [waveLoading, setWaveLoading] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState<AudioOperation | null>(null);
  const [importing, setImporting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinPickerOpen, setJoinPickerOpen] = useState(false);
  const [joinAssets, setJoinAssets] = useState<AssetInfo[]>([]);
  const [joining, setJoining] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const [fadeDuration, setFadeDuration] = useState(1);
  const [gainDb, setGainDb] = useState(0);
  const [crossfade, setCrossfade] = useState(1);

  const fileInput = useRef<HTMLInputElement>(null);
  const playerRef = useRef<AudioPlayerHandle>(null);

  useDocumentTitle(current ? t("editor.titleForAsset", { name: current.name }) : t("editor.title"));

  const loadSource = (asset: AssetInfo) => {
    playerRef.current?.stop();
    setHistory([{ asset, labelKey: "editor.sourceLabel", at: Date.now() }]);
    setHistoryIndex(0);
    setSelection(null);
    setPlayhead(0);
  };

  useEffect(() => {
    if (!assetId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const asset = await api.asset(assetId);
        if (!cancelled) loadSource(asset);
      } catch (caught) {
        if (!cancelled) notify({ message: describeError(caught, t).message, tone: "error" });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // Loading is keyed only by the route parameter; notify/t are stable enough here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  useEffect(() => {
    if (!currentId) {
      setPeaks(null);
      return;
    }
    let cancelled = false;
    setWaveLoading(true);
    setPeaks(null);
    const load = async () => {
      try {
        const response = await api.waveform(currentId, 1600);
        if (!cancelled) setPeaks(response.peaks);
      } catch {
        if (!cancelled) setPeaks(null);
      } finally {
        if (!cancelled) setWaveLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [currentId]);

  useEffect(() => {
    setSelection(null);
    setPlayhead(0);
    playerRef.current?.stop();
  }, [currentId]);

  const duration = current?.duration ?? 0;
  const selectionStart = selection ? Math.min(selection.start, selection.end) : 0;
  const selectionEnd = selection ? Math.max(selection.start, selection.end) : 0;
  const selectionLength = Math.max(0, selectionEnd - selectionStart);
  const hasSelection = selectionLength > 0.01;

  const applyOperation = async (
    operation: AudioOperation,
    extra: Partial<AudioOperationRequest> = {},
  ) => {
    if (!current || busy) return;
    if ((operation === "trim" || operation === "silence") && !hasSelection) {
      notify({ message: t("editor.selectionRequired"), tone: "warning" });
      return;
    }
    if (operation === "split" && (playhead <= 0.01 || playhead >= duration - 0.01)) {
      notify({ message: t("editor.playheadRequired"), tone: "warning" });
      return;
    }
    setBusy(operation);
    try {
      const response = await api.operate(current.id, { operation, ...extra });
      const target = response.assets[0];
      if (!target) throw new Error(t("editor.operationFailed"));
      const entry: HistoryEntry = {
        asset: target,
        labelKey: OPERATION_KEYS[operation],
        at: Date.now(),
      };
      setHistory((previous) => [...previous.slice(0, historyIndex + 1), entry]);
      setHistoryIndex((value) => value + 1);
      setSelection(null);
      notify({
        message: t("editor.operationDone", { operation: t(OPERATION_KEYS[operation]) }),
        tone: "success",
      });
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    try {
      const asset = await api.importAsset(file, "other");
      loadSource(asset);
      notify({ message: t("library.imported"), tone: "success" });
      navigate(`/editor/${asset.id}`, { replace: true });
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const joinSelected = async () => {
    if (joinAssets.length < 2) {
      notify({ message: t("library.joinNeedsTwo"), tone: "warning" });
      return;
    }
    setJoining(true);
    try {
      const response = await api.joinAssets({
        asset_ids: joinAssets.map((asset) => asset.id),
        crossfade,
      });
      const asset = response.assets[0];
      if (asset) {
        loadSource(asset);
        navigate(`/editor/${asset.id}`, { replace: true });
        notify({ message: t("library.joined"), tone: "success" });
        setJoinOpen(false);
        setJoinPickerOpen(false);
        setJoinAssets([]);
      }
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
    } finally {
      setJoining(false);
    }
  };

  const sendToStudio = async () => {
    if (!current) return;
    setSending(true);
    try {
      const project = await addAssetToNewProject(current);
      notify({ message: t("editor.addedToStudio"), tone: "success" });
      navigate(`/studio/${project.id}`);
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
    } finally {
      setSending(false);
    }
  };

  const playSelection = () => {
    if (!hasSelection) {
      notify({ message: t("editor.selectionRequired"), tone: "warning" });
      return;
    }
    playerRef.current?.playRange(selectionStart, selectionEnd);
  };

  const seek = (time: number) => {
    setPlayhead(time);
    playerRef.current?.seek(time);
  };

  const formatTime = (timeMs: number) =>
    new Date(timeMs).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="page">
      <PageHeader
        title={current ? t("editor.titleForAsset", { name: current.name }) : t("editor.title")}
        subtitle={t("editor.subtitle")}
        actions={
          <>
            <Link className="text-button" to="/library">
              <FileAudio size={15} aria-hidden="true" /> {t("editor.goLibrary")}
            </Link>
            <Button
              variant="secondary"
              icon={<Link2 size={15} aria-hidden="true" />}
              onClick={() => setJoinOpen(true)}
            >
              {t("editor.join")}
            </Button>
            <Button
              variant="primary"
              icon={<Upload size={15} aria-hidden="true" />}
              loading={importing}
              onClick={() => fileInput.current?.click()}
            >
              {t("editor.importAudio")}
            </Button>
          </>
        }
      />
      <input
        ref={fileInput}
        type="file"
        accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a,.aiff,.aif"
        hidden
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />

      <InlineNotice tone="info">{t("editor.editingNote")}</InlineNotice>

      {!current ? (
        <Panel>
          <EmptyState
            icon={<Scissors size={24} aria-hidden="true" />}
            title={t("editor.noAssetTitle")}
            body={t("editor.noAssetBody")}
            action={
              <div className="row row--wrap">
                <Button variant="primary" onClick={() => setPickerOpen(true)}>
                  {t("editor.chooseSource")}
                </Button>
                <Button onClick={() => fileInput.current?.click()} loading={importing}>
                  {t("editor.importAudio")}
                </Button>
              </div>
            }
          />
        </Panel>
      ) : (
        <div className="editor-layout">
          <div className="editor-main">
            <Panel
              title={t("editor.source")}
              action={
                <Button size="sm" variant="ghost" onClick={() => setPickerOpen(true)}>
                  {t("editor.chooseSource")}
                </Button>
              }
            >
              <div className="editor-source">
                <span className="empty__icon" aria-hidden="true">
                  <FileAudio size={22} />
                </span>
                <div className="editor-source__meta">
                  <strong>{history[historyIndex]?.asset.name}</strong>
                  <small>
                    {formatDuration(current.duration)} · {current.sample_rate} Hz ·{" "}
                    {current.channels === 1 ? t("common.mono") : t("common.stereo")} ·{" "}
                    {current.format.toUpperCase()}
                  </small>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setExportOpen(true)}>
                  {t("editor.export")}
                </Button>
              </div>
            </Panel>

            <Panel
              title={t("editor.timeline")}
              subtitle={t("editor.unsavedChanges")}
              action={
                <div className="row">
                  <IconButton
                    label={t("editor.zoomOut")}
                    size="sm"
                    onClick={() => setZoom((value) => clamp(value / 1.5, 1, 12))}
                    disabled={zoom <= 1}
                  >
                    <ZoomOut size={15} aria-hidden="true" />
                  </IconButton>
                  <span className="muted small">{zoom.toFixed(1)}×</span>
                  <IconButton
                    label={t("editor.zoomIn")}
                    size="sm"
                    onClick={() => setZoom((value) => clamp(value * 1.5, 1, 12))}
                    disabled={zoom >= 12}
                  >
                    <ZoomIn size={15} aria-hidden="true" />
                  </IconButton>
                </div>
              }
            >
              <div className="editor-wave">
                <div className="editor-wave__scroll">
                  <div className="editor-wave__inner" style={{ width: `${zoom * 100}%` }}>
                    <Waveform
                      peaks={peaks}
                      duration={duration}
                      selection={selection}
                      playhead={playhead}
                      loading={waveLoading}
                      onSelect={setSelection}
                      onSeek={seek}
                      height={148}
                      label={`${t("a11y.waveform")}: ${current.name}`}
                    />
                  </div>
                </div>

                <div className="editor-selection">
                  {selection ? (
                    <>
                      <strong>{t("editor.selection")}:</strong>
                      <span>
                        {formatDuration(selectionStart)} – {formatDuration(selectionEnd)}
                      </span>
                      <span className="muted">
                        {t("editor.selectionLength", { duration: formatDuration(selectionLength) })}
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => setSelection(null)}>
                        {t("common.clear")}
                      </Button>
                    </>
                  ) : (
                    <span className="muted">{t("editor.noSelectionHint")}</span>
                  )}
                  <span className="spacer" />
                  <span className="muted">
                    {t("editor.playhead")}: {formatDuration(playhead)}
                  </span>
                </div>

                <div className="editor-transport">
                  <AudioPlayer
                    ref={playerRef}
                    key={current.id}
                    src={api.audioUrl(current.id)}
                    title={current.name}
                    durationHint={current.duration}
                    onTimeUpdate={setPlayhead}
                    onEnded={() => setPlayhead(0)}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Play size={14} aria-hidden="true" />}
                    onClick={playSelection}
                    disabled={!hasSelection}
                  >
                    {t("editor.playSelection")}
                  </Button>
                </div>
              </div>
            </Panel>

            <Panel title={t("editor.moreTools")} subtitle={t("editor.operationPreview")}>
              <div className="stack">
                <div className="form-grid__two">
                  <RangeField
                    label={t("editor.fadeDuration")}
                    id="editor-fade"
                    value={fadeDuration}
                    min={0.05}
                    max={Math.max(0.1, Math.min(10, duration))}
                    step={0.05}
                    onChange={setFadeDuration}
                    format={(value) => `${value.toFixed(2)} s`}
                  />
                  <RangeField
                    label={t("editor.gainAmount")}
                    id="editor-gain"
                    value={gainDb}
                    min={-24}
                    max={12}
                    step={0.5}
                    onChange={setGainDb}
                    format={(value) => `${value > 0 ? "+" : ""}${value.toFixed(1)} dB`}
                  />
                </div>
                <RangeField
                  label={t("editor.loopLength")}
                  id="editor-crossfade"
                  value={crossfade}
                  min={0.05}
                  max={Math.max(0.1, Math.min(5, duration / 2))}
                  step={0.05}
                  onChange={setCrossfade}
                  format={(value) => `${value.toFixed(2)} s`}
                />

                <div className="operation-grid">
                  <OperationButton
                    icon={<Scissors size={15} />}
                    label={t("editor.trim")}
                    disabled={!hasSelection}
                    busy={busy === "trim"}
                    onClick={() =>
                      void applyOperation("trim", { start: selectionStart, end: selectionEnd })
                    }
                  />
                  <OperationButton
                    icon={<Eraser size={15} />}
                    label={t("editor.silence")}
                    disabled={!hasSelection}
                    busy={busy === "silence"}
                    onClick={() =>
                      void applyOperation("silence", { start: selectionStart, end: selectionEnd })
                    }
                  />
                  <OperationButton
                    icon={<TrendingUp size={15} />}
                    label={t("editor.fadeIn")}
                    busy={busy === "fade_in"}
                    onClick={() => void applyOperation("fade_in", { amount: fadeDuration })}
                  />
                  <OperationButton
                    icon={<TrendingDown size={15} />}
                    label={t("editor.fadeOut")}
                    busy={busy === "fade_out"}
                    onClick={() => void applyOperation("fade_out", { amount: fadeDuration })}
                  />
                  <OperationButton
                    icon={<Volume2 size={15} />}
                    label={t("editor.gainDb", { db: gainDb.toFixed(1) })}
                    busy={busy === "gain"}
                    onClick={() => void applyOperation("gain", { amount: gainDb })}
                  />
                  <OperationButton
                    icon={<ArrowUpDown size={15} />}
                    label={t("editor.normalize")}
                    busy={busy === "normalize"}
                    onClick={() => void applyOperation("normalize")}
                  />
                  <OperationButton
                    icon={<RefreshCcw size={15} />}
                    label={t("editor.reverse")}
                    busy={busy === "reverse"}
                    onClick={() => void applyOperation("reverse")}
                  />
                  <OperationButton
                    icon={<Repeat size={15} />}
                    label={t("editor.loopCrossfade")}
                    busy={busy === "loop"}
                    onClick={() => void applyOperation("loop", { crossfade })}
                  />
                  <OperationButton
                    icon={<Split size={15} />}
                    label={t("editor.split")}
                    busy={busy === "split"}
                    onClick={() => void applyOperation("split", { start: playhead })}
                  />
                  <OperationButton
                    icon={<Copy size={15} />}
                    label={t("editor.duplicate")}
                    busy={busy === "duplicate"}
                    onClick={() => void applyOperation("duplicate")}
                  />
                </div>
              </div>
            </Panel>
          </div>

          <aside className="editor-side">
            <Panel
              title={t("editor.history")}
              action={
                <div className="row">
                  <IconButton
                    label={t("editor.undo")}
                    size="sm"
                    disabled={historyIndex <= 0}
                    onClick={() => setHistoryIndex((value) => Math.max(0, value - 1))}
                  >
                    <Undo2 size={15} aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={t("editor.redo")}
                    size="sm"
                    disabled={historyIndex >= history.length - 1}
                    onClick={() =>
                      setHistoryIndex((value) => Math.min(history.length - 1, value + 1))
                    }
                  >
                    <Redo2 size={15} aria-hidden="true" />
                  </IconButton>
                </div>
              }
            >
              {history.length === 0 ? (
                <EmptyState compact title={t("editor.historyEmpty")} />
              ) : (
                <div className="editor-history">
                  {history.map((entry, index) => (
                    <button
                      key={`${entry.asset.id}-${entry.at}`}
                      type="button"
                      className={`editor-history__item${index === historyIndex ? " is-current" : ""}`}
                      onClick={() => setHistoryIndex(index)}
                    >
                      <span>
                        <strong>{t(entry.labelKey)}</strong>
                        <br />
                        <span className="small muted">{entry.asset.name}</span>
                      </span>
                      <small>{formatTime(entry.at)}</small>
                    </button>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title={t("editor.exportEdited")}>
              <div className="stack stack--tight">
                <Button
                  variant="primary"
                  icon={<Download size={15} aria-hidden="true" />}
                  onClick={() => setExportOpen(true)}
                >
                  {t("editor.export")}
                </Button>
                <Button
                  icon={<FolderPlus size={15} aria-hidden="true" />}
                  loading={sending}
                  onClick={() => void sendToStudio()}
                >
                  {t("editor.addToStudio")}
                </Button>
                <p className="muted small">
                  {t("editor.currentLabel")}: {current.name}
                </p>
                {history.length > 1 ? (
                  <p className="muted small">
                    {t("editor.sourceLabel")}: {history[0].asset.name}
                  </p>
                ) : null}
              </div>
            </Panel>
          </aside>
        </div>
      )}

      {pickerOpen ? (
        <AssetPicker
          title={t("editor.chooseSource")}
          onClose={() => setPickerOpen(false)}
          onPick={(assets) => {
            const asset = assets[0];
            if (!asset) return;
            loadSource(asset);
            navigate(`/editor/${asset.id}`, { replace: true });
          }}
        />
      ) : null}

      {joinOpen ? (
        <Modal
          title={t("editor.joinTitle")}
          description={t("editor.joinHint")}
          onClose={() => setJoinOpen(false)}
          size="md"
          footer={
            <>
              <Button onClick={() => setJoinOpen(false)}>{t("common.cancel")}</Button>
              <Button
                variant="primary"
                disabled={joinAssets.length < 2}
                loading={joining}
                onClick={() => void joinSelected()}
              >
                {t("editor.joinAction")}
              </Button>
            </>
          }
        >
          <div className="stack">
            <div className="row row--wrap">
              <Button size="sm" onClick={() => setJoinPickerOpen(true)}>
                {t("editor.chooseSource")}
              </Button>
              <span className="muted small">
                {joinAssets.length ? `${joinAssets.length}` : "0"}
              </span>
            </div>
            <RangeField
              label={t("editor.crossfade")}
              id="editor-join-crossfade"
              value={crossfade}
              min={0}
              max={5}
              step={0.05}
              onChange={setCrossfade}
              format={(value) => `${value.toFixed(2)} s`}
            />
            {joinAssets.length > 0 ? (
              <ul className="check-list">
                {joinAssets.map((asset, index) => (
                  <li key={asset.id}>
                    <span className="badge">{index + 1}</span>
                    <span>{asset.name}</span>
                    <span className="muted small">{formatDuration(asset.duration)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">{t("editor.joinHint")}</p>
            )}
          </div>
        </Modal>
      ) : null}

      {joinPickerOpen ? (
        <AssetPicker
          multiple
          title={t("editor.joinTitle")}
          confirmLabel={t("editor.joinAction")}
          onClose={() => setJoinPickerOpen(false)}
          onPick={(assets) => {
            setJoinAssets(assets);
            setJoinPickerOpen(false);
          }}
        />
      ) : null}

      {exportOpen && current ? (
        <ExportDialog asset={current} onClose={() => setExportOpen(false)} />
      ) : null}
    </div>
  );
}

function OperationButton({
  icon,
  label,
  onClick,
  disabled,
  busy,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      className="operation-button"
      onClick={onClick}
      disabled={disabled || busy}
    >
      {busy ? <Spinner size={14} /> : icon}
      <span>{label}</span>
    </button>
  );
}
