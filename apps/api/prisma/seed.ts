/* eslint-disable no-console */
/**
 * Bootstrap.
 *
 * Creates the minimum an empty database needs to be usable: one organisation,
 * one owner account, and the two work phases the app's Design/Execution
 * sub-sections are built around. Nothing else — no sample projects, no demo
 * users, no pre-filled template. The organisation defines its own categories,
 * templates and projects from the Settings screens.
 *
 *   npm run db:seed -w @ciq/api
 *
 * Idempotent, and safe to run against a live database. It never deletes
 * anything and never overwrites an existing account's password: re-running it
 * against a populated database is a no-op that reports what it found. That is
 * the opposite of the old development seed, which dropped and recreated a demo
 * organisation on every run — a bootstrap that resets production is a footgun,
 * not a convenience.
 */

import { PrismaClient, type Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { DEFAULT_SETTINGS } from '@ciq/shared';

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 12;

/**
 * The owner account.
 *
 * Overridable by environment so a deployment can bootstrap with its own
 * credentials without editing source — the defaults are what was asked for and
 * what a fresh local database gets.
 */
const OWNER_EMAIL = (process.env.BOOTSTRAP_OWNER_EMAIL ?? 'superadmin@goyalco.com')
  .trim()
  .toLowerCase();
const OWNER_PASSWORD = process.env.BOOTSTRAP_OWNER_PASSWORD ?? 'Goyalco@12@';
const OWNER_NAME = process.env.BOOTSTRAP_OWNER_NAME ?? 'Super Admin';

const ORG_NAME = process.env.BOOTSTRAP_ORG_NAME ?? 'Goyal & Co. | Hariyana Group';
const ORG_SLUG = process.env.BOOTSTRAP_ORG_SLUG ?? 'goyal-co-hariyana-group';

/**
 * The two work phases.
 *
 * Kept because they are structural rather than sample data: Design and
 * Execution each render one sub-section per phase, so a database with none
 * gives a new project nowhere to add its first work item. Both are ordinary
 * rows — rename, recolour, add or archive them in Settings → Phases.
 */
const PHASES = [
  { name: 'Civil', colour: '#d98a20' },
  { name: 'Finishing', colour: '#22a06b' },
];

async function main(): Promise<void> {
  console.log('Bootstrapping…\n');

  // --- Organisation ---------------------------------------------------------
  // Matched on slug, which is the stable identifier; the display name can be
  // changed later in Settings without breaking a re-run.
  let organisation = await prisma.organisation.findUnique({ where: { slug: ORG_SLUG } });

  if (organisation) {
    console.log(`  Organisation: ${organisation.name} (already present)`);
  } else {
    organisation = await prisma.organisation.create({
      data: {
        name: ORG_NAME,
        slug: ORG_SLUG,
        settings: DEFAULT_SETTINGS as unknown as Prisma.InputJsonValue,
        reportSetting: { create: { title: 'Portfolio Status Report', commentary: '' } },
      },
    });
    console.log(`  Organisation: ${organisation.name} (created)`);
  }

  // --- Owner ----------------------------------------------------------------
  // Scoped to the organisation: email is unique per tenant, not globally, so the
  // same address can legitimately exist in another organisation.
  const existingOwner = await prisma.user.findFirst({
    where: { organisationId: organisation.id, email: OWNER_EMAIL },
  });

  if (existingOwner) {
    // Deliberately not re-hashing the password. If this ran on a schedule, or a
    // deploy hook, silently resetting the owner's password back to the default
    // would undo every rotation they had made.
    console.log(`  Owner:        ${OWNER_EMAIL} (already exists — password left unchanged)`);
  } else {
    await prisma.user.create({
      data: {
        organisationId: organisation.id,
        name: OWNER_NAME,
        email: OWNER_EMAIL,
        role: 'OWNER',
        passwordHash: await bcrypt.hash(OWNER_PASSWORD, BCRYPT_ROUNDS),
      },
    });
    console.log(`  Owner:        ${OWNER_EMAIL} (created)`);
  }

  // --- Phases ---------------------------------------------------------------
  for (const [position, spec] of PHASES.entries()) {
    const existing = await prisma.phase.findFirst({
      where: { organisationId: organisation.id, name: spec.name },
    });
    if (existing) {
      console.log(`  Phase:        ${spec.name} (already present)`);
      continue;
    }
    await prisma.phase.create({
      data: { organisationId: organisation.id, ...spec, position },
    });
    console.log(`  Phase:        ${spec.name} (created)`);
  }

  // --- What the workspace actually contains ---------------------------------
  const [users, categories, templates, projects] = await Promise.all([
    prisma.user.count({ where: { organisationId: organisation.id } }),
    prisma.category.count({ where: { organisationId: organisation.id } }),
    prisma.template.count({ where: { organisationId: organisation.id } }),
    prisma.project.count({ where: { organisationId: organisation.id } }),
  ]);

  console.log(
    `\n  Users ${users} · Categories ${categories} · Templates ${templates} · Projects ${projects}`,
  );

  if (!existingOwner) {
    console.log(`\nSign in as:\n\n  ${OWNER_EMAIL}\n  ${OWNER_PASSWORD}\n`);
    console.log('Change this password after the first sign-in. Note that the app requires 12');
    console.log('characters when setting a new one, so the replacement must be at least that.');
  }

  if (categories === 0) {
    console.log('\nNext: create a category while adding your first project, then build a');
    console.log('template in Settings → Templates so later projects arrive pre-filled.');
  }
}

main()
  .catch((error) => {
    console.error('\nBootstrap failed:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
