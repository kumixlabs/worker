import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  AudioLines,
  GripVertical,
  Image as ImageIcon,
  ListVideo,
  Pencil,
  Plus,
  Shuffle,
  Trash2,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslations } from "use-intl";

import { toastError, toastSuccess } from "@kumix/ui/custom/toast";
import { Badge } from "@kumix/ui/reui/badge";
import { Sortable, SortableItem, SortableItemHandle } from "@kumix/ui/reui/sortable";
import { Button } from "@kumix/ui/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@kumix/ui/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@kumix/ui/ui/empty";
import { Switch } from "@kumix/ui/ui/switch";
import { AppShell } from "@/components/AppShell";
import { api, queryClient } from "@/lib/api";
import { formatBytes, formatDuration } from "@/lib/format";
import { invalidatePlaylists, PlaylistDialog } from "@/routes/playlists";
import type { MediaRecord } from "../../../src/types/media";
import type { PlaylistItemKind, PlaylistItemRecord } from "../../../src/types/playlist";

function invalidateDetail() {
  void queryClient.invalidateQueries({ queryKey: ["playlists"] });
}

const typeIcons = {
  video: ListVideo,
  audio: AudioLines,
  image: ImageIcon,
} as const;

function mediaThumb(media: MediaRecord) {
  if (media.mediaType === "image") return `/api/media/${media.id}/content`;
  if (media.mediaType === "video" && media.hasThumb) return `/api/media/${media.id}/thumbnail`;
  return null;
}

