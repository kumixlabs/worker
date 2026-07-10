# Forge Worker

Forge Worker is the self-hosted TubeForge live-stream runner. It provides a local dashboard, a token-protected HTTP API, persistent SQLite state, source download/probing, scheduling, FFmpeg execution, runtime monitoring, and a small public API surface for TubeForge Core.

Package: `@tubeforge/worker`
CLI: `forge-worker`

## What It Does

- Runs a local web dashboard for managing live stream jobs.
- Stores data locally in SQLite under the worker data directory.
- Downloads and validates video sources from direct URLs and Google Drive shared links.
- Probes media with FFprobe and validates H.264/AAC with max video bitrate 35 Mbps.
- Manages RTMP targets with encrypted stream keys.
- Creates manual, scheduled, and recurring stream jobs.
- Runs FFmpeg jobs and tracks runtime metrics, status, logs, and tombstones.
- Recovers interrupted streams safely after restart.
- Exposes monitoring and token rotation endpoints for TubeForge Core.
- Serves static dashboard assets from the package build.

## Main Features

### Dashboard

The dashboard includes:

- Overview dashboard with live streams, scheduled streams, attention items, and recent activity.
- Monitoring page for CPU, memory, bandwidth, disk, FFmpeg, FFprobe, scheduler, and process status.
- Log page with live SSE updates, stream/kind/search filters, export, reset, and clear actions.
- Sources page for adding direct URL or Google Drive sources, viewing media details, and deleting sources.
- Targets page for creating/editing RTMP targets and enabling/disabling destinations.
- Streams page for stream lifecycle actions, logs, exports, stopped time edits, and safe deletion.
- Settings page for timezone and disk usage limit.
- EN/ID i18n with parity and orphan-key tests.

### Sources

Sources support:

- Direct URL video sources.
- Google Drive shared links.
- Safe Google Drive file ID parsing.
- SSRF protection with DNS resolution checks, per-redirect-hop validation, and connection-time DNS pinning so the request only connects to the vetted public address.
- Download size limits, configured disk-usage-limit enforcement, and cleanup on failure.
- FFprobe metadata extraction with a probe timeout.
- Codec and bitrate validation with `format.bit_rate` fallback.
- Streaming SHA-256 hashing.
- Local cache storage, removed from disk when a source is deleted.
- Details dialog with duration, resolution, FPS, codecs, bitrate, SHA-256, and invalid reason.

Validation rules:

- Video codec: H.264 / AVC1.
- Audio codec: AAC / MP4A.
- Max video bitrate: `35000 kbps` / `35 Mbps`.

### Targets

Targets support:

- Label, RTMP ingest URL, encrypted stream key.
- Edit label/ingest URL and optionally replace stream key.
- Active/disabled state.
- Created date column and newest-first sorting.
- Bulk delete for selected rows.
- Token rotation re-encrypts stored target secrets.

### Streams

Streams support:

- Manual start jobs.
- Scheduled start time.
- Optional auto-stop time.
- Recurrence: none, daily, weekly, monthly.
- Persistent status tracking: `pending`, `running`, `stopping`, `stopped`, `failed`.
- Runtime metrics from FFmpeg stderr.
- Live stop action and crash-safe tombstones.
- Safe delete blocking for running/stopping streams.
- Stream-specific log export as a text file.

Stream action matrix:

| Status     | Actions                                   |
| ---------- | ----------------------------------------- |
| `pending`  | View Log, Export Log, Edit, Delete        |
| `running`  | View Log, Export Log, Stop                |
| `stopping` | View Log, Export Log                      |
| `stopped`  | View Log, Export Log, Delete              |
| `failed`   | View Log, Export Log, Start, Edit, Delete |

### Logs And Events

Events support:

- Recent event listing.
- Global event SSE.
- Stream-specific event SSE.
- Global event export as text.
- Stream event export as text.
- Clear all logs confirmation.
- Short-lived signed URLs for browser-only SSE/export flows.

### Core-Facing API

TubeForge Core should use `/api/v1/*` endpoints with Bearer token auth.

Available core-facing endpoints:

- `GET /api/v1/health` - lightweight worker health.
- `GET /api/v1/stats` - monitoring stats and recent stream summaries.
- `GET /api/v1/capabilities` - worker API version, feature flags, limits, and safe settings.
- `GET /api/v1/link` - link/install metadata without leaking the raw token.
- `POST /api/v1/settings/token` - rotate worker token and re-encrypt target secrets.

CORS defaults allow:

- `https://tubeforge.local`
- `https://api.tubeforge.local`
- `https://tubeforge.space`
- `https://app.tubeforge.space`
- `https://api.tubeforge.space`

Override with `FORGE_WORKER_CORS_ORIGINS`.

