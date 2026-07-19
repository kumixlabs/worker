# syntax=docker/dockerfile:1.7

# ---- Builder: Node + Bun compiles native dependencies and builds the dashboard ----
FROM node:24-bookworm AS builder
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global bun@1.3.14

COPY package.json bun.lock ./
COPY scripts/postinstall.js ./scripts/postinstall.js
# Use bun for lockfile-faithful installs. Runtime FFmpeg comes from apt (see runner).
RUN bun install --frozen-lockfile

COPY frontend/package.json frontend/bun.lock ./frontend/
RUN cd frontend && bun install --frozen-lockfile

COPY . ./
RUN bun run build

# Prune to production deps for the runtime image.
RUN bun install --frozen-lockfile --production


# ---- Runner: Node slim (glibc) runs the compiled worker ----
FROM node:24-bookworm-slim AS runner
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

LABEL org.opencontainers.image.title="kumix-worker" \
      org.opencontainers.image.description="Kumix Worker self-hosted live runner" \
      org.opencontainers.image.source="https://github.com/kumixlabs/worker" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    KUMIX_WORKER_DATA_DIR=/app/data \
    KUMIX_WORKER_PORT=8080 \
    KUMIX_WORKER_FFMPEG_PATH=/usr/bin/ffmpeg \
    KUMIX_WORKER_FFPROBE_PATH=/usr/bin/ffprobe

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/scripts/postinstall.js ./scripts/postinstall.js
COPY --from=builder /app/package.json ./package.json

RUN mkdir -p /app/data && chown -R node:node /app

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.KUMIX_WORKER_PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "dist/cli.js"]
CMD ["serve", "--host", "0.0.0.0"]