export function PlaylistDetailPage() {
  const { id = "" } = useParams();
  const t = useTranslations("Playlists");
  const common = useTranslations("Common");
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pickerKind, setPickerKind] = useState<PlaylistItemKind | null>(null);

  const playlistQuery = useQuery({
    queryKey: ["playlists", id],
    queryFn: ({ signal }) => api.playlist(id, { signal }),
  });
  const playlist = playlistQuery.data;

  const saveOrder = useMutation({
    mutationFn: (body: { videos: string[]; audios: string[] }) =>
      api.replacePlaylistItems(id, body),
    onSuccess: () => invalidateDetail(),
    onError: (error: Error) => toastError({ message: error.message }),
  });

  const items = playlist?.items ?? [];
  const videos = useMemo(() => items.filter((i) => i.kind !== "audio"), [items]);
  const audios = useMemo(() => items.filter((i) => i.kind === "audio"), [items]);
  const videoIds = useMemo(() => videos.map((item) => item.mediaId), [videos]);
  const audioIds = useMemo(() => audios.map((item) => item.mediaId), [audios]);

  const move = (kind: PlaylistItemKind, index: number, delta: -1 | 1) => {
    const ids = kind === "audio" ? [...audioIds] : [...videoIds];
    const other = kind === "audio" ? videoIds : audioIds;
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    saveOrder.mutate(
      kind === "audio" ? { videos: other, audios: ids } : { videos: ids, audios: other },
    );
  };

  const reorder = (next: PlaylistItemRecord[]) => {
    const ids = next.map((item) => item.mediaId);
    const moved = videoIds.some((current, index) => current !== ids[index]);
    if (!moved) return;
    saveOrder.mutate({ videos: ids, audios: audioIds });
  };

  const remove = (kind: PlaylistItemKind, mediaId: string) => {
    const body =
      kind === "audio"
        ? { videos: videoIds, audios: audioIds.filter((m) => m !== mediaId) }
        : { videos: videoIds.filter((m) => m !== mediaId), audios: audioIds };
    saveOrder.mutate(body);
  };

  const append = (kind: PlaylistItemKind, selected: string[]) => {
    const body =
      kind === "audio"
        ? { videos: videoIds, audios: [...audioIds, ...selected] }
        : { videos: [...videoIds, ...selected], audios: audioIds };
    saveOrder.mutate(body);
  };

  const deleteMutation = useMutation({
    mutationFn: () => api.deletePlaylist(id),
    onSuccess: () => {
      invalidatePlaylists();
      toastSuccess({ message: t("deleted") });
      navigate("/playlists");
    },
    onError: (error: Error) => toastError({ message: error.message }),
  });

  const shuffleMutation = useMutation({
    mutationFn: (shuffle: boolean) => api.patchPlaylist(id, { shuffle }),
    onSuccess: () => invalidateDetail(),
    onError: (error: Error) => toastError({ message: error.message }),
  });

  if (playlistQuery.isError) {
    return (
      <AppShell title={t("title")}>
        <EmptyDescription>{common("loadError")}</EmptyDescription>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={playlist?.name ?? t("title")}
      description={playlist?.description ?? undefined}
      actions={
        playlist ? (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-muted-foreground text-sm">
              <Shuffle className="size-4" />
              <span className="hidden sm:inline">{t("shuffle")}</span>
              <Switch
                checked={playlist.shuffle}
                onCheckedChange={(checked) => shuffleMutation.mutate(Boolean(checked))}
              />
            </label>
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil data-icon="inline-start" className="size-4" />
              {t("edit")}
            </Button>
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 data-icon="inline-start" className="size-4" />
              {common("delete")}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="mb-4 flex items-center justify-between">
        <Button variant="ghost" size="sm" className="-ml-2" render={<Link to="/playlists" />}>
          <ArrowLeft data-icon="inline-start" className="size-4" />
          {t("back")}
        </Button>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{t("itemCount", { count: items.length })}</Badge>
          {playlist?.totalDuration ? (
            <Badge variant="secondary">{formatDuration(playlist.totalDuration)}</Badge>
          ) : null}
        </div>
      </div>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold text-sm">
            <ListVideo className="size-4" />
            {t("videosSection")}
            <Badge variant="secondary">{videos.length}</Badge>
          </h2>
          <Button variant="outline" size="sm" onClick={() => setPickerKind("video")}>
            <Plus data-icon="inline-start" className="size-4" />
            {t("addVideos")}
          </Button>
        </div>
        {videos.length === 0 ? (
          <Empty className="border-border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ListVideo className="size-8" />
              </EmptyMedia>
              <EmptyTitle>{t("emptyItemsTitle")}</EmptyTitle>
              <EmptyDescription>{t("emptyItemsDescription")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Sortable
            className="list-none space-y-2"
            value={videos}
            getItemValue={(item) => item.id}
            onValueChange={reorder}
          >
            {videos.map((item, index) => (
              <PlaylistRow
                key={item.id}
                item={item}
                isFirst={index === 0}
                isLast={index === videos.length - 1}
                onUp={() => move("video", index, -1)}
                onDown={() => move("video", index, 1)}
                onRemove={() => remove("video", item.mediaId)}
              />
            ))}
          </Sortable>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold text-sm">
            <AudioLines className="size-4" />
            {t("audiosSection")}
            <Badge variant="secondary">{audios.length}</Badge>
          </h2>
          <Button variant="outline" size="sm" onClick={() => setPickerKind("audio")}>
            <Plus data-icon="inline-start" className="size-4" />
            {t("addAudios")}
          </Button>
        </div>
        {audios.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
            {t("emptyAudios")}
          </p>
        ) : (
          <ol className="space-y-2">
            {audios.map((item, index) => (
              <PlaylistRow
                key={item.id}
                item={item}
                isFirst={index === 0}
                isLast={index === audios.length - 1}
                onUp={() => move("audio", index, -1)}
                onDown={() => move("audio", index, 1)}
                onRemove={() => remove("audio", item.mediaId)}
              />
            ))}
          </ol>
        )}
      </section>

      {playlist && (
        <PlaylistDialog playlist={editOpen ? playlist : null} onClose={() => setEditOpen(false)} />
      )}
      {playlist && pickerKind && (
        <MediaPickerDialog
          kind={pickerKind}
          existing={pickerKind === "audio" ? audioIds : videoIds}
          onClose={() => setPickerKind(null)}
          onConfirm={(selected) => append(pickerKind, selected)}
        />
      )}

      {playlist && (
        <Dialog open={deleteOpen} onOpenChange={(open) => !open && setDeleteOpen(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("deleteTitle")}</DialogTitle>
              <DialogDescription>
                {t("deleteDescription", { name: playlist.name })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                {common("cancel")}
              </Button>
              <Button
                variant="destructive"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
              >
                {common("delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </AppShell>
  );
}

function PlaylistRow({
  item,
  isFirst,
  isLast,
  onUp,
  onDown,
  onRemove,
}: {
  item: PlaylistItemRecord;
  isFirst: boolean;
  isLast: boolean;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("Playlists");
  const Icon = typeIcons[item.media.mediaType] ?? ListVideo;
  const thumb = mediaThumb(item.media);
  return (
    <SortableItem value={item.id} className="flex items-center gap-3 rounded-lg border bg-card p-3">
      <SortableItemHandle cursor aria-label={t("dragReorder")}>
        <GripVertical className="size-4 text-muted-foreground" />
      </SortableItemHandle>
      <span className="w-6 text-right text-muted-foreground text-sm tabular-nums">
        {item.position}
      </span>
      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        {thumb ? (
          <img
            src={thumb}
            alt={item.media.name}
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <Icon className="size-5 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">{item.media.name}</p>
        <p className="text-muted-foreground text-xs">
          {item.media.mediaType} · {formatBytes(item.media.sizeBytes)}
          {item.media.duration ? ` · ${formatDuration(item.media.duration)}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          disabled={isFirst}
          onClick={onUp}
          aria-label={t("moveUp")}
        >
          <ArrowUp className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={isLast}
          onClick={onDown}
          aria-label={t("moveDown")}
        >
          <ArrowDown className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onRemove} aria-label={t("removeItem")}>
          <Trash2 className="size-4" />
        </Button>
      </div>
    </SortableItem>
  );
}

function MediaPickerDialog({
  kind,
  existing,
  onClose,
  onConfirm,
}: {
  kind: PlaylistItemKind;
  existing: string[];
  onClose: () => void;
  onConfirm: (selected: string[]) => void;
}) {
  const t = useTranslations("Playlists");
  const common = useTranslations("Common");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const mediaQuery = useQuery({
    queryKey: ["media", "all"],
    queryFn: ({ signal }) => api.media(undefined, { signal }),
  });

  const wanted: MediaRecord["mediaType"] = kind === "audio" ? "audio" : "video";
  const candidates = (mediaQuery.data ?? []).filter((media) => media.mediaType === wanted);

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) {
          setSelected(new Set());
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{kind === "audio" ? t("addAudios") : t("addVideos")}</DialogTitle>
          <DialogDescription>
            {kind === "audio" ? t("addAudiosDescription") : t("addMediaDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-y-auto">
          {candidates.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground text-sm">{t("noMedia")}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {candidates.map((media) => {
                const isSelected = selected.has(media.id);
                const inPlaylist = existing.includes(media.id);
                const thumb = mediaThumb(media);
                return (
                  <button
                    key={media.id}
                    type="button"
                    disabled={inPlaylist}
                    onClick={() => toggle(media.id)}
                    className={`rounded-lg border p-2 text-left transition-colors disabled:opacity-40 ${
                      isSelected ? "border-primary bg-primary/10" : "hover:bg-accent/50"
                    }`}
                  >
                    <div className="mb-2 aspect-video overflow-hidden rounded-md bg-muted">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={media.name}
                          className="size-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span className="flex size-full items-center justify-center text-muted-foreground">
                          {(() => {
                            const Icon = typeIcons[media.mediaType] ?? ListVideo;
                            return <Icon className="size-6" />;
                          })()}
                        </span>
                      )}
                    </div>
                    <p className="truncate font-medium text-xs">{media.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatBytes(media.sizeBytes)}
                      {media.duration ? ` · ${formatDuration(media.duration)}` : ""}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {common("cancel")}
          </Button>
          <Button
            disabled={selected.size === 0}
            onClick={() => {
              onConfirm([...selected]);
              setSelected(new Set());
              onClose();
            }}
          >
            {t("addSelected", { count: selected.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
