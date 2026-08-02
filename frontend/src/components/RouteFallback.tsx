import { Link, useRouteError } from "react-router-dom";
import { useTranslations } from "use-intl";

import { Frame, FramePanel } from "@kumix/ui/reui/frame";
import { Button } from "@kumix/ui/ui/button";
import { getApiToken } from "@/lib/api";

export function NotFound() {
  const t = useTranslations("Root");
  const hasToken = Boolean(getApiToken());

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Frame className="max-w-md text-center">
        <FramePanel className="p-8">
          <h1 className="font-bold text-7xl text-foreground">404</h1>
          <h2 className="mt-4 font-semibold text-foreground text-xl">{t("notFoundTitle")}</h2>
          <p className="mt-2 text-muted-foreground text-sm">{t("notFoundDescription")}</p>
          {hasToken ? (
            <Button className="mt-6" render={<Link to="/" />} nativeButton={false}>
              {t("goHome")}
            </Button>
          ) : null}
        </FramePanel>
      </Frame>
    </div>
  );
}

export function RouteError() {
  const error = useRouteError();
  if (import.meta.env.DEV) console.error(error);
  const t = useTranslations("Root");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Frame className="max-w-md text-center">
        <FramePanel className="p-8">
          <h1 className="font-semibold text-foreground text-xl tracking-tight">
            {t("errorTitle")}
          </h1>
          <p className="mt-2 text-muted-foreground text-sm">{t("errorDescription")}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button onClick={() => window.location.reload()}>{t("tryAgain")}</Button>
            <Button variant="outline" render={<Link to="/" />} nativeButton={false}>
              {t("goHome")}
            </Button>
          </div>
        </FramePanel>
      </Frame>
    </div>
  );
}
