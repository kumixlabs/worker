import { type ReactNode, useEffect, useMemo, useState } from "react";
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
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslations } from "use-intl";

import { ConfirmSignOut } from "@kumix/ui/custom/confirm-dialog";
import {
  AnimatedSidebar,
  AnimatedSidebarContent,
  AnimatedSidebarFooter,
  AnimatedSidebarGroup,
  AnimatedSidebarGroupContent,
  AnimatedSidebarGroupLabel,
  AnimatedSidebarHeader,
  AnimatedSidebarInset,
  AnimatedSidebarMenu,
  AnimatedSidebarMenuButton,
  AnimatedSidebarMenuItem,
  AnimatedSidebarProvider,
  AnimatedSidebarRail,
  AnimatedSidebarTrigger,
} from "@kumix/ui/motion/animated-sidebar";
import { ThemeToggle } from "@kumix/ui/motion/theme-toggle";
import { Badge } from "@kumix/ui/reui/badge";
import { Button } from "@kumix/ui/ui/button";
import { queryClient, setApiToken } from "@/lib/api";
import packageJson from "../../../package.json";
import { EngineStatus } from "./EngineStatus";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { Logo } from "./Logo";

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

function isPathActive(pathname: string, to: string) {
  return to === "/" ? pathname === "/" : pathname.startsWith(to);
}

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
  const [confirmLogout, setConfirmLogout] = useState(false);
  const t = useTranslations("Shell");
  const common = useTranslations("Common");
  const tNav = useTranslations("Shell.navigation");
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    document.title = `${title} - Kumix Worker`;
  }, [title]);

  const activePage = useMemo(() => {
    const all = [...navItems, ...navItemsSecondary];
    const found = all.find((item) => isPathActive(location.pathname, item.to));
    return found ? tNav(found.key) : title;
  }, [location.pathname, title, tNav]);

  const logout = () => {
    setApiToken("");
    queryClient.clear();
    window.location.reload();
  };

  const go = (to: string) => navigate(to);

  return (
    <AnimatedSidebarProvider className="h-screen overflow-hidden">
      <AnimatedSidebar ariaLabel="Kumix Worker" collapsible="icon" className="min-h-0">
        <AnimatedSidebarHeader className="p-3 pb-2">
          <div className="flex min-h-11 items-center gap-3 overflow-hidden px-2">
            <Link to="/" className="flex items-center gap-2">
              <Logo />
              <span className="font-semibold text-base text-mono group-data-[state=collapsed]/sidebar:hidden">
                Worker
              </span>
            </Link>
            <AnimatedSidebarTrigger
              className="ms-auto text-muted-foreground hover:bg-muted md:hidden"
              aria-label={t("toggleSidebar")}
            >
              <X aria-hidden="true" className="size-4" />
            </AnimatedSidebarTrigger>
          </div>
        </AnimatedSidebarHeader>

        <AnimatedSidebarContent className="px-2 pt-1">
          <AnimatedSidebarGroup className="pb-2">
            <AnimatedSidebarGroupLabel className="group-data-[state=collapsed]/sidebar:hidden">
              {tNav("dashboard")}
            </AnimatedSidebarGroupLabel>
            <AnimatedSidebarGroupContent>
              <AnimatedSidebarMenu>
                {navItems.map(({ to, key, icon: Icon }) => (
                  <AnimatedSidebarMenuItem key={to}>
                    <AnimatedSidebarMenuButton
                      icon={<Icon className="size-4" />}
                      isActive={isPathActive(location.pathname, to)}
                      onSelect={() => go(to)}
                    >
                      {tNav(key)}
                    </AnimatedSidebarMenuButton>
                  </AnimatedSidebarMenuItem>
                ))}
              </AnimatedSidebarMenu>
            </AnimatedSidebarGroupContent>
          </AnimatedSidebarGroup>

          <AnimatedSidebarGroup className="pt-1">
            <AnimatedSidebarGroupLabel className="group-data-[state=collapsed]/sidebar:hidden">
              {tNav("live_streams")}
            </AnimatedSidebarGroupLabel>
            <AnimatedSidebarGroupContent>
              <AnimatedSidebarMenu>
                {navItemsSecondary.map(({ to, key, icon: Icon }) => (
                  <AnimatedSidebarMenuItem key={to}>
                    <AnimatedSidebarMenuButton
                      icon={<Icon className="size-4" />}
                      isActive={isPathActive(location.pathname, to)}
                      onSelect={() => go(to)}
                    >
                      {tNav(key)}
                    </AnimatedSidebarMenuButton>
                  </AnimatedSidebarMenuItem>
                ))}
              </AnimatedSidebarMenu>
            </AnimatedSidebarGroupContent>
          </AnimatedSidebarGroup>
        </AnimatedSidebarContent>

        <AnimatedSidebarFooter className="gap-3 border-none p-3">
          <div className="flex min-h-9 items-center justify-between gap-2 px-2 group-data-[state=collapsed]/sidebar:hidden">
            <EngineStatus />
            <Badge variant="primary-light" radius="full" className="font-normal">
              v{packageJson.version}
            </Badge>
          </div>
        </AnimatedSidebarFooter>

        <AnimatedSidebarRail />
      </AnimatedSidebar>

      <AnimatedSidebarInset className="min-h-0 bg-background">
        <header className="flex h-16 shrink-0 items-center gap-3 border-border border-b px-4">
          <AnimatedSidebarTrigger
            className="text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t("toggleSidebar")}
          >
            <PanelLeft aria-hidden="true" className="size-4" />
          </AnimatedSidebarTrigger>
          <div className="h-5 w-px bg-border" />
          <p className="flex-1 truncate font-medium text-foreground text-sm">{activePage}</p>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <LocaleSwitcher />
            <Button size="icon" variant="outline">
              <ThemeToggle variant="circle-blur" start="bottom-up" />
            </Button>
            <Button
              size="icon"
              variant="destructive"
              aria-label={t("logout")}
              onClick={() => setConfirmLogout(true)}
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </header>

        <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto bg-background p-4 sm:p-6">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
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
          </div>
        </div>
      </AnimatedSidebarInset>

      <ConfirmSignOut
        open={confirmLogout}
        onOpenChange={setConfirmLogout}
        onConfirm={logout}
        title={t("logoutTitle")}
        description={t("logoutDescription")}
        confirmText={common("confirm")}
        cancelText={common("cancel")}
      />
    </AnimatedSidebarProvider>
  );
}
