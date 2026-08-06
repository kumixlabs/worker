# Changelog

All notable changes to Kumix Worker will be documented in this file.

## [0.4.4] - Unreleased

### Changed

- TanStack Table upgraded from v8 to v9: `useReactTable` → `useTable`, row model getters (`getCoreRowModel`, `getFilteredRowModel`, etc.) replaced by `features: dataGridFeatures` bundle from `@kumix/ui`. Exposed `GridColumnDef<T>` helper type from `DataTable` so route files no longer import `ColumnDef` directly.

## [0.4.3] - Unreleased

### Added

- Keyframe interval detection: FFprobe now samples the first 11 I-frames of each source to calculate the average keyframe interval. Displayed in the source detail dialog (e.g. "2s", "8s") so operators can identify sources that may trigger YouTube's "infrequent keyframes" warning before streaming.
- `keyframe_interval` column added to the sources table via automatic `tryColumnMigration` (no manual ALTER required).
- DataTable skeleton loading: all tables (sources, streams, targets, log) now show shimmer placeholders per-column while data is loading instead of empty rows.
- TanStack DevTools integration: React Query inspector panel available in development mode (bottom-right floating button). Fully tree-shaken from production builds.

### Changed

- Source download status now set to `"downloading"` immediately before DNS validation, eliminating the brief `"pending"` delay that appeared in the dashboard after adding a source.

### Fixed

- Source normalization / re-encoding feature removed. Downloaded sources are probed and used as-is — no transcoding, no quality loss, no wait time. The previous CRF 23 + veryfast preset degraded source bitrate by ~40%. Keyframe compliance will be handled at stream/render time instead.
- `/docs` (Scalar API reference) now loads correctly — CSP relaxed for the Scalar CDN and inline scripts on that route only.
- Keyframe probe uses `pkt_pts_time,pict_type` format compatible with both ffprobe-static 4.0.2 and system ffprobe 7.x.

## [0.4.2] - 2026-08-05

### Added

- Source normalization: downloaded videos are now automatically transcoded to YouTube-safe H.264/AAC with a fixed 2-second keyframe interval (GOP) during the download phase. This fixes YouTube's "infrequent keyframes" warning and prevents buffering. Normalization runs once per source — streaming stays `-c:v copy` with zero live CPU overhead.
- New source status `normalizing` shown in the dashboard during the transcode step (with i18n support in en/id).
- `buildNormalizeArgs()` exported from `probe.ts` for testability — generates FFmpeg args with `libx264 -preset veryfast -crf 23 -g fps*2 -keyint_min fps*2 -sc_threshold 0 -pix_fmt yuv420p`.

### Changed

- `getInvalidProbeReason()` no longer rejects non-H.264 codecs or high bitrates — normalization handles all codec conversions. Only checks for presence of video and audio streams.
- `probeAndUpdateSource()` flow is now: probe → normalize → re-probe → ready. Temp file (`.normalized.mp4`) is cleaned up on failure.

### Fixed

- `@tanstack/react-table` pinned to 8.21.3 via workspace catalog to prevent accidental v9 upgrade (incompatible with `@kumix/ui` DataGrid).

## [0.4.1] - 2026-08-04

### Added

- One-line VPS installer (`install.sh`): `sudo curl | bash` — auto `apt update + upgrade`, installs Node.js 24 + system FFmpeg, sets `KUMIX_WORKER_FFMPEG_PATH`/`FFPROBE_PATH` env vars, creates systemd service with auto-start. Requires root. Includes `--uninstall`.
- Bandwidth/data usage tracking: FFmpeg `size=` output parsed to track total bytes sent per stream. Dashboard shows upload today, this month, and all-time totals.
- `GET /api/bandwidth` endpoint returns aggregated bandwidth summary (today, month, all-time, per-stream breakdown, 30-day daily series).
- `bandwidth_log` table stores periodic byte deltas (60s interval) with 90-day auto-prune.
- `network.sessionBytes` added to `/api/metrics` for live session outbound total.
- `bytesSent` field on stream records (list + detail) shows per-stream cumulative upload.

### Fixed

- CSP `img-src` now allows `https://*.ytimg.com` and `https://*.ggpht.com` so YouTube thumbnails render on the stream analytics page.

## [0.4.0] - 2026-08-02

Dashboard redesign: animated collapsible sidebar, Frame-based card system, enhanced DataTable with DataGrid, animated toast system, and UI library upgrade to `@kumix/ui` 0.3.x.

### Breaking

