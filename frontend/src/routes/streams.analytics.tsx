import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Calendar, Eye, MessageSquare, ThumbsUp, Users } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useTranslations } from "use-intl";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@kumix/ui";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";
import { useDateTimeFormatter } from "@/lib/date";
import type { YouTubeAnalytics } from "../../../src/services/youtube";

export function StreamAnalyticsPage() {
  const t = useTranslations("Analytics");
  const common = useTranslations("Common");
  const { id = "" } = useParams<{ id: string }>();
  const streamQuery = useQuery({
    queryKey: ["stream", id],
    queryFn: () => api.streams().then((s) => s.find((x) => x.id === id) ?? null),
  });
  const analyticsQuery = useQuery({
    queryKey: ["stream-analytics", id],
    queryFn: () => api.streamAnalytics(id),
    refetchInterval: 30_000,
  });
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const dateTimeFormatter = useDateTimeFormatter(settingsQuery.data);
  const stream = streamQuery.data;
  const analytics = analyticsQuery.data as YouTubeAnalytics | undefined;

  if (streamQuery.isLoading) {
    return (
      <AppShell title={t("title")} description={t("description")}>
        <p className="text-muted-foreground text-sm">{common("loading")}</p>
      </AppShell>
    );
  }

  if (!stream) {
    return (
      <AppShell title={t("title")} description={t("description")}>
        <div className="space-y-4">
          <Card>
            <CardContent className="py-6">
              <p className="text-destructive text-sm">{t("streamNotFound")}</p>
            </CardContent>
          </Card>
          <Button asChild variant="outline">
            <Link to="/streams">
              <ArrowLeft className="size-4" />
              {t("backToStreams")}
            </Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  if (analyticsQuery.isError) {
    const error =
      analyticsQuery.error instanceof Error ? analyticsQuery.error.message : t("noData");
    return (
      <AppShell title={t("title")} description={t("description")}>
        <div className="space-y-4">
          <Card>
            <CardContent className="py-6">
              <p className="text-destructive text-sm">{error}</p>
            </CardContent>
          </Card>
          <Button asChild variant="outline">
            <Link to="/streams">
              <ArrowLeft className="size-4" />
              {t("backToStreams")}
            </Link>
          </Button>
        </div>
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
        <Button asChild variant="outline">
          <Link to="/streams">
            <ArrowLeft className="size-4" />
            {t("backToStreams")}
          </Link>
        </Button>
      }
    >
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-3">
              <span>{stream.title}</span>
              <StatusBadge status={stream.status} />
              {analytics ? (
                analytics.isLive ? (
                  <Badge appearance="light" className="text-red-500">
                    {t("live")}
                  </Badge>
                ) : analytics.isUpcoming ? (
                  <Badge appearance="light" className="text-amber-500">
                    {t("upcoming")}
                  </Badge>
                ) : (
                  <Badge appearance="light" className="text-muted-foreground">
                    {t("ended")}
                  </Badge>
                )
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-4">
              {analytics?.thumbnailUrl ? (
                <img
                  src={analytics.thumbnailUrl}
                  alt={analytics.title}
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
          </CardContent>
        </Card>

        {statCards.length > 0 ? (
          <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {statCards.map(({ key, label, value, icon: Icon, tone }) => (
              <Card key={key}>
                <CardContent className="flex items-center justify-between p-5">
                  <div>
                    <p className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                      {label}
                    </p>
                    <p className="mt-2 font-bold text-2xl tracking-tight">{value}</p>
                  </div>
                  <Icon className={`h-6 w-6 ${tone}`} />
                </CardContent>
              </Card>
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
