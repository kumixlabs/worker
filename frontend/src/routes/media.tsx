import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AudioLines,
  FileVideo,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Image as ImageIcon,
  LayoutGrid,
  Link2,
  List,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useTranslations } from "use-intl";

import { toastError, toastSuccess } from "@kumix/ui/custom/toast";
import { AttachmentUpload, type AttachmentUploadItem } from "@kumix/ui/motion/attachment-upload";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@kumix/ui/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@kumix/ui/ui/toggle-group";
import { AppShell } from "@/components/AppShell";
import { DataTable, type GridColumnDef } from "@/components/DataTable";
import { api, queryClient } from "@/lib/api";
import { useDateTimeFormatter } from "@/lib/date";
import { formatBytes, formatDuration } from "@/lib/format";
import type { MediaFolderRecord, MediaRecord } from "../../../src/types/media";

const maxUploadBytes = 2 * 1024 * 1024 * 1024;
const mediaQueryKey = ["media"] as const;
const foldersQueryKey = ["media-folders"] as const;

function invalidateMedia() {
  void queryClient.invalidateQueries({ queryKey: mediaQueryKey });
  void queryClient.invalidateQueries({ queryKey: foldersQueryKey });
}

const typeIcon = {
  video: FileVideo,
  audio: AudioLines,
  image: ImageIcon,
} as const;

function MediaIcon({ type, className }: { type: MediaRecord["mediaType"]; className?: string }) {
  const Icon = typeIcon[type] ?? FileVideo;
  return <Icon className={className} />;
}

function mediaSrc(media: MediaRecord): string {
  return `/api/media/${media.id}/content`;
}

