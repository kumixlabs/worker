import { useDeferredValue, useEffect, useMemo, useState } from "react";
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
  Check,
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

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardTable,
  Command,
  CommandCheck,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  DataGrid,
  DataGridColumnHeader,
  DataGridPagination,
  DataGridTable,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@kumix/ui";
import { AlertError, AlertSuccess } from "@/components/Alert";
import { AppShell } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EventKindBadge } from "@/components/EventKindBadge";
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
  const streamsQuery = useQuery({ queryKey: ["streams"], queryFn: api.streams });
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
    const older = await api.events({ createdAt: oldest.createdAt, id: oldest.id });
    setOlderEvents((current) => uniqueEvents([...current, ...older]));
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
      AlertSuccess({ message: t("cleared", { count: result.deleted }) });
      void queryClient.invalidateQueries({ queryKey: ["events"] });
    },
    onError: (error) => AlertError({ message: error.message }),
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
  const exportEvents = async () => {
    try {
      const signed = await api.signedUrl(api.eventsExportPath());
      window.location.href = signed.url;
    } catch (error) {
      AlertError({ message: error instanceof Error ? error.message : common("loadError") });
    }
  };
  const columns = useMemo<ColumnDef<EventRecord>[]>(
    () => [
      {
        accessorKey: "kind",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("columns.kind")} />,
        cell: ({ row }) => <EventKindBadge kind={row.original.kind} />,
        size: 120,
      },
      {
        id: "stream",
        accessorFn: (row) => row.streamId ?? "",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("columns.stream")} />
        ),
        cell: ({ row }) => {
          const stream = streams.find((item) => item.id === row.original.streamId);
          return <span className="text-sm">{stream?.title ?? row.original.streamId ?? "-"}</span>;
        },
        size: 180,
        enableSorting: false,
      },
      {
        accessorKey: "message",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("columns.message")} />
        ),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.message}</span>,
        size: 520,
      },
      {
        accessorKey: "createdAt",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("columns.time")} />,
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
  const table = useReactTable({
    columns,
    data: events,
    getRowId: (row) => row.id,
    state: { pagination, sorting },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
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
            <Card key={label}>
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <p className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    {label}
                  </p>
                  <p className="mt-3 font-bold text-3xl tracking-tight">{value}</p>
                </div>
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-primary-foreground">
                  <Icon className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          ))}
          <Card>
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                  {t("summary.connection")}
                </p>
                <p className="mt-3 font-bold text-3xl tracking-tight">
                  {paused ? t("paused") : connected ? t("live") : t("reconnecting")}
                </p>
              </div>
              <Badge
                variant={paused ? "warning" : connected ? "success" : "destructive"}
                appearance="light"
              >
                {paused ? t("paused") : connected ? t("live") : t("reconnecting")}
              </Badge>
            </CardContent>
          </Card>
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
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-border border-b p-3">
              <div className="relative min-w-[220px] flex-1">
                <Search className="absolute inset-s-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  placeholder={common("search")}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="ps-9"
                />
              </div>

              <Popover open={streamFilterOpen} onOpenChange={setStreamFilterOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[220px] justify-between">
                    <span className="truncate">{selectedStream?.title ?? t("allSources")}</span>
                    <ChevronsUpDown className="h-4 w-4 opacity-60" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-0" align="start">
                  <Command>
                    <CommandInput placeholder={t("searchStream")} />
                    <CommandList>
                      <CommandEmpty>{t("emptyStreams")}</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value={t("allSources")}
                          onSelect={() => {
                            setStreamId("");
                            setLiveEvents([]);
                            setStreamFilterOpen(false);
                          }}
                        >
                          <span>{t("allSources")}</span>
                          {!streamId ? <CommandCheck icon={Check} /> : null}
                        </CommandItem>
                        {streams.map((stream) => (
                          <CommandItem
                            key={stream.id}
                            value={stream.title}
                            onSelect={() => {
                              setStreamId(stream.id);
                              setLiveEvents([]);
                              setStreamFilterOpen(false);
                            }}
                          >
                            <span className="truncate">{stream.title}</span>
                            {streamId === stream.id ? <CommandCheck icon={Check} /> : null}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              <Select value={kindFilter} onValueChange={setKindFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t("kindAll")}</SelectItem>
                  {kindOptions.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {kind}
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
            </div>
            <CardTable className="overflow-x-auto">
              <DataGridTable />
            </CardTable>
            <CardFooter>
              <DataGridPagination />
            </CardFooter>
          </Card>
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
