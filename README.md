# ConstructIQ Tracker

Enterprise tracking for interior fit-out delivery: drawing checklists, procurement
lead times, on-site execution and management reporting — in one system, with a
full audit trail.

Rebuilt from a single-file prototype into a production monorepo. The prototype
kept everything in `localStorage` and hard-coded its phases, checklists and
timeline; this does neither.

---

## The core idea: nothing is hard-coded

Every list, label, threshold and weight the engine uses is a row an administrator
controls. There is no build-time knowledge of what a phase is called, how many
there are, what a project checklist contains, or what "at risk" means.

| Concept                                  | Where it lives                           | Who controls it              |
| ---------------------------------------- | ---------------------------------------- | ---------------------------- |
| Project categories                       | `categories` table                       | Admin, Settings → Categories |
| Delivery phases (name, colour, order)    | `phases` table                           | Admin, Settings → Phases     |
| Drawing / activity / material checklists | `templates` + `template_items`           | Admin, Settings → Templates  |
| Programme timeline                       | Each activity's own planned/actual dates | Whoever runs the project     |
| Order-soon warning window                | `organisations.settings` JSON            | Admin, Settings → Thresholds |
| Risk rules and thresholds                | `organisations.settings` JSON            | Admin, Settings → Thresholds |
| Execution progress weights               | `organisations.settings` JSON            | Admin, Settings → Thresholds |
| Locale, currency, digest schedule        | `organisations.settings` JSON            | Admin, Settings → Thresholds |

A fresh deployment starts **empty** — no sample phases, no default categories.
The only closed sets left in code are the four workflow enums that carry
behaviour (`ProjectStatus`, `ActivityStatus`, `MaterialStatus`,
`TemplateItemKind`), and they are documented as such in
[`packages/shared/src/constants.ts`](packages/shared/src/constants.ts).

You can prove this from the command line:

```bash
curl -X PATCH $API/organisation/settings -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"orderSoonWindowDays":120}'
```

Re-fetch the report and `ordersDueSoon` moves immediately, because the number
was never a constant.

---

## Architecture

```
construct-iq-tracker/
├── packages/shared/        Domain logic, types and validation — used by BOTH sides
│   ├── constants.ts        Workflow enums only (the ones with behaviour attached)
│   ├── settings.ts         Every tunable number, with documented defaults
│   ├── metrics.ts          Order-by dates, slippage, risk, programme, summary prose
│   ├── dates.ts            UTC date-only maths
│   ├── rbac.ts             Role → permission matrix
│   └── dto.ts              zod request schemas
├── apps/api/               NestJS + Prisma + PostgreSQL
└── apps/web/               React 18 + Vite + TypeScript
```

**Why a shared domain package.** `computeMaterialSchedule` runs on the server to
build the report and in the browser to render a badge. One implementation means
the two cannot disagree — the failure mode where a dashboard says four overdue
and an export says five simply cannot occur.

### Stack

| Layer         | Choice                           | Why                                                          |
| ------------- | -------------------------------- | ------------------------------------------------------------ |
| API           | NestJS 10                        | DI and guards make the RBAC and audit cross-cuts declarative |
| ORM           | Prisma 6                         | Typed queries, first-class migrations                        |
| Database      | PostgreSQL 16                    | The reporting is relational; `@db.Date` for calendar facts   |
| Auth          | JWT access + rotating refresh    | Refresh tokens stored as SHA-256, single-use, reuse-detected |
| Validation    | zod, shared with the client      | One schema, both sides                                       |
| Queue / cache | Redis                            | Job scheduling and rate-limit store                          |
| Files         | S3-compatible (MinIO / S3 / R2)  | Signed URLs; files never stream through the API              |
| Web           | React 18 + Vite + TanStack Query | Fast builds, cache invalidation that keeps figures honest    |
| Exports       | ExcelJS + pdfmake                | Server-rendered, from the same payload the screen renders    |

---

## Getting started

**Requirements:** Node 20.11+, Docker, npm 10+.

```bash
git clone <repo> && cd construct-iq-tracker
cp .env.example .env
```

Generate real JWT secrets — the API refuses to boot in production with the
placeholders:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Then:

```bash
npm run bootstrap
```

That installs dependencies, builds the shared package, starts PostgreSQL, Redis,
MinIO and Mailpit, applies migrations and loads demo data.

```bash
npm run dev
```

| Service              | URL                               |
| -------------------- | --------------------------------- |
| Web                  | http://localhost:5173             |
| API                  | http://localhost:4000/api/v1      |
| API docs (Swagger)   | http://localhost:4000/api/v1/docs |
| Mailpit (sent email) | http://localhost:8025             |
| MinIO console        | http://localhost:9001             |

### Demo accounts

The seeder creates one organisation and six users, one per role, all sharing the
password `ConstructIQ-Demo-2026`:

| Role            | Email                   |
| --------------- | ----------------------- |
| Owner           | `owner@demo.local`      |
| Administrator   | `admin@demo.local`      |
| Project Manager | `pm@demo.local`         |
| Site Engineer   | `engineer@demo.local`   |
| Consultant      | `consultant@demo.local` |
| Viewer          | `viewer@demo.local`     |

Everything the seed creates is ordinary data written through the same tables the
Settings screens use. Delete it and define your own — see
[`apps/api/prisma/seed.ts`](apps/api/prisma/seed.ts).

