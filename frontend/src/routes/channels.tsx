import { useEffect, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Trash2, Tv } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useTranslations } from "use-intl";

import { toastError, toastSuccess } from "@kumix/ui/custom/toast";
import { Alert, AlertDescription, AlertTitle } from "@kumix/ui/reui/alert";
import { Badge } from "@kumix/ui/reui/badge";
import { Button } from "@kumix/ui/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@kumix/ui/ui/empty";
import { AppShell } from "@/components/AppShell";
import { DataTable, type GridColumnDef } from "@/components/DataTable";
import { api, queryClient } from "@/lib/api";
import { useDateTimeFormatter } from "@/lib/date";
import type { SafeYoutubeConnection } from "../../../src/types/stream";

const errorMessages: Record<string, string> = {
  access_denied: "access_denied",
  invalid_state: "invalid_state",
  token_exchange_failed: "token_exchange_failed",
  no_refresh_token: "no_refresh_token",
  connection_not_found: "connection_not_found",
  missing_params: "missing_params",
};

export function ChannelsPage() {
  const t = useTranslations("Channels");
  const common = useTranslations("Common");
  const [searchParams, setSearchParams] = useSearchParams();
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const dateTimeFormatter = useDateTimeFormatter(settingsQuery.data);
  const connectionsQuery = useQuery({
    queryKey: ["youtubeConnections"],
    queryFn: ({ signal }) => api.youtubeConnections({ signal }),
  });
  const connections = connectionsQuery.data ?? [];

  const callbackError = searchParams.get("youtube_error");
  const connected = searchParams.get("youtube_connected") === "true";
  useEffect(() => {
    if (callbackError || connected) {
      setSearchParams({}, { replace: true });
      queryClient.invalidateQueries({ queryKey: ["youtubeConnections"] });
    }
    if (connected) toastSuccess({ message: t("connectedToast") });
  }, [callbackError, connected, setSearchParams, t]);

  const connectMutation = useMutation({
    mutationFn: () => api.createYoutubeConnection(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["youtubeConnections"] });
      window.open(data.authUrl, "_blank", "noopener");
      toastSuccess({ message: t("authorizeOpened") });
    },
    onError: (error: Error) => toastError({ message: error.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteYoutubeConnection(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["youtubeConnections"] });
      queryClient.invalidateQueries({ queryKey: ["streams"] });
    },
    onError: (error: Error) => toastError({ message: error.message }),
  });

  const columns = useMemo<GridColumnDef<SafeYoutubeConnection>[]>(
    () => [
      {
        accessorKey: "channelTitle",
        header: t("colChannel"),
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            {row.original.channelThumbnail ? (
              <img
                src={row.original.channelThumbnail}
                alt=""
                className="size-9 shrink-0 rounded-full object-cover"
                loading="lazy"
              />
            ) : (
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                <Tv className="size-4 text-muted-foreground" />
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate font-medium">{row.original.channelTitle ?? "—"}</p>
              {row.original.channelId && (
                <p className="truncate text-muted-foreground text-xs">{row.original.channelId}</p>
              )}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: t("colStatus"),
        cell: ({ row }) => (
          <Badge
            variant={
              row.original.status === "connected"
                ? "success"
                : row.original.status === "expired"
                  ? "destructive"
                  : "outline"
            }
          >
            {t(`status_${row.original.status}`)}
          </Badge>
        ),
      },
      {
        accessorKey: "createdAt",
        header: t("colConnectedAt"),
        cell: ({ row }) => dateTimeFormatter.format(new Date(row.original.createdAt)),
      },
      {
        accessorKey: "actions",
        header: "",
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => deleteMutation.mutate(row.original.id)}
            aria-label={common("delete")}
          >
            <Trash2 className="size-4" />
          </Button>
        ),
      },
    ],
    [t, common, dateTimeFormatter, deleteMutation],
  );

  return (
    <AppShell title={t("title")} description={t("description")}>
      {callbackError && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>{t("connectFailed")}</AlertTitle>
          <AlertDescription>
            {t("errorCode", { code: errorMessages[callbackError] ?? callbackError })}
          </AlertDescription>
        </Alert>
      )}
      <div className="flex items-center justify-end">
        <Button onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending}>
          <Tv data-icon="inline-start" className="size-4" />
          {t("connectChannel")}
        </Button>
      </div>
      <DataTable
        data={connections}
        columns={columns}
        isLoading={connectionsQuery.isLoading}
        empty={
          <Empty className="border-border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Tv className="size-8" />
              </EmptyMedia>
              <EmptyTitle>{t("emptyTitle")}</EmptyTitle>
              <EmptyDescription>{t("emptyDescription")}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" onClick={() => connectMutation.mutate()}>
                {t("connectChannel")}
              </Button>
            </EmptyContent>
          </Empty>
        }
      />
    </AppShell>
  );
}
