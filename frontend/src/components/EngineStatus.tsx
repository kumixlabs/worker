import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, XCircle } from "lucide-react";
import { useTranslations } from "use-intl";

import { Badge, Tooltip, TooltipContent, TooltipTrigger } from "@kumix/ui";
import { api } from "@/lib/api";

export function EngineStatus() {
  const t = useTranslations("Engine");
  const healthQuery = useQuery({
    queryKey: ["health-details"],
    queryFn: api.healthDetails,
    refetchInterval: 30_000,
  });
  const health = healthQuery.data;
  const ready = Boolean(health?.ffmpeg.available && health.ffprobe.available);
  const Icon = ready ? CheckCircle2 : XCircle;
  const label = ready ? t("ready") : t("missing");
  const tooltip = ready
    ? t("readyTooltip", {
        ffmpeg: health?.ffmpeg.version.split("\n")[0] ?? "FFmpeg",
        ffprobe: health?.ffprobe.version.split("\n")[0] ?? "FFprobe",
      })
    : t("missingTooltip");

  if (healthQuery.isLoading) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant={ready ? "outline" : "destructive"}
          shape="circle"
          className="gap-1 px-2 py-0.5 font-normal text-xs"
        >
          <Icon className={ready ? "size-3 text-green-500" : "size-3"} />
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-sm">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