- `@kumix/ui` peer dependency bumped to `^0.3.1`; `@kumix/utils` bumped to `^0.1.3`.
- `sonner` dependency removed from the frontend bundle. All toast notifications now use `@kumix/ui/custom/toast` (`toastSuccess`, `toastError`).
- `shadcn` moved from `dependencies` to `devDependencies` in the frontend package (CSS resolution only).
- Local `Alert.tsx`, `ConfirmDialog.tsx`, `MaxWidthWrapper.tsx`, `ModeSwitcher.tsx` components deleted from the frontend. Replaced by `@kumix/ui` equivalents.
- `LogoWithHref` export removed from `Logo.tsx` (dead code).

### Added

#### Dashboard UI

- Animated collapsible sidebar (`@kumix/ui/motion/animated-sidebar`): icon rail mode, mobile overlay, keyboard shortcut (⌘B), active-route highlighting, and a header breadcrumb showing the current page name.
- `ThemeToggle` from `@kumix/ui/motion/theme-toggle` replaces the local `ModeSwitcher` component.
- `ConfirmSignOut` from `@kumix/ui/custom/confirm-dialog` replaces the local `ConfirmDialog` for sign-out confirmation.
- `Frame` / `FramePanel` / `FrameHeader` / `FrameFooter` / `FrameTitle` card system (`@kumix/ui/reui/frame`) replaces `Card` / `CardContent` across all 9 route pages.
- Animated toast system (`@kumix/ui/custom/toast`) with `ToastContainer`, `toastSuccess`, and `toastError` helpers — mounted in `Providers.tsx`.
- `InputGroup`-based search bar in `DataTable` with a clear-search button.
- i18n key `Common.clearSearch` added to both `en.json` and `id.json`.

### Changed

- All `Card`/`CardContent`/`CardFooter` usage across the frontend replaced with `Frame`/`FramePanel`/`FrameFooter`.
- All `@kumix/ui/ui/button` and `@kumix/ui/ui/input` imports in `AuthGate.tsx` replaced with `@kumix/ui/motion/button/base` and `@kumix/ui/motion/input`.
- `StatusBadge` variants changed to `-light` suffix (`success-light`, `warning-light`, `destructive-light`) for softer dashboard appearance.
- `DataTable` rewritten to use `DataGridTable`, `DataGridScrollArea`, `DataGridTableRowSelect`, `DataGridTableRowSelectAll` from `@kumix/ui/reui/data-grid` instead of manual `Checkbox`/`ScrollArea` wrappers.
- `DataTable` restores local non-memoized `SortableHeader` to fix sort UI freeze caused by `DataGridColumnHeader`'s `memo()` wrapper (stable column ref blocks re-render on sort state change).
- Mobile sidebar width `--sidebar-width-mobile` set to `26rem` in `:root` (`styles.css`) because CSS vars on the sidebar/provider don't reach `createPortal` content.
- `vite.config.ts` manual chunks split: `framer-motion`/motion components → `motion` chunk, `lucide-react` → `icons` chunk. All chunks now under 500 KB.
- `vite.config.ts` `__dirname` → `import.meta.dirname` (Vite 8 ESM).
- `vitest.config.ts` `__dirname` → `import.meta.dirname`.
- Stale frontend smoke test updated: `Checkbox`/`onCheckedChange` assertions → `DataGridTableRowSelect`/`DataGridTableRowSelectAll`.
- `NumberField` `onValueChange` handler fixed: Base UI passes `(value: number, event?)`, not a DOM event — was using `event.target.value`.

### Removed

- 8 dead i18n keys: `Shell.closeSidebar`, `Shell.mode.{toggle,light,dark,system}`, `Common.selectAll`, `Common.selectRow`, `Settings.apiTokenLength` (all orphaned by UI migration).
- Unused `NumberFieldScrubArea` import from `settings.tsx`.
- Removed `--text-2xs`, `--text-2sm` custom font-size CSS variables and `container`/`container-fluid` utilities from `styles.css` (unused after Frame migration).

### Fixed

#### Backend bugs

