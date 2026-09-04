import { z } from 'zod';

/**
 * Environment contract.
 *
 * Validated once at boot and never read via `process.env` again. A typo in a
 * variable name should crash the process on startup with a readable message, not
 * surface three weeks later as an undefined S3 bucket.
 */

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/** Never verifiable with any provider, so it is never a usable production sender. */
const PLACEHOLDER_SENDER = 'no-reply@constructiq.local';

const PLACEHOLDER_SECRETS = [
  'change-me-access-secret-at-least-32-characters-long',
  'change-me-refresh-secret-at-least-32-characters-long',
];

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),

    /**
     * The interface to bind.
     *
     * `0.0.0.0` — every IPv4 interface — because that is what every container
     * platform's port scanner probes. Render says so explicitly, and a service
     * that binds anything narrower is reported as having no open ports even
     * though the process is running and answering.
     *
     * This was `::`, chosen to fix a local Windows problem where a browser
     * resolving `localhost` tries `::1` first and waits ~200ms for it to fail.
     * Node opens `::` dual-stack by default so it does accept IPv4 — but that
     * behaviour depends on the host, it is invisible when it goes wrong, and a
     * developer-experience tweak has no business deciding how production
     * binds. Set HOST=:: locally if the latency is worth it there.
     */
    HOST: z.string().default('0.0.0.0'),
    API_PREFIX: z.string().default('api/v1'),

    /**
     * How much to log, and in what shape.
     *
     * Both are left optional and resolved against NODE_ENV below, because the
     * right default genuinely differs: a developer wants readable colour and
     * every query; a production log aggregator wants one JSON object per line
     * and not the queries.
     *
     * The levels are Nest's own, ordered loudest-last. Setting one enables it
     * and everything above it, so `debug` gives error+warn+log+debug.
     */
    LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'verbose']).optional(),
    LOG_FORMAT: z.enum(['json', 'pretty']).optional(),

    /**
     * Log every SQL statement Prisma issues, with its duration.
     *
     * Off by default even in development: it is genuinely useful when chasing an
     * N+1, and pure noise the rest of the time. Never enable it in production —
     * query parameters are logged, and those contain personal data.
     */
    PRISMA_LOG_QUERIES: bool.default('false'),

    /** A query slower than this is logged as a warning. */
    SLOW_QUERY_MS: z.coerce.number().int().positive().default(300),
    CORS_ORIGINS: z.string().default('http://localhost:5173'),

    DATABASE_URL: z.string().url('DATABASE_URL must be a valid connection string'),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL: z.string().default('30d'),
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(8),
    LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(15),

    /**
     * `local` by default. S3 is the better production answer for attachments,
     * but defaulting to it made the API refuse to boot without credentials for
     * a feature many deployments never touch. Opt in by setting this to `s3`.
     */
    STORAGE_DRIVER: z.enum(['s3', 'local']).default('local'),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default('ciq-attachments'),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool.default('true'),
    S3_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    MAX_UPLOAD_MB: z.coerce.number().int().positive().default(25),
    LOCAL_UPLOAD_DIR: z.string().default('./uploads'),

    /**
     * `brevo` posts to Brevo's HTTP API with a v3 key. `smtp` speaks SMTP to any
     * relay. They are separate because Brevo's SMTP relay does not accept a v3
     * API key — it needs the distinct login and SMTP key from the SMTP tab.
     */
    MAIL_DRIVER: z.enum(['brevo', 'smtp', 'log']).default('log'),

    /** The `xkeysib-…` key from Brevo → SMTP & API → API Keys. */
    BREVO_API_KEY: z.string().optional(),

    /**
     * The envelope sender. Must be an address Brevo has verified, or it rejects
     * the message at submission. `EMAIL_FROM` is the bare address; the display
     * name is separate because the HTTP API takes the two as distinct fields
     * rather than as one "Name <addr>" string.
     *
     * Named to match what Brevo's own dashboard and our deployment environment
     * call them. They were `MAIL_FROM` / `MAIL_FROM_NAME`; the check further
     * down catches an environment still using the old names rather than letting
     * it fall through to the default sender, which Brevo would reject.
     */
    EMAIL_FROM: z.string().default(PLACEHOLDER_SENDER),
    EMAIL_FROM_NAME: z.string().default('ConstructIQ Tracker'),

    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_SECURE: bool.default('false'),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),

    ENABLE_SCHEDULER: bool.default('true'),
    DIGEST_CRON: z.string().default('0 3 * * 1'),
    RISK_SWEEP_CRON: z.string().default('0 2 * * *'),

    WEB_APP_URL: z.string().default('http://localhost:5173'),
  })
  .superRefine((env, ctx) => {
    // A deployment that boots with the sample secrets is a deployment anyone can
    // mint tokens for, so refuse rather than warn.
    if (env.NODE_ENV === 'production') {
      for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
        if (PLACEHOLDER_SECRETS.includes(env[key])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} still holds the example value — generate a real secret before deploying`,
          });
        }
      }
      if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_REFRESH_SECRET'],
          message:
            'Access and refresh secrets must differ, or a refresh token is a valid access token',
        });
      }
    }
    // Fail at boot rather than at 3am when the digest job runs.
    if (env.MAIL_DRIVER === 'brevo' && !env.BREVO_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BREVO_API_KEY'],
        message: 'BREVO_API_KEY is required when MAIL_DRIVER=brevo',
      });
    }

    /**
     * Brevo rejects an unverified sender at submission, and the default here
     * (`no-reply@constructiq.local`) can never be verified — so a Brevo
     * deployment without EMAIL_FROM does not fail loudly, it fails on every
     * message with a 400 nobody is watching for.
     */
    if (env.MAIL_DRIVER === 'brevo' && env.EMAIL_FROM === PLACEHOLDER_SENDER) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EMAIL_FROM'],
        message:
          'EMAIL_FROM is required when MAIL_DRIVER=brevo, and must be an address ' +
          'verified under Brevo → Senders, Domains & Dedicated IPs.',
      });
    }

    // The legacy MAIL_FROM / MAIL_FROM_NAME names are adopted before validation
    // rather than rejected here — see `adoptLegacyNames` below for why.
    // A v3 key pasted into the SMTP password is the most likely way to configure
    // this wrong, and it fails with an opaque 535 from the relay.
    if (env.MAIL_DRIVER === 'smtp' && env.SMTP_PASSWORD?.startsWith('xkeysib-')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMTP_PASSWORD'],
        message:
          'That is a Brevo v3 API key, which the SMTP relay rejects. Either set MAIL_DRIVER=brevo ' +
          'and move it to BREVO_API_KEY, or use the SMTP key from Brevo → SMTP & API → SMTP.',
      });
    }
    if (env.STORAGE_DRIVER === 's3' && (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['S3_ACCESS_KEY_ID'],
        message: 'S3 credentials are required when STORAGE_DRIVER=s3',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Called by ConfigModule. Throws a readable aggregate error when validation fails. */
/**
 * `MAIL_FROM` / `MAIL_FROM_NAME` were renamed to `EMAIL_FROM` / `EMAIL_FROM_NAME`
 * to match Brevo's own wording. An environment still holding the old names is
 * adopted and warned about, not rejected.
 *
 * The danger in renaming a variable that has a default is falling back to the
 * *default* — `no-reply@constructiq.local`, which Brevo can never verify, so
 * every message fails with nobody watching. Carrying the old variable's actual
 * value across has none of that: the sender is the one the operator configured,
 * and the warning says what to rename.
 *
 * Refusing to boot would have been the other option, and it is the wrong one
 * for a rename: it converts somebody else's correct configuration into an
 * outage on the next deploy, to fix something that is only cosmetic.
 */
function adoptLegacyNames(raw: Record<string, unknown>): string[] {
  const warnings: string[] = [];
  for (const [legacy, current] of [
    ['MAIL_FROM', 'EMAIL_FROM'],
    ['MAIL_FROM_NAME', 'EMAIL_FROM_NAME'],
  ] as const) {
    if (raw[legacy] && !raw[current]) {
      raw[current] = raw[legacy];
      warnings.push(`${legacy} is deprecated — rename it to ${current}.`);
    }
  }
  return warnings;
}

export function validateEnv(raw: Record<string, unknown>): Env {
  for (const warning of adoptLegacyNames(raw)) {
    // Before the logger exists, so console. Still reaches the platform's log.
    // eslint-disable-next-line no-console
    console.warn(`[config] ${warning}`);
  }

  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}

/**
 * Shape exposed through `ConfigService`, grouped so callers read
 * `config.get('jwt').accessSecret` rather than juggling flat keys.
 */
export function buildConfig(env: Env) {
  return {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    logging: {
      // `log` in production, `debug` outside it. Production at `debug` would
      // mean a line per cache decision and per query plan, which costs money on
      // a hosted log service and buries the lines that matter.
      level: env.LOG_LEVEL ?? (env.NODE_ENV === 'production' ? 'log' : 'debug'),
      // One JSON object per line where something is going to parse them;
      // aligned, coloured text where a person is reading them.
      format: env.LOG_FORMAT ?? (env.NODE_ENV === 'production' ? 'json' : 'pretty'),
      queries: env.PRISMA_LOG_QUERIES,
      slowQueryMs: env.SLOW_QUERY_MS,
    },
    port: env.PORT,
    host: env.HOST,
    apiPrefix: env.API_PREFIX,
    // Trailing slashes are stripped because a browser's `Origin` header never
    // has one, and the value here is almost always pasted from an address bar
    // that does. `https://app.vercel.app/` would otherwise never match and the
    // failure looks identical to not having set the variable at all.
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean),
    webAppUrl: env.WEB_APP_URL,
    database: { url: env.DATABASE_URL },
    jwt: {
      accessSecret: env.JWT_ACCESS_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessTtl: env.JWT_ACCESS_TTL,
      refreshTtl: env.JWT_REFRESH_TTL,
      maxLoginAttempts: env.LOGIN_MAX_ATTEMPTS,
      lockoutMinutes: env.LOGIN_LOCKOUT_MINUTES,
    },
    storage: {
      driver: env.STORAGE_DRIVER,
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      signedUrlTtlSeconds: env.S3_SIGNED_URL_TTL_SECONDS,
      maxUploadBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
      localDir: env.LOCAL_UPLOAD_DIR,
    },
    mail: {
      driver: env.MAIL_DRIVER,
      brevoApiKey: env.BREVO_API_KEY,
      from: env.EMAIL_FROM,
      fromName: env.EMAIL_FROM_NAME,
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
    },
    scheduler: {
      enabled: env.ENABLE_SCHEDULER,
      digestCron: env.DIGEST_CRON,
      riskSweepCron: env.RISK_SWEEP_CRON,
    },
  };
}

export type AppConfig = ReturnType<typeof buildConfig>;

/** ConfigModule `load` entry — namespaced so `config.get<...>('jwt')` works. */
export default () => buildConfig(validateEnv(process.env));
