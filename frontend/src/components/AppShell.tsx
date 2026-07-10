import { type ReactNode, useEffect, useState } from "react";
import {
  Activity,
  Film,
  KeyRound,
  LayoutDashboard,
  LogOut,
  PanelLeft,
  Radio,
  Settings,
  Terminal,
  X,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useTranslations } from "use-intl";

import { Badge, Button } from "@kumix/ui";
import { cn } from "@kumix/utils";
import { queryClient, setApiToken } from "@/lib/api";
import packageJson from "../../../package.json";
import { ConfirmDialog } from "./ConfirmDialog";
import { EngineStatus } from "./EngineStatus";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { LogoWithHref } from "./Logo";
import { MaxWidthWrapper } from "./MaxWidthWrapper";
import { ModeSwitcher } from "./ModeSwitcher";

const navItems = [
  { to: "/", key: "overview", icon: LayoutDashboard },
  { to: "/monitoring", key: "monitoring", icon: Activity },
  { to: "/log", key: "log", icon: Terminal },
] as const;

const navItemsSecondary = [
  { to: "/streams", key: "streams", icon: Radio },
  { to: "/sources", key: "sources", icon: Film },
  { to: "/targets", key: "targets", icon: KeyRound },
  { to: "/settings", key: "settings", icon: Settings },
] as const;

export function AppShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const t = useTranslations("Shell");
  const common = useTranslations("Common");
  const tNav = useTranslations("Shell.navigation");
  const location = useLocation();

  useEffect(() => {
    document.title = `${title} - Kumix Worker`;
  }, [title]);

  const logout = () => {
    setApiToken("");
    queryClient.clear();
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 w-full border-border border-b bg-background/95 backdrop-blur-sm supports-backdrop-filter:bg-background/60">
        <div className="relative flex h-14 w-full min-w-0 items-center justify-between gap-2 px-3 sm:px-5">
          <LogoWithHref />
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <ModeSwitcher />
            <LocaleSwitcher />
            <Button
              variant="outline"
              className="hidden sm:inline-flex"
              onClick={() => setConfirmLogout(true)}
            >
              <LogOut className="size-4" />
              {t("logout")}
            </Button>
            <Button
              mode="icon"
              variant="outline"
              className="inline-flex sm:hidden"
              aria-label={t("logout")}
              onClick={() => setConfirmLogout(true)}
            >
              <LogOut className="size-4" />
            </Button>
            <Button
              mode="icon"
              variant="ghost"
              className="lg:hidden"
              aria-label="Toggle sidebar"
              onClick={() => setSidebarOpen((value) => !value)}
            >
              {sidebarOpen ? <X className="size-4" /> : <PanelLeft className="size-4" />}
            </Button>
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
        <button
          type="button"
          aria-label={t("closeSidebar")}
          className={cn(
            "fixed inset-x-0 top-14 bottom-0 z-30 bg-black/20 transition-opacity duration-200 lg:hidden",
            sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          onClick={() => setSidebarOpen(false)}
        />
        <aside
          className={cn(
            "fixed inset-y-14 left-0 z-40 flex h-[calc(100vh-3.5rem)] w-64 shrink-0 flex-col border-border border-e bg-sidebar text-sidebar-foreground shadow-xl transition-transform duration-300 ease-out will-change-transform lg:static lg:translate-x-0 lg:shadow-none",
            sidebarOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <nav className="flex flex-1 flex-col gap-1 p-3">
            <div className="px-3 font-medium text-muted-foreground text-xs">
              {tNav("dashboard")}
            </div>
            {navItems.map(({ to, key, icon: Icon }) => {
              const active =
                to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);
              return (
                <Link
                  key={to}
                  to={to}
                  onClick={() => setSidebarOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition",
                    active
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  <span className="truncate">{tNav(key)}</span>
                  {active ? <span className="ml-auto size-1.5 rounded-full bg-primary" /> : null}
                </Link>
              );
            })}
            <div className="mt-4 px-3 font-medium text-muted-foreground text-xs">
              {tNav("live_streams")}
            </div>
            {navItemsSecondary.map(({ to, key, icon: Icon }) => {
              const active = location.pathname.startsWith(to);
              return (
                <Link
                  key={to}
                  to={to}
                  onClick={() => setSidebarOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition",
                    active
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  <span className="truncate">{tNav(key)}</span>
                  {active ? <span className="ml-auto size-1.5 rounded-full bg-primary" /> : null}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center justify-between gap-2 px-3 pb-4 text-muted-foreground text-xs">
            <EngineStatus />
            <Badge variant="primary" shape="circle" className="font-normal">
              v{packageJson.version}
            </Badge>
          </div>
        </aside>

        <main className="no-scrollbar flex flex-1 flex-col overflow-y-auto bg-background p-6">
          <MaxWidthWrapper className="flex flex-col gap-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="font-bold text-3xl tracking-tight">{title}</h1>
                {description ? (
                  <p className="mt-1.5 max-w-2xl text-muted-foreground text-sm">{description}</p>
                ) : null}
              </div>
              {actions}
            </div>
            {children}
          </MaxWidthWrapper>
        </main>
      </div>
      <ConfirmDialog
        open={confirmLogout}
        onOpenChange={setConfirmLogout}
        onConfirm={logout}
        title={t("logoutTitle")}
        description={t("logoutDescription")}
        confirmText={common("confirm")}
        cancelText={common("cancel")}
      />
    </div>
  );
}
