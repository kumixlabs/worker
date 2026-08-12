import { useEffect, useRef } from "react";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { useTranslations } from "use-intl";

import { Button } from "@kumix/ui/ui/button";
import { Calendar } from "@kumix/ui/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@kumix/ui/ui/popover";
import { ScrollArea } from "@kumix/ui/ui/scroll-area";
import { cn } from "@kumix/utils";

const DEFAULT_TIME = "00:00";
const TIME_SLOTS = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4);
  const m = (i % 4) * 15;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});

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

function formatDateLabel(date: Date | undefined): string {
  if (!date) return "\u00A0";
  return new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric" }).format(date);
}

function slotMinutes(slot: string): number {
  return Number(slot.slice(0, 2)) * 60 + Number(slot.slice(3, 5));
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
  const selectedTime = value.slice(11, 16) || DEFAULT_TIME;
  const slotContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = slotContainerRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-slot="${selectedTime}"]`);
    el?.scrollIntoView({ block: "center" });
  }, [selectedTime]);

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

  const isTimeDisabled = (slot: string) => {
    if (disabled) return true;
    if (!selected) return false;
    const m = slotMinutes(slot);
    const selDay = new Date(
      selected.getFullYear(),
      selected.getMonth(),
      selected.getDate(),
    ).getTime();
    if (minDate) {
      const minDay = new Date(
        minDate.getFullYear(),
        minDate.getMonth(),
        minDate.getDate(),
      ).getTime();
      if (selDay === minDay && m < minDate.getHours() * 60 + minDate.getMinutes()) return true;
    }
    if (maxDate) {
      const maxDay = new Date(
        maxDate.getFullYear(),
        maxDate.getMonth(),
        maxDate.getDate(),
      ).getTime();
      if (selDay === maxDay && m > maxDate.getHours() * 60 + maxDate.getMinutes()) return true;
    }
    return false;
  };

  return (
    <div className="relative">
      <Popover>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              className={cn(
                "w-full justify-start gap-2 font-normal",
                !value && "text-muted-foreground",
                value && "pe-9",
              )}
            />
          }
        >
          <CalendarIcon className="size-4" />
          <span className="truncate">{formatValue(value, resolvedPlaceholder)}</span>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <div className="flex max-sm:flex-col">
            <Calendar
              mode="single"
              selected={selected}
              onSelect={(date: Date | undefined) => {
                if (date) onChange(withDate(value, date));
              }}
              disabled={isDateDisabled}
              autoFocus
            />
            <div className="relative w-full max-sm:h-48 sm:w-44">
              <div className="absolute inset-0 py-4 max-sm:border-t">
                <ScrollArea className="h-full sm:border-s">
                  <div className="space-y-3">
                    <div className="flex h-5 shrink-0 items-center px-4">
                      <p className="font-medium text-sm">{formatDateLabel(selected)}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-1 px-4" ref={slotContainerRef}>
                      {TIME_SLOTS.map((slot) => (
                        <Button
                          className="w-full"
                          data-slot={slot}
                          disabled={isTimeDisabled(slot)}
                          key={slot}
                          onClick={() => onChange(withTime(value, slot))}
                          size="sm"
                          variant={selectedTime === slot ? "default" : "outline"}
                        >
                          {slot}
                        </Button>
                      ))}
                    </div>
                  </div>
                </ScrollArea>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute inset-e-1 top-1/2 z-10 -translate-y-1/2"
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
  );
}
