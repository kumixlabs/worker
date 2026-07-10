import type { ReactNode } from "react";

import { cn } from "@kumix/utils";

export function MaxWidthWrapper({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("mx-auto w-full max-w-7xl", className)}>{children}</div>;
}
