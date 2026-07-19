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
- Halaman Settings untuk timezone, batas penggunaan disk, dan kunci API Data YouTube opsional (write-only).
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
- Hash SHA-256 secara streaming.
- Penyimpanan cache lokal yang dihapus dari disk saat source dihapus.
- Dialog detail dengan durasi, resolusi, FPS, codec, bitrate, SHA-256, dan alasan invalid.
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
kumix-worker token
kumix-worker reset --yes
kumix-worker reset --all --yes
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

- `token`
- `port`
- `timezone`
- `diskUsageLimitPercent`
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

Preview source cache (`GET /api/sources/:id/preview`, dengan dukungan HTTP range) diotorisasi menggunakan URL signed berumur pendek, bukan header Bearer, agar elemen `<video>` dashboard dapat melakukan streaming langsung.

Route publik tanpa autentikasi:

- `GET /health`
- `GET /api/bootstrap`
- `GET /openapi`
- `GET /docs`
- `GET /auth?token=...`
- `POST /api/auth/exchange`
- `POST /api/auth/verify`

URL signed dibuat oleh `POST /api/events/signed-url` dan `POST /api/sources/:id/preview-url`, serta berumur pendek.

## Catatan Keamanan

- Route API memerlukan Bearer token kecuali route yang secara eksplisit publik.
- Handoff dashboard tidak menaruh token di URL: `/auth?token=` memvalidasi token, lalu redirect dengan kode single-use berumur pendek yang ditukar dashboard melalui `POST /api/auth/exchange`.
- Percobaan token invalid dibatasi rate limit, dengan bucket expired yang dibersihkan. Bucket menggunakan alamat socket secara default; forwarded header hanya dipercaya ketika `KUMIX_WORKER_TRUST_PROXY=1`.
- Request web/core API memiliki rate limit terpisah.
- Route `/api/*` menerapkan batas body request 1 MB.
- Stream key dienkripsi menggunakan token worker.
- Rotasi token mengenkripsi ulang stream key target dalam satu transaksi.
- Raw worker token tidak pernah dikembalikan dari settings atau endpoint core.
- Raw maupun encrypted stream key target tidak pernah dikembalikan oleh response API; hanya preview bermask yang diekspos.
- Download source dilindungi SSRF melalui pemeriksaan DNS, validasi setiap redirect, dan DNS pinning saat koneksi yang memblokir alamat private, loopback, link-local, dan embedded-IPv4 (6to4/NAT64).
- Static file serving melindungi dari path traversal.
- Nama file cache source dan export event disanitasi.
- Penulisan config atomic, dan crash recovery menghindari penghentian PID yang dipakai ulang setelah reboot.
- Reset data destruktif menolak direktori yang tidak aman.

## CI dan Release

GitHub Actions:

- `ci.yml` menjalankan install, typecheck, lint, test, build, dan validasi Docker pada pull request serta push ke main.
- `release.yml` publish ke NPM pada tag `v*`, sekaligus build/push image Docker multi-platform ke GHCR dan Docker Hub.

Publish NPM memerlukan secret repository `NPM_TOKEN`. Docker Hub memerlukan `DOCKERHUB_USERNAME` dan `DOCKERHUB_TOKEN`.

Tag release menggunakan:

```text
vX.Y.Z
```

Versi tag harus sama persis dengan versi di `package.json`. Image Docker menyertakan provenance dan SBOM.

## Verifikasi

Sebelum menyelesaikan perubahan penting, jalankan:

```bash
bun run types:check
bun run lint
bun run test
bun run build
```

Test suite mencakup:

- Validasi config, termasuk penolakan token lemah.
- Integrasi DB.
- CRUD HTTP API, termasuk non-exposure stream key, perlindungan penghapusan stream aktif, dan flow SSE signed URL.
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
