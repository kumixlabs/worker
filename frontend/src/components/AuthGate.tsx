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

  const loginCard = (
    <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="text-center">
        <h1 className="font-bold text-2xl tracking-tight">{t("loginTitle")}</h1>
        <p className="mt-2 text-muted-foreground text-sm">{t("loginDescription")}</p>
      </div>
      <label htmlFor="worker-token" className="sr-only">
        {t("tokenLabel")}
      </label>
      <Input
        id="worker-token"
        type="password"
        autoComplete="current-password"
        placeholder={t("tokenPlaceholder")}
        value={input}
        onChange={(event) => setInput(event.target.value)}
        disabled={submitting}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "worker-token-error" : undefined}
      />
      {error ? (
        <p id="worker-token-error" role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <Button className="w-full" type="submit" disabled={!input || submitting}>
        {t("loginSubmit")}
      </Button>
    </div>
  );

  if (token) return children;
  if (isHome) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {loginCard}
        </form>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center">
      <ShieldAlert className="h-16 w-16 text-destructive" />
      <h1 className="font-bold text-4xl text-foreground tracking-tight sm:text-5xl">
        {t("deniedTitle")}
      </h1>
      <p className="max-w-xl text-base text-muted-foreground sm:text-lg">
        {t("deniedDescription")}
      </p>
    </div>
  );
}
