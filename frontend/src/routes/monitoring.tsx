import { useQuery } from "@tanstack/react-query";
import {
  CircleAlertIcon,
  Cpu,
  HardDrive,
  MemoryStick,
  Network,
  RefreshCw,
  Server,
  Timer,
} from "lucide-react";
import { useTranslations } from "use-intl";

import { Alert, AlertTitle } from "@kumix/ui/reui/alert";
import { Frame, FrameFooter, FrameHeader, FramePanel, FrameTitle } from "@kumix/ui/reui/frame";
import { IconTile } from "@kumix/ui/reui/icon-tile";
import { Button } from "@kumix/ui/ui/button";
import { AppShell } from "@/components/AppShell";
import { api } from "@/lib/api";
import { useTimeFormatter } from "@/lib/date";
import {
  formatBytes,
  formatDurationMs as formatDuration,
  formatMbps,
  formatUptime,
  percent,
} from "@/lib/format";

function ProgressBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div
      className="h-2 overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export function MonitoringPage() {
  const t = useTranslations("Monitoring");
  const common = useTranslations("Common");
  const statsQuery = useQuery({
    queryKey: ["stats"],
    queryFn: api.stats,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });
  const metricsQuery = useQuery({
    queryKey: ["metrics"],
    queryFn: api.metrics,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
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
        <Button size="sm" variant="outline" onClick={refresh} disabled={isLoading}>
          <RefreshCw className={isLoading ? "size-4 animate-spin" : "size-4"} />
          {t("refresh")}
        </Button>
      }
    >
      <div className="space-y-5">
        {hasError ? (
          <Frame>
            <FramePanel className="py-6">
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>{common("loadError")}</AlertTitle>
              </Alert>
            </FramePanel>
          </Frame>
        ) : null}
        <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {summary.map(({ label, value, detail, percent: progress, icon: Icon }) => (
            <Frame key={label}>
              <FrameHeader>{label}</FrameHeader>
              <FramePanel className="space-y-4 p-5">
                <div className="flex items-start justify-between gap-4">
                  <p className="font-bold text-3xl tracking-tight">{value}</p>
                  <IconTile
                    aria-hidden="true"
                    className="border-primary/10 bg-primary/10 text-primary dark:border-primary/25 dark:bg-primary/15"
                  >
                    <Icon className="size-5" />
                  </IconTile>
                </div>
              </FramePanel>
              <FrameFooter className="space-y-2">
                <div className="flex items-center justify-between gap-2 text-muted-foreground text-xs">
                  <span>{detail}</span>
                  {typeof progress === "number" ? <span>{progress}%</span> : null}
                </div>
                {typeof progress === "number" ? <ProgressBar value={progress} /> : null}
              </FrameFooter>
            </Frame>
          ))}
        </section>

        <section className="grid gap-5">
          <Frame>
            <FrameHeader>
              <FrameTitle className="flex items-center gap-2">
                <HardDrive className="size-4 text-primary" />
                {t("disk")}
              </FrameTitle>
            </FrameHeader>
            <FramePanel className="space-y-3">
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
            </FramePanel>
          </Frame>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <Frame>
            <FrameHeader>
              <FrameTitle className="flex items-center gap-2">
                <Server className="size-4 text-success" />
                {t("server")}
              </FrameTitle>
            </FrameHeader>
            <FramePanel className="space-y-3 text-sm">
              <DetailRow label={t("platform")} value={runtime?.process.platform ?? "-"} />
              <DetailRow label={t("pid")} value={String(runtime?.process.pid ?? "-")} />
              <DetailRow label={t("uptime")} value={formatUptime(runtime?.process.uptimeSec)} />
            </FramePanel>
          </Frame>

          <Frame>
            <FrameHeader>
              <FrameTitle className="flex items-center gap-2">
                <Timer className="size-4 text-info" />
                {t("runtime")}
              </FrameTitle>
            </FrameHeader>
            <FramePanel className="space-y-3 text-sm">
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
            </FramePanel>
          </Frame>
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
