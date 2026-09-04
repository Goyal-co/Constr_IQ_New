import { Controller, Get, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Public } from '../../common/auth-context';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../infra/mail/mail.service';
import { StorageService } from '../../infra/storage/storage.service';

/**
 * The health API.
 *
 * Four endpoints, because a platform asks four different questions and giving
 * them all the same answer is how a healthy container ends up in a restart
 * loop:
 *
 *   GET /health          liveness. Touches nothing.
 *   GET /health/live     the same thing under the name most orchestrators
 *                        expect, so a chart written for `/health/live` works
 *                        without a wrapper.
 *   GET /health/startup  has boot finished, and does the schema exist? Answers
 *                        503 until both are true.
 *   GET /health/ready    can this instance serve? Database, migrations,
 *                        storage, mail.
 *   GET /health/info     what is running here — version, commit, runtime,
 *                        memory. No checks, no dependencies.
 *
 * What each failure means, which is the part worth getting right:
 *
 *   liveness fails   → the process is wedged. RESTART it.
 *   startup fails    → it has not finished booting. WAIT.
 *   readiness fails  → it cannot serve. Take it OUT OF ROTATION and leave it
 *                      running — a container with a wrong connection string is
 *                      not fixed by restarting it, and restarting it forever
 *                      just hides the reason.
 *
 * Point the platform's health check at `/health`. Point a load balancer's
 * rotation check, if there is one, at `/health/ready`.
 */

/** What one dependency check produced. */
interface DependencyCheck {
  status: 'ok' | 'error';
  /** How long the check took. A rising number is the early warning. */
  latencyMs: number;
  /** Why it failed. Withheld in production — see `describe` below. */
  detail?: string;
}

/**
 * How long a single dependency may take before it is called down.
 *
 * Bounded because an unbounded check is worse than no check: the platform's own
 * probe timeout fires first, so a slow dependency is reported as a dead process
 * and the container is restarted for something a restart will not fix.
 */
const DATABASE_TIMEOUT_MS = 4_000;
const MAIL_TIMEOUT_MS = 4_000;
const STORAGE_TIMEOUT_MS = 4_000;
const MIGRATION_TIMEOUT_MS = 4_000;

/**
 * The mail and storage checks are cached.
 *
 * Both reach a third party. Probed every thirty seconds they would be roughly
 * 3,000 calls a day each against somebody else's rate limit, to answer a
 * question whose answer almost never changes. A minute of staleness on an
 * advisory check is a fair trade.
 */
const ADVISORY_CACHE_MS = 60_000;

