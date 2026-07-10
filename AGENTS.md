# AGENTS.md

This file guides coding agents working in the standalone Kumix Worker repository.

## Scope

Kumix Worker is the self-hosted Kumix live-stream runner. It is an independent package/repository for running a local dashboard, local API, SQLite state, source cache, scheduled jobs, and FFmpeg/FFprobe stream execution.

Primary folders:

- `src/` - backend runtime, CLI, HTTP API, DB access, schemas, services, and shared types.
- `frontend/` - Vite React dashboard, i18n messages, and UI routes.
- `public/` - built dashboard assets served by the worker package.
- `tests/` - Vitest test suite for runtime, API, DB, frontend smoke/i18n, and service behavior.
- `.github/workflows/` - CI and NPM release workflows.

## Architecture

- `src/cli.ts` owns the `kumix-worker` CLI: init, serve, status, doctor, token, reset, update, and runtime bootstrap.
- `src/http/app.ts` wires Hono routes, CORS, OpenAPI, docs, auth middleware, core-facing routes, dashboard routes, and static serving.
- `src/http/middleware.ts` owns Bearer token auth, signed URL auth, auth failure rate limiting, web API rate limiting, and response envelopes.
- `src/http/routes/` owns route groups:
  - `auth.ts` - dashboard auth handoff via single-use code, code exchange, and token verification.
  - `system.ts` - settings, stats, metrics, and health details for dashboard.
  - `sources.ts` - source CRUD, bulk delete, download/probe trigger, signed preview URL, and range-based preview streaming.
  - `targets.ts` - target CRUD, active state, encrypted stream keys, bulk delete.
  - `streams.ts` - stream CRUD, start, stop, stopped time patching, bulk delete.
  - `events.ts` - event listing, SSE, exports, signed URLs.
  - `web.ts` - core-facing `/api/v1/*` health, stats, capabilities, link, and token rotation.
- `src/db/` owns SQLite schema and query helpers. Schema is bootstrapped inline via `CREATE TABLE IF NOT EXISTS` in `getDb()` — there is no migration runner, no migration files, and no version table. Schema changes require manual ALTER or drop-recreate.
- `src/runtime/` owns config, FFmpeg binary resolution, metrics, scheduler, recovery/tombstones, and update helpers.
- `src/services/` owns FFprobe probing, source download/cache, and FFmpeg stream runner behavior.
- `src/lib/` owns crypto, signed URLs, timezone parsing, utilities, and package version helpers.
- `frontend/src/routes/` owns dashboard pages.
- `frontend/messages/en.json` and `frontend/messages/id.json` must stay structurally identical.
- `src/index.ts` is the public package API surface for external consumers (e.g. Kumix core). Renaming or removing exports is a breaking change.
- `public/assets/` contains generated Vite build output — do not edit manually.

## Feature Summary

Kumix Worker currently supports:

- Local dashboard with Overview, Monitoring, Log, Sources, Targets, Streams, Create Stream, and Settings pages.
- Token-authenticated API with rate limiting.
- Core-facing `/api/v1/*` API for health, stats, capabilities, link metadata, and token rotation.
- Runtime config in `~/.kumix-worker/config.json` by default.
- Local SQLite DB in `~/.kumix-worker/db/db.sqlite`.
- Source cache under `~/.kumix-worker/cache`.
- Tombstone recovery under `~/.kumix-worker/tombstones`.
- Direct URL and Google Drive source registration.
- Source download with SSRF protection (DNS checks + per-redirect-hop validation + connection-time DNS pinning via an `undici` Agent that only connects to vetted public addresses), safe filename handling, max size enforcement, configured disk-usage-limit enforcement, streaming SHA-256, and FFprobe metadata extraction with a probe timeout.
- H.264/AAC source validation with max video bitrate `35000 kbps` / `35 Mbps`, falling back to `format.bit_rate` when the per-stream bitrate is absent.
- Cached source files are removed from disk on source deletion.
- RTMP targets with encrypted stream keys.
- Manual, scheduled, and recurring streams.
- Stream statuses: `pending`, `running`, `stopping`, `stopped`, `failed`.
- Stream lifecycle actions by status:
  - `pending`: View Log, Export Log, Edit, Delete.
  - `running`: View Log, Export Log, Stop.
  - `stopping`: View Log, Export Log.
  - `stopped`: View Log, Export Log, Delete.
  - `failed`: View Log, Export Log, Start, Edit, Delete.
