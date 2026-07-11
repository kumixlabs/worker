# Changelog

All notable changes to Kumix Worker will be documented in this file.

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