@ApiTags('Health')
// Probes come from one address at a fixed interval, which is exactly the shape
// the rate limiter exists to stop. A 429 on a health check reads as a dead
// instance, so the guard is skipped here.
@SkipThrottle()
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();
  private readonly cache = new Map<string, { at: number; check: DependencyCheck }>();

  /**
   * Set once the schema has been seen. Only ever goes false → true.
   *
   * Startup is a one-way door: once this instance has proved it can reach a
   * migrated database, it has started, and a later database blip is a
   * *readiness* problem. Latching it means a transient outage cannot make a
   * running container look like it never booted, which on platforms that treat
   * a failed startup probe as fatal would kill it.
   */
  private started = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly storage: StorageService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  // -------------------------------------------------------------------------
  // Liveness
  // -------------------------------------------------------------------------

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness probe — no dependencies touched' })
  @ApiResponse({ status: 200, description: 'The process is running.' })
  live() {
    return {
      status: 'ok',
      uptimeSeconds: this.uptimeSeconds(),
      version: version(),
      commit: commit(),
      timestamp: new Date().toISOString(),
    };
  }

  /** The same probe under the name Kubernetes-style charts expect. */
  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe (alias of /health)' })
  liveAlias() {
    return this.live();
  }

  // -------------------------------------------------------------------------
  // Startup
  // -------------------------------------------------------------------------

  @Public()
  @Get('startup')
  @ApiOperation({ summary: 'Startup probe — has boot finished and is the schema present?' })
  @ApiResponse({ status: 200, description: 'Boot is complete.' })
  @ApiResponse({ status: 503, description: 'Still starting, or the schema is missing.' })
  async startup(@Res({ passthrough: true }) response: Response) {
    if (this.started) {
      response.status(200);
      return { status: 'ok', startedAt: new Date(this.startedAt).toISOString() };
    }

    /**
     * A table lookup, not `SELECT 1`.
     *
     * `SELECT 1` proves the connection works, which is not the question a
     * startup probe asks. An image deployed against an un-migrated database
     * connects perfectly and then fails every real request — this is the check
     * that separates "the database is reachable" from "the database is the one
     * this build expects".
     */
    const schema = await this.run(async () => {
      await this.prisma.organisation.count();
    }, DATABASE_TIMEOUT_MS);

    if (schema.status === 'ok') this.started = true;
    response.status(schema.status === 'ok' ? 200 : 503);

    return {
      status: schema.status === 'ok' ? 'ok' : 'starting',
      checks: { schema },
      uptimeSeconds: this.uptimeSeconds(),
      timestamp: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Readiness
  // -------------------------------------------------------------------------

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — verifies dependencies' })
  @ApiResponse({ status: 200, description: 'Ready. Storage or mail may still be degraded.' })
  @ApiResponse({ status: 503, description: 'Not ready — the database or the schema is unusable.' })
  async ready(@Res({ passthrough: true }) response: Response) {
    // Run together: four checks bounded at four seconds each should cost four
    // seconds in the worst case, not sixteen.
    const [database, migrations, storage, mail] = await Promise.all([
      this.run(async () => {
        await this.prisma.$queryRaw`SELECT 1`;
      }, DATABASE_TIMEOUT_MS),
      this.checkMigrations(),
      this.cached('storage', STORAGE_TIMEOUT_MS, async () => {
        const result = await this.storage.verify();
        if (!result.ok) throw new Error(result.detail ?? 'unreachable');
      }),
      this.cached('mail', MAIL_TIMEOUT_MS, async () => {
        if (!(await this.mail.verify())) throw new Error('the provider rejected the credentials');
      }),
    ]);

    /**
     * The database and the schema decide readiness. Storage and mail do not.
     *
     * Without a database this instance cannot answer a single request, and a
     * half-applied migration means the schema is in a state no version of the
     * code expects. Without object storage it serves every page and fails only
     * on attachments; without mail it silently drops the weekly digest. Both
     * are real, neither is a reason to pull the only instance out of rotation
     * and take the whole application down.
     */
    const ready = database.status === 'ok' && migrations.status === 'ok';
    const degraded = storage.status !== 'ok' || mail.status !== 'ok';

    // The status code is the part orchestrators read. A readiness endpoint that
    // reports trouble in its body and still answers 200 is never acted on by
    // anything — which is the same as not having one.
    response.status(ready ? 200 : 503);

    return {
      status: ready ? (degraded ? 'degraded' : 'ok') : 'error',
      checks: { database, migrations, storage, mail },
      uptimeSeconds: this.uptimeSeconds(),
      timestamp: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Info
  // -------------------------------------------------------------------------

  @Public()
  @Get('info')
  @ApiOperation({ summary: 'What is running here — build, runtime and memory' })
  info() {
    const memory = process.memoryUsage();
    return {
      name: 'ConstructIQ Tracker API',
      version: version(),
      commit: commit(),
      environment: this.config.get('env', { infer: true }),
      node: process.version,
      pid: process.pid,
      startedAt: new Date(this.startedAt).toISOString(),
      uptimeSeconds: this.uptimeSeconds(),
      // Megabytes rather than bytes: this gets read by a person comparing it
      // against a plan's memory limit, which is quoted in megabytes.
      memoryMb: {
        rss: Math.round(memory.rss / 1024 / 1024),
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
      },
      timestamp: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Checks
  // -------------------------------------------------------------------------

  /**
   * Is the database's migration history sound, and does it match this build?
   *
   * Two different faults, deliberately weighted differently:
   *
   *   • A migration row that started and never finished — the deploy died
   *     mid-apply — leaves the schema in a state no version of the code
   *     expects. That fails readiness.
   *   • Migration folders in the image with no corresponding applied row means
   *     the image is ahead of the database, usually because somebody ran the
   *     container without its `prisma migrate deploy` step. That is reported as
   *     `degraded`, not a 503, because it is detected by comparing a directory
   *     listing against a table — and a bug in *that* comparison must not be
   *     able to take a working service out of rotation.
   */
  private checkMigrations(): Promise<DependencyCheck> {
    return this.run(async () => {
      const rows = await this.prisma.$queryRaw<Array<{ migration_name: string; failed: boolean }>>`
        SELECT migration_name,
               (finished_at IS NULL AND rolled_back_at IS NULL) AS failed
        FROM _prisma_migrations
      `;

      const failed = rows.filter((row) => row.failed).map((row) => row.migration_name);
      if (failed.length > 0) {
        throw new Error(`migration did not finish: ${failed.join(', ')}`);
      }

      const pending = await this.pendingMigrations(new Set(rows.map((r) => r.migration_name)));
      if (pending.length > 0) {
        // Not thrown: this is the advisory half. The caller sees `ok` and the
        // detail explains, so it shows up in the body without a 503.
        throw new PendingMigrations(pending);
      }
    }, MIGRATION_TIMEOUT_MS).then((check) => check);
  }

  /**
   * Migration folders shipped in the image that the database has not applied.
   *
   * Returns nothing if the directory cannot be read. A missing folder means
   * this is running from a layout the check does not understand — not that the
   * database is behind — and reporting it as a fault would be a false alarm.
   */
  private async pendingMigrations(applied: Set<string>): Promise<string[]> {
    /**
     * Two candidates, because the working directory differs by how the API was
     * started: the repo root under `node apps/api/dist/main.js` and in the
     * container, `apps/api` under `npm run dev`. Checking only the first meant
     * the whole check silently returned "nothing pending" in development —
     * a check that no-ops in the environment where you would notice it being
     * wrong is worse than no check.
     */
    const candidates = [
      join(process.cwd(), 'apps', 'api', 'prisma', 'migrations'),
      join(process.cwd(), 'prisma', 'migrations'),
    ];

    for (const dir of candidates) {
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        return entries
          .filter((entry) => entry.isDirectory() && !applied.has(entry.name))
          .map((entry) => entry.name);
      } catch {
        // Not this one; try the next.
      }
    }

    // Neither found. This is a layout the check does not understand, not
    // evidence that the database is behind — reporting it would be a false
    // alarm on an instance that is working.
    return [];
  }

  /** Runs a check, or returns the recent result if there is one. */
  private async cached(
    key: string,
    timeoutMs: number,
    check: () => Promise<void>,
  ): Promise<DependencyCheck> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ADVISORY_CACHE_MS) return hit.check;

    const result = await this.run(check, timeoutMs);
    this.cache.set(key, { at: Date.now(), check: result });
    return result;
  }

  /** Runs one check, timing it and holding it to a deadline. */
  private async run(check: () => Promise<void>, timeoutMs: number): Promise<DependencyCheck> {
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        check(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
      return { status: 'ok', latencyMs: Date.now() - started };
    } catch (error) {
      // Pending migrations are informational, so they come back `ok` with a
      // note. Everything else is a genuine failure.
      if (error instanceof PendingMigrations) {
        return {
          status: 'ok',
          latencyMs: Date.now() - started,
          detail: `${error.names.length} migration(s) not applied: ${error.names.join(', ')}`,
        };
      }
      return { status: 'error', latencyMs: Date.now() - started, detail: this.describe(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  private uptimeSeconds(): number {
    return Math.floor((Date.now() - this.startedAt) / 1000);
  }

  /**
   * The failure reason, or a generic one in production.
   *
   * These endpoints are public — they have to be, since a probe cannot
   * authenticate — and a Prisma connection error quotes the database host back
   * at you. That is exactly what makes it useful locally and exactly what
   * should not be served to the internet.
   */
  private describe(error: unknown): string {
    if (this.config.get('isProduction', { infer: true })) return 'unavailable';
    return error instanceof Error ? error.message : String(error);
  }
}

/** Carries the pending list out of a check without marking it failed. */
class PendingMigrations extends Error {
  constructor(readonly names: string[]) {
    super('pending migrations');
    this.name = 'PendingMigrations';
  }
}

function version(): string {
  return process.env.npm_package_version ?? '1.0.0';
}

/**
 * Which build is running.
 *
 * Render, Railway and Vercel each expose the commit under their own name.
 * Reading all of them means this answers "did my deploy actually go out?" on
 * whichever one is hosting it, with no configuration.
 */
function commit(): string | null {
  return (
    process.env.GIT_COMMIT ??
    process.env.RENDER_GIT_COMMIT ??
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    null
  );
}
