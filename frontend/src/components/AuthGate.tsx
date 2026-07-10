import { type ReactNode, useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { useTranslations } from "use-intl";

import { getApiToken } from "@/lib/api";

export function AuthGate({ children }: { children: ReactNode }) {
  const t = useTranslations("Auth");
  const [token, setToken] = useState(getApiToken());

  useEffect(() => {
    const onInvalid = () => {
      setToken("");
    };
    window.addEventListener("forge-worker-auth-invalid", onInvalid);
    return () => window.removeEventListener("forge-worker-auth-invalid", onInvalid);
  }, []);

  if (token) return children;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <ShieldAlert className="h-16 w-16 text-destructive" />
      <h1 className="mt-6 font-bold text-4xl text-foreground tracking-tight sm:text-5xl">
        {t("deniedTitle")}
      </h1>
      <p className="mt-4 max-w-xl text-base text-muted-foreground sm:text-lg">
        {t("deniedDescription")}
      </p>
    </div>
  );
}
