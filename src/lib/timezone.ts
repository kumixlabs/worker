/**
 * Timezone-aware date parsing and scheduling helpers.
 */

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/**
 * Extracts calendar parts for a date in a target timezone.
 *
 * @param date - The absolute date to read.
 * @param timezone - The IANA timezone.
 * @returns Calendar parts in the target timezone.
 */
export function zonedParts(date: Date, timezone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    day: value("day"),
    hour: value("hour") % 24,
    minute: value("minute"),
    month: value("month"),
    second: value("second"),
    year: value("year"),
  };
}

/**
 * Converts timezone calendar parts into an absolute UTC date.
 *
 * @param parts - Calendar parts in the target timezone.
 * @param timezone - The IANA timezone.
 * @returns Absolute date matching the timezone wall-clock time.
 */
export function fromZonedParts(parts: ZonedParts, timezone: string): Date {
  const utcGuess = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second),
  );
  const actual = zonedParts(utcGuess, timezone);
  const actualUtc = Date.UTC(
    actual.year,
    actual.month - 1,
    actual.day,
    actual.hour,
    actual.minute,
    actual.second,
  );
  const targetUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return new Date(utcGuess.getTime() + targetUtc - actualUtc);
}

/**
 * Reads weekday in a target timezone using JavaScript's 0-6 Sunday-first convention.
 *
 * @param date - The absolute date to read.
 * @param timezone - The IANA timezone.
 * @returns Weekday number from 0 Sunday to 6 Saturday.
 */
export function zonedWeekday(date: Date, timezone: string): number {
  const parts = zonedParts(date, timezone);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

/**
 * Parses a user-provided datetime using the configured timezone when no explicit offset exists.
 *
 * @param value - Raw datetime value from API input.
 * @param timezone - The IANA timezone selected by the user.
 * @returns ISO UTC timestamp or null.
 */
export function parseUserDateTime(
  value: string | null | undefined,
  timezone: string,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  const toIso = (date: Date): string | null =>
    Number.isFinite(date.getTime()) ? date.toISOString() : null;
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(value)) return toIso(new Date(value));

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return null;

  const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
  const numbers = [year, month, day, hour, minute, second].map(Number);
  const [yearNumber, monthNumber, dayNumber, hourNumber, minuteNumber, secondNumber] = numbers;
  const candidate = new Date(
    Date.UTC(yearNumber, monthNumber - 1, dayNumber, hourNumber, minuteNumber, secondNumber),
  );
  if (
    candidate.getUTCFullYear() !== yearNumber ||
    candidate.getUTCMonth() !== monthNumber - 1 ||
    candidate.getUTCDate() !== dayNumber ||
    candidate.getUTCHours() !== hourNumber ||
    candidate.getUTCMinutes() !== minuteNumber ||
    candidate.getUTCSeconds() !== secondNumber
  )
    return null;
  return fromZonedParts(
    {
      day: dayNumber,
      hour: hourNumber,
      minute: minuteNumber,
      month: monthNumber,
      second: secondNumber,
      year: yearNumber,
    },
    timezone,
  ).toISOString();
}
