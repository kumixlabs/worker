import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  type ColumnDef,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type PaginationState,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import {
  ChevronsUpDown,
  Download,
  Pause,
  Play,
  Radio,
  RefreshCw,
  ScrollText,
  Search,
  Trash2,
  Wifi,
  X,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useTranslations } from "use-intl";

import { ConfirmDialog } from "@kumix/ui/custom/confirm-dialog";
import { toastError, toastSuccess } from "@kumix/ui/custom/toast";
import { Badge } from "@kumix/ui/reui/badge";
import { DataGrid } from "@kumix/ui/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@kumix/ui/reui/data-grid/data-grid-column-header";
import { DataGridPagination } from "@kumix/ui/reui/data-grid/data-grid-pagination";
import { DataGridScrollArea } from "@kumix/ui/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@kumix/ui/reui/data-grid/data-grid-table";
import { Frame, FrameFooter, FrameHeader, FramePanel } from "@kumix/ui/reui/frame";
import { IconTile } from "@kumix/ui/reui/icon-tile";
import { Button } from "@kumix/ui/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@kumix/ui/ui/command";
import { Input } from "@kumix/ui/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@kumix/ui/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@kumix/ui/ui/select";
import { AppShell } from "@/components/AppShell";
import { EventKindBadge, knownEventKinds } from "@/components/EventKindBadge";
import { api, getApiToken, queryClient } from "@/lib/api";
import { useDateTimeFormatter } from "@/lib/date";
import type { EventRecord } from "../../../src/types/event";

const ALL = "__all__";