export function MediaPage() {
  const t = useTranslations("Media");
  const common = useTranslations("Common");
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const dateTimeFormatter = useDateTimeFormatter(settingsQuery.data);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [view, setView] = useState<"grid" | "list">(
    () => (localStorage.getItem("kumix-media-view") as "grid" | "list") || "grid",
  );
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [gdriveOpen, setGdriveOpen] = useState(false);
  const [renameFolder, setRenameFolder] = useState<MediaFolderRecord | null>(null);
  const [renameMedia, setRenameMedia] = useState<MediaRecord | null>(null);
  const [moveMedia, setMoveMedia] = useState<MediaRecord | null>(null);
  const [deleteMedia, setDeleteMedia] = useState<MediaRecord | null>(null);
  const [deleteFolder, setDeleteFolder] = useState<MediaFolderRecord | null>(null);
  const [preview, setPreview] = useState<MediaRecord | null>(null);

  useEffect(() => {
    localStorage.setItem("kumix-media-view", view);
  }, [view]);

  const mediaQuery = useQuery({
    queryKey: [...mediaQueryKey, folderId],
    queryFn: ({ signal }) => api.media(folderId ?? undefined, { signal }),
  });
  const foldersQuery = useQuery({
    queryKey: foldersQueryKey,
    queryFn: ({ signal }) => api.mediaFolders({ signal }),
  });
  const statsQuery = useQuery({
    queryKey: ["media", "stats"],
    queryFn: ({ signal }) => api.mediaStats({ signal }),
  });
  const folders = foldersQuery.data ?? [];
  const rootCount = (mediaQuery.data ?? []).filter((m) => m.folderId === null).length;
  const allCount =
    folderId === null
      ? folders.reduce((total, f) => total + f.mediaCount, 0) + rootCount
      : undefined;
  const items = (mediaQuery.data ?? []).filter((item) =>
    item.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  const [gridPage, setGridPage] = useState(0);
  const gridPageSize = 24;
  const gridPageCount = Math.max(1, Math.ceil(items.length / gridPageSize));
  const gridItems = items.slice(gridPage * gridPageSize, (gridPage + 1) * gridPageSize);
  useEffect(() => {
    setGridPage(0);
  }, []);

  const deleteMediaMutation = useMutation({
    mutationFn: (id: string) => api.deleteMedia(id),
    onSuccess: () => {
      invalidateMedia();
      toastSuccess({ message: t("deleted") });
      setDeleteMedia(null);
    },
    onError: (error: Error) => toastError({ message: error.message }),
  });

  const columns = useMemo<GridColumnDef<MediaRecord>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("colName"),
        cell: ({ row }) => (
          <button
            type="button"
            className="flex min-w-0 items-center gap-2 text-left"
            onClick={() => setPreview(row.original)}
          >
            <MediaIcon
              type={row.original.mediaType}
              className="size-4 shrink-0 text-muted-foreground"
            />
            <span className="truncate">{row.original.name}</span>
          </button>
        ),
      },
      {
        accessorKey: "mediaType",
        header: t("colType"),
        cell: ({ row }) => (
          <Badge variant="secondary" className="capitalize">
            {row.original.mediaType}
          </Badge>
        ),
      },
      {
        accessorKey: "duration",
        header: t("colDuration"),
        cell: ({ row }) => (
          <span className="text-muted-foreground tabular-nums">
            {formatDuration(row.original.duration) || "—"}
          </span>
        ),
      },
      {
        accessorKey: "sizeBytes",
        header: t("colSize"),
        cell: ({ row }) => (
          <span className="text-muted-foreground">{formatBytes(row.original.sizeBytes)}</span>
        ),
      },
      {
        accessorKey: "createdAt",
        header: t("colCreated"),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {dateTimeFormatter.format(new Date(row.original.createdAt))}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <MediaActions
            media={row.original}
            onRename={setRenameMedia}
            onMove={setMoveMedia}
            onDelete={setDeleteMedia}
          />
        ),
      },
    ],
    [t, dateTimeFormatter],
  );

  return (
    <AppShell
      title={t("title")}
      description={t("description")}
      actions={
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" />}>
              <Link2 data-icon="inline-start" className="size-4" />
              {t("import")}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setGdriveOpen(true)}>
                <FolderOpen className="size-4" />
                {t("importGdrive")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={() => setUploadOpen(true)}>
            <Upload data-icon="inline-start" className="size-4" />
            {t("upload")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="w-full shrink-0 lg:w-56">
          <nav className="flex flex-col gap-1">
            <FolderButton
              active={folderId === null}
              icon={<LayoutGrid className="size-4" />}
              label={t("allMedia")}
              count={allCount}
              onClick={() => setFolderId(null)}
            />
            <FolderButton
              active={folderId === "root"}
              icon={<Folder className="size-4" />}
              label={t("rootFolder")}
              count={folderId === null ? rootCount : undefined}
              onClick={() => setFolderId("root")}
            />
            {folders.map((folder) => (
              <div key={folder.id} className="group relative">
                <FolderButton
                  active={folderId === folder.id}
                  icon={<Folder className="size-4" />}
                  label={folder.name}
                  count={folder.mediaCount}
                  onClick={() => setFolderId(folder.id)}
                  className="pr-8"
                />
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button
                        type="button"
                        className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100"
                        aria-label={common("actions")}
                      />
                    }
                  />
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => setRenameFolder(folder)}>
                      <Pencil className="size-4" />
                      {t("rename")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => setDeleteFolder(folder)}>
                      <Trash2 className="size-4" />
                      {common("delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
            <Button
              variant="ghost"
              className="justify-start text-muted-foreground"
              onClick={() =>
                setRenameFolder({ id: "", name: "", userId: null, mediaCount: 0, createdAt: "" })
              }
            >
              <FolderPlus className="size-4" />
              {t("newFolder")}
            </Button>
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("searchPlaceholder")}
                className="pl-8"
              />
            </div>
            <ToggleGroup
              value={[view]}
              onValueChange={(group) => {
                const next = Array.from(group.values())[0] as "grid" | "list" | undefined;
                if (next) setView(next);
              }}
              variant="outline"
            >
              <ToggleGroupItem value="grid" aria-label={t("gridView")}>
                <LayoutGrid className="size-4" />
              </ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label={t("listView")}>
                <List className="size-4" />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {statsQuery.data ? (
            <div className="mb-4 flex items-center gap-3 text-muted-foreground text-xs">
              <HardDrive className="size-3.5 shrink-0" />
              <span className="whitespace-nowrap tabular-nums">
                {t("storageUsed", {
                  used: formatBytes(statsQuery.data.usedBytes),
                  quota: statsQuery.data.quotaBytes
                    ? formatBytes(statsQuery.data.quotaBytes)
                    : t("storageUnlimited"),
                })}
              </span>
              {statsQuery.data.quotaBytes ? (
                <div className="h-1.5 max-w-64 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{
                      width: `${Math.min(100, (statsQuery.data.usedBytes / statsQuery.data.quotaBytes) * 100)}%`,
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {items.length === 0 && !mediaQuery.isLoading ? (
            <Empty className="border-border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ImageIcon className="size-8" />
                </EmptyMedia>
                <EmptyTitle>{t("emptyTitle")}</EmptyTitle>
                <EmptyDescription>{t("emptyDescription")}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => setUploadOpen(true)}>
                  <Upload data-icon="inline-start" className="size-4" />
                  {t("upload")}
                </Button>
              </EmptyContent>
            </Empty>
          ) : view === "grid" ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {gridItems.map((media) => (
                  <MediaCard
                    key={media.id}
                    media={media}
                    onPreview={setPreview}
                    onRename={setRenameMedia}
                    onMove={setMoveMedia}
                    onDelete={setDeleteMedia}
                  />
                ))}
              </div>
              {gridPageCount > 1 ? (
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={gridPage === 0}
                    onClick={() => setGridPage((p) => p - 1)}
                  >
                    {t("prevPage")}
                  </Button>
                  <span className="text-muted-foreground text-sm tabular-nums">
                    {gridPage + 1} / {gridPageCount}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={gridPage >= gridPageCount - 1}
                    onClick={() => setGridPage((p) => p + 1)}
                  >
                    {t("nextPage")}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={items}
              searchPlaceholder={t("searchPlaceholder")}
              empty={<EmptyDescription>{t("emptyTitle")}</EmptyDescription>}
            />
          )}
        </div>
      </div>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} folderId={folderId} />
      <GDriveDialog
        open={gdriveOpen}
        onOpenChange={setGdriveOpen}
        folderId={folderId}
        folders={folders}
      />
      <FolderDialog folder={renameFolder} onClose={() => setRenameFolder(null)} />
      <RenameMediaDialog media={renameMedia} onClose={() => setRenameMedia(null)} />
      <MoveMediaDialog media={moveMedia} folders={folders} onClose={() => setMoveMedia(null)} />
      <PreviewDialog media={preview} onClose={() => setPreview(null)} />

      {deleteMedia && (
        <Dialog open onOpenChange={(open) => !open && setDeleteMedia(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("deleteTitle")}</DialogTitle>
              <DialogDescription>
                {t("deleteDescription", { name: deleteMedia.name })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteMedia(null)}>
                {common("cancel")}
              </Button>
              <Button
                variant="destructive"
                disabled={deleteMediaMutation.isPending}
                onClick={() => deleteMediaMutation.mutate(deleteMedia.id)}
              >
                {common("delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {deleteFolder && (
        <Dialog open onOpenChange={(open) => !open && setDeleteFolder(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("deleteFolderTitle")}</DialogTitle>
              <DialogDescription>
                {t("deleteFolderDescription", { name: deleteFolder.name })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteFolder(null)}>
                {common("cancel")}
              </Button>
              <Button
                variant="destructive"
                disabled={deleteMediaMutation.isPending}
                onClick={async () => {
                  try {
                    await api.deleteMediaFolder(deleteFolder.id);
                    invalidateMedia();
                    if (folderId === deleteFolder.id) setFolderId(null);
                    toastSuccess({ message: t("folderDeleted") });
                  } catch (error) {
                    toastError({ message: (error as Error).message });
                  } finally {
                    setDeleteFolder(null);
                  }
                }}
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

function FolderButton({
  active,
  icon,
  label,
  count,
  onClick,
  className,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  count?: number;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50"
      } ${className ?? ""}`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {count !== undefined && (
        <span className="text-muted-foreground text-xs tabular-nums">{count}</span>
      )}
    </button>
  );
}

function MediaActions({
  media,
  onRename,
  onMove,
  onDelete,
}: {
  media: MediaRecord;
  onRename: (media: MediaRecord) => void;
  onMove: (media: MediaRecord) => void;
  onDelete: (media: MediaRecord) => void;
}) {
  const t = useTranslations("Media");
  const common = useTranslations("Common");
  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
          <MoreHorizontal className="size-4" />
          <span className="sr-only">{common("actions")}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onRename(media)}>
            <Pencil className="size-4" />
            {t("rename")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onMove(media)}>
            <FolderOpen className="size-4" />
            {t("moveTo")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => onDelete(media)}>
            <Trash2 className="size-4" />
            {common("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function MediaCard({
  media,
  onPreview,
  onRename,
  onMove,
  onDelete,
}: {
  media: MediaRecord;
  onPreview: (media: MediaRecord) => void;
  onRename: (media: MediaRecord) => void;
  onMove: (media: MediaRecord) => void;
  onDelete: (media: MediaRecord) => void;
}) {
  return (
    <div className="group relative overflow-hidden rounded-lg border bg-card">
      <button
        type="button"
        className="block aspect-video w-full cursor-pointer bg-muted"
        onClick={() => onPreview(media)}
      >
        {media.mediaType === "image" ? (
          <img
            src={mediaSrc(media)}
            alt={media.name}
            className="size-full object-cover"
            loading="lazy"
          />
        ) : media.mediaType === "video" ? (
          <img
            src={`/api/media/${media.id}/thumbnail`}
            alt={media.name}
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <span className="flex size-full items-center justify-center text-muted-foreground">
            <AudioLines className="size-8" />
          </span>
        )}
        {media.duration ? (
          <span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1 font-medium text-[10px] text-white tabular-nums">
            {formatDuration(media.duration)}
          </span>
        ) : null}
      </button>
      <div className="pointer-events-none absolute top-1.5 right-1.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
        <MediaActions media={media} onRename={onRename} onMove={onMove} onDelete={onDelete} />
      </div>
      <div className="space-y-0.5 p-3">
        <p className="truncate font-medium text-sm">{media.name}</p>
        <p className="text-muted-foreground text-xs">
          {media.mediaType} · {formatBytes(media.sizeBytes)}
        </p>
      </div>
    </div>
  );
}

function UploadDialog({
  open,
  onOpenChange,
  folderId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId: string | null;
}) {
  const t = useTranslations("Media");
  const [items, setItems] = useState<AttachmentUploadItem[]>([]);
  const uploadsRef = useState(new Map<string, File>())[0];

  useEffect(() => {
    if (!open) {
      setItems([]);
      uploadsRef.clear();
    }
  }, [open, uploadsRef]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("uploadTitle")}</DialogTitle>
          <DialogDescription>{t("uploadDescription")}</DialogDescription>
        </DialogHeader>
        <AttachmentUpload
          value={items}
          onValueChange={setItems}
          accept="video/*,audio/*,image/*"
          maxFiles={20}
          maxFileSize={maxUploadBytes}
          title={t("dropzoneTitle")}
          attachmentsLabel={t("uploading")}
          onFilesAdded={(added) => {
            for (const item of added) {
              if (!item.file) continue;
              uploadsRef.set(item.id, item.file);
              api
                .uploadMedia(item.file, {
                  name: item.name,
                  folderId: folderId ?? undefined,
                  onProgress: (fraction) => {
                    setItems((current) =>
                      current.map((entry) =>
                        entry.id === item.id
                          ? { ...entry, progress: Math.round(fraction * 100) }
                          : entry,
                      ),
                    );
                  },
                })
                .then(() => invalidateMedia())
                .catch((error: Error) => {
                  toastError({ message: `${item.name}: ${(error as Error).message}` });
                  setItems((current) =>
                    current.map((entry) =>
                      entry.id === item.id
                        ? { ...entry, status: "failed", error: (error as Error).message }
                        : entry,
                    ),
                  );
                });
            }
          }}
          onRemove={(item) => uploadsRef.delete(item.id)}
        />
      </DialogContent>
    </Dialog>
  );
}

function GDriveDialog({
  open,
  onOpenChange,
  folderId,
  folders,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId: string | null;
  folders: MediaFolderRecord[];
}) {
  const t = useTranslations("Media");
  const common = useTranslations("Common");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const targetFolder = folderId && folderId !== "root" ? folderId : "";
  const [folder, setFolder] = useState(targetFolder);
  const mutation = useMutation({
    mutationFn: () =>
      api.importGdrive({
        url,
        name: name.trim() || undefined,
        folderId: folder || undefined,
      }),
    onSuccess: () => {
      invalidateMedia();
      toastSuccess({ message: t("imported") });
      onOpenChange(false);
      setUrl("");
      setName("");
    },
    onError: (error: Error) => toastError({ message: error.message }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("importGdrive")}</DialogTitle>
          <DialogDescription>{t("gdriveDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="gdrive-url">{t("gdriveUrl")}</Label>
            <Input
              id="gdrive-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://drive.google.com/file/d/..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gdrive-name">{t("colName")}</Label>
            <Input
              id="gdrive-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("gdriveNamePlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gdrive-folder">{t("moveTo")}</Label>
            <Select value={folder} onValueChange={(value) => setFolder(value ?? "")}>
              <SelectTrigger id="gdrive-folder" className="w-full">
                <SelectValue>
                  {(value) =>
                    value && value !== ""
                      ? (folders.find((f) => f.id === value)?.name ?? value)
                      : t("rootFolder")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t("rootFolder")}</SelectItem>
                {folders.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {common("cancel")}
          </Button>
          <Button disabled={!url.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
            {t("import")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FolderDialog({
  folder,
  onClose,
}: {
  folder: MediaFolderRecord | null;
  onClose: () => void;
}) {
  const t = useTranslations("Media");
  const common = useTranslations("Common");
  const isCreate = folder?.id === "";
  const [name, setName] = useState("");
  useEffect(() => {
    setName(folder && !isCreate ? folder.name : "");
  }, [folder, isCreate]);
  if (!folder) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{isCreate ? t("newFolder") : t("renameFolder")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="folder-name">{t("colName")}</Label>
          <Input
            id="folder-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("folderNamePlaceholder")}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {common("cancel")}
          </Button>
          <Button
            disabled={!name.trim()}
            onClick={async () => {
              try {
                if (isCreate) await api.createMediaFolder(name);
                else await api.renameMediaFolder(folder.id, name);
                invalidateMedia();
                onClose();
              } catch (error) {
                toastError({ message: (error as Error).message });
              }
            }}
          >
            {common("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameMediaDialog({ media, onClose }: { media: MediaRecord | null; onClose: () => void }) {
  const t = useTranslations("Media");
  const common = useTranslations("Common");
  const [name, setName] = useState("");
  useEffect(() => {
    setName(media?.name ?? "");
  }, [media]);
  if (!media) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("rename")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="media-name">{t("colName")}</Label>
          <Input id="media-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {common("cancel")}
          </Button>
          <Button
            disabled={!name.trim()}
            onClick={async () => {
              try {
                await api.patchMedia(media.id, { name });
                invalidateMedia();
                onClose();
              } catch (error) {
                toastError({ message: (error as Error).message });
              }
            }}
          >
            {common("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MoveMediaDialog({
  media,
  folders,
  onClose,
}: {
  media: MediaRecord | null;
  folders: MediaFolderRecord[];
  onClose: () => void;
}) {
  const t = useTranslations("Media");
  const common = useTranslations("Common");
  const [folderId, setFolderId] = useState("");
  useEffect(() => {
    setFolderId(media?.folderId ?? "");
  }, [media]);
  if (!media) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("moveTo")}</DialogTitle>
          <DialogDescription className="truncate">{media.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="move-folder">{t("moveTo")}</Label>
          <Select value={folderId} onValueChange={(value) => setFolderId(value ?? "")}>
            <SelectTrigger id="move-folder" className="w-full">
              <SelectValue>
                {(value) =>
                  value && value !== ""
                    ? (folders.find((f) => f.id === value)?.name ?? value)
                    : t("rootFolder")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">{t("rootFolder")}</SelectItem>
              {folders.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {common("cancel")}
          </Button>
          <Button
            onClick={async () => {
              try {
                await api.patchMedia(media.id, { folderId: folderId || null });
                invalidateMedia();
                onClose();
              } catch (error) {
                toastError({ message: (error as Error).message });
              }
            }}
          >
            {common("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewDialog({ media, onClose }: { media: MediaRecord | null; onClose: () => void }) {
  const t = useTranslations("Media");
  if (!media) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{media.name}</DialogTitle>
          <DialogDescription>
            {media.mediaType} · {formatBytes(media.sizeBytes)}
          </DialogDescription>
        </DialogHeader>
        {media.mediaType === "image" ? (
          <img
            src={mediaSrc(media)}
            alt={media.name}
            className="max-h-[70vh] w-full object-contain"
          />
        ) : media.mediaType === "video" ? (
          <video src={mediaSrc(media)} controls className="max-h-[70vh] w-full">
            {/* ponytail: no caption track storage yet — add <track> when subtitle upload lands. */}
            <track kind="captions" />
          </video>
        ) : (
          <audio src={mediaSrc(media)} controls className="w-full">
            {/* ponytail: no caption track storage yet — add <track> when subtitle upload lands. */}
            <track kind="captions" />
          </audio>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
