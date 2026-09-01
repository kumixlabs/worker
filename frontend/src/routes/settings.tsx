import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleAlertIcon, Clock, HardDrive, Lock, MonitorSmartphone, Save, Tv } from "lucide-react";
import { useTranslations } from "use-intl";

import { toastError, toastSuccess } from "@kumix/ui/custom/toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@kumix/ui/motion/tabs";
import { Alert, AlertTitle } from "@kumix/ui/reui/alert";
import { Frame, FrameFooter, FrameHeader, FramePanel, FrameTitle } from "@kumix/ui/reui/frame";
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
import { Label } from "@kumix/ui/ui/label";
import { ActiveSessions } from "@/components/ActiveSessions";
import { AppShell } from "@/components/AppShell";
import { api, queryClient } from "@/lib/api";
import { authClient } from "@/lib/auth";

function supportedTimezones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  try {
    return intl.supportedValuesOf?.("timeZone") ?? ["UTC", "Asia/Jakarta"];
  } catch {
    return ["UTC", "Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"];
  }
}

function YoutubeClientSettings() {
  const t = useTranslations("Settings");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const clientQuery = useQuery({
    queryKey: ["youtubeClient"],
    queryFn: ({ signal }) => api.youtubeClient({ signal }),
  });
  const client = clientQuery.data;
  const saveMutation = useMutation({
    mutationFn: () =>
      api.saveYoutubeClient({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["youtubeClient"] });
      setClientId("");
      setClientSecret("");
      toastSuccess({ message: t("youtubeClientSaved") });
    },
    onError: (error: Error) => toastError({ message: error.message }),
  });
  return (
    <Frame>
      <FrameHeader>
        <FrameTitle className="flex items-center gap-2">
          <Tv className="size-4" />
          {t("youtubeTitleTab")}
        </FrameTitle>
      </FrameHeader>
      <FramePanel className="space-y-5">
        <p className="text-muted-foreground text-sm">{t("youtubeClientDescription")}</p>
        {client?.configured && (
          <p className="text-muted-foreground text-xs">
            {t("youtubeClientConfigured")}: <code>{client.clientIdMasked}</code>
          </p>
        )}
        <div className="space-y-3 rounded-lg border p-3">
          <div className="space-y-2">
            <Label htmlFor="yt-client-id">{t("youtubeClientId")}</Label>
            <Input
              id="yt-client-id"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="1234567890-abc.apps.googleusercontent.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="yt-client-secret">{t("youtubeClientSecret")}</Label>
            <Input
              id="yt-client-secret"
              type="password"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              autoComplete="off"
            />
          </div>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!clientId.trim() || !clientSecret.trim() || saveMutation.isPending}
          >
            {t("youtubeClientSave")}
          </Button>
        </div>
      </FramePanel>
    </Frame>
  );
}

