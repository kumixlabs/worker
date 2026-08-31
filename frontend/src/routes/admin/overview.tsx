import { useQuery } from "@tanstack/react-query";
import {
  CircleAlertIcon,
  Clapperboard,
  HardDrive,
  HardDriveUpload,
  Radio,
  Users,
} from "lucide-react";
import { useTranslations } from "use-intl";

import { Alert, AlertTitle } from "@kumix/ui/reui/alert";
import { Frame, FrameHeader, FramePanel, FrameTitle } from "@kumix/ui/reui/frame";
import { AdminShell } from "@/components/AdminShell";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import type { BandwidthSummary } from "../../../../src/types/bandwidth";
import type { WorkerStats } from "../../../../src/types/worker";

type AdminUserRow = {
  id: string;
  role: string;
  banned: boolean | number | null;
};

export function AdminOverviewPage() {
  const t = useTranslations("AdminOverview");

  const common = useTranslations("Common");
  const stats = useQuery({
    queryKey: ["adminStats"],
    queryFn: ({ signal }: { signal?: AbortSignal }) => api.adminStats({ signal }),
  });
  const bandwidth = useQuery({
    queryKey: ["adminBandwidth"],
    queryFn: ({ signal }: { signal?: AbortSignal }) => api.adminBandwidth({ signal }),
  });
  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => (await api.getAdminUsers()) as AdminUserRow[],
  });

  const s = stats.data as WorkerStats | undefined;
  const b = bandwidth.data as BandwidthSummary | undefined;
  const userRows = users.data ?? [];
  const adminCount = userRows.filter((u) => u.role === "admin").length;
  const bannedCount = userRows.filter((u) => Boolean(u.banned)).length;

  return (
    <AdminShell title={t("title")} description={t("description")}>
      {stats.isError || users.isError ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{common("loadError")}</AlertTitle>
        </Alert>
      ) : null}
      <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Frame>
          <FrameHeader>
            <FrameTitle className="flex items-center gap-2">
              <Users className="size-4 text-muted-foreground" />
              {t("users")}
            </FrameTitle>
          </FrameHeader>
          <FramePanel className="flex items-center justify-between p-5">
            <div>
              <p className="font-bold text-3xl tracking-tight">{userRows.length}</p>
              <p className="mt-1 text-muted-foreground text-xs">
                {t("userMeta", { admins: adminCount, banned: bannedCount })}
              </p>
            </div>
            <Users className="size-6 text-primary" aria-hidden="true" />
          </FramePanel>
        </Frame>

        <Frame>
          <FrameHeader>
            <FrameTitle className="flex items-center gap-2">
              <Radio className="size-4 text-muted-foreground" />
              {t("liveNow")}
            </FrameTitle>
          </FrameHeader>
          <FramePanel className="flex items-center justify-between p-5">
            <div>
              <p className="font-bold text-3xl tracking-tight">{s?.streams.running ?? 0}</p>
              <p className="mt-1 text-muted-foreground text-xs">
                {t("liveNowMeta", {
                  pending: s?.streams.pending ?? 0,
                  stopping: s?.streams.stopping ?? 0,
                })}
              </p>
            </div>
            <Radio className="size-6 text-primary" aria-hidden="true" />
          </FramePanel>
        </Frame>

        <Frame>
          <FrameHeader>
            <FrameTitle className="flex items-center gap-2">
              <Clapperboard className="size-4 text-muted-foreground" />
              {t("streams")}
            </FrameTitle>
          </FrameHeader>
          <FramePanel className="flex items-center justify-between p-5">
            <div>
              <p className="font-bold text-3xl tracking-tight">{s?.streams.total ?? 0}</p>
              <p className="mt-1 text-muted-foreground text-xs">
                {t("streamsMeta", {
                  running: s?.streams.running ?? 0,
                  failed: s?.streams.failed ?? 0,
                })}
              </p>
            </div>
            <Clapperboard className="size-6 text-primary" aria-hidden="true" />
          </FramePanel>
        </Frame>

        <Frame>
          <FrameHeader>
            <FrameTitle className="flex items-center gap-2">
              <HardDrive className="size-4 text-muted-foreground" />
              {t("storage")}
            </FrameTitle>
          </FrameHeader>
          <FramePanel className="flex items-center justify-between p-5">
            <div>
              <p className="font-bold text-3xl tracking-tight">
                {formatBytes(s?.storage.cacheBytes ?? 0)}
              </p>
              <p className="mt-1 text-muted-foreground text-xs">
                {t("storageMeta", {
                  sources: s?.sources.total ?? 0,
                  targets: s?.targets.total ?? 0,
                })}
              </p>
            </div>
            <HardDrive className="size-6 text-primary" aria-hidden="true" />
          </FramePanel>
        </Frame>
      </section>

      <section className="grid gap-5 sm:grid-cols-3">
        {[
          { key: "today", label: t("uploadToday"), value: b?.today },
          { key: "month", label: t("uploadMonth"), value: b?.thisMonth },
          { key: "allTime", label: t("uploadAllTime"), value: b?.allTime },
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
    </AdminShell>
  );
}
