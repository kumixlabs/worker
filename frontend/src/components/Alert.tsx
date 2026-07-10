import type { ComponentProps, ReactNode } from "react";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
  InfoIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertContent, AlertDescription, AlertIcon, AlertTitle } from "@kumix/ui";

type AlertIconKey = "primary" | "success" | "info" | "warning" | "destructive";

interface AlertToastOptions {
  message?: string;
  description?: string;
  icon?: ComponentProps<typeof Alert>["icon"];
  variant?: ComponentProps<typeof Alert>["variant"];
  /**
   * Stable id for de-duplication or updating an existing toast. When omitted,
   * each call creates a brand-new toast (stacking behavior).
   */
  id?: string | number;
  /** Auto-dismiss duration in ms. Defaults to 4000. */
  duration?: number;
}

const iconMap = {
  primary: <CircleAlertIcon />,
  success: <CircleCheckIcon />,
  info: <InfoIcon />,
  warning: <TriangleAlertIcon />,
  destructive: <CircleXIcon />,
} satisfies Record<AlertIconKey, ReactNode>;

function showAlertToast({
  message,
  description,
  icon = "success",
  variant = "mono",
  id,
  duration = 4000,
}: AlertToastOptions & { message: string }) {
  const iconKey: AlertIconKey = (icon as AlertIconKey) ?? "success";

  toast.custom(
    () => (
      <Alert variant={variant} icon={icon}>
        <AlertIcon>{iconMap[iconKey]}</AlertIcon>
        {!description ? (
          <AlertTitle>{message}</AlertTitle>
        ) : (
          <AlertContent>
            <AlertTitle>{message}</AlertTitle>
            <AlertDescription>{description}</AlertDescription>
          </AlertContent>
        )}
      </Alert>
    ),
    { duration, id },
  );
}

export function AlertToast({
  message = "This is a toast",
  description,
  icon = "success",
  variant = "mono",
  id,
  duration,
}: AlertToastOptions = {}) {
  showAlertToast({ message, description, icon, variant, id, duration });
}

export function AlertSuccess({
  message = "This is a success toast",
  description,
  variant = "mono",
  id,
  duration,
}: AlertToastOptions = {}) {
  showAlertToast({ message, description, icon: "success", variant, id, duration });
}

export function AlertError({
  message = "This is a error toast",
  description,
  variant = "mono",
  id,
  duration,
}: AlertToastOptions = {}) {
  showAlertToast({ message, description, icon: "destructive", variant, id, duration });
}
