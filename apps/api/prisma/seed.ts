/* eslint-disable no-console */
/**
 * Bootstrap — creates the administrator account, and nothing else.
 *
 *   npm run db:seed -w @ciq/api
 *
 * There is no sample data here: no phases, no categories, no templates, no demo
 * projects. An empty workspace is the correct starting state, because every one
 * of those is organisation-defined data that the owner creates from the
 * Settings screens. Seeding them would mean a new deployment starts with rows
 * somebody has to notice and delete.
 *
 * The one row that cannot be created from the UI is the first account — there
 * is nobody to sign in and create it — so that is what this does.
 *
 * ## Every value comes from the environment
 *
 * No credential is written in this file. A default administrator password in
 * source control is a published password: it reaches every clone, every image
 * layer and every log of this file, and a deployment that forgets to override
 * it is reachable by anybody who has read the repository. So the four variables
 * below are required, and the script refuses to run without them rather than
 * falling back to something guessable.
 *
 *   BOOTSTRAP_OWNER_EMAIL      the sign-in address
 *   BOOTSTRAP_OWNER_PASSWORD   the first password, changed after first sign-in
 *   BOOTSTRAP_OWNER_NAME       display name                  (optional)
 *   BOOTSTRAP_ORG_NAME         the organisation's name
 *   BOOTSTRAP_ORG_SLUG         its stable identifier         (optional)
 *
 * ## Run it once, not on every boot
 *
 * This is a deploy-time command, deliberately not part of the container's start
 * command — see apps/api/Dockerfile, which runs `prisma migrate deploy` and
 * then starts the server. Migrations must run on every deploy; this must not.
 *
 * It is nonetheless safe if it does run again. It never deletes anything and
 * never touches an existing account's password: a second run against a live
 * database prints what it found and changes nothing. That matters because the
 * alternative — a bootstrap that resets the owner's password back to whatever
 * is in the deployment environment — would silently undo a rotation.
 */

import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient, type Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { DEFAULT_SETTINGS } from '@ciq/shared';

/**
 * Load the repository-root `.env` before anything reads `process.env`.
 *
 * This is a standalone script, not part of the Nest application, so it never
 * passes through `ConfigModule` and nothing else loads the file for it. Without
 * this it read only what was exported into the shell — so filling in `.env` and
 * running `npm run db:seed` failed with "Missing BOOTSTRAP_OWNER_EMAIL" while
 * the value sat in the file two directories up.
 *
 * Two candidates, because the working directory differs: `apps/api` under
 * `npm run db:seed`, the repo root when run from there or inside a container.
 * A real environment variable always wins — `dotenv` does not overwrite one
 * that is already set, which is what makes `BOOTSTRAP_OWNER_PASSWORD=… npm run
 * db:seed` still work for a one-off.
 */
for (const candidate of [join(process.cwd(), '..', '..', '.env'), join(process.cwd(), '.env')]) {
  if (existsSync(candidate)) loadEnv({ path: candidate });
}

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 12;

/** The app's own floor for a password set through the change-password screen. */
const PASSWORD_MIN_LENGTH = 12;

/**
 * Reads a required variable, or explains what to set and stops.
 *
 * Failing here is the point. The alternative is a default, and a default
 * administrator credential is worse than a failed deploy.
 */
function required(name: string, describe: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`\nMissing ${name} — ${describe}.\n`);
    console.error('Set it in the environment this command runs in. For example:\n');
    console.error('  Render      Dashboard → the service → Environment');
    console.error('  Docker      the .env file compose reads, or `docker compose run --rm`');
    console.error('  Locally     the .env file at the repository root\n');
    process.exit(1);
  }
  return value;
}

/** Falls back to a derived or cosmetic value — never to a credential. */
function optional(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

/** `Goyal & Co. | Hariyana Group` → `goyal-co-hariyana-group`. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function main(): Promise<void> {
  const ownerEmail = required(
    'BOOTSTRAP_OWNER_EMAIL',
    'the address the administrator signs in with',
  ).toLowerCase();
  const ownerPassword = required('BOOTSTRAP_OWNER_PASSWORD', 'the administrator’s first password');
  const orgName = required('BOOTSTRAP_ORG_NAME', 'the organisation this workspace belongs to');

  const ownerName = optional('BOOTSTRAP_OWNER_NAME', 'Administrator');
  const orgSlug = optional('BOOTSTRAP_ORG_SLUG', slugify(orgName));

  console.log('Bootstrapping…\n');

  /**
   * The organisation.
   *
   * Not sample data: every row in this application is scoped to one, and a user
   * cannot exist without it. It is created here because it is structural, and
   * matched on slug rather than name so renaming the organisation in Settings
   * does not cause a re-run to create a second one.
   */
  let organisation = await prisma.organisation.findUnique({ where: { slug: orgSlug } });

  if (organisation) {
    console.log(`  Organisation: ${organisation.name} (already present)`);
  } else {
    organisation = await prisma.organisation.create({
      data: {
        name: orgName,
        slug: orgSlug,
        settings: DEFAULT_SETTINGS as unknown as Prisma.InputJsonValue,
        reportSetting: { create: { title: 'Portfolio Status Report', commentary: '' } },
      },
    });
    console.log(`  Organisation: ${organisation.name} (created)`);
  }

  // Email is unique per organisation rather than globally, so the same address
  // can legitimately exist in another tenant.
  const existingOwner = await prisma.user.findFirst({
    where: { organisationId: organisation.id, email: ownerEmail },
  });

  if (existingOwner) {
    console.log(`  Administrator: ${ownerEmail} (already exists — password left unchanged)`);
    console.log('\nNothing to do. This database is already bootstrapped.');
    return;
  }

  await prisma.user.create({
    data: {
      organisationId: organisation.id,
      name: ownerName,
      email: ownerEmail,
      role: 'OWNER',
      passwordHash: await bcrypt.hash(ownerPassword, BCRYPT_ROUNDS),
    },
  });
  console.log(`  Administrator: ${ownerEmail} (created)`);

  console.log(`\nSign in as ${ownerEmail} with the password from BOOTSTRAP_OWNER_PASSWORD.`);
  console.log('Change it after the first sign-in, then remove that variable from the');
  console.log('deployment environment — nothing reads it again.');

  if (ownerPassword.length < PASSWORD_MIN_LENGTH) {
    // A warning rather than a refusal: this password is accepted at sign-in, it
    // is only the change-password screen that enforces the floor. Being told
    // that now beats discovering it while locked out of choosing a new one.
    console.log(
      `\nNote: BOOTSTRAP_OWNER_PASSWORD is ${ownerPassword.length} characters. The app requires` +
        `\n${PASSWORD_MIN_LENGTH} when setting a new one, so the replacement must be longer.`,
    );
  }

  console.log('\nThe workspace is empty by design. Start in Settings → Phases, then create');
  console.log('a category with your first project and a template so later projects arrive');
  console.log('pre-filled.');
}

main()
  .catch((error) => {
    console.error('\nBootstrap failed:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
