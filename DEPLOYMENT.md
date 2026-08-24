# Deployment

Three pieces, deployed separately:

| Piece      | Where it goes                       | What it is                            |
| ---------- | ----------------------------------- | ------------------------------------- |
| Web client | **Vercel**                          | Static bundle on a CDN                |
| API        | **Railway** (or Render / Fly / a VM) | Long-running Node process             |
| Database   | **Neon** (or Railway Postgres)      | Managed PostgreSQL 16                 |

The API cannot go on Vercel. It runs a scheduler (nightly risk sweep, weekly
digest) and holds a Prisma connection pool — both need a process that stays
alive between requests, which serverless functions do not give you.

Deploy in the order below: the API needs the database URL, and the web build
needs the API URL.

---

## 1. Database

Create a Postgres 16 database and copy its **pooled** connection string.

On Neon that is the one labelled *Pooled connection*; keep the `?sslmode=require`
suffix. The direct string works too but exhausts connections faster under load.

## 2. API

Point your host at this repo with:

```
Root directory   apps/api
Build command    cd ../.. && npm install && npm run build -w @ciq/shared && npm run build -w @ciq/api
Start command    npm run db:deploy && node dist/main
```

`db:deploy` runs `prisma migrate deploy`, which applies any pending migrations
and is a no-op when there are none — safe to leave in the start command so a
deploy can never run against an unmigrated schema.

### Environment

Full annotated list in [`apps/api/.env.example`](apps/api/.env.example). The
minimum is four values:

```
DATABASE_URL=postgresql://…?sslmode=require
JWT_ACCESS_SECRET=<48 random bytes>
JWT_REFRESH_SECRET=<a different 48 random bytes>
CORS_ORIGINS=https://your-app.vercel.app
```

Generate each secret separately — they must differ, or a refresh token is also a
valid access token, and the API refuses to boot in production if they match or
if either is left at the example value:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Also set `NODE_ENV=production` and `WEB_APP_URL=https://your-app.vercel.app`.

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

### First run

Once, after the first successful deploy:

```bash
npm run db:seed -w @ciq/api
```

This creates the organisation, the owner account and the two work phases. It is
idempotent and never overwrites an existing account's password, so re-running it
is harmless. Override `BOOTSTRAP_OWNER_EMAIL` / `BOOTSTRAP_OWNER_PASSWORD` to
bootstrap with different credentials.

## 3. Web client (Vercel)

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

- [ ] Database created, pooled connection string copied
- [ ] API deployed; `NODE_ENV=production`, `DATABASE_URL`, both JWT secrets set
- [ ] `GET https://your-api/api/v1/health/ready` shows `database: ok` (and `mail: ok` if configured)
- [ ] `npm run db:seed -w @ciq/api` run once
- [ ] Web deployed with `VITE_API_URL`
- [ ] `CORS_ORIGINS` on the API updated to the Vercel URL, API redeployed
- [ ] Signed in as the owner and changed the bootstrap password

## Verifying locally before you deploy

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```

All four must pass; the Vercel build runs the same TypeScript compile.
