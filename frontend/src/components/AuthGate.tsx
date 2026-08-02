import { type ReactNode, useEffect, useState } from "react";
import { ArrowRight, CircleAlertIcon, Eye, EyeOff } from "lucide-react";
import { useTranslations } from "use-intl";

import { Button } from "@kumix/ui/motion/button/base";
import { Input } from "@kumix/ui/motion/input";
import { Alert, AlertTitle } from "@kumix/ui/reui/alert";
import { Frame, FramePanel } from "@kumix/ui/reui/frame";
import {
  clearPasswordIsDefault,
  getApiToken,
  getPasswordIsDefault,
  setApiToken,
  setPasswordIsDefault,
} from "@/lib/api";

export function AuthGate({ children }: { children: ReactNode }) {
  const t = useTranslations("Auth");
  const [token, setToken] = useState(getApiToken());
  const [mustChangePassword, setMustChangePassword] = useState(getPasswordIsDefault());
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const onInvalid = () => {
      setToken("");
      setMustChangePassword(false);
    };
    const onReady = () => {
      setToken(getApiToken());
      setMustChangePassword(getPasswordIsDefault());
    };
    window.addEventListener("kumix-worker-auth-invalid", onInvalid);
    window.addEventListener("kumix-worker-auth-ready", onReady);
    const expiryTimer = setInterval(() => {
      if (!getApiToken()) {
        setToken("");
        setMustChangePassword(false);
      }
    }, 60_000);
    return () => {
      window.removeEventListener("kumix-worker-auth-invalid", onInvalid);
      window.removeEventListener("kumix-worker-auth-ready", onReady);
      clearInterval(expiryTimer);
    };
  }, []);

  // Revalidate passwordIsDefault from server so CLI password reset unblocks the SPA.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/settings", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.status === 401) {
          setApiToken("");
          if (!cancelled) {
            setToken("");
            setMustChangePassword(false);
          }
          return;
        }
        if (!response.ok) return;
        const body = (await response.json()) as {
          ok?: boolean;
          data?: { passwordIsDefault?: boolean };
        };
        if (!body.ok || cancelled) return;
        const isDefault = Boolean(body.data?.passwordIsDefault);
        setPasswordIsDefault(isDefault);
        setMustChangePassword(isDefault);
      } catch {
        // offline / transient — keep stored flag
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submitLogin = async () => {
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = (await response.json().catch(() => ({
        ok: false,
        error: { message: response.status === 429 ? "Too many requests" : t("loginError") },
      }))) as {
        ok: boolean;
        data?: { token?: string; expiresAt?: string; passwordIsDefault?: boolean };
        error?: { message?: string };
      };
      if (!response.ok || !body.ok || !body.data?.token) {
        throw new Error(body.error?.message ?? t("loginError"));
      }
      const isDefault = Boolean(body.data.passwordIsDefault);
      setApiToken(body.data.token, isDefault, body.data.expiresAt ?? null);
      setToken(body.data.token);
      setMustChangePassword(isDefault);
      // Keep password when forcing change so we can send it as currentPassword.
      if (!isDefault) setPassword("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("loginError"));
    } finally {
      setSubmitting(false);
    }
  };

  const submitPasswordChange = async () => {
    setSubmitting(true);
    setError("");
    try {
      if (newPassword.length < 6) throw new Error(t("passwordTooShort"));
      if (newPassword !== confirmPassword) throw new Error(t("passwordMismatch"));
      if (newPassword === password) throw new Error(t("passwordSameAsDefault"));
      const response = await fetch("/api/settings/password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getApiToken()}`,
        },
        body: JSON.stringify({
          currentPassword: password,
          newPassword,
          confirmPassword,
        }),
      });
      const body = (await response.json()) as {
        ok: boolean;
        error?: { message?: string };
      };
      if (!response.ok || !body.ok) {
        throw new Error(body.error?.message ?? t("passwordChangeError"));
      }
      clearPasswordIsDefault();
      setMustChangePassword(false);
      setPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("passwordChangeError"));
    } finally {
      setSubmitting(false);
    }
  };

  if (token && !mustChangePassword) return children;

  if (token && mustChangePassword) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <form
          className="w-full max-w-sm space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submitPasswordChange();
          }}
        >
          <Frame>
            <FramePanel className="space-y-5">
              <div className="text-center">
                <h1 className="font-bold text-2xl tracking-tight">{t("changeDefaultTitle")}</h1>
                <p className="mt-2 text-muted-foreground text-sm">
                  {t("changeDefaultDescription")}
                </p>
              </div>
              {error ? (
                <Alert variant="destructive">
                  <CircleAlertIcon />
                  <AlertTitle>{error}</AlertTitle>
                </Alert>
              ) : null}
              <div className="flex flex-col gap-4">
                {!password ? (
                  <Input
                    label={t("passwordLabel")}
                    type="password"
                    value={password}
                    onChange={setPassword}
                    disabled={submitting}
                  />
                ) : null}
                <Input
                  label={t("newPasswordLabel")}
                  type="password"
                  value={newPassword}
                  onChange={setNewPassword}
                  disabled={submitting}
                />
                <Input
                  label={t("confirmPasswordLabel")}
                  type="password"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  disabled={submitting}
                />
                <Button
                  type="submit"
                  className="w-full"
                  disabled={!password || !newPassword || !confirmPassword || submitting}
                >
                  {t("changeDefaultSubmit")}
                </Button>
              </div>
            </FramePanel>
          </Frame>
        </form>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form
        className="w-full max-w-sm space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submitLogin();
        }}
      >
        <Frame>
          <FramePanel className="space-y-5">
            <div className="text-center">
              <h1 className="font-bold text-2xl tracking-tight">{t("loginTitle")}</h1>
              <p className="mt-2 text-muted-foreground text-sm">{t("loginDescription")}</p>
            </div>
            {error ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>{error}</AlertTitle>
              </Alert>
            ) : null}
            <div className="flex flex-col gap-4">
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
              <Button type="submit" className="w-full" disabled={!password || submitting}>
                {t("loginSubmit")}
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </FramePanel>
        </Frame>
      </form>
    </div>
  );
}
