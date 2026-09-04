import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppLogger, levelsUpTo } from './common/logging/app-logger';
import type { AppConfig } from './config/configuration';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap(): Promise<void> {
  /**
   * Buffer the boot logs.
   *
   * Nest logs a line per controller and per route while it wires the container,
   * all before the configured logger exists. Buffering holds them until
   * `useLogger` below, so those lines come out in the chosen format too — a
   * production log that is JSON except for the first two hundred lines is a log
   * whose parser breaks on startup, which is the worst moment for it.
   */
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  const config = app.get(ConfigService<AppConfig, true>);
  const logging = config.get('logging', { infer: true });

  // Transient scope, so `resolve` rather than `get`.
  const appLogger = await app.resolve(AppLogger);
  appLogger.configure(logging);
  app.useLogger(appLogger);
  app.flushLogs();

  const logger = new Logger('Bootstrap');
  logger.log(
    `Logging at "${logging.level}" (${levelsUpTo(logging.level).join(', ')}) in ${logging.format} format`,
  );
  const isProduction = config.get('isProduction', { infer: true });
  const apiPrefix = config.get('apiPrefix', { infer: true });
  const port = config.get('port', { infer: true });
  const corsOrigins = config.get('corsOrigins', { infer: true });

  // Railway, Vercel and most load balancers terminate TLS upstream. Without this
  // express reports the proxy's address as req.ip, so rate limits and audit
  // entries would all record the same IP.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // The API serves JSON, not HTML, so the default CSP is noise. Object
      // storage is on another origin, hence the relaxed CORP.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );
  app.use(compression());
  app.use(cookieParser());

  app.enableCors({
    /**
     * Allowlist with a log line on every refusal.
     *
     * Passing the array straight to `origin` works, but a rejected request then
     * produces silence on the server and a generic network error in the
     * browser — the origin that was actually refused appears nowhere. Since a
     * CORS misconfiguration is the single most common way this deployment
     * breaks, the refusal names the origin and prints the current allowlist, so
     * the fix is a copy-paste out of the log.
     */
    origin: (origin, callback) => {
      // No Origin header: curl, server-to-server, and the platform's own health
      // probe. CORS is a browser mechanism and does not apply to these.
      if (!origin) return callback(null, true);

      if (corsOrigins.includes(origin.replace(/\/+$/, ''))) return callback(null, true);

      logger.warn(
        `CORS refused ${origin} — add it to CORS_ORIGINS and redeploy. ` +
          `Currently allowed: ${corsOrigins.join(', ') || '(empty)'}`,
      );
      // `false` omits the header, which is what makes the browser block it.
      // An Error here would surface as a 500 and hide the real cause.
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
    exposedHeaders: ['x-request-id', 'Content-Disposition'],
    maxAge: 86_400,
  });

  app.setGlobalPrefix(apiPrefix);

  // No global validation pipe: request bodies and query strings are validated
  // per-route by ZodValidationPipe against the schemas in @ciq/shared, and route
  // params by ParseUUIDPipe. Adding Nest's class-validator pipe on top would mean
  // two validation systems disagreeing about the same request.

  app.enableShutdownHooks();
  app.get(PrismaService).enableShutdownHooks(app);

  // API docs are a map of the attack surface; publish them only off production.
  if (!isProduction) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('ConstructIQ Tracker API')
        .setDescription(
          'Project, drawing, procurement and execution tracking. ' +
            'All phases, categories, templates and thresholds are organisation-defined data.',
        )
        .setVersion('1.0.0')
        .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
        .build(),
    );
    SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  /**
   * `::` rather than `0.0.0.0`, so the socket is dual-stack.
   *
   * Bound to IPv4 only, a client resolving `localhost` gets `::1` first, waits
   * for that connection to fail, and then retries on IPv4. On Windows that wait
   * is about 200ms — paid on *every* request, before the server sees any of
   * them. It made a local page load feel broken while the server itself was
   * answering in four milliseconds.
   *
   * Node opens `::` as dual-stack unless `ipv6Only` is set, so this still
   * accepts IPv4 and every container platform still reaches it.
   */
  await app.listen(port, '::');

  logger.log(`API listening on http://localhost:${port}/${apiPrefix}`);
  if (!isProduction) logger.log(`API docs at http://localhost:${port}/${apiPrefix}/docs`);
  logger.log(`CORS origins: ${corsOrigins.join(', ')}`);

  // At `debug`, because it is what you want the moment a deployed instance
  // behaves unlike the one on your machine, and noise on every other day.
  logger.debug(
    `node ${process.version} · env ${config.get('env', { infer: true })} · pid ${process.pid}`,
  );

  /**
   * Say goodbye on the way out.
   *
   * Without this, a container that is scaled down, redeployed or OOM-killed
   * simply stops appearing in the log, and there is no way afterwards to tell
   * an orderly shutdown from a crash.
   */
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      logger.log(`${signal} received — shutting down after ${uptime()}`);
    });
  }

  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled promise rejection: ${String(reason)}`);
  });
}

function uptime(): string {
  return `${Math.round(process.uptime())}s`;
}

bootstrap().catch((error) => {
  // Nothing is wired up yet at this point, so use console rather than a Nest
  // logger that may not exist.
  // eslint-disable-next-line no-console
  console.error('Failed to start the API:', error);
  process.exit(1);
});
