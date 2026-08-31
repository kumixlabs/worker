# AGENTS.md

Self-hosted Kumix live-stream runner: local dashboard + API, SQLite, source cache, scheduler, FFmpeg/FFprobe.

Package `@kumix/worker`, CLI `kumix-worker`. Node `>=24`, package manager `bun@1.4+`. Runtime is Node (not Bun) even though scripts use Bun.

## Security & Architecture

- **Multi-user Auth**: Built on `better-auth`. User accounts with session cookies. Setup creates the first admin at `POST /api/auth/setup`.
- **Tenancy**: `user_id` on `sources`, `targets`, `streams`, `events`, and `youtube_connections`. Non-admin queries strictly filter by current user.
- **Quota Engine**: Configurable `maxStorageBytes` and `maxStreams` per user (enforced before downloads and stream spawns).
- **YouTube Live Automation**: BYO Google Cloud OAuth Client ID & Secret per user. Automated broadcast lifecycle (`prepareYouTubeBroadcast`, bind stream keys, `transition complete`). Legacy single `youtubeApiKey` completely removed.
- **Secrets Encryption**: AES-256-GCM using `encryptionKey` from `config.json`. Target stream keys and OAuth client credentials encrypted at rest. Masked in UI.
- **Signed URLs**: Path-scoped HMAC signatures with `signingSecret` for preview, SSE logs, and file downloads.

## Layout

| Path           | Role                                               |
| -------------- | -------------------------------------------------- |
| `src/`         | Backend: CLI, Hono API, DB, services, types        |
| `frontend/`    | Vite React dashboard (separate `package.json`)     |
| `public/`      | **Generated** Vite output — do not edit by hand    |
| `tests/`       | Vitest (`tests/vitest.config.ts`; `@` → `../src`)  |
| `src/index.ts` | Public package API — renames/removals are breaking |

## Install & commands

```bash
bun install
bun install --cwd frontend
bun run dev            # API :8080 (node --watch --import tsx) + Vite :8000 (proxies /api)
bun run build          # clean → tsc → fix:esm → frontend:build → copy public → verify
bun run types:check    # backend + frontend
bun run lint           # biome check
bun run test           # must run from repo root
```

Entrypoints: `src/cli.ts` (CLI), `src/http/app.ts` (routes). Schema bootstrapped in `getDb()` via `CREATE TABLE IF NOT EXISTS` — **no migration runner**. Schema changes need manual `ALTER` or drop-recreate. One ad-hoc helper: `tryColumnMigration` (e.g. `youtube_live_url`, `keyframe_interval`).

## Install & commands

Two installs required (CI does both):

```bash
bun install
bun install --cwd frontend
```

Root install alone does **not** install frontend deps; `types:check` / `build` fail without the second.

```bash
bun run dev            # API :8080 (node --watch --import tsx) + Vite :8000 (proxies /api)
bun run build          # clean → tsc → fix:esm → frontend:build → copy public → verify
bun run types:check    # backend + frontend
bun run lint           # biome check
bun run test           # must run from repo root
bun run bump           # bumpp; git tag vX.Y.Z must match package.json
```

**Build trap:** bare `tsc` without `bun run fix:esm` (`scripts/fix-esm-extensions.mjs`) yields broken ESM in `dist/`. Always use `bun run build`.

Before calling work done: `types:check` → `lint` → `test` → `build` (build required for frontend / public / API surface changes).

## Security (non-negotiable)

