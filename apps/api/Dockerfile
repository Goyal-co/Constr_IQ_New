# ConstructIQ Tracker API — production image (single-stage).
#
# Build context must be the repository root (shared package + workspace lockfile):
#
#   docker build -f apps/api/Dockerfile -t constructiq-api .
#
# Web stays on Vercel/CDN; this image is the long-running NestJS process only.
# No multi-stage: compile, prune, and run in one image for simpler ops on a VM.

FROM node:22-alpine

WORKDIR /app

# Prisma engines need OpenSSL on Alpine. dumb-init reaps zombies and forwards
# SIGTERM/SIGINT so Nest can shut down cleanly behind a process supervisor.
RUN apk add --no-cache openssl dumb-init

# ---------------------------------------------------------------------------
# Dependencies (cached until package manifests change)
# ---------------------------------------------------------------------------
# NODE_ENV is intentionally unset here. With NODE_ENV=production, `npm ci`
# omits devDependencies and the TypeScript / Nest CLI build would fail.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

RUN npm ci \
      --workspace=@ciq/shared \
      --workspace=@ciq/api \
      --include-workspace-root \
  && npm cache clean --force

# ---------------------------------------------------------------------------
# Source + compile
# ---------------------------------------------------------------------------
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

# shared first (API resolves @ciq/shared from dist). API build runs
# `prisma generate` then `nest build` (see apps/api package.json).
RUN npm run build --workspace=@ciq/shared \
  && npm run build --workspace=@ciq/api \
  && npm prune --omit=dev \
  && npm cache clean --force \
  && rm -rf \
       packages/shared/src \
       apps/api/src \
       apps/api/test \
       /root/.npm \
       /tmp/*

# Production from here on: runtime env, non-root user, health, start.
ENV NODE_ENV=production \
    PORT=4000 \
    LOCAL_UPLOAD_DIR=/app/uploads

# Writable upload dir when STORAGE_DRIVER=local. Mount a volume here in prod
# if attachments must survive redeploys; otherwise prefer STORAGE_DRIVER=s3.
RUN mkdir -p /app/uploads \
  && chown -R node:node /app

USER node

EXPOSE 4000

# Liveness only — /health/ready also hits Postgres and would fail the probe
# during a brief DB blip or cold connection. Platforms should use the same path.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "const p=process.env.PORT||4000;fetch('http://127.0.0.1:'+p+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]

# Migrate at start (not build): the DB is unreachable in most build sandboxes,
# and a rolling deploy must apply pending migrations before serving traffic.
CMD ["sh", "-c", "npx prisma migrate deploy --schema apps/api/prisma/schema.prisma && node apps/api/dist/main.js"]