- **`stopAllStreams` now clears pending restart timers** (`stream-runner.ts`): previously, streams in the FFmpeg reconnect window (exited process, pending restart timer) were missed during graceful shutdown. The restart timer could fire after `process.exit`, spawning an orphaned FFmpeg process and causing double-start on auto-resume. Restart timers are now cleared and those streams marked `stopped`.
- **PATCH target response now includes `streamKeyMasked`** (`db/targets.ts`): `patchTarget` destructured out the `streamKey` cipher before returning, so `safeTarget()` received no cipher to decrypt/mask. Now returns the full row; `safeTarget` correctly produces the masked key.
- **`clearTimeout` in `client.ts` actually fires**: `.unref?.()` returned `undefined`, making the `timeout` variable always falsy so `clearTimeout` in the `finally` block was dead code. Timer handle is now stored before calling `.unref()`.
- **Source retry marks invalid on failure** (`routes/sources.ts`): the retry endpoint (`POST /api/sources/:id/retry`) only logged to console on failure, leaving the source stuck in its prior state. Now mirrors the create path: marks `invalid`, emits `source_download_failed` event.
- **Stream PATCH/start return 404 instead of `ok(null)` on race** (`routes/streams.ts`): if a stream was deleted between the existence check and `patchStream`/`startStream`, the route returned `ok(null)` (HTTP 200 with `{ ok: true }` and no data). Now returns 404.

## [0.3.2] - 2026-07-28

Patch: auth token now persists in `localStorage` (survives tab close) and the restart-exhausted failure path includes the same FFmpeg stderr diagnostic as `restart_scheduled`.

### Fixed

- Restart-exhausted `failed` event now includes FFmpeg stderr diagnostic (exit reason + last 3 stderr lines, redacted, ≤500 chars) in the event message and `payload.diagnostic` — matching the `restart_scheduled` fix from 0.3.1. Previously the exhaustion path had no diagnostic, leaving operators blind to the final failure cause.
- AuthGate stale comment corrected after `sessionStorage` → `localStorage` migration.

### Changed

- Dashboard auth token storage moved from `sessionStorage` to `localStorage`. Sessions now survive tab/window close and persist until server-side `expiresAt` (7-day session). Tab-scoped behavior lost; operators who need it can clear storage manually.

Patch: include FFmpeg stderr diagnostic in `restart_scheduled` event payload so operators can see why FFmpeg exited (code/signal + last 3 stderr lines).

### Fixed

- `restart_scheduled` event now includes exit reason + FFmpeg stderr diagnostic (last 3 lines, redacted, ≤500 chars) in both the event **message** (visible in dashboard Log) and **payload.diagnostic** field. Previously the diagnostic was written to stream `lastError` but cleared on successful restart, leaving no persistent record of the exit cause.

## [0.3.0] - 2026-07-26

Production-hardening release: dashboard password auth (separate from API token), security headers/CSP, tighter rate limits, SQLite/hot-path performance, download concurrency caps, graceful shutdown, and dashboard UX polish.

### Breaking

- Dashboard sign-in is **password-based**, not API-token paste. Factory default password is `123456`; first login with the default forces a password change in the SPA.
- `POST /api/auth/verify` removed. Use `POST /api/auth/login` with `{ password }` (returns session `token`, `expiresAt`, `passwordIsDefault`).
- CLI `serve` / `init` never embed the API token in printed dashboard URLs. Open the Dashboard URL and sign in with the password. Core handoff remains `GET /auth?token=…` → `#code=` exchange.
- Bootstrap / core link metadata: `dashboardPath` is `"/"` (was `"/auth?token={token}"`). `tokenLength` dropped from public link payload.
- `serve --dev` no longer prints a full auth URL or raw token on boot (use `kumix-worker token --show` when needed).
- Source probe no longer stores SHA-256 (hash step removed from probe path).
- Auth failure rate limit: **10** / 60s / IP (was 30).

### Added

#### Dashboard password auth

- `passwordHash` in `config.json` (async scrypt: `scrypt$N$r$p$salt$hash`). Older configs without a hash are migrated on read to a factory-default hash.
- `POST /api/auth/login` — password → Bearer session token for the SPA.
- `POST /api/settings/password` — change password (Bearer). Does **not** rotate the API token, re-encrypt stream keys, or invalidate other Bearer sessions. Wrong current password returns **400** (not 401) so the SPA session is not cleared; still counts toward auth rate limit.
- CLI `kumix-worker password --password <pw>` to reset the dashboard password.
- Settings API exposes `hasPassword` and `passwordIsDefault` (never `passwordHash` or raw token).
- SPA force-change gate when `passwordIsDefault`; revalidates from `GET /api/settings` so a CLI password reset unblocks the gate.
- Settings **Security** tab: change password, regenerate API token (client-generated; server returns `{ rotatedAt, tokenLength }` only).
- Password rules: 6–128 chars; reject factory default `123456` on change (Zod schema + CLI `validPassword`); N/r/p allowlisted so corrupt config cannot DoS via scrypt params; invalid `passwordHash` fails closed (no silent fallback to default).