- Never return raw target stream keys, worker token, or YouTube API key (use `hasYoutubeApiKey` only).
- Token rotation response: `{ rotatedAt, tokenLength }` only — **never** echo the new token (client already sent it). Rotation is process-serialized (promise chain + reencrypt rollback on config write fail).
- Dashboard/private `/api/*` needs Bearer token except explicit public routes.
- Keep `/api/v1/*` stable for core integrations.
- CORS empty by default — set `KUMIX_WORKER_CORS_ORIGINS`.
- Sanitize source cache filenames; clean partial downloads; static path-traversal safe.
- Destructive reset only with data-dir marker + unsafe-path checks.
- English for code/docs/commits. No comments unless asked.
- Security headers on all responses: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, plus a basic CSP (`default-src 'self'`, etc.).
- Password hashing: async scrypt (`scrypt$N$r$p$salt$hash`); N/r/p allowlisted (reject corrupt config DoS). Corrupt `passwordHash` fails closed (no silent fallback to default). Reject factory default `123456` on change (API schema + CLI `validPassword`).
- Hot paths use `currentToken()` (mtime-cached); avoid re-reading full settings for every crypto/HMAC call.
- SPA honors login/exchange `expiresAt`; revalidates `passwordIsDefault` from `GET /api/settings` so CLI password reset unblocks force-change gate.

Public routes: `GET /health`, `/api/bootstrap`, `/openapi`, `/auth?token=...` (core handoff only), `POST /api/auth/login`, `POST /api/auth/exchange`. `GET /docs` is **not** public: it serves a password-only login form; `POST /docs` verifies the dashboard password (same scrypt hash as login, failures count against the auth rate limit) and sets an HttpOnly `kumix_docs` cookie (HMAC-signed by the token, 12h) that unlocks the Scalar page.

Dashboard login uses a **password** (scrypt hash in `config.json`, factory default `123456`). First login with default forces password change in the SPA (`passwordIsDefault`). Change via `POST /api/settings/password` (Bearer) or CLI `kumix-worker password --password <pw>`. Password change does **not** re-encrypt stream keys or invalidate existing Bearer sessions.

**Token** remains the API key + AES root for target stream keys + HMAC for signed URLs. Dashboard SPA stores the token in **localStorage** after password login (or CLI/core handoff). Never return raw token, password hash, stream keys, or YouTube API key. CLI `serve` prints Dashboard URL without embedding the token.

Core API (Bearer): `GET /api/v1/{health,stats,capabilities,link}`, `POST /api/v1/settings/token`.

Link/bootstrap metadata: `dashboardPath: "/"` (password login). Core may still use `GET /auth?token=` for handoff → `#code=` exchange. Client helper `workerDashboardUrl` still builds the handoff path for core integrations.

Signed URLs: `POST /api/events/signed-url`, `POST /api/sources/:id/preview-url` (path-scoped). All `/api/*` body limit 1 MB. Unknown `/api/*` → 404 envelope.

Auth rate limit: **10** failures / 60s / IP (in-memory, lazy-expire + prune). `KUMIX_WORKER_TRUST_PROXY=1` only behind a proxy that strips client-supplied forwarded headers.

Dashboard Settings UI: YouTube connections (BYO OAuth client), change password. Timezone & diskUsageLimitPercent are admin-only (PATCH `/api/settings` requires admin; General tab hidden for non-admins).

## Stream lifecycle

Statuses: `pending` | `running` | `stopping` | `stopped` | `failed`.

| Status   | Actions                                                 |
| -------- | ------------------------------------------------------- |
| pending  | View/Export Log, Edit, Delete                           |
| running  | View/Export Log, Stop, Edit (**YouTube Live URL only**) |
| stopping | View/Export Log, Edit (**YouTube Live URL only**)       |
| stopped  | View/Export Log, Edit, Delete                           |
| failed   | View/Export Log, Start, Edit, Delete                    |

Server blocks delete on `running`/`stopping`. Manual stop → `stopped` (not `failed`). Edit always allowed so operators can attach YouTube Live URL without recreating. Stream create/patch requires source `ready` and existing target. Recurring streams may auto-start from `failed` when due.

## Frontend

