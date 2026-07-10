import { useMemo } from "react";
import { useLocale } from "use-intl";

import type { WorkerSettings } from "../../../src/types/worker";

export function useDateTimeFormatter(settings?: Pick<WorkerSettings, "timezone">) {
  const locale = useLocale();
  return useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: settings?.timezone || undefined,
      }),
    [locale, settings?.timezone],
  );
}

export function useTimeFormatter(settings?: Pick<WorkerSettings, "timezone">) {
  const locale = useLocale();
  return useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        timeStyle: "medium",
        timeZone: settings?.timezone || undefined,
      }),
    [locale, settings?.timezone],
  );
}
