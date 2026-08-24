import { z } from 'zod';

/**
 * Environment contract.
 *
 * Validated once at boot and never read via `process.env` again. A typo in a
 * variable name should crash the process on startup with a readable message, not
 * surface three weeks later as an undefined S3 bucket.
 */

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const PLACEHOLDER_SECRETS = [
  'change-me-access-secret-at-least-32-characters-long',
  'change-me-refresh-secret-at-least-32-characters-long',
];

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    API_PREFIX: z.string().default('api/v1'),
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
     * the message at submission. `MAIL_FROM` is the bare address; the display
     * name is separate because the HTTP API takes the two as distinct fields
     * rather than as one "Name <addr>" string.
     */
    MAIL_FROM: z.string().default('no-reply@constructiq.local'),
    MAIL_FROM_NAME: z.string().default('ConstructIQ Tracker'),

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
export function validateEnv(raw: Record<string, unknown>): Env {
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
    port: env.PORT,
    apiPrefix: env.API_PREFIX,
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
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
      from: env.MAIL_FROM,
      fromName: env.MAIL_FROM_NAME,
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
