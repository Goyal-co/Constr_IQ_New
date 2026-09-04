import { Controller, Get, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/auth-context';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../infra/mail/mail.service';

/**
 * Liveness and readiness.
 *
 * Two probes with two different jobs, and the difference matters to whoever is
 * configuring the platform:
 *
 *   • `/health` — is this process alive? Touches nothing. A failure here means
 *     restart the container, and it must never fail for a reason a restart
 *     cannot fix, which is why it does not look at the database.
 *   • `/health/ready` — can this instance serve traffic? Touches the database.
 *     A failure means take it out of rotation and leave it running: a container
 *     whose connection string is wrong will not be fixed by restarting it.
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

/**
 * The mail check is cached.
 *
 * Verifying Brevo is an outbound HTTPS call to a third party. Probed every 30
 * seconds it would be roughly 3,000 calls a day against somebody else's rate
 * limit purely to answer a question whose answer almost never changes. A minute
 * of staleness on an advisory check is a fair trade.
 */
const MAIL_CACHE_MS = 60_000;

@ApiTags('Health')
// Probes come from one address at a fixed interval, which is exactly the shape
// the rate limiter exists to stop. A 429 on a health check reads as a dead
// instance, so the guard is skipped here.
@SkipThrottle()
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();
  private mailCache: { at: number; check: DependencyCheck } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness probe — no dependencies touched' })
  live() {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      /**
       * Which build is actually running.
       *
       * Render, Railway and Vercel each expose the commit under their own
       * name. Reading all three means this answers the "did my deploy go out?"
       * question on whichever one is hosting it, without configuration.
       */
      version: process.env.npm_package_version ?? '1.0.0',
      commit:
        process.env.GIT_COMMIT ??
        process.env.RENDER_GIT_COMMIT ??
        process.env.RAILWAY_GIT_COMMIT_SHA ??
        process.env.VERCEL_GIT_COMMIT_SHA ??
        null,
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — verifies dependencies' })
  @ApiResponse({ status: 200, description: 'Ready. Mail may still be degraded.' })
  @ApiResponse({ status: 503, description: 'Not ready — the database is unreachable.' })
  async ready(@Res({ passthrough: true }) response: Response) {
    // Run together: two checks bounded at four seconds each should cost four
    // seconds in the worst case, not eight.
    const [database, mail] = await Promise.all([this.checkDatabase(), this.checkMail()]);

    /**
     * The database decides readiness; mail does not.
     *
     * Without a database this instance cannot answer a single request. Without
     * mail it serves every page and silently drops the weekly digest — real,
     * but not a reason to pull the only instance out of rotation and take the
     * whole application down with it.
     */
    const ready = database.status === 'ok';

    // The status code is the part orchestrators read. A readiness endpoint that
    // reports trouble in its body and still answers 200 is never acted on by
    // anything — which is the same as not having one.
    response.status(ready ? 200 : 503);

    return {
      status: ready ? (mail.status === 'ok' ? 'ok' : 'degraded') : 'error',
      checks: { database, mail },
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  private checkDatabase(): Promise<DependencyCheck> {
    return this.run(async () => {
      await this.prisma.$queryRaw`SELECT 1`;
    }, DATABASE_TIMEOUT_MS);
  }

  private async checkMail(): Promise<DependencyCheck> {
    const cached = this.mailCache;
    if (cached && Date.now() - cached.at < MAIL_CACHE_MS) return cached.check;

    const check = await this.run(async () => {
      if (!(await this.mail.verify())) throw new Error('the provider rejected the credentials');
    }, MAIL_TIMEOUT_MS);

    this.mailCache = { at: Date.now(), check };
    return check;
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
      return { status: 'error', latencyMs: Date.now() - started, detail: this.describe(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * The failure reason, or a generic one in production.
   *
   * This endpoint is public — it has to be, since a probe cannot authenticate —
   * and a Prisma connection error quotes the database host back at you. That is
   * exactly what makes it useful locally and exactly what should not be served
   * to the internet.
   */
  private describe(error: unknown): string {
    if (this.config.get('isProduction', { infer: true })) return 'unavailable';
    return error instanceof Error ? error.message : String(error);
  }
}