#### Security & HTTP

- Response headers on all routes: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, basic CSP (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, etc.).
- Unknown `/api/*` paths return a JSON 404 envelope (before SPA static fallback).
- Bearer scheme matching is case-insensitive; token value trimmed.
- `currentToken()` — mtime-cached token for hot crypto/HMAC paths (avoids re-reading full settings every call).
- Token rotation serialized (promise chain) with reencrypt rollback if `writeSettings` fails; never echoes the new token.
- CLI `init` / `token --regenerate` reencrypt rollback on config write failure.

#### Runtime & reliability

- SQLite: `busy_timeout=5000` and prepared-statement cache in `getDb()`.
- Stats via `GROUP BY` counts (no full table loads); `listTargetsWithKeys()` for bulk key ops.
- Concurrent source download+probe capped at **2**.
- Scheduler re-entry guard on `startScheduler`; recurring streams may auto-start from **`failed`** when due (in addition to `pending` / `stopped`).
- Storage metrics cache TTL 5s → 30s with shared async refresh helper.
- Event **export** paginates beyond the list limit of 200 (batches of 500).
- SSE: unified cleanup, per-stream live `onStreamEvent` plus filtered global history; NaN `limit` on `/api/events` falls back to 200.
- `stopAllStreams` waits on process `exit`/`error` with timeout race (not busy poll).
- Graceful shutdown: `server.close` races a 5s timeout so hung SSE clients cannot block exit; `unhandledRejection` / `uncaughtException` logged in `serve`.
- Stream start: clear residual `stopRequested` and force-stop if stop arrived before FFmpeg spawn; clean `stopRequested` on failed start paths.
- Google Drive: confirmation URL must resolve or fail — never fall back to HTML quarantine page; cookie-carrying fetch only for GDrive flow.
- Download disk allowance re-measured every 512 MB written mid-download.
- Static assets served via streaming `createReadStream` + `content-length` (not full-file buffer).
- Public client: Zod schema parse failures marked non-retryable.
- Signed-path query sort uses stable key/value compare (not locale-dependent string concat).

#### Dashboard UX

- Password login UI + forced default-password change flow (EN/ID strings).
- API token stored in **sessionStorage** (tab-scoped; falls back to localStorage if sessionStorage unavailable); honors server `expiresAt`.
- Local `SortableHeader` in DataTable/Log (avoids `@kumix/ui` `DataGridColumnHeader` memo freezing sort UI).
- Streams source/target columns sort by name via `accessorFn`.
- Select labels use children maps where value ≠ display text (sources, log, create stream stop/recurrence).
- Root `ErrorBoundary` with reload; queryFns accept `AbortSignal`; polling uses `refetchIntervalInBackground: false`.
- Settings tabs: General vs Security; stop-stream confirm copy.
- `@kumix/ui` per-file imports (`@kumix/ui/ui/*`, `@kumix/ui/reui/*`).

#### Docs & tests

- `AGENTS.md`, `README.md`, `README.id-ID.md`, `DOCKER.md` updated for password login, security headers, CLI, CORS env, dual install.
- Tests: password hash/verify, login, password change, reject factory default, CSP/security headers, auth rate limit at 10, events NaN limit, config password seeding.

### Fixed

- Stop stream API returns 404 when the stream is missing (was a loose success).
- Stream create/patch requires source status `ready` and validates target existence on patch.
- YouTube analytics: not-found / private / bad video ID stay 400; other upstream failures return **502** `UPSTREAM_ERROR`.
- Recovery path uses the status returned from `setStreamStatus` (avoids extra read races).
- Internal HTTP error logs print `error.message` only (less noisy stack dumps).
- Log page: older-events load errors swallowed for retry; older buffer capped; Select/Popover aligned with current UI kit.

### Changed

- Dashboard password and API token are separate concerns: password = SPA login; token = Bearer API + stream-key AES root + signed-URL HMAC.
- Password change does not invalidate existing Bearer sessions (documented).
- CLI `status` prints API token length, not a masked token; help text documents password vs token.
- Dependency bumps: `better-sqlite3` 13.x, `hono` 4.12.32, `undici` 8.9.0, biome/bumpp/concurrently, frontend lockfile refresh.
- Package version **0.3.0**.

### Migration notes

