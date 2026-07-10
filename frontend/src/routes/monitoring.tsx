import { useQuery } from "@tanstack/react-query";
import { Cpu, HardDrive, MemoryStick, Network, RefreshCw, Server, Timer } from "lucide-react";
import { useTranslations } from "use-intl";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@kumix/ui";
import { AppShell } from "@/components/AppShell";
import { api } from "@/lib/api";
import { useTimeFormatter } from "@/lib/date";

function formatBytes(bytes = 0) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function formatMbps(value = 0) {
  return `${value.toFixed(value >= 10 ? 1 : 2)} Mbps`;
}

function formatUptime(seconds = 0) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatDuration(milliseconds = 0) {
  if (!milliseconds) return "-";
  const seconds = milliseconds / 1000;
  return seconds >= 60 ? `${Math.round(seconds / 60)}m` : `${Math.round(seconds)}s`;
}

function percent(value = 0, total = 0) {
  if (!total) return 0;
  return Math.min(100, Math.max(0, Math.round((value / total) * 100)));
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

export function MonitoringPage() {
  const t = useTranslations("Monitoring");
  const statsQuery = useQuery({ queryKey: ["stats"], queryFn: api.stats, refetchInterval: 5000 });
  const metricsQuery = useQuery({
    queryKey: ["metrics"],
    queryFn: api.metrics,
    refetchInterval: 5000,
  });
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const timeFormatter = useTimeFormatter(settingsQuery.data);
  const stats = statsQuery.data;
  const runtime = metricsQuery.data;
  const memoryPercent = percent(runtime?.memory.usedBytes, runtime?.memory.totalBytes);
  const diskPercent = percent(runtime?.storage.disk?.usedBytes, runtime?.storage.disk?.totalBytes);
  const loadAverage = runtime?.cpu.loadAverage?.[0] ?? 0;
  const loadPercent = percent(loadAverage, runtime?.cpu.cores ?? 0);
  const isLoading = statsQuery.isLoading || metricsQuery.isLoading;
  const hasError = statsQuery.isError || metricsQuery.isError;
  const updatedAt = Math.max(statsQuery.dataUpdatedAt, metricsQuery.dataUpdatedAt);
  const summary = [
    {
      label: t("cpu"),
      value: t("cores", { count: runtime?.cpu.cores ?? 0 }),
      detail: t("loadAverage", { value: loadAverage.toFixed(2) }),
      percent: loadPercent,
      icon: Cpu,
    },
    {
      label: t("memory"),
      value: formatBytes(runtime?.memory.usedBytes),
      detail: t("ofTotal", { total: formatBytes(runtime?.memory.totalBytes) }),
      percent: memoryPercent,
      icon: MemoryStick,
    },
    {
      label: t("bandwidthOut"),
      value: formatMbps(runtime?.network.outboundMbps),
      detail: t("runningStreams", { count: stats?.streams.running ?? 0 }),
      icon: Network,
    },
    {
      label: t("uptime"),
      value: formatUptime(runtime?.process.uptimeSec),
      detail: t("processRuntime"),
      icon: Timer,
    },
  ];
  const refresh = () => {
    void statsQuery.refetch();
    void metricsQuery.refetch();
  };

  return (
    <AppShell
      title={t("title")}
      description={t("description")}
      actions={
        <div className="flex items-center gap-2">
          <Badge variant={hasError ? "destructive" : "success"} appearance="light">
            {hasError ? t("offline") : t("online")}
          </Badge>
          <Button size="sm" variant="outline" onClick={refresh} disabled={isLoading}>
            <RefreshCw className={isLoading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            {t("refresh")}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {summary.map(({ label, value, detail, percent: progress, icon: Icon }) => (
            <Card key={label}>
              <CardContent className="space-y-4 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                      {label}
                    </p>
                    <p className="mt-3 font-bold text-3xl tracking-tight">{value}</p>
                  </div>
                  <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-primary-foreground">
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-muted-foreground text-xs">
                    <span>{detail}</span>
                    {typeof progress === "number" ? <span>{progress}%</span> : null}
                  </div>
                  {typeof progress === "number" ? <ProgressBar value={progress} /> : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="grid gap-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="h-4 w-4" />
                {t("disk")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="text-muted-foreground">{t("diskUsage")}</span>
                <span className="font-medium">
                  {formatBytes(runtime?.storage.disk?.freeBytes)} /{" "}
                  {formatBytes(runtime?.storage.disk?.totalBytes)}
                </span>
              </div>
              <ProgressBar value={diskPercent} />
              <p className="text-muted-foreground text-xs">
                {t("diskDescription", { used: formatBytes(runtime?.storage.disk?.usedBytes) })}
              </p>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-4 w-4" />
                {t("server")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <DetailRow label={t("platform")} value={runtime?.process.platform ?? "-"} />
              <DetailRow label={t("pid")} value={String(runtime?.process.pid ?? "-")} />
              <DetailRow label={t("uptime")} value={formatUptime(runtime?.process.uptimeSec)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Timer className="h-4 w-4" />
                {t("runtime")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <DetailRow
                label={t("scheduler")}
                value={runtime?.scheduler.running ? t("schedulerRunning") : t("schedulerStopped")}
              />
              <DetailRow
                label={t("schedulerInterval")}
                value={formatDuration(runtime?.scheduler.intervalMs ?? 0)}
              />
              <DetailRow
                label={t("lastSchedulerTick")}
                value={
                  runtime?.scheduler.lastTickAt
                    ? timeFormatter.format(new Date(runtime.scheduler.lastTickAt))
                    : "-"
                }
              />
              <DetailRow
                label={t("lastStarted")}
                value={String(runtime?.scheduler.lastStarted ?? 0)}
              />
              <DetailRow
                label={t("lastStopped")}
                value={String(runtime?.scheduler.lastStopped ?? 0)}
              />
              <DetailRow
                label={t("lastUpdated")}
                value={updatedAt ? timeFormatter.format(new Date(updatedAt)) : "-"}
              />
            </CardContent>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
