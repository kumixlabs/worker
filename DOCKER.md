# Docker

Run Kumix Worker in a container. Published images:

- **Docker Hub**: [`kumix/worker`](https://hub.docker.com/r/kumix/worker)
- **GHCR**: [`ghcr.io/kumixlabs/worker`](https://github.com/kumixlabs/worker/pkgs/container/worker)

Multi-platform: `linux/amd64` + `linux/arm64`.

---

# For Users

## Quick start

```bash
docker run -d \
  -p 8080:8080 \
  -v "$HOME/.kumix-worker:/app/data" \
  -e KUMIX_WORKER_DATA_DIR=/app/data \
  --name kumix-worker \
  kumix/worker:latest
```

The worker listens on port `8080`. Open the dashboard URL printed in the container logs:

```bash
docker logs kumix-worker
```

Look for the `Auth URL:` line (run with `-e KUMIX_WORKER_DEV=1` or check the masked token) to open the authenticated dashboard.

## Manage container

```bash
docker logs -f kumix-worker     # view logs
docker stop kumix-worker        # stop
docker start kumix-worker       # start again
docker rm -f kumix-worker       # remove
```

## Data persistence

```bash
-v "$HOME/.kumix-worker:/app/data" \
-e KUMIX_WORKER_DATA_DIR=/app/data
```

Data layout under the mounted volume:

```text
/app/data/
├── config.json
├── db/
│   └── db.sqlite
├── cache/          # downloaded source videos
└── tombstones/     # crash-recovery markers
```

Host path: `$HOME/.kumix-worker/`
Container path: `/app/data/`

## docker-compose

```yaml
services:
  kumix-worker:
    image: kumix/worker:latest
    restart: always
    ports:
      - "8080:8080"
    volumes:
      - kumix-worker-data:/app/data
    environment:
      KUMIX_WORKER_DATA_DIR: /app/data
      KUMIX_WORKER_PORT: "8080"
      NODE_ENV: production

volumes:
  kumix-worker-data:
```

```bash
docker compose up -d
```

## Optional environment variables

```bash
docker run -d \
  -p 8080:8080 \
  -v "$HOME/.kumix-worker:/app/data" \
  -e KUMIX_WORKER_DATA_DIR=/app/data \
  -e KUMIX_WORKER_PORT=8080 \
  -e KUMIX_WORKER_TIMEZONE=Asia/Jakarta \
  -e KUMIX_WORKER_DISK_LIMIT_PERCENT=90 \
  -e KUMIX_WORKER_CORS_ORIGINS=https://app.example.com \
  --name kumix-worker \
  kumix/worker:latest
```

See [README.md](./README.md#environment-variables) for the full list.

## Update to latest

```bash
docker pull kumix/worker:latest
docker rm -f kumix-worker
# re-run the quick start command
```

---

# For Developers

## Build image locally

```bash
docker build -t kumix-worker .

docker run --rm -p 8080:8080 \
  -v "$HOME/.kumix-worker:/app/data" \
  -e KUMIX_WORKER_DATA_DIR=/app/data \
  kumix-worker
```

## Publish (automatic via CI)

Push a git tag `v*` -> GitHub Actions builds and publishes:

- **NPM**: `@kumix/worker@ vX.Y.Z`
- **Docker** (multi-platform amd64 + arm64):
  - `ghcr.io/kumixlabs/worker:vX.Y.Z` + `:latest`
  - `kumix/worker:vX.Y.Z` + `:latest`

```bash
git tag v1.2.3 && git push origin v1.2.3
```

Workflow: `.github/workflows/release.yml`

Required repository secrets:

- `NPM_TOKEN` - npm publish access
- `DOCKERHUB_USERNAME` + `DOCKERHUB_TOKEN` - Docker Hub push
- `GITHUB_TOKEN` - automatic (GHCR push, no setup needed)
