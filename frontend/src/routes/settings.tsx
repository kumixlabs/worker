import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Clock, Copy, HardDrive, Key, Lock, RefreshCw, Save } from "lucide-react";
import { useTranslations } from "use-intl";

import { Button } from "@kumix/ui/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@kumix/ui/ui/card";
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@kumix/ui/ui/input-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@kumix/ui/ui/tabs";
import { AlertError, AlertSuccess } from "@/components/Alert";
import { AppShell } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { api, clearPasswordIsDefault, getApiToken, queryClient, setApiToken } from "@/lib/api";

function supportedTimezones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  try {
    return intl.supportedValuesOf?.("timeZone") ?? ["UTC", "Asia/Jakarta"];
  } catch {
    return ["UTC", "Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"];
  }
}

function randomApiToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function SettingsPage() {
  const t = useTranslations("Settings");
  const common = useTranslations("Common");
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const [timezone, setTimezone] = useState("");
  const [diskLimit, setDiskLimit] = useState("");
  const [youtubeApiKey, setYoutubeApiKey] = useState("");
  const [youtubeKeyDirty, setYoutubeKeyDirty] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [apiTokenValue, setApiTokenValue] = useState(() => getApiToken());
  const timezones = useMemo(supportedTimezones, []);

  const updateSettings = useMutation({
    mutationFn: () =>
      api.patchSettings({
        timezone,
        diskUsageLimitPercent: Number(diskLimit),
        ...(youtubeKeyDirty ? { youtubeApiKey } : {}),
      }),
    onSuccess: () => {
      AlertSuccess({ message: t("saved") });
      setYoutubeApiKey("");
      setYoutubeKeyDirty(false);
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error) => AlertError({ message: error.message }),
  });

  const changePassword = useMutation({
    mutationFn: () =>
      api.changePassword({
        currentPassword,
        newPassword,
        confirmPassword,
      }),
    onSuccess: () => {
      AlertSuccess({ message: t("passwordChanged") });
      // Server rejects factory default; a successful change always clears the flag.
      clearPasswordIsDefault();
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error) => AlertError({ message: error.message }),
  });

  const rotateToken = useMutation({
    mutationFn: () => {
      const next = randomApiToken();
      return api.rotateToken(next).then((result) => ({ ...result, token: next }));
    },
    onSuccess: (data) => {
      setApiToken(data.token, false);
      setApiTokenValue(data.token);
      AlertSuccess({ message: t("apiTokenRotated") });
      setConfirmRegenerate(false);
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error) => AlertError({ message: error.message }),
  });

  useEffect(() => {
    if (!settingsQuery.data) return;
    setTimezone(settingsQuery.data.timezone);
    setDiskLimit(String(settingsQuery.data.diskUsageLimitPercent));
    setYoutubeApiKey("");
    setYoutubeKeyDirty(false);
  }, [settingsQuery.data]);

  const diskValue = Number(diskLimit);
  const diskInvalid = !Number.isInteger(diskValue) || diskValue < 50 || diskValue > 99;
  const canSave = Boolean(timezone) && !diskInvalid && !updateSettings.isPending;

  const passwordMismatch =
    newPassword.length > 0 && confirmPassword.length > 0 && newPassword !== confirmPassword;
  const passwordTooShort = newPassword.length > 0 && newPassword.length < 6;
  const canChangePassword =
    Boolean(currentPassword) &&
    newPassword.length >= 6 &&
    newPassword === confirmPassword &&
    newPassword !== currentPassword &&
    !changePassword.isPending;

  const copyToken = async () => {
    if (!apiTokenValue) return;
    try {
      await navigator.clipboard.writeText(apiTokenValue);
      AlertSuccess({ message: t("apiTokenCopied") });
    } catch {
      AlertError({ message: t("apiTokenCopy") });
    }
  };

  return (
    <AppShell title={t("title")} description={t("description")}>
      {settingsQuery.isError ? (
        <Card>
          <CardContent className="py-6">
            <p className="text-destructive text-sm">{common("loadError")}</p>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="general" className="flex flex-col space-y-5">
          <TabsList>
            <TabsTrigger value="general">{t("tabGeneral")}</TabsTrigger>
            <TabsTrigger value="security">{t("tabSecurity")}</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4">
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

            <Card>
              <CardHeader className="min-h-0 flex-col items-start py-4">
                <CardTitle className="flex items-center gap-2">
                  <Key className="h-4 w-4" />
                  {t("youtubeApiKey")}
                </CardTitle>
                <CardDescription>{t("youtubeApiKeyDescription")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {settingsQuery.data?.hasYoutubeApiKey ? (
                  <p className="text-muted-foreground text-xs">{t("youtubeApiKeyConfigured")}</p>
                ) : null}
                <Input
                  type="password"
                  value={youtubeApiKey}
                  placeholder={
                    settingsQuery.data?.hasYoutubeApiKey
                      ? t("youtubeApiKeyKeepPlaceholder")
                      : t("youtubeApiKeyPlaceholder")
                  }
                  onChange={(event) => {
                    setYoutubeApiKey(event.target.value);
                    setYoutubeKeyDirty(true);
                  }}
                />
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button disabled={!canSave} onClick={() => updateSettings.mutate()}>
                <Save />
                {common("save")}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="security" className="space-y-4">
            <Card>
              <CardHeader className="min-h-0 flex-col items-start py-4">
                <CardTitle className="flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  {t("changePassword")}
                </CardTitle>
                <CardDescription>{t("changePasswordDescription")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <span className="block font-medium text-sm">{t("currentPassword")}</span>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <span className="block font-medium text-sm">{t("newPassword")}</span>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                  />
                  {passwordTooShort ? (
                    <p className="text-destructive text-xs">{t("passwordTooShort")}</p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <span className="block font-medium text-sm">{t("confirmPassword")}</span>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                  {passwordMismatch ? (
                    <p className="text-destructive text-xs">{t("passwordMismatch")}</p>
                  ) : null}
                </div>
                <div className="flex justify-end">
                  <Button disabled={!canChangePassword} onClick={() => changePassword.mutate()}>
                    {t("changePasswordSubmit")}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="min-h-0 flex-col items-start py-4">
                <CardTitle className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" />
                  {t("apiToken")}
                </CardTitle>
                <CardDescription>{t("apiTokenDescription")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {settingsQuery.data ? (
                  <p className="text-muted-foreground text-sm">
                    {t("apiTokenLength", { length: settingsQuery.data.tokenLength })}
                  </p>
                ) : null}
                <div className="space-y-2">
                  <span className="block font-medium text-sm">{t("apiTokenValueLabel")}</span>
                  <InputGroup>
                    <InputGroupInput
                      readOnly
                      value={apiTokenValue}
                      className="font-mono text-xs"
                      aria-label={t("apiToken")}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        variant="ghost"
                        size="icon-xs"
                        disabled={!apiTokenValue}
                        aria-label={t("apiTokenCopy")}
                        onClick={() => void copyToken()}
                      >
                        <Copy className="size-4" />
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                </div>
                <div className="flex justify-end">
                  <Button
                    variant="destructive"
                    disabled={rotateToken.isPending}
                    onClick={() => setConfirmRegenerate(true)}
                  >
                    <RefreshCw className={rotateToken.isPending ? "animate-spin" : undefined} />
                    {t("apiTokenRegenerate")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      <ConfirmDialog
        open={confirmRegenerate}
        onOpenChange={setConfirmRegenerate}
        onConfirm={() => rotateToken.mutate()}
        title={t("apiTokenConfirmTitle")}
        description={t("apiTokenConfirmDescription")}
        confirmText={t("apiTokenConfirm")}
        cancelText={common("cancel")}
        loading={rotateToken.isPending}
      />
    </AppShell>
  );
}
