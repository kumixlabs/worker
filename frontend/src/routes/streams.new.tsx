import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Calendar, PlayCircle, Radio } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslations } from "use-intl";

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@kumix/ui";
import { AlertError, AlertSuccess } from "@/components/Alert";
import { AppShell } from "@/components/AppShell";
import { DateTimePicker, toLocalInput } from "@/components/DateTimePicker";
import { api, queryClient } from "@/lib/api";

function toSchedule(value: string) {
  return value ? value : null;
}

function durationStopAt(startAt: string, hours: string, minutes: string) {
  const totalMinutes = Number(hours || 0) * 60 + Number(minutes || 0);
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return null;
  const base = startAt ? new Date(startAt) : new Date();
  return toLocalInput(new Date(base.getTime() + totalMinutes * 60_000));
}

const WEEKDAYS = [
  { value: 0, key: "sun" },
  { value: 1, key: "mon" },
  { value: 2, key: "tue" },
  { value: 3, key: "wed" },
  { value: 4, key: "thu" },
  { value: 5, key: "fri" },
  { value: 6, key: "sat" },
] as const;

export function NewStreamPage() {
  const t = useTranslations("CreateTask");
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [startAt, setStartAt] = useState("");
  const [stopMode, setStopMode] = useState<"none" | "duration" | "datetime">("none");
  const [stopAt, setStopAt] = useState("");
  const [durationHours, setDurationHours] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [recurrence, setRecurrence] = useState<"none" | "daily" | "weekly" | "monthly">("none");
  const [recurrenceTime, setRecurrenceTime] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const sourcesQuery = useQuery({ queryKey: ["sources"], queryFn: api.sources });
  const targetsQuery = useQuery({ queryKey: ["targets"], queryFn: api.targets });
  const effectiveStopAt =
    stopMode === "datetime"
      ? stopAt
      : stopMode === "duration"
        ? durationStopAt(startAt, durationHours, durationMinutes)
        : null;
  const createStream = useMutation({
    mutationFn: () =>
      api.createStream({
        title,
        sourceId,
        targetId,
        scheduledFor: toSchedule(
          startAt || (recurrence !== "none" ? toLocalInput(new Date()) : ""),
        ),
        autoStopAt: effectiveStopAt,
        recurrence,
        recurrenceRule:
          recurrence === "daily" || recurrence === "monthly"
            ? { time: recurrenceTime || undefined }
            : recurrence === "weekly"
              ? { time: recurrenceTime || undefined, weekdays }
              : null,
      }),
    onSuccess: (stream) => {
      AlertSuccess({ message: t("streamCreated") });
      const refresh = async () => {
        await queryClient.invalidateQueries({ queryKey: ["streams"] });
        await queryClient.invalidateQueries({ queryKey: ["stats"] });
      };
      if (!stream.scheduledFor) {
        api.startStream(stream.id).then(
          () => refresh().then(() => navigate("/streams")),
          (error) => {
            AlertError({ message: error.message });
            refresh().then(() => navigate("/streams"));
          },
        );
      } else {
        refresh().then(() => navigate("/streams"));
      }
    },
    onError: (error) => AlertError({ message: error.message }),
  });
  const sources = sourcesQuery.data ?? [];
  const targets = targetsQuery.data ?? [];
  const hasValidStop = stopMode !== "duration" || Boolean(effectiveStopAt);
  const hasValidWeekdays = recurrence !== "weekly" || weekdays.length > 0;
  const canSubmit = title && sourceId && targetId && hasValidStop && hasValidWeekdays;

  return (
    <AppShell title={t("title")} description={t("description")}>
      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Radio className="h-4 w-4" />
              {t("details")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("titleLabel")}</span>
              <Input
                value={title}
                placeholder={t("titlePlaceholder")}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("sourceLabel")}</span>
              <Select value={sourceId} onValueChange={setSourceId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("selectSource")} />
                </SelectTrigger>
                <SelectContent>
                  {sources
                    .filter((source) => source.status === "ready")
                    .map((source) => (
                      <SelectItem key={source.id} value={source.id}>
                        {source.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("targetLabel")}</span>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("selectTarget")} />
                </SelectTrigger>
                <SelectContent>
                  {targets
                    .filter((target) => target.active)
                    .map((target) => (
                      <SelectItem key={target.id} value={target.id}>
                        {target.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </label>
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              {t("scheduleTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("startAt")}</span>
              <DateTimePicker
                value={startAt}
                onChange={setStartAt}
                min={toLocalInput(new Date())}
                placeholder={t("startAt")}
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("stopMode")}</span>
              <Select
                value={stopMode}
                onValueChange={(value) => {
                  const next = value as "none" | "duration" | "datetime";
                  setStopMode(next);
                  if (next === "none") setRecurrence("none");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("stopNone")}</SelectItem>
                  <SelectItem value="duration">{t("stopDuration")}</SelectItem>
                  <SelectItem value="datetime">{t("stopDateTime")}</SelectItem>
                </SelectContent>
              </Select>
            </label>
            {stopMode === "duration" ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">{t("durationHours")}</span>
                  <Input
                    type="number"
                    min={0}
                    value={durationHours}
                    onChange={(event) => setDurationHours(event.target.value)}
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">{t("durationMinutes")}</span>
                  <Input
                    type="number"
                    min={0}
                    max={59}
                    value={durationMinutes}
                    onChange={(event) => setDurationMinutes(event.target.value)}
                  />
                </label>
              </div>
            ) : null}
            {stopMode === "datetime" ? (
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">{t("stopAt")}</span>
                <DateTimePicker
                  value={stopAt}
                  onChange={setStopAt}
                  min={startAt || toLocalInput(new Date())}
                  placeholder={t("stopAt")}
                />
              </label>
            ) : null}
            {stopMode !== "none" ? (
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">{t("recurrence")}</span>
                <Select
                  value={recurrence}
                  onValueChange={(value) =>
                    setRecurrence(value as "none" | "daily" | "weekly" | "monthly")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("manual")}</SelectItem>
                    <SelectItem value="daily">{t("daily")}</SelectItem>
                    <SelectItem value="weekly">{t("weekly")}</SelectItem>
                    <SelectItem value="monthly">{t("monthly")}</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            ) : null}
            {stopMode !== "none" && recurrence !== "none" ? (
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">{t("recurrenceTime")}</span>
                <Input
                  type="time"
                  value={recurrenceTime}
                  onChange={(event) => setRecurrenceTime(event.target.value)}
                />
              </label>
            ) : null}
            {recurrence === "weekly" ? (
              <div className="grid gap-1.5 text-sm">
                <span className="font-medium">{t("weekdays")}</span>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((day) => (
                    <Button
                      key={day.value}
                      type="button"
                      size="sm"
                      variant={weekdays.includes(day.value) ? "primary" : "outline"}
                      onClick={() =>
                        setWeekdays((current) =>
                          current.includes(day.value)
                            ? current.filter((value) => value !== day.value)
                            : [...current, day.value],
                        )
                      }
                    >
                      {t(`weekday.${day.key}`)}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
            <Button
              className="w-full"
              disabled={!canSubmit || createStream.isPending}
              onClick={() => createStream.mutate()}
            >
              <PlayCircle />
              {t("submit")}
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