1. Upgrade and start the worker once so `config.json` gains `passwordHash` (default password `123456` until you change it).
2. Sign in with `123456`, complete the forced password change (or run `kumix-worker password --password <pw>`).
3. Integrations that opened `/auth?token=…` still work for handoff; printed CLI/Docker URLs are password login only.
4. Any client calling `POST /api/auth/verify` must switch to `POST /api/auth/login`.
5. If you relied on source SHA-256 in the UI/API, that field is no longer populated on new probes.

## [0.2.1] - 2026-07-19

### Added

- Auto-resume active streams after graceful restart (Docker stop / compose recreate / SIGTERM): writes auto-start marker on shutdown, starts those streams again on boot. Disable with `KUMIX_WORKER_AUTO_RESUME=0`.
- Searchable Combobox for Video Source and Stream Target on Create Live Task and Edit Stream dialogs.
- Scheduler always reconciles orphaned DB streams stuck in `running`/`stopping` when FFmpeg is no longer tracked (including stale tombstones with dead PIDs).
- `isFfmpegProgressLine` helper and progress-line filtering so FFmpeg `frame=`/`fps=` noise never becomes events.
- Dashboard stats include `stopping` stream count; event badges for `restart_scheduled`, `restart_failed`, `reconciled`.

### Fixed

- Streams stuck in `running` after FFmpeg exit: concurrent `setStreamStatus` transition failures no longer leave the process map empty while DB stays `running`; settle now force-writes status via raw SQL fallback and keeps the tombstone when the write fails.
- Start path: if post-spawn status write fails, kill FFmpeg, clear process map/tombstone, mark failed.
- Stop during in-flight start: `stopStream` honors `startingStreams` / process map even while status is still `pending`.
- Settle listens for both process `close` and `exit` so status always finalizes.
- FFmpeg progress output split on `\r` and `\n` (progress used CR-only updates), preventing multi-megabyte single-line events and hung Log page / export.
- Dropped live `ffmpeg_log` / `ffmpeg_error` event spam; fail messages keep only a short non-progress diagnostic tail (max 5 lines, 1KB).
- Log page SSE: skip `metrics` payloads, batch live event UI updates every 250ms, clear reconnect timer on unmount.
- Dashboard shell layout: lock document scroll (`html`/`body`/`#root`), pin sidebar with sticky engine/version footer, single scroll owner on main content.
- YouTube API key never returned from settings (`hasYoutubeApiKey` only); blank PATCH keeps existing key.
- Token rotation requires the same strength rules as CLI tokens (`validToken`).
- Auth body limit applied before public auth routes; login form shown on all routes (not only `/`).
- Bulk delete reports missing IDs as failed instead of deleted; invalid schedule strings return 400.
- Source download cancel no longer races retry (abort map cleared only in download `finally`).
- HTTP Range suffix form `bytes=-N` serves the last N bytes.
- Streams list polls every 5s; create stream validates source/target existence.
- OpenAPI version matches package version; Docker install uses bun lockfile; CI pins Bun 1.3.14.
- `youtubeApiKey` optional on `WorkerSettings` so tests and partial settings payloads typecheck cleanly.

### Changed

- Source video always loops (`-stream_loop -1`); schedule/auto-stop controls duration. Loop checkbox removed from Create/Edit.
- FFmpeg reconnect: unexpected exit keeps stream `running`, auto-restarts up to 12 times (budget resets after 10 minutes healthy), then fails; scheduler ignores reconnect window.
- FFmpeg FLV output uses `-flvflags no_duration_filesize` for more reliable RTMP ingest.
- FFmpeg diagnostic buffer capped at 10 lines × 500 chars (non-progress only); metrics still parsed for Monitoring.
- Edit stream available on all statuses (YouTube Live URL editable while running/stopping; other fields locked).
- Edit stream uses auto-stop schedule field instead of historical stopped-at time.
- Date/time pickers emit wall-clock values in the worker timezone (not browser local).
- Auth handoff uses `#code=` fragment; query `?code=` still accepted for older links.
- Recurrence UI no longer requires an auto-stop mode on Create Live Task.
- Public client skips retries on 4xx responses.
- Dashboard attention count uses failed streams + invalid sources only (no event double-count).
- Docker release job verifies git tag matches `package.json` version.

## [0.2.0] - 2026-07-15

### Added

