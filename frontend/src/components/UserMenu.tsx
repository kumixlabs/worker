import { CircleSlash2, LayoutDashboard, LogOut, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslations } from "use-intl";

import { toastError } from "@kumix/ui/custom/toast";
import { Avatar, AvatarFallback } from "@kumix/ui/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@kumix/ui/ui/dropdown-menu";
import { getInitials } from "@kumix/utils";
import { authClient } from "@/lib/auth";

function initialsOf(name?: string | null, email?: string | null) {
  return getInitials(name?.trim() || email?.split("@")[0] || "?", 2) || "?";
}

export function UserMenu({ onLogout }: { onLogout: () => void }) {
  const t = useTranslations("Shell");
  const tNav = useTranslations("Shell.navigation");
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const name = session?.user?.name ?? "";
  const email = session?.user?.email ?? "";
  const isAdmin = session?.user?.role === "admin";
  const impersonating = Boolean(session?.session?.impersonatedBy);

  const stopImpersonating = async () => {
    const res = await authClient.admin.stopImpersonating();
    if (res.error) {
      toastError({ message: res.error.message ?? t("stopImpersonatingFailed") });
      return;
    }
    window.location.href = "/admin/users";
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
        <Avatar className="size-8">
          <AvatarFallback className="bg-primary/10 font-medium text-primary text-xs">
            {initialsOf(name, email)}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={10} className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <div className="flex flex-col">
              <span className="text-foreground text-sm">{name}</span>
              <span className="text-muted-foreground text-xs">{email}</span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {impersonating ? (
            <>
              <DropdownMenuItem onClick={() => void stopImpersonating()}>
                <CircleSlash2 className="size-4 opacity-60" aria-hidden="true" />
                {t("stopImpersonating")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {isAdmin ? (
            <DropdownMenuItem onClick={() => navigate("/admin")}>
              <LayoutDashboard className="size-4 opacity-60" aria-hidden="true" />
              {t("adminDashboard")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => navigate("/settings")}>
            <Settings className="size-4 opacity-60" aria-hidden="true" />
            {tNav("settings")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onLogout}>
            <LogOut className="size-4" aria-hidden="true" />
            {t("logout")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
