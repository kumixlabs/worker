import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ListVideo, MoreHorizontal, Pencil, Plus, Shuffle, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@kumix/ui/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@kumix/ui/ui/empty";
import { Input } from "@kumix/ui/ui/input";
import { Label } from "@kumix/ui/ui/label";
import { AppShell } from "@/components/AppShell";
import { DataTable, type GridColumnDef } from "@/components/DataTable";
import { api, queryClient } from "@/lib/api";
import { useDateTimeFormatter } from "@/lib/date";
import { formatDuration } from "@/lib/format";
import type { PlaylistRecord } from "../../../src/types/playlist";

export function invalidatePlaylists() {
  void queryClient.invalidateQueries({ queryKey: ["playlists"] });
}

export function PlaylistDialog({
  playlist,
  onClose,
}: {
  playlist: PlaylistRecord | null | "new";
  onClose: () => void;
}) {
  const t = useTranslations("Playlists");
  const common = useTranslations("Common");
  const isNew = playlist === "new";
  const existing = playlist && playlist !== "new" ? playlist : null;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [initialized, setInitialized] = useState<PlaylistRecord | null>(null);
  if (existing !== initialized) {
    setInitialized(existing);
    setName(existing?.name ?? "");
    setDescription(existing?.description ?? "");
  }
  if (!playlist) return null;
  const save = async () => {
    try {
      if (isNew) await api.createPlaylist({ name, description: description || null });
      else if (existing)
        await api.patchPlaylist(existing.id, { name, description: description || null });
      invalidatePlaylists();
      onClose();
    } catch (error) {
      toastError({ message: (error as Error).message });
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isNew ? t("createTitle") : t("editTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="playlist-name">{t("name")}</Label>
            <Input
              id="playlist-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("namePlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="playlist-description">{t("description")}</Label>
            <Input
              id="playlist-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("descriptionPlaceholder")}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {common("cancel")}
          </Button>
          <Button disabled={!name.trim()} onClick={save}>
            {common("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PlaylistsPage() {
  const t = useTranslations("Playlists");
  const common = useTranslations("Common");
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const dateTimeFormatter = useDateTimeFormatter(settingsQuery.data);
  const [dialog, setDialog] = useState<PlaylistRecord | null | "new">(null);
  const [deleting, setDeleting] = useState<PlaylistRecord | null>(null);

  const playlistsQuery = useQuery({
    queryKey: ["playlists"],
    queryFn: ({ signal }) => api.playlists({ signal }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deletePlaylist(id),
    onSuccess: () => {
      invalidatePlaylists();
      toastSuccess({ message: t("deleted") });
      setDeleting(null);
    },
    onError: (error: Error) => toastError({ message: error.message }),
  });

  const columns = useMemo<GridColumnDef<PlaylistRecord>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("name"),
        cell: ({ row }) => (
          <Link
            to={`/playlists/${row.original.id}`}
            className="flex min-w-0 items-center gap-2 font-medium hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: "itemCount",
        header: t("items"),
        cell: ({ row }) => (
          <span className="flex flex-wrap items-center gap-1">
            <Badge variant="secondary">{t("videoCount", { count: row.original.videoCount })}</Badge>
            {row.original.audioCount > 0 ? (
              <Badge variant="outline">{t("audioCount", { count: row.original.audioCount })}</Badge>
            ) : null}
          </span>
        ),
      },
      {
        accessorKey: "totalDuration",
        header: t("duration"),
        cell: ({ row }) => (
          <span className="text-muted-foreground tabular-nums">
            {formatDuration(row.original.totalDuration) || "—"}
          </span>
        ),
      },
      {
        accessorKey: "description",
        header: t("description"),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="line-clamp-1 max-w-64 text-muted-foreground">
            {row.original.description ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "shuffle",
        header: t("shuffle"),
        cell: ({ row }) =>
          row.original.shuffle ? (
            <Badge variant="secondary">
              <Shuffle className="size-3" />
              {t("shuffle")}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "updatedAt",
        header: t("updated"),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {dateTimeFormatter.format(new Date(row.original.updatedAt))}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
                <MoreHorizontal className="size-4" />
                <span className="sr-only">{common("actions")}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setDialog(row.original)}>
                  <Pencil className="size-4" />
                  {t("edit")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setDeleting(row.original)}>
                  <Trash2 className="size-4" />
                  {common("delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [t, common, dateTimeFormatter],
  );

  return (
    <AppShell
      title={t("title")}
      description={t("description")}
      actions={
        <Button onClick={() => setDialog("new")}>
          <Plus data-icon="inline-start" className="size-4" />
          {t("create")}
        </Button>
      }
    >
      <DataTable
        data={playlistsQuery.data ?? []}
        columns={columns}
        isLoading={playlistsQuery.isLoading}
        empty={
          <Empty className="border-border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ListVideo className="size-8" />
              </EmptyMedia>
              <EmptyTitle>{t("emptyTitle")}</EmptyTitle>
              <EmptyDescription>{t("emptyDescription")}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setDialog("new")}>
                <Plus data-icon="inline-start" className="size-4" />
                {t("create")}
              </Button>
            </EmptyContent>
          </Empty>
        }
        searchPlaceholder={common("search")}
        clearSearchLabel={common("clearSearch")}
      />

      <PlaylistDialog playlist={dialog} onClose={() => setDialog(null)} />

      {deleting && (
        <Dialog open onOpenChange={(open) => !open && setDeleting(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("deleteTitle")}</DialogTitle>
              <DialogDescription>
                {t("deleteDescription", { name: deleting.name })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleting(null)}>
                {common("cancel")}
              </Button>
              <Button
                variant="destructive"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deleting.id)}
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
