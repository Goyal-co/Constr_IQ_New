# Deployment

Three pieces, deployed separately:

| Piece      | Where it goes                        | What it is                |
| ---------- | ------------------------------------ | ------------------------- |
| Web client | **Vercel**                           | Static bundle on a CDN    |
| API        | **Railway** (or Render / Fly / a VM) | Long-running Node process |
| Database   | **Neon** (or Railway Postgres)       | Managed PostgreSQL 16     |

The API cannot go on Vercel. It runs a scheduler (nightly risk sweep, weekly
digest) and holds a Prisma connection pool — both need a process that stays
alive between requests, which serverless functions do not give you.

Deploy the API first: the web build bakes in the API's URL, so it needs to exist
before you build the client.

---

## 1. API

The API **cannot** go on Vercel. It runs a scheduler and holds a Prisma
connection pool, both of which need a process that stays alive between requests.

Render's free plan and Railway are both set up in the repo. Render costs nothing
but suspends the service when idle; Railway keeps it warm but is paid.

### Render (free tier)

The repo ships [`render.yaml`](render.yaml) and
[`apps/api/Dockerfile`](apps/api/Dockerfile).

1. **Render → New → Blueprint**, point it at this repo. It reads `render.yaml`
   and creates the service with the Dockerfile, health check and generated JWT
   secrets already set.
2. Fill in the variables it prompts for: `DATABASE_URL`, `CORS_ORIGINS`,
   `WEB_APP_URL`.
3. Copy the service URL. That plus `/api/v1` is what the web client needs.

Two free-plan behaviours matter for this app specifically:

- **The service is suspended after ~15 minutes without traffic**, and the first
  request afterwards waits through a cold start of roughly a minute. Someone
  opening the tracker after lunch will think it has broken.
- **A suspended service runs no scheduled work.** `render.yaml` therefore sets
  `ENABLE_SCHEDULER=false`: the nightly risk sweep and weekly digest would
  otherwise fire only when somebody happened to be using the app, which reads as
  erratic rather than as disabled. Everything on screen is computed per request,
  so nothing else is affected — the only loss is the emailed digest and the
  overnight risk pass. Set it to `true` once the service stays warm.

Keeping it awake with an external pinger works and stays inside the 750
instance-hours a month a single always-on service uses, but check Render's
current terms — they have restricted this before.

### Do not use Render's free Postgres

