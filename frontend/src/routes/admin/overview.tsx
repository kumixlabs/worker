import { useQuery } from "@tanstack/react-query";
import { Activity, CircleAlertIcon, HardDrive, Users } from "lucide-react";
import { useTranslations } from "use-intl";

import { Alert, AlertTitle } from "@kumix/ui/reui/alert";
import { Frame, FrameHeader, FramePanel, FrameTitle } from "@kumix/ui/reui/frame";
import { AdminShell } from "@/components/AdminShell";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/format";
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
    queryKey: ["stats"],
    queryFn: ({ signal }: { signal?: AbortSignal }) => api.stats({ signal }),
  });
  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => (await api.getAdminUsers()) as AdminUserRow[],
  });

  const s = stats.data as WorkerStats | undefined;
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
      <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
              <HardDrive className="size-4 text-muted-foreground" />
              {t("storage")}
            </FrameTitle>
          </FrameHeader>
          <FramePanel className="flex items-center justify-between p-5">
            <div>
              <p className="font-bold text-3xl tracking-tight">
                {formatBytes(s?.storage.cacheBytes ?? 0)}
              </p>
              {s?.storage.disk ? (
                <p className="mt-1 text-muted-foreground text-xs">
                  {t("storageMeta", { percent: s.storage.disk.usedPercent })}
                </p>
              ) : null}
            </div>
            <HardDrive className="size-6 text-primary" aria-hidden="true" />
          </FramePanel>
        </Frame>

        <Frame>
          <FrameHeader>
            <FrameTitle className="flex items-center gap-2">
              <Activity className="size-4 text-muted-foreground" />
              {t("uptime")}
            </FrameTitle>
          </FrameHeader>
          <FramePanel className="flex items-center justify-between p-5">
            <div>
              <p className="font-bold text-3xl tracking-tight">
                {Math.floor((s?.system.uptimeSec ?? 0) / 3600)}h
              </p>
              <p className="mt-1 text-muted-foreground text-xs">
                {t("uptimeMeta", { pid: s?.system.pid ?? 0 })}
              </p>
            </div>
            <Activity className="size-6 text-primary" aria-hidden="true" />
          </FramePanel>
        </Frame>
      </section>
    </AdminShell>
  );
}
