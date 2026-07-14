import { createBrowserRouter, RouterProvider } from "react-router-dom";

import { NotFound, RouteError } from "@/components/RouteFallback";
import { Dashboard } from "@/routes/index";
import { LogPage } from "@/routes/log";
import { MonitoringPage } from "@/routes/monitoring";
import { SettingsPage } from "@/routes/settings";
import { SourcesPage } from "@/routes/sources";
import { StreamsPage } from "@/routes/streams";
import { StreamAnalyticsPage } from "@/routes/streams.analytics";
import { NewStreamPage } from "@/routes/streams.new";
import { TargetsPage } from "@/routes/targets";

const router = createBrowserRouter([
  { path: "/", element: <Dashboard />, errorElement: <RouteError /> },
  { path: "/monitoring", element: <MonitoringPage />, errorElement: <RouteError /> },
  { path: "/log", element: <LogPage />, errorElement: <RouteError /> },
  { path: "/settings", element: <SettingsPage />, errorElement: <RouteError /> },
  { path: "/streams", element: <StreamsPage />, errorElement: <RouteError /> },
  { path: "/streams/new", element: <NewStreamPage />, errorElement: <RouteError /> },
  { path: "/streams/:id", element: <StreamAnalyticsPage />, errorElement: <RouteError /> },
  { path: "/sources", element: <SourcesPage />, errorElement: <RouteError /> },
  { path: "/targets", element: <TargetsPage />, errorElement: <RouteError /> },
  { path: "*", element: <NotFound /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