- Global and stream-specific logs, SSE, and text exports.
- Short-lived signed URLs for browser SSE/export flows.
- Token rotation with target secret re-encryption.
- CI and release workflows for lint/typecheck/test/build and NPM publishing.

## Non-Negotiable Rules

- Keep all raw secrets out of renderer responses and logs.
- Never expose raw target stream keys to the renderer or public/core-facing API.
- Never return the raw worker token from settings, bootstrap, or `/api/v1/*` responses.
- Keep all dashboard/private API routes token-authenticated unless explicitly public.
- Keep `/api/v1/*` stable for external integrations.
- CORS origins are not allowed by default; allowed origins must be configured via `KUMIX_WORKER_CORS_ORIGINS`.
- Keep stream key encryption compatible with token rotation.
- Keep source URL handling safe; sanitize cache filenames and clean partial downloads on failure.
- Keep static serving path traversal protections.
- Keep recovery/tombstone behavior crash-safe.
- Keep destructive reset protected by the data directory marker and unsafe path checks.
- Keep English for code, comments, docs, and committed text.
- Keep `frontend/messages/en.json` and `frontend/messages/id.json` in parity.
- Do not add comments unless explicitly asked.

## Commands

Use commands from the worker repository root.

```bash
bun run dev
bun run build
bun run start
bun run lint
bun run lint:fix
bun run format
bun run types:check
bun run test
bun run test:watch
bun run test:coverage
bun run bump
```

`bun run types:check` checks both backend and frontend TypeScript.

`bun run build` builds backend and frontend via `tsc`, then runs `node scripts/fix-esm-extensions.mjs` to rewrite bare relative imports in `dist/` to `.js` extensions, then copies `public/` into `dist/public`. Running `tsc` directly without the `fix-esm` step produces broken ESM output.

`bun run dev` runs the backend under `node --watch --import tsx` (not Bun runtime) and the Vite frontend dev server concurrently. Backend listens on port 8080; Vite proxies `/api` to `http://localhost:8080`. Both must be running for the dev dashboard to work.

`bun run bump` uses `bumpp` to bump the version. The release workflow enforces that the git tag matches `package.json` version exactly.

Before finishing meaningful changes, run:

```bash
bun run types:check
bun run lint
bun run test
bun run build
```

If the change is very small and the user needs speed, run the smallest relevant subset first, but finish with the full suite before declaring production readiness.

### Install

Two separate installs are required — root and frontend:

```bash
bun install
bun install --cwd frontend
```

CI runs them as separate steps. A single `bun install` at root does not install frontend dependencies; `bun run build` and `bun run types:check` (frontend half) will fail without it.

## Runtime Configuration

Default data directory:

```text
~/.kumix-worker
```

