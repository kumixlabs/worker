# Changelog

All notable changes to Forge Worker will be documented in this file.

The package version is updated by the release bump flow, not by routine documentation edits.

## [1.1.2] - 2026-06-27

### Added

- `FORGE_FFMPEG_PATH` and `FORGE_FFPROBE_PATH` environment variables override the bundled `ffmpeg-static`/`ffprobe-static` binaries with system binaries. The bundled static FFmpeg can segfault (SIGSEGV) when opening an RTMP/RTMPS output because its statically linked glibc cannot load NSS modules to resolve DNS on some hosts. Pointing the worker at a dynamically linked system FFmpeg resolves this. When the variables are unset, the bundled static binaries are still used, keeping local/dev setups zero-config.
- Source rows now have a Preview action (visible only for `ready` sources) that plays the cached video in a dialog with native play/pause, volume, and seek controls. Playback is served by `GET /api/sources/:id/preview` with HTTP range support and authorized through a short-lived signed URL (`POST /api/sources/:id/preview-url`), so the `<video>` element never needs the worker token.
- A note under the target ingest URL field explains that plain RTMP uses port 1935 and to switch to RTMPS on port 443 when outbound 1935 is blocked.

### Changed

- The Add Target form now defaults the ingest URL to `rtmps://a.rtmps.youtube.com/live2` (port 443) instead of plain RTMP on port 1935, which many VPS providers block outbound.
- Signed-URL auth now also covers the source preview path in addition to event export/SSE paths.

## [1.1.1] - 2026-06-27

### Fixed

- Source downloads no longer hang on hosts with broken IPv6. When IPv4-first mode is active (the default), the SSRF DNS resolver now drops IPv6 records as long as at least one IPv4 address is available, so `undici` never attempts an unroutable AAAA address that ends in a connect timeout. Set `FORGE_WORKER_IPV4_FIRST=0` to keep IPv6 candidates.

### Changed

- The SSRF `undici` `Agent` now sets an explicit 30-second `connect.timeout` so connection establishment matches the fetch timeout instead of using undici's shorter 10-second default.

## [1.1.0] - 2026-06-27

### Security

- SSRF protection now pins the validated address to the connection. Source downloads route through an `undici` `Agent` whose DNS resolver re-checks every resolved IP against the private-range policy and connects only to a vetted address, closing the DNS-rebinding gap between validation and the actual fetch.
- `isPrivateIp` now decodes and blocks IPv4 addresses embedded in 6to4 (`2002::/16`) and NAT64 (`64:ff9b::/96`) IPv6 addresses.
- The dashboard token no longer travels in a redirect URL. `/auth?token=` now redirects with a single-use, 60-second handoff code that the dashboard exchanges for the token via `POST /api/auth/exchange`, keeping the token out of the `Location` header, browser history, and access logs.
- Rate-limit buckets now key on the socket address by default; spoofable forwarded headers (`x-forwarded-for`, `x-real-ip`, `CF-Connecting-IP`) are only trusted when `FORGE_WORKER_TRUST_PROXY=1` is set.
- API routes under `/api/*` now enforce a 1 MB request body limit, returning `413` instead of buffering unbounded input.
- A worker config that exists but is missing its token now fails loudly instead of silently minting a new token, which would have left existing encrypted target stream keys undecryptable.

### Fixed

- `startStream` now has an explicit `Promise<StreamRecord | null>` return type instead of implicit `any`.
- Event pruning SQL uses a parameterized query (`OFFSET ?`) instead of string interpolation, and now orders by `created_at DESC, id DESC` for deterministic pruning when timestamps collide.
- Misplaced JSDoc in `db/targets.ts` — `reencryptTargetSecrets` doc now correctly appears above its function, not before `deleteTarget`.
- OpenAPI server URL uses `FORGE_WORKER_PORT` env var instead of calling `readSettings()` at module init, preventing unintended config side effects.
- Re-probing a source can now clear stale metadata fields (codecs, bitrate, dimensions, fps) instead of retaining old values via `?? existing`.
- Removed a dead empty `if` block in `deleteSource`.
- Dashboard log stream now auto-reconnects with exponential backoff (capped at 30s) after an SSE error instead of giving up permanently.

### Changed

