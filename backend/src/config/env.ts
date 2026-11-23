import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27018/autoparts_erp?replicaSet=rs0'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  /** Secret used to sign CSRF tokens and derive other keys. Must be long and random in production. */
  APP_SECRET: z.string().min(16).default('dev-only-insecure-secret-change-me'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  SESSION_IDLE_MINUTES: z.coerce.number().positive().default(30),
  COOKIE_SECURE: bool,
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  /** General API rate limit per client IP per minute (login has its own stricter limits). */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(600),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  UPLOAD_DIR: z.string().default('./uploads'),
  BACKUP_DIR: z.string().default('./backups'),
  /** 32-byte key, hex encoded (64 chars). Required to create backups. */
  BACKUP_ENCRYPTION_KEY: z.string().optional(),
  BACKUP_RETENTION_COUNT: z.coerce.number().int().positive().default(14),
  BACKUP_SCHEDULE_HOURS: z.coerce.number().nonnegative().default(24),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-opus-5-5'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  JOBS_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
});

export type Env = z.infer<typeof EnvSchema>;

function load(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    if (env.APP_SECRET.startsWith('dev-only')) throw new Error('APP_SECRET must be set in production');
    if (!env.COOKIE_SECURE) console.warn('[security] COOKIE_SECURE is not enabled in production. Enable it behind HTTPS.');
  }
  return env;
}

export const env = load();
export const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
