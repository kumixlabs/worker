import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Calendar,
  CircleAlertIcon,
  Eye,
  MessageSquare,
  ThumbsUp,
  Users,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useTranslations } from "use-intl";

import { Alert, AlertTitle } from "@kumix/ui/reui/alert";
import { Badge } from "@kumix/ui/reui/badge";
import { Frame, FrameHeader, FramePanel, FrameTitle } from "@kumix/ui/reui/frame";
import { Button } from "@kumix/ui/ui/button";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";
import { useDateTimeFormatter } from "@/lib/date";

export function StreamAnalyticsPage() {
  const t = useTranslations("Analytics");
  const common = useTranslations("Common");
  const { id = "" } = useParams<{ id: string }>();
  const streamQuery = useQuery({
    queryKey: ["streams"],
    queryFn: api.streams,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    select: (streams) => streams.find((s) => s.id === id) ?? null,
  });
  const analyticsQuery = useQuery({
    queryKey: ["stream-analytics", id],
    queryFn: () => api.streamAnalytics(id),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const dateTimeFormatter = useDateTimeFormatter(settingsQuery.data);
  const stream = streamQuery.data;
  const analytics = analyticsQuery.data;

  if (streamQuery.isLoading) {
    return (
      <AppShell title={t("title")} description={t("description")}>
        <Alert variant="info">
          <CircleAlertIcon />
          <AlertTitle>{common("loading")}</AlertTitle>
        </Alert>
      </AppShell>
    );
  }

  if (streamQuery.isError) {
    return (
      <AppShell
        title={t("title")}
        description={t("description")}
        actions={
          <Button variant="outline" render={<Link to="/streams" />} nativeButton={false}>
            <ArrowLeft className="size-4" />
            {t("backToStreams")}
          </Button>
        }
      >
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{t("streamNotFound")}</AlertTitle>
        </Alert>
      </AppShell>
    );
  }

  if (!stream) {
    return (
      <AppShell
        title={t("title")}
        description={t("description")}
        actions={
          <Button variant="outline" render={<Link to="/streams" />} nativeButton={false}>
            <ArrowLeft className="size-4" />
            {t("backToStreams")}
          </Button>
        }
      >
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{t("streamNotFound")}</AlertTitle>
        </Alert>
      </AppShell>
    );
  }

  if (analyticsQuery.isError) {
    const error =
      analyticsQuery.error instanceof Error ? analyticsQuery.error.message : t("noData");
    return (
      <AppShell
        title={t("title")}
        description={t("description")}
        actions={
          <Button variant="outline" render={<Link to="/streams" />} nativeButton={false}>
            <ArrowLeft className="size-4" />
            {t("backToStreams")}
          </Button>
        }
      >
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      </AppShell>
    );
  }

  const statCards = [
    analytics?.concurrentViewers != null
      ? {
          key: "viewers",
          label: t("concurrentViewers"),
          value: analytics.concurrentViewers.toLocaleString(),
          icon: Users,
          tone: "text-red-500",
        }
      : null,
    analytics?.viewCount != null
      ? {
          key: "views",
          label: t("totalViews"),
          value: analytics.viewCount.toLocaleString(),
          icon: Eye,
          tone: "text-blue-500",
        }
      : null,
    analytics?.likeCount != null
      ? {
          key: "likes",
          label: t("likes"),
          value: analytics.likeCount.toLocaleString(),
          icon: ThumbsUp,
          tone: "text-emerald-500",
        }
      : null,
    analytics?.commentCount != null
      ? {
          key: "comments",
          label: t("comments"),
          value: analytics.commentCount.toLocaleString(),
          icon: MessageSquare,
          tone: "text-amber-500",
        }
      : null,
  ].filter(Boolean) as {
    key: string;
    label: string;
    value: string;
    icon: typeof Eye;
    tone: string;
  }[];

  return (
    <AppShell
      title={t("title")}
      description={t("description")}
      actions={
        <Button variant="outline" render={<Link to="/streams" />} nativeButton={false}>
          <ArrowLeft className="size-4" />
          {t("backToStreams")}
        </Button>
      }
    >
      <div className="space-y-5">
        <Frame>
          <FrameHeader>
            <FrameTitle className="flex flex-wrap items-center gap-3">
              <span>{stream.title}</span>
              <StatusBadge status={stream.status} />
              {analytics ? (
                analytics.isLive ? (
                  <Badge variant="primary-light" className="text-red-500">
                    {t("live")}
                  </Badge>
                ) : analytics.isUpcoming ? (
                  <Badge variant="primary-light" className="text-amber-500">
                    {t("upcoming")}
                  </Badge>
                ) : (
                  <Badge variant="primary-light" className="text-muted-foreground">
                    {t("ended")}
                  </Badge>
                )
              ) : null}
            </FrameTitle>
          </FrameHeader>
          <FramePanel>
            <div className="flex flex-wrap items-center gap-4">
              {analytics?.thumbnailUrl ? (
                <img
                  src={analytics.thumbnailUrl}
                  alt={analytics.title}
                  referrerPolicy="no-referrer"
                  className="h-28 w-50 rounded-lg border border-border object-cover"
                />
              ) : null}
              <div className="space-y-1 text-sm">
                <p className="font-medium">{analytics?.title ?? t("loadingAnalytics")}</p>
                <p className="text-muted-foreground">{analytics?.channelTitle}</p>
                {analytics?.actualStartTime ? (
                  <p className="flex items-center gap-1 text-muted-foreground text-xs">
                    <Calendar className="size-3" />
                    {dateTimeFormatter.format(new Date(analytics.actualStartTime))}
                  </p>
                ) : null}
                {analytics?.scheduledStartTime && !analytics?.actualStartTime ? (
                  <p className="flex items-center gap-1 text-amber-500 text-xs">
                    <Calendar className="size-3" />
                    {t("scheduledFor")}:{" "}
                    {dateTimeFormatter.format(new Date(analytics.scheduledStartTime))}
                  </p>
                ) : null}
              </div>
            </div>
          </FramePanel>
        </Frame>

        {statCards.length > 0 ? (
          <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {statCards.map(({ key, label, value, icon: Icon, tone }) => (
              <Frame key={key}>
                <FrameHeader>{label}</FrameHeader>
                <FramePanel className="flex items-center justify-between p-5">
                  <p className="font-bold text-2xl tracking-tight">{value}</p>
                  <Icon className={`h-6 w-6 ${tone}`} />
                </FramePanel>
              </Frame>
            ))}
          </section>
        ) : analyticsQuery.isLoading ? (
          <p className="text-muted-foreground text-sm">{t("loadingAnalytics")}</p>
        ) : (
          <p className="text-muted-foreground text-sm">{t("noData")}</p>
        )}
      </div>
    </AppShell>
  );
}
