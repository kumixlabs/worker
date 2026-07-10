import { type ReactNode, useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { useTranslations } from "use-intl";

import { Button, Input } from "@kumix/ui";
import { getApiToken, setApiToken } from "@/lib/api";

export function AuthGate({ children, isHome = false }: { children: ReactNode; isHome?: boolean }) {
  const t = useTranslations("Auth");
  const [token, setToken] = useState(getApiToken());
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const onInvalid = () => {
      setToken("");
    };
    const onReady = () => {
      setToken(getApiToken());
    };
    window.addEventListener("kumix-worker-auth-invalid", onInvalid);
    window.addEventListener("kumix-worker-auth-ready", onReady);
    return () => {
      window.removeEventListener("kumix-worker-auth-invalid", onInvalid);
      window.removeEventListener("kumix-worker-auth-ready", onReady);
    };
  }, []);

  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: input }),
      });
      const body = (await response.json()) as { ok: boolean; error?: { message?: string } };
      if (!response.ok || !body.ok) throw new Error(body.error?.message ?? t("loginError"));
      setApiToken(input);
      setToken(input);
      setInput("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("loginError"));
    } finally {
      setSubmitting(false);
    }
  };

  if (token) return children;
  if (isHome) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <form
          className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="text-center">
            <h1 className="font-bold text-2xl tracking-tight">{t("loginTitle")}</h1>
            <p className="mt-2 text-muted-foreground text-sm">{t("loginDescription")}</p>
          </div>
          <Input
            type="password"
            autoComplete="current-password"
            placeholder={t("tokenPlaceholder")}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={submitting}
          />
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <Button className="w-full" type="submit" disabled={!input || submitting}>
            {t("loginSubmit")}
          </Button>
        </form>
      </div>
    );
  }

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
