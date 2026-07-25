import type { ComponentProps, ReactNode } from "react";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
  InfoIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@kumix/ui/reui/alert";

type AlertIconKey = "primary" | "success" | "info" | "warning" | "destructive";
type AlertVariant = NonNullable<ComponentProps<typeof Alert>["variant"]>;

interface AlertToastOptions {
  message?: string;
  description?: string;
  icon?: AlertIconKey;
  variant?: AlertVariant;
  id?: string | number;
  duration?: number;
}

const iconMap = {
  primary: <CircleAlertIcon />,
  success: <CircleCheckIcon />,
  info: <InfoIcon />,
  warning: <TriangleAlertIcon />,
  destructive: <CircleXIcon />,
} satisfies Record<AlertIconKey, ReactNode>;

const variantByIcon: Record<AlertIconKey, AlertVariant> = {
  primary: "default",
  success: "success",
  info: "info",
  warning: "warning",
  destructive: "destructive",
};

function showAlertToast({
  message,
  description,
  icon = "success",
  variant,
  id,
  duration = 4000,
}: AlertToastOptions & { message: string }) {
  const iconKey: AlertIconKey = icon ?? "success";
  const resolvedVariant = variant ?? variantByIcon[iconKey];

  toast.custom(
    () => (
      <Alert variant={resolvedVariant} className="bg-background shadow-lg">
        {iconMap[iconKey]}
        {description ? (
          <>
            <AlertTitle>{message}</AlertTitle>
            <AlertDescription>{description}</AlertDescription>
          </>
        ) : (
          <AlertTitle>{message}</AlertTitle>
        )}
      </Alert>
    ),
    { duration, id },
  );
}

export function AlertToast({
  message = "Toast",
  description,
  icon = "success",
  variant,
  id,
  duration,
}: AlertToastOptions = {}) {
  showAlertToast({ message, description, icon, variant, id, duration });
}

export function AlertSuccess({
  message = "Success",
  description,
  variant,
  id,
  duration,
}: AlertToastOptions = {}) {
  showAlertToast({ message, description, icon: "success", variant, id, duration });
}

export function AlertError({
  message = "An error occurred",
  description,
  variant,
  id,
  duration,
}: AlertToastOptions = {}) {
  showAlertToast({ message, description, icon: "destructive", variant, id, duration });
}
