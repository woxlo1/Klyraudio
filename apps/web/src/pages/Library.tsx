import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FileAudio,
  FilePlus2,
  Heart,
  Library,
  Link2,
  Pencil,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import { api } from "../api/client";
import type { AssetInfo, AssetListResponse, MediaType, TagCount } from "../api/types";
import { AudioPlayer, type AudioPlayerHandle } from "../components/AudioPlayer";
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
  Select,
  Spinner,
  TextInput,
  Textarea,
} from "../components/ui";
import { useI18n } from "../i18n";
import { describeError } from "../lib/errors";
import {
  classNames,
  formatBytes,
  formatDuration,
  formatSampleRate,
} from "../lib/format";
import { useDocumentTitle } from "../lib/hooks";
import { addAssetToNewProject } from "../lib/studioActions";
import { useToast } from "../state/toast";

const PAGE_SIZE = 24;
const MEDIA_TYPES: MediaType[] = ["music", "sfx", "ambient", "voice", "other"];

function originKey(asset: AssetInfo): string {
  return asset.origin === "imported" ? "originImported" : asset.origin;
}

export function LibraryPage() {
  const { t, formatDate } = useI18n();
  const { notify } = useToast();
  const navigate = useNavigate();
  useDocumentTitle(t("library.title"));

  const [query, setQuery] = useState("");
  const [mediaType, setMediaType] = useState("");
  const [origin, setOrigin] = useState("");
  const [sort, setSort] = useState("newest");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [tag, setTag] = useState("");
  const [offset, setOffset] = useState(0);
  const [response, setResponse] = useState<AssetListResponse | null>(null);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [importing, setImporting] = useState(false);
  const [playerAsset, setPlayerAsset] = useState<AssetInfo | null>(null);
  const [detailsAsset, setDetailsAsset] = useState<AssetInfo | null>(null);
  const [exportAsset, setExportAsset] = useState<AssetInfo | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AssetInfo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [joining, setJoining] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const playerRef = useRef<AudioPlayerHandle>(null);
  const autoplayRef = useRef(false);

  const reload = async () => {
    setLoading(true);
    try {
      const [assets, tagCounts] = await Promise.all([
        api.assets({
          query: query.trim() || undefined,
          media_type: mediaType || undefined,
          origin: origin || undefined,
          favorite: favoritesOnly ? true : undefined,
          tag: tag || undefined,
          sort,
          limit: PAGE_SIZE,
          offset,
        }),
        api.assetTags(),
      ]);
      setResponse(assets);
      setTags(tagCounts);
      setError(null);
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const [assets, tagCounts] = await Promise.all([
          api.assets({
            query: query.trim() || undefined,
            media_type: mediaType || undefined,
            origin: origin || undefined,
            favorite: favoritesOnly ? true : undefined,
            tag: tag || undefined,
            sort,
            limit: PAGE_SIZE,
            offset,
          }),
          api.assetTags(),
        ]);
        if (cancelled) return;
        setResponse(assets);
        setTags(tagCounts);
        setError(null);
      } catch (caught) {
        if (!cancelled) setError(caught);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query ? 220 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, mediaType, origin, sort, favoritesOnly, tag, offset]);

  useEffect(() => {
    setOffset(0);
  }, [query, mediaType, origin, sort, favoritesOnly, tag]);

  useEffect(() => {
    if (!playerAsset || !autoplayRef.current) return;
    autoplayRef.current = false;
    const timer = window.setTimeout(() => void playerRef.current?.play(), 80);
    return () => window.clearTimeout(timer);
  }, [playerAsset]);

  const items = response?.items ?? [];
  const total = response?.total ?? 0;
  const hasFilters = Boolean(query || mediaType || origin || favoritesOnly || tag);

  const clearFilters = () => {
    setQuery("");
    setMediaType("");
    setOrigin("");
    setFavoritesOnly(false);
    setTag("");
    setSort("newest");
  };

  const playAsset = (asset: AssetInfo) => {
    autoplayRef.current = true;
    setPlayerAsset(asset);
  };

  const importFile = async (file: File) => {
    setImporting(true);
    try {
      const asset = await api.importAsset(file);
      notify({ message: t("library.imported"), tone: "success" });
      setSelectedIds([]);
      await reload();
      setDetailsAsset(asset);
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
    } finally {
      setImporting(false);
    }
  };

  const toggleFavorite = async (asset: AssetInfo) => {
    setBusyId(asset.id);
    try {
      const updated = await api.updateAsset(asset.id, { favorite: !asset.favorite });
      setResponse((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) => (item.id === updated.id ? updated : item)),
            }
          : current,
      );
      setDetailsAsset((current) => (current?.id === updated.id ? updated : current));
      notify({
        message: updated.favorite ? t("library.favoriteAdded") : t("library.favoriteRemoved"),
        tone: "success",
      });
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const deleteAsset = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteAsset(deleteTarget.id);
      notify({ message: t("library.deleted"), tone: "success" });
      setDeleteTarget(null);
      setDetailsAsset(null);
      setPlayerAsset((current) => (current?.id === deleteTarget.id ? null : current));
      setSelectedIds((current) => current.filter((id) => id !== deleteTarget.id));
      await reload();
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
    } finally {
      setDeleting(false);
    }
  };

  const joinSelected = async () => {
    if (selectedIds.length < 2) {
      notify({ message: t("library.joinNeedsTwo"), tone: "warning" });
      return;
    }
    setJoining(true);
    try {
      const result = await api.joinAssets({ asset_ids: selectedIds, crossfade: 0.05 });
      notify({ message: t("library.joined"), tone: "success" });
      setSelectedIds([]);
      setSelectMode(false);
      await reload();
      if (result.assets[0]) setDetailsAsset(result.assets[0]);
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
    } finally {
      setJoining(false);
    }
  };

  const sendToStudio = async (asset: AssetInfo) => {
    setBusyId(asset.id);
    try {
      const project = await addAssetToNewProject(asset);
      notify({ message: t("library.addedToStudio"), tone: "success" });
      navigate(`/studio/${project.id}`);
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const toggleSelected = (assetId: string) => {
    setSelectedIds((current) =>
      current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId],
    );
  };

  return (
    <div className="page">
      <PageHeader
        title={t("library.title")}
        subtitle={t("library.subtitle")}
        actions={
          <>
            <Button
              variant={selectMode ? "primary" : "secondary"}
              icon={<Link2 size={16} aria-hidden="true" />}
              onClick={() => {
                setSelectMode((value) => !value);
                setSelectedIds([]);
              }}
            >
              {selectMode ? t("library.clearSelection") : t("library.selectMode")}
            </Button>
            <Button
              variant="primary"
              icon={<Upload size={16} aria-hidden="true" />}
              loading={importing}
              onClick={() => fileInput.current?.click()}
            >
              {importing ? t("library.importing") : t("library.import")}
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="audio/*,.wav,.mp3,.flac,.ogg,.opus,.m4a,.aac,.aiff,.aif"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void importFile(file);
              }}
            />
          </>
        }
      />

      {error ? <InlineNotice tone="danger">{describeError(error, t).message}</InlineNotice> : null}

      <Panel className="library-toolbar" bodyClassName="library-toolbar__body">
        <div className="search-input">
          <Search size={15} aria-hidden="true" />
          <TextInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("library.searchPlaceholder")}
            aria-label={t("common.search")}
          />
        </div>
        <Select
          value={mediaType}
          onChange={(event) => setMediaType(event.target.value)}
          aria-label={t("library.type")}
        >
          <option value="">{t("library.allTypes")}</option>
          {MEDIA_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`mediaTypes.${type}`)}
            </option>
          ))}
        </Select>
        <Select
          value={origin}
          onChange={(event) => setOrigin(event.target.value)}
          aria-label={t("library.origin")}
        >
          <option value="">{t("library.allOrigins")}</option>
          <option value="generated">{t("library.generated")}</option>
          <option value="imported">{t("library.originImported")}</option>
          <option value="edited">{t("library.edited")}</option>
          <option value="rendered">{t("library.rendered")}</option>
        </Select>
        <Select value={tag} onChange={(event) => setTag(event.target.value)} aria-label={t("library.tags")}>
          <option value="">{t("library.allTags")}</option>
          {tags.map((entry) => (
            <option key={entry.tag} value={entry.tag}>
              {entry.tag} ({entry.count})
            </option>
          ))}
        </Select>
        <Select value={sort} onChange={(event) => setSort(event.target.value)} aria-label={t("library.sort")}>
          <option value="newest">{t("library.newest")}</option>
          <option value="oldest">{t("library.oldest")}</option>
          <option value="name">{t("library.name")}</option>
          <option value="duration">{t("library.duration")}</option>
        </Select>
        <Button
          variant={favoritesOnly ? "primary" : "ghost"}
          size="sm"
          icon={<Heart size={14} aria-hidden="true" />}
          onClick={() => setFavoritesOnly((value) => !value)}
        >
          {t("library.favoritesOnly")}
        </Button>
        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            {t("library.clearFilters")}
          </Button>
        ) : null}
      </Panel>

      {playerAsset ? (
        <Panel className="now-playing" bodyClassName="now-playing__body">
          <div className="now-playing__meta">
            <FileAudio size={18} aria-hidden="true" />
            <div>
              <strong>{playerAsset.name}</strong>
              <small>{formatDuration(playerAsset.duration)}</small>
            </div>
          </div>
          <AudioPlayer
            ref={playerRef}
            src={api.audioUrl(playerAsset.id)}
            durationHint={playerAsset.duration}
            compact
            onError={() => notify({ message: t("library.playError"), tone: "error" })}
          />
          <Button variant="ghost" size="sm" onClick={() => setPlayerAsset(null)}>
            {t("common.close")}
          </Button>
        </Panel>
      ) : null}

      {loading && !response ? (
        <div className="loading-row">
          <Spinner /> <span>{t("common.loading")}</span>
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Library size={26} aria-hidden="true" />}
          title={hasFilters ? t("library.emptyFilteredTitle") : t("library.emptyTitle")}
          body={hasFilters ? t("library.emptyFilteredBody") : t("library.emptyBody")}
          action={
            hasFilters ? (
              <Button onClick={clearFilters}>{t("library.clearFilters")}</Button>
            ) : (
              <Button variant="primary" onClick={() => navigate("/generate/music")}>
                {t("home.startMusic")}
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="library-summary">
            <span className="muted small">{t("library.total", { count: total })}</span>
            {selectMode ? (
              <span className="muted small">{t("library.selectionCount", { count: selectedIds.length })}</span>
            ) : null}
          </div>
          <div className="asset-grid">
            {items.map((asset) => {
              const selected = selectedIds.includes(asset.id);
              return (
                <article
                  key={asset.id}
                  className={classNames("asset-card", selected && "is-selected")}
                >
                  <button
                    type="button"
                    className="asset-card__main"
                    onClick={() => (selectMode ? toggleSelected(asset.id) : setDetailsAsset(asset))}
                    aria-label={asset.name}
                  >
                    <div className={classNames("asset-card__art", `asset-card__art--${asset.media_type}`)}>
                      <FileAudio size={22} aria-hidden="true" />
                      <span className="asset-card__duration">{formatDuration(asset.duration)}</span>
                      {selectMode ? (
                        <span className={classNames("asset-card__check", selected && "is-on")}>
                          {selected ? "✓" : ""}
                        </span>
                      ) : null}
                    </div>
                    <strong className="asset-card__name">{asset.name}</strong>
                    <span className="asset-card__meta">
                      {t(`mediaTypes.${asset.media_type}`)} · {t(`library.${originKey(asset)}`)}
                    </span>
                    {asset.tags.length > 0 ? (
                      <span className="tag-row tag-row--compact">
                        {asset.tags.slice(0, 3).map((entry) => (
                          <span key={entry} className="tag">
                            {entry}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </button>
                  <div className="asset-card__actions">
                    <IconButton
                      label={t("library.play")}
                      size="sm"
                      onClick={() => playAsset(asset)}
                      disabled={selectMode}
                    >
                      <Play size={14} aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      label={asset.favorite ? t("common.unfavorite") : t("common.favorite")}
                      size="sm"
                      active={asset.favorite}
                      onClick={() => void toggleFavorite(asset)}
                      disabled={busyId === asset.id}
                    >
                      <Heart size={14} aria-hidden="true" fill={asset.favorite ? "currentColor" : "none"} />
                    </IconButton>
                    <IconButton label={t("library.details")} size="sm" onClick={() => setDetailsAsset(asset)}>
                      <SlidersHorizontal size={14} aria-hidden="true" />
                    </IconButton>
                    <IconButton label={t("library.openInEditor")} size="sm" onClick={() => navigate(`/editor/${asset.id}`)}>
                      <Pencil size={14} aria-hidden="true" />
                    </IconButton>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="pagination">
            <Button
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              {t("library.previousPage")}
            </Button>
            <span className="muted small">{t("library.page", { page: Math.floor(offset / PAGE_SIZE) + 1 })}</span>
            <Button
              size="sm"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              {t("library.nextPage")}
            </Button>
          </div>
        </>
      )}

      {selectMode && selectedIds.length > 0 ? (
        <div className="selection-bar" role="region" aria-label={t("library.selectionCount", { count: selectedIds.length })}>
          <span>{t("library.selectionCount", { count: selectedIds.length })}</span>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>
            {t("library.clearSelection")}
          </Button>
          <Button size="sm" variant="primary" loading={joining} icon={<Link2 size={14} aria-hidden="true" />} onClick={() => void joinSelected()}>
            {t("library.joinSelected")}
          </Button>
        </div>
      ) : null}

      {detailsAsset ? (
        <AssetDetails
          asset={detailsAsset}
          onClose={() => setDetailsAsset(null)}
          onChanged={(updated) => {
            setDetailsAsset(updated);
            setResponse((current) =>
              current
                ? {
                    ...current,
                    items: current.items.map((item) => (item.id === updated.id ? updated : item)),
                  }
                : current,
            );
          }}
          onDelete={() => setDeleteTarget(detailsAsset)}
          onExport={() => setExportAsset(detailsAsset)}
          onOpenEditor={() => navigate(`/editor/${detailsAsset.id}`)}
          onAddToStudio={() => void sendToStudio(detailsAsset)}
          onPlay={() => playAsset(detailsAsset)}
          busy={busyId === detailsAsset.id}
          formatDate={formatDate}
        />
      ) : null}

      {exportAsset ? (
        <ExportDialog asset={exportAsset} onClose={() => setExportAsset(null)} />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title={t("library.deleteTitle")}
          message={t("library.deleteBody", { name: deleteTarget.name })}
          confirmLabel={t("library.deleteConfirm")}
          danger
          busy={deleting}
          onConfirm={() => void deleteAsset()}
          onClose={() => setDeleteTarget(null)}
        />
      ) : null}
    </div>
  );
}

function AssetDetails({
  asset,
  onClose,
  onChanged,
  onDelete,
  onExport,
  onOpenEditor,
  onAddToStudio,
  onPlay,
  busy,
  formatDate,
}: {
  asset: AssetInfo;
  onClose: () => void;
  onChanged: (asset: AssetInfo) => void;
  onDelete: () => void;
  onExport: () => void;
  onOpenEditor: () => void;
  onAddToStudio: () => void;
  onPlay: () => void;
  busy: boolean;
  formatDate: (iso: string | null | undefined) => string;
}) {
  const { t } = useI18n();
  const { notify } = useToast();
  const [name, setName] = useState(asset.name);
  const [notes, setNotes] = useState(asset.notes);
  const [mediaType, setMediaType] = useState<MediaType>(asset.media_type);
  const [tags, setTags] = useState<string[]>(asset.tags);
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(asset.name);
    setNotes(asset.notes);
    setMediaType(asset.media_type);
    setTags(asset.tags);
    setTagInput("");
  }, [asset]);

  const addTag = () => {
    const value = tagInput.trim().replace(/,$/, "");
    if (!value) return;
    setTags((current) => (current.includes(value) ? current : [...current, value]));
    setTagInput("");
  };

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.updateAsset(asset.id, {
        name: name.trim() || asset.name,
        notes,
        media_type: mediaType,
        tags,
      });
      onChanged(updated);
      notify({ message: t("common.saved"), tone: "success" });
    } catch (caught) {
      notify({ message: describeError(caught, t).message, tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={t("library.details")}
      description={asset.name}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="danger" icon={<Trash2 size={15} aria-hidden="true" />} onClick={onDelete}>
            {t("common.delete")}
          </Button>
          <span className="spacer" />
          <Button onClick={onClose}>{t("common.close")}</Button>
          <Button variant="primary" loading={saving} onClick={() => void save()}>
            {t("library.saveTags")}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="asset-detail-head">
          <div className={classNames("asset-detail-art", `asset-card__art--${asset.media_type}`)}>
            <FileAudio size={28} aria-hidden="true" />
          </div>
          <dl className="detail-list detail-list--inline">
            <div><dt>{t("library.created")}</dt><dd>{formatDate(asset.created_at)}</dd></div>
            <div><dt>{t("library.duration")}</dt><dd>{formatDuration(asset.duration)}</dd></div>
            <div><dt>{t("library.sampleRate")}</dt><dd>{formatSampleRate(asset.sample_rate)}</dd></div>
            <div><dt>{t("library.channels")}</dt><dd>{asset.channels === 1 ? t("common.mono") : t("common.stereo")}</dd></div>
            <div><dt>{t("library.format")}</dt><dd>{asset.format.toUpperCase()}</dd></div>
            <div><dt>{t("library.size")}</dt><dd>{formatBytes(asset.size_bytes)}</dd></div>
          </dl>
        </div>

        <div className="row row--wrap">
          <Button size="sm" icon={<Play size={14} aria-hidden="true" />} onClick={onPlay}>
            {t("library.play")}
          </Button>
          <Button size="sm" icon={<Pencil size={14} aria-hidden="true" />} onClick={onOpenEditor}>
            {t("library.openInEditor")}
          </Button>
          <Button size="sm" icon={<Plus size={14} aria-hidden="true" />} onClick={onAddToStudio} loading={busy}>
            {t("library.addToStudio")}
          </Button>
          <Button size="sm" icon={<FilePlus2 size={14} aria-hidden="true" />} onClick={onExport}>
            {t("library.export")}
          </Button>
        </div>

        <div className="form-grid__two">
          <Field label={t("common.name")} htmlFor="asset-name">
            <TextInput id="asset-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={160} />
          </Field>
          <Field label={t("common.type")} htmlFor="asset-type">
            <Select id="asset-type" value={mediaType} onChange={(event) => setMediaType(event.target.value as MediaType)}>
              {MEDIA_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`mediaTypes.${type}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label={t("library.notes")} htmlFor="asset-notes">
          <Textarea
            id="asset-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={t("library.notesPlaceholder")}
          />
        </Field>

        <Field label={t("library.tagsEdit")} htmlFor="asset-tag" hint={t("library.addTagsHint")}>
          <div className="inline-field">
            <TextInput
              id="asset-tag"
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === ",") {
                  event.preventDefault();
                  addTag();
                }
              }}
              placeholder={t("library.tagPlaceholder")}
            />
            <Button variant="ghost" onClick={addTag} icon={<Plus size={14} aria-hidden="true" />}>
              {t("library.addTag")}
            </Button>
          </div>
          <div className="tag-row">
            {tags.map((entry) => (
              <button
                key={entry}
                type="button"
                className="tag tag--button"
                onClick={() => setTags((current) => current.filter((item) => item !== entry))}
                aria-label={t("library.removeTag", { name: entry })}
              >
                {entry} ×
              </button>
            ))}
            {tags.length === 0 ? <span className="muted small">{t("common.none")}</span> : null}
          </div>
        </Field>

        <div className="path-box path-box--muted">
          <span className="muted small">{t("library.sourceFile")}</span>
          <code>{asset.file_url}</code>
        </div>
      </div>
    </Modal>
  );
}
