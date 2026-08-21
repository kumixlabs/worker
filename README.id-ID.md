# Kumix Worker

> Live streaming mandiri yang berjalan otomatis.

[![NPM](https://img.shields.io/npm/v/@kumix/worker.svg)](https://www.npmjs.com/package/@kumix/worker)
[![Docker](https://img.shields.io/docker/v/kumix/worker?logo=docker)](https://hub.docker.com/r/kumix/worker)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Kumix Worker adalah runner live-stream mandiri yang mendukung penjadwalan, loop sumber video otomatis, dan broadcast ke platform RTMP/RTMPS dengan monitoring, crash recovery, dan dashboard lokal.

Package: `@kumix/worker`
CLI: `kumix-worker`

## Quick Start

### NPM (instalasi global)

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

Lihat [DOCKER.md](./DOCKER.md) untuk penggunaan Docker, compose, dan konfigurasi lengkap.

## Fungsionalitas

- Menjalankan dashboard web lokal untuk mengelola job live stream.
- Menyimpan data secara lokal di SQLite pada direktori data worker.
- Mengunduh dan memvalidasi sumber video dari URL langsung dan tautan berbagi Google Drive.
- Memproses media dengan FFprobe dan memvalidasi H.264/AAC dengan bitrate video maksimum 35 Mbps.
- Mengelola target RTMP/RTMPS dengan stream key terenkripsi.
- Membuat job stream manual, terjadwal, dan berulang.
- Menjalankan job FFmpeg serta melacak metrik runtime, status, log, dan tombstone.
- Memulihkan stream yang terputus dengan aman setelah restart.
- Menyediakan endpoint health, stats, capabilities, metadata link, dan rotasi token untuk integrasi eksternal.
- Menyajikan aset dashboard statis dari hasil build package.

## Fitur Utama

### Dashboard

Dashboard mencakup:

- Dashboard Overview dengan stream live, stream terjadwal, item yang perlu perhatian, dan aktivitas terbaru.
- Halaman Monitoring untuk CPU, memori, bandwidth, disk, FFmpeg, FFprobe, scheduler, dan status proses.
- Halaman Log dengan update SSE langsung, filter stream/jenis/pencarian, pause/resume, export, dan clear.
- Halaman Sources untuk menambah URL langsung atau sumber Google Drive, melihat detail media, preview, rename, membatalkan download, retry, menghapus, dan bulk delete.
- Halaman Targets untuk membuat/mengedit target RTMP/RTMPS dan mengaktifkan/menonaktifkan tujuan.
- Halaman Streams untuk lifecycle stream, log, export, edit waktu berhenti, dan penghapusan aman.
- Halaman Settings untuk timezone, batas penggunaan disk, kunci API Data YouTube opsional (write-only), ganti password dashboard, dan regenerate API token.
- i18n EN/ID dengan parity dan test orphan key.

### Sources

Sources mendukung:

- Sumber video URL langsung.
- Tautan berbagi Google Drive.
- Parsing file ID Google Drive yang aman.
- Perlindungan SSRF dengan pemeriksaan DNS, validasi setiap hop redirect, dan DNS pinning saat koneksi sehingga request hanya tersambung ke alamat publik yang sudah divalidasi.
- Batas ukuran download, enforcement batas penggunaan disk, dan cleanup saat gagal.
- Ekstraksi metadata FFprobe dengan timeout probe.
- Validasi codec dan bitrate dengan fallback `format.bit_rate`.
- Penyimpanan cache lokal yang dihapus dari disk saat source dihapus.
- Batas konkurensi download+probe untuk melindungi disk/CPU.
- Dialog detail dengan durasi, resolusi, FPS, codec, bitrate, dan alasan invalid.
- Progress download, cancel, retry, rename, preview, dan bulk delete.

Aturan validasi:

- Codec video: H.264 / AVC1.
- Codec audio: AAC / MP4A.
- Bitrate video maksimum: `35000 kbps` / `35 Mbps`.

### Targets

Targets mendukung:

- Label, URL ingest RTMP/RTMPS, dan stream key terenkripsi.
- Edit label/URL ingest serta penggantian stream key secara opsional.
- Status aktif/nonaktif.
- Kolom tanggal dibuat dan sorting terbaru terlebih dahulu.
- Bulk delete untuk baris terpilih.
- Rotasi token mengenkripsi ulang secret target yang tersimpan.

### Streams

Streams mendukung:

- Job start manual.
- Waktu mulai terjadwal.
- Waktu auto-stop opsional.
- Recurrence: none, daily, weekly, monthly.
- Status persisten: `pending`, `running`, `stopping`, `stopped`, `failed`.
- Metrik runtime dari stderr FFmpeg.
- Aksi stop langsung dan tombstone crash-safe.
- Penghapusan aman yang diblokir untuk stream running/stopping.
- Export log stream sebagai file teks.

Matriks aksi stream:

| Status     | Aksi                                                     |
| ---------- | -------------------------------------------------------- |
| `pending`  | View Log, Export Log, Edit, Delete                       |
| `running`  | View Log, Export Log, Stop, Edit (URL Live YouTube saja) |
| `stopping` | View Log, Export Log, Edit (URL Live YouTube saja)       |
| `stopped`  | View Log, Export Log, Edit, Delete                       |
| `failed`   | View Log, Export Log, Start, Edit, Delete                |

Edit tersedia di setiap status agar operator bisa menambahkan/mengubah URL Live YouTube untuk analitik tanpa membuat ulang stream. Saat `running` atau `stopping`, hanya field URL Live YouTube yang bisa diedit; title, source, target, dan jadwal dikunci. Video sumber selalu di-loop sampai stop atau auto-stop.

### Log dan Event

Events mendukung:

- Listing event terbaru, maksimum 200 event.
- SSE event global dengan heartbeat keepalive 15 detik.
- SSE event khusus stream.
- Export event global sebagai teks.
- Export event stream sebagai teks.
- Konfirmasi clear semua log.
- URL signed berumur pendek untuk SSE/export browser.
- Penyimpanan event maksimum 5000 baris dengan pruning otomatis.

### API untuk Core

Integrasi eksternal sebaiknya menggunakan endpoint `/api/v1/*` dengan autentikasi Bearer token.

Endpoint yang tersedia:

- `GET /api/v1/health` - health worker ringan.
- `GET /api/v1/stats` - statistik monitoring dan ringkasan stream terbaru.
- `GET /api/v1/capabilities` - versi API worker, feature flags, limit, dan pengaturan aman.
- `GET /api/v1/link` - metadata link/install tanpa membocorkan raw token.
- `POST /api/v1/settings/token` - rotasi token worker dan enkripsi ulang secret target.

Origin CORS tidak diizinkan secara default. Atur origin yang diizinkan dengan `KUMIX_WORKER_CORS_ORIGINS`.

## CLI

Perintah umum:

```bash
kumix-worker init
kumix-worker serve
kumix-worker status
kumix-worker doctor
kumix-worker token
kumix-worker token --show
kumix-worker token --regenerate
kumix-worker password --password <password-baru>
kumix-worker reset --yes
kumix-worker reset --all --yes
kumix-worker reset --force --yes
kumix-worker update
```

`kumix-worker update` mendukung `--check`, `--restart`, `--force`, dan `--auto-start`.

> **Catatan:** `kumix-worker update` hanya berfungsi untuk instalasi NPM. Untuk deployment Docker, pull image terbaru dan buat ulang container — lihat [DOCKER.md](./DOCKER.md#update-to-latest).

Perintah development:

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

Jalankan perintah dari root repository. Dependency root dan frontend memerlukan instalasi terpisah.

`bun run dev` menjalankan:

- API pada `http://localhost:8080`.
- Dashboard Vite pada `http://localhost:8000` (proxy `/api` ke worker).

## Data Runtime

Direktori data default:

```text
~/.kumix-worker
```

Struktur data:

```text
~/.kumix-worker/
  config.json
  db/
    db.sqlite
  cache/
  tombstones/
```

Config berisi:

- `token` — kunci Bearer API, root enkripsi stream key, HMAC signed URL
- `passwordHash` — hash scrypt password login dashboard
- `port`
- `timezone`
- `diskUsageLimitPercent`
- `youtubeApiKey` — opsional; tidak pernah dikembalikan mentah dari API
- `dataDir`

File config ditulis dengan permission terbatas jika didukung sistem operasi.

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

`KUMIX_WORKER_FFMPEG_PATH` dan `KUMIX_WORKER_FFPROBE_PATH` mengganti binary statis bawaan dengan FFmpeg/FFprobe sistem. Gunakan saat build statis gagal melakukan resolve DNS untuk output RTMP (pada sebagian host dapat mengalami segfault karena glibc statis tidak dapat memuat modul NSS). Jika tidak diatur, binary `ffmpeg-static`/`ffprobe-static` digunakan.

`KUMIX_WORKER_AUTO_RESUME` default aktif. Saat stop graceful (`SIGTERM`/`SIGINT`, mis. `docker stop` atau compose recreate), stream aktif ditandai dan dijalankan lagi setelah boot. Set `0` untuk menonaktifkan.

## Ringkasan HTTP API

Route dashboard/private menggunakan Bearer token:

- `/api/settings`, `PATCH /api/settings`, `POST /api/settings/password`
- `/api/stats`
- `/api/metrics`
- `/api/health/details`
- `/api/bandwidth`
- `/api/sources`
- `/api/targets`
- `/api/streams`
- `/api/events`
- `/api/events/signed-url`
- `/api/sources/:id/preview-url`

Preview source cache (`GET /api/sources/:id/preview`, dengan dukungan HTTP range) diotorisasi menggunakan URL signed berumur pendek, bukan header Bearer, agar elemen `<video>` dashboard dapat melakukan streaming langsung.

Route publik tanpa autentikasi:

- `GET /health`
- `GET /api/bootstrap`
- `GET /openapi`
- `GET /docs`
- `GET /auth?token=...` (handoff CLI/core saja)
- `POST /api/auth/login` (password dashboard)
- `POST /api/auth/exchange` (kode handoff → session token)

URL signed dibuat oleh `POST /api/events/signed-url` dan `POST /api/sources/:id/preview-url`, serta berumur pendek.

## Catatan Keamanan

- Login dashboard memakai password (default pabrik `123456`, di-hash scrypt). Login pertama dengan default memaksa ganti password di SPA. Ganti kapan saja di Settings atau lewat `kumix-worker password --password <pw>`. Ganti password tidak merotasi token API, tidak mengenkripsi ulang stream key, dan tidak mematikan sesi Bearer lain.
- Hash password async scrypt dengan parameter biaya allowlisted (menolak `passwordHash` korup/malicious yang bisa DoS proses). `passwordHash` invalid fail-closed (tidak silent reset ke default).
- Rute API membutuhkan auth Bearer token kecuali yang memang public. Setelah login password (atau handoff), SPA menyimpan worker token di **localStorage** dan mengirimkannya sebagai Bearer. Pada 401 SPA membersihkan sesi.
- Handoff core: `/auth?token=` memvalidasi token, lalu redirect `#code=` single-use yang ditukar lewat `POST /api/auth/exchange`. URL dashboard dari CLI tidak pernah menyematkan token (login password).
- Rotasi token (`POST /api/v1/settings/token` atau `kumix-worker token --regenerate`) hanya mengembalikan `{ rotatedAt, tokenLength }` — tidak meng-echo token baru. Rotasi konkuren diserialisasi; stream key dienkripsi ulang dengan rollback jika tulis config gagal.
- Percobaan auth invalid di-rate-limit (10 / 60s / IP), dengan lazy expiry dan prune. Header forwarded hanya dipercaya saat `KUMIX_WORKER_TRUST_PROXY=1` (hanya di belakang proxy yang strip XFF klien).
- Panggilan web/core API di-rate-limit terpisah.
- Rute `/api/*` membatasi body request 1 MB; path `/api/*` yang tidak dikenal mengembalikan envelope 404.
- Respons menyertakan security header: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, dan Content-Security-Policy dasar.
- Password dashboard baru tidak boleh sama dengan default pabrik (`123456`); ditolak API dan CLI.
- Stream key dienkripsi AES-256-GCM dari worker token. FFmpeg di-spawn dengan URL RTMP (termasuk stream key) sebagai argv — deploy single-tenant atau di container agar daftar proses tidak dibagikan.
- Raw worker token dan password hash tidak pernah dikembalikan dari settings atau endpoint core-facing. Settings hanya mengekspos `passwordIsDefault` / `hasPassword` (boolean) dan `tokenLength`.
- Raw dan encrypted stream key target tidak pernah dikembalikan dari respons API; hanya masked preview yang diekspos.
- Download source dilindungi SSRF via cek DNS, validasi tiap hop redirect, dan DNS pinning saat koneksi yang memblokir alamat private, loopback, link-local, dan embedded-IPv4 (6to4/NAT64). Gagal resolve confirmation Google Drive tidak fallback ke halaman HTML karantina. Download konkuren dibatasi.
- Static file serving menjaga path traversal dan men-stream aset.
- Nama file cache source dan export event disanitasi.
- Tulis config atomik. Crash recovery menghindari terminate PID yang di-reuse setelah reboot. Graceful shutdown menghentikan stream dan menutup HTTP server dengan timeout agar klien SSE tidak menahan exit.
- Reset data destruktif menolak direktori yang tidak aman.

## CI dan Release

GitHub Actions:

- `ci.yml` menjalankan install, typecheck, lint, test, dan build pada pull request serta push ke main.
- `release.yml` publish ke NPM pada tag `v*`, sekaligus build/push image Docker multi-platform ke GHCR dan Docker Hub.

Publish NPM memerlukan secret repository `NPM_TOKEN`.

Tag release menggunakan:

```text
vX.Y.Z
```

## Verifikasi

Sebelum menyelesaikan perubahan penting, jalankan:

```bash
bun run types:check
bun run lint
bun run test
bun run build
```

Test suite mencakup:

- Validasi config, termasuk penolakan token lemah dan seeding password hash.
- Helper password (hash/verify scrypt async, penolakan parameter korup).
- Integrasi DB dan agregasi stats.
- CRUD HTTP API, login auth/ganti password, non-exposure stream key, perlindungan penghapusan stream aktif, dan flow SSE signed URL.
- Rate limit auth dan security response header.
- Kontrak API core-facing.
- Keamanan static serving.
- Helper FFmpeg/FFprobe.
- Download source dan validasi SSRF.
- Scheduler, recurrence, dan lifecycle tick.
- Recovery/tombstone.
- Crypto/token re-encryption.
- Verifikasi token dengan perbandingan timing-safe.
- Perbandingan versi untuk self-update.
- Lifecycle stream runner.
- Parity message frontend dan orphan key.
- Smoke test frontend.

## Troubleshooting

### Stream langsung gagal atau segfault

Binary FFmpeg/FFprobe bawaan terhubung statis dengan glibc. Pada sebagian host, glibc statis tidak dapat memuat modul NSS dan binary dapat segfault saat melakukan resolve DNS untuk output RTMP. Jika stream langsung gagal dengan segfault atau error yang tidak jelas, pasang FFmpeg sistem dan ganti binary bawaan:

```bash
# Debian/Ubuntu
sudo apt install ffmpeg

# Arahkan Kumix Worker ke binary sistem
export KUMIX_WORKER_FFMPEG_PATH=/usr/bin/ffmpeg
export KUMIX_WORKER_FFPROBE_PATH=/usr/bin/ffprobe

kumix-worker serve
```

Image Docker resmi sudah menginstal FFmpeg/FFprobe sistem via apt dan mengatur `KUMIX_WORKER_FFMPEG_PATH` / `KUMIX_WORKER_FFPROBE_PATH` ke `/usr/bin/*`, jadi container tidak bergantung pada binary static bawaan untuk output RTMP.

### Config kehilangan token

Jika worker menolak start karena token hilang, worker menolak membuat token baru agar encrypted stream key yang sudah ada tidak menjadi tidak dapat didekripsi. Pulihkan `config.json` asli atau jalankan factory reset:

```bash
kumix-worker reset --all --yes
kumix-worker init
```