- FFmpeg progress metrics are still streamed to SSE in real time but persisted to SQLite at most once every 5 seconds, eliminating per-line write churn under concurrent streams.
- Cache directory size is now measured with a non-blocking async walk refreshed in the background, instead of a synchronous recursive scan on the request path.
- Log page relies on the initial fetch plus live SSE instead of a redundant 3-second polling interval.
- Deduplicated `safeFilenamePart` into `lib/utils.ts` and reused `activeStreamIds` across the CLI and update runtime.
- Max per-file download size is now configurable via `FORGE_MAX_DOWNLOAD_BYTES` (default 10 GB).
- AGENTS.md updated: `doctor` CLI command added, `FORGE_WORKER_IPV4_FIRST` and `FORGE_MAX_DOWNLOAD_BYTES` env vars documented, test file count noted.

### Dependencies

- Added `undici@8.5.0` (exact-pinned) for SSRF-safe HTTP fetching with DNS pinning.

## [1.0.3] - 2026-06-16

Patch release improving source-downloader error reporting so the real cause of `fetch failed` is visible in logs and `invalidReason`.

### Fixed

- `safeFetch` now logs the underlying `error.cause` (e.g. `ECONNREFUSED`, `ETIMEDOUT`, `EAI_AGAIN`) with the URL it failed on, and re-throws with that context attached.
- `resolveGDriveDownload` no longer silently swallows errors; it now logs the failure with the file ID.
- `downloadAndProbeSource` logs the full error object on `safeFetch` failure for easier debugging.

## [1.0.2] - 2026-06-16

Patch release fixing a production deployment crash caused by Node's strict ESM resolver rejecting relative imports without file extensions.

### Fixed

- Built `dist/**/*.js` files now reference other built modules with explicit `.js` extensions so `node dist/cli.js` resolves them on Node 20+ (and Node 24 LTS). A new post-build step `fix:esm` rewrites extensionless relative imports after `tsc`; no source code changes required.

## [1.0.1] - 2026-06-14

Hardening and correctness release based on a full codebase audit. No public API or contract changes.

### Fixed

- CLI `init --token` and `token --regenerate` now re-encrypt stored target stream keys before replacing the token, preventing undecryptable stream keys after a CLI token change.
- Single and bulk stream deletion no longer auto-stop first; `running` and `stopping` streams are now rejected server-side with a conflict instead of being force-stopped and deleted.
- Recurring streams with an auto-stop window no longer start-then-instantly-stop on every cycle after the first; both `scheduledFor` and `autoStopAt` advance together while preserving the configured duration.
- Token rotation re-encryption is now wrapped in a single transaction, so a mid-rotation failure rolls back instead of leaving some targets keyed to the new token.
- Event fan-out now isolates listener exceptions, so a disconnected SSE subscriber can no longer disrupt other subscribers or the FFmpeg stderr handler.
- `ffprobe` now has a 30s timeout with SIGKILL, preventing hangs on corrupt input.
- Video bitrate validation falls back to `format.bit_rate` when the per-stream bitrate is absent, so over-limit files no longer bypass the cap.
- Source deletion now removes the cached media file from disk, preventing storage leaks.
- `monthly` recurrence clamps the day to the target month length, fixing skipped/shifted runs for day 29-31.
- Crash recovery no longer terminates a process by reused PID after a reboot; tombstones older than the last system boot are treated as stale.

### Changed

- SHA-256 source hashing now streams the file instead of loading it fully into memory.
- SSE connections send a periodic keepalive heartbeat and enqueue defensively to reduce proxy-induced drops and forced re-auth.
- Config writes are atomic (temp file + rename) to avoid corrupting the token/config on crash.
- In-memory rate-limit buckets are pruned of expired entries to bound memory growth.
- Source downloads now enforce the configured disk usage limit in addition to the hard size cap.
- Monitoring and Overview times now use the worker-timezone-aware formatter instead of `toLocaleTimeString()`.
- Icon-only table action triggers now expose accessible labels.
- `format:check` script no longer mutates files.
- Package postinstall logging is quieter.

### Security

- Core-facing and dashboard target responses now strip the encrypted stream key ciphertext and derive the masked preview from the decrypted plaintext, never exposing the stored ciphertext.
- Stream event export filenames sanitize the stream id to prevent header injection.

### Verification

- TypeScript typecheck.
- Biome lint.
- Vitest suite of 95 tests, including new regressions for stream-key non-exposure and running-stream delete protection.
- Production build including dashboard assets.

