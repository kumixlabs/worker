import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CircleAlertIcon,
  Clock,
  Copy,
  HardDrive,
  Lock,
  MonitorSmartphone,
  Plus,
  Save,
  Trash2,
  Video,
} from "lucide-react";
import { useTranslations } from "use-intl";

import { toastError, toastSuccess } from "@kumix/ui/custom/toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@kumix/ui/motion/tabs";
import { Alert, AlertTitle } from "@kumix/ui/reui/alert";
import { Badge } from "@kumix/ui/reui/badge";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@kumix/ui/ui/dialog";
import { Input } from "@kumix/ui/ui/input";
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

export function SettingsPage() {
  const { data: session } = authClient.useSession();
  const isAdmin = session?.user?.role === "admin";
  const t = useTranslations("Settings");
  const common = useTranslations("Common");
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const ytConnectionsQuery = useQuery({
    queryKey: ["youtubeConnections"],
    queryFn: api.youtubeConnections,
  });

  const [timezone, setTimezone] = useState("");
  const [diskLimit, setDiskLimit] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [ytClientId, setYtClientId] = useState("");
  const [ytClientSecret, setYtClientSecret] = useState("");
  const [isConnectOpen, setIsConnectOpen] = useState(false);

  const timezones = useMemo(supportedTimezones, []);
  const redirectUri = `${window.location.origin}/api/youtube/callback`;

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

  const connectYoutube = useMutation({
    mutationFn: () =>
      api.createYoutubeConnection({
        clientId: ytClientId.trim(),
        clientSecret: ytClientSecret.trim(),
      }),
    onSuccess: (res) => {
      if (res.authUrl) {
        window.location.href = res.authUrl;
      }
    },
    onError: (error) => toastError({ message: error.message }),
  });

  const disconnectYoutube = useMutation({
    mutationFn: (id: string) => api.deleteYoutubeConnection(id),
    onSuccess: () => {
      toastSuccess({ message: t("disconnected") });
      void queryClient.invalidateQueries({ queryKey: ["youtubeConnections"] });
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
        <Tabs defaultValue={isAdmin ? "general" : "youtube"} variant="pill" className="space-y-5">
          <TabsList>
            {isAdmin ? <TabsTrigger value="general">{t("tabGeneral")}</TabsTrigger> : null}
            <TabsTrigger value="youtube">YouTube</TabsTrigger>
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
            <Frame>
              <FrameHeader className="flex flex-row items-center justify-between">
                <FrameTitle className="flex items-center gap-2">
                  <Video className="size-4" />
                  {t("youtubeTitle")}
                </FrameTitle>
                <Dialog open={isConnectOpen} onOpenChange={setIsConnectOpen}>
                  <DialogTrigger
                    render={
                      <Button size="sm" className="gap-1.5">
                        <Plus className="size-4" />
                        {t("connectChannel")}
                      </Button>
                    }
                  />
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{t("connectTitle")}</DialogTitle>
                      <DialogDescription>{t("connectDescription")}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                      <div>
                        <span className="mb-1 block font-medium text-xs">{t("redirectUri")}</span>
                        <div className="flex items-center gap-2">
                          <Input
                            value={redirectUri}
                            readOnly
                            className="bg-muted font-mono text-xs"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => {
                              navigator.clipboard.writeText(redirectUri);
                              toastSuccess({ message: t("redirectCopied") });
                            }}
                          >
                            <Copy className="size-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <span className="font-medium text-xs">{t("googleClientId")}</span>
                        <Input
                          placeholder="xxxxxxxxxxxx.apps.googleusercontent.com"
                          value={ytClientId}
                          onChange={(e) => setYtClientId(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <span className="font-medium text-xs">{t("googleClientSecret")}</span>
                        <Input
                          type="password"
                          placeholder="GOCSPX-xxxxxxxxxxxxxxxx"
                          value={ytClientSecret}
                          onChange={(e) => setYtClientSecret(e.target.value)}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        disabled={!ytClientId || !ytClientSecret || connectYoutube.isPending}
                        onClick={() => connectYoutube.mutate()}
                      >
                        {connectYoutube.isPending ? t("connecting") : t("proceedGoogle")}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </FrameHeader>
              <FramePanel>
                <div className="space-y-3">
                  {ytConnectionsQuery.data?.length === 0 ? (
                    <p className="text-muted-foreground text-sm">{t("youtubeEmpty")}</p>
                  ) : (
                    ytConnectionsQuery.data?.map((conn) => (
                      <div
                        key={conn.id}
                        className="flex items-center justify-between rounded-lg border p-3"
                      >
                        <div className="flex items-center gap-3">
                          {conn.channelThumbnail ? (
                            <img
                              src={conn.channelThumbnail}
                              alt=""
                              className="size-10 rounded-full object-cover"
                            />
                          ) : (
                            <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                              <Video className="size-5 text-muted-foreground" />
                            </div>
                          )}
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">
                                {conn.channelTitle || t("channelFallback")}
                              </span>
                              <Badge
                                variant={conn.status === "connected" ? "default" : "destructive"}
                              >
                                {conn.status}
                              </Badge>
                            </div>
                            <p className="font-mono text-muted-foreground text-xs">
                              {t("clientMasked", { masked: conn.clientIdMasked })}
                            </p>
                            {conn.subscriberCount !== undefined ? (
                              <p className="text-muted-foreground text-xs">
                                {t("subscribers", {
                                  count: new Intl.NumberFormat().format(conn.subscriberCount),
                                })}
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:bg-destructive/10"
                          onClick={() => disconnectYoutube.mutate(conn.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </FramePanel>
              <FrameFooter>
                <p className="text-muted-foreground text-xs">{t("quotaNote")}</p>
              </FrameFooter>
            </Frame>
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
