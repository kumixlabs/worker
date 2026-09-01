import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, Play, Plus, ScrollText, Square, Trash2 } from "lucide-react";
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
import { EmptyDescription } from "@kumix/ui/ui/empty";
import { Input } from "@kumix/ui/ui/input";
import { Label } from "@kumix/ui/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@kumix/ui/ui/select";
import { Switch } from "@kumix/ui/ui/switch";
import { AppShell } from "@/components/AppShell";
import { DataTable, type GridColumnDef } from "@/components/DataTable";
import { api, queryClient } from "@/lib/api";
import { useDateTimeFormatter } from "@/lib/date";
import type { StreamRecord } from "../../../src/types/stream";

function invalidateStreams() {
  void queryClient.invalidateQueries({ queryKey: ["streams"] });
}

function statusBadge(status: StreamRecord["status"]) {
  if (status === "running") return { variant: "info" as const, dot: "bg-emerald-500" };
  if (status === "failed") return { variant: "destructive" as const, dot: "bg-red-500" };
  return { variant: "secondary" as const, dot: "bg-muted-foreground" };
}

export function StreamsPage() {
  const t = useTranslations("Streams");
  const common = useTranslations("Common");
  const dateTimeFormatter = useDateTimeFormatter();
  const [createOpen, setCreateOpen] = useState(false);
  const [editStream, setEditStream] = useState<StreamRecord | null>(null);
  const [deleteStream, setDeleteStream] = useState<StreamRecord | null>(null);
  const [logStream, setLogStream] = useState<StreamRecord | null>(null);

  const streamsQuery = useQuery({
    queryKey: ["streams"],
    queryFn: ({ signal }) => api.streams({ signal }),
    refetchInterval: (query) =>
      query.state.data?.some((stream) => stream.status === "running") ? 5000 : false,
  });
  const streams = streamsQuery.data ?? [];

  const startMutation = useMutation({
    mutationFn: (id: string) => api.startStream(id),
    onSuccess: (record) => {
      invalidateStreams();
      toastSuccess({ message: t("started", { name: record.name }) });
    },
    onError: (error: Error) => toastError({ message: error.message }),
  });
  const stopMutation = useMutation({
    mutationFn: (id: string) => api.stopStream(id),
    onSuccess: (record) => {
      invalidateStreams();
      toastSuccess({ message: t("stopped", { name: record.name }) });
    },
    onError: (error: Error) => toastError({ message: error.message }),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteStream(id),
    onSuccess: () => {
      invalidateStreams();
      setDeleteStream(null);
      toastSuccess({ message: t("deleted") });
    },
    onError: (error: Error) => toastError({ message: error.message }),
  });

  const columns = useMemo<GridColumnDef<StreamRecord>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("colName"),
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{row.original.name}</span>
            <span className="text-muted-foreground text-xs">
              {row.original.playlistName ?? "—"}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: t("colStatus"),
        cell: ({ row }) => {
          const badge = statusBadge(row.original.status);
          return (
            <Badge variant={badge.variant} className="capitalize">
              <span className={`size-1.5 rounded-full ${badge.dot}`} />
              {row.original.status}
            </Badge>
          );
        },
      },
      {
        accessorKey: "shuffle",
        header: t("colOptions"),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex gap-1">
            {row.original.shuffle ? <Badge variant="outline">shuffle</Badge> : null}
            {row.original.loop ? <Badge variant="outline">loop</Badge> : null}
            {!row.original.shuffle && !row.original.loop ? "—" : null}
          </div>
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
        cell: ({ row }) => {
          const stream = row.original;
          const isRunning = stream.status === "running";
          return (
            <div className="flex justify-end gap-1">
              {isRunning ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={stopMutation.isPending}
                  onClick={() => stopMutation.mutate(stream.id)}
                >
                  <Square data-icon="inline-start" className="size-3.5" />
                  {t("stop")}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={startMutation.isPending}
                  onClick={() => startMutation.mutate(stream.id)}
                >
                  <Play data-icon="inline-start" className="size-3.5" />
                  {t("start")}
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon" aria-label={common("actions")} />}
                >
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setLogStream(stream)}>
                    <ScrollText data-icon="inline-start" className="size-4" />
                    {t("viewLog")}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={isRunning} onClick={() => setEditStream(stream)}>
                    <Pencil data-icon="inline-start" className="size-4" />
                    {t("edit")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={isRunning}
                    variant="destructive"
                    onClick={() => setDeleteStream(stream)}
                  >
                    <Trash2 data-icon="inline-start" className="size-4" />
                    {common("delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ],
    [t, common, dateTimeFormatter, startMutation, stopMutation],
  );

  return (
    <AppShell
      title={t("title")}
      description={t("description")}
      actions={
        <Button onClick={() => setCreateOpen(true)}>
          <Plus data-icon="inline-start" className="size-4" />
          {t("new")}
        </Button>
      }
    >
      <DataTable
        columns={columns}
        data={streams}
        searchPlaceholder={t("searchPlaceholder")}
        empty={<EmptyDescription>{t("empty")}</EmptyDescription>}
      />
      <StreamDialog stream={editStream} onClose={() => setEditStream(null)} />
      {createOpen && <StreamDialog stream={null} onClose={() => setCreateOpen(false)} />}
      {deleteStream && (
        <Dialog open onOpenChange={(open) => !open && setDeleteStream(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("deleteTitle")}</DialogTitle>
              <DialogDescription>
                {t("deleteDescription", { name: deleteStream.name })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteStream(null)}>
                {common("cancel")}
              </Button>
              <Button
                variant="destructive"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deleteStream.id)}
              >
                {common("delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {logStream && <LogDialog stream={logStream} onClose={() => setLogStream(null)} />}
    </AppShell>
  );
}

function StreamDialog({ stream, onClose }: { stream: StreamRecord | null; onClose: () => void }) {
  const t = useTranslations("Streams");
  const common = useTranslations("Common");
  const [name, setName] = useState(stream?.name ?? "");
  const [playlistId, setPlaylistId] = useState(stream?.playlistId ?? "");
  const [targetUrl, setTargetUrl] = useState("");
  const [shuffle, setShuffle] = useState(stream?.shuffle ?? false);
  const [loop, setLoop] = useState(stream?.loop ?? true);

  const playlistsQuery = useQuery({
    queryKey: ["playlists"],
    queryFn: ({ signal }) => api.playlists({ signal }),
  });
  const playlists = playlistsQuery.data ?? [];

  const mutation = useMutation({
    mutationFn: () =>
      stream
        ? api.patchStream(stream.id, {
            name,
            playlistId,
            ...(targetUrl ? { targetUrl } : {}),
            shuffle,
            loop,
          })
        : api.createStream({ name, playlistId, targetUrl, shuffle, loop }),
    onSuccess: () => {
      invalidateStreams();
      onClose();
      toastSuccess({ message: stream ? t("updated") : t("created") });
    },
    onError: (error: Error) => toastError({ message: error.message }),
  });

  const submit = () => {
    if (!name.trim() || !playlistId || (!stream && !targetUrl.trim())) return;
    mutation.mutate();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{stream ? t("edit") : t("new")}</DialogTitle>
          <DialogDescription>{t("dialogDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="stream-name">{t("colName")}</Label>
            <Input
              id="stream-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Salsa 24/7"
            />
          </div>
          <div className="space-y-2">
            <Label>{t("playlist")}</Label>
            <Select
              value={playlistId}
              onValueChange={(value) => {
                if (value) setPlaylistId(value);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("playlistPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {playlists.map((playlist) => (
                  <SelectItem key={playlist.id} value={playlist.id}>
                    {playlist.name} ({playlist.videoCount})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="stream-target">{t("targetUrl")}</Label>
            <Input
              id="stream-target"
              type="password"
              value={targetUrl}
              onChange={(event) => setTargetUrl(event.target.value)}
              placeholder={
                stream ? t("targetUrlKeep") : "rtmp://a.rtmp.youtube.com/live2/xxxx-xxxx"
              }
              autoComplete="off"
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="stream-shuffle">{t("shuffle")}</Label>
            <Switch
              id="stream-shuffle"
              checked={shuffle}
              onCheckedChange={(v) => setShuffle(Boolean(v))}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="stream-loop">{t("loop")}</Label>
            <Switch id="stream-loop" checked={loop} onCheckedChange={(v) => setLoop(Boolean(v))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {common("cancel")}
          </Button>
          <Button disabled={mutation.isPending} onClick={submit}>
            {stream ? common("save") : t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LogDialog({ stream, onClose }: { stream: StreamRecord; onClose: () => void }) {
  const t = useTranslations("Streams");
  const common = useTranslations("Common");
  const logQuery = useQuery({
    queryKey: ["streams", stream.id, "log"],
    queryFn: ({ signal }) => api.streamLog(stream.id, { signal }),
    refetchInterval: 5000,
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("logTitle", { name: stream.name })}</DialogTitle>
          <DialogDescription>{t("logDescription")}</DialogDescription>
        </DialogHeader>
        <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">
          {logQuery.data?.log || common("loading")}
        </pre>
        <DialogFooter>
          <Button onClick={onClose}>{common("close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