- Routes: `frontend/src/routes/`. Kumix UI (`DataTable`, dialogs, `Checkbox` not native; schedule Selects from `@kumix/ui`, not native `<select>` / `type="time"`).
- i18n: `frontend/messages/en.json` + `id.json` must stay structurally identical; orphan-key test enforces usage.
- Dates via `useDateTimeFormatter`. Wall-clock schedule fields use worker timezone (`toWallClockInput(date, timezone)`).
- Tab title: `{Page} - Kumix Worker`.
- Types imported as `import type` from `../../../src/types/*` (erased at build; keep shapes aligned).
- API client (`frontend/src/lib/api.ts`): 401 clears session + throws; queryFns accept `AbortSignal`; polling uses `refetchIntervalInBackground: false`.
- Source/target mutations that change embedded names must also invalidate `["streams"]`.
- Root `ErrorBoundary` in `main.tsx`; route `errorElement` for page crashes.

## Backend conventions

- Zod-validate bodies before DB writes; `ok()` / `fail()` envelopes.
- No legacy migrations unless explicitly required.
- Scheduler: overlap guarded; re-entry guard on `startScheduler`; recurring may auto-start from `failed` when due.
- Sources: H.264/AAC, max video bitrate 35000 kbps (fallback `format.bit_rate`). Concurrent download+probe capped at 2. Keyframe probing uses `packet=pts_time,flags` with `csv=p=0` (version-agnostic; works ffprobe 4.0.2–7.x), filters `K`-flagged packets in JS, kills child after 11 samples.
- SQLite: WAL + `busy_timeout=5000` + foreign keys + prepared-statement cache in `getDb()`.
- Stats: `GROUP BY` counts, not full table loads.
- GDrive: resolve confirmation URL or fail; never fall back to HTML quarantine page.
- Event export paginates beyond the list limit of 200.
- Graceful shutdown: stop streams → server.close with 5s timeout; `unhandledRejection` / `uncaughtException` logged in `serve`.
- FFmpeg argv includes plaintext RTMP URL (stream key) — single-tenant / container deployment assumed.

## Runtime data

Default `~/.kumix-worker` (`config.json`, `db/db.sqlite`, `cache/`, `tombstones/`). Override: `KUMIX_WORKER_DATA_DIR`.

`config.json` fields: `token`, `passwordHash`, `port`, `timezone`, `diskUsageLimitPercent`, `youtubeApiKey`, `dataDir`.

Notable env:

- `KUMIX_WORKER_FFMPEG_PATH` / `KUMIX_WORKER_FFPROBE_PATH` — system binaries when static build segfaults on RTMP DNS (glibc NSS).
- `KUMIX_WORKER_AUTO_RESUME` — default on; graceful stop writes auto-start marker. `0`/`false`/`off` disables.
- `KUMIX_WORKER_TRUST_PROXY=1` for real client IP behind proxy (proxy must strip client XFF).
- `KUMIX_WORKER_IPV4_FIRST` — default on; set `0` to disable.

CLI auth/ops: `init`, `serve`, `status`, `doctor`, `admin` (create user / reset password), `update`, `reset`.

## Testing quirks

```bash
bun run test                                    # from repo root only
bun run test -- tests/http/api-crud.test.ts     # single file
```

- Config: `tests/vitest.config.ts` (not root). `pool: "forks"` for `process.chdir` — no thread-safe globals.
- **Wrong cwd:** `messages.test.ts` uses `process.cwd()` for `frontend/src`; running inside `tests/` silently skips orphan checks.
- DB tests: call `resetDbForTests()` **and** `resetAuthForTests()` in `beforeEach`/`afterEach`.
- Test auth: Better Auth passwords min 8 chars. Use `createAdminSession` / `createUserSession` helpers (`tests/helpers.ts`). Create the admin session **before** ordinary users (`/api/auth/setup` is one-time per DB).
- Stream create tests must mark sources `ready` via `updateSourceProbe` before `POST /api/streams`.

## CI / release

- CI: dual install → types:check → lint → test → build.
- Release on `v*` tags: NPM (`NPM_TOKEN`) + multi-arch Docker (GHCR + Docker Hub secrets). Tag must equal `package.json` version.

`CLAUDE.md` points here — keep this file the single agent source of truth.
