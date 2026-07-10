import { useTranslations } from "use-intl";

import { Badge } from "@kumix/ui";

const variantByStatus: Record<
  string,
  "success" | "destructive" | "warning" | "primary" | "secondary"
> = {
  active: "success",
  ready: "success",
  running: "success",
  pending: "warning",
  downloading: "warning",
  probing: "warning",
  stopping: "warning",
  failed: "destructive",
  invalid: "destructive",
  disabled: "secondary",
  stopped: "secondary",
};

const knownStatuses = new Set(Object.keys(variantByStatus));

export function StatusBadge({ status }: { status: string }) {
  const t = useTranslations("Common.statuses");
  return (
    <Badge variant={variantByStatus[status] ?? "primary"} appearance="light">
      {knownStatuses.has(status) ? t(status as never) : status}
    </Badge>
  );
}
