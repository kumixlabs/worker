import type { ReactNode } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";

import { NotFound, RouteError } from "@/components/RouteFallback";
import { authClient } from "@/lib/auth";
import { MonitoringPage } from "@/routes/admin/monitoring";
import { AdminOverviewPage } from "@/routes/admin/overview";
import { AdminSettingsPage } from "@/routes/admin/settings";
import { UsersPage } from "@/routes/admin/users";
import { ChannelsPage } from "@/routes/channels";
import { Dashboard } from "@/routes/index";
import { LogPage } from "@/routes/log";
import { MediaPage } from "@/routes/media";
import { PlaylistDetailPage } from "@/routes/playlist-detail";
import { PlaylistsPage } from "@/routes/playlists";
import { SettingsPage } from "@/routes/settings";
import { StreamsPage } from "@/routes/streams";

function RequireAdmin({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  if (isPending) return null;
  if (session?.user?.role !== "admin") return <Navigate to="/" replace />;
  return children;
}

const router = createBrowserRouter([
  { path: "/", element: <Dashboard />, errorElement: <RouteError /> },
  {
    path: "/monitoring",
    element: <Navigate to="/admin/monitoring" replace />,
  },
  {
    path: "/admin/monitoring",
    element: (
      <RequireAdmin>
        <MonitoringPage />
      </RequireAdmin>
    ),
    errorElement: <RouteError />,
  },
  { path: "/media", element: <MediaPage />, errorElement: <RouteError /> },
  { path: "/channels", element: <ChannelsPage />, errorElement: <RouteError /> },
  { path: "/playlists", element: <PlaylistsPage />, errorElement: <RouteError /> },
  { path: "/playlists/:id", element: <PlaylistDetailPage />, errorElement: <RouteError /> },
  { path: "/streams", element: <StreamsPage />, errorElement: <RouteError /> },
  { path: "/log", element: <LogPage />, errorElement: <RouteError /> },
  { path: "/users", element: <Navigate to="/admin/users" replace /> },
  {
    path: "/admin",
    element: (
      <RequireAdmin>
        <AdminOverviewPage />
      </RequireAdmin>
    ),
    errorElement: <RouteError />,
  },
  {
    path: "/admin/users",
    element: (
      <RequireAdmin>
        <UsersPage />
      </RequireAdmin>
    ),
    errorElement: <RouteError />,
  },
  {
    path: "/admin/settings",
    element: (
      <RequireAdmin>
        <AdminSettingsPage />
      </RequireAdmin>
    ),
    errorElement: <RouteError />,
  },
  { path: "/settings", element: <SettingsPage />, errorElement: <RouteError /> },
  { path: "*", element: <NotFound /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
