import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, MonitorSmartphone, ShieldAlert } from "lucide-react";
import { useTranslations } from "use-intl";

import { toastError, toastSuccess } from "@kumix/ui/custom/toast";
import { Badge } from "@kumix/ui/reui/badge";
import { Button } from "@kumix/ui/ui/button";
import { authClient } from "@/lib/auth";

type SessionRecord = {
  id: string;
  token?: string;
  userId: string;
  expiresAt: string | Date;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string | Date;
};

// ponytail: regex UA sniffing — swap for a UA parser lib if device marketing matters
function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown device";
  const os = /Windows/i.test(userAgent)
    ? "Windows"
    : /Mac OS X|Macintosh/i.test(userAgent)
      ? "macOS"
      : /Android/i.test(userAgent)
        ? "Android"
        : /iPhone|iPad|iOS/i.test(userAgent)
          ? "iOS"
          : /Linux/i.test(userAgent)
            ? "Linux"
            : "Unknown OS";
  const browser = /Edg\//i.test(userAgent)
    ? "Edge"
    : /OPR\//i.test(userAgent)
      ? "Opera"
      : /Chrome\//i.test(userAgent)
        ? "Chrome"
        : /Safari\//i.test(userAgent)
          ? "Safari"
          : /Firefox\//i.test(userAgent)
            ? "Firefox"
            : "Browser";
  return `${os} · ${browser}`;
}

export function ActiveSessions() {
  const t = useTranslations("Settings");
  const queryClient = useQueryClient();
  const currentSessionId = authClient.useSession().data?.session?.id;

  const sessionsQuery = useQuery({
    queryKey: ["auth-sessions"],
    queryFn: async () => {
      const { data, error } = await authClient.listSessions();
      if (error) throw new Error(error.message || "Could not load sessions");
      return (data ?? []) as SessionRecord[];
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["auth-sessions"] });

  const revoke = useMutation({
    mutationFn: async (session: SessionRecord) => {
      if (!session.token) throw new Error("Session token unavailable");
      const { error } = await authClient.revokeSession({ token: session.token });
      if (error) throw new Error(error.message || "Could not revoke session");
    },
    onSuccess: () => {
      toastSuccess({ message: t("sessionsRevoked") });
      void invalidate();
    },
    onError: (error: Error) => toastError({ message: error.message }),
  });

  const revokeOthers = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.revokeOtherSessions();
      if (error) throw new Error(error.message || "Could not revoke sessions");
    },
    onSuccess: () => {
      toastSuccess({ message: t("sessionsRevoked") });
      void invalidate();
    },
    onError: (error: Error) => toastError({ message: error.message }),
  });

  const sessions = sessionsQuery.data ?? [];
  const others = sessions.filter((s) => s.id !== currentSessionId);

  return (
    <div className="space-y-3">
      {sessionsQuery.isLoading ? (
        <p className="text-muted-foreground text-sm">{t("sessionsLoading")}</p>
      ) : sessionsQuery.isError ? (
        <p className="flex items-center gap-2 text-destructive text-sm">
          <ShieldAlert className="size-4" />
          {t("sessionsLoadError")}
        </p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((session) => {
            const isCurrent = session.id === currentSessionId;
            return (
              <li
                key={session.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <MonitorSmartphone className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{describeDevice(session.userAgent)}</span>
                  {isCurrent ? <Badge variant="primary-light">{t("sessionsCurrent")}</Badge> : null}
                </div>
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  {session.ipAddress ? (
                    <span className="flex items-center gap-1">
                      <Globe className="size-3" />
                      {session.ipAddress}
                    </span>
                  ) : null}
                  {isCurrent ? null : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(session)}
                    >
                      {t("sessionsRevoke")}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {others.length > 0 ? (
        <div className="flex justify-end">
          <Button
            variant="destructive"
            size="sm"
            disabled={revokeOthers.isPending}
            onClick={() => revokeOthers.mutate()}
          >
            {t("sessionsRevokeAll")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