- YouTube Live Analytics: concurrent viewers, total views, likes, and comments on a dedicated `/streams/:id` page with 30-second auto-refresh.
- YouTube Data API v3 key configuration in Settings.
- YouTube live URL field in Create Stream and Edit Stream dialogs.
- Analytics action in stream dropdown menu (visible when YouTube live URL is set).
- Edit Stream dialog now allows editing the YouTube live URL while a stream is running; all other fields are disabled during run.
- `youtube_live_url` column added to streams table with automatic `ALTER TABLE` migration for existing databases.
- `extractVideoId` supports `youtube.com/watch`, `youtu.be`, `/live/`, `/embed/`, `/shorts/` URLs, and raw 11-character video IDs.

### Fixed

- Removed `-timeout 30000000` from FFmpeg args that caused integer overflow in the RTMP handler and prevented TCP connection to YouTube ingest servers.

## [0.1.8] - 2026-07-13

### Added

- Edit stream dialog now exposes the loop toggle.
- `isSourceDownloadActive` guard prevents concurrent retry/probe on the same source.

### Fixed

- Added `-fflags +genpts` to prevent non-monotonous DTS crashes at loop boundaries.
- Added `-probesize 32 -analyzeduration 0` to skip redundant probe for cached validated files.
- Added `-timeout 30000000` output option so FFmpeg exits instead of hanging on dropped RTMP connections.
- Restart loop race: `stopRequested` now set before clearing the restart timer so a concurrent `close` event cannot schedule a restart after a manual stop.
- Restart scheduling guards against `stopRequested` in the `close` handler.
- `setStreamStatus` now throws on optimistic concurrency miss instead of silently returning stale state; `settle()` handles this gracefully.
- `downloadAndProbeSource` returns early when a download is already active for the source.
- Events `limit` query param now falls back to 200 on NaN input instead of returning empty results.
- Probe route returns 409 when a download is active instead of spawning a concurrent ffprobe.
- Windows SIGKILL fallback reduced from 10s to 2s since SIGTERM has no effect on Windows FFmpeg.

### Chore

- Updated `.github` files to match standalone worker repo structure.

## [0.1.7] - 2026-07-12

### Added

- Persistent FFmpeg failure diagnostics with redacted logs and stream-specific replay.
- Bounded FFmpeg auto-restart with exponential backoff.
- Dashboard failure alerts and older event log pagination.

### Fixed

- Stream lifecycle races, partial FFmpeg stderr chunks, orphan process cleanup, and duplicate recovery reconciliation.
- Scheduler isolation so one failed stream action does not abort the remaining tick.
- Stable event ordering and cursor pagination using timestamp plus event ID.
- Safer stop handling and atomic stream status updates.

## [0.1.6] - 2026-07-11

### Fixed

- Re-encode AAC audio during RTMP output while stream-copying video to prevent `aac_adtstoasc` EOF errors and broken audio on some sources.

## [0.1.5] - 2026-07-11

### Fixed

- Docker images now include Debian system FFmpeg and FFprobe.
- Docker runtime defaults to system FFmpeg/FFprobe to avoid bundled static binary crashes during RTMP output on some VPS environments.

## [0.1.4] - 2026-07-11

### Fixed

- Ensured bundled FFmpeg and FFprobe binaries are included in Docker images.

## [0.1.3] - 2026-07-11

### Fixed

- Fixed Docker builds failing to include the bundled `ffmpeg-static` and `ffprobe-static` binaries.
- Added Python, Make, and G++ to the Docker builder for native `better-sqlite3` compilation.
- Enabled dependency install scripts during the Docker build so FFmpeg binaries are downloaded.
- Added Docker build-time verification for both FFmpeg and FFprobe binaries, preventing broken images from being published.
- Updated the Docker builder and runtime images to Node.js 24.

## [0.1.2] - 2026-07-11

nothing

## [0.1.1] - 2026-07-11

nothing

## [0.1.0] - 2026-07-11

Initial public release of Kumix Worker, the self-hosted Kumix live-stream runner.

### Dashboard

- Local web dashboard with Overview, Monitoring, Log, Sources, Targets, Streams, Create Stream, and Settings pages.
- English and Indonesian localization with message parity and orphan-key tests.
- Light, dark, and system theme switching.
- Browser tab title format `{Page} - Kumix Worker`.
- Real-time log streaming via Server-Sent Events with stream/kind/search filters, pause/resume, export, and clear actions.
- Per-page auto-refresh with configurable intervals.
- Token handoff flow that never puts the raw token in a URL: `/auth?token=` validates, redirects with a single-use code, and the dashboard exchanges the code via POST.

### Sources

