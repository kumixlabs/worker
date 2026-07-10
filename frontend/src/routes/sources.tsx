import { type ReactNode, useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  CircleAlert,
  Database,
  Info,
  Link2,
  MoreHorizontal,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { useTranslations } from "use-intl";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@kumix/ui";
import { AlertError, AlertSuccess } from "@/components/Alert";
import { AppShell } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { api, queryClient } from "@/lib/api";
import { useDateTimeFormatter } from "@/lib/date";
import {
  formatBitrate,
  formatBytesCompact as formatBytes,
  formatDurationClock as formatDuration,
  resolutionLabel,
} from "@/lib/format";
import type { SourceRecord } from "../../../src/types/source";

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

export function SourcesPage() {
  const t = useTranslations("Sources");
  const common = useTranslations("Common");
  const [open, setOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [infoSource, setInfoSource] = useState<SourceRecord | null>(null);
  const [previewSource, setPreviewSource] = useState<SourceRecord | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<"url" | "gdrive">("url");
  const sourcesQuery = useQuery<SourceRecord[]>({ queryKey: ["sources"], queryFn: api.sources });
  const statsQuery = useQuery({ queryKey: ["stats"], queryFn: api.stats });
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const dateTimeFormatter = useDateTimeFormatter(settingsQuery.data);
  const createSource = useMutation({
    mutationFn: () => api.createSource({ name: name.trim() || url.trim(), kind, url: url.trim() }),
    onSuccess: () => {
      setName("");
      setUrl("");
      setKind("url");
      setOpen(false);
      AlertSuccess({ message: t("sourceCreated") });
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (error) => AlertError({ message: error.message }),
  });
  const deleteSource = useMutation({
    mutationFn: api.deleteSource,
    onSuccess: () => {
      AlertSuccess({ message: t("sourceDeleted") });
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (error) => AlertError({ message: error.message }),
  });
  const deleteSources = useMutation({
    mutationFn: api.deleteSources,
    onSuccess: (result) => {
      AlertSuccess({ message: t("sourceDeleted") });
      for (const failed of result.failed) AlertError({ message: failed.message });
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (error) => AlertError({ message: error.message }),
  });
  const confirmDelete = () => {
    if (!deleteId) return;
    deleteSource.mutate(deleteId);
    setDeleteId(null);
  };
  const confirmBulkDelete = () => {
    deleteSources.mutate(deleteIds);
    setDeleteIds([]);
  };
  const openPreview = useCallback(
    async (source: SourceRecord) => {
      setPreviewSource(source);
      setPreviewUrl(null);
      try {
        const { url } = await api.previewUrl(source.id);
        setPreviewUrl(url);
      } catch (error) {
        AlertError({ message: error instanceof Error ? error.message : t("preview.loadError") });
        setPreviewSource(null);
      }
    },
    [t],
  );
  const closePreview = (open: boolean) => {
    if (open) return;
    setPreviewSource(null);
    setPreviewUrl(null);
  };
  const sources = sourcesQuery.data ?? [];
  const storage = statsQuery.data?.storage;
  const usedGb = ((storage?.cacheBytes ?? 0) / 1024 / 1024 / 1024).toFixed(2);
  const readyCount = sources.filter((source) => source.status === "ready").length;
  const diskUsedPercent = storage?.disk?.usedPercent ?? 0;
  const diskLimit = settingsQuery.data?.diskUsageLimitPercent ?? 90;
  const nearLimit = diskUsedPercent >= diskLimit;
  const columns = useMemo<ColumnDef<SourceRecord>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("columns.name"),
        size: 320,
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        accessorKey: "kind",
        header: t("columns.kind"),
        size: 140,
        cell: ({ row }) => (row.original.kind === "gdrive" ? t("kindGdrive") : t("kindUrl")),
      },
      {
        accessorKey: "sizeBytes",
        header: t("columns.size"),
        size: 120,
        cell: ({ row }) => formatBytes(row.original.sizeBytes),
      },
      {
        accessorKey: "status",
        header: common("status"),
        size: 260,
        cell: ({ row }) => (
          <div className="space-y-1">
            <StatusBadge status={row.original.status} />
            {row.original.status === "invalid" && row.original.invalidReason ? (
              <p className="flex items-start gap-1 text-destructive text-xs">
                <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                {row.original.invalidReason}
              </p>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "createdAt",
        header: t("columns.createdAt"),
        size: 190,
        cell: ({ row }) => dateTimeFormatter.format(new Date(row.original.createdAt)),
      },
      {
        id: "actions",
        header: t("columns.actions"),
        size: 90,
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t("columns.actions")}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem className="gap-2" onClick={() => setInfoSource(row.original)}>
                <Info className="size-4 text-muted-foreground" />
                {t("info.action")}
              </DropdownMenuItem>
              {row.original.status === "ready" ? (
                <DropdownMenuItem className="gap-2" onClick={() => void openPreview(row.original)}>
                  <Play className="size-4 text-muted-foreground" />
                  {t("preview.action")}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2" onClick={() => setDeleteId(row.original.id)}>
                <Trash2 className="size-4 text-destructive" />
                <span className="text-destructive">{common("delete")}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
        enableSorting: false,
      },
    ],
    [common, dateTimeFormatter, openPreview, t],
  );

  return (
    <AppShell
      title={t("title")}
      description={t("description")}
      actions={
        <Button onClick={() => setOpen(true)}>
          <Plus />
          {t("addTitle")}
        </Button>
      }
    >
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("addTitle")}</DialogTitle>
            <DialogDescription>{t("addDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("nameLabel")}</span>
              <Input
                value={name}
                placeholder={t("namePlaceholder")}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("kindLabel")}</span>
              <Select value={kind} onValueChange={(value) => setKind(value as "url" | "gdrive")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="url">{t("kindUrl")}</SelectItem>
                  <SelectItem value="gdrive">{t("kindGdrive")}</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("urlLabel")}</span>
              <Input
                type="url"
                value={url}
                placeholder={t("urlPlaceholder")}
                onChange={(event) => setUrl(event.target.value)}
              />
            </label>
          </div>
          <DialogFooter>
            <Button disabled={!url || createSource.isPending} onClick={() => createSource.mutate()}>
              <Link2 />
              {t("addAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!infoSource} onOpenChange={(value) => !value && setInfoSource(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="h-4 w-4" />
              {infoSource?.name}
            </DialogTitle>
            <DialogDescription>
              {infoSource?.kind === "gdrive" ? t("kindGdrive") : t("kindUrl")}
            </DialogDescription>
          </DialogHeader>
          {infoSource ? (
            <div className="space-y-4">
              {infoSource.invalidReason ? (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  {infoSource.invalidReason}
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-3 text-sm">
                {infoSource.status === "invalid" ? null : (
                  <InfoRow
                    label={common("status")}
                    value={<StatusBadge status={infoSource.status} />}
                  />
                )}
                {infoSource.durationSec ? (
                  <InfoRow
                    label={t("info.duration")}
                    value={formatDuration(infoSource.durationSec)}
                  />
                ) : null}
                {infoSource.sizeBytes ? (
                  <InfoRow label={t("columns.size")} value={formatBytes(infoSource.sizeBytes)} />
                ) : null}
                {infoSource.width && infoSource.height ? (
                  <InfoRow
                    label={t("info.resolution")}
                    value={`${infoSource.width}x${infoSource.height} / ${resolutionLabel(infoSource.height)}`}
                  />
                ) : null}
                {infoSource.fps ? (
                  <InfoRow label={t("info.fps")} value={`${infoSource.fps} fps`} />
                ) : null}
                {infoSource.videoCodec ? (
                  <InfoRow
                    label={t("info.videoCodec")}
                    value={infoSource.videoCodec.toUpperCase()}
                  />
                ) : null}
                {infoSource.audioCodec ? (
                  <InfoRow
                    label={t("info.audioCodec")}
                    value={infoSource.audioCodec.toUpperCase()}
                  />
                ) : null}
                {infoSource.videoBitrate ? (
                  <InfoRow
                    label={t("info.bitrate")}
                    value={formatBitrate(infoSource.videoBitrate)}
                  />
                ) : null}
                {infoSource.sha256 ? (
                  <InfoRow
                    label={t("info.sha256")}
                    value={<span className="break-all font-mono text-xs">{infoSource.sha256}</span>}
                  />
                ) : null}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setInfoSource(null)}>
              {common("close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewSource} onOpenChange={closePreview}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{previewSource?.name}</DialogTitle>
          </DialogHeader>
          <div className="overflow-hidden rounded-lg bg-black">
            {previewUrl ? (
              // biome-ignore lint/a11y/useMediaCaption: user-supplied source has no captions
              <video
                key={previewUrl}
                src={previewUrl}
                controls
                autoPlay
                controlsList="nodownload"
                className="aspect-video w-full"
              >
                {t("preview.unsupported")}
              </video>
            ) : (
              <div className="flex aspect-video w-full items-center justify-center text-muted-foreground text-sm">
                {common("loading")}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Card>
        <CardHeader className="min-h-0 py-4">
          <CardTitle className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            {t("storageTitle")}
          </CardTitle>
          <CardDescription>{t("storageDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="font-bold text-3xl tracking-tight">{usedGb} GB</p>
              <p className="mt-1 text-muted-foreground text-sm">{t("cacheUsed")}</p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-2xl tracking-tight">{readyCount}</p>
              <p className="text-muted-foreground text-xs">{t("readySources")}</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{t("diskUsage")}</span>
              <span className={nearLimit ? "font-medium text-destructive" : "font-medium"}>
                {diskUsedPercent}% / {diskLimit}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all ${nearLimit ? "bg-destructive" : "bg-primary"}`}
                style={{ width: `${Math.min(diskUsedPercent, 100)}%` }}
              />
            </div>
            {nearLimit ? <p className="text-destructive text-xs">{t("diskNearLimit")}</p> : null}
          </div>
        </CardContent>
      </Card>
      <DataTable
        columns={columns}
        data={sources}
        empty={common("empty")}
        isLoading={sourcesQuery.isLoading}
        isError={sourcesQuery.isError}
        errorMessage={common("loadError")}
        searchPlaceholder={common("search")}
        initialSorting={[{ id: "createdAt", desc: true }]}
        selectedActionLabel={common("deleteSelected")}
        selectAllLabel={common("selectAll")}
        selectRowLabel={common("selectRow")}
        onDeleteSelected={setDeleteIds}
      />
      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(value) => !value && setDeleteId(null)}
        onConfirm={confirmDelete}
        title={t("deleteTitle")}
        description={t("deleteDescription")}
        confirmText={common("confirm")}
        cancelText={common("cancel")}
      />
      <ConfirmDialog
        open={deleteIds.length > 0}
        onOpenChange={(value) => !value && setDeleteIds([])}
        onConfirm={confirmBulkDelete}
        title={t("deleteSelectedTitle")}
        description={t("deleteSelectedDescription", { count: deleteIds.length })}
        confirmText={common("confirm")}
        cancelText={common("cancel")}
      />
    </AppShell>
  );
}
