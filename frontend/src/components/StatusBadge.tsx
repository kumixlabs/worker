import { useTranslations } from "use-intl";

import { Badge, type BadgeProps } from "@kumix/ui/reui/badge";

const variantByStatus: Record<string, NonNullable<BadgeProps["variant"]>> = {
  active: "success-light",
  ready: "success-light",
  running: "success-light",
  pending: "warning-light",
  downloading: "warning-light",
  probing: "warning-light",
  normalizing: "warning-light",
  stopping: "warning-light",
  failed: "destructive-light",
  invalid: "destructive-light",
  disabled: "secondary",
  stopped: "secondary",
};

const knownStatuses = new Set(Object.keys(variantByStatus));

export function StatusBadge({ status }: { status: string }) {
  const t = useTranslations("Common.statuses");
  return (
    <Badge variant={variantByStatus[status] ?? "default"}>
      {knownStatuses.has(status) ? t(status as never) : status}
    </Badge>
  );
}
