import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, XCircle } from "lucide-react";
import { useTranslations } from "use-intl";

import { Badge } from "@kumix/ui/reui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kumix/ui/ui/tooltip";
import { api } from "@/lib/api";

export function EngineStatus() {
  const t = useTranslations("Engine");
  const healthQuery = useQuery({
    queryKey: ["health-details"],
    queryFn: api.healthDetails,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const isLoading = healthQuery.isLoading;
  const isError = healthQuery.isError;
  const health = healthQuery.data;
  const ready = Boolean(health?.ffmpeg.available && health.ffprobe.available);
  const Icon = ready ? CheckCircle2 : XCircle;
  const label = isError ? t("unknown") : ready ? t("ready") : t("missing");
  const tooltip = isError
    ? t("unknownTooltip")
    : ready
      ? t("readyTooltip", {
          ffmpeg: health?.ffmpeg.version.split("\n")[0] ?? "FFmpeg",
          ffprobe: health?.ffprobe.version.split("\n")[0] ?? "FFprobe",
        })
      : t("missingTooltip");

  if (isLoading) return null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant={isError ? "outline" : ready ? "outline" : "destructive"}
            className="gap-1 rounded-full px-2 py-0.5 font-normal text-xs"
          />
        }
      >
        <Icon className={ready ? "size-3 text-green-500" : "size-3"} />
        {label}
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-sm">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
