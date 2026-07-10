import { useTranslations } from "use-intl";

import { Badge } from "@kumix/ui";

const variantByKind: Record<
  string,
  "success" | "destructive" | "warning" | "primary" | "secondary"
> = {
  failed: "destructive",
  source_download_failed: "destructive",
  info: "primary",
  pending: "warning",
  running: "success",
  stopped: "secondary",
  stopping: "warning",
  system: "secondary",
  token_rotated: "warning",
};

const knownKinds = new Set([
  "running",
  "stopping",
  "stopped",
  "failed",
  "pending",
  "token_rotated",
  "source_download_failed",
  "system",
  "info",
]);

export function EventKindBadge({ kind, className }: { kind: string; className?: string }) {
  const t = useTranslations("Common.eventKinds");
  return (
    <Badge variant={variantByKind[kind] ?? "primary"} appearance="light" className={className}>
      {knownKinds.has(kind) ? t(kind as never) : kind}
    </Badge>
  );
}
