import {
  INestApplication,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Prisma client wired into the Nest lifecycle.
 *
 * Tenant scoping is done explicitly in each service rather than through a global
 * middleware. Middleware that silently injects `organisationId` reads as safer
 * than it is: it hides the filter from the query you are looking at, and any
 * `$queryRaw` bypasses it entirely. Explicit `where` clauses are reviewable.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /**
   * Read from `process.env` rather than injected.
   *
   * This client is constructed before Nest has finished building the container,
   * so `ConfigService` is not available yet — and the log subscriptions have to
   * be declared in the constructor call itself, not attached later. Both values
   * are in the validated schema (`configuration.ts`), so a typo is still caught
   * at boot; this only reads them earlier than everything else does.
   */
  private readonly logQueries = process.env.PRISMA_LOG_QUERIES === 'true';
  private readonly slowQueryMs = Number(process.env.SLOW_QUERY_MS ?? 300);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
        // Subscribed unconditionally: the slow-query warning needs the event
        // even when full query logging is off. Nothing is written unless a
        // statement is actually slow.
        { emit: 'event', level: 'query' },
      ],
      errorFormat: 'minimal',
    });
  }

  async onModuleInit(): Promise<void> {
    // `$on` is typed off the generic log-level union the client was constructed
    // with, and that union is not visible through the subclass. One narrow
    // local type describing the three subscriptions actually made beats three
    // `any` casts — a typo in an event name is still caught.
    const events = this as unknown as {
      $on(event: 'warn' | 'error', handler: (e: Prisma.LogEvent) => void): void;
      $on(event: 'query', handler: (e: Prisma.QueryEvent) => void): void;
    };

    events.$on('warn', (e) => this.logger.warn(e.message));
    events.$on('error', (e) => this.logger.error(e.message));

    /**
     * Query logging, at two levels.
     *
     * Every statement at `debug` when PRISMA_LOG_QUERIES is on — that is the
     * N+1 hunt, and it is deliberately opt-in because query parameters contain
     * personal data.
     *
     * A slow one at `warn` regardless. That is the line worth having on by
     * default: it turns "the app feels slow sometimes" into a specific
     * statement and a duration, and it costs nothing on a healthy system
     * because a healthy system does not emit it.
     */
    events.$on('query', (e) => {
      if (this.logQueries) this.logger.debug(`${e.duration}ms ${e.query}`);
      if (e.duration >= this.slowQueryMs) {
        this.logger.warn(`Slow query: ${e.duration}ms — ${truncate(e.query)}`);
      }
    });

    const started = Date.now();
    await this.$connect();
    this.logger.log(`Database connection established in ${Date.now() - started}ms`);
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Closing the database connection pool');
    await this.$disconnect();
  }

  /**
   * Close the pool cleanly when the platform sends SIGTERM. Railway and most
   * container schedulers give roughly 10 seconds before SIGKILL; without this the
   * process can die mid-transaction and leave a connection slot pinned.
   */
  enableShutdownHooks(app: INestApplication): void {
    process.on('beforeExit', () => {
      void app.close();
    });
  }

  /** Wipes every table. Test helper — refuses to run outside NODE_ENV=test. */
  async truncateAll(): Promise<void> {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('truncateAll() is only available when NODE_ENV=test');
    }
    const tables = await this.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
    `;
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
    if (list) await this.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE;`);
  }
}

/** Keeps one pathological statement from filling a log line with 40kB of SQL. */
function truncate(sql: string, max = 300): string {
  return sql.length > max ? `${sql.slice(0, max)}…` : sql;
}