It is **deleted after 30 days**. Use [Neon](https://neon.tech) instead: its free
tier does not expire, and it is the same managed Postgres either way. This is why
`render.yaml` has no `databases:` block and asks you to paste `DATABASE_URL`.

### Railway

Also supported — [`railway.json`](railway.json) selects the same Dockerfile and
sets the start command and health check. Deploy from the repo root, add a
Postgres service, set the variables below, then **Settings → Networking →
Generate Domain**. Railway keeps a process warm, so leave
`ENABLE_SCHEDULER=true` and replicas at 1.

### Any other host, without Docker

```
Build    npm install && npm run build -w @ciq/api
Start    npm run start:prod -w @ciq/api
```

`start:prod` applies migrations and then starts the server. `@ciq/api`'s build
compiles `@ciq/shared` first via its `prebuild` script, so building the API alone
is enough.

### Environment

Full annotated list in [`apps/api/.env.example`](apps/api/.env.example). The
required set:

```
NODE_ENV=production
DATABASE_URL=postgresql://…?sslmode=require
JWT_ACCESS_SECRET=<48 random bytes>
JWT_REFRESH_SECRET=<a different 48 random bytes>
CORS_ORIGINS=https://your-app.vercel.app
WEB_APP_URL=https://your-app.vercel.app
```

Generate the two secrets separately — they must differ, or a refresh token is
also a valid access token. The API refuses to boot in production if they match
or if either is left at the example value:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

`PORT` is injected by Railway; do not set it. `CORS_ORIGINS` takes a
comma-separated list, so include any custom domain alongside the `.vercel.app`
one.

### Storage and email are off by default

Neither is required, and the defaults need no third-party account:

- `STORAGE_DRIVER=local` — attachments are written to disk and served by the
  API's own download route. **Caveat:** container filesystems are usually wiped
  on redeploy. Attach a persistent volume at `LOCAL_UPLOAD_DIR`, or switch to
  `s3` (any S3-compatible endpoint: AWS, Cloudflare R2, Backblaze B2), or accept
  that uploads do not survive a deploy.
- `MAIL_DRIVER=log` — messages go to the application log. In-app notifications
  still work; only the emailed copy is suppressed.

To send email through Brevo, pick the driver that matches the credential you
hold — Brevo issues two, and they are not interchangeable.

**If you have an API key** (`xkeysib-…`, from Brevo → SMTP & API → **API Keys**):

```
MAIL_DRIVER=brevo
BREVO_API_KEY=xkeysib-…
MAIL_FROM=alert@goyalco.email
MAIL_FROM_NAME=Goyal & Co | Hariyana Group
```

**If you have SMTP credentials** (from Brevo → SMTP & API → **SMTP**):

```
MAIL_DRIVER=smtp
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<the login shown there, e.g. 8a1b2c001@smtp-brevo.com>
SMTP_PASSWORD=<the SMTP key>
MAIL_FROM=alert@goyalco.email
MAIL_FROM_NAME=Goyal & Co | Hariyana Group
```

Three things that catch people out:

- **An API key is not an SMTP password.** Putting `xkeysib-…` in `SMTP_PASSWORD`
  fails with an opaque `535`. The API refuses to boot on that combination and
  says which setting you actually want.
- **`MAIL_FROM` must be a verified sender.** Verify the address, or better the
  whole domain, under Brevo → Senders, Domains & Dedicated IPs first. An
  unverified sender is rejected at submission, not silently dropped.
- **`SMTP_SECURE=false` on port 587 is correct** — the session starts in the
  clear and upgrades via STARTTLS. Setting it `true` on 587 breaks the
  handshake. Use 465 for implicit TLS. If your host blocks outbound 587, either
  use port 2525 or switch to `MAIL_DRIVER=brevo`, which is plain HTTPS and is
  the safer default on a container host for exactly that reason.

Note the variable names: if you have these written down as `EMAIL_FROM` and
`EMAIL_FROM_NAME`, they are `MAIL_FROM` and `MAIL_FROM_NAME` here.

`GET /api/v1/health/ready` reports the mail transport alongside the database, so
you can confirm the key is accepted without waiting for the weekly digest to
fire:

```json
{ "status": "ok", "checks": { "database": "ok", "mail": "ok" } }
```

`"mail": "error"` does not make the service unready — a broken relay degrades
digests but does not stop anyone using the app — so watch the field rather than
the overall status.

### First run — creating the owner account

Migrations create the tables but no rows, so the first sign-in needs the
bootstrap to have run once. It creates the organisation, the owner account and
the two work phases, and nothing else.

The simplest route on any host is to run it from your own machine against the
production database — the bootstrap only inserts rows, so it needs nothing but a
connection string:

```bash
DATABASE_URL='<your Neon pooled URL>' npm run db:seed -w @ciq/api
```

On Windows PowerShell:

```
$env:DATABASE_URL='<your Neon pooled URL>'; npm run db:seed -w @ciq/api
```

Render's free plan has no shell, which is why this is the documented path.
Railway has one under **Deployments → ⋮ → Shell**, or `railway run npm run
db:seed -w @ciq/api`.

It is idempotent and never overwrites an existing account's password, so
re-running it is harmless. Set `BOOTSTRAP_OWNER_EMAIL` / `BOOTSTRAP_OWNER_PASSWORD`
in the environment first if you want different credentials than the defaults.

## 2. Web client (Vercel)

```
Root directory   apps/web
Framework        Vite  (detected)
```

Leave the build and install commands alone — [`apps/web/vercel.json`](apps/web/vercel.json)
already sets them to build `@ciq/shared` first from the repo root, which a
default Vercel Vite build would skip and then fail on the missing workspace
package.

### Environment — one variable

```
VITE_API_URL=https://your-api.up.railway.app/api/v1
```

Include the `/api/v1` prefix; no trailing slash.

Nothing else belongs here. This is a static bundle on a CDN, so every value set
in the Vercel project is compiled into JavaScript that visitors download —
`DATABASE_URL`, JWT secrets, SMTP credentials and S3 keys must never be added.
Vite only exposes `VITE_`-prefixed variables, which makes the mistake harder,
not impossible.

`VITE_API_URL` is read at **build** time. Changing it in the dashboard does
nothing until you redeploy.

### After deploying

Set `CORS_ORIGINS` on the API to the Vercel URL and redeploy the API. Until you
do, the browser blocks every request and the app shows a network error on sign-in
with nothing useful in the UI — check the browser console for the CORS message.

---

## Checklist

- [ ] Postgres created; pooled connection string copied
- [ ] API deployed with `NODE_ENV`, `DATABASE_URL`, both JWT secrets, `CORS_ORIGINS`
- [ ] `GET https://your-api/api/v1/health/ready` shows `database: ok`
- [ ] Bootstrap run once — owner account exists
- [ ] Vercel **Root Directory is `apps/web`** and `VITE_API_URL` is set
- [ ] Web redeployed after setting `VITE_API_URL` (it is baked in at build time)
- [ ] `CORS_ORIGINS` updated to the real Vercel URL, API redeployed
- [ ] Signed in, then changed the bootstrap password

## Troubleshooting

**Vercel build fails with dozens of `Cannot find module '@ciq/shared'` errors,
and the log shows `> @ciq/api@1.0.0 build`.** The project's Root Directory is
pointing at `apps/api` — Vercel is building the API, which does not belong
there. Set **Settings → General → Root Directory** to `apps/web` and redeploy.

**Sign-in shows a network error and the console reports a CORS failure.**
`CORS_ORIGINS` on the API does not include the exact origin the browser is
using. It must match scheme and host exactly, with no trailing slash, and custom
domains need their own entry alongside the `.vercel.app` one.

**Sign-in returns 401 for credentials you know are right.** The bootstrap has
not been run against this database, so the account does not exist. See _First
run_.

**Everything loads but every request 404s.** `VITE_API_URL` is missing the
`/api/v1` prefix, or has a trailing slash.

**The first request after a quiet period hangs for about a minute, then
works.** Render's free plan suspended the service and is cold-starting it. Not a
bug, and not fixable on that plan — an external pinger or a paid instance are the
two ways out.

**Digest emails never arrive on Render free.** `ENABLE_SCHEDULER=false` is set in
`render.yaml` on purpose, because a suspended service runs no scheduled work.
Nothing on screen is affected — those figures are computed per request.

## Verifying locally before you deploy

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```

All four must pass; the Vercel build runs the same TypeScript compile.