## [1.0.0] - 2026-06-12

Forge Worker 1.0.0 is the first production-ready release of the self-hosted TubeForge live-stream runner.

### Added

- Local Forge Worker dashboard for managing sources, targets, streams, logs, monitoring, and settings.
- CLI package `@tubeforge/worker` with `forge-worker` command.
- Local Hono HTTP API with token authentication and response envelopes.
- Local SQLite persistence for sources, targets, streams, events, settings, metrics, and runtime state.
- Local data directory support with safe reset protections.
- Direct URL and Google Drive source registration.
- Source downloading with safe cache filenames, size limits, partial download cleanup, and terminal event logging.
- FFprobe media probing with duration, resolution, FPS, codecs, bitrate, SHA-256, and size metadata.
- Source validation for H.264/AVC1 video, AAC/MP4A audio, and max video bitrate `35000 kbps` / `35 Mbps`.
- Source details dialog with readable resolution labels and bitrate in kbps/Mbps.
- RTMP target management with encrypted stream keys.
- Target create, edit, enable/disable, delete, bulk delete, and created date sorting.
- Token rotation that re-encrypts stored target stream keys.
- Stream creation with source, target, schedule, auto-stop, and recurrence options.
- Recurrence support for none, daily, weekly, and monthly schedules.
- Stream lifecycle statuses: `pending`, `running`, `stopping`, `stopped`, and `failed`.
- Stream lifecycle actions by status, including start, stop, edit stopped time, delete, view log, and export log.
- Safe stream deletion blocked server-side for running and stopping streams.
- FFmpeg stream runner with runtime metrics parsing, stop handling, and failure tracking.
- Scheduler loop with overlap guard and same-day recurring candidate handling.
- Tombstone-based recovery for interrupted streams after process restart.
- Dashboard Overview page with live streams, scheduled streams, attention items, and recent activity.
- Monitoring page with CPU, memory, bandwidth, storage, process, FFmpeg, FFprobe, and scheduler details.
- Log page with event search, stream filter, kind filter, reset, live SSE updates, clear, and export.
- Event kind badges with status-aware colors.
- Global and stream-specific event exports as text files.
- Short-lived signed URLs for browser SSE and export flows.
- Sources, Targets, and Streams tables with search, pagination, sorting, row selection, bulk delete, and confirmation dialogs.
- Page-specific browser tab titles using `{Page} - Forge Worker`.
- Settings page for timezone and disk usage limit.
- Locale-aware and worker-timezone-aware date/time formatting.
- English and Indonesian dashboard messages.
- i18n parity and orphan-key tests.
- Core-facing `/api/v1/*` API for TubeForge Web/Core integration:
  - `GET /api/v1/health`
  - `GET /api/v1/stats`
  - `GET /api/v1/capabilities`
  - `GET /api/v1/link`
  - `POST /api/v1/settings/token`
- Production CORS defaults for TubeForge domains with `FORGE_WORKER_CORS_ORIGINS` override.
- OpenAPI and Scalar docs at `/openapi` and `/docs`.
- Static dashboard serving with path traversal protection.
- CI workflow for install, typecheck, lint, test, and build.
- Release workflow for NPM publishing on `v*` tags or manual dispatch.
- Contract tests for core-facing API responses.
- Frontend smoke tests for signed URLs, page titles, and Starter UI table checkboxes.

### Security

- Bearer token authentication for private dashboard/API routes.
- Separate rate limits for invalid token attempts and web/core API calls.
- No raw worker token exposure from settings, bootstrap, or core-facing endpoints.
- No raw target stream key exposure from API responses.
- Encrypted target stream keys tied to worker token with rotation support.
- Signed short-lived URLs replace token query parameters for SSE/export browser flows.
- Static file path traversal protection.
- Google Drive ID validation.
- Source cache filename sanitization.
- Safe data reset marker to prevent deleting unsafe directories.

### Changed

- Worker repository is treated as a standalone package/repository instead of an old monorepo app path.
- Root `types:check` now validates both backend and frontend TypeScript.
- Build command compiles frontend assets and copies them into `dist/public` for package distribution.

### Verification

This release is validated by:

- TypeScript typecheck.
- Biome lint.
- Vitest suite covering 93 tests across runtime, DB, HTTP API, services, frontend messages, frontend smoke, and core-facing contracts.
- Production build including dashboard assets.
