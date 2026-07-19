import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  BarChart3,
  Download,
  Eye,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Square,
  Trash2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslations } from "use-intl";

import {
  Button,
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from "@kumix/ui";
import { AlertError, AlertSuccess } from "@/components/Alert";
import { AppShell } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DataTable } from "@/components/DataTable";
import { DateTimePicker, toWallClockInput } from "@/components/DateTimePicker";
import { StatusBadge } from "@/components/StatusBadge";
import { api, queryClient } from "@/lib/api";
import { useDateTimeFormatter } from "@/lib/date";
import type { StreamRecord } from "../../../src/types/stream";

type SourceOption = { id: string; name: string };
type TargetOption = { id: string; label: string };

export function StreamsPage() {
  const t = useTranslations("Streams");
  const common = useTranslations("Common");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [editStream, setEditStream] = useState<StreamRecord | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editSourceId, setEditSourceId] = useState("");
  const [editTargetId, setEditTargetId] = useState("");
  const [editScheduledFor, setEditScheduledFor] = useState("");
  const [editAutoStopAt, setEditAutoStopAt] = useState("");
  const [editYoutubeLiveUrl, setEditYoutubeLiveUrl] = useState("");
  const streamsQuery = useQuery({
    queryKey: ["streams"],
    queryFn: api.streams,
    refetchInterval: 5_000,
  });
  const sourcesQuery = useQuery({ queryKey: ["sources"], queryFn: api.sources });
  const targetsQuery = useQuery({ queryKey: ["targets"], queryFn: api.targets });
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const workerTimezone = settingsQuery.data?.timezone;
  const dateTimeFormatter = useDateTimeFormatter(settingsQuery.data);
  const sources: SourceOption[] = (() => {
    const ready = (sourcesQuery.data ?? [])
      .filter((source) => source.status === "ready")
      .map((source) => ({ id: source.id, name: source.name }));
    if (editSourceId && !ready.some((source) => source.id === editSourceId) && editStream?.source) {
      ready.push({ id: editStream.source.id, name: editStream.source.name });
    }
    return ready;
  })();
  const targets: TargetOption[] = (() => {
    const active = (targetsQuery.data ?? [])
      .filter((target) => target.active)
      .map((target) => ({ id: target.id, label: target.label }));
    if (
      editTargetId &&
      !active.some((target) => target.id === editTargetId) &&
      editStream?.target
    ) {
      active.push({ id: editStream.target.id, label: editStream.target.label });
    }
    return active;
  })();
  const selectedEditSource = sources.find((source) => source.id === editSourceId) ?? null;
  const selectedEditTarget = targets.find((target) => target.id === editTargetId) ?? null;
  const streamLocked = editStream?.status === "running" || editStream?.status === "stopping";
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["streams"] });
    void queryClient.invalidateQueries({ queryKey: ["stats"] });
  };
  const startStream = useMutation({
    mutationFn: api.startStream,
    onSuccess: () => {
      AlertSuccess({ message: t("started") });
      refresh();
    },
    onError: (error) => AlertError({ message: error.message }),
  });
  const stopStream = useMutation({
    mutationFn: api.stopStream,
    onSuccess: () => {
      AlertSuccess({ message: t("stopped") });
      refresh();
    },
    onError: (error) => AlertError({ message: error.message }),
  });
  const updateStream = useMutation({
    mutationFn: () => {
      const isRunning = editStream?.status === "running" || editStream?.status === "stopping";
      const body = isRunning
        ? { youtubeLiveUrl: editYoutubeLiveUrl || null }
        : {
            title: editTitle.trim(),
            sourceId: editSourceId,
            targetId: editTargetId,
            youtubeLiveUrl: editYoutubeLiveUrl || null,
            scheduledFor: editScheduledFor || null,
            autoStopAt: editAutoStopAt || null,
          };
      return api.patchStream(editStream?.id ?? "", body);
    },
    onSuccess: () => {
      AlertSuccess({ message: t("updated") });
      setEditStream(null);
      refresh();
    },
    onError: (error) => AlertError({ message: error.message }),
  });
  const deleteStream = useMutation({
    mutationFn: api.deleteStream,
    onSuccess: () => {
      AlertSuccess({ message: t("deleted") });
      refresh();
    },
    onError: (error) => AlertError({ message: error.message }),
  });
  const deleteStreams = useMutation({
    mutationFn: api.deleteStreams,
    onSuccess: (result) => {
      AlertSuccess({ message: t("deleted") });
      for (const failed of result.failed) AlertError({ message: failed.message });
      refresh();
    },
    onError: (error) => AlertError({ message: error.message }),
  });
  const confirmDelete = () => {
    if (!deleteId) return;
    deleteStream.mutate(deleteId);
    setDeleteId(null);
  };
  const confirmBulkDelete = () => {
    deleteStreams.mutate(deleteIds);
    setDeleteIds([]);
  };
  const streams = streamsQuery.data ?? [];
  const openEdit = useCallback(
    (stream: StreamRecord) => {
      setEditStream(stream);
      setEditTitle(stream.title);
      setEditSourceId(stream.sourceId);
      setEditTargetId(stream.targetId);
      setEditScheduledFor(
        stream.scheduledFor ? toWallClockInput(new Date(stream.scheduledFor), workerTimezone) : "",
      );
      setEditAutoStopAt(
        stream.autoStopAt ? toWallClockInput(new Date(stream.autoStopAt), workerTimezone) : "",
      );
      setEditYoutubeLiveUrl(stream.youtubeLiveUrl ?? "");
    },
    [workerTimezone],
  );
  const exportStreamLog = useCallback(
    async (id: string) => {
      try {
        const signed = await api.signedUrl(api.streamEventsExportPath(id));
        window.location.href = signed.url;
      } catch (error) {
        AlertError({ message: error instanceof Error ? error.message : common("loadError") });
      }
    },
    [common],
  );
  const columns = useMemo<ColumnDef<StreamRecord>[]>(
    () => [
      {
        accessorKey: "title",
        header: t("columns.title"),
        size: 280,
        cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
      },
      {
        accessorKey: "status",
        header: t("columns.status"),
        size: 130,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "source",
        header: t("columns.source"),
        size: 220,
        cell: ({ row }) => row.original.source?.name ?? "-",
      },
      {
        accessorKey: "target",
        header: t("columns.target"),
        size: 180,
        cell: ({ row }) => row.original.target?.label ?? "-",
      },
      {
        id: "time",
        accessorFn: (row) => row.createdAt,
        header: t("columns.time"),
        size: 190,
        cell: ({ row }) => {
          const createdAt = dateTimeFormatter.format(new Date(row.original.createdAt));
          const startedAt = row.original.startedAt
            ? dateTimeFormatter.format(new Date(row.original.startedAt))
            : "-";
          const stoppedAt = row.original.stoppedAt
            ? dateTimeFormatter.format(new Date(row.original.stoppedAt))
            : "-";
          return (
            <div
              className="flex flex-col gap-0.5 text-xs"
              title={`${t("columns.created")}: ${createdAt}\n${t("columns.startedAt")}: ${startedAt}\n${t("columns.stoppedAt")}: ${stoppedAt}`}
            >
              <span className="text-muted-foreground">
                {t("columns.created")}: {createdAt}
              </span>
              <span>
                {t("columns.startedAt")}: {startedAt}
              </span>
              <span className="text-emerald-600">
                {t("columns.stoppedAt")}: {stoppedAt}
              </span>
            </div>
          );
        },
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
              {row.original.status === "running" ? (
                <DropdownMenuItem
                  className="gap-2"
                  disabled={stopStream.isPending}
                  onClick={() => stopStream.mutate(row.original.id)}
                >
                  <Square className="size-4 text-muted-foreground" />
                  {t("stop")}
                </DropdownMenuItem>
              ) : row.original.status === "failed" ? (
                <DropdownMenuItem
                  className="gap-2"
                  disabled={startStream.isPending}
                  onClick={() => startStream.mutate(row.original.id)}
                >
                  <Play className="size-4 text-muted-foreground" />
                  {t("start")}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem className="gap-2" onClick={() => openEdit(row.original)}>
                <Pencil className="size-4 text-muted-foreground" />
                {t("edit")}
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="gap-2">
                <Link to={`/log?q=${encodeURIComponent(row.original.id)}`}>
                  <Eye className="size-4 text-muted-foreground" />
                  {t("viewLog")}
                </Link>
              </DropdownMenuItem>
              {row.original.youtubeLiveUrl ? (
                <DropdownMenuItem asChild className="gap-2">
                  <Link to={`/streams/${encodeURIComponent(row.original.id)}`}>
                    <BarChart3 className="size-4 text-muted-foreground" />
                    {t("analytics")}
                  </Link>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                className="gap-2"
                onClick={() => void exportStreamLog(row.original.id)}
              >
                <Download className="size-4 text-muted-foreground" />
                {t("exportLog")}
              </DropdownMenuItem>
              {row.original.status !== "running" && row.original.status !== "stopping" ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="gap-2" onClick={() => setDeleteId(row.original.id)}>
                    <Trash2 className="size-4 text-destructive" />
                    <span className="text-destructive">{t("delete")}</span>
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
        enableSorting: false,
      },
    ],
    [dateTimeFormatter, exportStreamLog, openEdit, startStream, stopStream, t],
  );

  return (
    <AppShell
      title={t("title")}
      description={t("description")}
      actions={
        <Button asChild>
          <Link to="/streams/new">
            <Plus />
            {t("create")}
          </Link>
        </Button>
      }
    >
      <Dialog
        open={!!editStream}
        onOpenChange={(open) => {
          if (!open) setEditStream(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("editTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("columns.title")}</span>
              <Input
                value={editTitle}
                placeholder={t("columns.title")}
                disabled={streamLocked}
                onChange={(event) => setEditTitle(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("columns.source")}</span>
              <Combobox
                items={sources}
                value={selectedEditSource}
                onValueChange={(value) =>
                  setEditSourceId(value && typeof value === "object" ? value.id : "")
                }
                itemToStringLabel={(item) => item.name}
                isItemEqualToValue={(a, b) => a.id === b.id}
                disabled={streamLocked}
              >
                <ComboboxTrigger
                  render={
                    <Button
                      variant="outline"
                      className="w-full justify-between font-normal"
                      disabled={streamLocked}
                    >
                      <ComboboxValue placeholder={t("columns.source")} />
                    </Button>
                  }
                />
                <ComboboxContent>
                  <ComboboxInput showTrigger={false} placeholder={t("searchSource")} />
                  <ComboboxEmpty>{t("emptySources")}</ComboboxEmpty>
                  <ComboboxList>
                    {(source: SourceOption) => (
                      <ComboboxItem key={source.id} value={source}>
                        {source.name}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("columns.target")}</span>
              <Combobox
                items={targets}
                value={selectedEditTarget}
                onValueChange={(value) =>
                  setEditTargetId(value && typeof value === "object" ? value.id : "")
                }
                itemToStringLabel={(item) => item.label}
                isItemEqualToValue={(a, b) => a.id === b.id}
                disabled={streamLocked}
              >
                <ComboboxTrigger
                  render={
                    <Button
                      variant="outline"
                      className="w-full justify-between font-normal"
                      disabled={streamLocked}
                    >
                      <ComboboxValue placeholder={t("columns.target")} />
                    </Button>
                  }
                />
                <ComboboxContent>
                  <ComboboxInput showTrigger={false} placeholder={t("searchTarget")} />
                  <ComboboxEmpty>{t("emptyTargets")}</ComboboxEmpty>
                  <ComboboxList>
                    {(target: TargetOption) => (
                      <ComboboxItem key={target.id} value={target}>
                        {target.label}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("youtubeLiveUrl")}</span>
              <Input
                value={editYoutubeLiveUrl}
                placeholder={t("youtubeLiveUrlPlaceholder")}
                onChange={(event) => setEditYoutubeLiveUrl(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("editScheduledFor")}</span>
              <DateTimePicker
                value={editScheduledFor}
                onChange={setEditScheduledFor}
                disabled={streamLocked}
                placeholder={t("editScheduledFor")}
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("editAutoStopAt")}</span>
              <DateTimePicker
                value={editAutoStopAt}
                onChange={setEditAutoStopAt}
                disabled={streamLocked}
                min={editScheduledFor || undefined}
                placeholder={t("autoStopAtPlaceholder")}
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              disabled={
                !editTitle.trim() || !editSourceId || !editTargetId || updateStream.isPending
              }
              onClick={() => updateStream.mutate()}
            >
              <Pencil />
              {t("saveChanges")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DataTable
        columns={columns}
        data={streams}
        empty={t("empty")}
        isLoading={streamsQuery.isLoading}
        isError={streamsQuery.isError}
        errorMessage={common("loadError")}
        searchPlaceholder={common("search")}
        initialSorting={[{ id: "time", desc: true }]}
        selectedActionLabel={common("deleteSelected")}
        selectAllLabel={common("selectAll")}
        selectRowLabel={common("selectRow")}
        onDeleteSelected={setDeleteIds}
        getCanSelectRow={(stream) => stream.status !== "running" && stream.status !== "stopping"}
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
