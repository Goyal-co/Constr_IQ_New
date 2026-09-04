/* eslint-disable no-console */
/**
 * Refuses to let a destructive Prisma command run against anything but a local
 * database.
 *
 * `prisma migrate reset --force` drops every table and recreates them, with no
 * prompt — that is what `--force` removes. It is the only command in this
 * repository that can delete data, and the way it goes wrong is mundane: a
 * production `DATABASE_URL` exported into the shell an hour earlier for a
 * migration or a seed, then `npm run db:reset` typed out of habit. Nothing in
 * the command line says which database it is about to empty.
 *
 * So the check is on the connection string, not on intent. A host that is not
 * on this machine is refused, and `NODE_ENV=production` is refused outright.
 *
 * Everything else in the deploy path is additive by construction and stays that
 * way: `prisma migrate deploy` applies pending migrations and never resets
 * (it fails on drift rather than rebuilding), and the bootstrap seed only ever
 * inserts — it never deletes a row and never overwrites an existing account's
 * password.
 */

const url = process.env.DATABASE_URL;

if (!url) {
  console.error('\nDATABASE_URL is not set. Refusing to run a destructive command blind.\n');
  process.exit(1);
}

if (process.env.NODE_ENV === 'production') {
  console.error('\nNODE_ENV=production. Refusing to reset the database.\n');
  process.exit(1);
}

let host;
try {
  ({ hostname: host } = new URL(url));
} catch {
  console.error('\nDATABASE_URL is not a valid connection string. Refusing to continue.\n');
  process.exit(1);
}

// Only a database on this machine. A container's published port still counts —
// that is the local development stack — but anything reached over a network
// does not.
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '0.0.0.0', 'postgres', 'host.docker.internal'];

if (!LOCAL_HOSTS.includes(host)) {
  console.error(`\nRefusing to reset: DATABASE_URL points at "${host}", which is not local.\n`);
  console.error('`prisma migrate reset` DROPS EVERY TABLE. If you genuinely mean to wipe a');
  console.error('remote database, do it from that provider’s own console, where the name of');
  console.error('what you are deleting is in front of you.\n');
  console.error('If you meant to apply pending migrations instead, that is:\n');
  console.error('  npm run db:deploy -w @ciq/api\n');
  process.exit(1);
}

console.log(`Resetting the local database on "${host}".`);