export function SettingsPage() {
  const { data: session } = authClient.useSession();
  const isAdmin = session?.user?.role === "admin";
  const t = useTranslations("Settings");
  const common = useTranslations("Common");
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const [timezone, setTimezone] = useState("");
  const [diskLimit, setDiskLimit] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const timezones = useMemo(supportedTimezones, []);

  const updateSettings = useMutation({
    mutationFn: () =>
      api.patchSettings({
        timezone,
        diskUsageLimitPercent: Number(diskLimit),
      }),
    onSuccess: () => {
      toastSuccess({ message: t("saved") });
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error) => toastError({ message: error.message }),
  });

  const changePassword = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (error) throw new Error(error.message ?? t("passwordChangeError"));
    },
    onSuccess: () => {
      toastSuccess({ message: t("passwordChanged") });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (error) => toastError({ message: error.message }),
  });

  useEffect(() => {
    if (!settingsQuery.data) return;
    setTimezone(settingsQuery.data.timezone);
    setDiskLimit(String(settingsQuery.data.diskUsageLimitPercent));
  }, [settingsQuery.data]);

  const diskValue = Number(diskLimit);
  const diskInvalid = !Number.isInteger(diskValue) || diskValue < 50 || diskValue > 99;
  const canSave = Boolean(timezone) && !diskInvalid && !updateSettings.isPending;

  const canChangePassword =
    Boolean(currentPassword) &&
    newPassword.length >= 8 &&
    newPassword === confirmPassword &&
    newPassword !== currentPassword &&
    !changePassword.isPending;

  return (
    <AppShell title={t("title")} description={t("description")}>
      {settingsQuery.isError ? (
        <Frame>
          <FramePanel className="py-6">
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>{common("loadError")}</AlertTitle>
            </Alert>
          </FramePanel>
        </Frame>
      ) : (
        <Tabs defaultValue={isAdmin ? "general" : "security"} variant="pill" className="space-y-5">
          <TabsList>
            {isAdmin ? <TabsTrigger value="general">{t("tabGeneral")}</TabsTrigger> : null}
            <TabsTrigger value="youtube">{t("tabYoutube")}</TabsTrigger>
            <TabsTrigger value="security">{t("tabSecurity")}</TabsTrigger>
          </TabsList>

          {isAdmin ? (
            <TabsContent value="general" className="space-y-4">
              <Frame>
                <FrameHeader>
                  <FrameTitle className="flex items-center gap-2">
                    <Clock className="size-4" />
                    {t("timezone")}
                  </FrameTitle>
                </FrameHeader>
                <FramePanel className="space-y-2">
                  <span className="mb-2 block font-medium text-sm">{t("timezoneLabel")}</span>
                  <Combobox
                    items={timezones}
                    value={timezone}
                    onValueChange={(value) => setTimezone(typeof value === "string" ? value : "")}
                  >
                    <ComboboxTrigger
                      render={
                        <Button variant="outline" className="w-full justify-between font-normal">
                          <ComboboxValue />
                        </Button>
                      }
                    />
                    <ComboboxContent>
                      <ComboboxInput showTrigger={false} placeholder={t("searchTimezone")} />
                      <ComboboxEmpty>{t("noTimezone")}</ComboboxEmpty>
                      <ComboboxList>
                        {(zone: string) => (
                          <ComboboxItem key={zone} value={zone}>
                            {zone}
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                </FramePanel>
                <FrameFooter>
                  <p className="text-muted-foreground text-sm">{t("timezoneDescription")}</p>
                </FrameFooter>
              </Frame>

              <Frame>
                <FrameHeader>
                  <FrameTitle className="flex items-center gap-2">
                    <HardDrive className="size-4" />
                    {t("diskLimit")}
                  </FrameTitle>
                </FrameHeader>
                <FramePanel className="space-y-2">
                  <span className="mb-2 block font-medium text-sm">{t("diskLimitLabel")}</span>
                  <NumberField
                    value={Number(diskLimit)}
                    min={50}
                    max={99}
                    onValueChange={(value) => setDiskLimit(String(value))}
                  >
                    <NumberFieldGroup>
                      <NumberFieldInput className="text-left" />
                      <NumberFieldDecrement className="rounded-none!" />
                      <NumberFieldIncrement />
                    </NumberFieldGroup>
                  </NumberField>
                  {diskInvalid && diskLimit !== "" ? (
                    <p className="text-destructive text-xs">{t("diskLimitInvalid")}</p>
                  ) : null}
                </FramePanel>
                <FrameFooter>
                  <p className="text-muted-foreground text-sm">{t("diskLimitDescription")}</p>
                </FrameFooter>
              </Frame>

              <div className="flex justify-end">
                <Button
                  disabled={!canSave}
                  onClick={() => updateSettings.mutate()}
                  className="gap-2"
                >
                  <Save className="size-4" />
                  {updateSettings.isPending ? common("loading") : common("save")}
                </Button>
              </div>
            </TabsContent>
          ) : null}

          <TabsContent value="youtube" className="space-y-4">
            <YoutubeClientSettings />
          </TabsContent>

          <TabsContent value="security" className="space-y-4">
            <Frame>
              <FrameHeader>
                <FrameTitle className="flex items-center gap-2">
                  <Lock className="size-4" />
                  {t("changePassword")}
                </FrameTitle>
              </FrameHeader>
              <FramePanel className="space-y-3">
                <div className="space-y-1">
                  <span className="font-medium text-sm">{t("currentPassword")}</span>
                  <Input
                    type="password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <span className="font-medium text-sm">{t("newPassword")}</span>
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <span className="font-medium text-sm">{t("confirmPassword")}</span>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                </div>
              </FramePanel>
              <FrameFooter className="flex justify-end">
                <Button
                  disabled={!canChangePassword}
                  onClick={() => changePassword.mutate()}
                  className="gap-2"
                >
                  <Lock className="size-4" />
                  {changePassword.isPending ? common("loading") : t("changePasswordSubmit")}
                </Button>
              </FrameFooter>
            </Frame>

            <Frame>
              <FrameHeader>
                <FrameTitle className="flex items-center gap-2">
                  <MonitorSmartphone className="size-4" />
                  {t("sessionsTitle")}
                </FrameTitle>
              </FrameHeader>
              <FramePanel>
                <ActiveSessions />
              </FramePanel>
            </Frame>
          </TabsContent>
        </Tabs>
      )}
    </AppShell>
  );
}
