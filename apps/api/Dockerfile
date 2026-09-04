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
#
# `db:seed:build` compiles the bootstrap to apps/api/dist-seed, and it has to run
# here — before the prune. The seed is TypeScript, and `npm prune --omit=dev`
# takes ts-node and the compiler with it, so `npm run db:seed` inside the
# finished image fails with `ts-node: not found` at exactly the moment somebody
# is creating the first administrator on a fresh deployment. In a container the
# command is therefore:
#
#   npm run db:seed:dist -w @ciq/api
#
# Deliberately not part of CMD below: migrations must run on every deploy, the
# bootstrap must not.
RUN npm run build --workspace=@ciq/shared \
  && npm run build --workspace=@ciq/api \
  && npm run db:seed:build --workspace=@ciq/api \
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
#
# Both the port and the prefix come from the environment. Managed hosts inject
# their own port — Render uses 10000 — and API_PREFIX is configurable, so a check
# pinned to `4000` or to `/api/v1` reports a perfectly healthy container as
# unhealthy the moment either one is changed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "const p=process.env.PORT||4000,x=process.env.API_PREFIX||'api/v1';fetch('http://127.0.0.1:'+p+'/'+x+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]

# Migrate at start (not build): the DB is unreachable in most build sandboxes,
# and a rolling deploy must apply pending migrations before serving traffic.
#
# Three things worth noting about this line:
#
#   `timeout 300` — migrate runs BEFORE the server binds a port, so anything
#   that makes it hang is indistinguishable from a dead service: the platform
#   waits out its port scan and reports "no open ports detected" with no
#   explanation, because the container has printed nothing. Prisma can wait like
#   this on a migration advisory lock left behind by a previous deploy that was
#   killed mid-apply. Five minutes is far longer than a real migration and far
#   shorter than a deploy window, so a hang now ends as a fast, loud exit 124.
#
#   `exec` — so node replaces the shell and receives SIGTERM from dumb-init
#   directly, rather than sitting behind a shell that would not forward it.
CMD ["sh", "-c", "timeout 300 npx prisma migrate deploy --schema apps/api/prisma/schema.prisma; status=$?; if [ $status -eq 124 ]; then echo 'FATAL: prisma migrate deploy exceeded 300s and was killed. A previous deploy may hold the migration advisory lock, or DATABASE_URL is unreachable.' >&2; exit 1; elif [ $status -ne 0 ]; then echo \"FATAL: prisma migrate deploy failed with status $status\" >&2; exit $status; fi; exec node apps/api/dist/main.js"]
