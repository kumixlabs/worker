import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Calendar, PlayCircle, Radio } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslations } from "use-intl";

import { toastError, toastSuccess } from "@kumix/ui/custom/toast";
import { WheelPicker } from "@kumix/ui/motion/wheel-picker";
import { Frame, FrameHeader, FramePanel, FrameTitle } from "@kumix/ui/reui/frame";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "@kumix/ui/reui/number-field";
import { Button } from "@kumix/ui/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@kumix/ui/ui/combobox";
import { Input } from "@kumix/ui/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@kumix/ui/ui/select";
import { AppShell } from "@/components/AppShell";
import { DateTimePicker, toWallClockInput } from "@/components/DateTimePicker";
import { api, queryClient } from "@/lib/api";

type SourceOption = { id: string; name: string };
type TargetOption = { id: string; label: string };

function toSchedule(value: string) {
  return value ? value : null;
}

const HOUR_WHEEL_OPTIONS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTE_WHEEL_OPTIONS = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

function durationStopAt(startAt: string, hours: string, minutes: string, timeZone?: string) {
  const totalMinutes = Number(hours || 0) * 60 + Number(minutes || 0);
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return null;
  const match = startAt.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (match) {
    // startAt is wall-clock in worker TZ; add duration as minutes on the clock
    // fields so browser local TZ never skews auto-stop.
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const total = hour * 60 + minute + totalMinutes;
    const endDayOffset = Math.floor(total / (24 * 60));
    const endMinuteOfDay = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
    const endHour = Math.floor(endMinuteOfDay / 60);
    const endMinute = endMinuteOfDay % 60;
    // UTC date math for calendar day roll only (not absolute time).
    const endDate = new Date(Date.UTC(year, month - 1, day + endDayOffset));
    const y = endDate.getUTCFullYear();
    const m = String(endDate.getUTCMonth() + 1).padStart(2, "0");
    const d = String(endDate.getUTCDate()).padStart(2, "0");
    const hh = String(endHour).padStart(2, "0");
    const mm = String(endMinute).padStart(2, "0");
    return `${y}-${m}-${d}T${hh}:${mm}`;
  }
  return toWallClockInput(new Date(Date.now() + totalMinutes * 60_000), timeZone);
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
  const common = useTranslations("Common");
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [youtubeLiveUrl, setYoutubeLiveUrl] = useState("");
  const [startAt, setStartAt] = useState("");
  const [stopMode, setStopMode] = useState<"none" | "duration" | "datetime">("none");
  const [stopAt, setStopAt] = useState("");
  const [durationHours, setDurationHours] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [recurrence, setRecurrence] = useState<"none" | "daily" | "weekly" | "monthly">("none");
  const [recurrenceTime, setRecurrenceTime] = useState("00:00");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const sourcesQuery = useQuery({ queryKey: ["sources"], queryFn: api.sources });
  const targetsQuery = useQuery({ queryKey: ["targets"], queryFn: api.targets });
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const workerTimezone = settingsQuery.data?.timezone;
  const nowWallClock = () => toWallClockInput(new Date(), workerTimezone);
  const effectiveStopAt =
    stopMode === "datetime"
      ? stopAt
      : stopMode === "duration"
        ? durationStopAt(startAt, durationHours, durationMinutes, workerTimezone)
        : null;
  const createStream = useMutation({
    mutationFn: () =>
      api.createStream({
        title: title.trim(),
        sourceId,
        targetId,
        youtubeLiveUrl: youtubeLiveUrl || null,
        scheduledFor: toSchedule(startAt || (recurrence !== "none" ? nowWallClock() : "")),
        autoStopAt: effectiveStopAt,
        recurrence,
        recurrenceRule:
          recurrence === "daily"
            ? { time: recurrenceTime || undefined }
            : recurrence === "monthly"
              ? {
                  time: recurrenceTime || undefined,
                  day: Number((startAt || nowWallClock()).slice(8, 10)) || undefined,
                }
              : recurrence === "weekly"
                ? { time: recurrenceTime || undefined, weekdays }
                : null,
      }),
    onSuccess: (stream) => {
      toastSuccess({ message: t("streamCreated") });
      const refresh = async () => {
        await queryClient.invalidateQueries({ queryKey: ["streams"] });
        await queryClient.invalidateQueries({ queryKey: ["stats"] });
      };
      if (!stream.scheduledFor) {
        api.startStream(stream.id).then(
          () => refresh().then(() => navigate("/streams")),
          (error) => {
            toastError({ message: error.message });
            refresh().then(() => navigate("/streams"));
          },
        );
      } else {
        refresh().then(() => navigate("/streams"));
      }
    },
    onError: (error) => toastError({ message: error.message }),
  });
  const readySources: SourceOption[] = (sourcesQuery.data ?? [])
    .filter((source) => source.status === "ready")
    .map((source) => ({ id: source.id, name: source.name }));
  const activeTargets: TargetOption[] = (targetsQuery.data ?? [])
    .filter((target) => target.active)
    .map((target) => ({ id: target.id, label: target.label }));
  const selectedSource = readySources.find((source) => source.id === sourceId) ?? null;
  const selectedTarget = activeTargets.find((target) => target.id === targetId) ?? null;
  const hasValidStop = stopMode !== "duration" || Boolean(effectiveStopAt);
  const hasValidWeekdays = recurrence !== "weekly" || weekdays.length > 0;
  const missingFields = [
    !title.trim() && t("titleLabel"),
    !sourceId && t("sourceLabel"),
    !targetId && t("targetLabel"),
    !hasValidStop && t("stopMode"),
    !hasValidWeekdays && t("weekdays"),
  ].filter((field): field is string => Boolean(field));
  const canSubmit = missingFields.length === 0;
  const queryError = sourcesQuery.isError || targetsQuery.isError ? common("loadError") : null;

  if (queryError) {
    return (
      <AppShell title={t("title")} description={t("description")}>
        <Frame>
          <FramePanel className="py-6">
            <p className="text-destructive text-sm">{queryError}</p>
          </FramePanel>
        </Frame>
      </AppShell>
    );
  }

  return (
    <AppShell title={t("title")} description={t("description")}>
      <div className="grid gap-6 xl:grid-cols-5">
        <Frame className="xl:col-span-3">
          <FrameHeader>
            <FrameTitle className="flex items-center gap-2">
              <Radio className="h-4 w-4" />
              {t("details")}
            </FrameTitle>
          </FrameHeader>
          <FramePanel className="space-y-4">
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
              <Combobox
                items={readySources}
                value={selectedSource}
                onValueChange={(value) =>
                  setSourceId(value && typeof value === "object" ? value.id : "")
                }
                itemToStringLabel={(item) => item.name}
                isItemEqualToValue={(a, b) => a.id === b.id}
              >
                <ComboboxTrigger
                  render={
                    <Button variant="outline" className="w-full justify-between font-normal">
                      <ComboboxValue placeholder={t("selectSource")} />
                    </Button>
                  }
                />
                <ComboboxContent>
                  <ComboboxInput showTrigger={false} placeholder={t("searchSource")} />
                  <ComboboxEmpty>{t("emptySources")}</ComboboxEmpty>
                  <ComboboxList>
                    {(source: SourceOption) => (
                      <ComboboxItem key={source.id} value={source}>
                        {source.name}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("targetLabel")}</span>
              <Combobox
                items={activeTargets}
                value={selectedTarget}
                onValueChange={(value) =>
                  setTargetId(value && typeof value === "object" ? value.id : "")
                }
                itemToStringLabel={(item) => item.label}
                isItemEqualToValue={(a, b) => a.id === b.id}
              >
                <ComboboxTrigger
                  render={
                    <Button variant="outline" className="w-full justify-between font-normal">
                      <ComboboxValue placeholder={t("selectTarget")} />
                    </Button>
                  }
                />
                <ComboboxContent>
                  <ComboboxInput showTrigger={false} placeholder={t("searchTarget")} />
                  <ComboboxEmpty>{t("emptyTargets")}</ComboboxEmpty>
                  <ComboboxList>
                    {(target: TargetOption) => (
                      <ComboboxItem key={target.id} value={target}>
                        {target.label}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("youtubeLiveUrlLabel")}</span>
              <Input
                value={youtubeLiveUrl}
                placeholder={t("youtubeLiveUrlPlaceholder")}
                onChange={(event) => setYoutubeLiveUrl(event.target.value)}
              />
            </label>
          </FramePanel>
        </Frame>
        <Frame className="xl:col-span-2">
          <FrameHeader>
            <FrameTitle className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              {t("scheduleTitle")}
            </FrameTitle>
          </FrameHeader>
          <FramePanel className="space-y-4">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("startAt")}</span>
              <DateTimePicker
                value={startAt}
                onChange={setStartAt}
                min={nowWallClock()}
                placeholder={t("startAt")}
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("stopMode")}</span>
              <Select
                value={stopMode}
                onValueChange={(value) => {
                  setStopMode(value as "none" | "duration" | "datetime");
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(value) =>
                      value === "duration"
                        ? t("stopDuration")
                        : value === "datetime"
                          ? t("stopDateTime")
                          : t("stopNone")
                    }
                  </SelectValue>
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
                  <NumberField
                    value={Number(durationHours)}
                    min={0}
                    max={99}
                    onValueChange={(value) => setDurationHours(String(value))}
                  >
                    <NumberFieldGroup>
                      <NumberFieldInput className="text-left" />
                      <NumberFieldDecrement className="rounded-none!" />
                      <NumberFieldIncrement />
                    </NumberFieldGroup>
                  </NumberField>
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">{t("durationMinutes")}</span>
                  <NumberField
                    value={Number(durationMinutes)}
                    min={0}
                    max={59}
                    onValueChange={(value) => setDurationMinutes(String(value))}
                  >
                    <NumberFieldGroup>
                      <NumberFieldInput className="text-left" />
                      <NumberFieldDecrement className="rounded-none!" />
                      <NumberFieldIncrement />
                    </NumberFieldGroup>
                  </NumberField>
                </label>
              </div>
            ) : null}
            {stopMode === "datetime" ? (
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">{t("stopAt")}</span>
                <DateTimePicker
                  value={stopAt}
                  onChange={setStopAt}
                  min={startAt || nowWallClock()}
                  placeholder={t("stopAt")}
                />
              </label>
            ) : null}
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("recurrence")}</span>
              <Select
                value={recurrence}
                onValueChange={(value) =>
                  setRecurrence(value as "none" | "daily" | "weekly" | "monthly")
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(value) =>
                      value === "daily"
                        ? t("daily")
                        : value === "weekly"
                          ? t("weekly")
                          : value === "monthly"
                            ? t("monthly")
                            : t("manual")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("manual")}</SelectItem>
                  <SelectItem value="daily">{t("daily")}</SelectItem>
                  <SelectItem value="weekly">{t("weekly")}</SelectItem>
                  <SelectItem value="monthly">{t("monthly")}</SelectItem>
                </SelectContent>
              </Select>
            </label>
            {recurrence !== "none" ? (
              <div className="grid gap-1.5 text-sm">
                <span className="font-medium">{t("recurrenceTime")}</span>
                <div className="flex items-stretch gap-1 rounded-3xl border border-border bg-background p-2">
                  <WheelPicker
                    options={HOUR_WHEEL_OPTIONS}
                    value={recurrenceTime.slice(0, 2)}
                    onValueChange={(hour) =>
                      setRecurrenceTime(`${hour}:${recurrenceTime.slice(3, 5)}`)
                    }
                    className="flex-1 border-0 bg-transparent"
                    visibleCount={7}
                    itemHeight={42}
                    aria-label={t("hour")}
                  />
                  <WheelPicker
                    options={MINUTE_WHEEL_OPTIONS}
                    value={recurrenceTime.slice(3, 5)}
                    onValueChange={(minute) =>
                      setRecurrenceTime(`${recurrenceTime.slice(0, 2)}:${minute}`)
                    }
                    className="flex-1 border-0 bg-transparent"
                    visibleCount={7}
                    itemHeight={42}
                    aria-label={t("minute")}
                  />
                </div>
              </div>
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
                      variant={weekdays.includes(day.value) ? "default" : "outline"}
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
            {missingFields.length > 0 ? (
              <p className="text-muted-foreground text-xs">
                {t("missingFields")}: {missingFields.join(", ")}
              </p>
            ) : null}
          </FramePanel>
        </Frame>
      </div>
    </AppShell>
  );
}
