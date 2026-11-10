import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Copy, FileAudio, FolderOpen } from "lucide-react";
import { api } from "../api/client";
import type { AssetInfo, ExportCapabilities, ExportResult } from "../api/types";
import { useI18n } from "../i18n";
import { describeError } from "../lib/errors";
import { formatBytes, formatDuration, formatSampleRate } from "../lib/format";
import { useSettings } from "../state/settings";
import { useToast } from "../state/toast";
import { Modal } from "./Modal";
import {
  Badge,
  Button,
  Field,
  InlineNotice,
  ProgressBar,
  Select,
  Spinner,
  Switch,
  TextInput,
} from "./ui";

const SAMPLE_RATES = [22050, 32000, 44100, 48000, 96000];

function bitDepthsFor(format: string): number[] {
  if (format === "wav") return [16, 24, 32];
  if (format === "flac" || format === "aiff") return [16, 24];
  return [];
}

export function ExportDialog({
  asset,
  onClose,
  onExported,
}: {
  asset: AssetInfo;
  onClose: () => void;
  onExported?: (result: ExportResult) => void;
}) {
  const { t } = useI18n();
  const { settings } = useSettings();
  const { notify } = useToast();
  const [capabilities, setCapabilities] = useState<ExportCapabilities | null>(null);
  const [loadingCapabilities, setLoadingCapabilities] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [format, setFormat] = useState("wav");
  const [bitDepth, setBitDepth] = useState(24);
  const [bitrate, setBitrate] = useState(192);
  const [sampleRate, setSampleRate] = useState(asset.sample_rate);
  const [channels, setChannels] = useState<1 | 2>(asset.channels >= 2 ? 2 : 1);
  const [filename, setFilename] = useState(asset.name);
  const [normalize, setNormalize] = useState(false);
  const [peakDb, setPeakDb] = useState(-1);
  const [dither, setDither] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [exportFolder, setExportFolder] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadingCapabilities(true);
      try {
        const [caps, folder] = await Promise.all([api.exportCapabilities(), api.exportFolder()]);
        if (cancelled) return;
        setCapabilities(caps);
        setExportFolder(folder.path);
        const preferred =
          caps.formats.find(
            (item) => item.id === settings?.default_export_format && item.available,
          ) ??
          caps.formats.find((item) => item.id === "wav" && item.available) ??
          caps.formats.find((item) => item.available);
        if (preferred) setFormat(preferred.id);
        setLoadError(null);
      } catch (caught) {
        if (!cancelled) setLoadError(caught);
      } finally {
        if (!cancelled) setLoadingCapabilities(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [settings?.default_export_format]);

  const selectedFormat = useMemo(
    () => capabilities?.formats.find((item) => item.id === format) ?? null,
    [capabilities, format],
  );
  const depths = bitDepthsFor(format);

  useEffect(() => {
    if (depths.length > 0 && !depths.includes(bitDepth)) setBitDepth(depths[depths.length - 1]);
    // The available bit depths depend only on the selected container.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format]);

  const submit = async () => {
    setExporting(true);
    setError(null);
    try {
      const exported = await api.exportAudio({
        asset_id: asset.id,
        format,
        bitrate_kbps: selectedFormat?.supports_bitrate ? bitrate : null,
        sample_rate: sampleRate,
        bit_depth: selectedFormat?.supports_bit_depth ? bitDepth : null,
        channels,
        filename: filename.trim() || null,
        normalize_peak_db: normalize ? peakDb : null,
        dither: selectedFormat?.supports_bit_depth ? dither : false,
      });
      setResult(exported);
      notify({ message: t("export.success"), tone: "success" });
      onExported?.(exported);
    } catch (caught) {
      setError(caught);
      notify({ message: describeError(caught, t).message, tone: "error" });
    } finally {
      setExporting(false);
    }
  };

  if (result) {
    return (
      <Modal
        title={t("export.success")}
        onClose={onClose}
        footer={
          <Button variant="primary" onClick={onClose}>
            {t("common.close")}
          </Button>
        }
      >
        <div className="export-success">
          <div className="export-success__icon">
            <CheckCircle2 size={32} aria-hidden="true" />
          </div>
          <div className="export-success__body">
            <div className="row row--wrap">
              <Badge tone="success">{result.format.toUpperCase()}</Badge>
              {result.verified ? <Badge tone="info">{t("export.verifiedBadge")}</Badge> : null}
              <span className="muted">{formatBytes(result.size_bytes)}</span>
              {result.duration ? (
                <span className="muted">{formatDuration(result.duration)}</span>
              ) : null}
            </div>
            <p>{result.verified ? t("export.verified") : t("export.notVerified")}</p>
            <div className="path-box">
              <FileAudio size={15} aria-hidden="true" />
              <code>{result.path}</code>
              <Button
                size="sm"
                variant="ghost"
                icon={<Copy size={14} aria-hidden="true" />}
                onClick={() => {
                  void navigator.clipboard?.writeText(result.path);
                  notify({ message: t("common.copied"), tone: "success" });
                }}
              >
                {t("common.copy")}
              </Button>
            </div>
          </div>
        </div>
        <div className="modal-actions">
          <Button
            onClick={() => {
              setResult(null);
              setExporting(false);
            }}
          >
            {t("export.exportAgain")}
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={t("export.title")}
      description={t("export.subtitle")}
      onClose={onClose}
      size="lg"
      dismissible={!exporting}
      footer={
        <>
          <Button onClick={onClose} disabled={exporting}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            loading={exporting}
            disabled={!selectedFormat?.available}
            icon={<FileAudio size={15} aria-hidden="true" />}
          >
            {exporting ? t("export.exporting") : t("export.export")}
          </Button>
        </>
      }
    >
      {loadingCapabilities ? (
        <div className="loading-row">
          <Spinner /> <span>{t("common.loading")}</span>
        </div>
      ) : loadError ? (
        <InlineNotice tone="danger">{describeError(loadError, t).message}</InlineNotice>
      ) : (
        <div className="form-grid">
          <div className="asset-summary">
            <FileAudio size={18} aria-hidden="true" />
            <div>
              <strong>{asset.name}</strong>
              <p className="muted small">
                {formatDuration(asset.duration)} · {formatSampleRate(asset.sample_rate)} ·{" "}
                {asset.channels === 1 ? t("common.mono") : t("common.stereo")}
              </p>
            </div>
          </div>

          <div className="form-grid__two">
            <Field label={t("export.format")} htmlFor="export-format">
              <Select
                id="export-format"
                value={format}
                onChange={(event) => setFormat(event.target.value)}
              >
                {capabilities?.formats.map((item) => (
                  <option key={item.id} value={item.id} disabled={!item.available}>
                    {item.label}
                    {item.available ? "" : ` — ${t("export.formatUnavailable")}`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t("export.fileSize")}
              htmlFor="export-filename"
              hint={t("export.filenameHint")}
            >
              <TextInput
                id="export-filename"
                value={filename}
                onChange={(event) => setFilename(event.target.value)}
                maxLength={180}
              />
            </Field>
          </div>

          {selectedFormat && !selectedFormat.available ? (
            <InlineNotice tone="warning">
              {selectedFormat.reason ?? t("export.formatUnavailable")}
            </InlineNotice>
          ) : null}

          <div className="form-grid__two">
            <Field label={t("export.sampleRate")} htmlFor="export-samplerate">
              <Select
                id="export-samplerate"
                value={sampleRate}
                onChange={(event) => setSampleRate(Number(event.target.value))}
              >
                {SAMPLE_RATES.map((rate) => (
                  <option key={rate} value={rate}>
                    {formatSampleRate(rate)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("export.channels")} htmlFor="export-channels">
              <Select
                id="export-channels"
                value={channels}
                onChange={(event) => setChannels(Number(event.target.value) === 1 ? 1 : 2)}
              >
                <option value={1}>{t("export.mono")}</option>
                <option value={2}>{t("export.stereo")}</option>
              </Select>
            </Field>
          </div>

          <div className="form-grid__two">
            {selectedFormat?.supports_bit_depth ? (
              <Field label={t("export.bitDepth")} htmlFor="export-bitdepth">
                <Select
                  id="export-bitdepth"
                  value={bitDepth}
                  onChange={(event) => setBitDepth(Number(event.target.value))}
                >
                  {depths.map((depth) => (
                    <option key={depth} value={depth}>
                      {depth}-bit
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {selectedFormat?.supports_bitrate ? (
              <Field label={t("export.bitrate")} htmlFor="export-bitrate">
                <Select
                  id="export-bitrate"
                  value={bitrate}
                  onChange={(event) => setBitrate(Number(event.target.value))}
                >
                  {[128, 160, 192, 256, 320].map((rate) => (
                    <option key={rate} value={rate}>
                      {rate} kbps
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>

          <Switch
            checked={normalize}
            onChange={setNormalize}
            label={t("export.normalize")}
            description={t("export.normalizeHint")}
          />
          {normalize ? (
            <div className="indent">
              <label className="field__label" htmlFor="export-peak">
                {t("export.normalizeValue", { db: peakDb.toFixed(1) })}
              </label>
              <input
                id="export-peak"
                type="range"
                className="range"
                min={-24}
                max={0}
                step={0.5}
                value={peakDb}
                onChange={(event) => setPeakDb(Number(event.target.value))}
              />
              <p className="field__hint">{t("export.peakNote")}</p>
            </div>
          ) : null}

          {selectedFormat?.supports_bit_depth ? (
            <Switch
              checked={dither}
              onChange={setDither}
              label={t("export.dither")}
              description={t("export.ditherHint")}
            />
          ) : null}

          {exportFolder ? (
            <div className="path-box path-box--muted">
              <FolderOpen size={15} aria-hidden="true" />
              <code>{exportFolder}</code>
            </div>
          ) : null}

          {error ? (
            <InlineNotice tone="danger">{describeError(error, t).message}</InlineNotice>
          ) : null}
          {exporting ? <ProgressBar value={null} label={t("export.exporting")} /> : null}
        </div>
      )}
    </Modal>
  );
}
