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

**One file configures everything.** [`.env.example`](.env.example) at the
repository root is the annotated list, for the API and the web client together.
There is no `apps/api/.env.example` and no `apps/web/.env.example` — the API
reads the root file (`envFilePath` in `app.module.ts`) and so does Vite
(`envDir` in `vite.config.ts`), so there is one place a value can be wrong
instead of three that have to agree.

Only `VITE_`-prefixed variables reach the browser bundle, so sharing the file
does not put a secret into downloadable JavaScript.

On a host that takes variables through a dashboard rather than a file — Render,
Railway, Vercel — paste from that same file. The required set:

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
fire. See [Health endpoints](#health-endpoints) below for the full response.

### First run — creating the administrator account

Migrations create the tables but no rows, so the first sign-in needs the
bootstrap to have run **once**. It creates one organisation and one owner
account, and nothing else — no phases, no categories, no templates, no sample
projects. Those are created from the Settings screens by whoever signs in.

Because the workspace starts genuinely empty, the first thing to do after
signing in is **Settings → Phases**: a project with no phases has nowhere to add
its first activity.

It is a deploy-time command, deliberately **not** part of the container's start
command. Migrations must run on every deploy; this must not.

There are no default credentials. The four values below have to be set, and the
seed stops with a message naming the missing one rather than falling back to
something that is published in this repository:

| Variable                   |                                                      |
| -------------------------- | ---------------------------------------------------- |
| `BOOTSTRAP_OWNER_EMAIL`    | the sign-in address                                  |
| `BOOTSTRAP_OWNER_PASSWORD` | the first password                                   |
| `BOOTSTRAP_ORG_NAME`       | the organisation                                     |
| `BOOTSTRAP_OWNER_NAME`     | display name — optional, defaults to `Administrator` |

The simplest route on any host is to run it from your own machine against the
production database. The bootstrap only inserts rows, so it needs nothing but a
connection string:

```bash
DATABASE_URL='<your Neon pooled URL>' BOOTSTRAP_OWNER_EMAIL='you@example.com' BOOTSTRAP_OWNER_PASSWORD='<a long one>' BOOTSTRAP_ORG_NAME='Your Company' npm run db:seed -w @ciq/api
```

On Windows PowerShell:

```
$env:DATABASE_URL='<your Neon pooled URL>'; $env:BOOTSTRAP_OWNER_EMAIL='you@example.com'; $env:BOOTSTRAP_OWNER_PASSWORD='<a long one>'; $env:BOOTSTRAP_ORG_NAME='Your Company'; npm run db:seed -w @ciq/api
```

Render's free plan has no shell, which is why this is the documented path. On a
paid Render instance the variables are already in the environment, so it is just
`npm run db:seed:dist -w @ciq/api` from **the service → Shell**. Railway has a
shell under **Deployments → ⋮ → Shell**. Under compose:

```bash
docker compose --profile app run --rm api npm run db:seed:dist -w @ciq/api
```

Note the `:dist` suffix **inside a container**. The runtime image installs with
`--omit=dev`, so `ts-node` is not present and plain `npm run db:seed` fails with
`ts-node: not found`; the image ships a compiled copy of the same script, which
`db:seed:dist` runs. From a development checkout, `npm run db:seed` is correct.

**Afterwards, delete `BOOTSTRAP_OWNER_PASSWORD` from the deployment
environment.** Nothing reads it again, and a live password sitting in a
dashboard is one more place for it to leak. Re-running the seed on a later
deploy is harmless — it never overwrites an existing account's password, so it
reports what it found and changes nothing — but it is not needed.

Note that the app requires 12 characters when _changing_ a password. A shorter
bootstrap password signs in fine but cannot be replaced with one the same
length; the seed warns about this when it applies.

## Logging

Every level, not only errors — and structured, so a hosted log service can
filter and alert on the fields rather than grepping sentences.

| Level     | What lands there                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| `error`   | 5xx responses with the stack, failed mail, failed audit writes                                              |
| `warn`    | 4xx responses, slow queries, locked and deactivated accounts, refused refreshes                             |
| `log`     | every request with status and duration, every domain event, sign-ins, exports, mail sent, boot and shutdown |
| `debug`   | _why_ a 4xx happened, wrong-password attempts, SQL timings, cache and storage decisions                     |
| `verbose` | the request arriving with IP and user-agent, bulk ids, signed-URL issuance                                  |

`LOG_LEVEL` picks the floor and everything more severe comes with it, so
`debug` gives error + warn + log + debug. Unset, it is `log` in production and
`debug` everywhere else. `LOG_FORMAT` is `json` in production and `pretty`
outside it.

### Every line carries the request it belongs to

```json
{"timestamp":"2026-09-04T09:59:42.585Z","level":"verbose","context":"HTTP","message":"→ POST /api/v1/auth/login","ip":"::ffff:127.0.0.1","userAgent":"curl/8.15.0","requestId":"d215…"}
{"timestamp":"2026-09-04T09:59:43.330Z","level":"warn","context":"HTTP","message":"POST /api/v1/auth/login → 401 745.0ms","status":401,"durationMs":745,"requestId":"d215…"}
{"timestamp":"2026-09-04T09:59:43.331Z","level":"debug","context":"HTTP","message":"POST /api/v1/auth/login rejected with 401: Those credentials do not match our records.","requestId":"d215…"}
```

The `requestId` comes from an `AsyncLocalStorage` context opened by the
request-id middleware, so a line logged four `await`s deep still carries it —
without a `requestId` parameter on every method that might one day log. Once
the auth guard has run, `userId` and `organisationId` are added too.

That correlation is what makes logging below `error` worth having: twenty
concurrent requests interleave into one stream, and an unattributed `debug`
line tells you almost nothing. It is also what a user's bug report becomes
actionable through — the API returns `requestId` in every error body and the
browser console prints it, so "a save failed this morning" turns into one grep.

### Slow queries are always on

`SLOW_QUERY_MS` (default 300) logs a warning for any statement over it,
regardless of level. It costs nothing on a healthy system, because a healthy
system does not emit it. `PRISMA_LOG_QUERIES=true` logs _every_ statement at
`debug` — useful for an N+1 hunt, and never to be enabled in production, where
the parameters being logged are personal data.

### The browser logs too

Same level names. `warn` in a production build, `debug` in development, and
raisable per-person without a redeploy:

```js
window.ciq.setLogLevel('debug');
```

That is a sentence you can read down a phone line, which is the point: it turns
"can you reproduce it with the console open" into something a non-technical user
can act on, on the machine where the problem actually happens. It logs the API
base URL at load — pointing a build at the wrong API is the most common
deployment mistake here — plus token refreshes, session expiry, any request over
two seconds, and every failure with its `requestId`.

---

## Redeploys never delete data

Deploying again runs migrations and starts the server. That is all it does.

|                         | Runs when                                        | Can it delete?                                                                                                                                                          |
| ----------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma migrate deploy` | every deploy, from the container's start command | **No.** It applies pending migrations only. On drift it fails and refuses to start rather than rebuilding the schema.                                                   |
| The bootstrap seed      | never automatically — you run it once, by hand   | **No.** It only inserts. It does not delete a row, and it does not overwrite an existing account's password, so a second run reports what it found and changes nothing. |
| `prisma migrate reset`  | never in any deploy path                         | **Yes — it drops every table.** Guarded; see below.                                                                                                                     |

So the safe sequence for a later deployment is the ordinary one: push, let it
build, done. Nothing needs re-seeding — the administrator, and everything the
organisation has since created, is already there.

**The one command that can destroy data is `npm run db:reset -w @ciq/api`**, and
it is guarded. `apps/api/scripts/guard-destructive.js` refuses unless
`DATABASE_URL` names a host on this machine, and refuses outright under
`NODE_ENV=production`. The failure it exists for is mundane: a production
connection string exported into a shell an hour earlier for a migration, then
`db:reset` typed out of habit — nothing on that command line says which database
is about to be emptied.

Under compose, the equivalent is `docker compose down -v`. The `-v` deletes the
named volumes, and with them the local Postgres data. `docker compose down`
without it stops the containers and keeps everything.

A migration that itself drops a column is still a migration you have written and
reviewed; nothing here can catch that for you. The three added most recently
were checked for exactly this — the one that moved comments onto design files
was hand-written as a `RENAME` because Prisma's generated diff wanted a
`DROP TABLE`, which would have destroyed the comments already in it.

---

## Health endpoints

Five endpoints, because a platform asks different questions and answering them
all the same way is how a healthy container ends up in a restart loop.

|               | Path                         | Touches                             | A failure means                                                 |
| ------------- | ---------------------------- | ----------------------------------- | --------------------------------------------------------------- |
| **Liveness**  | `GET /api/v1/health`         | nothing                             | the process is wedged — **restart it**                          |
| ”             | `GET /api/v1/health/live`    | nothing                             | alias, for charts that expect this name                         |
| **Startup**   | `GET /api/v1/health/startup` | the schema                          | it has not finished booting — **wait**                          |
| **Readiness** | `GET /api/v1/health/ready`   | database, migrations, storage, mail | it cannot serve — **take it out of rotation, leave it running** |
| **Info**      | `GET /api/v1/health/info`    | nothing                             | — build, runtime and memory                                     |

All five are public and exempt from rate limiting: a probe cannot authenticate,
and a 429 on a health check reads as a dead instance.

**Point the platform's health check at `/health`.** `render.yaml` and
`railway.json` already do, and so does the `HEALTHCHECK` in
`apps/api/Dockerfile`. Pointing it at `/health/ready` instead turns a slow first
database connection — a Neon instance waking from cold — into a failed deploy or
a restart loop against a process that is working perfectly well.

Liveness answers immediately and never touches a dependency:

```json
{
  "status": "ok",
  "uptimeSeconds": 27,
  "version": "1.0.0",
  "commit": "a1b2c3d",
  "timestamp": "2026-09-04T09:12:23.328Z"
}
```

`commit` is read from whichever of `GIT_COMMIT`, `RENDER_GIT_COMMIT`,
`RAILWAY_GIT_COMMIT_SHA` or `VERCEL_GIT_COMMIT_SHA` the host sets, so it answers
"did my deploy actually go out?" without configuration.

`/health/startup` reads a table rather than issuing `SELECT 1`. An image
deployed against an un-migrated database connects perfectly and then fails every
real request; this is what separates "the database is reachable" from "the
database is the one this build expects". It latches once it has succeeded, so a
later outage cannot make a running container look like it never booted — on a
platform that treats a failed startup probe as fatal, that would kill it.

Readiness checks four dependencies in parallel, times each one, and holds each
to a four-second deadline — an unbounded check is worse than none, because the
platform's own probe timeout fires first and the container gets restarted for
something a restart cannot fix:

```json
{
  "status": "ok",
  "checks": {
    "database": { "status": "ok", "latencyMs": 15 },
    "migrations": { "status": "ok", "latencyMs": 26 },
    "storage": { "status": "ok", "latencyMs": 7 },
    "mail": { "status": "ok", "latencyMs": 4 }
  },
  "uptimeSeconds": 27,
  "timestamp": "2026-09-04T10:31:31.474Z"
}
```

**What fails readiness, and what only degrades it:**

| Condition                                            | Result                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Database unreachable                                 | `503`                                                                                      |
| A migration started and never finished               | `503` — the schema is in a state no version of the code expects                            |
| Migrations in the image the database has not applied | `200 degraded`, with the names — usually a container run without its `migrate deploy` step |
| Object storage unreachable                           | `200 degraded` — attachments fail, everything else works                                   |
| Mail rejected                                        | `200 degraded` — digests are dropped, nobody is blocked                                    |

The split matters: a broken relay is not a reason to pull the only instance out
of rotation and take the whole application down with it. The pending-migration
case is advisory rather than a `503` on purpose — it is detected by comparing a
directory listing against a table, and a bug in _that_ comparison must not be
able to remove a working service.

- **The status code carries the verdict**: `200` ready, `503` not. A readiness
  endpoint that reports trouble in its body and still answers `200` is never
  acted on by anything.
- **The advisory checks are cached for a minute.** Verifying Brevo and the S3
  bucket are outbound calls to third parties; probed every 30 seconds they would
  be roughly 3,000 calls a day each against somebody else's rate limit, to
  answer a question whose answer almost never changes.
- **Failure detail is withheld in production.** These endpoints are public — a
  probe cannot authenticate — and a Prisma connection error quotes the database
  host back at you. Outside production the real message is shown.

The web container has its own liveness endpoint at `GET /healthz`, served by
nginx itself rather than from a file on disk, so it still answers if the bundle
failed to copy. That distinguishes "nginx is up with nothing to serve" from
"nginx is down" — two different problems that look identical to a probe that
just fetches `/`.

---

## Running it in containers

Both images build from the **repository root**, never from `apps/api` or
`apps/web`: each needs the root manifests and the `@ciq/shared` workspace, and a
narrower context cannot see them. `.dockerignore` lives at the root for the same
reason — Docker reads it from the context directory, so one sitting next to a
Dockerfile is silently never read.

```bash
docker build -f apps/api/Dockerfile -t ciq-api .

docker build -f apps/web/Dockerfile -t ciq-web   --build-arg VITE_API_URL=https://your-api.example.com/api/v1 .
```

### Nothing is configured inside the images

Every URL, port, credential and secret comes from the environment. Moving the
API to a new host or giving the web app a real domain is a change to `.env` —
no edit to a Dockerfile, no edit to `docker-compose.yml`.

The one exception is unavoidable and worth knowing about: **`VITE_API_URL` is a
build argument, not a runtime variable.** Vite substitutes `import.meta.env` at
build time, so the API's address is compiled into the JavaScript. Setting it in
the web container's environment has no effect — changing it means rebuilding the
web image. The build fails with a message rather than defaulting, because the
failure mode of a wrong default is silent: the image builds, the page loads, and
every request goes somewhere else until a person notices.

The API takes `PORT` and `API_PREFIX` from the environment, and so does its
`HEALTHCHECK`. Managed hosts inject their own port — Render uses 10000 — and a
check pinned to 4000 reports every one of those containers as unhealthy.

### Compose

```bash
cp .env.example .env                        # then set the values

docker compose up -d                        # infrastructure only: Postgres,
                                            # object storage, a mail catcher.
                                            # Run the app with `npm run dev`.

docker compose --profile app up -d --build  # the whole application in
                                            # containers
```

The `app` profile keeps the everyday loop cheap: `docker compose up -d` brings
up what the dev server needs and builds no images.

Then create the administrator once:

```bash
docker compose --profile app run --rm api npm run db:seed:dist -w @ciq/api
```

`.env` carries a host and a container form of the three addresses that differ
depending on where the process runs — `DATABASE_URL` / `DOCKER_DATABASE_URL`,
`S3_ENDPOINT` / `DOCKER_S3_ENDPOINT`, `SMTP_HOST` / `DOCKER_SMTP_HOST`. Inside
the compose network a service is reached by name on its own port; from the host
it is reached on the published one. For a managed database, set both forms to
the same connection string.

---

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
VITE_API_URL=https://your-api.onrender.com/api/v1
```

Include the `/api/v1` prefix; no trailing slash. It comes from the same
[`.env.example`](.env.example) as everything else — Vite reads the repository
root, not `apps/web`.

**Set only this one in the Vercel project.** A static bundle on a CDN compiles
every value it is given into JavaScript that visitors download, so
`DATABASE_URL`, JWT secrets, SMTP credentials and S3 keys must never be added
here. Vite exposing only `VITE_`-prefixed variables makes that mistake harder,
not impossible — a shared file is safe, a mis-prefixed secret is not.

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
