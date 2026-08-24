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

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
        ...(process.env.PRISMA_LOG_QUERIES === 'true'
          ? ([{ emit: 'event', level: 'query' }] as const)
          : []),
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
    events.$on('query', (e) => this.logger.debug(`${e.duration}ms ${e.query}`));

    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
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
