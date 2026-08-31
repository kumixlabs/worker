import { type ReactNode, useEffect, useState } from "react";
import { ArrowRight, Ban, CircleAlertIcon, Eye, EyeOff, Loader2 } from "lucide-react";
import { useTranslations } from "use-intl";

import { Button } from "@kumix/ui/motion/button/base";
import { Input } from "@kumix/ui/motion/input";
import { Alert, AlertDescription, AlertTitle } from "@kumix/ui/reui/alert";
import { Frame, FramePanel } from "@kumix/ui/reui/frame";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@kumix/ui/ui/dialog";
import { authClient } from "@/lib/auth";

export function AuthGate({ children }: { children: ReactNode }) {
  const t = useTranslations("Auth");
  const { data: session, isPending } = authClient.useSession();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [show, setShow] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [banned, setBanned] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [hasAdmin, setHasAdmin] = useState<boolean | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);

  const hasSession = Boolean(session);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/bootstrap")
      .then((r) => r.json())
      .then((body: { ok?: boolean; data?: { hasAdmin?: boolean } }) => {
        if (!cancelled && !hasSession) setHasAdmin(Boolean(body.data?.hasAdmin));
      })
      .catch(() => {
        if (!cancelled && !hasSession) setHasAdmin(true);
      });
    return () => {
      cancelled = true;
    };
  }, [hasSession]);

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (session) return children;

  if (hasAdmin === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const submitSetup = async () => {
    setSubmitting(true);
    setError("");
    try {
      if (password !== confirmPassword) throw new Error(t("passwordMismatch"));
      const response = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name: name || "Admin" }),
      });
      const body = (await response.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        error?: { message?: string };
      };
      // Success returns Better Auth's `{ token, user }` envelope — no `ok` field. Trust the status.
      if (!response.ok) {
        throw new Error(body?.error?.message ?? body?.message ?? t("loginError"));
      }
      window.location.reload();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      // User was created but sign-in failed (e.g. rate limit): fall back to login
      // instead of dead-ending on the one-time setup form.
      if (message.toLowerCase().includes("already exists")) {
        setHasAdmin(true);
        setError("");
      } else {
        setError(message || t("loginError"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submitLogin = async () => {
    setSubmitting(true);
    setError("");
    setBanned(false);
    try {
      const { error: signInError } = await authClient.signIn.email({ email, password });
      if (signInError) {
        const code = (signInError as { code?: string }).code ?? "";
        if (code === "BANNED_USER" || /banned/i.test(signInError.message ?? "")) {
          setBanned(true);
        } else {
          throw new Error(signInError.message ?? t("loginError"));
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("loginError"));
    } finally {
      setSubmitting(false);
    }
  };

  const firstRun = !hasAdmin;
  const confirmTouched = firstRun && confirmPassword.length > 0;
  const confirmMismatch = confirmTouched && password !== confirmPassword;
  const confirmMatched = confirmTouched && password === confirmPassword;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form
        className="w-full max-w-sm space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void (firstRun ? submitSetup() : submitLogin());
        }}
      >
        <Frame>
          <FramePanel className="space-y-5">
            <div className="text-center">
              <h1 className="font-bold text-2xl tracking-tight">
                {firstRun ? t("setupTitle") : t("loginTitle")}
              </h1>
              <p className="mt-2 text-muted-foreground text-sm">
                {firstRun ? t("setupDescription") : t("loginDescription")}
              </p>
            </div>
            {banned ? (
              <Alert variant="destructive">
                <Ban className="size-4" />
                <AlertTitle>{t("accountBanned")}</AlertTitle>
                <AlertDescription>{t("accountBannedContact")}</AlertDescription>
              </Alert>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>{error}</AlertTitle>
              </Alert>
            ) : null}
            <div className="flex flex-col gap-4">
              {firstRun ? (
                <Input
                  label={t("nameLabel")}
                  type="text"
                  placeholder="Admin"
                  value={name}
                  onChange={setName}
                  disabled={submitting}
                />
              ) : null}
              <Input
                label={t("emailLabel")}
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={setEmail}
                disabled={submitting}
              />
              <Input
                label={t("passwordLabel")}
                type={show ? "text" : "password"}
                placeholder={t("passwordPlaceholder")}
                value={password}
                onChange={setPassword}
                disabled={submitting}
                rightIcon={
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    aria-label={show ? "Hide password" : "Show password"}
                    className="pointer-events-auto"
                  >
                    {show ? <EyeOff /> : <Eye />}
                  </button>
                }
              />
              {firstRun ? (
                <>
                  <Input
                    label={t("confirmPasswordLabel")}
                    type={showConfirm ? "text" : "password"}
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    disabled={submitting}
                    error={confirmMismatch ? t("passwordMismatch") : false}
                    success={confirmMatched}
                    rightIcon={
                      <button
                        type="button"
                        onClick={() => setShowConfirm((s) => !s)}
                        aria-label={showConfirm ? "Hide password" : "Show password"}
                      >
                        {showConfirm ? <EyeOff /> : <Eye />}
                      </button>
                    }
                  />
                  <p className="text-muted-foreground text-xs">{t("setupPasswordHint")}</p>
                </>
              ) : null}
              <Button
                type="submit"
                className="w-full"
                disabled={
                  !email ||
                  !password ||
                  (firstRun && (!confirmPassword || confirmMismatch)) ||
                  submitting
                }
              >
                {firstRun ? t("setupSubmit") : t("loginSubmit")}
                <ArrowRight className="size-4" />
              </Button>
              {!firstRun ? (
                <button
                  type="button"
                  className="mx-auto text-muted-foreground text-xs underline-offset-4 hover:text-foreground hover:underline"
                  onClick={() => setForgotOpen(true)}
                >
                  {t("forgotPassword")}
                </button>
              ) : null}
            </div>
          </FramePanel>
        </Frame>
      </form>

      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("forgotTitle")}</DialogTitle>
            <DialogDescription>{t("forgotContactAdmin")}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  );
}