- Direct URL and Google Drive shared-link source registration.
- Source download with SSRF protection: DNS resolution checks, per-redirect-hop validation, and connection-time DNS pinning via an `undici` Agent that only connects to vetted public addresses. Blocks private, loopback, link-local, cloud metadata, CGNAT, and embedded-IPv4 (6to4/NAT64) ranges.
- Max download size enforcement (default 10 GB) and configured disk-usage-limit enforcement with streaming byte limiter.
- Safe filename handling for cache files.
- Partial download cleanup on failure.
- FFprobe metadata extraction with a 30-second probe timeout.
- Codec and bitrate validation: H.264/AVC1 video, AAC/MP4A audio, max video bitrate 35 Mbps, with `format.bit_rate` fallback when per-stream bitrate is absent.
- Streaming SHA-256 hashing of downloaded files.
- Local cache storage, removed from disk on source deletion.
- Source details dialog with duration, resolution, FPS, codecs, bitrate, SHA-256, and invalid reason.
- In-dashboard video preview with HTTP range support, authorized through a short-lived signed URL so the `<video>` element can stream directly.
- Download progress display, cancel in-progress downloads, and retry failed or invalid sources.
- Source rename via `PATCH /api/sources/:id`.
- Bulk delete for selected sources.

### Targets

- RTMP and RTMPS ingest targets with AES-256-GCM encrypted stream keys at rest.
- Token-derived encryption keys with single-transaction re-encryption on token rotation.
- Edit label, ingest URL, and optional stream key replacement.
- Active and disabled state with per-row toggle.
- Masked stream key preview in responses; raw and encrypted keys never exposed.
- Bulk delete for selected targets.

### Streams

- Manual, scheduled, and recurring stream jobs (daily, weekly, monthly) with timezone-aware scheduling.
- Optional auto-stop time.
- Persistent status tracking: `pending`, `running`, `stopping`, `stopped`, `failed`.
- FFmpeg process lifecycle with remux (stream copy), optional infinite looping, and `aac_adtstoasc` bitstream filter.
- Runtime metrics parsed from FFmpeg stderr: FPS, bitrate, and dropped frames, persisted every 5 seconds.
- Stream key redaction in all log lines.
- Live stop action with graceful SIGTERM and SIGKILL after 10 seconds.
- Crash-safe tombstone recovery: orphaned FFmpeg processes detected and terminated after restart; streams left running marked as failed.
- Auto-start marker for planned update restarts: previously active streams start again after a forced restart.
- Safe delete blocked for `running` and `stopping` statuses server-side.
- Stream-specific log export as a text file.
- Stopped-time editing for post-hoc corrections.
- Stream edit dialog supporting title, source, target, scheduled start, and stopped time changes.
- Bulk delete for selected streams with running/stopping rows excluded from selection.

### Logs and Events

- Event listing (most recent 200) with optional stream filter.
- Global and stream-specific event SSE with 15-second keepalive heartbeat.
- Global and stream-specific event text export.
- Clear all events with confirmation.
- Short-lived HMAC-signed URLs (60-second TTL) for browser-only SSE and export flows.
- Event table capped at 5000 rows with automatic pruning.
- Event listener fan-out for in-process subscribers.

### Core-Facing API

- Stable `/api/v1/*` API for external integrations with Bearer token auth and separate rate limiting (120 requests per minute per client and token).
- `GET /api/v1/health` — lightweight worker health.
- `GET /api/v1/stats` — monitoring stats and recent stream summaries with a 2-second in-memory cache.
- `GET /api/v1/capabilities` — worker API version, feature flags, limits, and safe settings.
- `GET /api/v1/link` — link and install metadata without leaking the raw token.
- `POST /api/v1/settings/token` — rotate worker token with automatic target secret re-encryption and rollback on failure.
- CORS origins blocked by default; allowed origins configurable via `KUMIX_WORKER_CORS_ORIGINS`.
- Typed client (`createWorkerClient`) with health, stats, dashboard URL, and token rotation methods, including linear-backoff retries and timeout support.

### Runtime

- Runtime config in `~/.kumix-worker/config.json` with atomic writes and restrictive file permissions where supported.
- Local SQLite database in WAL mode with foreign keys, autocheckpoint, and inline schema bootstrap (no migration runner).
- Source cache under `~/.kumix-worker/cache`.
- Tombstone recovery under `~/.kumix-worker/tombstones`.
- Configurable timezone for recurring schedules (default `Asia/Jakarta`).
- Configurable disk usage limit (default 90%).
- FFmpeg and FFprobe binary resolution from bundled `ffmpeg-static` and `ffprobe-static`, with system binary overrides via `KUMIX_WORKER_FFMPEG_PATH` and `KUMIX_WORKER_FFPROBE_PATH`.
- Background scheduler with 30-second default interval, overlap guard, and recurrence advancement.
- Monitoring metrics: CPU usage (smoothed across cores), memory, disk usage, cache size, aggregate outbound bandwidth, scheduler state, and process info.
- Storage metrics cache with background async refresh to avoid blocking the event loop.

