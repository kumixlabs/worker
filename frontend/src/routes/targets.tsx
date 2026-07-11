import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { useTranslations } from "use-intl";

import {
  Badge,
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
  Input,
} from "@kumix/ui";
import { AlertError, AlertSuccess } from "@/components/Alert";
import { AppShell } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DataTable } from "@/components/DataTable";
import { api, queryClient } from "@/lib/api";
import { useDateTimeFormatter } from "@/lib/date";
import type { TargetRecord } from "../../../src/types/target";

export function TargetsPage() {
  const t = useTranslations("Targets");
  const task = useTranslations("CreateTask");
  const common = useTranslations("Common");
  const [open, setOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [ingestUrl, setIngestUrl] = useState("rtmp://a.rtmp.youtube.com/live2");
  const [streamKey, setStreamKey] = useState("");
  const targetsQuery = useQuery({ queryKey: ["targets"], queryFn: api.targets });
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const dateTimeFormatter = useDateTimeFormatter(settingsQuery.data);
  const targets = targetsQuery.data ?? [];
  const resetForm = useCallback(() => {
    setEditId(null);
    setLabel("");
    setIngestUrl("rtmp://a.rtmp.youtube.com/live2");
    setStreamKey("");
  }, []);
  const openCreate = () => {
    resetForm();
    setOpen(true);
  };
  const openEdit = useCallback((target: TargetRecord) => {
    setEditId(target.id);
    setLabel(target.label);
    setIngestUrl(target.ingestUrl);
    setStreamKey("");
    setOpen(true);
  }, []);
  const createTarget = useMutation({
    mutationFn: () =>
      api.createTarget({
        label: label.trim(),
        ingestUrl: ingestUrl.trim(),
        streamKey: streamKey.trim(),
      }),
    onSuccess: () => {
      resetForm();
      setOpen(false);
      AlertSuccess({ message: task("targetCreated") });
      void queryClient.invalidateQueries({ queryKey: ["targets"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (error) => AlertError({ message: error.message }),
  });
  const updateTarget = useMutation({
    mutationFn: () =>
      api.patchTarget(editId as string, {
        label: label.trim(),
        ingestUrl: ingestUrl.trim(),
        ...(streamKey.trim() ? { streamKey: streamKey.trim() } : {}),
      }),
    onSuccess: () => {
      resetForm();
      setOpen(false);
      AlertSuccess({ message: t("targetUpdated") });
      void queryClient.invalidateQueries({ queryKey: ["targets"] });
    },
    onError: (error) => AlertError({ message: error.message }),
  });
  const deleteTarget = useMutation({
    mutationFn: api.deleteTarget,
    onSuccess: () => {
      AlertSuccess({ message: t("targetDeleted") });
      void queryClient.invalidateQueries({ queryKey: ["targets"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (error) => AlertError({ message: error.message }),
  });
  const deleteTargets = useMutation({
    mutationFn: api.deleteTargets,
    onSuccess: (result) => {
      AlertSuccess({ message: t("targetDeleted") });
      for (const failed of result.failed) AlertError({ message: failed.message });
      void queryClient.invalidateQueries({ queryKey: ["targets"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (error) => AlertError({ message: error.message }),
  });
  const confirmDelete = () => {
    if (!deleteId) return;
    deleteTarget.mutate(deleteId);
    setDeleteId(null);
  };
  const confirmBulkDelete = () => {
    deleteTargets.mutate(deleteIds);
    setDeleteIds([]);
  };
  const toggleTarget = useMutation({
    mutationFn: (target: TargetRecord) => api.patchTarget(target.id, { active: !target.active }),
    onSuccess: () => {
      AlertSuccess({ message: t("targetUpdated") });
      void queryClient.invalidateQueries({ queryKey: ["targets"] });
    },
    onError: (error) => AlertError({ message: error.message }),
  });
  const columns = useMemo<ColumnDef<TargetRecord>[]>(
    () => [
      {
        accessorKey: "label",
        header: task("targetColumns.label"),
        size: 260,
        cell: ({ row }) => <span className="font-medium">{row.original.label}</span>,
      },
      { accessorKey: "ingestUrl", header: task("targetColumns.ingest"), size: 420 },
      {
        accessorKey: "active",
        header: task("targetColumns.status"),
        size: 130,
        cell: ({ row }) => (
          <Badge variant={row.original.active ? "success" : "secondary"} appearance="light">
            {row.original.active ? task("targetColumns.active") : task("targetColumns.disabled")}
          </Badge>
        ),
      },
      {
        accessorKey: "createdAt",
        header: task("targetColumns.createdAt"),
        size: 190,
        cell: ({ row }) => dateTimeFormatter.format(new Date(row.original.createdAt)),
      },
      {
        id: "actions",
        header: t("actions"),
        size: 90,
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label={t("actions")}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem className="gap-2" onClick={() => openEdit(row.original)}>
                <Pencil className="size-4 text-muted-foreground" />
                {t("edit")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2"
                disabled={toggleTarget.isPending}
                onClick={() => toggleTarget.mutate(row.original)}
              >
                <Power className="size-4 text-muted-foreground" />
                {row.original.active ? t("disable") : t("enable")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2" onClick={() => setDeleteId(row.original.id)}>
                <Trash2 className="size-4 text-destructive" />
                <span className="text-destructive">{t("delete")}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
        enableSorting: false,
      },
    ],
    [dateTimeFormatter, task, t, toggleTarget, openEdit],
  );

  return (
    <AppShell
      title={t("title")}
      description={t("description")}
      actions={
        <Button onClick={openCreate}>
          <Plus />
          {t("createTitle")}
        </Button>
      }
    >
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) resetForm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editId ? t("editTitle") : t("createTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{task("targetColumns.label")}</span>
              <Input
                value={label}
                placeholder={task("targetNamePlaceholder")}
                onChange={(event) => setLabel(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{task("targetColumns.ingest")}</span>
              <Input
                value={ingestUrl}
                placeholder={task("ingestUrlPlaceholder")}
                onChange={(event) => setIngestUrl(event.target.value)}
              />
              <span className="text-muted-foreground text-xs">{task("ingestUrlNote")}</span>
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{task("streamKeyLabel")}</span>
              <Input
                className="font-mono"
                type="password"
                autoComplete="off"
                value={streamKey}
                placeholder={editId ? t("streamKeyKeep") : task("streamKeyLabel")}
                onChange={(event) => setStreamKey(event.target.value)}
              />
            </label>
          </div>
          <DialogFooter>
            {editId ? (
              <Button
                disabled={!label || !ingestUrl || updateTarget.isPending}
                onClick={() => updateTarget.mutate()}
              >
                <Pencil />
                {t("saveChanges")}
              </Button>
            ) : (
              <Button
                disabled={!label || !ingestUrl || !streamKey || createTarget.isPending}
                onClick={() => createTarget.mutate()}
              >
                <Plus />
                {task("createTarget")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DataTable
        columns={columns}
        data={targets}
        empty={task("emptyTargets")}
        isLoading={targetsQuery.isLoading}
        isError={targetsQuery.isError}
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
