import { Link, useRouteError } from "react-router-dom";
import { useTranslations } from "use-intl";

import { Button, Card, CardContent } from "@kumix/ui";

export function NotFound() {
  const t = useTranslations("Root");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="max-w-md text-center">
        <CardContent className="p-8">
          <h1 className="font-bold text-7xl text-foreground">404</h1>
          <h2 className="mt-4 font-semibold text-foreground text-xl">{t("notFoundTitle")}</h2>
          <p className="mt-2 text-muted-foreground text-sm">{t("notFoundDescription")}</p>
          <Button asChild className="mt-6">
            <Link to="/">{t("goHome")}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function RouteError() {
  const error = useRouteError();
  console.error(error);
  const t = useTranslations("Root");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="max-w-md text-center">
        <CardContent className="p-8">
          <h1 className="font-semibold text-foreground text-xl tracking-tight">
            {t("errorTitle")}
          </h1>
          <p className="mt-2 text-muted-foreground text-sm">{t("errorDescription")}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button onClick={() => window.location.reload()}>{t("tryAgain")}</Button>
            <Button asChild variant="outline">
              <Link to="/">{t("goHome")}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