> **Ports.** The compose file maps PostgreSQL to **5433** and Redis to **6380** so
> it does not collide with a local install on the default ports.

---

## How the maths works

### Procurement

An order-by date is `handover − leadTimeWeeks`. Miss it and the item lands after
the site needs it, so this drives the whole procurement view.

```
handover 30 Jun · 12-week lead → order by 7 Apr
```

An item is `OVERDUE` past that date, `DUE_SOON` within the configured window
(default 21 days), otherwise `SCHEDULED`. Ordered, delivered and cancelled items
short-circuit — an item already on site is never reported as overdue to order.

### Execution slippage

Judged per activity against its own dates, never against a global programme:

- finished work → actual end vs planned end
- unfinished work past its planned end → accruing delay right now
- anything else → no verdict, rather than a misleading zero

### Risk

A project is flagged when any enabled rule fires, and the reason is stated in
words on every screen that shows the flag:

- an overdue material order (toggleable)
- drawings below the threshold with handover inside the window
- the handover date already passed
- activities behind plan (toggleable)

### Programme chart

Fitted to the dates that actually exist on the project — earliest start through
latest end, widened to include handover, with an axis interval chosen to give
roughly eight labels whatever the span. A two-week snagging job and an
eighteen-month tower both render sensibly. Planned draws as a faint bar, actual
solid on top, so an overrun is visible rather than only tabulated.

All of the above is covered by unit tests in
[`packages/shared/src/metrics.test.ts`](packages/shared/src/metrics.test.ts),
including tests that prove changing a setting changes the outcome.

---

## Security

- **Deny by default.** A global JWT guard protects every route unless explicitly
  marked `@Public()`.
- **RBAC enforced server-side.** The web app reads the same matrix to decide what
  to render, but hiding a button is not access control.
- **Tenant isolation.** `organisationId` comes from the verified token and is an
  explicit `where` clause on every query — deliberately not hidden in middleware,
  so it is reviewable in the query you are reading.
- **Refresh token rotation.** Single-use, stored only as SHA-256. Presenting a
  used token revokes the whole session family.
- **Account lockout** after repeated failures, with constant-time-ish login
  responses so the form is not an account-enumeration oracle.
- **Uploads** are allow-listed by MIME type and checked against magic numbers;
  SVG is deliberately excluded.
- **Audit trail** records actor, timestamp, IP and a field-level diff for every
  mutation, with credentials redacted.

---

## Deployment

Web on Vercel, API on Railway, database on Neon.

**Web (Vercel)** — root directory `apps/web`, config in
[`apps/web/vercel.json`](apps/web/vercel.json). Set `VITE_API_URL` to the public
API URL.

**API (Railway)** — Dockerfile build, config in
[`railway.json`](railway.json). Migrations run on start. Required variables:

```
NODE_ENV=production
DATABASE_URL=<Neon pooled connection string, ?sslmode=require>
JWT_ACCESS_SECRET=<generated>
JWT_REFRESH_SECRET=<generated, different>
CORS_ORIGINS=https://your-app.vercel.app
WEB_APP_URL=https://your-app.vercel.app
REDIS_URL=<Railway Redis>
S3_* / SMTP_*                       # object storage and mail
ENABLE_SCHEDULER=true               # on ONE replica only
```

> Set `ENABLE_SCHEDULER=false` on every replica but one, or each will send the
> weekly digest.

**Anywhere else** — `docker compose up` brings the whole stack up locally, and
the same Dockerfile runs on ECS, Cloud Run or a plain VM.

---

## Commands

| Command                     | What it does                                      |
| --------------------------- | ------------------------------------------------- |
| `npm run bootstrap`         | Install, build shared, start infra, migrate, seed |
| `npm run dev`               | API and web together                              |
| `npm run build`             | Build all three packages                          |
| `npm run typecheck`         | Typecheck all three                               |
| `npm run test`              | Domain unit tests                                 |
| `npm run db:migrate`        | Create and apply a migration                      |
| `npm run db:seed`           | Reload demo data                                  |
| `npm run db:studio`         | Prisma Studio                                     |
| `npm run db:up` / `db:down` | Start / stop local infrastructure                 |

---

## Background jobs

| Job           | Default     | What it does                                                          |
| ------------- | ----------- | --------------------------------------------------------------------- |
| Risk sweep    | `0 2 * * *` | Alerts for overdue orders, slipping activities, approaching handovers |
| Weekly digest | `0 3 * * 1` | Portfolio email to owners, admins and project managers                |
| Housekeeping  | `0 4 * * *` | Purges expired tokens and long-read notifications                     |

All three are idempotent — notification dedupe keys mean re-running the sweep is
a no-op rather than a flood. Administrators can trigger them manually from
`POST /admin/jobs/risk-sweep` and `POST /admin/jobs/digest`.

---

## What is deliberately not built

Stated plainly so nobody assumes otherwise:

- **SSO.** Local email/password with the provider boundary in place. Google or
  Entra ID slot in behind the same interface without touching the guards.
- **Realtime collaboration.** Notification counts poll every 60 seconds. A
  nightly job does not need a WebSocket.
- **Mobile apps.** The web app is responsive; there is no native client.
- **Non-Latin PDF export.** pdfmake uses the built-in fonts to keep the image
  small. Devanagari or Arabic output needs a font file embedded.

# Constr_IQ_New