### Security

- All `/api/*` routes token-authenticated unless explicitly public.
- 1 MB request body limit on all `/api/*` routes.
- Constant-time token comparison.
- Auth failure rate limiting (30 invalid attempts per minute per client) across all auth entry points including handoff, exchange, and verify routes.
- Forwarded client-IP headers only trusted when `KUMIX_WORKER_TRUST_PROXY=1`.
- Weak token rejection: tokens with repeated characters, common words, or fewer than 5 distinct characters are refused.
- Handoff code single-use enforcement with periodic pruning of expired entries.
- Signed URL method scoping to prevent cross-method replay.
- Static file serving with path traversal protection (rejects `..`, backslashes, and encoded dot segments).
- Source cache filenames and event export filenames sanitized.
- Destructive data reset protected by data directory marker and unsafe path checks.
- Raw worker token never returned from settings, bootstrap, or `/api/v1/*` responses.

### CLI

- `kumix-worker init` — create or update local config with optional token, port, timezone, disk limit, and dev mode.
- `kumix-worker serve` — run the API, dashboard, scheduler, and stream recovery.
- `kumix-worker status` — print config, binary health, and disk usage.
- `kumix-worker doctor` — run preflight checks for FFmpeg/FFprobe, config, token, and disk limit.
- `kumix-worker token` — print masked token or rotate with `--regenerate`.
- `kumix-worker update` — check, install, and optionally restart with systemd integration; supports `--force` and `--auto-start` for active streams.
- `kumix-worker reset` — stop streams and clear data; `--all` for factory reset including config.

### Deployment

- Docker image published to Docker Hub (`kumix/worker`) and GHCR (`ghcr.io/kumixlabs/worker`).
- Multi-platform support: `linux/amd64` + `linux/arm64`.
- Dockerfile multi-stage build: Node.js 24 builder with Bun and native build tools compiles dependencies, TypeScript, and the Vite dashboard; Node.js 24 slim runner serves the compiled worker as a non-root user.
- Built-in healthcheck polling `/health` every 30 seconds.
- `docker-compose.yml` with restart policy and named volume.
- NPM package (`@kumix/worker`) with global install and postinstall asset verification.
- Semver Docker tags: `vX.Y.Z`, `X.Y`, `X`, and `latest` for non-prerelease tags.

### CI and Release

- GitHub Actions CI workflow: install (root and frontend as separate steps), typecheck, lint, test, and build on pull requests and main pushes.
- GitHub Actions release workflow: NPM publish on `v*` tags with exact tag-version match enforcement.
- Docker publish on `v*` tags with multi-platform build, registry caching, provenance, and SBOM enabled.

### Environment Variables

- `KUMIX_WORKER_DATA_DIR` — data directory override.
- `KUMIX_WORKER_PORT` — HTTP port override.
- `KUMIX_WORKER_TIMEZONE` — IANA timezone for schedules.
- `KUMIX_WORKER_IPV4_FIRST` — prefer IPv4 DNS resolution (default enabled).
- `KUMIX_WORKER_TRUST_PROXY` — trust forwarded client-IP headers (default disabled).
- `KUMIX_WORKER_DISK_LIMIT_PERCENT` — reject new downloads past this disk usage percent.
- `KUMIX_WORKER_MAX_DOWNLOAD_BYTES` — per-download byte cap.
- `KUMIX_WORKER_DOWNLOAD_TIMEOUT_MS` — download abort timeout.
- `KUMIX_WORKER_CORS_ORIGINS` — comma-separated allowed CORS origins for `/api/v1/*`.
- `KUMIX_WORKER_FFMPEG_PATH` — system FFmpeg binary override.
- `KUMIX_WORKER_FFPROBE_PATH` — system FFprobe binary override.

### Testing

- 147 tests across 27 test files covering config validation, DB integration, HTTP API CRUD, core-facing API contract, static serving security, FFmpeg/FFprobe helpers, source downloading with SSRF validation, scheduler and recurrence, recovery and tombstones, crypto and token re-encryption, token verification, version comparison, stream runner lifecycle, frontend message parity and orphan keys, and frontend smoke checks.
