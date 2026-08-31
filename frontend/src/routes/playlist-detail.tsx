import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  AudioLines,
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
import { formatBytes } from "@/lib/format";
import { invalidatePlaylists, PlaylistDialog } from "@/routes/playlists";
import type { MediaRecord } from "../../../src/types/media";
import type { PlaylistItemRecord } from "../../../src/types/playlist";

function invalidateDetail() {
  void queryClient.invalidateQueries({ queryKey: ["playlists"] });
}

const typeIcons = {
  video: ListVideo,
  audio: AudioLines,
  image: ImageIcon,
} as const;

export function PlaylistDetailPage() {
  const { id = "" } = useParams();
  const t = useTranslations("Playlists");
  const common = useTranslations("Common");
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const playlistQuery = useQuery({
    queryKey: ["playlists", id],
    queryFn: ({ signal }) => api.playlist(id, { signal }),
  });
  const playlist = playlistQuery.data;

  const saveOrder = useMutation({
    mutationFn: (mediaIds: string[]) => api.replacePlaylistItems(id, mediaIds),
    onSuccess: () => invalidateDetail(),
    onError: (error: Error) => toastError({ message: error.message }),
  });

  const items = playlist?.items ?? [];
  const mediaIds = useMemo(() => items.map((item) => item.mediaId), [items]);

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= mediaIds.length) return;
    const next = [...mediaIds];
    [next[index], next[target]] = [next[target], next[index]];
    saveOrder.mutate(next);
  };

  const remove = (mediaId: string) => saveOrder.mutate(mediaIds.filter((m) => m !== mediaId));

  const append = (selected: string[]) => saveOrder.mutate([...mediaIds, ...selected]);

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
          <Button onClick={() => setPickerOpen(true)}>
            <Plus data-icon="inline-start" className="size-4" />
            {t("addMedia")}
          </Button>
        </div>
      </div>

      {items.length === 0 && !playlistQuery.isLoading ? (
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
        <ol className="space-y-2">
          {items.map((item, index) => (
            <PlaylistRow
              key={item.id}
              item={item}
              isFirst={index === 0}
              isLast={index === items.length - 1}
              onUp={() => move(index, -1)}
              onDown={() => move(index, 1)}
              onRemove={() => remove(item.mediaId)}
            />
          ))}
        </ol>
      )}

      {playlist && (
        <PlaylistDialog playlist={editOpen ? playlist : null} onClose={() => setEditOpen(false)} />
      )}
      {playlist && (
        <MediaPickerDialog
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          existing={mediaIds}
          onConfirm={append}
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
  return (
    <li className="flex items-center gap-3 rounded-lg border bg-card p-3">
      <span className="w-6 text-right text-muted-foreground text-sm tabular-nums">
        {item.position}
      </span>
      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        {item.media.mediaType === "image" ? (
          <img
            src={`/api/media/${item.media.id}/content`}
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
    </li>
  );
}

function MediaPickerDialog({
  open,
  onClose,
  existing,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  existing: string[];
  onConfirm: (selected: string[]) => void;
}) {
  const t = useTranslations("Playlists");
  const common = useTranslations("Common");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const mediaQuery = useQuery({
    queryKey: ["media", "all"],
    queryFn: ({ signal }) => api.media(undefined, { signal }),
    enabled: open,
  });

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
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setSelected(new Set());
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("addMedia")}</DialogTitle>
          <DialogDescription>{t("addMediaDescription")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-y-auto">
          {(mediaQuery.data ?? []).length === 0 ? (
            <p className="py-8 text-center text-muted-foreground text-sm">{t("noMedia")}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(mediaQuery.data ?? []).map((media: MediaRecord) => {
                const isSelected = selected.has(media.id);
                const inPlaylist = existing.includes(media.id);
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
                      {media.mediaType === "image" ? (
                        <img
                          src={`/api/media/${media.id}/content`}
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
