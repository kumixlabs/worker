# Kumix Worker

> Self-hosted live streaming on autopilot.

[![NPM](https://img.shields.io/npm/v/@kumix/worker.svg)](https://www.npmjs.com/package/@kumix/worker)
[![Docker](https://img.shields.io/docker/v/kumix/worker?logo=docker)](https://hub.docker.com/r/kumix/worker)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Kumix Worker is a self-hosted live-stream runner that supports scheduling, always-on source looping, and broadcasting video sources to RTMP/RTMPS platforms with monitoring, crash recovery, and a local dashboard.

Package: `@kumix/worker`
CLI: `kumix-worker`

## Quick Start

### One-line install (Ubuntu / Debian VPS)

```bash
curl -fsSL https://raw.githubusercontent.com/kumixlabs/worker/main/install.sh | sudo bash
```

This runs `apt update && upgrade`, installs Node.js 24 + FFmpeg, installs the worker, configures systemd with auto-start, and prints the dashboard URL. Everything in one command — just open `http://<server-ip>:8080` when it's done.

**Must run as root** (`sudo`). Without sudo it will refuse and tell you to re-run with `sudo`.

Options:

```bash
# Custom port + timezone
curl -fsSL https://raw.githubusercontent.com/kumixlabs/worker/main/install.sh | sudo bash -s -- --port 9090 --timezone UTC

# Domain + HTTPS (Caddy reverse proxy, automatic Let's Encrypt TLS)
# DNS A record for the domain must already point to this server.
curl -fsSL https://raw.githubusercontent.com/kumixlabs/worker/main/install.sh | sudo bash -s -- --domain stream.example.com

# Uninstall everything (service + package + data)
curl -fsSL https://raw.githubusercontent.com/kumixlabs/worker/main/install.sh | sudo bash -s -- --uninstall
```

The installer also sets `KUMIX_WORKER_TRUST_PROXY=1` and binds the worker to `127.0.0.1` when `--domain` is used, and prints the exact YouTube OAuth redirect URI to register in Google Cloud Console.

### NPM (global install)

```bash
npm install -g @kumix/worker
kumix-worker serve
```

### Docker

```bash
docker run -d \
  -p 8080:8080 \
  -v "$HOME/.kumix-worker:/app/data" \
  -e KUMIX_WORKER_DATA_DIR=/app/data \
  --name kumix-worker \
  kumix/worker:latest
```

See [DOCKER.md](./DOCKER.md) for full Docker usage, compose, and configuration.

## What It Does

- Runs a local web dashboard for managing live stream jobs.
- Stores data locally in SQLite under the worker data directory.
- Downloads and validates video sources from direct URLs and Google Drive shared links.
- Probes media with FFprobe and validates H.264/AAC with max video bitrate 35 Mbps.
- Manages RTMP targets with encrypted stream keys.
- Creates manual, scheduled, and recurring stream jobs.
- Runs FFmpeg jobs and tracks runtime metrics, status, logs, and tombstones.
- Recovers interrupted streams safely after restart.
- Exposes health, stats, and monitoring endpoints for external integrations.
- Serves static dashboard assets from the package build.

## Main Features

### Dashboard

The dashboard includes:

- Overview dashboard with live streams, scheduled streams, attention items, and recent activity.
- Monitoring page for CPU, memory, bandwidth, disk, FFmpeg, FFprobe, scheduler, and process status.
- Log page with live SSE updates, stream/kind/search filters, pause/resume, export, and clear actions.
- Sources page for adding direct URL or Google Drive sources, viewing media details, previewing, renaming, cancelling, retrying, and deleting sources, including bulk delete.
- Targets page for creating/editing RTMP targets and enabling/disabling destinations.
- Streams page for stream lifecycle actions, logs, exports, stopped time edits, and safe deletion.
- Settings page for timezone, disk usage limit, YouTube channel connections (BYO Google OAuth client), and account password change (Better Auth).
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
- Local cache storage, removed from disk when a source is deleted.
- Concurrent download+probe limited to protect disk/CPU.
- Details dialog with duration, resolution, FPS, codecs, bitrate, keyframe interval, and invalid reason.

Validation rules:

- Video codec: H.264 / AVC1.
- Audio codec: AAC / MP4A.
- Max video bitrate: `35000 kbps` / `35 Mbps`.

### Targets

Targets support:

- Label, RTMP/RTMPS ingest URL, encrypted stream key.
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

| Status     | Actions                                                  |
| ---------- | -------------------------------------------------------- |
| `pending`  | View Log, Export Log, Edit, Delete                       |
| `running`  | View Log, Export Log, Stop, Edit (YouTube Live URL only) |
| `stopping` | View Log, Export Log, Edit (YouTube Live URL only)       |
| `stopped`  | View Log, Export Log, Edit, Delete                       |
| `failed`   | View Log, Export Log, Start, Edit, Delete                |

Edit is available on every status so you can attach or update a YouTube Live URL for analytics without recreating the stream. While `running` or `stopping`, only the YouTube Live URL field is editable; title, source, target, and schedule stay locked. Source video always loops until stop or auto-stop.

### Logs And Events

Events support:

- Recent event listing, capped at the most recent 200 events.
- Global event SSE with a 15-second keepalive heartbeat.
- Stream-specific event SSE.
- Global event export as text.
- Stream event export as text.
- Clear all logs confirmation.
- Short-lived signed URLs for browser-only SSE/export flows.
- Event storage capped at 5000 rows with automatic pruning.

### Core-Facing API

Integrations authenticate like any other client: create a user account and use the session cookie, or front specific flows with the signed-URL routes below.

## CLI

Common commands:

```bash
kumix-worker init
kumix-worker serve
kumix-worker status
kumix-worker doctor
kumix-worker admin                 # create a user / reset a password
kumix-worker reset --yes
kumix-worker reset --all --yes
kumix-worker reset --force --yes
kumix-worker update
```

`kumix-worker update` supports `--check`, `--restart`, `--force`, and `--auto-start`.

> **Note:** `kumix-worker update` only works for NPM installs. To update a Docker deployment, pull the latest image and recreate the container — see [DOCKER.md](./DOCKER.md#update-to-latest).

Development commands:

```bash
bun install
bun install --cwd frontend
bun run dev
bun run build
bun run start
bun run lint
bun run lint:fix
bun run format
bun run format:check
bun run types:check
bun run test
bun run test:watch
bun run test:coverage
bun run bump
```

Run commands from the repository root. Root and frontend dependencies require separate installs.

`bun run dev` starts:

- API on `http://localhost:8080`
- Vite dashboard on `http://localhost:8000` (proxies `/api` to the worker)

## Runtime Data

Default data directory:

```text
~/.kumix-worker
```

Data layout:

```text
~/.kumix-worker/
  config.json
  db/
    db.sqlite
  cache/
  tombstones/
```

Config contains:

- `signingSecret` — HMAC key for signed URLs and YouTube OAuth state
- `encryptionKey` — AES-256-GCM root for target stream keys and YouTube OAuth credentials
- `port`
- `timezone`
- `diskUsageLimitPercent`
- `dataDir`

The config file is written with restrictive permissions where supported.

## Environment Variables

```text
KUMIX_WORKER_DATA_DIR
KUMIX_WORKER_PORT
KUMIX_WORKER_TIMEZONE
KUMIX_WORKER_IPV4_FIRST
KUMIX_WORKER_TRUST_PROXY
KUMIX_WORKER_DISK_LIMIT_PERCENT
KUMIX_WORKER_MAX_DOWNLOAD_BYTES
KUMIX_WORKER_DOWNLOAD_TIMEOUT_MS
KUMIX_WORKER_CORS_ORIGINS
KUMIX_WORKER_FFMPEG_PATH
KUMIX_WORKER_FFPROBE_PATH
KUMIX_WORKER_AUTO_RESUME
```

`KUMIX_WORKER_FFMPEG_PATH` and `KUMIX_WORKER_FFPROBE_PATH` override the bundled static binaries with a system FFmpeg/FFprobe. Set these when the static build cannot resolve DNS for RTMP output (it can segfault on some hosts because statically linked glibc cannot load NSS modules). When unset, the bundled `ffmpeg-static`/`ffprobe-static` binaries are used.

`KUMIX_WORKER_AUTO_RESUME` defaults to on. On graceful stop (`SIGTERM`/`SIGINT`, e.g. Docker stop or compose recreate), active streams are marked and started again after boot. Set to `0` to disable.

## HTTP API Overview

Dashboard/private API routes require a Better Auth session cookie (admin or regular user):

- `/api/settings`, `PATCH /api/settings`
- `/api/stats`, `/api/metrics`, `/api/health/details`, `/api/bandwidth`
- `/api/sources`, `/api/targets`, `/api/streams`
- `/api/events`, `/api/events/signed-url`
- `/api/sources/:id/preview-url`
- `/api/admin/users` (admin only)
- `/api/youtube/connections` (YouTube channel connections)

Non-admin users only see and mutate their own resources; admins see everything.

The cached source preview (`GET /api/sources/:id/preview`, with HTTP range support) is authorized through a short-lived signed URL rather than a cookie, so the dashboard `<video>` element can stream it directly.

Public unauthenticated routes:

- `GET /health`
- `GET /api/bootstrap`
- `GET /openapi`
- `GET /docs` (redirects to login; Scalar page requires an admin session)
- `POST /api/auth/setup` (one-time first admin creation)

Signed URL routes are generated by `POST /api/events/signed-url` and `POST /api/sources/:id/preview-url`, and are short-lived.

## Security Notes

- Authentication is multi-user (Better Auth: email + password, session cookies, scrypt-hashed passwords). The first admin is created once via `POST /api/auth/setup`; admins manage users, quotas, and bans from `/users`.
- Tenancy: `sources`, `targets`, `streams`, `events`, and `youtube_connections` are scoped to `user_id`; non-admin sessions can only touch their own rows on every route (including bulk delete, preview, analytics, export, SSE).
- Deleting a user cascades their streams, sources, targets, events, YouTube connections, and auth records.
- Auth endpoints are rate-limited by Better Auth (10 requests / 60s / IP). Forwarded headers are only trusted when `KUMIX_WORKER_TRUST_PROXY=1` (enable only behind a proxy that strips client-supplied XFF).
- Quotas: admins can cap `maxStorageBytes` and `maxStreams` per user; enforced before downloads and stream starts.
- `/api/*` routes enforce a 1 MB request body limit; unknown `/api/*` paths return a 404 envelope.
- Responses include security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and a basic Content-Security-Policy.
- Secrets at rest (target stream keys, YouTube OAuth client credentials and refresh tokens) are encrypted with AES-256-GCM keyed from `encryptionKey`. API responses only expose masked previews (`clientIdMasked`, stream-key masks) — never raw secrets, ciphertexts, or hashes.
- YouTube Live automation uses each user's own Google Cloud OAuth client (BYO). The OAuth `state` is HMAC-signed and verified against both the session user and the connection owner on callback.
- Stream keys are encrypted using AES-256-GCM. FFmpeg is spawned with the RTMP URL (including the stream key) as argv — deploy single-tenant or in a container so process listings are not shared.
- Source downloads are protected against SSRF via DNS checks, per-redirect-hop validation, and connection-time DNS pinning that blocks private, loopback, link-local, and embedded-IPv4 (6to4/NAT64) addresses. Google Drive confirmation failures do not fall back to HTML quarantine pages. Concurrent downloads are capped.
- Static file serving guards against path traversal and streams assets.
- Source cache filenames and event export filenames are sanitized.
- Config writes are atomic. Crash recovery avoids terminating reused PIDs after a reboot. Graceful shutdown stops streams and closes the HTTP server with a timeout so SSE clients cannot hang exit.
- Destructive data reset refuses unsafe directories.

## CI And Release

GitHub Actions:

- `ci.yml` runs install, typecheck, lint, tests, and build on pull requests and main pushes.
- `release.yml` publishes to NPM on `v*` tags, and builds/pushes multi-platform Docker images to GHCR and Docker Hub.

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

The test suite covers:

- Config validation.
- DB integration and stats aggregation.
- HTTP API CRUD, tenancy/ownership scoping, quota enforcement, stream-key non-exposure, running-stream delete protection, and SSE signed URL flows.
- Auth (Better Auth setup/login, admin vs user scoping, rate limits) and security response headers.
- Static serving security.
- FFmpeg/FFprobe helpers.
- Source downloading and SSRF validation.
- Scheduler, recurrence, and tick lifecycle.
- Recovery/tombstones.
- Crypto re-encryption and secrets masking.
- Signed-URL verification (timing-safe comparison).
- YouTube connection lifecycle and OAuth URL generation.
- Version comparison for self-update.
- Stream runner lifecycle.
- Frontend message parity and orphan keys.
- Frontend smoke checks.

## Troubleshooting

### Stream immediately fails or segfaults

The bundled FFmpeg/FFprobe binaries are statically linked against glibc. On some hosts, statically linked glibc cannot load NSS modules, which causes the binary to segfault when resolving DNS for RTMP output. If a stream starts but immediately fails with a segfault or an unclear error, install a system FFmpeg and override the bundled binaries:

```bash
# Debian/Ubuntu
sudo apt install ffmpeg

# Tell Kumix Worker to use the system binaries
export KUMIX_WORKER_FFMPEG_PATH=/usr/bin/ffmpeg
export KUMIX_WORKER_FFPROBE_PATH=/usr/bin/ffprobe

kumix-worker serve
```

The official Docker image already installs system FFmpeg/FFprobe via apt and sets `KUMIX_WORKER_FFMPEG_PATH` / `KUMIX_WORKER_FFPROBE_PATH` to `/usr/bin/*`, so the container does not rely on the bundled static binaries for RTMP output.

### Config is missing its signing secret or encryption key

If the worker refuses to start because `signingSecret` or `encryptionKey` is missing, restore the original `config.json` — without `encryptionKey`, existing encrypted stream keys and YouTube credentials are undecryptable. Otherwise run a factory reset:

```bash
kumix-worker reset --all --yes
kumix-worker init
```
