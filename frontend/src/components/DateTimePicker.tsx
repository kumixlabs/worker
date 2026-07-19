import { Calendar as CalendarIcon, Clock, X } from "lucide-react";
import { useTranslations } from "use-intl";

import {
  Button,
  Calendar,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@kumix/ui";
import { cn } from "@kumix/utils";

const DEFAULT_TIME = "00:00";
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, index) => pad(index));
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, index) => pad(index));

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Formats an absolute Date as wall-clock `YYYY-MM-DDTHH:MM` in a timezone.
 * Worker APIs interpret that string in the worker settings timezone.
 */
export function toWallClockInput(date: Date, timeZone?: string): string {
  if (!timeZone) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
      date.getHours(),
    )}:${pad(date.getMinutes())}`;
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}

/** @deprecated Prefer toWallClockInput(date, workerTimezone) */
export function toLocalInput(date: Date): string {
  return toWallClockInput(date);
}

function wallClockToDate(value: string): Date | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  const [, year, month, day, hour, minute] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), 0, 0);
}

function withDate(value: string, date: Date): string {
  const time = value.slice(11, 16) || DEFAULT_TIME;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${time}`;
}

function withTime(value: string, time: string): string {
  const current = wallClockToDate(value) ?? new Date();
  return `${current.getFullYear()}-${pad(current.getMonth() + 1)}-${pad(
    current.getDate(),
  )}T${time || DEFAULT_TIME}`;
}

function formatValue(value: string, emptyLabel: string): string {
  const date = wallClockToDate(value);
  if (!date) return emptyLabel;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/**
 * Wall-clock date and time picker. Emits `YYYY-MM-DDTHH:MM` (no offset).
 * The worker parses that string in its configured timezone.
 */
export function DateTimePicker({
  value,
  onChange,
  disabled,
  placeholder,
  min,
  max,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  min?: string;
  max?: string;
}) {
  const t = useTranslations("Common");
  const resolvedPlaceholder = placeholder ?? t("pickDateTime");
  const selected = wallClockToDate(value);
  const minDate = wallClockToDate(min ?? "");
  const maxDate = wallClockToDate(max ?? "");
  const isDateDisabled = (date: Date) => {
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const minDay = minDate
      ? new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate()).getTime()
      : null;
    const maxDay = maxDate
      ? new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate()).getTime()
      : null;
    return (minDay !== null && day < minDay) || (maxDay !== null && day > maxDay);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <div className="relative">
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "w-full justify-start gap-2 font-normal",
              !value && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="size-4" />
            <span className="truncate">{formatValue(value, resolvedPlaceholder)}</span>
          </Button>
          {value ? (
            <Button
              type="button"
              mode="icon"
              variant="ghost"
              size="sm"
              className="absolute inset-e-1 top-1/2 -translate-y-1/2"
              aria-label={t("clearDate")}
              disabled={disabled}
              onClick={(event) => {
                event.preventDefault();
                onChange("");
              }}
            >
              <X className="size-4" />
            </Button>
          ) : null}
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-auto space-y-3 p-3" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => {
            if (date) onChange(withDate(value, date));
          }}
          disabled={isDateDisabled}
          autoFocus
        />
        <div className="flex items-center gap-2 border-border border-t pt-3">
          <Clock className="size-4 shrink-0 text-muted-foreground" />
          <Select
            value={value.slice(11, 13) || "00"}
            onValueChange={(hour) =>
              onChange(withTime(value, `${hour}:${value.slice(14, 16) || "00"}`))
            }
            disabled={disabled}
          >
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              {HOUR_OPTIONS.map((hour) => (
                <SelectItem key={hour} value={hour}>
                  {hour}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="font-medium text-muted-foreground">:</span>
          <Select
            value={value.slice(14, 16) || "00"}
            onValueChange={(minute) =>
              onChange(withTime(value, `${value.slice(11, 13) || "00"}:${minute}`))
            }
            disabled={disabled}
          >
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              {MINUTE_OPTIONS.map((minute) => (
                <SelectItem key={minute} value={minute}>
                  {minute}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </PopoverContent>
    </Popover>
  );
}
