import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Database, Gauge } from "lucide-react";
import { useTranslations } from "use-intl";

import { Frame, FrameHeader, FramePanel, FrameTitle } from "@kumix/ui/reui/frame";
import { AppShell } from "@/components/AppShell";
import { EventKindBadge } from "@/components/EventKindBadge";
import { api } from "@/lib/api";
import { useDateTimeFormatter } from "@/lib/date";
import { formatBytes } from "@/lib/format";

export function Dashboard() {
  const t = useTranslations("Dashboard");
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const statsQuery = useQuery({
    queryKey: ["stats"],
    queryFn: api.stats,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });
  const eventsQuery = useQuery({
    queryKey: ["events"],
    queryFn: () => api.events(),
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });
  const dateTimeFormatter = useDateTimeFormatter(settingsQuery.data);

  const stats = statsQuery.data;
  const events = useMemo(() => (eventsQuery.data ?? []).slice(0, 10), [eventsQuery.data]);

  const statusCards = [
    {
      key: "cache",
      label: t("cacheUsed"),
      value: formatBytes(stats?.storage.cacheBytes ?? 0),
      icon: Database,
    },
    {
      key: "uptime",
      label: t("uptime"),
      value: `${Math.floor((stats?.system.uptimeSec ?? 0) / 3600)}h`,
      icon: Activity,
    },
    {
      key: "platform",
      label: t("platform"),
      value: stats?.system.platform ?? "—",
      icon: Gauge,
    },
  ];

  return (
    <AppShell title={t("title")} description={t("description")}>
      <div className="grid gap-4 sm:grid-cols-3">
        {statusCards.map((card) => (
          <Frame key={card.key}>
            <FramePanel className="flex items-center gap-3 p-4">
              <card.icon className="size-5 text-muted-foreground" />
              <div>
                <p className="text-muted-foreground text-xs">{card.label}</p>
                <p className="font-semibold text-lg">{card.value}</p>
              </div>
            </FramePanel>
          </Frame>
        ))}
      </div>

      <Frame>
        <FrameHeader>
          <FrameTitle>{t("recentEvents")}</FrameTitle>
        </FrameHeader>
        <FramePanel className="p-0">
          {events.length === 0 ? (
            <p className="p-6 text-center text-muted-foreground text-sm">{t("noEvents")}</p>
          ) : (
            <ul className="divide-y">
              {events.map((event) => (
                <li key={event.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <EventKindBadge kind={event.kind} />
                  <span className="min-w-0 flex-1 truncate">{event.message}</span>
                  <span className="shrink-0 text-muted-foreground text-xs">
                    {dateTimeFormatter.format(new Date(event.createdAt))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </FramePanel>
      </Frame>
    </AppShell>
  );
}
