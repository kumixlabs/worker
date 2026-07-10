import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Clock, HardDrive, Save } from "lucide-react";
import { useTranslations } from "use-intl";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@kumix/ui";
import { AlertError, AlertSuccess } from "@/components/Alert";
import { AppShell } from "@/components/AppShell";
import { api, queryClient } from "@/lib/api";

function supportedTimezones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  try {
    return intl.supportedValuesOf?.("timeZone") ?? ["UTC", "Asia/Jakarta"];
  } catch {
    return ["UTC", "Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"];
  }
}

export function SettingsPage() {
  const t = useTranslations("Settings");
  const common = useTranslations("Common");
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const [timezone, setTimezone] = useState("");
  const [diskLimit, setDiskLimit] = useState("");
  const [timezoneOpen, setTimezoneOpen] = useState(false);
  const timezones = useMemo(supportedTimezones, []);

  const updateSettings = useMutation({
    mutationFn: () => api.patchSettings({ timezone, diskUsageLimitPercent: Number(diskLimit) }),
    onSuccess: () => {
      AlertSuccess({ message: t("saved") });
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error) => AlertError({ message: error.message }),
  });

  useEffect(() => {
    if (!settingsQuery.data) return;
    setTimezone(settingsQuery.data.timezone);
    setDiskLimit(String(settingsQuery.data.diskUsageLimitPercent));
  }, [settingsQuery.data]);

  const diskValue = Number(diskLimit);
  const diskInvalid = !Number.isInteger(diskValue) || diskValue < 50 || diskValue > 99;
  const canSave = Boolean(timezone) && !diskInvalid && !updateSettings.isPending;

  return (
    <AppShell title={t("title")} description={t("description")}>
      <div className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader className="min-h-0 flex-col items-start py-4">
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                {t("timezone")}
              </CardTitle>
              <CardDescription>{t("timezoneDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <span className="mb-2 block font-medium text-sm">{t("timezoneLabel")}</span>
              <Popover open={timezoneOpen} onOpenChange={setTimezoneOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    <span className="truncate">{timezone || t("selectTimezone")}</span>
                    <ChevronsUpDown className="h-4 w-4 opacity-60" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder={t("searchTimezone")} />
                    <CommandList>
                      <CommandEmpty>{t("noTimezone")}</CommandEmpty>
                      <CommandGroup>
                        {timezones.map((zone) => (
                          <CommandItem
                            key={zone}
                            value={zone}
                            onSelect={() => {
                              setTimezone(zone);
                              setTimezoneOpen(false);
                            }}
                          >
                            <span className="truncate">{zone}</span>
                            {timezone === zone ? (
                              <Check className="ms-auto h-4 w-4 text-primary" />
                            ) : null}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="min-h-0 flex-col items-start py-4">
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="h-4 w-4" />
                {t("diskLimit")}
              </CardTitle>
              <CardDescription>{t("diskLimitDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <span className="mb-2 block font-medium text-sm">{t("diskLimitLabel")}</span>
              <Input
                type="number"
                min={50}
                max={99}
                value={diskLimit}
                placeholder="90"
                onChange={(event) => setDiskLimit(event.target.value)}
              />
              {diskInvalid && diskLimit !== "" ? (
                <p className="text-destructive text-xs">{t("diskLimitInvalid")}</p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end">
          <Button disabled={!canSave} onClick={() => updateSettings.mutate()}>
            <Save />
            {common("save")}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
