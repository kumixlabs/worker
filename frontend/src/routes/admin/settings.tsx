import { Construction } from "lucide-react";
import { useTranslations } from "use-intl";

import { Frame, FramePanel } from "@kumix/ui/reui/frame";
import { AdminShell } from "@/components/AdminShell";

export function AdminSettingsPage() {
  const t = useTranslations("AdminSettings");

  return (
    <AdminShell title={t("title")} description={t("description")}>
      <Frame className="border-dashed">
        <FramePanel className="flex flex-col items-center justify-center gap-2 p-10 text-center">
          <Construction className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium text-sm">{t("comingSoonTitle")}</p>
          <p className="max-w-md text-muted-foreground text-sm">{t("comingSoonBody")}</p>
        </FramePanel>
      </Frame>
    </AdminShell>
  );
}
