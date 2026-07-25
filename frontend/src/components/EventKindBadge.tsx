import { useTranslations } from "use-intl";

import { Badge } from "@kumix/ui/reui/badge";

const variantByKind: Record<
  string,
  "success" | "destructive" | "warning" | "default" | "secondary"
> = {
  failed: "destructive",
  source_download_failed: "destructive",
  restart_failed: "destructive",
  info: "default",
  pending: "warning",
  running: "success",
  stopped: "secondary",
  stopping: "warning",
  system: "secondary",
  token_rotated: "warning",
  restart_scheduled: "warning",
  reconciled: "secondary",
};

export const knownEventKinds = new Set([
  "running",
  "stopping",
  "stopped",
  "failed",
  "pending",
  "token_rotated",
  "source_download_failed",
  "system",
  "info",
  "restart_scheduled",
  "restart_failed",
  "reconciled",
]);

export function EventKindBadge({ kind, className }: { kind: string; className?: string }) {
  const t = useTranslations("Common.eventKinds");
  return (
    <Badge variant={variantByKind[kind] ?? "default"} className={className}>
      {knownEventKinds.has(kind) ? t(kind as never) : kind}
    </Badge>
  );
}
