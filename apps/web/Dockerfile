# Multi-stage build for the web client.
#
# Production serves this from Vercel. This image exists so the same bundle can
# run anywhere else — a compose stack on a laptop, a VM, a container platform —
# without a second build recipe that could drift from the one Vercel runs.
#
# Build from the REPOSITORY ROOT, not from apps/web:
#
#   docker build -f apps/web/Dockerfile -t ciq-web \
#     --build-arg VITE_API_URL=https://your-api.example.com/api/v1 .
#
# The context has to be the root because the client imports @ciq/shared, which
# is a sibling workspace: a context of apps/web cannot see it.

FROM node:22-alpine AS builder
WORKDIR /app

# Manifests first, so `npm ci` stays cached until a dependency actually changes.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @ciq/shared --workspace @ciq/web --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web

# The API's public base URL. Required, and deliberately without a default.
#
# A build argument rather than a runtime variable because Vite substitutes
# `import.meta.env` at build time — the value is compiled into the JavaScript.
# Setting it in the container's environment later has no effect whatsoever, and
# that surprise is worth naming here rather than debugging at the other end.
#
# No default, because the failure mode of a wrong default is silent: the image
# builds, the page loads, and every request goes to somebody else's API until a
# person notices. The check below turns that into a build that stops and says
# what is missing.
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}

RUN test -n "$VITE_API_URL" || { \
      echo "VITE_API_URL is required. Pass it with:"; \
      echo "  docker build --build-arg VITE_API_URL=https://api.example.com/api/v1 ..."; \
      exit 1; \
    }

RUN npm run build --workspace @ciq/shared \
  && npm run build --workspace @ciq/web

# --- Runtime ---------------------------------------------------------------
# The unprivileged nginx image: it already runs as a non-root user and keeps its
# pid and temp files where that user can write them. Hardening the stock nginx
# image by hand to reach the same place is several lines of chown that this
# avoids entirely.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

# Rendered by the image's own entrypoint, which runs envsubst over
# /etc/nginx/templates before starting nginx.
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template

# Included by every location block that sets a header of its own. nginx does not
# merge `add_header` across levels — see the file for what that costs.
COPY apps/web/nginx-security-headers.conf /etc/nginx/snippets/security-headers.conf

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# 8080 rather than 80: a non-root process cannot bind a privileged port. Hosts
# that inject their own $PORT override this, which the template handles.
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --quiet --spider "http://127.0.0.1:${PORT}/healthz" || exit 1