Supported environment variables:

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
```

`KUMIX_WORKER_FFMPEG_PATH` and `KUMIX_WORKER_FFPROBE_PATH` override the bundled `ffmpeg-static`/`ffprobe-static` binaries with system binaries. Use them when the static build segfaults resolving DNS for RTMP output (statically linked glibc cannot load NSS modules on some hosts). When unset, the bundled static binaries are used.

Settings fields:

- `token`
- `port`
- `timezone`
- `diskUsageLimitPercent`
- `dataDir`

Dashboard Settings UI intentionally exposes only:

- `timezone`
- `diskUsageLimitPercent`

## API Contracts

Private/dashboard API routes live under `/api/*` and require Bearer token auth, except explicit public routes.

Core-facing API routes live under `/api/v1/*` and require Bearer token auth:

- `GET /api/v1/health`
- `GET /api/v1/stats`
- `GET /api/v1/capabilities`
- `GET /api/v1/link`
- `POST /api/v1/settings/token`

Public routes:

- `GET /health`
- `GET /api/bootstrap`
- `GET /openapi`
- `GET /docs`
- `GET /auth?token=...` (validates the token, then redirects with a single-use handoff code instead of the raw token)
- `POST /api/auth/exchange` (exchanges a single-use handoff code for the token)
- `POST /api/auth/verify`

All `/api/*` routes enforce a 1 MB request body limit.

Signed URL routes are generated by `POST /api/events/signed-url` (valid only for event/list/export/SSE paths) and `POST /api/sources/:id/preview-url` (valid only for the matching source preview path).

## Frontend Rules

- Use React + Vite + React Router route modules in `frontend/src/routes`.
- Use Kumix UI components for tables, dialogs, buttons, badges, popovers, selects, and date/time picker primitives.
- Tables use `DataTable` where possible.
- Keep row actions consistent with stream status rules.
- Keep destructive actions behind confirmation dialogs.
- Use `useDateTimeFormatter` for displayed dates so locale and worker timezone are respected.
- Keep browser tab title format: `{Page} - Kumix Worker`.
- Keep table select controls using Kumix UI `Checkbox`, not native checkbox inputs.
- Keep all user-facing strings in `frontend/messages/en.json` and `frontend/messages/id.json`.
- The message test checks parity and orphan UI keys; update tests only when a key is intentionally dynamic.

## Backend Rules

- Validate every request body with Zod schemas before DB writes.
- Use `ok()` and `fail()` response helpers for JSON API responses.
- Keep route-level errors safe and avoid leaking secrets.
- Keep DB helpers responsible for SQLite persistence and type mapping.
- Keep runtime services independent from renderer/UI code.
- Do not add legacy migrations unless explicitly required; current schema is a fresh-start worker schema.
- Keep stream deletion blocked for `running` and `stopping` statuses server-side.
- Keep manual stop ending as `stopped`, not `failed`.
- Keep scheduler overlap guarded.
- Keep token rotation re-encrypting target stream keys.

## Testing Notes

The suite currently has 99 tests across 23 test files. Important test areas:

- `tests/http/api-crud.test.ts` - dashboard/private API behavior, including stream-key non-exposure and running-stream delete protection.
- `tests/http/web-contract.test.ts` - core-facing API contract.
- `tests/http/static.test.ts` - static file safety.
- `tests/db/db.test.ts` - SQLite integration.
- `tests/runtime/*` - config, scheduler, recovery, metrics, FFmpeg resolution.
- `tests/services/*` - source downloader (incl. SSRF validation), probe, stream runner.
- `tests/frontend/messages.test.ts` - i18n parity and orphan UI keys.
- `tests/frontend/frontend-smoke.test.ts` - dashboard smoke checks.

Vitest config lives at `tests/vitest.config.ts`, not the repo root. The `@` alias in that config resolves to `../src`. Always run tests from the repo root (`bun run test`), not from inside `tests/` — `messages.test.ts` uses `process.cwd()` to locate `frontend/src` and will silently pass with zero orphan checks if run from the wrong directory.

Tests use `pool: "forks"` (not threads) to support `process.chdir`. Do not assume thread-safe globals in new test files.

New test files that touch the DB must call `resetDbForTests()` in `beforeEach`/`afterEach` to close the SQLite singleton and prevent cross-test state bleed.

Test tokens must be at least 16 characters (`validToken` enforces `length >= 16`). Short stubs like `"test"` or `"abc123"` will fail validation.

## CI And Release

- `.github/workflows/ci.yml` runs install, typecheck, lint, test, and build on PR/main.
- `.github/workflows/release.yml` publishes to NPM on `v*` tags or manual workflow dispatch. Also builds and pushes Docker images to GHCR and Docker Hub (requires `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` secrets).
- NPM publish requires the `NPM_TOKEN` repository secret.
- Release tags use `vX.Y.Z` and must match `package.json` version.
- Do not enable NPM provenance for private repositories unless explicitly requested.

## Completion Checklist

Before reporting done:

- Confirm relevant API routes remain authenticated and safe.
- Confirm stream lifecycle actions match the status matrix.
- Confirm EN/ID message keys remain aligned.
- Confirm no orphan UI messages remain.
- Confirm generated public assets are updated if frontend changed.
- Run `bun run types:check`.
- Run `bun run lint`.
- Run `bun run test`.
- Run `bun run build` for frontend/shared UI/API changes.
- Report exactly what passed and any checks that could not be run.
