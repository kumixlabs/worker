# AGENTS.md

Self-hosted Kumix live-stream runner: local dashboard + API, SQLite, media library + playlists, stream scheduler, FFmpeg/FFprobe, YouTube Live automation.

Package `@kumix/worker`, CLI `kumix-worker`. Node `>=24`, package manager `bun@1.4+`. Runtime is Node (not Bun) even though scripts use Bun.

## Security & Architecture

- **Multi-user Auth**: Built on `better-auth`. User accounts with session cookies. Setup creates the first admin at `POST /api/auth/setup`.
- **Tenancy**: `user_id` on `media`, `media_folders`, `playlists`, `playlist_items` (via playlist), `streams`, `events`, and `youtube_connections`. Non-admin queries strictly filter by current user.
- **Quota Engine**: Configurable `maxStorageBytes` and `maxStreams` per user (enforced before media writes and stream spawns).
- **YouTube Live Automation**: BYO Google Cloud OAuth Client ID & Secret per user. Automated broadcast lifecycle (`prepareYouTubeBroadcast` on start, bind stream keys, `transition complete` on graceful stop). Streams may use a manual RTMP URL **or** a YouTube connection.
- **Secrets Encryption**: AES-256-GCM using `encryptionKey` from `config.json`. RTMP target URLs, OAuth client credentials, and refresh tokens encrypted at rest. Masked in UI.
- **Signed URLs**: Path-scoped HMAC signatures with `signingSecret` for media previews, SSE logs, and file downloads.
- **SSRF Guard**: Direct URL + Google Drive imports validate schemes and resolve DNS; every redirect hop is re-validated. Private/loopback addresses blocked.

## Layout

| Path           | Role                                               |
| -------------- | -------------------------------------------------- |
| `src/`         | Backend: CLI, Hono API, DB, services, types        |
| `frontend/`    | Vite React dashboard (separate `package.json`)     |
| `public/`      | **Generated** Vite output — do not edit by hand    |
| `tests/`       | Vitest (`tests/vitest.config.ts`; `@` → `../src`)  |
| `src/index.ts` | Public package API — renames/removals are breaking |

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
```

Entrypoints: `src/cli.ts` (CLI), `src/http/app.ts` (routes). Schema bootstrapped in `getDb()` via `CREATE TABLE IF NOT EXISTS` + `tryColumnMigration` ad-hoc column adds — **no migration runner**. Schema changes need manual `ALTER` or drop-recreate.

**Build trap:** bare `tsc` without `bun run fix:esm` (`scripts/fix-esm-extensions.mjs`) yields broken ESM in `dist/`. Always use `bun run build`.

Before calling work done: `types:check` → `lint` → `test` → `build` (build required for frontend / public / API surface changes).

## Security (non-negotiable)

- Never return raw RTMP target URLs, YouTube client secrets, or refresh tokens (masked previews only). `GET /api/streams` returns `targetUrl: ""`.
- Dashboard/private `/api/*` requires a Better Auth session except explicit public routes (`/api/auth/*`, `/api/bootstrap`, `/api/youtube/callback`, signed-URL requests).
- CORS empty by default — set `KUMIX_WORKER_CORS_ORIGINS`.
- Sanitize media filenames; clean partial uploads/temp files on failure; static path-traversal safe.
- All `/api/*` bodies limited to 1 MB except upload/import routes with explicit larger limits.
- Unknown `/api/*` → 404 envelope. Security headers on all responses (`X-Content-Type-Options`, `X-Frame-Options`, CSP, `Referrer-Policy`).
- English for code/docs/commits. No comments unless asked.

## Media, playlists, streams

- **Media**: upload (multipart/streaming), direct URL import, GDrive import. Magic-byte sniffing, FFprobe enrichment (duration/size/fps/audio), thumbnails for video, SHA-256 dedup (409 `duplicate_media`).
- **Playlists**: ordered videos + optional single BGM audio item (`kind: "video" | "audio"`).
- **Streams**: concat demuxer `-c:v copy`, `filter_complex` amix BGM at 0.35 volume, `-stream_loop -1` for playlist/BGM when looping, optional Fisher-Yates shuffle per start, SIGINT→5s→SIGKILL stop.
- **Scheduler** (`src/runtime/scheduler.ts`): 30s tick, computes next runs in worker timezone, starts due streams (quota-checked), auto-stops at `autoStopAt`. Recurrence: none/daily/weekly/monthly.
- **Boot reconcile**: streams left `running` after restart are auto-resumed (default) or marked failed via `KUMIX_WORKER_AUTO_RESUME=0`.
- **YouTube**: start with `youtubeConnectionId` → `prepareYouTubeBroadcast` (create broadcast + stream key, bind) → ingest to `rtmp:<ingestAddress>/<streamName>`; graceful stop transitions broadcast to complete.
- Statuses: `stopped` | `running` | `failed`. Server blocks delete/edit while running or stopping (stop first). Manual stop → `stopped`.

## Frontend

- Routes: `frontend/src/routes/`. Kumix UI (`DataTable`, dialogs; `Checkbox` not native; schedule Selects from `@kumix/ui`, not native `<select>` / `type="time"`).
- i18n: `frontend/messages/en.json` + `id.json` must stay structurally identical; orphan-key test enforces usage.
- Dates via `useDateTimeFormatter` from `@/lib/date`. Wall-clock schedule fields use worker timezone.
- API client (`frontend/src/lib/api.ts`): 401 clears session + throws; queryFns accept `AbortSignal`.
- Root `ErrorBoundary` in `main.tsx`; route `errorElement` for page crashes.

## Backend conventions

- Zod-validate bodies before DB writes; `ok()` / `fail()` envelopes.
- SQLite: WAL + `busy_timeout=5000` + foreign keys + prepared-statement cache in `getDb()`.
- Stats: `GROUP BY` counts, not full table loads.
- Event export paginates beyond the list limit of 200.
- Graceful shutdown: stop streams → server.close with 5s timeout.
- FFmpeg argv includes plaintext RTMP URL — single-tenant / container deployment assumed.

## Runtime data

Default `~/.kumix-worker` (`config.json`, `db/db.sqlite`, `media/`, `logs/`). Override: `KUMIX_WORKER_DATA_DIR`.

`config.json` fields: `port`, `timezone`, `diskUsageLimitPercent`, `encryptionKey`, `signingSecret`, `dataDir`.

Notable env:

- `KUMIX_WORKER_FFMPEG_PATH` / `KUMIX_WORKER_FFPROBE_PATH` — system binaries when static build segfaults on RTMP DNS (glibc NSS).
- `KUMIX_WORKER_AUTO_RESUME` — default on; `0`/`false`/`off` disables stream auto-resume on boot.
- `KUMIX_WORKER_TRUST_PROXY=1` for real client IP / OAuth redirect URI behind proxy (proxy must strip client XFF).
- `KUMIX_WORKER_IPV4_FIRST` — default on; set `0` to disable.
- `KUMIX_WORKER_IMPORT_TIMEOUT_MS` — direct URL import timeout (default 10 min).

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

## CI / release

- CI: dual install → types:check → lint → test → build.
- Release on `v*` tags: NPM (`NPM_TOKEN`) + multi-arch Docker (GHCR + Docker Hub secrets). Tag must equal `package.json` version.

`CLAUDE.md` points here — keep this file the single agent source of truth.
