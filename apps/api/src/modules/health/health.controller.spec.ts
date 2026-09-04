import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { HealthController } from './health.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../infra/mail/mail.service';
import { StorageService } from '../../infra/storage/storage.service';

/**
 * The behaviour worth pinning down here is the *status codes*, not the bodies.
 *
 * The bug this endpoint shipped with was returning 200 while reporting
 * `degraded` in its body — which no orchestrator reads, so nothing ever acted
 * on it. That is invisible to a test that only asserts on the payload, and it
 * is the reason these assertions are written against `response.status`.
 */

/** A minimal Express response that records the status it was given. */
function fakeResponse(): Response & { statusCode: number } {
  const res = {
    statusCode: 0,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number };
}

interface Doubles {
  queryRaw?: () => Promise<unknown>;
  count?: () => Promise<number>;
  mailOk?: boolean;
  storageOk?: boolean;
  production?: boolean;
}

async function build(doubles: Doubles = {}) {
  const {
    queryRaw = async () => [{ migration_name: '20260101_init', failed: false }],
    count = async () => 1,
    mailOk = true,
    storageOk = true,
    production = false,
  } = doubles;

  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      { provide: PrismaService, useValue: { $queryRaw: queryRaw, organisation: { count } } },
      { provide: MailService, useValue: { verify: async () => mailOk } },
      {
        provide: StorageService,
        useValue: { verify: async () => ({ ok: storageOk, detail: 'bucket missing' }) },
      },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) => (key === 'isProduction' ? production : 'test'),
        },
      },
    ],
  }).compile();

  return moduleRef.get(HealthController);
}

describe('HealthController', () => {
  describe('liveness', () => {
    it('answers without touching any dependency', async () => {
      // A Prisma double that throws if called at all: liveness must not query.
      const controller = await build({
        queryRaw: async () => {
          throw new Error('liveness must not touch the database');
        },
      });

      expect(controller.live().status).toBe('ok');
    });

    it('exposes /health/live as the same answer', async () => {
      const controller = await build();
      expect(controller.liveAlias().status).toBe(controller.live().status);
    });
  });

  describe('startup', () => {
    it('is 503 until the schema can be read', async () => {
      const controller = await build({
        count: async () => {
          throw new Error('relation "organisations" does not exist');
        },
      });
      const res = fakeResponse();

      const body = await controller.startup(res);

      expect(res.statusCode).toBe(503);
      expect(body.status).toBe('starting');
    });

    it('latches once started, so a later outage cannot un-start it', async () => {
      let fail = false;
      const controller = await build({
        count: async () => {
          if (fail) throw new Error('connection lost');
          return 1;
        },
      });

      const first = fakeResponse();
      await controller.startup(first);
      expect(first.statusCode).toBe(200);

      // The database goes away afterwards. Startup is a one-way door: this is
      // now a readiness problem, and a platform that treats a failed startup
      // probe as fatal must not kill a container that did boot.
      fail = true;
      const second = fakeResponse();
      await controller.startup(second);
      expect(second.statusCode).toBe(200);
    });
  });

  describe('readiness', () => {
    it('is 200 when everything is up', async () => {
      const controller = await build();
      const res = fakeResponse();

      const body = await controller.ready(res);

      expect(res.statusCode).toBe(200);
      expect(body.status).toBe('ok');
      expect(body.checks.database.status).toBe('ok');
    });

    it('is 503 when the database is unreachable', async () => {
      const controller = await build({
        queryRaw: async () => {
          throw new Error('connection refused');
        },
      });
      const res = fakeResponse();

      const body = await controller.ready(res);

      expect(res.statusCode).toBe(503);
      expect(body.status).toBe('error');
      expect(body.checks.database.status).toBe('error');
    });

    it('is 503 when a migration started and never finished', async () => {
      const controller = await build({
        queryRaw: async () => [{ migration_name: '20260825_revisions', failed: true }],
      });
      const res = fakeResponse();

      const body = await controller.ready(res);

      expect(res.statusCode).toBe(503);
      expect(body.checks.migrations.status).toBe('error');
    });

    it('stays 200 and reports degraded when only mail is down', async () => {
      // Mail failing degrades digests. It is not a reason to pull the only
      // instance out of rotation and take the whole application down.
      const controller = await build({ mailOk: false });
      const res = fakeResponse();

      const body = await controller.ready(res);

      expect(res.statusCode).toBe(200);
      expect(body.status).toBe('degraded');
      expect(body.checks.mail.status).toBe('error');
    });

    it('stays 200 and reports degraded when only storage is down', async () => {
      const controller = await build({ storageOk: false });
      const res = fakeResponse();

      const body = await controller.ready(res);

      expect(res.statusCode).toBe(200);
      expect(body.status).toBe('degraded');
      expect(body.checks.storage.status).toBe('error');
    });

    it('withholds the failure reason in production', async () => {
      // These endpoints are public, and a Prisma error quotes the database host.
      const controller = await build({
        production: true,
        queryRaw: async () => {
          throw new Error("Can't reach database server at ep-secret-host.neon.tech:5432");
        },
      });

      const body = await controller.ready(fakeResponse());

      expect(body.checks.database.detail).toBe('unavailable');
      expect(body.checks.database.detail).not.toContain('neon.tech');
    });

    it('gives the reason outside production', async () => {
      const controller = await build({
        queryRaw: async () => {
          throw new Error('connection refused');
        },
      });

      const body = await controller.ready(fakeResponse());

      expect(body.checks.database.detail).toContain('connection refused');
    });

    it('caches the advisory checks rather than calling out every probe', async () => {
      let mailCalls = 0;
      const moduleRef = await Test.createTestingModule({
        controllers: [HealthController],
        providers: [
          {
            provide: PrismaService,
            useValue: {
              $queryRaw: async () => [{ migration_name: '20260101_init', failed: false }],
              organisation: { count: async () => 1 },
            },
          },
          {
            provide: MailService,
            useValue: {
              verify: async () => {
                mailCalls += 1;
                return true;
              },
            },
          },
          { provide: StorageService, useValue: { verify: async () => ({ ok: true }) } },
          { provide: ConfigService, useValue: { get: () => false } },
        ],
      }).compile();

      const controller = moduleRef.get(HealthController);
      await controller.ready(fakeResponse());
      await controller.ready(fakeResponse());
      await controller.ready(fakeResponse());

      // Three probes, one outbound call. At a 30s interval this is the
      // difference between ~120 and ~3,000 calls a day against Brevo.
      expect(mailCalls).toBe(1);
    });
  });

  describe('info', () => {
    it('reports the runtime without touching a dependency', async () => {
      const controller = await build({
        queryRaw: async () => {
          throw new Error('info must not touch the database');
        },
      });

      const body = controller.info();

      expect(body.node).toBe(process.version);
      expect(body.memoryMb.rss).toBeGreaterThan(0);
    });
  });
});
