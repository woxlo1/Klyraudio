import { useEffect, useMemo, useState } from "react";
import { Check, FileAudio, Search } from "lucide-react";
import { api } from "../api/client";
import type { AssetInfo, MediaType } from "../api/types";
import { useI18n } from "../i18n";
import { describeError } from "../lib/errors";
import { classNames, formatDuration, formatSampleRate } from "../lib/format";
import { Modal } from "./Modal";
import { Button, EmptyState, InlineNotice, Spinner, TextInput } from "./ui";

const MEDIA_LABELS: Record<MediaType, string> = {
  music: "music",
  sfx: "sfx",
  ambient: "ambient",
  voice: "voice",
  other: "other",
};

export function AssetPicker({
  title,
  onClose,
  onPick,
  multiple = false,
  confirmLabel,
  mediaType,
}: {
  title?: string;
  onClose: () => void;
  onPick: (assets: AssetInfo[]) => void;
  multiple?: boolean;
  confirmLabel?: string;
  mediaType?: MediaType;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [order, setOrder] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(
      async () => {
        try {
          const response = await api.assets({
            query: query.trim() || undefined,
            media_type: mediaType,
            sort: "newest",
            limit: 200,
          });
          if (cancelled) return;
          setAssets(response.items);
          setError(null);
        } catch (caught) {
          if (!cancelled) setError(caught);
        } finally {
          if (!cancelled) setLoading(false);
        }
      },
      query ? 200 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, mediaType]);

  const selectedAssets = useMemo(
    () =>
      order
        .map((id) => assets.find((asset) => asset.id === id))
        .filter((asset): asset is AssetInfo => Boolean(asset)),
    [assets, order],
  );

  const toggle = (asset: AssetInfo) => {
    if (!multiple) {
      onPick([asset]);
      onClose();
      return;
    }
    setSelected((current) => {
      if (current.includes(asset.id)) {
        setOrder((previous) => previous.filter((id) => id !== asset.id));
        return current.filter((id) => id !== asset.id);
      }
      setOrder((previous) => [...previous, asset.id]);
      return [...current, asset.id];
    });
  };

  return (
    <Modal
      title={title ?? t("editor.chooseSource")}
      onClose={onClose}
      size="lg"
      footer={
        multiple ? (
          <>
            <Button onClick={onClose}>{t("common.cancel")}</Button>
            <Button
              variant="primary"
              disabled={selectedAssets.length === 0}
              onClick={() => {
                onPick(selectedAssets);
                onClose();
              }}
            >
              {confirmLabel ?? t("common.add")}
              {selectedAssets.length > 0 ? ` (${selectedAssets.length})` : ""}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{t("common.cancel")}</Button>
        )
      }
    >
      <div className="asset-picker">
        <div className="search-input">
          <Search size={15} aria-hidden="true" />
          <TextInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("library.searchPlaceholder")}
            aria-label={t("common.search")}
            autoFocus
          />
        </div>
        {loading ? (
          <div className="loading-row">
            <Spinner /> <span>{t("common.loading")}</span>
          </div>
        ) : error ? (
          <InlineNotice tone="danger">{describeError(error, t).message}</InlineNotice>
        ) : assets.length === 0 ? (
          <EmptyState
            compact
            icon={<FileAudio size={22} aria-hidden="true" />}
            title={query ? t("library.emptyFilteredTitle") : t("library.emptyTitle")}
            body={query ? t("library.emptyFilteredBody") : t("library.emptyBody")}
          />
        ) : (
          <ul className="asset-picker__list">
            {assets.map((asset) => {
              const isSelected = selected.includes(asset.id);
              return (
                <li key={asset.id}>
                  <button
                    type="button"
                    className={classNames("asset-picker__item", isSelected && "is-selected")}
                    onClick={() => toggle(asset)}
                    aria-pressed={multiple ? isSelected : undefined}
                  >
                    <span className="asset-picker__check" aria-hidden="true">
                      {isSelected ? <Check size={14} /> : <FileAudio size={14} />}
                    </span>
                    <span className="asset-picker__body">
                      <strong>{asset.name}</strong>
                      <small>
                        {formatDuration(asset.duration)} · {formatSampleRate(asset.sample_rate)} ·{" "}
                        {t(`mediaTypes.${MEDIA_LABELS[asset.media_type] ?? "other"}`)}
                      </small>
                      {asset.tags.length > 0 ? (
                        <span className="tag-row tag-row--compact">
                          {asset.tags.slice(0, 4).map((tag) => (
                            <span key={tag} className="tag">
                              {tag}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </span>
                    <span className="asset-picker__origin">{t(`library.${originKey(asset)}`)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function originKey(asset: AssetInfo): string {
  if (asset.origin === "imported") return "originImported";
  return asset.origin;
}