## CLI

Common commands:

```bash
forge-worker init
forge-worker serve
forge-worker status
forge-worker token
forge-worker reset --yes
forge-worker reset --all --yes
forge-worker update
```

Development commands:

```bash
bun run dev
bun run build
bun run start
bun run lint
bun run types:check
bun run test
```

`bun run dev` starts:

- API on `http://localhost:8080`
- Vite dashboard on `http://localhost:8000`

## Runtime Data

Default data directory:

```text
~/.forge-worker
```

Data layout:

```text
~/.forge-worker/
  config.json
  db.sqlite
  cache/
  tombstones/
```

Config contains:

- `token`
- `port`
- `timezone`
- `diskUsageLimitPercent`
- `dataDir`

The config file is written with restrictive permissions where supported.

## Environment Variables

```text
FORGE_WORKER_DATA_DIR
FORGE_WORKER_PORT
FORGE_WORKER_TIMEZONE
FORGE_WORKER_IPV4_FIRST
FORGE_WORKER_TRUST_PROXY
FORGE_DISK_LIMIT_PERCENT
FORGE_MAX_DOWNLOAD_BYTES
FORGE_WORKER_CORS_ORIGINS
FORGE_FFMPEG_PATH
FORGE_FFPROBE_PATH
```

`FORGE_FFMPEG_PATH` and `FORGE_FFPROBE_PATH` override the bundled static binaries with a system FFmpeg/FFprobe. Set these when the static build cannot resolve DNS for RTMP output (it can segfault on some hosts because statically linked glibc cannot load NSS modules). When unset, the bundled `ffmpeg-static`/`ffprobe-static` binaries are used.

## HTTP API Overview

Dashboard/private API routes use Bearer token auth:

- `/api/settings`
- `/api/stats`
- `/api/metrics`
- `/api/health/details`
- `/api/sources`
- `/api/targets`
- `/api/streams`
- `/api/events`
- `/api/events/signed-url`
- `/api/sources/:id/preview-url`

The cached source preview (`GET /api/sources/:id/preview`, with HTTP range support) is authorized through a short-lived signed URL rather than a Bearer header, so the dashboard `<video>` element can stream it directly.

Public unauthenticated routes:

- `GET /health`
- `GET /api/bootstrap`
- `GET /openapi`
- `GET /docs`
- `GET /auth?token=...`
- `POST /api/auth/exchange`
- `POST /api/auth/verify`

Signed URL routes are generated by `POST /api/events/signed-url` and `POST /api/sources/:id/preview-url`, and are short-lived.

## Security Notes

- API routes require Bearer token auth unless explicitly public.
- The dashboard handoff never puts the token in a URL: `/auth?token=` validates the token, then redirects with a single-use, short-lived code that the dashboard exchanges for the token via `POST /api/auth/exchange`.
- Invalid token attempts are rate-limited, with expired buckets pruned. Buckets key on the socket address by default; forwarded headers are only trusted when `FORGE_WORKER_TRUST_PROXY=1`.
- Web/core API calls are rate-limited separately.
- `/api/*` routes enforce a 1 MB request body limit.
- Stream keys are encrypted using the worker token.
- Token rotation re-encrypts target stream keys in a single transaction.
- Raw worker token is never returned from settings or core-facing endpoints.
- Raw and encrypted target stream keys are never returned from API responses; only a masked preview is exposed.
- Source downloads are protected against SSRF via DNS checks, per-redirect-hop validation, and connection-time DNS pinning that blocks private, loopback, link-local, and embedded-IPv4 (6to4/NAT64) addresses.
- Static file serving guards against path traversal.
- Source cache filenames and event export filenames are sanitized.
- Config writes are atomic, and crash recovery avoids terminating reused PIDs after a reboot.
- Destructive data reset refuses unsafe directories.

## CI And Release

GitHub Actions:

- `ci.yml` runs install, typecheck, lint, tests, and build on pull requests and main pushes.
- `release.yml` publishes to NPM on `v*` tags or manual workflow dispatch.

NPM publishing requires `NPM_TOKEN` repository secret.

Release tags use:

```text
vX.Y.Z
```

## Verification

Before finishing meaningful changes, run:

```bash
bun run types:check
bun run lint
bun run test
bun run build
```

Current test suite (95 tests) covers:

- Config validation.
- DB integration.
- HTTP API CRUD, including stream-key non-exposure and running-stream delete protection.
- Core-facing API contract.
- Static serving security.
- FFmpeg/FFprobe helpers.
- Source downloading and SSRF validation.
- Scheduler and recurrence.
- Recovery/tombstones.
- Crypto/token re-encryption.
- Frontend message parity and orphan keys.
- Frontend smoke checks.
