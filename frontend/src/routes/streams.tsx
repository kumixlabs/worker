import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, Eye, MoreHorizontal, Pencil, Play, Plus, Square, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslations } from "use-intl";

import {
  Button,
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
} from "@kumix/ui";
import { AlertError, AlertSuccess } from "@/components/Alert";
import { AppShell } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DataTable } from "@/components/DataTable";
import { DateTimePicker, toLocalInput } from "@/components/DateTimePicker";
import { StatusBadge } from "@/components/StatusBadge";
import { api, queryClient } from "@/lib/api";
import { useDateTimeFormatter } from "@/lib/date";
import type { StreamRecord } from "../../../src/types/stream";

export function StreamsPage() {
  const t = useTranslations("Streams");
  const common = useTranslations("Common");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [editStream, setEditStream] = useState<StreamRecord | null>(null);
  const [stoppedAt, setStoppedAt] = useState("");
  const streamsQuery = useQuery({ queryKey: ["streams"], queryFn: api.streams });
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const dateTimeFormatter = useDateTimeFormatter(settingsQuery.data);
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
    mutationFn: () => api.patchStream(editStream?.id ?? "", { stoppedAt: stoppedAt || null }),
    onSuccess: () => {
      AlertSuccess({ message: t("updated") });
      setEditStream(null);
      setStoppedAt("");
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
  const openEdit = useCallback((stream: StreamRecord) => {
    setEditStream(stream);
    setStoppedAt(stream.stoppedAt ? toLocalInput(new Date(stream.stoppedAt)) : "");
  }, []);
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
              {row.original.status === "pending" || row.original.status === "failed" ? (
                <DropdownMenuItem className="gap-2" onClick={() => openEdit(row.original)}>
                  <Pencil className="size-4 text-muted-foreground" />
                  {t("edit")}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem asChild className="gap-2">
                <Link to={`/log?q=${encodeURIComponent(row.original.id)}`}>
                  <Eye className="size-4 text-muted-foreground" />
                  {t("viewLog")}
                </Link>
              </DropdownMenuItem>
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
          if (!open) {
            setEditStream(null);
            setStoppedAt("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("editTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("columns.stoppedAt")}</span>
              <DateTimePicker
                value={stoppedAt}
                onChange={setStoppedAt}
                placeholder={t("stoppedAtPlaceholder")}
              />
            </label>
          </div>
          <DialogFooter>
            <Button disabled={updateStream.isPending} onClick={() => updateStream.mutate()}>
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