function uniqueEvents(events: EventRecord[]) {
  return Array.from(new Map(events.map((event) => [event.id, event])).values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function LogPage() {
  const [searchParams] = useSearchParams();
  const [paused, setPaused] = useState(false);
  const [streamId, setStreamId] = useState(searchParams.get("q") ?? "");
  const [kindFilter, setKindFilter] = useState(ALL);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [streamFilterOpen, setStreamFilterOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [liveEvents, setLiveEvents] = useState<EventRecord[]>([]);
  const [olderEvents, setOlderEvents] = useState<EventRecord[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);
  const t = useTranslations("Log");
  const common = useTranslations("Common");
  const eventT = useTranslations("Common.eventKinds");
  const streamsQuery = useQuery({
    queryKey: ["streams"],
    queryFn: api.streams,
    refetchIntervalInBackground: false,
  });
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const dateTimeFormatter = useDateTimeFormatter(settingsQuery.data);
  const streams = streamsQuery.data ?? [];
  const selectedStream = streams.find((stream) => stream.id === streamId);
  const eventsQuery = useQuery({
    queryKey: ["events"],
    queryFn: () => api.events(),
  });
  const loadOlderEvents = async () => {
    const oldest = [...(eventsQuery.data ?? []), ...olderEvents].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
        a.id.localeCompare(b.id),
    )[0];
    if (!oldest) return;
    try {
      const older = await api.events({ createdAt: oldest.createdAt, id: oldest.id });
      setOlderEvents((current) => uniqueEvents([...current, ...older]).slice(0, 1000));
    } catch {
      // ignore — user can retry
    }
  };

  useEffect(() => {
    if (paused) {
      setConnected(false);
      return;
    }
    let source: EventSource | null = null;
    let cancelled = false;
    let failCount = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const pendingEvents: Array<Partial<EventRecord> & { type?: string }> = [];
    let flushTimer: ReturnType<typeof setInterval> | null = null;
    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer) return;
      // Exponential backoff capped at 30s so a transient drop self-heals.
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(failCount, 5));
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void openSource().catch(() => setConnected(false));
      }, delay);
    };
    const openSource = async () => {
      const path = streamId ? api.streamEventsPath(streamId) : api.eventsStreamPath();
      let signed: { url: string };
      try {
        signed = await api.signedUrl(path);
      } catch {
        setConnected(false);
        if (!getApiToken()) {
          window.dispatchEvent(new CustomEvent("kumix-worker-auth-invalid"));
          return;
        }
        scheduleReconnect();
        return;
      }
      if (cancelled) return;
      source = new EventSource(signed.url);
      source.onopen = () => {
        failCount = 0;
        setConnected(true);
      };
      source.onerror = () => {
        failCount += 1;
        setConnected(false);
        source?.close();
        source = null;
        scheduleReconnect();
      };
      source.onmessage = (message) => {
        let event: Partial<EventRecord> & { type?: string };
        try {
          event = JSON.parse(message.data) as Partial<EventRecord> & { type?: string };
        } catch {
          return;
        }
        if (!event.id && event.type === "hello") return;
        if (event.type === "metrics") return;
        pendingEvents.push(event);
      };
    };
    flushTimer = setInterval(() => {
      if (pendingEvents.length === 0) return;
      const batch = pendingEvents.splice(0, pendingEvents.length);
      setLiveEvents((current) =>
        uniqueEvents([
          ...batch.map((event) => ({
            id:
              event.id ??
              `${event.type ?? "event"}_${event.createdAt ?? Date.now()}_${event.message ?? ""}`,
            streamId: event.streamId ?? streamId,
            kind: event.kind ?? event.type ?? "event",
            message: event.message ?? JSON.stringify(event),
            payload: event.payload ?? null,
            createdAt: event.createdAt ?? new Date().toISOString(),
          })),
          ...current,
        ]).slice(0, 200),
      );
    }, 250);
    void openSource().catch(() => setConnected(false));
    return () => {
      cancelled = true;
      setConnected(false);
      source?.close();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
      }
    };
  }, [paused, streamId]);

  const clearEvents = useMutation({
    mutationFn: api.clearEvents,
    onSuccess: (result) => {
      setLiveEvents([]);
      setOlderEvents([]);
      toastSuccess({ message: t("cleared", { count: result.deleted }) });
      void queryClient.invalidateQueries({ queryKey: ["events"] });
    },
    onError: (error) => toastError({ message: error.message }),
  });
  const confirmClearEvents = () => {
    clearEvents.mutate();
    setConfirmClear(false);
  };
  const allEvents = useMemo(
    () => uniqueEvents([...(eventsQuery.data ?? []), ...olderEvents, ...liveEvents]),
    [eventsQuery.data, olderEvents, liveEvents],
  );
  const kindOptions = useMemo(
    () => Array.from(new Set(allEvents.map((event) => event.kind))).sort(),
    [allEvents],
  );
  const events = useMemo(() => {
    const term = deferredSearch.trim().toLowerCase();
    return allEvents.filter((event) => {
      if (streamId && event.streamId !== streamId) return false;
      if (kindFilter !== ALL && event.kind !== kindFilter) return false;
      if (!term) return true;
      return [event.kind, event.message, event.streamId ?? ""].some((value) =>
        value.toLowerCase().includes(term),
      );
    });
  }, [allEvents, deferredSearch, kindFilter, streamId]);
  const totalEvents = eventsQuery.data?.length ?? 0;
  const streamEvents = events.filter((event) => event.streamId).length;
  const summary = [
    { label: t("summary.total"), value: totalEvents, icon: ScrollText },
    { label: t("summary.filtered"), value: events.length, icon: Radio },
    { label: t("summary.streamEvents"), value: streamEvents, icon: Wifi },
  ];
  const hasFilters = Boolean(search.trim()) || streamId !== "" || kindFilter !== ALL;
  const refresh = () => {
    void streamsQuery.refetch();
    void eventsQuery.refetch();
  };
  const resetFilters = () => {
    setSearch("");
    setStreamId("");
    setKindFilter(ALL);
    setLiveEvents([]);
  };
  const exportEvents = useCallback(async () => {
    try {
      const signed = await api.signedUrl(api.eventsExportPath());
      window.location.href = signed.url;
    } catch (error) {
      toastError({ message: error instanceof Error ? error.message : common("loadError") });
    }
  }, [common]);
  const columns = useMemo<ColumnDef<EventRecord>[]>(
    () => [
      {
        accessorKey: "kind",
        header: t("columns.kind"),
        cell: ({ row }) => <EventKindBadge kind={row.original.kind} />,
        size: 120,
      },
      {
        id: "stream",
        accessorFn: (row) => row.streamId ?? "",
        header: t("columns.stream"),
        cell: ({ row }) => {
          const stream = streams.find((item) => item.id === row.original.streamId);
          return <span className="text-sm">{stream?.title ?? row.original.streamId ?? "-"}</span>;
        },
        size: 180,
        enableSorting: false,
      },
      {
        accessorKey: "message",
        header: t("columns.message"),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.message}</span>,
        size: 520,
      },
      {
        accessorKey: "createdAt",
        header: t("columns.time"),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs">
            {dateTimeFormatter.format(new Date(row.original.createdAt))}
          </span>
        ),
        size: 190,
      },
    ],
    [dateTimeFormatter, streams, t],
  );
  const gridColumns = useMemo(
    () =>
      columns.map((column) => {
        if (typeof column.header !== "string") return column;
        const title = column.header;
        return {
          ...column,
          header: ({ column: tableColumn }) => (
            <DataGridColumnHeader title={title} column={tableColumn} />
          ),
        } as ColumnDef<EventRecord>;
      }),
    [columns],
  );
  const table = useReactTable({
    columns: gridColumns,
    data: events,
    getRowId: (row) => row.id,
    state: { pagination, sorting },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  return (
    <AppShell
      title={t("title")}
      description={t("description")}
      actions={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setPaused((value) => !value)}>
            {paused ? <Play /> : <Pause />}
            {paused ? t("resume") : t("pause")}
          </Button>
          <Button
            variant="outline"
            disabled={clearEvents.isPending}
            onClick={() => setConfirmClear(true)}
          >
            <Trash2 />
            {common("clear")}
          </Button>
          <Button onClick={() => void exportEvents()}>
            <Download />
            {common("export")}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {summary.map(({ label, value, icon: Icon }) => (
            <Frame key={label}>
              <FrameHeader>{label}</FrameHeader>
              <FramePanel className="flex items-center justify-between p-5">
                <p className="font-bold text-3xl tracking-tight">{value}</p>
                <IconTile
                  aria-hidden="true"
                  className="border-primary/10 bg-primary/10 text-primary dark:border-primary/25 dark:bg-primary/15"
                >
                  <Icon className="size-5" />
                </IconTile>
              </FramePanel>
            </Frame>
          ))}
          <Frame>
            <FrameHeader>{t("summary.connection")}</FrameHeader>
            <FramePanel className="flex items-center justify-between p-5">
              <p className="font-bold text-3xl tracking-tight">
                {paused ? t("paused") : connected ? t("live") : t("reconnecting")}
              </p>
              <Badge variant={paused ? "warning" : connected ? "success" : "destructive"}>
                {paused ? t("paused") : connected ? t("live") : t("reconnecting")}
              </Badge>
            </FramePanel>
          </Frame>
        </section>

        <DataGrid
          table={table}
          recordCount={events.length}
          isLoading={eventsQuery.isLoading}
          tableLayout={{
            columnsMovable: false,
            columnsPinnable: false,
            columnsResizable: false,
            columnsVisibility: false,
          }}
          emptyMessage={t("waiting")}
        >
          <Frame stacked dense>
            <FrameHeader className="flex w-full flex-row flex-wrap items-center gap-2 p-3">
              <div className="relative min-w-55 flex-1">
                <Search className="absolute inset-s-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  placeholder={common("search")}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="ps-9"
                />
              </div>

              <Popover open={streamFilterOpen} onOpenChange={setStreamFilterOpen}>
                <PopoverTrigger
                  render={<Button variant="outline" className="w-55 justify-between" />}
                >
                  <span className="truncate">{selectedStream?.title ?? t("allSources")}</span>
                  <ChevronsUpDown className="h-4 w-4 opacity-60" />
                </PopoverTrigger>
                <PopoverContent className="w-72 p-0" align="start">
                  <Command>
                    <CommandInput placeholder={t("searchStream")} />
                    <CommandList>
                      <CommandEmpty>{t("emptyStreams")}</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value={t("allSources")}
                          data-checked={!streamId || undefined}
                          onSelect={() => {
                            setStreamId("");
                            setLiveEvents([]);
                            setStreamFilterOpen(false);
                          }}
                        >
                          <span className="truncate">{t("allSources")}</span>
                        </CommandItem>
                        {streams.map((stream) => (
                          <CommandItem
                            key={stream.id}
                            value={stream.title}
                            data-checked={streamId === stream.id || undefined}
                            onSelect={() => {
                              setStreamId(stream.id);
                              setLiveEvents([]);
                              setStreamFilterOpen(false);
                            }}
                          >
                            <span className="truncate">{stream.title}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              <Select value={kindFilter} onValueChange={(value) => setKindFilter(value ?? ALL)}>
                <SelectTrigger className="w-40">
                  <SelectValue>
                    {(value) =>
                      !value || value === ALL
                        ? t("kindAll")
                        : knownEventKinds.has(value)
                          ? eventT(value as never)
                          : value
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t("kindAll")}</SelectItem>
                  {kindOptions.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {knownEventKinds.has(kind) ? eventT(kind as never) : kind}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {hasFilters ? (
                <Button variant="outline" onClick={resetFilters}>
                  <X />
                  {t("resetFilters")}
                </Button>
              ) : null}

              <div className="ms-auto flex items-center gap-2">
                <Button variant="outline" onClick={() => void loadOlderEvents()}>
                  {t("loadMore")}
                </Button>
                <Button variant="outline" onClick={refresh} disabled={eventsQuery.isFetching}>
                  <RefreshCw
                    className={eventsQuery.isFetching ? "size-4 animate-spin" : "size-4"}
                  />
                  {common("refresh")}
                </Button>
              </div>
            </FrameHeader>
            <FramePanel className="p-0 shadow-none">
              <DataGridScrollArea>
                <DataGridTable />
              </DataGridScrollArea>
            </FramePanel>
            <FrameFooter className="py-1.5 pr-2 pl-2.5">
              <DataGridPagination />
            </FrameFooter>
          </Frame>
        </DataGrid>
      </div>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        onConfirm={confirmClearEvents}
        title={t("clearTitle")}
        description={t("clearDescription")}
        confirmText={common("confirm")}
        cancelText={common("cancel")}
      />
    </AppShell>
  );
}
