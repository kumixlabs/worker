import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslations } from "use-intl";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@kumix/ui";

export function ModeSwitcher() {
  const t = useTranslations("Shell");
  const { setTheme, theme } = useTheme();

  const isActive = (val: "light" | "dark" | "system") => theme === val;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
          {theme === "system" ? <MonitorIcon /> : theme === "dark" ? <MoonIcon /> : <SunIcon />}
          <span className="sr-only">{t("mode.toggle")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuItem
          className={isActive("light") ? "bg-accent" : ""}
          onClick={() => setTheme("light")}
        >
          <SunIcon />
          {t("mode.light")}
        </DropdownMenuItem>
        <DropdownMenuItem
          className={isActive("dark") ? "bg-accent" : ""}
          onClick={() => setTheme("dark")}
        >
          <MoonIcon />
          {t("mode.dark")}
        </DropdownMenuItem>
        <DropdownMenuItem
          className={isActive("system") ? "bg-accent" : ""}
          onClick={() => setTheme("system")}
        >
          <MonitorIcon />
          {t("mode.system")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
