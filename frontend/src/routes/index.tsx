import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock, HardDriveUpload, Plus, Radio, Square } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslations } from "use-intl";

import { ConfirmDialog } from "@kumix/ui/custom/confirm-dialog";
import { toastError, toastSuccess } from "@kumix/ui/custom/toast";
import { Badge } from "@kumix/ui/reui/badge";
import { Frame, FrameHeader, FramePanel, FrameTitle } from "@kumix/ui/reui/frame";
import { Button } from "@kumix/ui/ui/button";
import { AppShell } from "@/components/AppShell";
import { EventKindBadge } from "@/components/EventKindBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { api, queryClient } from "@/lib/api";
import { useDateTimeFormatter, useTimeFormatter } from "@/lib/date";
import { formatBytes } from "@/lib/format";

export function Dashboard() {
  const t = useTranslations("Dashboard");
  const common = useTranslations("Common");
  const [stopId, setStopId] = useState<string | null>(null);
  const streamsQuery = useQuery({
    queryKey: ["streams"],
    queryFn: api.streams,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });
  const sourcesQuery = useQuery({
    queryKey: ["sources"],
    queryFn: api.sources,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });
  const eventsQuery = useQuery({
    queryKey: ["events"],
    queryFn: () => api.events(),
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const bandwidthQuery = useQuery({
    queryKey: ["bandwidth"],
    queryFn: api.bandwidth,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const dateTimeFormatter = useDateTimeFormatter(settingsQuery.data);
  const timeFormatter = useTimeFormatter(settingsQuery.data);

  const streams = streamsQuery.data ?? [];
  const sources = sourcesQuery.data ?? [];
  const events = eventsQuery.data ?? [];

  const liveStreams = useMemo(
    () => streams.filter((stream) => stream.status === "running"),
    [streams],
  );
  const failedStreams = useMemo(
    () => streams.filter((stream) => stream.status === "failed"),
    [streams],
  );
  const invalidSources = useMemo(
    () => sources.filter((source) => source.status === "invalid"),
    [sources],
  );
  const scheduledStreams = useMemo(
    () =>
      streams
        .filter((stream) => stream.status === "pending" && stream.scheduledFor)
        .sort(
          (a, b) =>
            new Date(a.scheduledFor as string).getTime() -
            new Date(b.scheduledFor as string).getTime(),
        )
        .slice(0, 5),
    [streams],
  );
  const recentEvents = useMemo(() => events.slice(0, 8), [events]);
  const recentFailures = useMemo(
    () => events.filter((event) => event.kind === "failed" || event.kind === "restart_failed"),
    [events],
  );
  const attentionCount = failedStreams.length + invalidSources.length;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["streams"] });
    void queryClient.invalidateQueries({ queryKey: ["sources"] });
  };
  const stopStream = useMutation({
    mutationFn: api.stopStream,
    onSuccess: () => {
      toastSuccess({ message: t("stopped") });
      refresh();
    },
    onError: (error) => toastError({ message: error.message }),
  });
  const confirmStop = () => {
    if (!stopId) return;
    stopStream.mutate(stopId);
    setStopId(null);
  };

  const statusCards = [
    {
      key: "live",
      label: t("live"),
      value: liveStreams.length,
      icon: Radio,
      to: "/streams",
      tone: "text-success",
    },
    {
      key: "scheduled",
      label: t("scheduled"),
      value: streams.filter((stream) => stream.status === "pending").length,
      icon: Clock,
      to: "/streams",
      tone: "text-info",
    },
    {
      key: "attention",
      label: t("attention"),
      value: attentionCount,
      icon: AlertTriangle,
      to: "/log",
      tone: attentionCount > 0 ? "text-warning" : "text-muted-foreground",
    },
  ];

  return (
    <AppShell
      title={t("title")}
      description={t("description")}
      actions={
        <Button render={<Link to="/streams/new" />} nativeButton={false}>
          <Plus />
          {t("create")}
        </Button>
      }
    >
      <div className="space-y-5">
        {recentFailures.length > 0 ? (
          <Frame className="border-destructive">
            <FrameHeader>
              <FrameTitle>{t("failureAlert")}</FrameTitle>
            </FrameHeader>
            <FramePanel className="space-y-2">
              {recentFailures.slice(0, 3).map((event) => (
                <div key={event.id} className="text-sm">
                  {event.message}
                </div>
              ))}
            </FramePanel>
          </Frame>
        ) : null}

        <section className="grid gap-5 sm:grid-cols-3">
          {statusCards.map(({ key, label, value, icon: Icon, to, tone }) => (
            <Link key={key} to={to}>
              <Frame>
                <FrameHeader>
                  <FrameTitle>{label}</FrameTitle>
                </FrameHeader>
                <FramePanel className="flex items-center justify-between p-5">
                  <p className="font-bold text-3xl tracking-tight">{value}</p>
                  <Icon className={`size-6 ${tone}`} />
                </FramePanel>
              </Frame>
            </Link>
          ))}
        </section>

        <section className="grid gap-5 sm:grid-cols-3">
          {[
            {
              key: "today",
              label: t("bandwidthToday"),
              value: bandwidthQuery.data?.today,
            },
            {
              key: "month",
              label: t("bandwidthMonth"),
              value: bandwidthQuery.data?.thisMonth,
            },
            {
              key: "allTime",
              label: t("bandwidthAllTime"),
              value: bandwidthQuery.data?.allTime,
            },
          ].map(({ key, label, value }) => (
            <Frame key={key}>
              <FrameHeader>
                <FrameTitle className="flex items-center gap-2">
                  <HardDriveUpload className="size-4 text-muted-foreground" />
                  {label}
                </FrameTitle>
              </FrameHeader>
              <FramePanel className="p-5">
                <p className="font-bold text-2xl tracking-tight">{formatBytes(value ?? 0)}</p>
              </FramePanel>
            </Frame>
          ))}
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.4fr_0.6fr]">
          <Frame>
            <FrameHeader>
              <FrameTitle className="flex items-center gap-2">
                <Radio className="size-4 text-destructive" />
                {t("liveTitle")}
              </FrameTitle>
            </FrameHeader>
            <FramePanel className="space-y-3">
              {liveStreams.length === 0 ? (
                <p className="py-6 text-center text-muted-foreground text-sm">{t("liveEmpty")}</p>
              ) : (
                liveStreams.map((stream) => (
                  <div
                    key={stream.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{stream.title}</p>
                      <p className="truncate text-muted-foreground text-xs">
                        {stream.source?.name ?? "-"} → {stream.target?.label ?? "-"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground text-xs">
                      <Badge variant="primary-light">
                        {t("fps", { value: stream.lastMetrics?.fps ?? 0 })}
                      </Badge>
                      <Badge variant="primary-light">
                        {t("bitrate", { value: stream.lastMetrics?.bitrateKbps ?? 0 })}
                      </Badge>
                      <Badge variant="primary-light">
                        {t("dropped", { value: stream.lastMetrics?.droppedFrames ?? 0 })}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={stopStream.isPending}
                        onClick={() => setStopId(stream.id)}
                      >
                        <Square />
                        {t("stop")}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </FramePanel>
          </Frame>

          <div className="space-y-5">
            <Frame>
              <FrameHeader>
                <FrameTitle className="flex items-center gap-2">
                  <AlertTriangle className="size-4 text-warning" />
                  {t("attentionTitle")}
                </FrameTitle>
              </FrameHeader>
              <FramePanel className="space-y-2">
                {attentionCount === 0 ? (
                  <p className="py-2 text-muted-foreground text-sm">{t("attentionEmpty")}</p>
                ) : (
                  <>
                    {failedStreams.map((stream) => (
                      <div
                        key={stream.id}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="truncate">{stream.title}</span>
                        <StatusBadge status={stream.status} />
                      </div>
                    ))}
                    {invalidSources.map((source) => (
                      <div
                        key={source.id}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="truncate">{source.name}</span>
                        <StatusBadge status={source.status} />
                      </div>
                    ))}
                  </>
                )}
              </FramePanel>
            </Frame>

            <Frame>
              <FrameHeader>
                <FrameTitle className="flex items-center gap-2">
                  <Clock className="size-4 text-info" />
                  {t("nextTitle")}
                </FrameTitle>
              </FrameHeader>
              <FramePanel className="space-y-2">
                {scheduledStreams.length === 0 ? (
                  <p className="py-2 text-muted-foreground text-sm">{t("nextEmpty")}</p>
                ) : (
                  scheduledStreams.map((stream) => (
                    <div key={stream.id} className="text-sm">
                      <p className="truncate font-medium">{stream.title}</p>
                      <p className="text-muted-foreground text-xs">
                        {stream.scheduledFor
                          ? dateTimeFormatter.format(new Date(stream.scheduledFor))
                          : "-"}
                      </p>
                    </div>
                  ))
                )}
              </FramePanel>
            </Frame>
          </div>
        </section>

        <section>
          <Frame>
            <FrameHeader>
              <FrameTitle>{t("activityTitle")}</FrameTitle>
            </FrameHeader>
            <FramePanel className="space-y-4">
              {recentEvents.length === 0 ? (
                <p className="py-2 text-muted-foreground text-sm">{t("activityEmpty")}</p>
              ) : (
                recentEvents.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center gap-3 border-border border-b text-sm last:border-0"
                  >
                    <span className="shrink-0 text-muted-foreground text-xs">
                      {timeFormatter.format(new Date(event.createdAt))}
                    </span>
                    <EventKindBadge kind={event.kind} className="shrink-0" />
                    <span className="truncate text-muted-foreground">{event.message}</span>
                  </div>
                ))
              )}
            </FramePanel>
          </Frame>
        </section>
      </div>

      <ConfirmDialog
        open={!!stopId}
        onOpenChange={(value) => !value && setStopId(null)}
        onConfirm={confirmStop}
        title={t("stopTitle")}
        description={t("stopDescription")}
        confirmText={common("confirm")}
        cancelText={common("cancel")}
      />
    </AppShell>
  );
}
