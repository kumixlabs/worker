import { useState } from "react";

const KEY = "kumix-sidebar-open";

// ponytail: localStorage only — swap for cross-tab sync if multi-window dashboards ever matter
export function useSidebarOpen() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(KEY) !== "collapsed";
    } catch {
      return true;
    }
  });
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(KEY, next ? "open" : "collapsed");
    } catch {
      /* private mode */
    }
  };
  return { open, onOpenChange };
}
