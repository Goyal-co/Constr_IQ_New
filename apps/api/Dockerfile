# Multi-stage build for the API.
#
# The builder installs dev dependencies and compiles; the runtime stage carries
# only production dependencies and the emitted JavaScript, which keeps the image
# small and removes the compiler toolchain from the attack surface.

FROM node:22-alpine AS builder
WORKDIR /app

# Copy manifests first so `npm ci` is cached until a dependency actually changes.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @ciq/shared --workspace @ciq/api --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

RUN npm run build --workspace @ciq/shared \
  && npm run build --workspace @ciq/api \
  && npm run db:seed:build --workspace @ciq/api

# --- Runtime ---------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Prisma needs OpenSSL at runtime; alpine does not ship it by default.
RUN apk add --no-cache openssl dumb-init

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev --workspace @ciq/shared --workspace @ciq/api --include-workspace-root \
  && npm cache clean --force

COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/apps/api/dist apps/api/dist
COPY --from=builder /app/apps/api/prisma apps/api/prisma

# The compiled bootstrap, so the first administrator can be created from a
# shell on the deployed service:
#
#   npm run db:seed:dist -w @ciq/api
#
# Compiled rather than run through ts-node, because this stage installs with
# `--omit=dev` and ts-node is not here: `npm run db:seed` fails with
# `ts-node: not found` at exactly the moment somebody is bootstrapping a
# fresh deployment. Not part of CMD — migrations run on every deploy, this
# must not.
COPY --from=builder /app/apps/api/dist-seed apps/api/dist-seed
COPY --from=builder /app/node_modules/.prisma node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client node_modules/@prisma/client

# Run unprivileged. The node image ships a `node` user for exactly this.
USER node

EXPOSE 4000

# Liveness, not readiness.
#
# Docker restarts a container this check condemns, so it must fail only for
# reasons a restart can fix. `/health` touches nothing; `/health/ready` opens a
# database connection, and pointing this at it would turn a Neon cold start into
# a restart loop against a process that was working.
#
# Both the port and the prefix are read from the environment rather than
# hard-coded. Managed hosts inject their own port — Render uses 10000 — and a
# check pinned to 4000 reports every one of those containers as unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const p=process.env.PORT||4000,x=process.env.API_PREFIX||'api/v1';fetch('http://127.0.0.1:'+p+'/'+x+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# dumb-init reaps zombies and forwards SIGTERM, so graceful shutdown works.
ENTRYPOINT ["dumb-init", "--"]

# Migrations run at start-up rather than at build time: the database is not
# reachable from the build environment, and a rolling deploy must apply pending
# migrations before serving traffic.
CMD ["sh", "-c", "npx prisma migrate deploy --schema apps/api/prisma/schema.prisma && node apps/api/dist/main.js"]
