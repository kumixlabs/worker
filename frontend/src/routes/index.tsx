import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock, Plus, Radio, Square } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslations } from "use-intl";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@kumix/ui";
import { AlertError, AlertSuccess } from "@/components/Alert";
import { AppShell } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EventKindBadge } from "@/components/EventKindBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { api, queryClient } from "@/lib/api";
import { useDateTimeFormatter, useTimeFormatter } from "@/lib/date";

export function Dashboard() {
  const t = useTranslations("Dashboard");
  const common = useTranslations("Common");
  const [stopId, setStopId] = useState<string | null>(null);
  const streamsQuery = useQuery({ queryKey: ["streams"], queryFn: api.streams });
  const sourcesQuery = useQuery({ queryKey: ["sources"], queryFn: api.sources });
  const eventsQuery = useQuery({
    queryKey: ["events"],
    queryFn: api.events,
    refetchInterval: 5000,
  });
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const dateTimeFormatter = useDateTimeFormatter(settingsQuery.data);
  const timeFormatter = useTimeFormatter(settingsQuery.data);

  const streams = streamsQuery.data ?? [];
  const sources = sourcesQuery.data ?? [];
  const events = eventsQuery.data ?? [];

  const liveStreams = streams.filter((stream) => stream.status === "running");
  const failedStreams = streams.filter((stream) => stream.status === "failed");
  const invalidSources = sources.filter((source) => source.status === "invalid");
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
  const recentEvents = events.slice(0, 8);
  const attentionCount = failedStreams.length + invalidSources.length;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["streams"] });
    void queryClient.invalidateQueries({ queryKey: ["sources"] });
  };
  const stopStream = useMutation({
    mutationFn: api.stopStream,
    onSuccess: () => {
      AlertSuccess({ message: t("stopped") });
      refresh();
    },
    onError: (error) => AlertError({ message: error.message }),
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
      tone: "text-green-500",
    },
    {
      key: "scheduled",
      label: t("scheduled"),
      value: streams.filter((stream) => stream.status === "pending").length,
      icon: Clock,
      to: "/streams",
      tone: "text-amber-500",
    },
    {
      key: "attention",
      label: t("attention"),
      value: attentionCount,
      icon: AlertTriangle,
      to: "/log",
      tone: attentionCount > 0 ? "text-red-500" : "text-muted-foreground",
    },
  ];

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
      <div className="space-y-5">
        <section className="grid gap-5 sm:grid-cols-3">
          {statusCards.map(({ key, label, value, icon: Icon, to, tone }) => (
            <Link key={key} to={to}>
              <Card className="transition hover:border-primary/40">
                <CardContent className="flex items-center justify-between p-5">
                  <div>
                    <p className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                      {label}
                    </p>
                    <p className="mt-3 font-bold text-3xl tracking-tight">{value}</p>
                  </div>
                  <Icon className={`h-6 w-6 ${tone}`} />
                </CardContent>
              </Card>
            </Link>
          ))}
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.4fr_0.6fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Radio className="h-4 w-4" />
                {t("liveTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
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
                      <Badge appearance="light">
                        {t("fps", { value: stream.lastMetrics?.fps ?? 0 })}
                      </Badge>
                      <Badge appearance="light">
                        {t("bitrate", { value: stream.lastMetrics?.bitrateKbps ?? 0 })}
                      </Badge>
                      <Badge appearance="light">
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
            </CardContent>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  {t("attentionTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
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
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  {t("nextTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
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
              </CardContent>
            </Card>
          </div>
        </section>

        <section>
          <Card>
            <CardHeader>
              <CardTitle>{t("activityTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {recentEvents.length === 0 ? (
                <p className="py-2 text-muted-foreground text-sm">{t("activityEmpty")}</p>
              ) : (
                recentEvents.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center gap-3 border-border border-b pb-2 text-sm last:border-0 last:pb-0"
                  >
                    <span className="shrink-0 text-muted-foreground text-xs">
                      {timeFormatter.format(new Date(event.createdAt))}
                    </span>
                    <EventKindBadge kind={event.kind} className="shrink-0" />
                    <span className="truncate text-muted-foreground">{event.message}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
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
